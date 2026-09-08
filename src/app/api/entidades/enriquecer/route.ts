import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { acharPorChave, listarEntidades, passadaDeVetores } from "@/lib/entidades";
import {
  EnriquecimentoError,
  TETO_MOTIVO,
  enfileirar,
  enriquecer,
  marcarEstado,
  reivindicarProxima,
  rodarElo,
} from "@/lib/enriquecimento";
import { erro } from "@/lib/rotas";
import { normalizarNome } from "@/lib/texto";

export const runtime = "nodejs";

/**
 * O mesmo teto das três rotas que chamam modelo dentro de `waitUntil` (§10).
 *
 * A spec falava em 60 s por elo, e o que cabe folgado nele é a chamada — mas a
 * espera de rate limit desta fila **não tem prazo**, por decisão da fatia:
 * ninguém está esperando do outro lado da tela. Uma espera de 75 s estouraria um
 * teto de 60 e mataria o elo no meio do sono; 300 é o teto que permite a espera
 * longa acontecer. O `LEASE_MS` da reivindicação é o mesmo número, e é por isso:
 * passado ele, a função que reivindicou está morta com certeza.
 */
export const maxDuration = 300;

/**
 * POST /api/entidades/enriquecer — três corpos, um caminho cada.
 *
 * ```
 * { chave }    uma entidade, agora, e a resposta espera        (passo 4)
 * { chaves }   põe todas na fila, responde na hora, e anda só  (passo 5)
 * { elo }      um elo da fila — quem chama é a própria fila
 * ```
 *
 * **Ela escreve conteúdo no grafo sem eu aprovar campo por campo**, e é a única
 * rota deste sistema que faz isso. A regra 5 continua inteira: ela fala de átomo
 * e da tela de revisão, e nenhum átomo entra por aqui. O que substituiu a
 * aprovação é o par seleção + botão, mais `POST /api/entidades/desfazer`.
 *
 * **Como a fila anda sem janela aberta.** O estado mora no nó (migration 010),
 * não no navegador: `na_fila` é gravado antes de a resposta sair, e cada elo
 * reivindica **uma** entidade, roda, grava, e chama esta mesma rota de novo em
 * `waitUntil`. Fila vazia, o encadeamento para. É o mesmo mecanismo da
 * transcrição por blocos — estado idempotente mais `waitUntil` —, e a única
 * diferença é que aqui o elo seguinte é uma requisição nova, para começar com o
 * orçamento de execução inteiro em vez do que sobrou do anterior.
 *
 * **O elo se autentica com o meu próprio cookie**, repassado da requisição que
 * o originou (§7): a fila não abre porta nenhuma que já não estivesse aberta, e
 * o middleware continua sendo a porta única. Cookie que expira no meio de uma
 * fila longa para o encadeamento — a entidade em `rodando` volta pela retomada
 * no próximo toque do botão.
 */
export async function POST(req: Request) {
  const corpo = (await req.json().catch(() => null)) as {
    chave?: unknown;
    chaves?: unknown;
    elo?: unknown;
  } | null;

  if (corpo?.elo === true) return elo(req);

  if (Array.isArray(corpo?.chaves)) return enfileirarTodas(req, corpo.chaves);

  const chave = typeof corpo?.chave === "string" ? normalizarNome(corpo.chave) : "";
  if (chave === "") return erro("corpo inválido: espera { chave } ou { chaves }", 400);
  return umaAgora(chave);
}

/**
 * O elo seguinte, como requisição nova.
 *
 * `new URL(..., req.url)` e não uma variável de ambiente: o endereço certo é o
 * da requisição que está sendo servida, e ele já está aqui — em produção, em
 * preview e em `pnpm dev`.
 */
function encadear(req: Request): Promise<unknown> {
  const cookie = req.headers.get("cookie");
  return fetch(new URL("/api/entidades/enriquecer", req.url), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify({ elo: true }),
  }).catch((e) => {
    // O encadeamento é o que faz a fila andar; quando ele cai, o que sobra é a
    // retomada — as entidades ficam em `na_fila` e o próximo toque no botão as
    // pega. Dizer isso no log é a diferença entre "a fila parou" e "sumiu".
    console.error("[fila] não consegui chamar o elo seguinte; a fila para aqui:", e);
  });
}

/** `{ chaves }` — põe na fila, responde na hora, e dispara o primeiro elo. */
async function enfileirarTodas(req: Request, chaves: unknown[]) {
  const limpas = chaves.filter((c): c is string => typeof c === "string");
  if (limpas.length === 0) return erro("nenhuma entidade marcada", 400);

  try {
    const quantas = await enfileirar(limpas);
    if (quantas === 0) return erro("nenhuma das marcadas está no grafo", 404);

    console.log(`[fila] ${quantas} entidade(s) na fila de enriquecimento`);
    // Depois da resposta: a fila já está gravada, e fechar a aba não a
    // interrompe. O que o `waitUntil` faz é só dar o primeiro empurrão.
    waitUntil(encadear(req));
    return NextResponse.json({ ok: true, na_fila: quantas });
  } catch (e) {
    console.error("[fila]", e);
    return erro(e instanceof Error ? e.message : "não consegui enfileirar", 502);
  }
}

/**
 * `{ elo: true }` — uma entidade da fila, e o empurrão na próxima.
 *
 * **Responde na hora e trabalha em `waitUntil`**, e isso é o que mantém a fila
 * *sequencial* em vez de aninhada: quem chamou este elo pode morrer assim que a
 * resposta sai, em vez de ficar vivo segurando o resto da corrente.
 */
function elo(req: Request) {
  waitUntil(
    (async () => {
      try {
        const chave = await reivindicarProxima();
        if (!chave) {
          console.log("[fila] vazia — o encadeamento para aqui.");
          return;
        }

        // O catálogo inteiro, e não uma consulta por chave: é o mesmo objeto que
        // os agentes leem, e é ele que traz grafia e tipo para o prompt. É
        // também o limite conhecido da fila — ela é varrida sobre o catálogo em
        // memória, como o casamento exato da 4.11 (§14).
        await rodarElo(chave, await listarEntidades());
        await passadaDeVetores("enriquecimento");
      } catch (e) {
        // Erro fora do `rodarElo` (o grafo caiu, por exemplo): a entidade fica
        // em `rodando` e a retomada a pega. O encadeamento continua mesmo
        // assim — uma entidade ruim não pode parar a fila inteira.
        console.error("[fila] elo falhou fora do agente:", e);
      }
      await encadear(req);
    })(),
  );

  return NextResponse.json({ ok: true });
}

/**
 * `{ chave }` — uma entidade, agora, e a resposta espera.
 *
 * É o ponto de retorno barato do passo 4: dá para enriquecer à mão, uma por vez,
 * e olhar o resultado antes de soltar o lote sobre o grafo inteiro.
 */
async function umaAgora(chave: string) {
  try {
    const alvo = acharPorChave(chave, await listarEntidades());
    if (!alvo) return erro(`"${chave}" não está no grafo`, 404);

    await marcarEstado(alvo.nome_normalizado, "rodando");

    try {
      const r = await enriquecer(alvo);
      // A ficha é o que mais muda a string canônica da entidade, e portanto o
      // vetor dela — de todos os ganchos da 4.8.1, este é o que mais rende.
      void passadaDeVetores("enriquecer");
      return NextResponse.json({ ok: true, nome: alvo.nome, ...r });
    } catch (e) {
      const motivo = e instanceof Error ? e.message : String(e);
      console.error(`[enriquecer] ${alvo.nome}:`, e);
      await marcarEstado(alvo.nome_normalizado, "falhou", motivo).catch(() => {});
      return erro(motivo.slice(0, TETO_MOTIVO), 502);
    }
  } catch (e) {
    if (e instanceof EnriquecimentoError) return erro(e.message, 400);
    console.error("[enriquecer]", e);
    return erro(e instanceof Error ? e.message : "não consegui enriquecer", 502);
  }
}
