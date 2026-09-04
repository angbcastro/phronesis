import { NextResponse } from "next/server";
import { ARESTAS, NOS, retrato } from "@/lib/agentes";
import { configAgentes } from "@/lib/overrides";
import { erroDeInfra } from "@/lib/rotas";

export const runtime = "nodejs";

/**
 * GET /api/agentes — os sete, com o que está em vigor, e o desenho do fluxo.
 *
 * **De graça**: nenhuma chamada de modelo, nenhuma consulta ao grafo. Uma
 * leitura do `config/agentes.json`, e mais uma por prompt que eu tenha editado.
 * Abrir o painel não pode custar o preço de uma extração.
 *
 * A base do git viaja junto com o prompt em vigor de propósito: é o que permite
 * a tela mostrar "editado" sem uma segunda ida à rede, e é o que o "voltar ao
 * original" manda de volta.
 */
export async function GET() {
  try {
    const cfg = await configAgentes();
    return NextResponse.json({
      agentes: await retrato(cfg),
      fluxo: { nos: NOS, arestas: ARESTAS },
      atualizado_em: cfg.atualizado_em || null,
    });
  } catch (e) {
    return erroDeInfra("agentes", e);
  }
}
