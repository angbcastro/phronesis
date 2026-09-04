import { NextResponse } from "next/server";
import { CalibracaoError, carregarIndice, rascunharRegras } from "@/lib/calibracao";
import { paraCalibrar } from "@/lib/correcoes";
import { regras } from "@/lib/regras";
import { erro } from "@/lib/rotas";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/calibracao/rascunho — o `calibracao-1` propõe até duas regras.
 *
 * **Não escreve nada.** Devolve o rascunho e para; quem grava é
 * `POST /api/calibracao/regras`, e só com o meu toque. Mesmo molde de
 * `/entidades/perfil/rascunho`, e pela mesma razão: é `POST` e não `GET`
 * porque gasta uma chamada de modelo, e isso não pode acontecer toda vez que
 * a tela abre.
 *
 * Lê só as correções **em aberto e do extrator**. `resolucao` e `grafo` estão
 * capturadas e etiquetadas, mas alimentar o agente da extração com elas só
 * produziria regra de extração para erro que não é dela. E o rascunho nunca
 * revê o que uma versão anterior já endereçou: cada rodada é um compilado das
 * edições **novas**.
 */
export async function POST() {
  try {
    const indice = await carregarIndice();
    const emAberto = paraCalibrar(indice);
    const emVigor = await regras();

    const rascunho = await rascunharRegras(emAberto, emVigor);

    return NextResponse.json({
      ...rascunho,
      // O atual vai junto de propósito, como no rascunho de perfil: eu vejo o
      // que já vale ao lado do que está sendo proposto, nunca por cima.
      em_vigor: emVigor,
    });
  } catch (e) {
    if (e instanceof CalibracaoError) return erro(e.message, 400);
    console.error("[calibracao rascunho]", e);
    return erro(e instanceof Error ? e.message : "não consegui rascunhar", 502);
  }
}
