import { NextResponse } from "next/server";
import { carregarIndice } from "@/lib/calibracao";
import { sugerirAlgum } from "@/lib/correcoes";
import { erroDeInfra } from "@/lib/rotas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/calibracao/sugestao — `{ sugerir: boolean }`, e nada mais.
 *
 * **Puro: nunca escreve.** Quem reseta o relógio da sugestão é a carga de fato
 * de `/calibracao`, não esta consulta — a gaveta da `Gestao` a chama toda vez
 * que abre, e se ela marcasse visita a sugestão morreria no primeiro toque na
 * engrenagem, sem eu ter olhado nada.
 *
 * **Binário, nunca numérico**, e é por isso que a resposta é um booleano só:
 * um número aqui viraria "3 semanas e 12 correções" na tela, que é cobrança —
 * exatamente o que a home existe para não fazer.
 *
 * Desde a slice 7 o relógio é por agente, e esta rota pergunta se **algum**
 * deles tem o que olhar. Dizer qual seria placar por outro caminho: a gaveta
 * abre a tela, e é a tela que responde de quem é o material.
 */
export async function GET() {
  try {
    return NextResponse.json({ sugerir: sugerirAlgum(await carregarIndice()) });
  } catch (e) {
    return erroDeInfra("calibracao sugestao", e);
  }
}
