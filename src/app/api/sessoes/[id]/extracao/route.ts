import { NextResponse } from "next/server";
import { chaveExtracao, chaveTranscricao } from "@/lib/chaves";
import { getJson } from "@/lib/r2";
import { buscarSessao } from "@/lib/sessoes";
import { erro, parametros } from "@/lib/rotas";
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
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const p = parametros(await ctx.params);
  if (!p.ok) return p.resposta;

  const sessao = await buscarSessao(p.id);
  if (!sessao) return erro("sessão não encontrada", 404);

  const proposta = await getJson<Extracao>(chaveExtracao(p.id));
  if (!proposta) {
    return erro(`sessão em '${sessao.status}': ainda não há proposta de extração`, 404);
  }

  const transcricao = await getJson<Transcricao>(chaveTranscricao(p.id));

  return NextResponse.json({
    status: sessao.status,
    iniciada_em: sessao.iniciada_em,
    duracao_s: sessao.duracao_s,
    extracao: proposta.valor,
    blocos: transcricao?.valor.blocos ?? [],
  });
}
