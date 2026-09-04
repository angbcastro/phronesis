import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { carregarIndice, marcarVisita } from "@/lib/calibracao";
import { regras } from "@/lib/regras";
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
    // O arquivo de regras vai junto: a tela mostra o que está em vigor ao lado
    // do que eu corrigi, e sem isso "editar e apagar regra" precisaria de uma
    // segunda ida à rede para uma lista de no máximo doze linhas.
    const [indice, emVigor] = await Promise.all([carregarIndice(), regras()]);

    waitUntil(
      marcarVisita().catch((e) => {
        console.error("[calibracao] não consegui marcar a visita:", e);
      }),
    );

    return NextResponse.json({
      correcoes: indice.correcoes,
      regras_correntes: indice.regras_correntes,
      regras: emVigor,
      visitado_em: indice.visitado_em,
      atualizado_em: indice.atualizado_em,
    });
  } catch (e) {
    return erroDeInfra("calibracao", e);
  }
}
