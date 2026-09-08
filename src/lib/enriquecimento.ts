/**
 * O agente 4 — `enriquecimento-1` — e a fila que o faz andar sem janela aberta
 * (slice 4.12).
 *
 * **O que ele faz:** lê **todos** os átomos ativos que falam de uma entidade e
 * escreve a ficha inteira de uma vez — `resumo` e os três campos de perfil.
 *
 * **Por que ele existe.** A 4.11 criou o `resumo` e o deixou vazio de propósito:
 * ele é o que os dois agentes leem por padrão, e enquanto estiver em branco toda
 * menção cai na segunda passada (`desempate.ts`). O sistema funciona — a segunda
 * passada carrega o perfil inteiro, que é o que o agente 2 lia antes da 4.11 —,
 * mas paga uma chamada de modelo a mais por janela para chegar onde já chegava.
 *
 * **Por que o agente 3 nunca foi suficiente.** `perfil.ts` é sob demanda, um
 * campo por vez, e lê no máximo 20 átomos, **só os marcados por `:PERFILA`**. A
 * marca vem do agente 2, que só a põe quando o átomo "de fato acrescenta algo
 * duradouro" — e lista vazia é resposta legítima e comum. O resultado é que a
 * maior parte do que o diário sabe de uma pessoa nunca chegava ao perfil dela.
 * Aqui não há filtro e não há teto: `:SOBRE` + `:MENCIONA`, todos, do mais novo
 * para o mais velho.
 *
 * **Ele escreve sozinho, e isso é a reabertura consciente do §4.9.** Até esta
 * fatia nada entrava no perfil sem o meu toque campo a campo, porque perfil
 * errado contamina toda atribuição futura e o erro se realimenta. A tela de
 * aprovação em lote foi recusada — ela é o próprio atrito que deixou as fichas
 * vazias —, e a defesa passou a ser outra: **eu escolho quem entra na fila, eu
 * leio a ficha depois, e o desfazer está a um toque** (`_anterior`, migration
 * 010).
 *
 * **A regra 5 do `CLAUDE.md` continua valendo inteira**: ela fala de átomo e da
 * tela de revisão, e nenhum átomo entra no grafo por este caminho.
 *
 * A fila é **estado idempotente mais `waitUntil`**, que é como a transcrição por
 * blocos anda desde a slice 2: o estado mora no nó (010), não no navegador, e
 * por isso fechar a aba não interrompe nada.
 */
import { generateText } from "ai";
import type { EntidadeDoGrafo } from "./entidades";
import { comEsperaDeLimite } from "./limite";
import {
  diagnostico,
  faltouOrcamento,
  garantirGateway,
  modeloEnriquecimento,
  textoDaResposta,
  veioDoPensamento,
} from "./modelos";
import { query } from "./neo4j";
import { carimbo, efetivo } from "./overrides";
import { normalizarNome } from "./texto";
import { CAMPOS_PERFIL, PERFIL_VAZIO, ROTULO_TIPO_ENTIDADE, TETO_RESUMO } from "./tipos";
import type { EstadoEnriquecimento, Perfil } from "./tipos";

/** Muda sempre que o prompt mudar — mesma disciplina de todo agente (regra 7). */
export const PROMPT_VERSION_ENRIQUECIMENTO = "enriquecimento-1";

/**
 * O orçamento de saída. Quatro campos, um deles com teto de 500 e três sem teto
 * nenhum — mas "sem teto" é sobre o schema, não sobre o que cabe numa ficha que
 * se lê rápido. O que costuma estourar aqui é o raciocínio, não o texto, e para
 * isso existe o `FATOR_DE_FOLGA` como nos outros agentes.
 */
const MAX_TOKENS_SAIDA = 4000;

/** Como em `resolucao.ts` e `desempate.ts`: o que a segunda tentativa ganha. */
const FATOR_DE_FOLGA = 2;

/** Quanto da resposta crua entra no log quando o parse falha. */
const AMOSTRA_ERRO = 400;

export class EnriquecimentoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnriquecimentoError";
  }
}

// ──────────────────────── o que o modelo recebe ────────────────────────

/** Um átomo como o lote o vê. Sem id: o agente não referencia átomo nenhum. */
export interface AtomoDaEntidade {
  texto: string;
  tipo: string;
  valido_em: string;
  /** `true` quando a entidade é o sujeito (`:SOBRE`), e não só citada. */
  sobre: boolean;
}

/**
 * **Todos** os átomos ativos que falam da entidade, do mais novo para o mais
 * velho.
 *
 * Sem `LIMIT`, e é decisão da fatia: "incremental — o resumo atual mais os
 * átomos novos" teria custo constante por rodada e é o desenho que o agente 3
 * usa, mas um erro escrito numa rodada se perpetuaria nas seguintes — a ficha
 * carregaria para sempre o que uma rodada ruim escreveu. Relendo tudo,
 * **reordenar prioridade é só rodar de novo**.
 *
 * Atravessa alias como toda leitura de entidade deste sistema: pedir a ficha de
 * uma grafia já fundida tem de ler os átomos do vencedor.
 */
export async function atomosDaEntidade(chaveOuNome: string): Promise<AtomoDaEntidade[]> {
  const chave = normalizarNome(chaveOuNome);
  if (chave === "") return [];

  const linhas = await query<{
    texto: string;
    tipo: string;
    valido_em: string;
    sobre: boolean;
  }>(
    `MATCH (e:Entidade { nome_normalizado: $chave })
     OPTIONAL MATCH (e)-[:FUNDIDA_EM]->(v:Entidade)
     WITH coalesce(v, e) AS alvo
     MATCH (a:Atomo)-[r:SOBRE|MENCIONA]->(alvo)
     WHERE coalesce(a.status, 'ativo') = 'ativo'
     // O agrupamento é pelo NÓ, num WITH próprio: agrupar pelo texto juntaria
     // dois átomos que dizem a mesma frase, e somar propriedade (chave de
     // agrupamento) a agregação no mesmo RETURN é ilegal em Cypher — o erro só
     // aparece contra o banco de verdade, como o de garantirEmbeddings.
     WITH a, collect(type(r)) AS papeis
     RETURN a.texto AS texto, a.tipo AS tipo,
            coalesce(a.valido_em, '') AS valido_em,
            'SOBRE' IN papeis AS sobre
     ORDER BY valido_em DESC`,
    { chave },
  );

  return linhas.filter((l) => typeof l.texto === "string" && l.texto.trim() !== "");
}

const COMO_USAR: Record<keyof Perfil, string> = {
  contexto:
    "quem essa entidade é para o dono do diário — a relação, o papel, onde ela entra na vida dele — e qualquer outro contexto relevante sobre ela: momento de vida, situação, o que está acontecendo",
  pode_ajudar_com: "o que essa entidade sabe, com o que já trabalhou, o que sabe fazer",
  fizemos_juntos: "o que o dono do diário e essa entidade já fizeram juntos",
};

/**
 * O prompt.
 *
 * **O texto de `COMO_USAR` é o de `perfil.ts`, palavra por palavra.** Ele foi
 * escrito com cuidado e a fatia decidiu não mexer nele: dois agentes escrevem
 * nos mesmos três campos, e duas descrições diferentes do mesmo campo é como
 * eles passariam a divergir.
 *
 * **O que é novo é a instrução do `resumo`**, e ela é a razão da fatia: retrato
 * de **identidade**, não retrato completo. A primeira frase é sempre o que
 * distingue esta entidade de outra parecida — se o que distingue não couber nos
 * 500, a segunda passada volta a ser a regra e a fatia não terá servido para
 * nada.
 *
 * **"Só afirme o que os átomos sustentam" é a regra que mais importa aqui**,
 * porque ninguém revisa antes de gravar. É a diferença entre este prompt e o do
 * agente 3, onde eu leio o proposto ao lado do atual antes de qualquer escrita.
 */
export const INSTRUCOES = `Você escreve a ficha de uma entidade num diário pessoal falado. Recebe TUDO o que o diário já disse sobre ela — todos os trechos, do mais novo para o mais velho — e devolve os quatro campos da ficha de uma vez.

O QUE VOCÊ ESTÁ ESCREVENDO

resumo — o RETRATO DE IDENTIDADE. Quem essa entidade é para o dono do diário e, antes de tudo, O QUE A DISTINGUE DE OUTRA PARECIDA. A primeira frase é sempre o que distingue: o sobrenome, o trabalho, o lugar, a relação — o detalhe que faria alguém escolher entre duas pessoas de mesmo nome. O que sobrar do espaço leva o resto. No máximo ${TETO_RESUMO} caracteres.

contexto — ${COMO_USAR.contexto}

pode ajudar com — ${COMO_USAR.pode_ajudar_com}

fizemos juntos — ${COMO_USAR.fizemos_juntos}

REGRAS
- SÓ AFIRME O QUE OS TRECHOS SUSTENTAM. Não deduza, não complete com o que "costuma ser", não invente sobrenome, cargo, cidade nem relação. Ninguém revisa este texto antes de ele ser gravado, e uma frase que nenhum trecho sustenta passa a decidir a quem os próximos átomos pertencem.
- Escreva na terceira pessoa, direto, sem floreio. É uma anotação para ser lida rápido, não um parágrafo bonito.
- Junte o que se repete numa frase só. O que aparece muitas vezes é mais importante que o que apareceu uma vez.
- Trecho mais novo vence trecho mais velho quando os dois se contradizem.
- Campo sem material nos trechos volta como string vazia. Vazio é resposta legítima — inventar para preencher é o pior que você pode fazer aqui.
- Não cite datas de trecho nem numere nada: a ficha fala da entidade, não do diário.

FORMATO
Responda somente com JSON, sem texto antes ou depois:
{"resumo":"...","contexto":"...","pode_ajudar_com":"...","fizemos_juntos":"..."}`;

/** O bloco de átomos. Tipo e data entram: os dois pesam na decisão do agente. */
export function blocoDeAtomos(atomos: readonly AtomoDaEntidade[]): string {
  return atomos
    .map((a) => {
      const quando = a.valido_em === "" ? "" : ` ${a.valido_em.slice(0, 10)}`;
      return `- [${a.tipo}${quando}]${a.sobre ? "" : " (citada)"} ${a.texto}`;
    })
    .join("\n");
}

export function montarPrompt(
  e: Pick<EntidadeDoGrafo, "nome" | "tipo" | "aliases">,
  atomos: readonly AtomoDaEntidade[],
  base: string = INSTRUCOES,
): string {
  const grafias = e.aliases.length > 0 ? `\nTAMBÉM ESCRITA: ${e.aliases.join(", ")}` : "";

  return `${base}

ENTIDADE: ${e.nome} (${ROTULO_TIPO_ENTIDADE[e.tipo]})${grafias}

TUDO O QUE O DIÁRIO DIZ DELA (${atomos.length} trecho(s), do mais novo para o mais velho):
${blocoDeAtomos(atomos)}`;
}

// ──────────────────────── o que o modelo devolve ────────────────────────

/** A ficha inteira, como o agente a escreve. */
export interface Ficha {
  resumo: string;
  perfil: Perfil;
}

export interface FichaEscrita extends Ficha {
  /** Quantos átomos entraram nesta rodada. */
  atomos: number;
  modelo: string;
  prompt_version: string;
}

const texto = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * Mesma tolerância dos outros agentes: cerca de markdown, frase antes do JSON.
 *
 * **Campo ausente vira string vazia, e não erro.** O prompt diz que campo sem
 * material volta vazio, então a resposta com três campos é uma resposta
 * legítima. O corte do `resumo` em `TETO_RESUMO` acontece aqui, e não só na
 * gravação: é o mesmo teto que `gravarResumo` aplica, e quem lê o log tem de ver
 * o texto que vai ser gravado.
 */
export function parsearFicha(bruto: string): Ficha {
  const semCerca = bruto.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "");
  const inicio = semCerca.indexOf("{");
  const fim = semCerca.lastIndexOf("}");
  if (inicio === -1 || fim <= inicio) {
    throw new EnriquecimentoError(
      `resposta sem JSON reconhecível: ${bruto.slice(0, AMOSTRA_ERRO)}`,
    );
  }

  let v: Record<string, unknown>;
  try {
    v = JSON.parse(semCerca.slice(inicio, fim + 1)) as Record<string, unknown>;
  } catch (e) {
    throw new EnriquecimentoError(
      `JSON inválido: ${e instanceof Error ? e.message : String(e)} — ${bruto.slice(0, AMOSTRA_ERRO)}`,
    );
  }

  const ficha: Ficha = {
    resumo: texto(v.resumo).slice(0, TETO_RESUMO),
    perfil: { ...PERFIL_VAZIO },
  };
  for (const campo of CAMPOS_PERFIL) ficha.perfil[campo] = texto(v[campo]);

  // Os quatro vazios querem dizer que o modelo não escreveu ficha nenhuma —
  // gravar isso sobre o que estava lá seria perda, e é o único caso em que o
  // resultado de uma rodada não vale a escrita.
  if (ficha.resumo === "" && CAMPOS_PERFIL.every((c) => ficha.perfil[c] === "")) {
    throw new EnriquecimentoError(
      `os quatro campos voltaram vazios: ${bruto.slice(0, AMOSTRA_ERRO)}`,
    );
  }

  return ficha;
}

/**
 * O agente escreve a ficha. **Não grava nada** — quem grava é `gravarFicha`, no
 * elo da fila.
 *
 * `comEsperaDeLimite` **sem `ate`**: não há ninguém esperando do outro lado da
 * tela, então a fila pode dormir o quanto o Gateway pedir. É a diferença entre
 * este agente e os que rodam dentro da extração de uma janela.
 */
export async function escreverFicha(
  e: Pick<EntidadeDoGrafo, "nome" | "tipo" | "aliases">,
  atomos: readonly AtomoDaEntidade[],
): Promise<FichaEscrita> {
  if (atomos.length === 0) {
    throw new EnriquecimentoError("nenhum átomo fala desta entidade");
  }

  garantirGateway();
  const meu = await efetivo("enriquecimento", {
    prompt: INSTRUCOES,
    modelo: modeloEnriquecimento(),
  });
  const prompt = montarPrompt(e, atomos, meu.prompt);

  const chamar = (teto: number) =>
    comEsperaDeLimite(`enriquecimento ${meu.modelo}`, () =>
      generateText({
        // String de propósito: id em string sai pelo Gateway (regra 8).
        model: meu.modelo,
        prompt,
        temperature: 0,
        maxOutputTokens: teto,
        // A espera longa daqui é a única camada de retry, como na resolução.
        maxRetries: 0,
      }),
    );

  let r = await chamar(MAX_TOKENS_SAIDA);
  if (faltouOrcamento(r)) {
    console.warn(
      `[enriquecimento] ${e.nome}: o raciocínio comeu o orçamento; repetindo com teto de ` +
        `${MAX_TOKENS_SAIDA * FATOR_DE_FOLGA}.`,
      diagnostico(r),
    );
    r = await chamar(MAX_TOKENS_SAIDA * FATOR_DE_FOLGA);
  }

  if (veioDoPensamento(r)) {
    console.warn(
      `[enriquecimento] ${e.nome}: texto vazio, lendo o JSON do pensamento.`,
      diagnostico(r),
    );
  }

  return {
    ...parsearFicha(textoDaResposta(r)),
    atomos: atomos.length,
    modelo: r.response?.modelId ?? meu.modelo,
    prompt_version: carimbo(PROMPT_VERSION_ENRIQUECIMENTO, meu.hash),
  };
}

// ──────────────────────── a gravação, e o desfazer ────────────────────────

/** O erro cabe na linha da entidade; a causa inteira fica no log. */
export const TETO_MOTIVO = 300;

/**
 * Os quatro campos da ficha, e onde cada um guarda a geração anterior.
 *
 * A lista mora aqui porque três escritas dependem dela na mesma ordem — gravar,
 * desfazer e o `tem_anterior` de `listarEntidades` —, e uma delas esquecer um
 * campo seria o desfazer restaurando três dos quatro sem erro nenhum.
 *
 * Nome de propriedade não vem de parâmetro em Neo4j, então ele vai literal no
 * Cypher — mesmo padrão de `statementDeCampo` (`perfil.ts`) e do label literal
 * de `atomos.ts`, e seguro pela mesma razão: sai daqui, constante fechada, e
 * nunca do cliente.
 */
export const CAMPOS_DA_FICHA = ["resumo", ...CAMPOS_PERFIL] as const;

export type CampoDaFicha = (typeof CAMPOS_DA_FICHA)[number];

export const anteriorDe = (campo: CampoDaFicha): string => campo + "_anterior";

/** O `SET` que empurra o que está gravado para a geração anterior. */
const GUARDAR_ANTERIOR = CAMPOS_DA_FICHA.map(
  (c) => `alvo.${anteriorDe(c)} = coalesce(alvo.${c}, '')`,
).join(",\n         ");

/** O `SET` que escreve a ficha nova. Cláusula separada, e a ordem importa. */
const ESCREVER_FICHA = CAMPOS_DA_FICHA.map((c) => `alvo.${c} = $${c}`).join(",\n         ");

/**
 * A troca do desfazer: o campo recebe o `_anterior`, e o `_anterior` recebe o
 * que estava no campo. Os dois lados são lidos **antes** de qualquer escrita,
 * num mapa `velho` — sem isso a segunda metade leria o que a primeira acabou de
 * escrever, e a troca viraria um no-op silencioso.
 */
const LER_VELHO = [
  ...CAMPOS_DA_FICHA.map((c) => `${c}: coalesce(alvo.${anteriorDe(c)}, '')`),
  ...CAMPOS_DA_FICHA.map((c) => `atual_${c}: coalesce(alvo.${c}, '')`),
].join(", ");

const TROCAR = [
  ...CAMPOS_DA_FICHA.map((c) => `alvo.${c} = velho.${c}`),
  ...CAMPOS_DA_FICHA.map((c) => `alvo.${anteriorDe(c)} = velho.atual_${c}`),
].join(",\n         ");

/** As quatro strings guardadas, para saber se existe geração anterior. */
const GUARDADOS = CAMPOS_DA_FICHA.map((c) => `velho.${c}`).join(", ");

/**
 * O começo de toda escrita de ficha: acha a entidade e atravessa alias.
 *
 * Escrever no perdedor de uma fusão tem de ir para o vencedor, senão o texto
 * ficaria num nó que nenhuma leitura enxerga — mesma regra de `gravarCampo` e
 * `gravarResumo`.
 */
const ACHAR_ALVO = `MATCH (e:Entidade { nome_normalizado: $chave })
     OPTIONAL MATCH (e)-[:FUNDIDA_EM]->(v:Entidade)
     WITH coalesce(v, e) AS alvo`;

export interface EntidadeEscrita {
  id: string;
  nome: string;
}

/**
 * Grava a ficha, guardando a geração anterior, e marca a entidade como
 * `pronta`.
 *
 * **Uma consulta só**, e as duas cláusulas `SET` em ordem: a primeira empurra o
 * que está lá para o `_anterior`, a segunda escreve por cima. Numa cláusula só a
 * ordem de avaliação decidiria o resultado, e a decisão mais importante desta
 * fatia — que existe uma geração para voltar — dependeria de uma sutileza de
 * Cypher.
 *
 * **É a única escrita de conteúdo deste sistema que não passa pelo meu toque
 * campo a campo**, e é a reabertura declarada do §4.9. O que a substitui é a
 * seleção, o botão, e o desfazer logo abaixo.
 */
export async function gravarFicha(
  chaveOuNome: string,
  ficha: Ficha,
  atomos: number,
  agora: Date = new Date(),
): Promise<EntidadeEscrita> {
  const chave = normalizarNome(chaveOuNome);
  if (chave === "") throw new EnriquecimentoError("gravar ficha exige a entidade");

  const r = await query<EntidadeEscrita>(
    `${ACHAR_ALVO}
     SET ${GUARDAR_ANTERIOR}
     SET ${ESCREVER_FICHA}
     SET alvo.enriquecimento_estado = 'pronta',
         alvo.enriquecimento_em = $agora,
         alvo.enriquecimento_atomos = $atomos,
         alvo.enriquecimento_motivo = ''
     RETURN alvo.id AS id, alvo.nome AS nome`,
    {
      chave,
      resumo: ficha.resumo.slice(0, TETO_RESUMO),
      ...ficha.perfil,
      atomos,
      agora: agora.toISOString(),
    },
  );
  if (r.length === 0) throw new EnriquecimentoError(`"${chaveOuNome}" não está no grafo`);
  return r[0];
}

/**
 * Marca o estado sem tocar na ficha: `na_fila`, `rodando` ou `falhou`.
 *
 * A ficha e o estado se separam aqui de propósito. Um elo que morre entre
 * gravar a ficha e marcar `pronta` deixa a entidade em `rodando` até a retomada
 * — a ficha já está escrita, e a próxima rodada a reescreve a partir dos mesmos
 * átomos. Não há perda, só trabalho repetido (§14).
 */
export async function marcarEstado(
  chaveOuNome: string,
  estado: EstadoEnriquecimento,
  motivo = "",
  agora: Date = new Date(),
): Promise<void> {
  const chave = normalizarNome(chaveOuNome);
  if (chave === "") return;

  await query(
    `${ACHAR_ALVO}
     SET alvo.enriquecimento_estado = $estado,
         alvo.enriquecimento_em = $agora,
         alvo.enriquecimento_motivo = $motivo`,
    { chave, estado, motivo: motivo.slice(0, TETO_MOTIVO), agora: agora.toISOString() },
  );
}

/**
 * O desfazer: os quatro campos voltam de uma vez.
 *
 * **É uma troca, e não uma restauração.** O que estava na ficha vai para o
 * `_anterior`, então o invariante da migration 010 — "o `_anterior` é sempre a
 * geração imediatamente anterior" — continua verdadeiro depois dele, e um toque
 * acidental se conserta com outro toque. É por isso que o desfazer é de **um**
 * toque, e não de dois como o de apagar sessão: ele restaura, não destrói.
 *
 * Devolve `null` quando não há geração guardada — a tela não oferece o botão
 * nesse caso, e a rota não apaga a ficha atual contra quatro strings vazias se
 * ele for chamado assim mesmo.
 */
export async function desfazerFicha(chaveOuNome: string): Promise<EntidadeEscrita | null> {
  const chave = normalizarNome(chaveOuNome);
  if (chave === "") throw new EnriquecimentoError("desfazer exige a entidade");

  const r = await query<EntidadeEscrita & { tinha: boolean }>(
    `${ACHAR_ALVO}
     WITH alvo, { ${LER_VELHO} } AS velho
     WITH alvo, velho, size([c IN [${GUARDADOS}] WHERE c <> '']) > 0 AS tinha
     FOREACH (_ IN CASE WHEN tinha THEN [1] ELSE [] END |
       SET ${TROCAR})
     RETURN alvo.id AS id, alvo.nome AS nome, tinha`,
    { chave },
  );

  if (r.length === 0) throw new EnriquecimentoError(`"${chaveOuNome}" não está no grafo`);
  return r[0].tinha ? { id: r[0].id, nome: r[0].nome } : null;
}

/** Quantos átomos entraram, e a ficha — `null` quando não houve o que escrever. */
export interface Rodada {
  atomos: number;
  ficha: FichaEscrita | null;
}

/**
 * O caminho de uma entidade do começo ao fim: ler os átomos, escrever a ficha,
 * gravar.
 *
 * **Entidade sem átomo nenhum não vai ao modelo**: ela sai `pronta` com os
 * campos inalterados e `enriquecimento_atomos: 0`. Pagar uma chamada para não
 * ter o que dizer é desperdício, e sobrescrever a ficha com o vazio seria perda.
 *
 * Quem trata a falha é quem chama: na fila ela vira `falhou` com o motivo na
 * linha da entidade, e a entidade seguinte não é afetada.
 */
export async function enriquecer(
  e: Pick<EntidadeDoGrafo, "nome" | "nome_normalizado" | "tipo" | "aliases">,
): Promise<Rodada> {
  const atomos = await atomosDaEntidade(e.nome_normalizado);

  if (atomos.length === 0) {
    await marcarEstado(e.nome_normalizado, "pronta");
    await query(`${ACHAR_ALVO}\n     SET alvo.enriquecimento_atomos = 0`, {
      chave: normalizarNome(e.nome_normalizado),
    });
    console.log(`[enriquecimento] ${e.nome}: nenhum átomo fala dela — ficha intocada.`);
    return { atomos: 0, ficha: null };
  }

  const ficha = await escreverFicha(e, atomos);
  await gravarFicha(e.nome_normalizado, ficha, ficha.atomos);
  console.log(
    `[enriquecimento] ${e.nome}: ficha escrita de ${ficha.atomos} átomo(s) — ` +
      `${ficha.modelo}, ${ficha.prompt_version}`,
  );
  return { atomos: ficha.atomos, ficha };
}
