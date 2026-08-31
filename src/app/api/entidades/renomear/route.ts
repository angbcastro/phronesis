import { NextResponse } from "next/server";
import { FusaoError, renomear } from "@/lib/fusao";
import { ehPronome, normalizarNome } from "@/lib/texto";
import { erro } from "@/lib/rotas";

export const runtime = "nodejs";

/**
 * POST /api/entidades/renomear — `{ chave, nome }`.
 *
 * A grafia velha vira alias do nome novo, então "meu pai" dito outra vez cai no
 * nó do nome de verdade em vez de criar um segundo. É o que fecha o limite que
 * existia desde a slice 2.
 *
 * A guarda de pronome vale aqui como vale no confirmar: a regra não pode
 * depender de a tela ter sido usada.
 */
export async function POST(req: Request) {
  const corpo = (await req.json().catch(() => null)) as {
    chave?: unknown;
    nome?: unknown;
  } | null;

  const chave = typeof corpo?.chave === "string" ? corpo.chave : "";
  const nome = typeof corpo?.nome === "string" ? corpo.nome.trim() : "";
  if (chave === "" || nome === "") return erro("corpo inválido: espera { chave, nome }", 400);

  if (ehPronome(normalizarNome(nome))) {
    return erro(`"${nome}" é um pronome, não um nome`, 400);
  }

  try {
    await renomear(chave, nome);
    return NextResponse.json({ ok: true, nome });
  } catch (e) {
    if (e instanceof FusaoError) return erro(e.message, 400);
    console.error("[renomear]", e);
    return erro(e instanceof Error ? e.message : "não consegui renomear", 502);
  }
}
