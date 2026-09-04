import { NextResponse } from "next/server";
import { chaveExtracao, chaveExtracaoAnterior, chaveTranscricao } from "@/lib/chaves";
import { getJson } from "@/lib/r2";
import { buscarSessao } from "@/lib/sessoes";
import { erro, erroDeInfra, parametros } from "@/lib/rotas";
import type { Extracao, Transcricao } from "@/lib/tipos";

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
 * As buscas são independentes e vão em paralelo: em série, esta tela custava a
 * soma de idas à rede, e em link ruim isso são vinte segundos de espera antes
 * de qualquer pixel.
 *
 * **`anterior` vem como cabeçalho, não como lista** (slice 4.6). Existe uma
 * proposta anterior quando eu já forcei uma re-extração daquela sessão, e o que
 * a revisão precisa saber de cara é só se ela existe e de que versão do prompt
 * é — a lista inteira dobraria o payload desta tela para um caso raro. Quem
 * quer os átomos antigos pede `?anterior=1`, que é o que o toggle faz.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const p = parametros(await ctx.params);
  if (!p.ok) return p.resposta;

  const querListaAnterior = new URL(req.url).searchParams.get("anterior") === "1";

  try {
    const [sessao, proposta, transcricao, anterior] = await Promise.all([
      buscarSessao(p.id),
      getJson<Extracao>(chaveExtracao(p.id)),
      getJson<Transcricao>(chaveTranscricao(p.id)),
      getJson<Extracao>(chaveExtracaoAnterior(p.id)),
    ]);

    if (!sessao) return erro("sessão não encontrada", 404);
    if (!proposta) {
      return erro(`sessão em '${sessao.status}': ainda não há proposta de extração`, 404);
    }

    return NextResponse.json({
      status: sessao.status,
      iniciada_em: sessao.iniciada_em,
      duracao_s: sessao.duracao_s,
      extracao: proposta.valor,
      blocos: transcricao?.valor.blocos ?? [],
      anterior: anterior
        ? {
            atomos: anterior.valor.atomos.length,
            prompt_version: anterior.valor.prompt_version,
            modelo: anterior.valor.modelo,
            criado_em: anterior.valor.criado_em,
            // Só quando pedida: é a metade cara da resposta.
            ...(querListaAnterior ? { lista: anterior.valor.atomos } : {}),
          }
        : null,
    });
  } catch (e) {
    return erroDeInfra("extracao", e);
  }
}
