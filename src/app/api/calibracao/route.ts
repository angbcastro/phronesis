import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { carregarIndice, marcarVisita, pautaComDobra } from "@/lib/calibracao";
import { abertasPorAgente, paraCalibrar } from "@/lib/correcoes";
import { agentePorId, AGENTES } from "@/lib/agentes";
import { efetivo } from "@/lib/overrides";
import { secoesDe } from "@/lib/redacao";
import { erro, erroDeInfra } from "@/lib/rotas";
import { ehAgenteId } from "@/lib/tipos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/calibracao — o índice de correções, para a tela de calibração.
 *
 * **Dois modos, e a diferença é o custo.** Sem `?agente`, devolve só o mapa:
 * quantas correções em aberto cada agente tem, para a tela abrir numa lista e
 * não numa parede de texto. Com `?agente`, devolve o material daquele agente —
 * as correções inteiras, a pauta viva e as seções do prompt em vigor.
 *
 * Marca a visita **daquele agente** como efeito colateral best-effort, no
 * `waitUntil`: é a carga de verdade desta tela que reseta o relógio da
 * sugestão, e não a consulta pura de `/sugestao`, para a sugestão ter chance de
 * valer os 21 dias inteiros. Falhar em marcar não pode custar a leitura — no
 * pior caso a sugestão acende de novo antes da hora.
 *
 * **A visita é por agente desde a slice 7.** Com um relógio só, abrir a tela de
 * um adiava a sugestão de todos os outros por três semanas.
 */
export async function GET(req: Request) {
  const pedido = new URL(req.url).searchParams.get("agente");

  try {
    const indice = await carregarIndice();

    if (pedido === null) {
      const abertas = abertasPorAgente(indice);
      const comPrompt = AGENTES.filter((a) => a.base !== null);

      /**
       * A pauta da porta sai de `pautaComDobra`, e **não** de `pautaDe`.
       *
       * A diferença só aparece num caso, e é justamente o que a dobra existe
       * para cobrir: eu tinha regra aprovada na 4.6 e nenhuma correção em
       * aberto. Contando por `pautaDe`, a extração apareceria com zero e zero,
       * a tela a filtraria da lista, e a dobra ficaria **inalcançável** — a
       * regra sumiria do prompt em silêncio, que é exatamente o que a 7 se
       * comprometeu a não deixar acontecer.
       *
       * Custa uma leitura de R2 a mais, e só uma: `pautaComDobra` só vai ao R2
       * pela extração, e só enquanto a dobra não tiver sido aplicada.
       */
      const pautas = await Promise.all(comPrompt.map((a) => pautaComDobra(indice, a.id)));

      return NextResponse.json({
        // Só os que têm prompt: `stt` e `embedding` não têm o que emendar, e
        // `grafo` não é agente nenhum — é higiene de grafia minha.
        agentes: comPrompt.map((a, i) => ({
          id: a.id,
          rotulo: a.rotulo,
          papel: a.papel,
          abertas: abertas[a.id] ?? 0,
          pauta: pautas[i].length,
        })),
        // `grafo` aparece à parte e sem botão: é material que eu posso ler, mas
        // não há prompt para emendar com ele. Escondê-lo faria a soma não bater.
        grafo: abertas.grafo ?? 0,
        atualizado_em: indice.atualizado_em,
      });
    }

    if (!ehAgenteId(pedido)) return erro(`não conheço o agente "${pedido}"`, 400);
    const agente = agentePorId(pedido);
    if (!agente || agente.base === null) {
      return erro(`o agente "${pedido}" não tem prompt para emendar`, 400);
    }

    // O prompt **em vigor**, não a base do git: é ele que o padrão contradiz e
    // é nele que a emenda vai entrar.
    const meu = await efetivo(agente.id, { prompt: agente.base, modelo: agente.padrao() });

    waitUntil(
      marcarVisita(agente.id).catch((e) => {
        console.error("[calibracao] não consegui marcar a visita:", e);
      }),
    );

    return NextResponse.json({
      agente: { id: agente.id, rotulo: agente.rotulo, papel: agente.papel, versao: agente.versao },
      correcoes: paraCalibrar(indice, agente.id),
      pauta: await pautaComDobra(indice, agente.id),
      secoes: secoesDe(meu.prompt),
      editado: meu.hash !== null,
      atualizado_em: indice.atualizado_em,
    });
  } catch (e) {
    return erroDeInfra("calibracao", e);
  }
}
