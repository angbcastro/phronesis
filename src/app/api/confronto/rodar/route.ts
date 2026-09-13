import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { rodarElo } from "@/lib/confronto";

export const runtime = "nodejs";

/**
 * O mesmo teto das rotas que chamam modelo dentro de `waitUntil` (§10 do
 * ARCHITECTURE.md) — a espera de rate limit do Gateway não tem prazo, por
 * decisão da fatia: ninguém está esperando do outro lado da tela.
 */
export const maxDuration = 300;

/**
 * POST /api/confronto/rodar — sob demanda.
 *
 * **Sem distinção entre "começar" e "elo seguinte"**, ao contrário de
 * `POST /api/entidades/enriquecer`: lá existe um passo de escolher quais
 * entidades entram na fila; aqui não — todo POST faz a mesma coisa,
 * reivindica o próximo átomo pendente (`confronto_estado` ausente ou
 * `'falhou'`, migration 011) e processa.
 *
 * **Como a fila anda sem janela aberta.** O estado mora no átomo, não no
 * navegador: cada elo reivindica **um** átomo, roda, grava, e chama esta
 * mesma rota de novo em `waitUntil`. Fila vazia, o encadeamento para. Mesmo
 * mecanismo da fila de enriquecimento, que é o da transcrição por blocos.
 *
 * **O elo se autentica com o meu próprio cookie**, repassado da requisição
 * que o originou: a fila não abre porta nenhuma que já não estivesse aberta,
 * e o middleware continua sendo a porta única.
 */
export async function POST(req: Request) {
  waitUntil(processarUmEEncadear(req));
  return NextResponse.json({ ok: true });
}

/**
 * `new URL(..., req.url)` e não uma variável de ambiente: o endereço certo é
 * o da requisição que está sendo servida, em produção, em preview e em
 * `pnpm dev`.
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
    // Falhar aqui não derruba a fila — `rodarElo` já marca o átomo `falhou`
    // por dentro; isto é só o caso de algo quebrar fora dele.
    console.error("[confronto] elo falhou fora do agente:", e);
  }
  await encadear(req);
}
