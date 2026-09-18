import { NextResponse } from "next/server";
import { carregarIndiceDeMedidas, resumoMensalGravado } from "@/lib/medidas";
import { erroDeInfra } from "@/lib/rotas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/medidas — a série, sob demanda (slice 8).
 *
 * Sem `?mes`, o índice: uma linha por sessão, da mais recente para a mais
 * antiga, com os números de manchete. Com `?mes=AAAA-MM`, o resumo daquele mês
 * — n, mediana, pior caso e o por-passo —, que é o que sobrevive à poda do
 * índice e ao apagar de uma sessão.
 *
 * **Esta fatia não tem tela**, e esta rota é o que faz "o objeto é lido sob
 * demanda" ser verdade em vez de uma frase: `r2.ts` não tem `LIST`, e sem ela a
 * série só seria alcançável pelo console do Cloudflare. Se a leitura virar
 * hábito, a tela vira item da pauta (8.4).
 */
export async function GET(req: Request) {
  const mes = new URL(req.url).searchParams.get("mes");

  try {
    if (mes !== null) {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) {
        return NextResponse.json({ erro: "mês inválido — use AAAA-MM" }, { status: 400 });
      }
      const resumo = await resumoMensalGravado(mes);
      if (!resumo) return NextResponse.json({ erro: `nada medido em ${mes}` }, { status: 404 });
      return NextResponse.json(resumo);
    }

    return NextResponse.json(await carregarIndiceDeMedidas());
  } catch (e) {
    return erroDeInfra("medidas", e);
  }
}
