import { NextResponse } from "next/server";
import { gerarBackup } from "@/lib/backup";
import { resumirMeses } from "@/lib/medidas";
import { erroDeInfra } from "@/lib/rotas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A batida diária. Disparada pelo cron da Vercel (`vercel.json`).
 *
 * Faz três coisas, e as três importam:
 *
 *   1. grava o dump do grafo no R2 (`backup.ts`) — Aura Free não tem backup
 *      gerenciado, e o grafo é a única cópia de átomo, entidade e ficha;
 *   2. mantém a instância acordada — Aura Free é pausada após 72 h sem
 *      atividade, e pausada o hostname nem resolve;
 *   3. escreve o resumo mensal das medidas (slice 8): o detalhe de março some
 *      com as sessões e a poda do índice, a **linha** de março fica para
 *      sempre. Doze objetos por ano.
 *
 * As duas primeiras saem de uma consulta só. A terceira não toca o grafo — é
 * R2 puro — e **não pode derrubar as outras duas**: manter a Aura acordada é o
 * que impede a instância de sumir, e um resumo é só um resumo.
 *
 * Não passa por exceção nenhuma no `matcher`: quem a autoriza é o próprio
 * middleware, pelo header `Authorization: Bearer $CRON_SECRET`, e só sob
 * `/api/cron/` (§7). A porta continua sendo uma.
 *
 * O plano Hobby dá **uma execução por dia**, e uma por dia é exatamente o que
 * uma janela de 72 h pede. Se um dia fizer falta mais, o que muda é o plano,
 * não este arquivo.
 */
export async function GET() {
  try {
    const { key, nos } = await gerarBackup();

    // Depois do backup, e engolindo a própria falha: o que não pode faltar
    // nesta batida é o dump e a consulta que acorda a Aura.
    const meses = await resumirMeses().catch((e) => {
      console.error("[medidas] não consegui resumir o mês:", e);
      return [] as { mes: string; n: number }[];
    });

    return NextResponse.json({ ok: true, key, nos, meses });
  } catch (e) {
    return erroDeInfra("backup", e);
  }
}
