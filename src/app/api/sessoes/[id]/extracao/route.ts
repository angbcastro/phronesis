import { NextResponse } from "next/server";
import { chaveExtracaoAnterior } from "@/lib/chaves";
import { propostaAtual } from "@/lib/pipeline";
import { getJson } from "@/lib/r2";
import { buscarSessao } from "@/lib/sessoes";
import { erro, erroDeInfra, parametros } from "@/lib/rotas";
import type { Extracao } from "@/lib/tipos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/sessoes/:id/extracao — a proposta, para a tela de revisão.
 *
 * Vai junto o mapa de blocos da transcrição: é ele que traduz o offset
 * absoluto de um trecho para "bloco N, segundo M", que é o que o player
 * precisa. Sessão gravada tem um bloco a cada 30 s; sessão importada tem um
 * bloco só, cobrindo tudo — o mapa resolve os dois sem caso especial.
 *
 * **Desde a slice 8.2 ela serve também o que ainda está crescendo.** Antes, só
 * `extracao.json` contava: enquanto ele não existisse, a resposta era 404 e o
 * acumulado das janelas ficava escondido no `parcial.json`. Agora quem monta a
 * resposta é `propostaAtual`, e o 404 passou a significar exatamente **"zero
 * átomos ainda"** — a única condição em que a tela de processamento continua
 * sendo a ponte. Quando a resposta vem de um parcial, `crescendo` é `true` e
 * `trechos_totais`/`trechos_faltando` dizem quanto falta; é o que o rodapé da
 * revisão mostra e o que trava o confirmar.
 *
 * **`anterior` vem como cabeçalho, não como lista** (slice 4.6). Existe uma
 * proposta anterior quando eu já forcei uma re-extração daquela sessão, e o que
 * a revisão precisa saber de cara é só se ela existe e de que versão do prompt
 * é — a lista inteira dobraria o payload desta tela para um caso raro. Quem
 * quer os átomos antigos pede `?anterior=1`, que é o que o toggle faz, e só
 * esse caminho paga a leitura do objeto inteiro.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const p = parametros(await ctx.params);
  if (!p.ok) return p.resposta;

  const querListaAnterior = new URL(req.url).searchParams.get("anterior") === "1";

  try {
    // As buscas são independentes e vão em paralelo: em série, esta tela custava
    // a soma de idas à rede, e em link ruim isso são vinte segundos de espera
    // antes de qualquer pixel.
    const [sessao, atual, anterior] = await Promise.all([
      buscarSessao(p.id),
      propostaAtual(p.id),
      querListaAnterior ? getJson<Extracao>(chaveExtracaoAnterior(p.id)) : null,
    ]);

    if (!sessao) return erro("sessão não encontrada", 404);
    if (!atual) {
      return erro(`sessão em '${sessao.status}': ainda não há proposta de extração`, 404);
    }

    return NextResponse.json({
      status: sessao.status,
      iniciada_em: sessao.iniciada_em,
      duracao_s: sessao.duracao_s,
      extracao: atual.extracao,
      blocos: atual.blocos,
      crescendo: atual.crescendo,
      trechos_totais: atual.trechos_totais,
      trechos_faltando: atual.trechos_faltando,
      anterior: atual.anterior
        ? {
            ...atual.anterior,
            // Só quando pedida: é a metade cara da resposta.
            ...(anterior ? { lista: anterior.valor.atomos } : {}),
          }
        : null,
    });
  } catch (e) {
    return erroDeInfra("extracao", e);
  }
}
