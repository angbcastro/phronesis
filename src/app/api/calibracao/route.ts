import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { carregarIndice, marcarVisita } from "@/lib/calibracao";
import { erroDeInfra } from "@/lib/rotas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/calibracao — o índice de correções, para a tela de calibração.
 *
 * Marca `visitado_em = agora` como **efeito colateral best-effort**, no
 * `waitUntil`: é a carga de verdade desta tela que reseta o relógio da
 * sugestão, e não a consulta pura de `/sugestao`, para a sugestão ter chance de
 * valer os 21 dias inteiros. Falhar em marcar não pode custar a leitura — no
 * pior caso a sugestão acende de novo antes da hora.
 */
export async function GET() {
  try {
    const indice = await carregarIndice();

    waitUntil(
      marcarVisita().catch((e) => {
        console.error("[calibracao] não consegui marcar a visita:", e);
      }),
    );

    return NextResponse.json({
      correcoes: indice.correcoes,
      regras_correntes: indice.regras_correntes,
      visitado_em: indice.visitado_em,
      atualizado_em: indice.atualizado_em,
    });
  } catch (e) {
    return erroDeInfra("calibracao", e);
  }
}
