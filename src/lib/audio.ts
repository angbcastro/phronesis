/**
 * Formatos de áudio que a importação aceita.
 *
 * A gravação no navegador produz um formato só (`audio/webm;codecs=opus`).
 * O arquivo importado vem de onde o usuário gravou: WhatsApp e Telegram
 * mandam Ogg/Opus, o gravador do iPhone manda M4A, gravador antigo manda
 * MP3 ou WAV. A resolução é pela extensão do nome, com o mime como
 * segunda tentativa — `File.type` chega vazio com frequência para `.opus`
 * baixado do WhatsApp, e vazio não é motivo para recusar um arquivo bom.
 *
 * Módulo puro: não lê rede nem disco. A rota valida com `extensaoAceita`
 * antes de assinar qualquer chave — extensão é parte de caminho no R2.
 */

/** Extensão canônica → mime que vai no PUT. A ordem não importa. */
const FORMATOS = {
  opus: "audio/ogg",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  webm: "audio/webm",
} as const;

export type Extensao = keyof typeof FORMATOS;

export const EXTENSOES_ACEITAS = Object.keys(FORMATOS) as Extensao[];

/** O que o `MediaRecorder` produz. Bloco sem extensão declarada é isto. */
export const EXT_GRAVACAO = "webm" as const;

/**
 * Mime → extensão, para o arquivo que chega sem extensão no nome. Vários
 * mimes caem na mesma extensão: `audio/x-m4a` e `audio/mp4` são o mesmo
 * container com nomes diferentes conforme quem exportou.
 */
const POR_MIME: Record<string, Extensao> = {
  "audio/ogg": "opus",
  "audio/opus": "opus",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/m4a": "m4a",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/wave": "wav",
  "audio/x-wav": "wav",
  "audio/webm": "webm",
};

/** `audio/webm;codecs=opus` → `audio/webm`. */
const mimeBase = (mime: string): string => mime.split(";")[0].trim().toLowerCase();

/** Só o que vem depois do último ponto — nome com ponto no meio é comum. */
function extensaoDoNome(nome: string): string {
  const ponto = nome.lastIndexOf(".");
  if (ponto < 0 || ponto === nome.length - 1) return "";
  return nome.slice(ponto + 1).toLowerCase();
}

export function extensaoAceita(ext: string): ext is Extensao {
  return Object.prototype.hasOwnProperty.call(FORMATOS, ext);
}

export interface FormatoAudio {
  ext: Extensao;
  mime: string;
}

/**
 * O formato do arquivo, ou `null` se não for áudio que este sistema aceite.
 *
 * A extensão do nome vence: ela é o que o usuário vê, e um mime genérico
 * (`application/octet-stream`) ou vazio não pode derrubar um `.opus` bom.
 * O mime só decide quando o nome não tem extensão utilizável.
 */
export function formatoDeArquivo(nome: string, mime: string): FormatoAudio | null {
  const ext = extensaoDoNome(nome);
  if (extensaoAceita(ext)) return { ext, mime: FORMATOS[ext] };

  const porMime = POR_MIME[mimeBase(mime ?? "")];
  if (porMime) return { ext: porMime, mime: FORMATOS[porMime] };

  return null;
}

/** Teto do STT com folga. Um diário de 20 min em Opus dá uns 4 MB. */
export const BYTES_MAX = 25 * 1024 * 1024;

/** O bloco vai inteiro numa chamada só; acima disso o STT não devolve. */
export const DURACAO_MAX_S = 30 * 60;

const mb = (bytes: number) => Math.round((bytes / 1024 / 1024) * 10) / 10;

/**
 * Por que este arquivo não serve — ou `null` se serve.
 *
 * Duração desconhecida passa: o `<audio>` do navegador devolve `NaN` ou
 * `Infinity` para container sem cabeçalho de duração, e recusar por isso
 * barraria arquivo bom. O teto de bytes já segura o caso patológico.
 */
export function motivoRecusa(bytes: number, duracao_s: number): string | null {
  if (bytes <= 0) return "O arquivo está vazio.";
  if (bytes > BYTES_MAX) {
    return `O arquivo é grande demais (${mb(bytes)} MB). O limite é ${mb(BYTES_MAX)} MB.`;
  }
  if (Number.isFinite(duracao_s) && duracao_s > DURACAO_MAX_S) {
    return `O áudio é longo demais (${Math.round(duracao_s / 60)} min). O limite é ${DURACAO_MAX_S / 60} min.`;
  }
  return null;
}
