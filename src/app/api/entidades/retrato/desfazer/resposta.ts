import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { passadaDeVetores } from "@/lib/entidades";
import {
  DesfazerPelaMetadeError,
  RetratoError,
  RetratoOcupadoError,
  desfazerRetrato,
} from "@/lib/retrato";
import { erro } from "@/lib/rotas";

/**
 * A resposta do desfazer do "eu" — um arquivo à parte porque duas rotas a
 * servem: `retrato/desfazer` e o desvio de `POST /api/entidades/desfazer`. Um
 * `route.ts` só pode exportar os handlers do Next.
 *
 * - 409 com a rodada em `rodando`: trocar agora misturaria duas gerações;
 * - 400 quando nenhum dos dois lados tem geração guardada;
 * - 502 quando o R2 trocou e o nó não — a mensagem diz qual lado trocou, e que
 *   tocar de novo não conserta (§14).
 */
export async function responderDesfazerDoEu(): Promise<NextResponse> {
  try {
    const r = await desfazerRetrato();
    if (!r.r2 && !r.no) {
      return erro('o "eu" não tem geração anterior guardada, nem no nó nem no retrato', 400);
    }
    // Os campos do nó mudaram, e o vetor do "eu" sai deles.
    if (r.no) waitUntil(passadaDeVetores("desfazer-retrato"));
    return NextResponse.json({ ok: true, r2: r.r2, no: r.no !== null, ...(r.no ?? {}) });
  } catch (e) {
    if (e instanceof RetratoOcupadoError) return erro(e.message, 409);
    if (e instanceof DesfazerPelaMetadeError) {
      console.error("[desfazer-retrato]", e);
      return erro(e.message, 502);
    }
    if (e instanceof RetratoError) return erro(e.message, 400);
    console.error("[desfazer-retrato]", e);
    return erro(e instanceof Error ? e.message : "não consegui desfazer", 502);
  }
}
