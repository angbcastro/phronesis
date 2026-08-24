import { NextResponse } from "next/server";
import { criarSessao } from "@/lib/sessoes";

export const runtime = "nodejs";

/** POST /api/sessoes — cria (:Sessao {status:'gravando'}) e devolve o id. */
export async function POST() {
  const sessao = await criarSessao();
  return NextResponse.json({ id: sessao.id, iniciada_em: sessao.iniciada_em }, { status: 201 });
}
