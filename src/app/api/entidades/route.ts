import { NextResponse } from "next/server";
import { listarEntidades } from "@/lib/entidades";
import { erroDeInfra } from "@/lib/rotas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/entidades — o que está no grafo, para a tela de manutenção.
 *
 * Só leitura. Nó fundido não vem como linha própria: ele aparece como alias do
 * vencedor, que é o que faz a lista mostrar o grafo como ele vale hoje e ainda
 * assim guardar o histórico do nome.
 */
export async function GET() {
  try {
    return NextResponse.json({ entidades: await listarEntidades() });
  } catch (e) {
    return erroDeInfra("entidades", e);
  }
}
