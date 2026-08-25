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
