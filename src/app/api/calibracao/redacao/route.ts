import { NextResponse } from "next/server";
import { agentePorId, envelopeFaltando } from "@/lib/agentes";
import { confirmarPadroes } from "@/lib/calibracao";
import { efetivo } from "@/lib/overrides";
import { aplicarEdicoes, redigir, RedacaoError } from "@/lib/redacao";
import { erro } from "@/lib/rotas";
import { ehAgenteId } from "@/lib/tipos";
import type { PadraoRascunhado } from "@/lib/calibracao";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/calibracao/redacao — guarda a pauta que eu confirmei e manda o
 * `redacao-1` escrever a emenda.
 *
 * **Os dois passos numa rota só, e a pauta é gravada mesmo assim.** Confirmar
 * e redigir numa ida poupa um round-trip na tela; guardar a pauta no índice
 * antes de chamar o modelo é o que faz eu poder fechar a aba entre confirmar e
 * aprovar sem perder o que eu já decidi.
 *
 * O corpo é a **lista inteira** de padrões que deve valer para aquele agente,
 * não um delta — mesma semântica que `/regras` tinha na 4.6. Descartar um é
 * submeter sem ele, e as correções que o motivavam ficam **em aberto** para a
 * próxima rodada: é o que faz "descartar" ser diferente de "endereçar".
 *
 * **Não grava prompt nenhum.** Devolve as edições e o texto que elas produzem,
 * para eu ler o que mudou seção por seção; quem grava é `/aprovar`.
 */
export async function POST(req: Request) {
  const corpo = (await req.json().catch(() => null)) as
    | { agente?: unknown; padroes?: unknown }
    | null;

  if (!ehAgenteId(corpo?.agente) || !Array.isArray(corpo.padroes)) {
    return erro("corpo inválido: espera { agente, padroes: [] }", 400);
  }

  const agente = agentePorId(corpo.agente);
  if (!agente || agente.base === null) {
    return erro(`o agente "${corpo.agente}" não tem prompt para emendar`, 400);
  }

  const agora = new Date().toISOString();
  const escolhidos: PadraoRascunhado[] = [];

  for (const item of corpo.padroes) {
    const p = item as { id?: unknown; texto?: unknown; cita?: unknown; substitui?: unknown };
    const texto = typeof p?.texto === "string" ? p.texto.trim() : "";
    const id = typeof p?.id === "string" && p.id.trim() !== "" ? p.id.trim() : "";
    // Padrão sem texto é padrão apagado na tela; sem id não dá para dizer o que
    // sobreviveu à minha edição, que é a definição inteira de "confirmar".
    if (texto === "" || id === "") continue;

    escolhidos.push({
      id,
      agente: agente.id,
      texto,
      // `cita` vem do corpo mas é do agente, não meu: é ele que diz quais
      // correções esta rodada vai fechar quando a emenda for aprovada.
      cita: (Array.isArray(p.cita) ? p.cita : []).filter((c): c is string => typeof c === "string"),
      ...(typeof p.substitui === "string" && p.substitui.trim() !== ""
        ? { substitui: p.substitui.trim() }
        : {}),
      criado_em: agora,
    });
  }

  if (escolhidos.length === 0) {
    return erro("não há padrão confirmado para redigir", 400);
  }

  try {
    const meu = await efetivo(agente.id, { prompt: agente.base, modelo: agente.padrao() });
    const pauta = await confirmarPadroes(agente.id, escolhidos, agora);

    const { edicoes, modelo, prompt_version, protegida } = await redigir({
      agente: agente.id,
      papel: agente.papel,
      prompt: meu.prompt,
      envelope: agente.envelope,
      padroes: pauta,
    });

    if (edicoes.length === 0) {
      return NextResponse.json({ edicoes: [], texto: null, modelo, prompt_version, pauta });
    }

    const texto = aplicarEdicoes(meu.prompt, edicoes, { antesDe: protegida });

    // A última porta, e ela roda **aqui** e não só em `/aprovar`: uma emenda que
    // eu não posso aprovar não deve chegar à tela como se eu pudesse.
    const faltando = envelopeFaltando(agente, texto);
    if (faltando.length > 0) {
      return erro(
        `a emenda deixaria o prompt sem ${faltando.join(", ")} — o parser não saberia ler a saída`,
        422,
      );
    }

    return NextResponse.json({
      edicoes,
      texto,
      // O de antes vai junto, como no rascunho de perfil: eu leio o que muda ao
      // lado do que vale, nunca por cima.
      anterior: meu.prompt,
      protegida,
      modelo,
      prompt_version,
      pauta,
    });
  } catch (e) {
    if (e instanceof RedacaoError) return erro(e.message, 400);
    console.error("[calibracao redacao]", e);
    return erro(e instanceof Error ? e.message : "não consegui redigir a emenda", 502);
  }
}
