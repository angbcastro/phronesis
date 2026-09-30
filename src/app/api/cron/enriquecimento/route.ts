import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { listarEntidades, passadaDeVetores } from "@/lib/entidades";
import {
  enfileirarCanonicasComNovidade,
  reivindicarProxima,
  rodarElo,
} from "@/lib/enriquecimento";
import { env } from "@/lib/env";
import { erroDeInfra } from "@/lib/rotas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Até quando a invocação **começa** uma entidade nova.
 *
 * Não é o 270 s do `cron/confronto`: lá um elo é um lote curto, aqui é uma ficha
 * inteira, e a do "eu" levou 62 s em 29/09. Começar uma ficha aos 269 s mataria
 * a função no meio dela — e, morta, ela não chama a continuação, que é o
 * contrário do que esta rota existe para fazer. Os 120 s que sobram até o teto
 * são a margem da última ficha; uma espera de rate limit maior que isso ainda
 * mata o elo, e aí a entidade volta pelo lease e a corrente espera a tela ou a
 * semana seguinte (§14).
 */
const ORCAMENTO_MS = 180_000;

/**
 * A batida semanal do enriquecimento (slice 4.12.1). Segunda-feira, 07:00 UTC
 * (`vercel.json`) — depois do confronto (05:00) e do diário (06:00), para não
 * disputar o Gateway com eles.
 *
 * **Põe na fila as canônicas com novidade** (`enfileirarCanonicasComNovidade`)
 * e anda a fila sem aba aberta. Mesma porta das outras batidas: o header
 * `Authorization: Bearer $CRON_SECRET` sob `/api/cron/`, autorizado pelo
 * middleware e nunca checado aqui (§7).
 *
 * **Como anda.** A batida não tem cookie, então a corrente de
 * `/api/entidades/enriquecer` não serve. A rota responde na hora e trabalha em
 * `waitUntil`, em laço — reivindicar, rodar, pôr os vetores em dia — até a fila
 * esvaziar ou o orçamento acabar. Sobrando fila, **chama a si mesma** com a
 * mesma credencial e `?continuacao=1`, que não enfileira de novo: só processa.
 * Responder antes de trabalhar é o que mantém a corrente sequencial em vez de
 * aninhada — a invocação que chamou a continuação morre assim que ela
 * responde, em vez de esperar o trabalho dela.
 */
export async function GET(req: Request) {
  const continuacao = new URL(req.url).searchParams.get("continuacao") === "1";

  let na_fila = 0;
  if (!continuacao) {
    try {
      na_fila = await enfileirarCanonicasComNovidade();
      console.log(`[cron-enriquecimento] ${na_fila} canônica(s) com novidade na fila`);
    } catch (e) {
      return erroDeInfra("cron-enriquecimento", e);
    }
  }

  waitUntil(processar(req));
  return NextResponse.json({ ok: true, continuacao, na_fila });
}

async function processar(req: Request): Promise<void> {
  const comeco = Date.now();
  let feitas = 0;

  try {
    while (Date.now() - comeco < ORCAMENTO_MS) {
      const chave = await reivindicarProxima();
      if (!chave) {
        console.log(`[cron-enriquecimento] fila vazia depois de ${feitas} ficha(s).`);
        return;
      }
      // O catálogo a cada entidade, como o elo faz: uma fusão no meio da fila
      // tem de aparecer para a próxima.
      await rodarElo(chave, await listarEntidades());
      await passadaDeVetores("cron-enriquecimento");
      feitas++;
    }
  } catch (e) {
    // Erro fora do `rodarElo` (o grafo caiu): a entidade fica em `rodando` e
    // volta pelo lease. **Aqui a corrente para**, ao contrário do elo da tela:
    // com o grafo fora, cada continuação falharia na hora e chamaria a próxima,
    // e a batida viraria um laço de invocações sem fim. Quem retoma é a tela
    // aberta ou a segunda-feira seguinte.
    console.error("[cron-enriquecimento] elo falhou fora do agente; a fila para aqui:", e);
    return;
  }

  console.log(`[cron-enriquecimento] orçamento no fim depois de ${feitas} ficha(s); continuando.`);
  await continuar(req);
}

/**
 * A continuação, como requisição nova. Mesmo cuidado do `encadear()` da fila:
 * olha o status, e não só a exceção de rede. O segredo sai de `env.ts`, no
 * servidor, e vai num header servidor → servidor.
 */
async function continuar(req: Request): Promise<void> {
  const url = new URL("/api/cron/enriquecimento?continuacao=1", req.url);
  try {
    const resp = await fetch(url, {
      headers: { authorization: `Bearer ${env.cronSecret}` },
    });
    if (!resp.ok) {
      const corpo = await resp.text().catch(() => "");
      console.error(
        `[cron-enriquecimento] a continuação respondeu ${resp.status}: ${corpo.slice(0, 200)} — a fila para aqui`,
      );
    }
  } catch (e) {
    console.error("[cron-enriquecimento] não consegui chamar a continuação; a fila para aqui:", e);
  }
}
