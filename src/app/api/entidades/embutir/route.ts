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
 * **Nenhuma rota precisa invalidar coisa nenhuma**: a string muda, o hash muda,
 * a próxima passada reembute. O que mudou na 4.8.1 é quem faz essa passada
 * acontecer — `/perfil`, `/renomear`, `/fundir`, `/tipo`, `/criar` e o confirmar
 * disparam `passadaDeVetores()` em `waitUntil`, porque **esta rota aqui nenhuma
 * tela chama**: enquanto ela era a única chamadora, a "próxima passada" não
 * existia e entidade nascida num confirmar ficava sem vetor para sempre.
 *
 * Ela continua existindo, e para duas coisas: o retrofill (trocar
 * `EMBEDDING_MODEL` põe o grafo inteiro de volta na fila) e o conserto à mão
 * quando um gancho tiver falhado — esquecer uma passada custa atraso, não vetor
 * velho, porque quem decide é o hash.
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
