import { NextResponse } from "next/server";
import { acharPorChave, listarEntidades, passadaDeVetores } from "@/lib/entidades";
import { EnriquecimentoError, TETO_MOTIVO, enriquecer, marcarEstado } from "@/lib/enriquecimento";
import { erro } from "@/lib/rotas";
import { normalizarNome } from "@/lib/texto";

export const runtime = "nodejs";

/**
 * O mesmo teto das três rotas que chamam modelo dentro de um caminho longo
 * (§10). A spec falava em 60 s por elo — o que cabe folgado nele é a chamada —,
 * mas a espera de rate limit desta fila **não tem prazo** por decisão da fatia:
 * ninguém está esperando do outro lado da tela, e uma espera de 75 s estourava
 * um teto de 60. 300 é o teto que permite a espera longa acontecer.
 */
export const maxDuration = 300;

/**
 * POST /api/entidades/enriquecer — `{ chave }`.
 *
 * **Uma entidade, agora, e a resposta espera.** É o ponto de retorno barato do
 * passo 4 da slice 4.12: já dá para enriquecer à mão, uma por vez, com o
 * desfazer existindo antes de a primeira ficha ser sobrescrita. A fila que
 * dispensa a janela aberta é o passo 5.
 *
 * **Ela escreve no grafo sem eu aprovar campo por campo**, e é a única rota
 * deste sistema que faz isso com conteúdo. A regra 5 continua inteira: ela fala
 * de átomo e da tela de revisão, e nenhum átomo entra por aqui. O que substituiu
 * a aprovação é o par seleção + botão, mais `POST /api/entidades/desfazer`.
 */
export async function POST(req: Request) {
  const corpo = (await req.json().catch(() => null)) as { chave?: unknown } | null;
  const chave = typeof corpo?.chave === "string" ? normalizarNome(corpo.chave) : "";
  if (chave === "") return erro("corpo inválido: espera { chave }", 400);

  try {
    // O catálogo inteiro, e não uma consulta por chave: é o mesmo objeto que os
    // agentes leem (`EntidadeDoGrafo`), e é ele que traz a grafia e o tipo que
    // vão ao prompt. Atravessar alias sai de graça em `acharPorChave`.
    const alvo = acharPorChave(chave, await listarEntidades());
    if (!alvo) return erro(`"${chave}" não está no grafo`, 404);

    await marcarEstado(alvo.nome_normalizado, "rodando");

    try {
      const r = await enriquecer(alvo);
      // A ficha é o que mais muda a string canônica da entidade, e portanto o
      // vetor dela — o gancho da 4.8.1 vale aqui mais que em qualquer outra
      // rota. Fora do caminho da resposta, engolindo a falha.
      void passadaDeVetores("enriquecer");
      return NextResponse.json({ ok: true, nome: alvo.nome, ...r });
    } catch (e) {
      // `falhou` com o motivo **na linha da entidade**: é o caminho previsto da
      // fatia, e nenhuma outra entidade é afetada por ele.
      const motivo = e instanceof Error ? e.message : String(e);
      console.error(`[enriquecer] ${alvo.nome}:`, e);
      await marcarEstado(alvo.nome_normalizado, "falhou", motivo).catch(() => {});
      return erro(motivo.slice(0, TETO_MOTIVO), 502);
    }
  } catch (e) {
    if (e instanceof EnriquecimentoError) return erro(e.message, 400);
    console.error("[enriquecer]", e);
    return erro(e instanceof Error ? e.message : "não consegui enriquecer", 502);
  }
}
