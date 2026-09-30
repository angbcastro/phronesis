import { NextResponse } from "next/server";
import { TETO_IDS_FONTES, lerFontes } from "@/lib/retrato";
import { erro, erroDeInfra } from "@/lib/rotas";

export const runtime = "nodejs";

/**
 * POST /api/entidades/retrato/fontes — `{ ids }`: os átomos por trás do (i) de
 * uma seção (slice 10).
 *
 * Lidos do grafo **agora**, pelo id que a seção guardou quando foi escrita. O
 * átomo que depois foi rejeitado ou arquivado volta com o `status` — a tela o
 * risca, e não o esconde: o (i) diz o que sustentou a seção naquele momento.
 */
export async function POST(req: Request) {
  const corpo = (await req.json().catch(() => null)) as { ids?: unknown } | null;
  const ids = Array.isArray(corpo?.ids)
    ? corpo.ids.filter((i): i is string => typeof i === "string")
    : null;
  if (!ids) return erro("corpo inválido: espera { ids }", 400);
  if (ids.length > TETO_IDS_FONTES) return erro(`no máximo ${TETO_IDS_FONTES} ids`, 400);

  try {
    return NextResponse.json({ fontes: await lerFontes(ids) });
  } catch (e) {
    return erroDeInfra("retrato-fontes", e);
  }
}
