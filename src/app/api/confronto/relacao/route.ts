import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { registrarCorrecaoDaRelacao } from "@/lib/calibracao";
import { idDeAtomoValido } from "@/lib/chaves";
import { ConfrontoError, editarRelacao } from "@/lib/confronto";
import { correcaoDeRelacao } from "@/lib/correcoes";
import { erro, erroDeInfra } from "@/lib/rotas";
import { ehAcaoNaRelacao } from "@/lib/tipos";

export const runtime = "nodejs";

/**
 * POST /api/confronto/relacao — a minha edição de uma relação, no radial de
 * `/confronto` (slice 5.2).
 *
 * `{ novo_id, velho_id, acao, valor }`, com `acao ∈ tipo | camada | motivo |
 * recusar`. A relação editada fica **congelada** — o agente nunca mais a toca;
 * a apagada vira recusa do par, e ele nunca mais o propõe.
 *
 * **A correção vai para o laço depois da resposta**, em `waitUntil`, como no
 * confirmar: a edição já está no grafo, e o que se perde numa falha do R2 é
 * material de calibração, não a edição. O `catch` engole pelo mesmo motivo.
 *
 * Um toque, sem confirmação: trocar tipo, camada ou motivo se desfaz voltando
 * ao valor anterior. Apagar não se desfaz pela tela — e é por isso que a tela
 * pede dois toques para ele, não esta rota.
 */
export async function POST(req: Request) {
  const corpo = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const novoId = corpo?.novo_id;
  const velhoId = corpo?.velho_id;
  const acao = corpo?.acao;
  const valor = typeof corpo?.valor === "string" ? corpo.valor : "";

  if (!idDeAtomoValido(novoId) || !idDeAtomoValido(velhoId) || !ehAcaoNaRelacao(acao)) {
    return erro("corpo inválido: espera { novo_id, velho_id, acao, valor }", 400);
  }

  try {
    const { antes, depois } = await editarRelacao(novoId, velhoId, acao, valor);

    const { correcao, voltou } = correcaoDeRelacao(antes, depois, acao, new Date().toISOString());
    waitUntil(
      registrarCorrecaoDaRelacao(correcao, voltou).catch((e) =>
        console.error(`[confronto/relacao] não consegui registrar a correção ${correcao.id}:`, e),
      ),
    );

    return NextResponse.json({ ok: true, relacao: depois });
  } catch (e) {
    if (e instanceof ConfrontoError) return erro(e.message, 400);
    return erroDeInfra("confronto/relacao", e);
  }
}
