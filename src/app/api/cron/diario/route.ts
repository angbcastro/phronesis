import { NextResponse } from "next/server";
import { gerarBackup } from "@/lib/backup";
import { erroDeInfra } from "@/lib/rotas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A batida diária. Disparada pelo cron da Vercel (`vercel.json`).
 *
 * Faz duas coisas com uma consulta só, e as duas importam:
 *
 *   1. grava o dump do grafo no R2 (`backup.ts`) — Aura Free não tem backup
 *      gerenciado, e o grafo é a única cópia de átomo, entidade e ficha;
 *   2. mantém a instância acordada — Aura Free é pausada após 72 h sem
 *      atividade, e pausada o hostname nem resolve.
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
    return NextResponse.json({ ok: true, key, nos });
  } catch (e) {
    return erroDeInfra("backup", e);
  }
}
