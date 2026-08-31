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
 */
import { experimental_transcribe as transcribe } from "ai";
import { garantirGateway, modeloStt, opcoesDeVocabulario } from "./modelos";
import { vocabulario } from "./vocabulario";
import type { Granularidade, Palavra } from "./tipos";

export class SttError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SttError";
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
export async function transcrever(audio: ArrayBuffer): Promise<ResultadoStt> {
  garantirGateway(); // falha cedo, antes de mandar os bytes
  const modelo = modeloStt();
  const termos = await vocabulario();

  let resultado;
  try {
    // `model` é string de propósito: id em string sai pelo Gateway. Objeto de
    // provedor furaria a porta única — ver o cabeçalho de `modelos.ts`.
    resultado = await transcribe({
      model: modelo,
      audio: new Uint8Array(audio),
      // O nome da opção é por provedor, não fixo — ver `opcoesDeVocabulario`.
      providerOptions: opcoesDeVocabulario(modelo, termos),
    });
  } catch (e) {
    throw new SttError(e instanceof Error ? e.message : String(e));
  }

  const porPalavra = palavrasDoMetadata(resultado.providerMetadata);

  return {
    texto: resultado.text ?? "",
    palavras: porPalavra ?? palavrasDosSegmentos(resultado.segments ?? []),
    granularidade: porPalavra ? "palavra" : "segmento",
    modelo: resultado.responses?.[0]?.modelId ?? modelo,
  };
}
