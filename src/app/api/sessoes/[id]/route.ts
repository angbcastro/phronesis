import { NextResponse } from "next/server";
import { chaveTranscricao, chavesDaSessao } from "@/lib/chaves";
import { carregarManifest } from "@/lib/manifest";
import { transcricaoParcial } from "@/lib/pipeline";
import { getJson, remover } from "@/lib/r2";
import { buscarSessao, descartarSessao } from "@/lib/sessoes";
import { temTranscricao, terminouDeProcessar } from "@/lib/estados";
import { erro, erroDeInfra, parametros } from "@/lib/rotas";
import type { Transcricao } from "@/lib/tipos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/sessoes/:id — estado + transcrição (parcial enquanto processa).
 * É o que o front busca de 2 em 2 segundos.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const p = parametros(await ctx.params);
  if (!p.ok) return p.resposta;

  const sessao = await buscarSessao(p.id);
  if (!sessao) return erro("sessão não encontrada", 404);

  const manifest = await carregarManifest(p.id);
  const base = {
    id: sessao.id,
    status: sessao.status,
    iniciada_em: sessao.iniciada_em,
    duracao_s: sessao.duracao_s,
    chunks_total: manifest.chunks.length,
    chunks_transcritos: manifest.chunks.filter((c) => c.transcrito).length,
    proximo_chunk: manifest.chunks.reduce((max, c) => Math.max(max, c.i + 1), 0),
  };

  // `completa` é sobre a transcrição, não sobre a sessão: em `extraindo` e
  // `em_revisao` o texto já está pronto e a tela de leitura pode parar o
  // polling — a extração corre atrás dela.
  if (temTranscricao(sessao.status)) {
    const pronta = await getJson<Transcricao>(chaveTranscricao(p.id));
    if (pronta) {
      return NextResponse.json({
        ...base,
        completa: true,
        texto: pronta.valor.texto,
        blocos: pronta.valor.blocos,
      });
    }
  }

  const parcial = await transcricaoParcial(p.id);
  return NextResponse.json({ ...base, completa: false, texto: parcial.texto });
}

/**
 * DELETE /api/sessoes/:id — apaga o material da sessão e tira ela da lista.
 *
 * Existe porque calibrar gera sessão de teste, e uma sessão de 17 min fatiada
 * são trinta e cinco objetos no R2: limpar à mão no console não é caminho.
 *
 * **O grafo fica intacto** (regra 6): o nó `:Sessao` continua lá, marcado com
 * `descartada_em`, e os átomos que ele gerou também. O que some é o material no
 * R2 — e é por isso que `audio_key` de uma sessão descartada passa a apontar
 * para o vazio. Consequência aceita, não descuido.
 */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const p = parametros(await ctx.params);
  if (!p.ok) return p.resposta;

  const sessao = await buscarSessao(p.id);
  if (!sessao) return erro("sessão não encontrada", 404);

  // A guarda. Apagar no meio do pipeline correria com um `waitUntil` vivo, que
  // voltaria a gravar o que acabou de sumir — e aí sobra um objeto órfão de uma
  // sessão que já saiu da lista, inalcançável para sempre.
  if (!terminouDeProcessar(sessao.status)) {
    return erro(`sessão em '${sessao.status}': ainda está processando`, 409);
  }

  try {
    const manifest = await carregarManifest(p.id);
    // Em ordem, e o manifest por último: ele é quem enumera os blocos, e
    // `r2.ts` não tem `LIST` para reencontrá-los se ele sumir primeiro.
    for (const key of chavesDaSessao(manifest)) await remover(key);

    await descartarSessao(p.id);
    console.warn(`[sessao] ${p.id} descartada — ${manifest.chunks.length} bloco(s) apagados`);
    return NextResponse.json({ id: p.id, descartada: true });
  } catch (e) {
    return erroDeInfra("sessao DELETE", e);
  }
}
