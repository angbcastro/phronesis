import { NextResponse } from "next/server";
import { rodarElo } from "@/lib/confronto";
import { erroDeInfra } from "@/lib/rotas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Margem antes do teto de execução da função — parar aqui, não morrer no meio de um elo. */
const ORCAMENTO_MS = 270_000;

/**
 * A batida do confronto. Disparada pelo cron da Vercel (`vercel.json`),
 * separada de `cron/diario` — mesma porta (`Authorization: Bearer
 * $CRON_SECRET` sob `/api/cron/`, autorizada pelo middleware, nunca checada
 * aqui).
 *
 * É a única porta periódica da fatia 5: o confronto nunca roda em tempo real,
 * amarrado à confirmação de um átomo — decisão da entrevista. Processa a fila
 * em elos sequenciais até ela esvaziar ou o orçamento de tempo acabar; o que
 * sobrar fica pendente para a próxima batida ou para
 * `POST /api/confronto/rodar`.
 */
export async function GET() {
  const comeco = Date.now();
  let processados = 0;

  try {
    while (Date.now() - comeco < ORCAMENTO_MS) {
      const r = await rodarElo();
      if (!r) break; // fila vazia
      processados++;
    }
    return NextResponse.json({ ok: true, processados });
  } catch (e) {
    return erroDeInfra("cron-confronto", e);
  }
}
