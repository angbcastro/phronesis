import { NextResponse } from "next/server";
import { idValido } from "@/lib/chaves";
import { apagarConversa, arquivarConversa } from "@/lib/conversas";
import { erro, erroDeInfra } from "@/lib/rotas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH /api/conversas/:id — `{ arquivada: boolean }`.
 *
 * Arquivar **congela**: a conversa sai da lista principal, não aceita mensagem
 * nova (`POST /api/chat` recusa com 409) e continua legível no separador de
 * arquivadas. Desarquivar é o mesmo gesto com `false` — e é por isso que é um
 * booleano no corpo, e não duas rotas: as duas direções são a mesma decisão.
 *
 * **Arquivar não é apagar, e nenhum dos dois esconde o outro.** O pedido da
 * entrevista foi ter as duas ações, distintas e visíveis na mesma linha.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!idValido(id)) return erro("id de conversa inválido", 400);

  const corpo = (await req.json().catch(() => null)) as { arquivada?: unknown } | null;
  if (typeof corpo?.arquivada !== "boolean") {
    return erro("corpo inválido: espera { arquivada: boolean }", 400);
  }

  try {
    const conversa = await arquivarConversa(id, corpo.arquivada);
    if (!conversa) return erro("conversa não encontrada", 404);
    return NextResponse.json({ conversa });
  } catch (e) {
    return erroDeInfra("conversa PATCH", e);
  }
}

/**
 * DELETE /api/conversas/:id — apaga de vez: o nó e o objeto de mensagens.
 *
 * **A única deleção de verdade deste sistema**, e ela é deliberada. A regra 6
 * do CLAUDE.md proíbe `DELETE` em átomo; conversa não é átomo — nenhum átomo
 * perde procedência quando ela some, nada do grafo depende dela, e a migration
 * 012 escreve isso por extenso. Quem quer só congelar usa o `PATCH` acima.
 *
 * Idempotente: apagar o que já não está lá responde 404 sem estragar nada, e
 * `remover` (r2.ts) já trata 404 do R2 como sucesso.
 */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!idValido(id)) return erro("id de conversa inválido", 400);

  try {
    const apagada = await apagarConversa(id);
    if (!apagada) return erro("conversa não encontrada", 404);
    console.warn(`[conversa] ${id} apagada — nó e mensagens`);
    return NextResponse.json({ id, apagada: true });
  } catch (e) {
    return erroDeInfra("conversa DELETE", e);
  }
}
