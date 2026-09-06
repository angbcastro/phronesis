import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { normalizarTipoEntidade, passadaDeVetores } from "@/lib/entidades";
import { FusaoError, trocarTipo } from "@/lib/fusao";
import { erro } from "@/lib/rotas";

export const runtime = "nodejs";

/**
 * POST /api/entidades/tipo — `{ chave, tipo }`.
 *
 * O tipo só era editável enquanto a entidade era nova, na revisão. Depois disso
 * ela vira `conhecida` e a revisão a mostra fixa — o que estava certo para o
 * nome (o grafo vence sobre o extrator) e deixava o label errado sem conserto.
 */
export async function POST(req: Request) {
  const corpo = (await req.json().catch(() => null)) as {
    chave?: unknown;
    tipo?: unknown;
  } | null;

  const chave = typeof corpo?.chave === "string" ? corpo.chave : "";
  const tipo = normalizarTipoEntidade(corpo?.tipo);
  if (chave === "") return erro("corpo inválido: espera { chave, tipo }", 400);
  if (!tipo) return erro(`tipo inválido: ${JSON.stringify(corpo?.tipo)}`, 400);

  try {
    await trocarTipo(chave, tipo);
    // O tipo entra na string canônica da entidade (4.8.1).
    waitUntil(passadaDeVetores("tipo"));
    return NextResponse.json({ ok: true, tipo });
  } catch (e) {
    if (e instanceof FusaoError) return erro(e.message, 400);
    console.error("[tipo]", e);
    return erro(e instanceof Error ? e.message : "não consegui trocar o tipo", 502);
  }
}
