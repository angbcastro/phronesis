import { NextResponse } from "next/server";
import { marcarCliente, marcasDoCorpo, medidasDaSessao } from "@/lib/medidas";
import { erroDeInfra, parametros } from "@/lib/rotas";
import { ehCaminhoDeEntrada } from "@/lib/tipos";
import type { CaminhoDeEntrada } from "@/lib/tipos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * As três marcas que **só o navegador sabe dar** (slice 8).
 *
 * O número desta fatia é do toque em parar até a revisão abrir, e nenhum desses
 * dois instantes existe no servidor: o primeiro acontece antes de qualquer
 * requisição sair, o segundo depois de todas terem voltado. Por isso o cliente
 * marca, e esta rota — a menor do sistema — só guarda o que ele marcou.
 *
 * Os três instantes vêm do **mesmo relógio**, o do navegador, e é entre eles
 * que a subtração acontece. Nada aqui compara marca de cliente com instante de
 * servidor: os passos do servidor são gravados como duração, nunca como
 * carimbo, justamente para essa conta não ser possível.
 *
 * Epoch em ms e não ISO: é o formato que `Date.now()` dá, e converter duas
 * vezes só criaria dois lugares para errar fuso.
 *
 * **Toda marca reescreve a linha do índice** (`fecharLinha`), porque é a marca
 * da revisão aberta que completa o número — e `juntarLinha` substitui a linha
 * daquela sessão em vez de acrescentar uma segunda.
 *
 * **POST** — o cliente manda o que marcou. Corpo sem marca plausível não grava
 * nada: não é erro dele, é uma marca que chegou tarde ou de uma aba que já não
 * sabe de nada, e gravar um objeto por isso seria escrever por escrever.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const p = parametros(await ctx.params);
  if (!p.ok) return p.resposta;
  const { id } = p;

  const corpo = (await req.json().catch(() => ({}))) as { caminho?: unknown };
  const marcas = marcasDoCorpo(corpo);
  const caminho: CaminhoDeEntrada | undefined = ehCaminhoDeEntrada(corpo.caminho)
    ? corpo.caminho
    : undefined;

  // Nada válido no corpo: não é erro do cliente, é uma marca que chegou tarde
  // demais ou de uma aba que já não sabe de nada. Gravar um objeto por isso
  // seria escrever por escrever.
  if (Object.keys(marcas).length === 0) return NextResponse.json({ ok: true, marcas: 0 });

  try {
    const m = await marcarCliente(id, marcas, caminho);
    return NextResponse.json({ ok: true, marcas: Object.keys(marcas).length, cliente: m.cliente });
  } catch (e) {
    return erroDeInfra(`sessoes/${id}/medidas`, e);
  }
}

/**
 * GET — o detalhe daquela sessão, sob demanda.
 *
 * **Não há tela nesta fatia**: quando eu quiser olhar, eu peço, e é por aqui.
 * Sem esta rota o objeto seria alcançável só pelo console do R2, porque `r2.ts`
 * não tem `LIST` e nada em tela nenhuma monta essa chave. Se a leitura virar
 * hábito, a tela vira item da pauta (8.4).
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const p = parametros(await ctx.params);
  if (!p.ok) return p.resposta;

  try {
    const m = await medidasDaSessao(p.id);
    if (!m) return NextResponse.json({ erro: "essa sessão não foi medida" }, { status: 404 });
    return NextResponse.json(m);
  } catch (e) {
    return erroDeInfra(`sessoes/${p.id}/medidas`, e);
  }
}
