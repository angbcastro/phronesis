import { NextResponse } from "next/server";
import { comInvocacao } from "@/lib/invocacao";
import { comMedicao } from "@/lib/medidas";
import { SemPropostaFechadaError, pedir } from "@/lib/pedidos";
import { PRAZO_DA_FUNCAO_MS, propostaAtual } from "@/lib/pipeline";
import { buscarSessao } from "@/lib/sessoes";
import { erro, erroDeInfra, parametros } from "@/lib/rotas";
import { TETO_PEDIDO } from "@/lib/tipos";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/sessoes/:id/pedidos — o que faltou, a pedido (slice 11).
 *
 * Corpo `{ texto }`: o que eu disse que o extrator deixou de fora. O mesmo
 * extrator relê a sessão inteira com o foco apontado, e o átomo que volta entra
 * no fim da lista da revisão (`pedidos.ts`).
 *
 * **Síncrona**, ao contrário do `/extrair`: quem pede está olhando a tela e
 * esperando o átomo. O prazo é o da função (`PRAZO_DA_FUNCAO_MS`), contado do
 * começo dela, e a medida segue o padrão do `/extrair`.
 *
 * **O resultado é gravado antes da resposta.** Resposta perdida — tela
 * bloqueada no meio — não perde o átomo: o `GET /extracao` já junta os pedidos.
 *
 * O mesmo texto de novo devolve o que já foi gravado, sem chamar modelo; um
 * pedido igual em curso não é refeito (409). Só a revisão fechada aceita
 * pedido: durante o `crescendo` o que falta pode chegar na janela seguinte, e
 * depois de confirmada o átomo nasceria sem revisão em volta.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const inicio = Date.now();
  const p = parametros(await ctx.params);
  if (!p.ok) return p.resposta;
  const { id } = p;

  const corpo = (await req.json().catch(() => null)) as { texto?: unknown } | null;
  const texto = typeof corpo?.texto === "string" ? corpo.texto.trim() : "";
  if (texto === "") return erro("diga o que faltou", 400);
  if (texto.length > TETO_PEDIDO) {
    return erro(`o pedido passa de ${TETO_PEDIDO} caracteres — aponte, não dite o átomo`, 400);
  }

  try {
    const sessao = await buscarSessao(id);
    if (!sessao) return erro("sessão não encontrada", 404);
    if (sessao.status !== "em_revisao") {
      return erro(`sessão em '${sessao.status}': só a revisão aberta aceita pedido`, 409);
    }

    const r = await comInvocacao(() =>
      comMedicao(id, "pedido", () => pedir(id, texto, { ate: inicio + PRAZO_DA_FUNCAO_MS })),
    );
    if (r.situacao === "em_curso") {
      return erro("este pedido já está sendo procurado — reabra a revisão daqui a pouco", 409);
    }

    // A proposta inteira, já juntada e no formato do `GET /extracao`: a tela a
    // passa por `mesclarProposta`, e a lista só cresce.
    const atual = await propostaAtual(id);
    return NextResponse.json({
      pedido: r.pedido,
      proposta: atual && {
        status: sessao.status,
        iniciada_em: sessao.iniciada_em,
        duracao_s: sessao.duracao_s,
        extracao: atual.extracao,
        blocos: atual.blocos,
        crescendo: atual.crescendo,
        anterior: atual.anterior ?? null,
      },
    });
  } catch (e) {
    if (e instanceof SemPropostaFechadaError) {
      return erro("a proposta ainda está crescendo — o pedido espera ela fechar", 409);
    }
    return erroDeInfra("pedido", e);
  }
}
