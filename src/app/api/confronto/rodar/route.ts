import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { haEloRodando, rodarElo } from "@/lib/confronto";

export const runtime = "nodejs";

/**
 * O mesmo teto das rotas que chamam modelo dentro de `waitUntil` (§10 do
 * ARCHITECTURE.md). Cada elo leva o seu prazo (`PRAZO_DO_ELO_MS`) para uma
 * chamada lenta não comer a função inteira.
 */
export const maxDuration = 300;

/**
 * POST /api/confronto/rodar — sob demanda, e desde a 5.2 também o disparo de
 * fundo do confirmar.
 *
 * **Sem distinção entre "começar" e "elo seguinte"**: todo POST reivindica os
 * próximos átomos pendentes (`confronto_estado` ausente ou `'falhou'`,
 * migration 011) e processa.
 *
 * **`?se_parado=1`** é o modo do confirmar: só começa se nenhum elo estiver
 * rodando. Sem ele, cada sessão confirmada durante um reprocessar grande
 * abriria mais uma corrente de cinco chamadas paralelas. O botão da tela não
 * manda o parâmetro — tocar "rodar agora" é pedir explicitamente.
 *
 * **Como a fila anda sem janela aberta.** O estado mora no átomo, não no
 * navegador: cada elo reivindica, roda, grava, e chama esta mesma rota de novo
 * em `waitUntil`. Fila vazia, o encadeamento para.
 *
 * **O elo se autentica com o meu próprio cookie**, repassado da requisição que
 * o originou: a fila não abre porta nenhuma que já não estivesse aberta.
 */
export async function POST(req: Request) {
  if (new URL(req.url).searchParams.get("se_parado") === "1" && (await haEloRodando())) {
    return NextResponse.json({ ok: true, ja_rodando: true });
  }
  waitUntil(processarUmEEncadear(req));
  return NextResponse.json({ ok: true });
}

/**
 * `new URL(..., req.url)` e não uma variável de ambiente: o endereço certo é
 * o da requisição que está sendo servida, em produção, em preview e em
 * `pnpm dev`. O elo seguinte nunca leva `se_parado` — ele é a corrente que está
 * rodando.
 */
function encadear(req: Request): Promise<unknown> {
  const cookie = req.headers.get("cookie");
  return fetch(new URL("/api/confronto/rodar", req.url), {
    method: "POST",
    headers: cookie ? { cookie } : {},
  }).catch((e) => {
    // O encadeamento é o que faz a fila andar; quando ele cai, o que sobra é
    // a retomada — o átomo em `rodando` vence o lease e a próxima batida (ou
    // o próximo toque no botão) o pega.
    console.error("[confronto] não consegui chamar o elo seguinte; a fila para aqui:", e);
  });
}

async function processarUmEEncadear(req: Request) {
  try {
    const r = await rodarElo();
    if (!r) {
      console.log("[confronto] fila vazia — o encadeamento para aqui.");
      return;
    }
  } catch (e) {
    // Falhar aqui não derruba a fila — `rodarElo` já marca os átomos `falhou`
    // por dentro; isto é só o caso de algo quebrar fora dele.
    console.error("[confronto] elo falhou fora do agente:", e);
  }
  await encadear(req);
}
