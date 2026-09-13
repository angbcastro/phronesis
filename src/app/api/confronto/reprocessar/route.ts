import { NextResponse } from "next/server";
import { reprocessarTudo } from "@/lib/confronto";
import { erroDeInfra } from "@/lib/rotas";

export const runtime = "nodejs";

/**
 * POST /api/confronto/reprocessar — o grafo inteiro volta para a fila.
 *
 * **Existe porque calibrar o prompt do confronto é o trabalho normal desta
 * fatia, não uma exceção** (slice 5.1): sem isto, um prompt novo só alcançaria
 * átomo novo, e as relações que eu já julguei à mão — o único gabarito que
 * este sistema tem — ficariam congeladas no prompt que as produziu.
 *
 * Apaga todas as relações de confronto e limpa o estado de todo átomo tocado;
 * é `desfazerConfronto` aplicado a todos, numa consulta só. **Não roda a fila**
 * — quem faz isso é `POST /api/confronto/rodar`, que a tela chama em seguida.
 *
 * Destrutivo e sem desfazer próprio; os dois toques ficam na tela, que é onde
 * o gesto acontece — mesmo lugar do apagar sessão em `/sessoes`.
 */
export async function POST() {
  try {
    const r = await reprocessarTudo();
    console.log(
      `[confronto] reprocessar: ${r.relacoes} relação(ões) apagada(s), ` +
        `${r.atomos} átomo(s) de volta à fila`,
    );
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return erroDeInfra("confronto/reprocessar", e);
  }
}
