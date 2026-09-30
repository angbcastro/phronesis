import { NextResponse } from "next/server";
import {
  RetratoError,
  aceitarSugestao,
  descartarSugestao,
  gravarDimensoes,
} from "@/lib/retrato-dimensoes";
import { erro, erroDeInfra } from "@/lib/rotas";

export const runtime = "nodejs";

/**
 * POST /api/entidades/retrato/dimensoes — três corpos, um gesto cada (slice 10).
 *
 * ```
 * { dimensoes: [{ id?, nome, o_que_entra }] }   a lista inteira, na ordem
 * { aceitar: true }                             a sugestão vira a lista
 * { descartar: true }                           a sugestão some
 * ```
 *
 * **Quem dá id é o servidor** (`limparDimensoesDaTela`): o que veio e casa com
 * o formato é mantido — é assim que renomear preserva a seção —, e dimensão
 * nova ganha um pelo nome, nunca `agora`. Escrita por etag: a proposta do
 * agente escreve no mesmo arquivo.
 *
 * Nada aqui chama modelo nem mexe no retrato escrito: a seção de uma dimensão
 * nova aparece na próxima rodada, e a de uma removida some dela.
 */
export async function POST(req: Request) {
  const corpo = (await req.json().catch(() => null)) as {
    dimensoes?: unknown;
    aceitar?: unknown;
    descartar?: unknown;
  } | null;

  try {
    if (corpo?.aceitar === true) return NextResponse.json({ config: await aceitarSugestao() });
    if (corpo?.descartar === true) return NextResponse.json({ config: await descartarSugestao() });
    if (Array.isArray(corpo?.dimensoes)) {
      return NextResponse.json({ config: await gravarDimensoes(corpo.dimensoes) });
    }
    return erro("corpo inválido: espera { dimensoes }, { aceitar } ou { descartar }", 400);
  } catch (e) {
    if (e instanceof RetratoError) return erro(e.message, 400);
    return erroDeInfra("retrato-dimensoes", e);
  }
}
