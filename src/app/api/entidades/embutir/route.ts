import { NextResponse } from "next/server";
import { garantirEmbeddings } from "@/lib/entidades";
import { erroDeInfra } from "@/lib/rotas";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/entidades/embutir — põe em dia o vetor das entidades.
 *
 * A entidade é a metade do vetor que **muda**: o texto de um átomo confirmado
 * não se mexe mais (deleção é soft, regra 6), mas o perfil de uma pessoa eu
 * reescrevo, o nome eu troco, e uma fusão acrescenta alias. Por isso aqui a
 * trava não é "sem vetor", é `embedding_fonte` — o hash da string canônica.
 *
 * **É o que dispensa gancho nas cinco rotas que mexem em entidade.** Nem
 * `/perfil`, nem `/renomear`, nem `/fundir`, nem `/tipo`, nem `/criar` precisam
 * lembrar de invalidar coisa nenhuma: a string muda, o hash muda, esta rota
 * reembute. O desenho oposto seria mais um lugar onde alguém esquece — e vetor
 * velho não dá erro, dá vizinhança errada.
 *
 * Editar um perfil faz a entidade sair de dia e esta rota a refaz; não editar
 * nada devolve `embutidas: 0` (regra 4).
 */
export async function POST() {
  try {
    return NextResponse.json({ ok: true, ...(await garantirEmbeddings()) });
  } catch (e) {
    return erroDeInfra("entidades/embutir", e);
  }
}
