import { NextResponse } from "next/server";
import { ExclusaoBloqueada, excluirEntidade, FusaoError } from "@/lib/fusao";
import { erro } from "@/lib/rotas";

export const runtime = "nodejs";

/**
 * POST /api/entidades/excluir — `{ chave }`.
 *
 * Apaga o nó de vez (`excluirEntidade`): a segunda exceção à regra 6. Entidade
 * que é sujeito de algum átomo é recusada com 409 — o conserto é fundir, e a
 * mensagem diz isso. A trava mora no servidor, e não no botão.
 */
export async function POST(req: Request) {
  const corpo = (await req.json().catch(() => null)) as { chave?: unknown } | null;
  const chave = typeof corpo?.chave === "string" ? corpo.chave : "";
  if (chave.trim() === "") return erro("corpo inválido: espera { chave }", 400);

  try {
    return NextResponse.json(await excluirEntidade(chave));
  } catch (e) {
    if (e instanceof ExclusaoBloqueada) return erro(e.message, 409);
    if (e instanceof FusaoError) return erro(e.message, 400);
    console.error("[excluir entidade]", e);
    return erro(e instanceof Error ? e.message : "não consegui excluir", 502);
  }
}
