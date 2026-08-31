/**
 * Agente 2 — de quem eu estava falando.
 *
 * O fato que decide o desenho: **"Raffa" e "Rapha" são o mesmo som.** O STT
 * escreve uma grafia só para os dois, e ter os dois nomes no vocabulário não
 * ajuda — só torna arbitrário qual sai. A grafia na transcrição carrega **zero**
 * sinal sobre quem é.
 *
 * Isso mata qualquer solução baseada em nome, e é o que separa esta slice da 3.
 * Lá o problema era duas grafias para a mesma coisa, e `nome_normalizado`
 * resolvia. Aqui é o contrário — uma grafia para duas coisas — e a chave não
 * pode resolver, por construção. Só o contexto resolve, e o contexto mora nos
 * três campos de perfil da entidade (migration 005).
 *
 * **O `extracao-5` não muda.** Cinco versões de calibração produziram uma
 * extração que presta; enfiar o catálogo de entidades e a desambiguação dentro
 * daquele prompt arriscaria justamente o que está bom, por um problema que não é
 * dele. Os dois agentes têm `prompt_version` própria (regra 7), calibram
 * separado, e um erro de atribuição se conserta sem tocar na extração. De
 * quebra, este agente roda **sem re-extrair**: calibrar a resolução não custa
 * uma chamada de extração a cada tentativa.
 *
 * **Nada é escrito no grafo.** Este módulo só lê o catálogo e devolve
 * atribuições; quem grava é o confirmar, depois da revisão (regra 5).
 */
import { generateText } from "ai";
import { proximidade } from "./duplicatas";
import { acharPorChave } from "./entidades";
import type { EntidadeDoGrafo } from "./entidades";
import { diagnostico, garantirGateway, modeloResolucao } from "./modelos";
import type { RespostaDoModelo } from "./modelos";
import { normalizarNome } from "./texto";
import { CAMPOS_PERFIL } from "./tipos";
import type { AtomoCru, CampoPerfil, MarcaPerfil, ReferenciaResolvida } from "./tipos";

/** Muda sempre que o prompt mudar — mesma disciplina da extração (regra 7). */
export const PROMPT_VERSION_RESOLUCAO = "resolucao-1";

/** Como a extração: modelo de raciocínio come orçamento antes de escrever JSON. */
const MAX_TOKENS_SAIDA = 4000;

/** Quanto da resposta crua entra no log quando o parse falha. */
const AMOSTRA_ERRO = 400;

/** O que o modelo responde quando a menção não é nenhuma das entidades listadas. */
const NOVA = "NOVA";

export class ResolucaoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResolucaoError";
  }
}

/** Onde no átomo a menção estava. O sujeito é um, as menções são 0..n. */
export type Papel = "sobre" | "menciona";

export interface Mencao {
  atomo: number;
  papel: Papel;
  ordem: number;
  citado: string;
}

export interface Candidatos {
  /** Casamento de chave — inclui as grafias já fundidas no nó (slice 3). */
  exatos: EntidadeDoGrafo[];
  /** Parecidos por string, que é onde o homófono aparece. */
  parecidos: EntidadeDoGrafo[];
}

/**
 * Quem pode ser esta menção.
 *
 * Reusa `proximidade` de `duplicatas.ts`, que pega o caso homófono de brinde:
 * "Rafa" fica a uma ou duas letras de "Raffa" e de "Rapha". É a mesma camada de
 * string da slice 3 — de graça, e boa o bastante para decidir **quando** vale
 * pagar uma chamada de modelo.
 */
export function candidatosDe(
  citado: string,
  catalogo: readonly EntidadeDoGrafo[],
): Candidatos {
  const chave = normalizarNome(citado);
  const exato = acharPorChave(chave, catalogo);
  const exatos = exato ? [exato] : [];

  const parecidos = catalogo.filter(
    (e) => e.id !== exato?.id && proximidade(citado, e.nome) !== null,
  );

  return { exatos, parecidos };
}

export type Decisao =
  | { tipo: "no"; no: EntidadeDoGrafo }
  | { tipo: "nova" }
  | { tipo: "julgar"; candidatos: EntidadeDoGrafo[] };

/**
 * Só se chama o modelo quando há o que decidir.
 *
 * | Situação da menção | O que acontece |
 * |---|---|
 * | um candidato exato, nenhum parecido | resolve ali, de graça |
 * | nenhum candidato | entidade nova, de graça |
 * | qualquer outra coisa | vai ao agente |
 *
 * A última linha cobre o caso traiçoeiro, e é o motivo de ela não ser "dois ou
 * mais candidatos": o STT escreve "Rapha" exatamente, o casamento de string
 * acerta **por sorte**, e como "Raffa" é parecido a menção vai ao agente mesmo
 * assim. Sem isso o sistema acertaria metade das vezes por acidente e erraria a
 * outra metade em silêncio.
 *
 * Um parecido sozinho, sem exato, também vai: decidir entre "é o Raffa" e "é
 * alguém novo chamado Rafa" é exatamente o julgamento que esta slice existe para
 * fazer.
 */
export function decidir(c: Candidatos): Decisao {
  if (c.exatos.length === 1 && c.parecidos.length === 0) return { tipo: "no", no: c.exatos[0] };
  if (c.exatos.length === 0 && c.parecidos.length === 0) return { tipo: "nova" };
  return { tipo: "julgar", candidatos: [...c.exatos, ...c.parecidos] };
}

/** Todas as menções de todos os átomos, na ordem em que a revisão as mostra. */
export function listarMencoes(atomos: readonly AtomoCru[]): Mencao[] {
  const lista: Mencao[] = [];
  atomos.forEach((a, atomo) => {
    lista.push({ atomo, papel: "sobre", ordem: 0, citado: a.sobre });
    (a.menciona ?? []).forEach((citado, ordem) =>
      lista.push({ atomo, papel: "menciona", ordem, citado }),
    );
  });
  return lista;
}

const referenciaAoNo = (citado: string, no: EntidadeDoGrafo, motivo: string): ReferenciaResolvida => ({
  citado,
  entidade: no.nome,
  conhecida: true,
  certo: true,
  alternativas: [],
  motivo,
});

const referenciaNova = (citado: string): ReferenciaResolvida => ({
  citado,
  entidade: citado.trim(),
  conhecida: false,
  certo: true,
  alternativas: [],
  motivo: "",
});

const INSTRUCOES = `Você recebe os átomos extraídos de um diário falado pessoal, em português, e a lista de pessoas, projetos e objetivos que já existem no diário — cada um com o perfil que o dono escreveu.

Sua tarefa é decidir, para cada MENÇÃO EM DÚVIDA, a qual dessas entidades ela se refere — ou se é alguém/algo novo.

POR QUE ISSO É DIFÍCIL
Nomes que soam igual ("Raffa" e "Rapha") chegam da transcrição com UMA grafia só, escolhida pelo transcritor. A grafia NÃO diz quem é. O que diz é o contexto: o que a pessoa faz, o que ela sabe, o que já foi feito junto com ela. O campo "fizemos juntos" costuma ser o sinal mais forte, porque atividade compartilhada é o que aparece na transcrição.

COMO DECIDIR
- Compare o que o átomo diz com o perfil de cada candidato.
- Se o átomo casa claramente com o perfil de um deles, escolha esse, com "certo": true.
- Se nada no átomo distingue os candidatos ("falei com o Rafa hoje"), escolha o mais provável e marque "certo": false. A dúvida vai ser mostrada para o dono decidir; ela é útil, não é fracasso.
- Se nenhum candidato serve — o contexto contradiz todos —, responda "${NOVA}". Duas entidades a mais é grafo um pouco sujo; atribuir ao errado é grafo mentindo.
- Nunca invente uma entidade que não está na lista. Ou uma das chaves oferecidas, ou "${NOVA}".

INFORMAÇÃO DE PERFIL
Além disso, aponte os átomos que dizem algo que MERECE ENTRAR no perfil de alguém, nestes três campos:
  contexto          quem a pessoa é para o dono do diário e qualquer outro contexto relevante sobre ela — a relação, o papel, o momento de vida, o que está acontecendo com ela
  pode_ajudar_com   o que ela sabe, com o que já trabalhou, o que sabe fazer
  fizemos_juntos    o que o dono e ela fizeram juntos

A informação é DE QUEM ELA FALA, não de quem é o sujeito do átomo: "fui no parque andar de slackline com o Raffa" é um átomo sobre "eu", e a informação de perfil é do Raffa, no campo fizemos_juntos.
Só aponte quando o átomo de fato acrescenta algo duradouro sobre a pessoa. Trivialidade do dia não é perfil. Lista vazia é resposta legítima e comum.
A entidade apontada tem que ser uma das que o próprio átomo cita.

FORMATO
Responda somente com JSON, sem texto antes ou depois:
{"referencias":[{"n":1,"entidade":"<chave da lista ou ${NOVA}>","certo":true,"motivo":"<uma frase curta>"}],
 "perfil":[{"atomo":0,"entidade":"<chave da lista>","campo":"fizemos_juntos"}]}

"motivo" é uma frase curta, em português, dizendo o que no átomo te fez escolher. Ela é mostrada ao dono quando você marca "certo": false.`;

/** Como cada entidade aparece no prompt: nome, tipo e o que o dono escreveu dela. */
function descrever(e: EntidadeDoGrafo): string {
  const campos = CAMPOS_PERFIL.flatMap((c) =>
    e.perfil[c] ? [`    ${c}: ${e.perfil[c]}`] : [],
  );
  const cabeca = `- chave "${e.nome_normalizado}" — ${e.nome} (${e.tipo.toLowerCase()}, ${e.sessoes} sessão(ões))`;
  const alias = e.aliases.length > 0 ? `\n    também escrito: ${e.aliases.join(", ")}` : "";
  const perfil = campos.length > 0 ? `\n${campos.join("\n")}` : "\n    (sem perfil escrito)";
  return cabeca + alias + perfil;
}

export function montarPrompt(
  atomos: readonly AtomoCru[],
  pendentes: readonly { n: number; mencao: Mencao; candidatos: EntidadeDoGrafo[] }[],
  catalogo: readonly EntidadeDoGrafo[],
): string {
  const listaAtomos = atomos
    .map((a, i) => `${i}. [${a.tipo}] ${a.texto}\n   trecho: ${(a.trechos ?? [])[0] ?? ""}`)
    .join("\n");

  const listaEntidades = catalogo.map(descrever).join("\n");

  const listaPendentes = pendentes
    .map(
      ({ n, mencao, candidatos }) =>
        `${n}. no átomo ${mencao.atomo}, o extrator escreveu "${mencao.citado}" ` +
        `(${mencao.papel === "sobre" ? "sujeito" : "menção"}). ` +
        `Candidatos: ${candidatos.map((c) => `"${c.nome_normalizado}"`).join(", ")}`,
    )
    .join("\n");

  return `${INSTRUCOES}

ÁTOMOS DESTA SESSÃO:
${listaAtomos}

ENTIDADES QUE JÁ EXISTEM:
${listaEntidades}

MENÇÕES EM DÚVIDA:
${listaPendentes}`;
}

interface JulgamentoCru {
  n?: unknown;
  entidade?: unknown;
  certo?: unknown;
  motivo?: unknown;
}

interface MarcaCru {
  atomo?: unknown;
  entidade?: unknown;
  campo?: unknown;
}

export interface RespostaResolucao {
  referencias: JulgamentoCru[];
  perfil: MarcaCru[];
}

/** Mesma tolerância da extração: cerca de markdown, frase antes, array solto. */
export function parsearResposta(bruto: string): RespostaResolucao {
  const semCerca = bruto.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "");
  const inicio = semCerca.indexOf("{");
  const fim = semCerca.lastIndexOf("}");
  if (inicio === -1 || fim <= inicio) {
    throw new ResolucaoError(`resposta sem JSON reconhecível: ${bruto.slice(0, AMOSTRA_ERRO)}`);
  }

  let cru: unknown;
  try {
    cru = JSON.parse(semCerca.slice(inicio, fim + 1));
  } catch (e) {
    throw new ResolucaoError(
      `resposta não é JSON válido: ${e instanceof Error ? e.message : String(e)}. ` +
        `Vieram ${bruto.length} caractere(s): ${bruto.slice(0, AMOSTRA_ERRO)}`,
    );
  }

  const obj = (cru ?? {}) as { referencias?: unknown; perfil?: unknown };
  return {
    referencias: Array.isArray(obj.referencias) ? (obj.referencias as JulgamentoCru[]) : [],
    perfil: Array.isArray(obj.perfil) ? (obj.perfil as MarcaCru[]) : [],
  };
}

/** O que a resolução devolve: uma atribuição por menção, e as marcas de perfil. */
export interface Atribuicoes {
  sobre: ReferenciaResolvida[];
  menciona: ReferenciaResolvida[][];
  perfila: MarcaPerfil[][];
  /** `null` quando nenhuma menção precisou de julgamento — ninguém pagou nada. */
  modelo: string | null;
  prompt_version: string | null;
}

const normalizarCampo = (v: unknown): CampoPerfil | null =>
  typeof v === "string" && (CAMPOS_PERFIL as readonly string[]).includes(v.trim().toLowerCase())
    ? (v.trim().toLowerCase() as CampoPerfil)
    : null;

/**
 * Dos átomos crus às atribuições, menção por menção.
 *
 * Uma passada determinística e de graça monta os candidatos de cada menção; só o
 * que sobra em dúvida vai ao modelo, numa chamada só para a sessão inteira. Se
 * nada sobrar, o modelo **não é chamado** e a sessão não paga nada.
 *
 * Falha do agente não derruba a extração, que já foi paga: as menções em dúvida
 * voltam com `certo: false` e o motivo dizendo o que houve. A revisão destaca
 * cada uma e eu escolho na mão — muito melhor que perder a proposta inteira.
 */
export async function resolverReferencias(
  atomos: readonly AtomoCru[],
  catalogo: readonly EntidadeDoGrafo[],
): Promise<Atribuicoes> {
  const mencoes = listarMencoes(atomos);
  const resolvidas = new Map<Mencao, ReferenciaResolvida>();
  const pendentes: { n: number; mencao: Mencao; candidatos: EntidadeDoGrafo[] }[] = [];

  for (const m of mencoes) {
    const decisao = decidir(candidatosDe(m.citado, catalogo));
    if (decisao.tipo === "no") {
      resolvidas.set(m, referenciaAoNo(m.citado, decisao.no, "casou com o nome no grafo"));
    } else if (decisao.tipo === "nova") {
      resolvidas.set(m, referenciaNova(m.citado));
    } else {
      pendentes.push({ n: pendentes.length + 1, mencao: m, candidatos: decisao.candidatos });
    }
  }

  // As entidades que esta sessão pode citar. O catálogo inteiro não vai ao
  // prompt de propósito: uma menção só pode resolver para um candidato dela, e
  // mandar o resto seria pagar por texto que não muda resposta nenhuma.
  const envolvidas = new Map<string, EntidadeDoGrafo>();
  for (const r of resolvidas.values()) {
    const no = acharPorChave(normalizarNome(r.entidade), catalogo);
    if (no) envolvidas.set(no.id, no);
  }
  for (const p of pendentes) for (const c of p.candidatos) envolvidas.set(c.id, c);

  let julgamentos = new Map<number, JulgamentoCru>();
  let marcas: MarcaCru[] = [];
  let modelo: string | null = null;
  let falha: string | null = null;

  if (pendentes.length > 0) {
    garantirGateway();
    modelo = modeloResolucao();

    // Guardada fora do `try` porque é no `catch` que ela interessa: este agente
    // usa o mesmo modelo de raciocínio da extração e tem o mesmo modo de falha —
    // saída vazia porque o pensamento comeu o orçamento. Sem o diagnóstico, o
    // log diz "falhou" e não diz o que fazer a respeito (ARCHITECTURE.md §4.6).
    let resposta: RespostaDoModelo | null = null;
    try {
      const r = await generateText({
        // String de propósito: id em string sai pelo Gateway (regra 8).
        model: modelo,
        prompt: montarPrompt(atomos, pendentes, [...envolvidas.values()]),
        temperature: 0,
        maxOutputTokens: MAX_TOKENS_SAIDA,
      });
      resposta = r;
      // Antes do parse: o modelo que de fato atendeu é procedência, e vale
      // registrar mesmo quando a resposta dele não presta.
      modelo = r.response?.modelId ?? modelo;

      const lido = parsearResposta(r.text ?? "");
      julgamentos = new Map(
        lido.referencias.flatMap((j) => (typeof j.n === "number" ? [[j.n, j] as const] : [])),
      );
      marcas = lido.perfil;
    } catch (e) {
      falha = e instanceof Error ? e.message : String(e);
      console.error(
        `[resolucao] o agente falhou; ${pendentes.length} menção(ões) ficam em dúvida:`,
        resposta ? `${falha} — ${diagnostico(resposta)}` : falha,
      );
    }
  }

  for (const { n, mencao, candidatos } of pendentes) {
    const nomes = candidatos.map((c) => c.nome);
    const j = julgamentos.get(n);
    const escolhida = typeof j?.entidade === "string" ? j.entidade.trim() : "";
    const motivo = typeof j?.motivo === "string" ? j.motivo.trim() : "";

    const alvo =
      escolhida === "" || escolhida.toUpperCase() === NOVA
        ? undefined
        : candidatos.find((c) => c.chaves.includes(normalizarNome(escolhida)));

    if (escolhida.toUpperCase() === NOVA) {
      resolvidas.set(mencao, {
        citado: mencao.citado,
        entidade: mencao.citado.trim(),
        conhecida: false,
        certo: j?.certo !== false,
        alternativas: nomes,
        motivo: motivo || "o agente não viu nenhuma das conhecidas neste átomo",
      });
      continue;
    }

    if (alvo) {
      resolvidas.set(mencao, {
        citado: mencao.citado,
        entidade: alvo.nome,
        conhecida: true,
        certo: j?.certo !== false,
        alternativas: nomes.filter((nome) => nome !== alvo.nome),
        motivo,
      });
      continue;
    }

    // Sem resposta, ou resposta que não é nenhum dos candidatos. O fallback é o
    // casamento exato quando existe, e entidade nova quando não — nunca o
    // parecido. Duas entidades a mais eu conserto em /entidades; fundir duas
    // pessoas por um palpite não tem desfazer.
    const exato = candidatos.find((c) => c.chaves.includes(normalizarNome(mencao.citado)));
    resolvidas.set(mencao, {
      citado: mencao.citado,
      entidade: exato ? exato.nome : mencao.citado.trim(),
      conhecida: Boolean(exato),
      certo: false,
      alternativas: exato ? nomes.filter((nome) => nome !== exato.nome) : nomes,
      motivo: falha
        ? "o agente de resolução falhou nesta sessão — escolha você"
        : "o agente não respondeu por esta menção",
    });
  }

  // De volta à forma do átomo.
  const sobre: ReferenciaResolvida[] = [];
  const menciona: ReferenciaResolvida[][] = atomos.map(() => []);
  for (const m of mencoes) {
    const r = resolvidas.get(m);
    if (!r) continue;
    if (m.papel === "sobre") sobre[m.atomo] = r;
    else menciona[m.atomo][m.ordem] = r;
  }

  return {
    sobre,
    menciona: menciona.map((lista) => lista.filter(Boolean)),
    perfila: validarMarcas(marcas, sobre, menciona, atomos.length),
    modelo,
    prompt_version: pendentes.length > 0 ? PROMPT_VERSION_RESOLUCAO : null,
  };
}

/**
 * A marca de perfil só vale se apontar para uma entidade que o **próprio átomo**
 * cita, num dos três campos. É o que impede o agente de pendurar informação num
 * nó que não tem nada a ver com aquela frase.
 */
export function validarMarcas(
  marcas: readonly MarcaCru[],
  sobre: readonly ReferenciaResolvida[],
  menciona: readonly ReferenciaResolvida[][],
  total: number,
): MarcaPerfil[][] {
  const porAtomo: MarcaPerfil[][] = Array.from({ length: total }, () => []);

  for (const m of marcas) {
    const i = typeof m.atomo === "number" ? m.atomo : Number.NaN;
    const campo = normalizarCampo(m.campo);
    const alvo = typeof m.entidade === "string" ? normalizarNome(m.entidade) : "";
    if (!Number.isInteger(i) || i < 0 || i >= total || !campo || alvo === "") continue;

    const doAtomo = [sobre[i], ...(menciona[i] ?? [])].filter(Boolean);
    const ref = doAtomo.find(
      (r) => normalizarNome(r.entidade) === alvo || normalizarNome(r.citado) === alvo,
    );
    if (!ref) continue;

    const ja = porAtomo[i].some((x) => x.campo === campo && x.entidade === ref.entidade);
    if (!ja) porAtomo[i].push({ entidade: ref.entidade, campo });
  }

  return porAtomo;
}
