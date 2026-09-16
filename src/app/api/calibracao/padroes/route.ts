import { NextResponse } from "next/server";
import { agentePorId } from "@/lib/agentes";
import { CalibracaoError, carregarIndice, rascunharPadroes } from "@/lib/calibracao";
import { paraCalibrar } from "@/lib/correcoes";
import { efetivo } from "@/lib/overrides";
import { erro } from "@/lib/rotas";
import { ehAgenteId } from "@/lib/tipos";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/calibracao/padroes — o `calibracao-2` diz que padrão as minhas
 * correções de um agente revelam.
 *
 * **Não escreve nada.** Devolve o rascunho e para; quem guarda a pauta é
 * `/redacao`, e só depois de eu confirmar. Mesmo molde de
 * `/entidades/perfil/rascunho`, e pela mesma razão: é `POST` e não `GET` porque
 * gasta uma chamada de modelo, e isso não pode acontecer toda vez que a tela
 * abre.
 *
 * Lê só as correções **em aberto e daquele agente**. Até a slice 7 isto era uma
 * constante `"extracao"` cravada, e era o que deixava `resolucao` acumulando
 * correção etiquetada sem consumidor desde a 4.6.
 */
export async function POST(req: Request) {
  const corpo = (await req.json().catch(() => null)) as { agente?: unknown } | null;
  if (!ehAgenteId(corpo?.agente)) {
    return erro("corpo inválido: espera { agente }", 400);
  }

  const agente = agentePorId(corpo.agente);
  if (!agente || agente.base === null) {
    return erro(`o agente "${corpo.agente}" não tem prompt para emendar`, 400);
  }

  try {
    const indice = await carregarIndice();
    // O prompt em vigor, e não a base do git: um padrão que já esteja escrito
    // numa emenda anterior não deve voltar como novidade.
    const meu = await efetivo(agente.id, { prompt: agente.base, modelo: agente.padrao() });

    const rascunho = await rascunharPadroes({
      agente: agente.id,
      papel: agente.papel,
      prompt: meu.prompt,
      correcoes: paraCalibrar(indice, agente.id),
    });

    return NextResponse.json(rascunho);
  } catch (e) {
    if (e instanceof CalibracaoError) return erro(e.message, 400);
    console.error("[calibracao padroes]", e);
    return erro(e instanceof Error ? e.message : "não consegui rascunhar", 502);
  }
}
