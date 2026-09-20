import { acompanharProposta, TETO_STREAM_MS } from "@/lib/pipeline";
import { parametros } from "@/lib/rotas";
import type { EventoDaProposta } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * O mesmo teto das outras rotas do pipeline (§10). Aqui ele não é o tempo de um
 * trabalho: é quanto a conexão pode ficar aberta. `TETO_STREAM_MS` fecha 20 s
 * antes dele, para o corpo nunca ser cortado pela plataforma no meio.
 */
export const maxDuration = 300;

/**
 * GET /api/sessoes/:id/extracao/eventos — a proposta, enquanto ela cresce.
 *
 * Devolve um fluxo de NDJSON, no mesmo dialeto de `POST /api/chat`: um objeto
 * por linha, `application/x-ndjson`, `X-Accel-Buffering: no`. Um evento por
 * mudança da proposta, e o último deles traz `crescendo: false` — é ele que
 * destrava o confirmar da revisão.
 *
 * **A rota é fina de propósito.** Todo o laço mora em `acompanharProposta`
 * (`pipeline.ts`), com relógio e sono injetáveis: é lá que está a decisão de
 * quando reler, quando remontar e quando desistir, e é lá que ela tem teste.
 * Aqui só se embrulha aquilo num `ReadableStream`, igual à rota de chat.
 *
 * **Duas telas consomem o mesmo fluxo** (slice 8.2), e é o mesmo sinal para as
 * duas: `Processando` sai para a revisão no primeiro evento com átomo, e
 * `Revisao` fica recebendo o resto até fechar.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const p = parametros(await ctx.params);
  if (!p.ok) return p.resposta;

  const codificador = new TextEncoder();

  const fluxo = new ReadableStream<Uint8Array>({
    async start(controle) {
      const manda = (e: EventoDaProposta) => {
        try {
          controle.enqueue(codificador.encode(`${JSON.stringify(e)}\n`));
        } catch {
          // O cliente fechou a aba. O laço do lado de cá termina sozinho pelo
          // `req.signal`, que é o mesmo caminho do chat.
        }
      };

      try {
        await acompanharProposta(p.id, manda, { sinal: req.signal, teto: TETO_STREAM_MS });
      } catch (e) {
        console.error(`[eventos] sessão ${p.id}:`, e);
      } finally {
        controle.close();
      }
    },
  });

  return new Response(fluxo, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      // Sem isto um proxy pode segurar o corpo inteiro até o fim, e o átomo que
      // aparece na minha frente — a razão de a rota existir — chegaria junto do
      // último.
      "X-Accel-Buffering": "no",
    },
  });
}
