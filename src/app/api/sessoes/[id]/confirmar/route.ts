import { NextResponse } from "next/server";
import { gravarAtomos, gravarEntidades } from "@/lib/atomos";
import { chaveExtracao } from "@/lib/chaves";
import { ehPronome, normalizarNome, normalizarTipoEntidade } from "@/lib/entidades";
import { normalizarTipo } from "@/lib/extracao";
import { getJson } from "@/lib/r2";
import { atualizarSessao, buscarSessao } from "@/lib/sessoes";
import { erro, parametros } from "@/lib/rotas";
import type { AtomoParaGravar, EntidadeParaGravar } from "@/lib/atomos";
import type { Extracao } from "@/lib/tipos";

export const runtime = "nodejs";
export const maxDuration = 60;

interface AtomoAprovado {
  indice: number;
  texto: string;
  tipo: string;
  sobre: string;
  menciona: string[];
}

/**
 * A entidade chega com o nome **final** — a revisão pode ter renomeado "ela"
 * para "Marina", e é esse nome que vira nó.
 */
interface EntidadeAprovada {
  nome: string;
  tipo?: string;
}

interface Corpo {
  aprovados: AtomoAprovado[];
  entidades: EntidadeAprovada[];
}

/**
 * POST /api/sessoes/:id/confirmar — **o único lugar por onde conteúdo extraído
 * entra no grafo** (regra 5). Nenhum átomo nasce fora daqui.
 *
 * As rotas de `/entidades` também escrevem, mas outra coisa: correção manual de
 * entidade, digitada por mim. A regra 5 é sobre o pipeline não gravar sozinho.
 *
 * O que o cliente pode mandar: quais átomos aprovou e como editou texto, tipo,
 * sujeito e menções. O que ele **não** manda: procedência. `id`, offsets,
 * `prompt_version` e `modelo` são relidos de `extracao.json` pelo índice — se
 * viessem do corpo, a procedência seria só uma afirmação do navegador, e um
 * átomo com procedência falsa é pior que átomo nenhum.
 *
 * Átomo não aprovado simplesmente não é gravado. Entidade não aprovada não vira
 * nó, e as menções a ela caem fora; se ela for o sujeito de um átomo aprovado, a
 * requisição é recusada — átomo sem `:SOBRE` quebraria o contrato do schema.
 *
 * A lista de entidades vem da tela, não da proposta: é o que permite renomear
 * "ela" para um nome de verdade e ainda assim o sujeito dos átomos bater. Nome
 * que continue sendo pronome é recusado aqui também — a regra não pode depender
 * da UI ter sido usada.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const p = parametros(await ctx.params);
  if (!p.ok) return p.resposta;
  const { id } = p;

  const sessao = await buscarSessao(id);
  if (!sessao) return erro("sessão não encontrada", 404);

  if (sessao.status === "confirmada") {
    return NextResponse.json({ status: "confirmada", ja_confirmada: true });
  }
  if (sessao.status !== "em_revisao") {
    return erro(`sessão em '${sessao.status}': não há revisão para confirmar`, 409);
  }

  const proposta = await getJson<Extracao>(chaveExtracao(id));
  if (!proposta) return erro("proposta de extração não está no R2", 404);

  const corpo = (await req.json().catch(() => null)) as Corpo | null;
  if (!corpo || !Array.isArray(corpo.aprovados) || !Array.isArray(corpo.entidades)) {
    return erro("corpo inválido: espera { aprovados: [], entidades: [] }", 400);
  }

  const porIndice = new Map(proposta.valor.atomos.map((a) => [a.indice, a]));

  // Nome final → o que vai virar nó. `nome_normalizado` é a chave em tudo.
  const aprovadas = new Map<string, EntidadeParaGravar>();
  for (const e of corpo.entidades) {
    const nome = String(e?.nome ?? "").trim();
    const chave = normalizarNome(nome);
    if (chave === "") continue;
    if (ehPronome(chave)) {
      return erro(`"${nome}" é um pronome, não um nome — diga quem é antes de confirmar`, 400);
    }
    if (!aprovadas.has(chave)) {
      aprovadas.set(chave, {
        nome,
        nome_normalizado: chave,
        tipo: normalizarTipoEntidade(e?.tipo) ?? "Pessoa",
      });
    }
  }

  const atomos: AtomoParaGravar[] = [];

  for (const bruto of corpo.aprovados) {
    const original = porIndice.get(bruto.indice);
    if (!original) return erro(`átomo ${bruto.indice} não está na proposta`, 400);

    const texto = String(bruto.texto ?? "").trim();
    const tipo = normalizarTipo(bruto.tipo);
    const sobre = normalizarNome(String(bruto.sobre ?? ""));

    if (texto === "") return erro(`átomo ${bruto.indice}: texto vazio`, 400);
    if (tipo === null) return erro(`átomo ${bruto.indice}: tipo inválido`, 400);
    if (sobre === "") return erro(`átomo ${bruto.indice}: sem sujeito`, 400);
    if (!aprovadas.has(sobre)) {
      return erro(`átomo ${bruto.indice}: o sujeito "${bruto.sobre}" não está entre as entidades aprovadas`, 400);
    }

    // Proposta de um prompt anterior pode não ter `trechos`; grava sem âncora
    // em vez de estourar. Re-extrair com `forcar` devolve o formato novo.
    const trechos = (original.trechos ?? []).filter((t) => t.inicio_s !== null);

    atomos.push({
      // Procedência: sempre do servidor, nunca do corpo.
      id: original.id,
      inicios_s: trechos.map((t) => t.inicio_s as number),
      fins_s: trechos.map((t) => (t.fim_s ?? t.inicio_s) as number),
      ancoras: trechos.map((t) => t.ancora),
      prompt_version: original.prompt_version,
      modelo: original.modelo,
      // Conteúdo: o que eu aprovei, com as edições que eu fiz.
      texto,
      tipo,
      sobre,
      menciona: [
        ...new Set(
          (Array.isArray(bruto.menciona) ? bruto.menciona : [])
            .map((m) => normalizarNome(String(m)))
            .filter((m) => m !== "" && m !== sobre && aprovadas.has(m)),
        ),
      ],
    });
  }

  // Só entidade de fato usada por um átomo aprovado. Aprovar na tela e depois
  // rejeitar todos os átomos dela não pode deixar nó órfão no grafo.
  const usadas = new Set(atomos.flatMap((a) => [a.sobre, ...a.menciona]));
  const entidades = [...usadas].flatMap((chave) => {
    const e = aprovadas.get(chave);
    return e ? [e] : [];
  });

  await gravarEntidades(entidades);
  await gravarAtomos(id, atomos, sessao.iniciada_em);

  // Guarda de status: confirmar duas vezes não reprocessa (regra 4).
  await atualizarSessao(id, { status: "confirmada" }, ["em_revisao"]);

  return NextResponse.json({
    status: "confirmada",
    atomos: atomos.length,
    entidades: entidades.length,
    rejeitados: proposta.valor.atomos.length - atomos.length,
  });
}
