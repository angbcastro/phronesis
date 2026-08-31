import { NextResponse } from "next/server";
import { normalizarTipoEntidade } from "@/lib/entidades";
import { criarEntidade, FusaoError } from "@/lib/fusao";
import { erro } from "@/lib/rotas";

export const runtime = "nodejs";

/**
 * POST /api/entidades/criar — `{ nome, tipo }`.
 *
 * A exceção deliberada à regra 5. Nada entra no grafo sem a minha confirmação —
 * e é exatamente isso que esta rota é: eu digitando o nome e apertando criar,
 * sem modelo nenhum no meio. O que a regra proíbe é o **pipeline** gravar sem
 * passar por mim, e aqui não há pipeline.
 *
 * Cria nó órfão de propósito: entidade sem átomo, esperando a primeira vez que
 * eu falar o nome. É o único jeito de o vocabulário do STT conhecer um nome
 * antes da primeira menção, que é quando ele mais erra.
 */
export async function POST(req: Request) {
  const corpo = (await req.json().catch(() => null)) as {
    nome?: unknown;
    tipo?: unknown;
  } | null;

  const nome = typeof corpo?.nome === "string" ? corpo.nome : "";
  const tipo = normalizarTipoEntidade(corpo?.tipo) ?? "Pessoa";
  if (nome.trim() === "") return erro("corpo inválido: espera { nome, tipo }", 400);

  try {
    return NextResponse.json(await criarEntidade(nome, tipo));
  } catch (e) {
    if (e instanceof FusaoError) return erro(e.message, 400);
    console.error("[criar entidade]", e);
    return erro(e instanceof Error ? e.message : "não consegui criar", 502);
  }
}
