/** Utilitários compartilhados pelas rotas da API. */
import { NextResponse } from "next/server";
import { idValido } from "./chaves";

export const erro = (mensagem: string, status: number) =>
  NextResponse.json({ erro: mensagem }, { status });

/** Valida `id` e `i` da URL antes de qualquer acesso a R2 ou Neo4j. */
export function parametros(params: { id: string; i?: string }):
  | { ok: true; id: string; i: number }
  | { ok: false; resposta: NextResponse } {
  const { id } = params;
  if (!idValido(id)) return { ok: false, resposta: erro("id de sessão inválido", 400) };

  let i = -1;
  if (params.i !== undefined) {
    i = Number(params.i);
    if (!Number.isInteger(i) || i < 0 || i > 999_999) {
      return { ok: false, resposta: erro("índice de bloco inválido", 400) };
    }
  }
  return { ok: true, id, i };
}
