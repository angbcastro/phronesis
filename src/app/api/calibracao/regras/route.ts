import { NextResponse } from "next/server";
import { aprovarRegras, CalibracaoError } from "@/lib/calibracao";
import { erro } from "@/lib/rotas";
import { MAX_REGRAS } from "@/lib/tipos";
import type { Regra } from "@/lib/tipos";

export const runtime = "nodejs";

/**
 * POST /api/calibracao/regras — **o único lugar que escreve regra**.
 *
 * O `calibracao-1` propõe e para por aí; a composição só muda quando eu aperto
 * aprovar, e é esta rota que o meu toque chama. Mesma disciplina de
 * `POST /api/entidades/perfil`, e pela mesma razão: o que está sendo escrito
 * aqui é o prompt que produz todo o resto.
 *
 * O corpo é a **lista inteira** que deve valer daqui para frente, não um delta.
 * Apagar uma regra é submeter a lista sem ela; editar é submeter o texto novo
 * com o mesmo `id`. Lista vazia é legítima: é como se revoga tudo e se volta ao
 * `INSTRUCOES_BASE` puro.
 *
 * `cita` vem do corpo mas é do agente, não meu: a tela não deixa editá-lo, e é
 * ele que diz quais correções esta aprovação fecha (`incorporada_em`). Regra
 * que eu cortei antes de aprovar deixa as correções dela **em aberto**, e elas
 * voltam no próximo rascunho.
 */
export async function POST(req: Request) {
  const corpo = (await req.json().catch(() => null)) as { regras?: unknown } | null;
  if (!corpo || !Array.isArray(corpo.regras)) {
    return erro("corpo inválido: espera { regras: [] }", 400);
  }

  const agora = new Date().toISOString();
  const escolhidas: Regra[] = [];

  for (const item of corpo.regras) {
    const r = item as { id?: unknown; texto?: unknown; cita?: unknown; substitui?: unknown };
    const texto = typeof r?.texto === "string" ? r.texto.trim() : "";
    const id = typeof r?.id === "string" && r.id.trim() !== "" ? r.id.trim() : "";
    // Regra sem texto é regra apagada na tela; sem id não dá para dizer o que
    // sobreviveu à minha edição, que é a definição inteira de "aprovar".
    if (texto === "" || id === "") continue;

    escolhidas.push({
      id,
      texto,
      cita: (Array.isArray(r.cita) ? r.cita : []).filter((c): c is string => typeof c === "string"),
      ...(typeof r.substitui === "string" && r.substitui.trim() !== ""
        ? { substitui: r.substitui.trim() }
        : {}),
      aprovada_em: agora,
    });
  }

  // O teto é a curadoria, e por isso é recusa e não corte silencioso: cortar
  // deixaria eu achar que aprovei treze regras quando doze entraram.
  if (escolhidas.length > MAX_REGRAS) {
    return erro(`são ${escolhidas.length} regras, e o teto é ${MAX_REGRAS}`, 400);
  }

  try {
    const { hash, fechadas } = await aprovarRegras(escolhidas, agora);
    return NextResponse.json({ ok: true, hash, regras: escolhidas.length, fechadas });
  } catch (e) {
    if (e instanceof CalibracaoError) return erro(e.message, 400);
    console.error("[calibracao regras]", e);
    return erro(e instanceof Error ? e.message : "não consegui gravar as regras", 502);
  }
}
