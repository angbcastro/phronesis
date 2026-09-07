import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { gravarAtomos, gravarEntidades } from "@/lib/atomos";
import { capturarCorrecoes } from "@/lib/calibracao";
import { chaveExtracao } from "@/lib/chaves";
import { normalizarGestos } from "@/lib/correcoes";
import {
  ehPronome,
  normalizarNome,
  normalizarTipoEntidade,
  passadaDeVetores,
} from "@/lib/entidades";
import { normalizarTipo } from "@/lib/extracao";
import { registrarGrafia } from "@/lib/fusao";
import { normalizarCampo } from "@/lib/perfil";
import { getJson } from "@/lib/r2";
import { mencoesDe, sobreDe } from "@/lib/referencias";
import { atualizarSessao, buscarSessao } from "@/lib/sessoes";
import { erro, parametros } from "@/lib/rotas";
import type { AtomoParaGravar, EntidadeParaGravar } from "@/lib/atomos";
import type { AtomoConfirmado } from "@/lib/correcoes";
import type { CampoPerfil, Extracao } from "@/lib/tipos";

export const runtime = "nodejs";
export const maxDuration = 60;

interface AtomoAprovado {
  indice: number;
  texto: string;
  tipo: string;
  sobre: string;
  menciona: string[];
  /**
   * As marcas de perfil que o agente 2 apontou, já com o nome **final** — a
   * revisão pode ter renomeado a entidade, e a marca tem que acompanhar.
   *
   * Vem do corpo pela mesma razão que `sobre` e `menciona` vêm: é conteúdo, e
   * conteúdo eu edito na tela. Procedência (`id`, offsets, `prompt_version`,
   * `modelo`) continua sendo relida do R2 e nunca aceita do navegador.
   */
  perfila?: { entidade?: unknown; campo?: unknown }[];
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
  /**
   * O registro do que eu toquei na revisão (slice 4.6). **Opcional**: corpo sem
   * `gestos` continua confirmando exatamente como antes, e a apuração cai no
   * que dá para inferir por valor. Nenhum 400 novo nasce daqui.
   */
  gestos?: unknown;
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

  /**
   * A grafia que eu falei, e o nó em que ela caiu (slice 4.9).
   *
   * O `citado` é relido de `extracao.json` pelo índice e **nunca** aceito do
   * corpo — é procedência, e vale aqui a mesma regra de `id`, offsets e
   * `prompt_version` (§4.7). A chave final é a da tela, porque é ela que eu
   * decidi.
   */
  const grafias: { chave: string; citado: string }[] = [];

  const atomos: AtomoParaGravar[] = [];
  /**
   * O mesmo que foi gravado, com os nomes **finais** de volta — é contra isto
   * que a apuração de correções compara a proposta, depois da resposta.
   */
  const confirmados: AtomoConfirmado[] = [];
  const nomeDe = (chave: string) => aprovadas.get(chave)?.nome ?? chave;

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

    // Marca de perfil só vale para campo do schema (migration 005) e para
    // entidade que de fato vai virar nó. Marca solta seria aresta pendurada em
    // nada; marca com campo inventado seria schema apodrecido pela porta dos
    // fundos. Silenciosamente descartada, como a menção fora da lista.
    const perfila = [
      ...new Map(
        (Array.isArray(bruto.perfila) ? bruto.perfila : []).flatMap((m) => {
          const campo = normalizarCampo(m?.campo);
          const entidade = normalizarNome(String(m?.entidade ?? ""));
          if (!campo || entidade === "" || !aprovadas.has(entidade)) return [];
          return [[`${entidade}|${campo}`, { entidade, campo: campo as CampoPerfil }] as const];
        }),
      ).values(),
    ];

    const cruas = (Array.isArray(bruto.menciona) ? bruto.menciona : []).map((m) =>
      normalizarNome(String(m)),
    );

    const menciona = [
      ...new Set(cruas.filter((m) => m !== "" && m !== sobre && aprovadas.has(m))),
    ];

    // O sujeito casa sempre; as menções, só quando a lista da tela tem o mesmo
    // tamanho da proposta. Acrescentar ou remover uma menção desloca as
    // posições, e casar grafia com o nó errado criaria um alias mentindo — é a
    // mesma trava que a revisão já aplica às sugestões (§14).
    const originais = mencoesDe(original);
    grafias.push({ chave: sobre, citado: sobreDe(original).citado });
    if (cruas.length === originais.length) {
      cruas.forEach((chave, i) => grafias.push({ chave, citado: originais[i].citado }));
    }

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
      menciona,
      perfila,
    });

    confirmados.push({
      indice: bruto.indice,
      texto,
      tipo,
      sobre: nomeDe(sobre),
      menciona: menciona.map(nomeDe),
    });
  }

  // Só entidade de fato usada por um átomo aprovado. Aprovar na tela e depois
  // rejeitar todos os átomos dela não pode deixar nó órfão no grafo.
  const usadas = new Set(
    atomos.flatMap((a) => [a.sobre, ...a.menciona, ...a.perfila.map((m) => m.entidade)]),
  );
  const entidades = [...usadas].flatMap((chave) => {
    const e = aprovadas.get(chave);
    return e ? [e] : [];
  });

  await gravarEntidades(entidades);
  await gravarAtomos(id, atomos, sessao.iniciada_em);

  // Guarda de status: confirmar duas vezes não reprocessa (regra 4).
  await atualizarSessao(id, { status: "confirmada" }, ["em_revisao"]);

  // O que eu corrigi nesta revisão, apurado **depois** de o grafo já ter
  // recebido tudo e fora do caminho da resposta (slice 4.6). Falhar aqui não
  // desfaz nem atrasa nada: o diário está gravado, o que se perde é material
  // de calibração — e é por isso que o `catch` engole em vez de subir.
  // As entidades que acabaram de nascer não têm vetor, e sem vetor elas não
  // existem para a camada de perfil (4.10). A passada vai aqui, ao lado da
  // apuração de correções e pela mesma razão: fora do caminho da resposta, e
  // engolindo a falha — o diário já está gravado, e o que se perde é uma
  // vizinhança melhor na próxima sessão, não conteúdo.
  // A grafia que eu falei vira alias do nó que eu confirmei (slice 4.9). Em
  // `waitUntil` e **depois** de gravar, pela mesma precedência do embedding:
  // nada no caminho do alias pode impedir uma gravação. Dois efeitos de graça:
  // `fonteDaEntidade` inclui aliases, então o hash muda e a passada de vetores
  // logo abaixo reembute a entidade sozinha; e `nomesParaVocabulario` exclui
  // fundidos, então "Jean" não é ensinado ao STT.
  waitUntil(registrarGrafias(id, grafias));

  waitUntil(passadaDeVetores(`confirmar ${id}`));

  waitUntil(
    capturarCorrecoes({
      proposta: proposta.valor,
      confirmados,
      entidades: [...aprovadas.values()],
      gestos: normalizarGestos(corpo.gestos),
    })
      .then((n) => {
        if (n > 0) console.log(`[calibracao] sessão ${id}: ${n} correção(ões) registrada(s)`);
      })
      .catch((e) => {
        console.error(`[calibracao] sessão ${id}: não consegui registrar as correções:`, e);
      }),
  );

  return NextResponse.json({
    status: "confirmada",
    atomos: atomos.length,
    entidades: entidades.length,
    perfila: atomos.reduce((n, a) => n + a.perfila.length, 0),
    rejeitados: proposta.valor.atomos.length - atomos.length,
  });
}

/**
 * Cada grafia falada que diferiu do nome final, uma vez só.
 *
 * Best-effort por construção: falhar aqui só perde o casamento de graça da
 * próxima sessão, e o sinal é a linha `[grafias]` no log. Quem recusa o que não
 * deve entrar é `registrarGrafia` — pronome, grafia que já é entidade própria,
 * grafia que já é alias de outro nó.
 */
async function registrarGrafias(
  id: string,
  grafias: readonly { chave: string; citado: string }[],
): Promise<void> {
  const vistas = new Set<string>();
  let criadas = 0;

  for (const { chave, citado } of grafias) {
    const par = `${chave}|${normalizarNome(citado)}`;
    if (chave === "" || citado.trim() === "" || vistas.has(par)) continue;
    vistas.add(par);

    try {
      if ((await registrarGrafia(chave, citado)).criada) criadas++;
    } catch (e) {
      console.error(`[grafias] sessão ${id}: não consegui registrar "${citado}":`, e);
    }
  }

  if (criadas > 0) {
    console.log(`[grafias] sessão ${id}: ${criadas} grafia(s) viraram alias`);
  }
}
