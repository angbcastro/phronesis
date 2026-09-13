import { NextResponse } from "next/server";
import { recentes, tamanhoDaFilaDeConfronto } from "@/lib/confronto";
import { erroDeInfra } from "@/lib/rotas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/confronto — o que a tela de `/confronto` mostra: quantos átomos
 * ainda esperam, e os últimos que a varredura tocou.
 *
 * Só leitura. Quem faz a fila andar é `POST /api/confronto/rodar` e o cron.
 */
export async function GET() {
  try {
    const [fila, recentesLidos] = await Promise.all([tamanhoDaFilaDeConfronto(), recentes()]);
    return NextResponse.json({ fila, recentes: recentesLidos });
  } catch (e) {
    return erroDeInfra("confronto", e);
  }
}
