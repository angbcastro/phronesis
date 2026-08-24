import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { finalizarSessao } from "@/lib/pipeline";
import { atualizarSessao, buscarSessao } from "@/lib/sessoes";
import { erro, parametros } from "@/lib/rotas";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/sessoes/:id/finalizar
 *
 * Marca `finalizando`, responde na hora e fecha a sessão em `waitUntil`:
 * esperar os blocos pendentes, concatenar com offsets absolutos, gravar
 * `transcricao.json` e ir para `transcrito`. A tela acompanha por polling.
 *
 * Chamar duas vezes não reprocessa nada em cima do resultado pronto.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const p = parametros(await ctx.params);
  if (!p.ok) return p.resposta;
  const { id } = p;

  const sessao = await buscarSessao(id);
  if (!sessao) return erro("sessão não encontrada", 404);

  if (sessao.status === "transcrito") {
    return NextResponse.json({ status: "transcrito", ja_finalizada: true });
  }

  const corpo = (await req.json().catch(() => ({}))) as { duracao_s?: number };
  const duracao_s =
    typeof corpo.duracao_s === "number" && corpo.duracao_s > 0
      ? Math.round(corpo.duracao_s)
      : sessao.duracao_s;

  await atualizarSessao(id, { status: "finalizando", duracao_s }, [
    "gravando",
    "finalizando",
    "abandonada",
    "erro",
  ]);

  waitUntil(
    finalizarSessao(id).catch((e) => {
      console.error(`[finalizar] sessão ${id} falhou:`, e);
      return atualizarSessao(id, { status: "erro" });
    }),
  );

  return NextResponse.json({ status: "finalizando" });
}
