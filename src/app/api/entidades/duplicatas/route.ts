import { NextResponse } from "next/server";
import { julgar, parecidas, PROMPT_VERSION_DUPLICATAS } from "@/lib/duplicatas";
import type { ParJulgado } from "@/lib/duplicatas";
import type { ContextoEntidade } from "@/lib/duplicatas";
import { listarEntidades } from "@/lib/entidades";
import { paresDistintos } from "@/lib/fusao";
import { query } from "@/lib/neo4j";
import { erro } from "@/lib/rotas";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Quantos pares o modelo julga de uma vez. Além disso a resposta fica cara. */
const TETO_PARES = 25;
/** Textos por entidade mandados como contexto. */
const TEXTOS_POR_ENTIDADE = 3;

/**
 * POST /api/entidades/duplicatas — quem parece ser a mesma coisa que quem.
 *
 * **Não escreve nada.** Devolve proposta; fundir é outra rota, e é um toque meu
 * na tela. É `POST` e não `GET` porque gasta uma chamada de modelo: a camada
 * determinística é de graça, mas o julgamento não, e isso não pode acontecer
 * toda vez que a tela abre.
 *
 * Os pares que eu já recusei (`:DISTINTA_DE`) são filtrados antes de qualquer
 * chamada — não se paga para perguntar de novo o que eu já respondi.
 */
export async function POST() {
  try {
    const [entidades, distintos] = await Promise.all([listarEntidades(), paresDistintos()]);

    const candidatos = parecidas(entidades, distintos).slice(0, TETO_PARES);
    if (candidatos.length === 0) {
      return NextResponse.json({
        pares: [],
        analisados: 0,
        modelo: null,
        prompt_version: PROMPT_VERSION_DUPLICATAS,
      });
    }

    // Contexto: o que os átomos dizem de cada lado do par. É o que separa
    // "Isinha"/"Isabela" (mesma pessoa) de "Marina"/"Mariana" (duas).
    const envolvidas = [...new Set(candidatos.flatMap((p) => [p.a, p.b]))];
    const textos = await query<{ chave: string; textos: string[] }>(
      `MATCH (e:Entidade) WHERE e.nome_normalizado IN $chaves
       OPTIONAL MATCH (e)<-[:SOBRE|:MENCIONA]-(a:Atomo)
       WITH e, a ORDER BY a.criado_em DESC
       RETURN e.nome_normalizado AS chave,
              collect(a.texto)[0..$quantos] AS textos`,
      { chaves: envolvidas, quantos: TEXTOS_POR_ENTIDADE },
    );

    const porChave = new Map(entidades.map((e) => [e.nome_normalizado, e]));
    const contexto = new Map<string, ContextoEntidade>();
    for (const linha of textos) {
      const e = porChave.get(linha.chave);
      if (!e) continue;
      contexto.set(linha.chave, {
        nome_normalizado: e.nome_normalizado,
        nome: e.nome,
        tipo: e.tipo,
        textos: (linha.textos ?? []).filter((t): t is string => typeof t === "string"),
      });
    }

    // Modelo e versão saem daqui, e não de `modeloDuplicatas()` ao lado: desde
    // o painel (4.7) os dois podem vir do que eu editei, e procedência tem de
    // ser o que rodou, não o que a rota recalcularia.
    const julgados = await julgar(candidatos, contexto);

    return NextResponse.json({
      // Só o que o modelo achou ser a mesma coisa. O resto eu não preciso ver:
      // a tela é para decidir fusão, não para ler o raciocínio dele.
      pares: julgados.pares
        .filter((p: ParJulgado) => p.mesma)
        .map((p: ParJulgado) => ({
          ...p,
          nome_a: porChave.get(p.a)?.nome ?? p.a,
          nome_b: porChave.get(p.b)?.nome ?? p.b,
          sessoes_a: porChave.get(p.a)?.sessoes ?? 0,
          sessoes_b: porChave.get(p.b)?.sessoes ?? 0,
        })),
      analisados: candidatos.length,
      modelo: julgados.modelo,
      prompt_version: julgados.prompt_version,
    });
  } catch (e) {
    console.error("[duplicatas]", e);
    return erro(e instanceof Error ? e.message : "não consegui procurar duplicatas", 502);
  }
}
