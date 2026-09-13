import { NextResponse } from "next/server";
import { chaveMensagens, idValido } from "@/lib/chaves";
import { responder } from "@/lib/chat";
import {
  acrescentarMensagens,
  buscarConversa,
  criarConversa,
  gravarTitulo,
  lerMensagens,
  titularConversa,
} from "@/lib/conversas";
import { erro, erroDeInfra } from "@/lib/rotas";
import type { Conversa, Mensagem, PassoDeFerramenta } from "@/lib/tipos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * O mesmo teto das outras rotas que chamam modelo com folga (§10 do
 * ARCHITECTURE.md). Aqui ele é o mais justificado do sistema: uma pergunta
 * composta paga até `TETO_FERRAMENTAS` idas ao Gateway, mais a síntese —
 * e a espera de rate limit do Gateway não tem prazo.
 */
export const maxDuration = 300;

/**
 * Um evento do fluxo NDJSON que esta rota devolve.
 *
 * **NDJSON à mão, e nenhuma dependência nova.** O `ai` traz protocolo de
 * streaming pronto, e ele foi recusado: ele fala de *token*, e o que esta tela
 * mostra enquanto espera não é token — é qual busca o agente está fazendo. Um
 * objeto por linha resolve isso com `fetch` e `TextDecoder`, que todo navegador
 * já tem, e mantém `package.json` do jeito que a slice 6 o encontrou.
 */
export type EventoDoChat =
  | { tipo: "conversa"; conversa: Conversa }
  | { tipo: "passo"; passo: PassoDeFerramenta }
  | { tipo: "resposta"; mensagem: Mensagem }
  | { tipo: "titulo"; titulo: string }
  | { tipo: "erro"; erro: string };

/**
 * POST /api/chat — `{ conversa_id?, texto }`.
 *
 * Devolve um fluxo de NDJSON: a conversa (para o cliente saber o id antes da
 * primeira palavra), um `passo` por chamada de ferramenta, a `resposta` no fim
 * e — só na primeira troca — o `titulo`.
 *
 * **A pergunta é gravada antes de o modelo começar.** Se eu apertar "parar", ou
 * se a função morrer no meio, a pergunta fica e a resposta não — que é o
 * resultado honesto, e o mesmo que a tela mostra. Gravar as duas juntas no fim
 * perderia a pergunta de uma resposta interrompida.
 *
 * **Sem chave de idempotência**, e é diferente de todo o resto do sistema
 * (regra 4). A regra chaveia por `sessao_id` porque o pipeline pode ser
 * reexecutado sozinho, por `waitUntil` e por retomada; aqui quem dispara sou eu
 * apertando enviar, e duas perguntas iguais seguidas são duas perguntas — não
 * uma repetida.
 */
export async function POST(req: Request) {
  const corpo = (await req.json().catch(() => null)) as {
    conversa_id?: unknown;
    texto?: unknown;
  } | null;

  const texto = typeof corpo?.texto === "string" ? corpo.texto.trim() : "";
  const conversaId = typeof corpo?.conversa_id === "string" ? corpo.conversa_id : "";

  if (texto === "") return erro("corpo inválido: espera { texto }", 400);
  if (conversaId !== "" && !idValido(conversaId)) return erro("id de conversa inválido", 400);

  let conversa: Conversa | null = null;
  try {
    if (conversaId === "") {
      conversa = await criarConversa();
    } else {
      conversa = await buscarConversa(conversaId);
      if (!conversa) return erro("conversa não encontrada", 404);
      // Arquivar **congela**: a conversa continua legível e não recebe mais
      // nada. Recusar aqui, e não só esconder o campo na tela, é o que faz a
      // promessa valer mesmo quando a tela está velha numa aba aberta.
      if (conversa.arquivada_em !== null) return erro("conversa arquivada", 409);
    }
  } catch (e) {
    return erroDeInfra("chat abrir conversa", e);
  }

  const alvo = conversa;
  const codificador = new TextEncoder();

  const fluxo = new ReadableStream<Uint8Array>({
    async start(controle) {
      const manda = (e: EventoDoChat) => {
        try {
          controle.enqueue(codificador.encode(`${JSON.stringify(e)}\n`));
        } catch {
          // O cliente fechou a aba no meio. O trabalho do lado de cá termina
          // sozinho logo abaixo, pelo `req.signal`.
        }
      };

      try {
        manda({ tipo: "conversa", conversa: alvo });

        const pergunta: Mensagem = {
          papel: "eu",
          texto,
          criado_em: new Date().toISOString(),
        };
        const historico = await acrescentarMensagens(alvo.id, [pergunta]);

        const r = await responder(historico, {
          aoPasso: (passo) => manda({ tipo: "passo", passo }),
          sinal: req.signal,
        });

        const resposta: Mensagem = {
          papel: "agente",
          texto: r.texto,
          criado_em: new Date().toISOString(),
          rastro: r.rastro,
          modelo: r.modelo,
          prompt_version: r.prompt_version,
        };
        await acrescentarMensagens(alvo.id, [resposta]);
        manda({ tipo: "resposta", mensagem: resposta });

        // O batismo, uma vez por conversa: a primeira troca é a que acabou de
        // acontecer. Falhar aqui não estraga nada — a lista mostra a primeira
        // pergunta cortada até alguém tentar de novo.
        if (alvo.titulo === "" && historico.length === 1) {
          try {
            const titulo = await titularConversa(texto, r.texto);
            if (titulo !== "") {
              await gravarTitulo(alvo.id, titulo);
              manda({ tipo: "titulo", titulo });
            }
          } catch (e) {
            console.error(`[chat] ${alvo.id}: não consegui dar título à conversa:`, e);
          }
        }
      } catch (e) {
        if (req.signal.aborted) {
          console.log(`[chat] ${alvo.id}: parado por mim no meio.`);
        } else {
          console.error(`[chat] ${alvo.id}:`, e);
          manda({
            tipo: "erro",
            erro: e instanceof Error ? e.message : "não consegui responder",
          });
        }
      } finally {
        controle.close();
      }
    },
  });

  return new Response(fluxo, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      // Sem isto um proxy pode segurar o corpo inteiro até o fim, e o progresso
      // por passo — a razão de a rota ser um fluxo — chegaria junto da resposta.
      "X-Accel-Buffering": "no",
    },
  });
}

/**
 * GET /api/chat?conversa_id=... — as mensagens de uma conversa.
 *
 * Mora aqui, e não em `/api/conversas/:id`, porque é a leitura do **mesmo**
 * objeto que o POST acima escreve: as mensagens no R2. `/api/conversas` fala do
 * nó — a lista, o título, arquivar e apagar.
 */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("conversa_id") ?? "";
  if (!idValido(id)) return erro("id de conversa inválido", 400);

  try {
    const conversa = await buscarConversa(id);
    if (!conversa) return erro("conversa não encontrada", 404);

    const { mensagens } = await lerMensagens(id);
    return NextResponse.json({ conversa, mensagens, mensagens_key: chaveMensagens(id) });
  } catch (e) {
    return erroDeInfra("chat GET", e);
  }
}
