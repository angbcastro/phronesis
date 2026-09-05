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
 * `transcricao.json` e emendar na extração, que grava `extracao.json` e deixa
 * a sessão em `em_revisao`. A tela acompanha por polling.
 *
 * Chamar duas vezes não reprocessa nada em cima do resultado pronto. Numa
 * sessão que já transcreveu mas ainda não extraiu, a segunda chamada é o retry
 * da extração — é por aqui que se recupera um `waitUntil` perdido.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const p = parametros(await ctx.params);
  if (!p.ok) return p.resposta;
  const { id } = p;

  const sessao = await buscarSessao(id);
  if (!sessao) return erro("sessão não encontrada", 404);

  if (sessao.status === "em_revisao" || sessao.status === "confirmada") {
    return NextResponse.json({ status: sessao.status, ja_finalizada: true });
  }

  const corpo = (await req.json().catch(() => ({}))) as { duracao_s?: number };
  const duracao_s =
    typeof corpo.duracao_s === "number" && corpo.duracao_s > 0
      ? Math.round(corpo.duracao_s)
      : sessao.duracao_s;

  await atualizarSessao(id, { status: "finalizando", duracao_s }, [
    "gravando",
    "finalizando",
    "erro",
  ]);

  waitUntil(
    finalizarSessao(id).catch((e) => {
      console.error(`[finalizar] sessão ${id} falhou:`, e);
      // Menos `confirmada`, que é terminal: uma sessão já no grafo não vira
      // falha porque um objeto do R2 sumiu. Mesma guarda das três escritas de
      // `erro` em `pipeline.ts`.
      return atualizarSessao(id, { status: "erro" }, [
        "gravando",
        "finalizando",
        "transcrevendo",
        "transcrito",
        "extraindo",
        "em_revisao",
        "erro",
      ]);
    }),
  );

  return NextResponse.json({ status: "finalizando" });
}
