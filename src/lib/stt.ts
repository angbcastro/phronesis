/** Transcrição de um bloco: Whisper via API, com timestamps por palavra. */
import { env } from "./env";
import { promptVocabulario } from "./vocabulario";
import type { Palavra } from "./tipos";

const URL_STT = process.env.STT_URL ?? "https://api.openai.com/v1/audio/transcriptions";
const MODELO_STT = process.env.STT_MODEL ?? "whisper-1";

interface RespostaWhisper {
  text: string;
  words?: { word: string; start: number; end: number }[];
}

export class SttError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "SttError";
  }
}

export function mapearPalavras(resp: RespostaWhisper): Palavra[] {
  return (resp.words ?? []).map((w) => ({
    palavra: w.word,
    inicio: w.start,
    fim: w.end,
  }));
}

/** Offsets voltam relativos ao início do bloco — a absolutização é na concatenação. */
export async function transcrever(
  audio: ArrayBuffer,
  nomeArquivo: string,
): Promise<{ texto: string; palavras: Palavra[] }> {
  const form = new FormData();
  form.append("file", new Blob([audio], { type: "audio/webm" }), nomeArquivo);
  form.append("model", MODELO_STT);
  form.append("language", "pt");
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");

  const prompt = await promptVocabulario();
  if (prompt) form.append("prompt", prompt);

  const resp = await fetch(URL_STT, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.sttApiKey}` },
    body: form,
  });

  if (!resp.ok) {
    throw new SttError(`STT respondeu ${resp.status}: ${(await resp.text()).slice(0, 300)}`, resp.status);
  }

  const corpo = (await resp.json()) as RespostaWhisper;
  return { texto: corpo.text ?? "", palavras: mapearPalavras(corpo) };
}
