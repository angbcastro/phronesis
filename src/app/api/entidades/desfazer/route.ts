import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { passadaDeVetores } from "@/lib/entidades";
import { EnriquecimentoError, desfazerFicha } from "@/lib/enriquecimento";
import { erro } from "@/lib/rotas";

export const runtime = "nodejs";

/**
 * POST /api/entidades/desfazer — `{ chave }`.
 *
 * **O contrapeso do "escreve sozinho"** (slice 4.12). O lote grava a ficha sem
 * eu ver antes; esta rota volta os quatro campos de uma vez, e é o que
 * substituiu a tela de aprovação em lote que a entrevista recusou.
 *
 * **Um toque, e não dois como o de apagar sessão**: ela restaura, não destrói. O
 * pior caso de um toque acidental é outro toque — a escrita é uma **troca**
 * (`desfazerFicha`), então o que estava na ficha vira a geração anterior e volta
 * no toque seguinte.
 *
 * Sem geração guardada, 400 com o motivo: inventar uma restauração vazia
 * apagaria a ficha atual contra quatro strings em branco.
 */
export async function POST(req: Request) {
  const corpo = (await req.json().catch(() => null)) as { chave?: unknown } | null;
  const chave = typeof corpo?.chave === "string" ? corpo.chave : "";
  if (chave === "") return erro("corpo inválido: espera { chave }", 400);

  try {
    const r = await desfazerFicha(chave);
    if (!r) return erro("esta entidade não tem geração anterior guardada", 400);

    // O padrão das rotas de entidade (4.8.1): os três campos de perfil são o que
    // mais mexe na string canônica, e desfazer os muda tanto quanto gravá-los.
    waitUntil(passadaDeVetores("desfazer"));
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    if (e instanceof EnriquecimentoError) return erro(e.message, 400);
    console.error("[desfazer]", e);
    return erro(e instanceof Error ? e.message : "não consegui desfazer", 502);
  }
}
