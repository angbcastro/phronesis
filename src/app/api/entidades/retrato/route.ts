import { NextResponse } from "next/server";
import { lerRetrato, temRetratoAnterior } from "@/lib/retrato";
import { lerConfigRetrato } from "@/lib/retrato-dimensoes";
import { erroDeInfra } from "@/lib/rotas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/entidades/retrato — o retrato do "eu" e as dimensões, numa leitura
 * só (slice 10).
 *
 * `retrato` é `null` enquanto nenhuma rodada o escreveu. As seções vêm todas,
 * inclusive a de dimensão que saiu da lista: **quem esconde é a tela**, que só
 * desenha seção cujo `id` está em `config.dimensoes` — a seção removida fica no
 * `eu.json` até a próxima rodada, e no `anterior` por mais uma geração.
 *
 * `tem_anterior` é o lado R2 do desfazer; o lado do nó vem na linha da entidade
 * (`enriquecimento.tem_anterior`), como nas outras fichas.
 */
export async function GET() {
  try {
    const [retrato, config, tem_anterior] = await Promise.all([
      lerRetrato(),
      lerConfigRetrato(),
      temRetratoAnterior(),
    ]);
    return NextResponse.json({ retrato, config, tem_anterior });
  } catch (e) {
    return erroDeInfra("retrato", e);
  }
}
