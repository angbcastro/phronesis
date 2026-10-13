import { NextResponse } from "next/server";
import { PRAZO_DO_ELO_MS, rodarElo } from "@/lib/confronto";
import { erroDeInfra } from "@/lib/rotas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Até quando a batida começa um elo novo. Depois disto, um elo começado já não
 * teria tempo de chamar o modelo (a chamada pode levar até `TETO_CHAMADA_MS`,
 * 180 s) — e o que sobrar fica para a próxima batida, para o disparo do
 * confirmar ou para `POST /api/confronto/rodar`.
 */
const COMECA_ELO_ATE_MS = 120_000;

/**
 * A batida do confronto. Disparada pelo cron da Vercel (`vercel.json`),
 * separada de `cron/diario` — mesma porta (`Authorization: Bearer
 * $CRON_SECRET` sob `/api/cron/`, autorizada pelo middleware, nunca checada
 * aqui).
 *
 * Processa a fila em elos sequenciais. **Todos os elos dividem o mesmo prazo**,
 * contado do começo da batida (5.2): cada elo agora tem chamadas de até três
 * minutos, e um prazo por elo deixaria o último passar dos 300 s da função.
 */
export async function GET() {
  const comeco = Date.now();
  const ate = comeco + PRAZO_DO_ELO_MS;
  let processados = 0;
  let elos = 0;

  try {
    while (Date.now() - comeco < COMECA_ELO_ATE_MS) {
      const r = await rodarElo(new Date(), ate);
      if (!r) break; // fila vazia
      processados += r.ids.length;
      elos++;
    }
    return NextResponse.json({ ok: true, processados, elos });
  } catch (e) {
    return erroDeInfra("cron-confronto", e);
  }
}
