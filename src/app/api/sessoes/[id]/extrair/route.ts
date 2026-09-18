import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { comInvocacao } from "@/lib/invocacao";
import { comMedicao } from "@/lib/medidas";
import { extrairSessao } from "@/lib/pipeline";
import { buscarSessao } from "@/lib/sessoes";
import { podeReextrair } from "@/lib/estados";
import { erro, parametros } from "@/lib/rotas";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/sessoes/:id/extrair
 *
 * Dispara a extração de uma sessão já transcrita. O caminho normal não passa
 * por aqui — a extração emenda sozinha no fim do `finalizarSessao`. Esta rota
 * existe para dois casos:
 *
 *   retry    o `waitUntil` morreu no meio (em dev, fechar a janela do servidor
 *            basta) e a sessão ficou em `extraindo` ou `erro`
 *   forçar   `{ "forcar": true }` reprocessa mesmo com proposta pronta, para
 *            calibrar o prompt contra uma sessão já gravada
 *
 * Sem `forcar`, a trava de idempotência vale: proposta que existe não é
 * refeita. **Com `forcar`, a proposta atual é sobrescrita** — inclusive uma que
 * já tenha sido revisada.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const p = parametros(await ctx.params);
  if (!p.ok) return p.resposta;
  const { id } = p;

  const sessao = await buscarSessao(id);
  if (!sessao) return erro("sessão não encontrada", 404);

  // `podeReextrair`, e não `temTranscricao`: é do `erro` que o retry descrito
  // acima parte, e barrá-lo aqui deixava a rota contradizendo o próprio
  // docstring com um 409 que ainda por cima dizia não haver transcrição.
  if (!podeReextrair(sessao.status)) {
    return erro(`sessão em '${sessao.status}': ainda não há transcrição para extrair`, 409);
  }

  const corpo = (await req.json().catch(() => ({}))) as { forcar?: boolean };
  const forcar = corpo.forcar === true;

  if (sessao.status === "confirmada" && !forcar) {
    return NextResponse.json({ status: "confirmada", ja_confirmada: true });
  }

  // Medida também aqui, e `fecha`: calibrar o prompt contra uma sessão gravada
  // é exatamente quando eu quero saber quanto a extração custou desta vez. As
  // marcas do cliente não existem neste caminho, então a linha sai com
  // `espera_ms` nulo — ela conta o servidor, não a minha espera.
  waitUntil(
    comInvocacao(() =>
      comMedicao(id, "extrair", () => extrairSessao(id, { forcar }), { fecha: true }),
    ).catch((e) => {
      console.error(`[extrair] sessão ${id} falhou:`, e);
    }),
  );

  return NextResponse.json({ status: "extraindo", forcado: forcar });
}
