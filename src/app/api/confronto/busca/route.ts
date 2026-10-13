import { NextResponse } from "next/server";
import { buscarAtomos } from "@/lib/chat";
import { erro, erroDeInfra } from "@/lib/rotas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** O que a busca da tela devolve: poucos, porque é para escolher um, não para ler. */
const ACHADOS_NA_TELA = 12;

/**
 * GET /api/confronto/busca?q=... — achar o átomo cujo radial eu quero abrir
 * (slice 5.2).
 *
 * **A mesma busca vetorial do chat** (`buscarAtomos`), com o mesmo piso: dois
 * jeitos de achar um trecho pelo sentido, com dois números para calibrar, seria
 * um a mais do que este sistema precisa.
 */
export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (q === "") return erro("busca vazia", 400);

  try {
    const r = await buscarAtomos({ texto: q.slice(0, 500) }, undefined, ACHADOS_NA_TELA);
    return NextResponse.json({
      achados: r.achados.map((a) => ({
        id: a.id,
        texto: a.texto,
        tipo: a.tipo,
        valido_em: a.valido_em,
      })),
      aviso: r.aviso ?? null,
    });
  } catch (e) {
    return erroDeInfra("confronto/busca", e);
  }
}
