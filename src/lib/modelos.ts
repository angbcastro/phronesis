/**
 * Porta única de modelo.
 *
 * Todo tráfego de LLM deste sistema sai pelo Vercel AI Gateway — STT hoje,
 * extração e deduplicação a partir da slice 2. Uma chave só
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
 * Modelo que julga se duas entidades parecidas são a mesma coisa (slice 3).
 * Mesma família da extração: saída JSON curta, chamado sob demanda.
 */
export const MODELO_DUPLICATAS_PADRAO = "zai/glm-5.3-flash";

export function modeloDuplicatas(): string {
  return validarIdDeModelo(process.env.DUPLICATAS_MODEL || MODELO_DUPLICATAS_PADRAO);
}

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
