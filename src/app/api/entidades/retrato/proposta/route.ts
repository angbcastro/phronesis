import { NextResponse } from "next/server";
import { atomosDaEntidade, CHAVE_EU } from "@/lib/enriquecimento";
import { RetratoError, pedirProposta } from "@/lib/retrato";
import { erro } from "@/lib/rotas";

export const runtime = "nodejs";

/** Uma chamada que lê todos os átomos do "eu": o mesmo teto das rotas que chamam modelo (§10). */
export const maxDuration = 300;

/**
 * POST /api/entidades/retrato/proposta — "pedir nova proposta" (slice 10).
 *
 * O agente `retrato-dimensoes` lê o mesmo prefixo das seções e propõe a lista
 * inteira. A proposta vai para `sugestao`, **ao lado** da lista atual, e nada
 * muda sem eu aceitar. A resposta espera: é um botão, e eu estou olhando.
 */
export async function POST() {
  try {
    const config = await pedirProposta(await atomosDaEntidade(CHAVE_EU));
    return NextResponse.json({ config });
  } catch (e) {
    if (e instanceof RetratoError) return erro(e.message, 400);
    console.error("[retrato-proposta]", e);
    return erro(e instanceof Error ? e.message : "não consegui pedir a proposta", 502);
  }
}
