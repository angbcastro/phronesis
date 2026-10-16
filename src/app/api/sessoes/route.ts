import { NextResponse } from "next/server";
import { chaveExtracao } from "@/lib/chaves";
import { getJson } from "@/lib/r2";
import {
  apareceNaLista,
  contarSessoes,
  criarSessao,
  paginaDeSessoes,
  primeiroItem,
  type SessaoNaLista,
} from "@/lib/sessoes";
import { erro, erroDeInfra } from "@/lib/rotas";
import type { Extracao } from "@/lib/tipos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A frase e a contagem de uma sessão em revisão: os átomos estão na proposta,
 * e não no grafo. Uma leitura do R2 por sessão em revisão — poucas, que a
 * revisão é o estado de passagem. A falha de uma não derruba a lista: a linha
 * fica sem frase.
 */
async function comProposta(s: SessaoNaLista): Promise<SessaoNaLista> {
  if (s.status !== "em_revisao") return s;
  try {
    const o = await getJson<Extracao>(chaveExtracao(s.id));
    if (!o) return s;
    const atomos = o.valor.atomos ?? [];
    return { ...s, frase: primeiroItem(atomos), itens: atomos.length };
  } catch (e) {
    console.error(`[sessoes] ${s.id}: não li a proposta para a linha`, e);
    return s;
  }
}

/**
 * GET /api/sessoes — uma página da lista, da mais recente à mais antiga.
 *
 * `?antes=<iniciada_em>` traz as `LIMITE_LISTA_SESSOES` anteriores a esse
 * instante; a tela pede a próxima quando a rolagem chega ao fim. `mais` e
 * `cursor` vêm da leitura crua (`paginaDeSessoes`); `total`, só na primeira.
 * Cada sessão traz `frase` e `itens` — a linha começa pelo que eu disse.
 */
export async function GET(req: Request) {
  const antes = new URL(req.url).searchParams.get("antes");
  if (antes !== null && Number.isNaN(Date.parse(antes))) {
    return erro("antes tem de ser um instante", 400);
  }

  try {
    const [pagina, total] = await Promise.all([
      paginaDeSessoes(antes),
      antes === null ? contarSessoes() : null,
    ]);
    const sessoes = await Promise.all(pagina.sessoes.filter(apareceNaLista).map(comProposta));
    return NextResponse.json({
      sessoes: sessoes.map((s) => ({
        id: s.id,
        iniciada_em: s.iniciada_em,
        duracao_s: s.duracao_s,
        status: s.status,
        chunks_total: s.chunks_total,
        frase: s.frase,
        itens: s.itens,
      })),
      mais: pagina.mais,
      cursor: pagina.cursor,
      ...(total === null ? {} : { total }),
    });
  } catch (e) {
    return erroDeInfra("sessoes", e);
  }
}

/** POST /api/sessoes — cria (:Sessao {status:'gravando'}) e devolve o id. */
export async function POST() {
  try {
    const sessao = await criarSessao();
    return NextResponse.json({ id: sessao.id, iniciada_em: sessao.iniciada_em }, { status: 201 });
  } catch (e) {
    return erroDeInfra("sessoes", e);
  }
}
