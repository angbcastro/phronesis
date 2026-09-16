/**
 * O `redacao-1`: quem transforma um padrão que eu confirmei em **emenda** ao
 * prompt de um agente (slice 7).
 *
 * **Ele devolve `edicoes`, nunca o prompt inteiro.** É a decisão que sustenta a
 * fatia: o pedido foi ajuste incremental, e amarra que vive só no texto do
 * prompt é amarra que o modelo ignora num dia ruim. Devolvendo emendas, ele não
 * *consegue* tocar o que não nomeou — a seção que ele não cita nunca sai do
 * servidor, então volta byte a byte por construção, sem depender de nenhum diff
 * para descobrir se o que parece igual é igual.
 *
 * **Não escreve nada.** Propõe e para, como o `perfil-1` e o `calibracao-2`, e
 * pela razão maior de todas: o que ele toca é a coisa que produz todo o resto.
 * Quem grava é `POST /api/calibracao/aprovar`, por `gravarOverride`, e só com o
 * meu toque.
 *
 * A seção é a unidade porque é a unidade que os prompts deste sistema já usam:
 * uma linha em caixa alta, e o corpo dela até a linha seguinte em caixa alta.
 * Nove dos dez prompts já eram escritos assim antes desta fatia.
 */
import { generateText } from "ai";
import { garantirGateway, modeloRedacao, textoDaResposta } from "./modelos";
import { carimbo, efetivo } from "./overrides";
import { MAX_SECOES_POR_EMENDA, OPERACOES_EDICAO } from "./tipos";
import type { AgenteId, Edicao, OperacaoEdicao, Padrao } from "./tipos";

/** Muda sempre que o prompt mudar — mesma disciplina de todo agente (regra 7). */
export const PROMPT_VERSION_REDACAO = "redacao-1";

/** Quanto de cada seção entra no prompt do redator. */
const TETO_SECAO = 1200;

export class RedacaoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RedacaoError";
  }
}

// ──────────────────────────────── as seções ────────────────────────────────

/**
 * Um cabeçalho de seção: linha inteira em caixa alta, quatro caracteres ou
 * mais.
 *
 * O padrão veio de `extracao.secoesDoPrompt`, que existia desde a 4.6 só para
 * dizer ao calibrador qual seção uma regra podia contradizer, e que **saiu de
 * lá nesta fatia**: aqui ele deixa de ser consulta e vira estrutura — é por ele
 * que o prompt se divide em pedaços endereçáveis. Uma regex só, num módulo só;
 * duas para a mesma regra divergem no primeiro ajuste, e a que ninguém lembrar
 * de acertar passa a discordar em silêncio.
 */
const CABECALHO = /^[A-ZÁÂÃÀÉÊÍÓÔÕÚÇ][A-ZÁÂÃÀÉÊÍÓÔÕÚÇ 0-9]{3,}$/;

export const ehCabecalho = (linha: string): boolean => CABECALHO.test(linha);

/** Os cabeçalhos de um prompt, na ordem em que aparecem. */
export function secoesDe(texto: string): string[] {
  return texto.split("\n").filter(ehCabecalho);
}

export interface Secao {
  /** O cabeçalho, sem espaço em volta. */
  nome: string;
  /** O corpo, do fim do cabeçalho até o cabeçalho seguinte (ou o fim). */
  corpo: string;
  /** Índices no texto original: `[inicio do cabeçalho, fim do corpo)`. */
  inicio: number;
  fim: number;
}

/**
 * O prompt fatiado em seções, com as fronteiras em índice de caractere.
 *
 * Trabalha sobre offsets e não sobre uma lista de linhas remontada, porque
 * remontar com `join("\n")` normalizaria `\r\n` e espaço no fim de linha — e
 * então "seção que eu não toquei volta byte a byte" deixaria de ser verdade
 * justamente no caso em que ninguém olharia.
 */
export function fatiar(texto: string): Secao[] {
  const linhas = texto.split("\n");
  const saida: Secao[] = [];

  let offset = 0;
  for (const linha of linhas) {
    if (ehCabecalho(linha)) {
      if (saida.length > 0) saida[saida.length - 1].fim = offset;
      saida.push({ nome: linha, corpo: "", inicio: offset, fim: texto.length });
    }
    offset += linha.length + 1; // +1 do "\n" que o split comeu
  }

  for (const s of saida) {
    s.corpo = texto.slice(s.inicio + s.nome.length, s.fim);
  }
  return saida;
}

// ─────────────────────────── aplicar, sem surpresa ───────────────────────────

/**
 * A seção que descreve o envelope de saída — a que o parser do agente lê
 * palavra por palavra, e a única que o redator **não pode tocar**.
 *
 * É achada pelo conteúdo, e não pelo nome `FORMATO`: eu posso ter renomeado o
 * cabeçalho ao editar o prompt no painel, e o que define a seção é ela conter
 * as chaves que o parser exige. `lastIndexOf` pelo mesmo motivo que a 4.6 usava
 * `lastIndexOf(CABECALHO_FORMATO)` — quando uma chave aparece no corpo do
 * prompt **e** no envelope, é a última ocorrência que é o envelope.
 *
 * `null` quando o agente não tem envelope, e aí não há o que proteger.
 */
export function secaoDoEnvelope(prompt: string, envelope: readonly string[]): string | null {
  if (envelope.length === 0) return null;

  const secoes = fatiar(prompt);
  for (let i = secoes.length - 1; i >= 0; i--) {
    if (envelope.some((chave) => secoes[i].corpo.includes(chave))) return secoes[i].nome.trim();
  }
  return null;
}

/**
 * O prompt com as emendas aplicadas. **Função pura** — é ela que o teste aperta
 * inteira, mesmo molde de `apurarCorrecoes`.
 *
 * Aplica de trás para frente, para um `reescrever` não invalidar o offset do
 * seguinte.
 *
 * **`criar` entra ANTES da seção do envelope**, e não no fim do texto. Foi o
 * primeiro defeito desta fatia: o `FORMATO` costuma ser a última seção, e uma
 * seção nova depois dele seria lida como parte do exemplo de JSON — que é
 * exatamente o que `inserirAntesDoFormato` evitava desde a 4.6. Sem envelope
 * (ou sem seção que o contenha), vai para o fim, que aí é o lugar certo.
 *
 * Lança quando uma edição não bate com o prompt corrente, em vez de aplicar o
 * que der: emenda parcial é a única saída pior que emenda nenhuma.
 */
export function aplicarEdicoes(
  prompt: string,
  edicoes: readonly Edicao[],
  opcoes: { antesDe?: string | null } = {},
): string {
  if (edicoes.length === 0) return prompt;

  const secoes = fatiar(prompt);
  const porNome = new Map(secoes.map((s) => [s.nome.trim(), s]));

  const alvos = edicoes
    .filter((e) => e.operacao !== "criar")
    .map((e) => {
      const alvo = porNome.get(e.secao.trim());
      if (!alvo) {
        throw new RedacaoError(`a seção "${e.secao}" não existe no prompt corrente`);
      }
      return { edicao: e, alvo };
    });

  let saida = prompt;
  for (const { edicao, alvo } of [...alvos].sort((a, b) => b.alvo.inicio - a.alvo.inicio)) {
    const corpo =
      edicao.operacao === "acrescentar"
        ? `${alvo.corpo.replace(/\s+$/, "")}\n${edicao.texto.trim()}\n`
        : `\n${edicao.texto.trim()}\n`;
    saida = saida.slice(0, alvo.inicio) + alvo.nome + corpo + saida.slice(alvo.fim);
  }

  for (const e of edicoes.filter((x) => x.operacao === "criar")) {
    const bloco = `${e.secao.trim()}\n${e.texto.trim()}\n`;
    const guarda = opcoes.antesDe ? fatiar(saida).find((s) => s.nome.trim() === opcoes.antesDe) : undefined;

    saida = guarda
      ? `${saida.slice(0, guarda.inicio).replace(/\s+$/, "")}\n\n${bloco}\n${saida.slice(guarda.inicio)}`
      : `${saida.replace(/\s+$/, "")}\n\n${bloco}`;
  }
  return saida;
}

// ───────────────────────────────── o agente ─────────────────────────────────

export const INSTRUCOES = `Você emenda o prompt de um agente de software. Recebe o prompt inteiro dele, dividido em seções, e UM OU DOIS padrões que o dono do sistema confirmou — coisas que ele corrige à mão, repetidamente, na saída desse agente. Sua tarefa é dizer ONDE no prompt cada padrão entra, e com que texto.

VOCÊ EMENDA, NÃO REESCREVE
O prompt que você recebeu funciona. Ele foi calibrado ao longo de várias versões, e a maior parte dele não tem nada a ver com o padrão que você está endereçando. Mexer no que já está bom é o erro mais caro que você pode cometer aqui, e é invisível: ninguém percebe a regressão até a saída piorar semanas depois.

Toque o mínimo. Uma seção é melhor que duas. Acrescentar uma linha a uma seção que já trata do assunto é melhor que reescrever a seção inteira. Criar uma seção nova é o último recurso, e só quando nenhuma das existentes é o lugar daquilo.

AS OPERAÇÕES
"acrescentar" — o seu texto entra no FIM do corpo da seção, e o que já estava lá continua intacto. Prefira esta.
"reescrever" — o seu texto SUBSTITUI o corpo inteiro da seção. Use só quando o padrão contradiz o que a seção diz hoje; e então reescreva a seção COMPLETA, preservando tudo que continua valendo.
"criar" — uma seção nova, com cabeçalho em CAIXA ALTA, no fim do prompt.

Não existe apagar. Se uma seção precisa sumir, isso não é emenda — não proponha.

COMO ESCREVER
No imperativo, dirigido a quem executa o prompt, na mesma voz e no mesmo idioma do resto. Não cite o padrão ("o dono costuma corrigir…"), não explique a mudança, não escreva meta-texto: o prompt é lido por um modelo que não sabe que esta conversa aconteceu. Não invente exemplos que você não tirou do material.

Nunca toque na seção que descreve o formato da saída (FORMATO, ou o nome que ela tenha aqui). O parser depende dela palavra por palavra.

FORMATO
Responda somente com JSON, sem texto antes ou depois:
{"edicoes":[{"secao":"NOME EXATO DA SEÇÃO","operacao":"acrescentar|reescrever|criar","texto":"o corpo, sem repetir o cabeçalho","padrao":"id do padrão"}]}
No máximo ${MAX_SECOES_POR_EMENDA} edições, uma por seção. Nenhuma edição é uma resposta legítima: devolva {"edicoes":[]} se nenhum lugar do prompt for o lugar daquilo.`;

const corta = (t: string) => (t.length <= TETO_SECAO ? t : `${t.slice(0, TETO_SECAO)}…`);

/**
 * O prompt corrente, apresentado ao redator seção por seção — que é a unidade
 * em que ele responde. Mandar o texto corrido faria a resposta ter de recortar
 * sozinha os cabeçalhos, e recorte de modelo erra caixa e acento.
 */
export function blocoDasSecoes(prompt: string): string {
  const secoes = fatiar(prompt);
  if (secoes.length === 0) return "(este prompt não tem seções)";

  const preambulo = prompt.slice(0, secoes[0].inicio).trim();
  const corpo = secoes
    .map((s) => `--- ${s.nome.trim()}\n${corta(s.corpo.trim())}`)
    .join("\n\n");

  return preambulo === "" ? corpo : `--- (abertura, sem cabeçalho)\n${corta(preambulo)}\n\n${corpo}`;
}

/**
 * O `redacao-1` propõe as emendas. **Não grava nada.**
 *
 * `papel` vem do registro de agentes: o redator precisa saber o que o agente
 * emendado faz para escrever na voz certa, e isso já está escrito num lugar só.
 */
export async function redigir(entrada: {
  agente: AgenteId;
  papel: string;
  prompt: string;
  /** As chaves que o parser do agente exige — é o que define a seção intocável. */
  envelope: readonly string[];
  padroes: readonly Padrao[];
}): Promise<{ edicoes: Edicao[]; modelo: string; prompt_version: string; protegida: string | null }> {
  if (entrada.padroes.length === 0) {
    throw new RedacaoError("não há padrão confirmado para redigir");
  }

  garantirGateway();
  const meu = await efetivo("redacao", { prompt: INSTRUCOES, modelo: modeloRedacao() });
  const protegida = secaoDoEnvelope(entrada.prompt, entrada.envelope);

  const pauta = entrada.padroes.map((p) => `[${p.id}] ${p.texto}`).join("\n");
  const prompt = `${meu.prompt}

O AGENTE QUE VOCÊ VAI EMENDAR
${entrada.papel}

O PROMPT DELE, SEÇÃO POR SEÇÃO:
${blocoDasSecoes(entrada.prompt)}
${protegida === null ? "" : `\nA seção "${protegida}" descreve o envelope de saída e é INTOCÁVEL.\n`}
OS PADRÕES CONFIRMADOS:
${pauta}`;

  let bruto: string;
  try {
    const r = await generateText({
      // String de propósito: id em string sai pelo Gateway (regra 8).
      model: meu.modelo,
      prompt,
      temperature: 0,
      maxOutputTokens: 4000,
    });
    bruto = textoDaResposta(r);
  } catch (e) {
    throw new RedacaoError(e instanceof Error ? e.message : String(e));
  }

  return {
    edicoes: parsearEdicoes(bruto, {
      secoes: secoesDe(entrada.prompt),
      padroes: new Set(entrada.padroes.map((p) => p.id)),
      protegida,
    }),
    modelo: meu.modelo,
    prompt_version: carimbo(PROMPT_VERSION_REDACAO, meu.hash),
    protegida,
  };
}

/**
 * Parser tolerante próprio, como todo agente deste sistema — e é **aqui** que
 * as amarras valem, não no texto do prompt.
 *
 * Seis recusas, e cada uma tapa um jeito diferente de a emenda deixar de ser
 * emenda: operação que não existe, seção que não existe, seção repetida na
 * mesma rodada, padrão que eu não confirmei, a seção do envelope, e mais seções
 * do que o teto. A amarra que falta — seção não citada volta byte a byte — não
 * mora aqui porque não precisa: ela é consequência de o redator devolver
 * emendas em vez do prompt inteiro.
 *
 * **A do envelope era só um pedido no texto e virou recusa.** `envelopeFaltando`
 * continua sendo a última porta, mas ele checa se as chaves ainda estão lá, não
 * se o exemplo de JSON continua legível: dá para embaralhar o `FORMATO` inteiro
 * mantendo as palavras que ele procura.
 */
export function parsearEdicoes(
  bruto: string,
  contexto: {
    secoes: readonly string[];
    padroes: ReadonlySet<string>;
    /** A seção do envelope, intocável. `null` em agente que não tem envelope. */
    protegida?: string | null;
  },
): Edicao[] {
  const semCerca = bruto.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "");
  const inicio = semCerca.indexOf("{");
  const fim = semCerca.lastIndexOf("}");
  if (inicio === -1 || fim <= inicio) return [];

  let cru: unknown;
  try {
    cru = JSON.parse(semCerca.slice(inicio, fim + 1));
  } catch {
    return [];
  }

  const lista = (cru as { edicoes?: unknown })?.edicoes;
  if (!Array.isArray(lista)) return [];

  const conhecidas = new Map(contexto.secoes.map((s) => [s.trim(), s.trim()]));
  const saida: Edicao[] = [];
  const tocadas = new Set<string>();

  for (const item of lista) {
    const e = item as Record<string, unknown>;
    const secao = typeof e?.secao === "string" ? e.secao.trim() : "";
    const texto = typeof e?.texto === "string" ? e.texto.trim() : "";
    const padrao = typeof e?.padrao === "string" ? e.padrao.trim() : "";
    const operacao = e?.operacao as OperacaoEdicao;

    if (secao === "" || texto === "") continue;
    // Operação fora da lista: `apagar` cai aqui, e é onde ele tem de cair.
    if (!(OPERACOES_EDICAO as readonly unknown[]).includes(operacao)) continue;
    // Padrão que eu não confirmei fecharia correções que a emenda nunca leu.
    if (!contexto.padroes.has(padrao)) continue;
    // A seção do envelope é do parser do agente, não do redator.
    if (contexto.protegida && secao === contexto.protegida) continue;

    const existe = conhecidas.has(secao);
    // Seção inventada num `reescrever` iria emendar o que não está lá; e
    // `criar` sobre seção existente é `reescrever` disfarçado de coisa nova.
    if (operacao === "criar" ? existe : !existe) continue;
    // Uma seção por rodada: duas edições na mesma seção se sobrescreveriam, e
    // a segunda venceria em silêncio.
    if (tocadas.has(secao)) continue;

    tocadas.add(secao);
    saida.push({ secao: existe ? conhecidas.get(secao)! : secao, operacao, texto, padrao });
    if (saida.length === MAX_SECOES_POR_EMENDA) break;
  }
  return saida;
}
