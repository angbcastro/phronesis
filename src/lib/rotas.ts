/** Utilitários compartilhados pelas rotas da API. */
import { NextResponse } from "next/server";
import { idValido } from "./chaves";
import { descricaoDeRede } from "./rede";

export const erro = (mensagem: string, status: number) =>
  NextResponse.json({ erro: mensagem }, { status });

/**
 * Neo4j ou R2 fora do ar: 502, com a causa no log e uma frase na tela.
 *
 * `fetch` falho vira `TypeError: fetch failed`, que não diz nada a quem está
 * olhando; `descricaoDeRede` cava o `cause` e devolve o que de fato aconteceu.
 * Rota sem este tratamento deixa o erro subir cru e o Next responde 500 com
 * stack de undici — parece defeito do sistema quando é a rede.
 */
export function erroDeInfra(rotulo: string, e: unknown): NextResponse {
  console.error(`[${rotulo}]`, e);
  const mensagem =
    descricaoDeRede(e) ?? (e instanceof Error ? e.message : "não consegui falar com o serviço");
  return erro(mensagem, 502);
}

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
