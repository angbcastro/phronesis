import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { passadaDeVetores } from "@/lib/entidades";
import { FusaoError, gravarResumo } from "@/lib/fusao";
import { erro } from "@/lib/rotas";

export const runtime = "nodejs";

/**
 * POST /api/entidades/resumo — `{ chave, texto }`.
 *
 * **O único lugar que escreve o retrato de identidade** (migration 009). Ele é o
 * que os dois agentes leem por padrão desde a 4.11 — o dossiê do extrator e o
 * catálogo do agente 2 —, então vale aqui a mesma disciplina de
 * `POST /api/entidades/perfil`: o campo só muda quando eu aperto salvar. Texto
 * de identidade errado contamina toda atribuição futura, e o erro se realimenta.
 *
 * Texto vazio é legítimo: apagar o que eu escrevi errado tem que ser possível, e
 * resumo vazio é estado válido — é com ele que toda entidade nasce.
 *
 * O corte em `TETO_RESUMO` é no servidor (`gravarResumo`), e não no `maxLength`
 * da tela: regra que só vale no navegador não é regra.
 */
export async function POST(req: Request) {
  const corpo = (await req.json().catch(() => null)) as {
    chave?: unknown;
    texto?: unknown;
  } | null;

  const chave = typeof corpo?.chave === "string" ? corpo.chave : "";
  const texto = typeof corpo?.texto === "string" ? corpo.texto : "";
  if (chave === "") return erro("corpo inválido: espera { chave, texto }", 400);

  try {
    const r = await gravarResumo(chave, texto);
    // O padrão das rotas de entidade (4.8.1). O resumo não entra em
    // `fonteDaEntidade` — então na prática esta passada só reembute quem já
    // estava fora de dia por outro motivo, e custa uma consulta.
    waitUntil(passadaDeVetores("resumo"));
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    if (e instanceof FusaoError) return erro(e.message, 400);
    console.error("[resumo]", e);
    return erro(e instanceof Error ? e.message : "não consegui gravar o resumo", 502);
  }
}
