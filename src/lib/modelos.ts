/**
 * Porta única de modelo.
 *
 * Todo tráfego de LLM deste sistema sai pelo Vercel AI Gateway — STT, extração,
 * resolução de identidade, perfil e deduplicação. Uma chave só
 * (`AI_GATEWAY_API_KEY`), um lugar só para ver custo e latência, e trocar de
 * provedor é mudar uma variável de ambiente — sem tocar em código.
 *
 * Como o SDK decide por onde sai:
 *
 *   resolveLanguageModel / resolveTranscriptionModel → getGlobalProvider()
 *   → globalThis.AI_SDK_DEFAULT_PROVIDER ?? gateway
 *
 * Ou seja: **id de modelo em string sai pelo Gateway**. O que fura a porta é
 * importar um pacote de provedor (`@ai-sdk/openai`, `openai`, `groq-sdk`…) e
 * passar o objeto de modelo, porque aí o SDK fala direto com o provedor e o
 * Gateway nunca vê a chamada.
 *
 * Por isso a regra é simples e verificável: **nenhum pacote de provedor entra
 * nas dependências, e todo modelo é referenciado por string `provedor/modelo`.**
 * `tests/gateway.test.ts` falha se alguém furar isso.
 *
 * Para adicionar um modelo (slice 2 em diante): acrescente uma função aqui,
 * no formato de `modeloStt()`. Não chame `transcribe`/`generateText` com id
 * literal espalhado pelo código.
 */
import { env } from "./env";

/** Endpoint que o `@ai-sdk/gateway` usa. Aqui só para documentar o caminho. */
export const URL_GATEWAY = "https://ai-gateway.vercel.sh/v4/ai";

/** O Gateway endereça modelo como `provedor/modelo`. */
const PADRAO_ID = /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9._-]*$/i;

/**
 * **Escolhido por medição, não por preferência** (2026-08-31). Dos modelos de
 * transcrição que este Gateway atende, é o único que devolve tempo por palavra
 * sem rate limit — e sem tempo não há procedência, que a visão §4 lista como
 * necessidade. A medição inteira está em `ARCHITECTURE.md` §4.2.1.
 */
export const MODELO_STT_PADRAO = "xai/grok-stt";

export class ModeloError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModeloError";
  }
}

/**
 * Id mal escrito tem que estourar aqui, não numa chamada de rede com áudio
 * de 30 s já carregado.
 */
export function validarIdDeModelo(id: string): string {
  const limpo = id.trim();
  if (!PADRAO_ID.test(limpo)) {
    throw new ModeloError(
      `Id de modelo inválido: "${id}". O Gateway espera "provedor/modelo", ex.: ${MODELO_STT_PADRAO}`,
    );
  }
  return limpo;
}

/** `xai/grok-stt` → `xai`. É a chave de `providerOptions`. */
export function provedorDe(id: string): string {
  return validarIdDeModelo(id).split("/")[0].toLowerCase();
}

/**
 * Falha cedo se a chave do Gateway não estiver configurada — antes de
 * mandar bytes para lugar nenhum.
 */
export function garantirGateway(): void {
  env.aiGatewayKey;
}

/** Modelo de transcrição. `STT_MODEL` troca de provedor sem tocar em código. */
export function modeloStt(): string {
  return validarIdDeModelo(process.env.STT_MODEL || MODELO_STT_PADRAO);
}

/**
 * Modelo de extração de átomos. `EXTRACAO_MODEL` troca de provedor sem tocar
 * em código — se o Gateway não conhecer o id padrão, o conserto é uma
 * variável de ambiente, não um deploy.
 *
 * `||` e não `??`: string vazia no `.env.local` é ausência, não escolha.
 */
export const MODELO_EXTRACAO_PADRAO = "zai/glm-5.3-flash";

export function modeloExtracao(): string {
  return validarIdDeModelo(process.env.EXTRACAO_MODEL || MODELO_EXTRACAO_PADRAO);
}

/**
 * Modelo que decide **de quem** eu estava falando (slice 4, agente 2).
 *
 * Padrão igual ao da extração, e não uma constante própria: os dois agentes
 * fazem o mesmo tipo de trabalho — ler português e devolver JSON curto — e
 * fixar um segundo id aqui só criaria mais um lugar para desatualizar. Quando
 * eu quiser separar, `RESOLUCAO_MODEL` separa sem tocar em código.
 */
export function modeloResolucao(): string {
  return validarIdDeModelo(process.env.RESOLUCAO_MODEL || modeloExtracao());
}

/**
 * Modelo da **segunda passada** — o desempate (slice 4.11).
 *
 * Padrão igual ao da resolução, e não ao da extração: os dois lêem o mesmo tipo
 * de material e decidem a mesma coisa, e o desempate é literalmente a segunda
 * leitura da menção que o outro não resolveu. `DESEMPATE_MODEL` separa sem tocar
 * em código — e é aqui que eu poria um modelo mais caro, se um dia a segunda
 * passada merecer um.
 */
export function modeloDesempate(): string {
  return validarIdDeModelo(process.env.DESEMPATE_MODEL || modeloResolucao());
}

/**
 * Modelo que rascunha o texto de um campo de perfil (slice 4, agente 3).
 * Mesma regra do de resolução: padrão é o da extração.
 */
export function modeloPerfil(): string {
  return validarIdDeModelo(process.env.PERFIL_MODEL || modeloExtracao());
}

/**
 * Modelo que escreve a ficha inteira de uma entidade a partir de todos os
 * átomos que falam dela (slice 4.12, o lote).
 *
 * Padrão igual ao da extração, como os outros. **É o candidato mais provável a
 * ser separado um dia**, e por isso a variável existe desde o primeiro commit:
 * este agente lê a entrada mais longa do sistema — todos os átomos de uma
 * entidade, sem teto — e escreve o texto que os dois agentes vão ler em toda
 * chamada depois. Se algum lugar merece um modelo melhor, é este; e trocar é
 * `ENRIQUECIMENTO_MODEL`, sem tocar em código.
 */
export function modeloEnriquecimento(): string {
  return validarIdDeModelo(process.env.ENRIQUECIMENTO_MODEL || modeloExtracao());
}

/**
 * Modelo que lê as minhas correções de um agente e enxerga o padrão nelas
 * (slice 4.6, generalizado na 7). Mesma regra dos outros: padrão é o da
 * extração, e `CALIBRACAO_MODEL` separa sem tocar em código.
 */
export function modeloCalibracao(): string {
  return validarIdDeModelo(process.env.CALIBRACAO_MODEL || modeloExtracao());
}

/**
 * Modelo que transforma um padrão confirmado em emenda ao prompt do agente
 * (slice 7).
 *
 * Padrão é o **da calibração**, e não o da extração: os dois passos leem prompt
 * e escrevem prosa curta e disciplinada, e quem troca um costuma querer trocar
 * o outro junto. `REDACAO_MODEL` separa quando não for o caso.
 */
export function modeloRedacao(): string {
  return validarIdDeModelo(process.env.REDACAO_MODEL || modeloCalibracao());
}

/**
 * Modelo que julga se duas entidades parecidas são a mesma coisa (slice 3).
 * Mesma família da extração: saída JSON curta, chamado sob demanda.
 */
export const MODELO_DUPLICATAS_PADRAO = "zai/glm-5.3-flash";

export function modeloDuplicatas(): string {
  return validarIdDeModelo(process.env.DUPLICATAS_MODEL || MODELO_DUPLICATAS_PADRAO);
}

/**
 * O pedaço da resposta do modelo que fala sobre a própria resposta.
 *
 * Mora aqui, e não em quem chama, porque **os três agentes têm o mesmo modo de
 * falha**: todos usam a mesma família de modelo de raciocínio, e todos podem
 * receber uma resposta sem texto nenhum. Extração, resolução e perfil importam
 * este helper; duplicá-lo faria `extracao.ts` e `resolucao.ts` importarem um do
 * outro, que já é um ciclo.
 *
 * Sem isto, "Vieram 0 caractere(s)" não distingue duas causas com consertos
 * **opostos** — e foi exatamente essa dúvida que a sessão `mthu6r1y5h` deixou:
 *
 *   finishReason=length                    o raciocínio comeu o orçamento. O
 *                                          conserto é subir o teto de saída de
 *                                          quem chamou, ou trocar de modelo
 *                                          pela variável de ambiente dele.
 *   finishReason=stop, saida baixa e
 *   raciocinio alto, com `pensamento`
 *   grande                                 o modelo escreveu na parte de
 *                                          raciocínio e não na de texto. Aí a
 *                                          segunda tentativa acerta por sorte e
 *                                          o problema volta na sessão seguinte.
 *
 * `zai/glm-5.3-flash` já gastou 1720 tokens pensando para 122 de texto — é o
 * modo de falha que este sistema mais vê (`ARCHITECTURE.md` §4.6). Os dois
 * consertos viraram `faltouOrcamento()` e `textoDaResposta()`, logo abaixo:
 * durante duas fatias esta tabela foi prescrição escrita e não código.
 *
 * Tipagem estrutural de propósito: o que interessa é o que o campo diz, não de
 * qual versão do SDK ele veio. Campo ausente vira `?` em vez de derrubar o log
 * — diagnóstico que estoura no meio de um erro é pior que diagnóstico nenhum.
 */
export interface RespostaDoModelo {
  finishReason?: string;
  text?: string;
  reasoningText?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    outputTokenDetails?: { reasoningTokens?: number; textTokens?: number };
  };
}

export function diagnostico(r: RespostaDoModelo): string {
  const n = (v: number | undefined) => (typeof v === "number" ? String(v) : "?");
  const u = r.usage;
  return [
    `finishReason=${r.finishReason ?? "?"}`,
    `entrada=${n(u?.inputTokens)}`,
    `saida=${n(u?.outputTokens)}`,
    `raciocinio=${n(u?.outputTokenDetails?.reasoningTokens)}`,
    `texto=${(r.text ?? "").length} char`,
    `pensamento=${(r.reasoningText ?? "").length} char`,
  ].join(" ");
}

/**
 * O pensamento comeu o orçamento e a resposta foi cortada no meio dele.
 *
 * `maxOutputTokens` limita **raciocínio e texto juntos** — foi essa a premissa
 * que faltou quando a 4.8 declarou que "a resposta da extração parou de poder
 * truncar" porque a janela ficou pequena. A janela 0 da sessão
 * `mtqoeoqh3e3724514q1f` tinha 5210 tokens de entrada e mesmo assim gastou os
 * 8000 de saída inteiros pensando, sem escrever um byte de JSON: o volume do
 * pensamento não encolhe com a entrada do jeito que o JSON encolhe.
 *
 * Quem chama usa isto para **não repetir a mesma chamada**. Com `temperature: 0`
 * a segunda tentativa idêntica é determinística — mesmo prompt, mesmo teto,
 * mesmo estouro —, então repetir aqui só paga duas vezes pela mesma falha.
 */
export function faltouOrcamento(r: RespostaDoModelo): boolean {
  return r.finishReason === "length";
}

/**
 * O texto da resposta, e o pensamento quando o texto veio vazio.
 *
 * É o outro modo de falha da tabela acima: `finishReason=stop`, orçamento
 * sobrando, `pensamento` grande e `texto=0` — o modelo escreveu a resposta na
 * parte de raciocínio e não na de texto. Antes disto a segunda tentativa
 * **mascarava** o caso, acertando por sorte, e ele voltava na sessão seguinte.
 *
 * **Só quando o pensamento terminou** (`!faltouOrcamento`). Cortado no meio ele
 * não tem JSON fechado, e `isolarJson` — que pega do primeiro `{` até o último
 * `}` — casaria um rascunho parcial do raciocínio como se fosse a resposta.
 * Aí a proposta sairia de uma ideia que o modelo estava abandonando.
 *
 * Quem chama diz no log quando o texto veio daqui: proposta tirada do
 * pensamento merece um olhar mais atento na revisão.
 */
export function textoDaResposta(r: RespostaDoModelo): string {
  const texto = r.text ?? "";
  if (texto.trim() !== "") return texto;
  return faltouOrcamento(r) ? texto : (r.reasoningText ?? "");
}

/** Para o log de quem chama dizer que leu o pensamento, e não o texto. */
export const veioDoPensamento = (r: RespostaDoModelo): boolean =>
  (r.text ?? "").trim() === "" && textoDaResposta(r).trim() !== "";

/**
 * Como cada provedor recebe o vocabulário.
 *
 * **A chave do `providerOptions` acompanha o provedor, mas o nome da opção
 * não.** `keyterm` é parâmetro de xAI e Deepgram; mandá-lo para um provedor que
 * não o conhece ou some em silêncio — e o vocabulário vira decoração — ou
 * derruba a transcrição inteira. Antes desta tabela o nome estava escrito à mão
 * em `stt.ts`, então trocar `STT_MODEL` quebrava o vocabulário sem avisar.
 *
 * Que o `keyterm` de fato muda a grafia está medido em `ARCHITECTURE.md` §4.4.
 *
 * Provedor fora da tabela **não recebe opção nenhuma**: silêncio é o padrão
 * seguro, e uma transcrição sem vocabulário é muito melhor que nenhuma.
 */
const OPCAO_DE_VOCABULARIO: Record<string, string> = {
  xai: "keyterm",
  deepgram: "keyterm",
};

/**
 * O `providerOptions` da chamada de transcrição, ou `undefined` quando não há
 * o que mandar — lista vazia ou provedor sem mecanismo conhecido.
 */
export function opcoesDeVocabulario(
  modelo: string,
  termos: string[],
): Record<string, Record<string, string[]>> | undefined {
  if (termos.length === 0) return undefined;

  const provedor = provedorDe(modelo);
  const opcao = OPCAO_DE_VOCABULARIO[provedor];
  if (!opcao) return undefined;

  return { [provedor]: { [opcao]: termos } };
}

/** Para o smoke e a tela dizerem se o vocabulário chega a este provedor. */
export const provedorAceitaVocabulario = (modelo: string): boolean =>
  OPCAO_DE_VOCABULARIO[provedorDe(modelo)] !== undefined;

/**
 * **Por que este sistema não pede ao modelo para pensar menos.**
 *
 * Existiu aqui uma `OPCAO_DE_RACIOCINIO`, no desenho de
 * `OPCAO_DE_VOCABULARIO`, mandando `reasoningEffort: "minimal"` para o `zai`.
 * A medição que a sustentava é real e está em `ARCHITECTURE.md` §4.4 — dá para
 * calar o raciocínio deste modelo, e duas opções fazem isso de fato. **A
 * decisão é não usá-las.**
 *
 * O raciocínio não é o defeito: é o que a extração faz de útil. Ler um diário
 * falado e decidir o que vira átomo, de quem é, e o que estende o que já foi
 * dito é exatamente a tarefa em que pensar antes de escrever paga. Trocar isso
 * por uma lista mais barata seria consertar o sintoma no lugar onde ele dói
 * menos e cobrar a conta na qualidade — que é a única coisa deste sistema que
 * não tem teste automático, e que eu julgo à mão, sessão por sessão.
 *
 * O defeito era o **estouro**, e ele tem defesa própria: `faltouOrcamento()`
 * distingue a causa, e a segunda tentativa de `extracao.ts` vai com o dobro de
 * teto em vez de repetir a mesma chamada. Custa uma chamada a mais nas janelas
 * em que o modelo resolve pensar muito, e essa é a troca deliberada.
 *
 * `scripts/raciocinio.ts` continua no repositório: ele é o instrumento que
 * responde "dá para limitar este provedor?" se um dia a pergunta voltar — e a
 * resposta medida para o `zai/glm-5.3-flash` já está registrada.
 */

/**
 * Modelo de embedding (slice 4.5). `EMBEDDING_MODEL` troca sem tocar em código,
 * como todos os outros — string `provedor/modelo`, pelo Gateway (regra 8).
 *
 * **Escolhido por medição** (2026-09-02), contra o catálogo real deste Gateway:
 * dos 26 modelos de embedding servidos, este é o que devolve exatamente as
 * 1536 dimensões que a migration 006 declara **e** o que separa melhor o par
 * de teste da slice 4.5 do ruído —
 *
 *   openai/text-embedding-3-small   1536   par 0,594   não relacionado 0,19–0,29
 *   google/gemini-embedding-001     3072   par 0,764   não relacionado 0,48–0,59
 *
 * O Gemini pontua mais alto em tudo, o que não é qualidade: o que decide um
 * piso é a **distância** entre o par verdadeiro e o ruído, e ali ela é 1,4× —
 * contra 2× aqui. Trocar de modelo é a variável de ambiente; trocar para um de
 * outra dimensão pede `DROP` e recriar os dois índices, por migration nova.
 */
export const MODELO_EMBEDDING_PADRAO = "openai/text-embedding-3-small";

/**
 * A dimensão que os dois índices vetoriais declaram (migration 006). Vive aqui,
 * junto do modelo padrão, porque é ele quem a determina — e é a única coisa
 * desta slice que amarra o schema.
 */
export const DIMENSAO_EMBEDDING = 1536;

export function modeloEmbedding(): string {
  return validarIdDeModelo(process.env.EMBEDDING_MODEL || MODELO_EMBEDDING_PADRAO);
}

/**
 * Modelo que decide se dois átomos se relacionam — `ATUALIZA`, `CONTRADIZ`,
 * `CONFIRMA` ou `COMPLEMENTA` (slice 5, agente `confronto`).
 *
 * Mesma família de trabalho da extração e da resolução: ler português e
 * devolver JSON curto. Padrão é a extração, como a maioria dos outros;
 * `CONFRONTO_MODEL` separa sem tocar em código.
 */
export function modeloConfronto(): string {
  return validarIdDeModelo(process.env.CONFRONTO_MODEL || modeloExtracao());
}

/**
 * Modelo do agente `chat` — o que lê a minha pergunta, escolhe as buscas e
 * escreve a resposta (slice 6).
 *
 * Padrão igual ao da extração, como quase todos. **É o segundo candidato mais
 * provável a ser separado**, depois do enriquecimento, e por um motivo que os
 * outros agentes não têm: este é o único que usa *tool-calling* multi-passo
 * pelo Gateway — ele decide quais ferramentas chamar, lê o que voltou e decide
 * de novo, até oito vezes. Um modelo bom em devolver JSON curto não é
 * necessariamente bom nisso, e isso não está medido (§14). Quando doer,
 * `CHAT_MODEL` separa sem tocar em código.
 */
export function modeloChat(): string {
  return validarIdDeModelo(process.env.CHAT_MODEL || modeloExtracao());
}

/**
 * Modelo que dá nome à conversa a partir da primeira troca (slice 6).
 *
 * Padrão igual ao do `chat`, e não ao da extração: é a chamada mais barata do
 * sistema — duas mensagens dentro, uma frase fora — e separá-la do chat só faz
 * sentido no dia em que o `CHAT_MODEL` virar um modelo caro. `CHAT_TITULO_MODEL`
 * é exatamente essa saída, e ela existe desde o primeiro commit por isso.
 */
export function modeloTituloChat(): string {
  return validarIdDeModelo(process.env.CHAT_TITULO_MODEL || modeloChat());
}
