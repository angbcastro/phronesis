/**
 * Transcrição de um bloco.
 *
 * Sai pelo Vercel AI Gateway como todo o resto que fala com modelo — o
 * endereçamento e a regra estão em `modelos.ts`, este arquivo só pede a
 * transcrição.
 *
 * Granularidade: o contrato de transcrição do AI SDK devolve `segments`
 * (início e fim por trecho). Alguns provedores mandam também timestamps
 * por palavra em `providerMetadata`; quando vierem, usamos. Quando não,
 * caímos para segmento e registramos isso no bloco — procedência tem que
 * dizer a verdade sobre a própria precisão.
 *
 * **O rate limit do Gateway é esperado, não é falha** (`limite.ts`). Uma sessão
 * gravada de 15 min são 30 blocos, e o free tier recusa a rajada — sem a espera,
 * o bloco recusado morre no `catch` do `waitUntil` e a sessão inteira vai para
 * `erro` por um limite que passa sozinho em um minuto.
 */
import { experimental_transcribe as transcribe } from "ai";
import { comEsperaDeLimite, ehLimiteDeTaxa } from "./limite";
import { garantirGateway, modeloStt, opcoesDeVocabulario } from "./modelos";
import { efetivo } from "./overrides";
import { vocabulario } from "./vocabulario";
import type { Granularidade, Palavra } from "./tipos";

export class SttError extends Error {
  /**
   * O limite de taxa já foi esperado e ainda assim não passou. Quem loga a
   * falha (`pipeline.ts`) precisa distinguir isso de "o modelo não existe":
   * um pede voltar mais tarde, o outro pede mexer no código.
   */
  readonly limiteDeTaxa: boolean;

  // `cause` preservado de propósito: `ehLimiteDeTaxa` lê a cadeia inteira, e
  // embrulhar só a mensagem apagaria o `statusCode` que a identifica.
  constructor(message: string, opcoes?: { cause?: unknown }) {
    super(message, opcoes);
    this.name = "SttError";
    this.limiteDeTaxa = ehLimiteDeTaxa(opcoes?.cause);
  }
}

interface PalavraCrua {
  text?: string;
  word?: string;
  start?: number;
  end?: number;
}

/** Timestamps por palavra, quando o provedor os expõe em providerMetadata. */
export function palavrasDoMetadata(metadata: unknown): Palavra[] | null {
  if (!metadata || typeof metadata !== "object") return null;

  for (const valor of Object.values(metadata as Record<string, unknown>)) {
    const cruas = (valor as { words?: unknown })?.words;
    if (!Array.isArray(cruas) || cruas.length === 0) continue;

    const palavras = (cruas as PalavraCrua[])
      .map((p) => ({
        palavra: p.text ?? p.word ?? "",
        inicio: typeof p.start === "number" ? p.start : NaN,
        fim: typeof p.end === "number" ? p.end : NaN,
      }))
      .filter((p) => p.palavra !== "" && Number.isFinite(p.inicio) && Number.isFinite(p.fim));

    if (palavras.length > 0) return palavras;
  }
  return null;
}

type Segmento = { text: string; startSecond: number; endSecond: number };

export function palavrasDosSegmentos(segments: readonly Segmento[]): Palavra[] {
  return segments
    .filter((s) => s.text.trim().length > 0)
    .map((s) => ({ palavra: s.text.trim(), inicio: s.startSecond, fim: s.endSecond }));
}

export interface ResultadoStt {
  texto: string;
  palavras: Palavra[];
  granularidade: Granularidade;
  modelo: string;
}

/** Offsets voltam relativos ao início do bloco — a absolutização é na concatenação. */
export async function transcrever(
  audio: ArrayBuffer,
  { ate }: { ate?: number } = {},
): Promise<ResultadoStt> {
  garantirGateway(); // falha cedo, antes de mandar os bytes
  // O modelo que eu escolhi no painel, ou `STT_MODEL`, ou o padrão (4.7).
  // Este agente não tem prompt: o que ele recebe de mim é o vocabulário, e o
  // canal dele depende do provedor (`opcoesDeVocabulario`) — trocar de modelo
  // aqui pode deixar a lista de nomes próprios sem por onde chegar.
  const { modelo } = await efetivo("stt", { modelo: modeloStt() });
  const termos = await vocabulario();

  let resultado;
  try {
    resultado = await comEsperaDeLimite(
      `stt ${modelo}`,
      () =>
        // `model` é string de propósito: id em string sai pelo Gateway. Objeto
        // de provedor furaria a porta única — ver o cabeçalho de `modelos.ts`.
        transcribe({
          model: modelo,
          audio: new Uint8Array(audio),
          // O nome da opção é por provedor, não fixo — ver `opcoesDeVocabulario`.
          providerOptions: opcoesDeVocabulario(modelo, termos),
          // A espera longa daqui é a única camada de retry: as três tentativas
          // rápidas do SDK contra um 429 não destravam nada e ainda alimentam o
          // limite que estão esperando (`limite.ts`).
          maxRetries: 0,
        }),
      { ate },
    );
  } catch (e) {
    throw new SttError(e instanceof Error ? e.message : String(e), { cause: e });
  }

  const porPalavra = palavrasDoMetadata(resultado.providerMetadata);

  return {
    texto: resultado.text ?? "",
    palavras: porPalavra ?? palavrasDosSegmentos(resultado.segments ?? []),
    granularidade: porPalavra ? "palavra" : "segmento",
    modelo: resultado.responses?.[0]?.modelId ?? modelo,
  };
}
