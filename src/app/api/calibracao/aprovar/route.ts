import { NextResponse } from "next/server";
import { agentePorId, envelopeFaltando } from "@/lib/agentes";
import { aprovarEmenda, CalibracaoError, carregarIndice, pautaDe } from "@/lib/calibracao";
import { efetivo } from "@/lib/overrides";
import { aplicarEdicoes, RedacaoError, secaoDoEnvelope } from "@/lib/redacao";
import { erro } from "@/lib/rotas";
import { ehAgenteId, OPERACOES_EDICAO } from "@/lib/tipos";
import type { Edicao, OperacaoEdicao } from "@/lib/tipos";

export const runtime = "nodejs";

/**
 * POST /api/calibracao/aprovar — **o único lugar que escreve prompt por
 * calibração**.
 *
 * O `redacao-1` propõe e para por aí; o prompt do agente só muda quando eu
 * aperto aprovar, e é esta rota que o meu toque chama. Mesma disciplina de
 * `POST /api/entidades/perfil`, e pela mesma razão, que aqui é maior: o que
 * está sendo escrito é o prompt que produz todo o resto.
 *
 * **O corpo traz as edições, nunca o texto final.** A tela me mostrou o
 * resultado, mas quem o produz é o servidor, das mesmas edições, sobre o prompt
 * que estiver em vigor **agora**. Aceitar o texto pronto do cliente faria duas
 * coisas ruins de uma vez: uma segunda implementação de `aplicarEdicoes` que
 * divergiria calada, e uma porta por onde um corpo montado à mão escreveria
 * qualquer prompt sem passar por amarra nenhuma.
 *
 * O efeito colateral é bom: se eu editei o prompt no painel entre ver a emenda
 * e aprová-la, a aplicação falha em vez de sobrescrever o que eu acabei de
 * escrever — `aplicarEdicoes` não acha a seção, e eu recebo 409.
 */
export async function POST(req: Request) {
  const corpo = (await req.json().catch(() => null)) as
    | { agente?: unknown; edicoes?: unknown }
    | null;

  if (!ehAgenteId(corpo?.agente) || !Array.isArray(corpo.edicoes)) {
    return erro("corpo inválido: espera { agente, edicoes: [] }", 400);
  }

  const agente = agentePorId(corpo.agente);
  if (!agente || agente.base === null) {
    return erro(`o agente "${corpo.agente}" não tem prompt para emendar`, 400);
  }

  try {
    const indice = await carregarIndice();
    // Só padrão que eu confirmei e que ainda não foi aplicado. Uma emenda que
    // aponte para outra coisa fecharia correções que ela nunca leu.
    const pauta = new Map(pautaDe(indice, agente.id).map((p) => [p.id, p]));

    const edicoes: Edicao[] = [];
    for (const item of corpo.edicoes) {
      const e = item as Record<string, unknown>;
      const secao = typeof e?.secao === "string" ? e.secao.trim() : "";
      const texto = typeof e?.texto === "string" ? e.texto.trim() : "";
      const padrao = typeof e?.padrao === "string" ? e.padrao.trim() : "";
      const operacao = e?.operacao as OperacaoEdicao;

      if (secao === "" || texto === "") continue;
      if (!(OPERACOES_EDICAO as readonly unknown[]).includes(operacao)) continue;
      if (!pauta.has(padrao)) continue;

      edicoes.push({ secao, operacao, texto, padrao });
    }

    if (edicoes.length === 0) {
      return erro("nenhuma edição aproveitável no corpo", 400);
    }

    const meu = await efetivo(agente.id, { prompt: agente.base, modelo: agente.padrao() });
    const texto = aplicarEdicoes(meu.prompt, edicoes, {
      antesDe: secaoDoEnvelope(meu.prompt, agente.envelope),
    });

    // A mesma porta de `POST /api/agentes/:id`: eu posso reescrever o prompt
    // inteiro, mas não posso gravar um que deixe de pedir o JSON que o parser
    // sabe ler. Sem isto o erro só apareceria na próxima sessão.
    const faltando = envelopeFaltando(agente, texto);
    if (faltando.length > 0) {
      return erro(`o prompt ficaria sem ${faltando.join(", ")}`, 400);
    }

    const { hash, fechadas } = await aprovarEmenda(
      agente.id,
      texto,
      [...new Set(edicoes.map((e) => e.padrao))],
    );

    return NextResponse.json({ ok: true, hash, secoes: edicoes.length, fechadas });
  } catch (e) {
    // Seção que sumiu entre ver e aprovar: o prompt mudou por baixo, e refazer
    // a emenda é mais barato que descobrir depois qual das duas venceu.
    if (e instanceof RedacaoError) return erro(`${e.message} — peça a emenda de novo`, 409);
    if (e instanceof CalibracaoError) return erro(e.message, 400);
    console.error("[calibracao aprovar]", e);
    return erro(e instanceof Error ? e.message : "não consegui gravar a emenda", 502);
  }
}
