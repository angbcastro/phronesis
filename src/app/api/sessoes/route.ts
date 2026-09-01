import { NextResponse } from "next/server";
import { criarSessao, todasSessoes } from "@/lib/sessoes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/sessoes — todas as sessões, da mais recente à mais antiga.
 *
 * Alimenta a lista de `/sessoes`. Sessão sem bloco nenhum não entra: foi criada
 * e largada antes de gravar, e não é áudio nenhum.
 */
export async function GET() {
  const sessoes = await todasSessoes();
  return NextResponse.json({
    sessoes: sessoes
      .filter((s) => s.chunks_total > 0 || s.status === "gravando")
      .map((s) => ({
        id: s.id,
        iniciada_em: s.iniciada_em,
        duracao_s: s.duracao_s,
        status: s.status,
        chunks_total: s.chunks_total,
      })),
  });
}

/** POST /api/sessoes — cria (:Sessao {status:'gravando'}) e devolve o id. */
export async function POST() {
  const sessao = await criarSessao();
  return NextResponse.json({ id: sessao.id, iniciada_em: sessao.iniciada_em }, { status: 201 });
}
