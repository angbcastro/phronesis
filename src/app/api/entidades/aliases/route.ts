import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { passadaDeVetores } from "@/lib/entidades";
import { FusaoError, registrarGrafia, removerGrafia } from "@/lib/fusao";
import { erro } from "@/lib/rotas";

export const runtime = "nodejs";

/**
 * POST /api/entidades/aliases — `{ chave, grafia, acao: "acrescentar" | "remover" }`.
 *
 * A lista de grafias editável à mão, que é o que a 4.11 abriu ao tirar o alias
 * do formato de nó: **é o único jeito de ensinar uma grafia antes de o STT
 * errar pela primeira vez**, que é justamente quando ele mais erra. Vale para os
 * quatro tipos de entidade.
 *
 * Um item por chamada, e não a lista inteira, de propósito: `aliases` na tela é
 * a **união** de duas fontes — a propriedade e os nós que perderam uma fusão
 * real —, e mandar a lista de volta gravaria os segundos na primeira, criando
 * duas fontes de verdade para a mesma pergunta. Isso é exatamente o que a
 * migration 009 desfez.
 *
 * Acrescentar reusa `registrarGrafia`, com as quatro recusas dela intactas: a
 * regra não pode depender de quem chamou. Remover só tira da propriedade — a
 * grafia que veio de uma fusão real não sai por aqui, e a recusa diz isso.
 */
export async function POST(req: Request) {
  const corpo = (await req.json().catch(() => null)) as {
    chave?: unknown;
    grafia?: unknown;
    acao?: unknown;
  } | null;

  const chave = typeof corpo?.chave === "string" ? corpo.chave : "";
  const grafia = typeof corpo?.grafia === "string" ? corpo.grafia : "";
  const acao = corpo?.acao;

  if (chave === "" || grafia.trim() === "" || (acao !== "acrescentar" && acao !== "remover")) {
    return erro(
      'corpo inválido: espera { chave, grafia, acao: "acrescentar" | "remover" }',
      400,
    );
  }

  try {
    if (acao === "acrescentar") {
      const r = await registrarGrafia(chave, grafia);
      // A recusa é resposta, não exceção — mas aqui ela vem do meu toque, e a
      // tela tem de dizer por quê em vez de piscar e não fazer nada.
      if (!r.criada) return erro(r.motivo, 400);
    } else {
      const r = await removerGrafia(chave, grafia);
      if (!r.removida) return erro(r.motivo, 400);
    }

    // A grafia entra na string canônica de `fonteDaEntidade`: o hash muda e a
    // entidade se reembute sozinha (4.8.1).
    waitUntil(passadaDeVetores("aliases"));
    return NextResponse.json({ ok: true, acao, grafia });
  } catch (e) {
    if (e instanceof FusaoError) return erro(e.message, 400);
    console.error("[aliases]", e);
    return erro(e instanceof Error ? e.message : "não consegui mexer nas grafias", 502);
  }
}
