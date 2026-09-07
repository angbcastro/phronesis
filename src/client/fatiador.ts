"use client";

/**
 * O arquivo importado, fatiado em blocos de 30 s — os mesmos da gravação.
 *
 * Existe porque a importação subia o arquivo inteiro em `i = 0`, e com um bloco
 * só a janela da slice 4.8 fica **inerte**: `janelasDe` devolve uma janela que
 * *é* a sessão inteira, e o que era para ser nove chamadas de 2 min vira uma
 * chamada de 17 min. A 4.9 vai junto — `candidatas_NNN.json` é chaveado por
 * bloco, então o RAG rodava uma vez para dezessete minutos.
 *
 * A alternativa mais barata era fatiar só o texto da transcrição: uma chamada
 * de STT em vez de trinta e cinco, zero costura, nenhum código novo aqui. Foi
 * recusada porque manteria **dois conceitos de bloco** no sistema para sempre,
 * áudio e lógico, e cada fatia futura teria de lembrar da diferença. O bug que
 * esta fatia conserta *é* o preço de dois caminhos que divergem em silêncio.
 *
 * Trinta segundos, e não dois minutos, porque com 30 s **nada rio abaixo muda**:
 * `offsetDoBloco` continua `30 × i`, `janelasDe` continua contando blocos,
 * `chaveChunkCandidatas`, `concatenar`, `prefixoContiguo` e os dois players
 * continuam como estão. A importação vira o caminho da gravação, e nada precisa
 * saber disso.
 *
 * WAV 16 kHz mono, e não Opus: `wav` já está em `FORMATOS` (`src/lib/audio.ts`),
 * então `extensaoAceita` e `chaveChunkAudio` aceitam sem uma linha nova, e o
 * cabeçalho de 44 bytes se escreve à mão. WebCodecs mais uma biblioteca de
 * muxing daria ~3 MB em vez de ~34 MB, ao custo de dependência nova e de
 * suporte irregular no Safari — e isto é um PWA de celular.
 *
 * Módulo de navegador: não entra em `pnpm test`. O que esta fatia tem de
 * testável sem `AudioContext` é `fecharJsonTruncado` e `chavesDaSessao`.
 */
import { DURACAO_CHUNK_MS } from "./gravador";

/** A taxa que o STT quer, e a que faz o bloco caber em ~960 KB. */
const TAXA = 16_000;
const DURACAO_CHUNK_S = DURACAO_CHUNK_MS / 1000;

/**
 * PCM 16-bit mono num contêiner WAV — cabeçalho de 44 bytes e o resto é amostra.
 *
 * `Math.max(-1, Math.min(1, v))` não é paranoia: o resample pode passar de 1 no
 * pico, e sem o corte o inteiro estoura e vira estalo no áudio.
 */
function comoWav(amostras: Float32Array, taxa: number): Blob {
  const bytes = new ArrayBuffer(44 + amostras.length * 2);
  const v = new DataView(bytes);

  const texto = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(offset + i, s.charCodeAt(i));
  };

  texto(0, "RIFF");
  v.setUint32(4, 36 + amostras.length * 2, true);
  texto(8, "WAVE");
  texto(12, "fmt ");
  v.setUint32(16, 16, true); // tamanho do bloco fmt
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, taxa, true);
  v.setUint32(28, taxa * 2, true); // bytes por segundo
  v.setUint16(32, 2, true); // alinhamento do quadro
  v.setUint16(34, 16, true); // bits por amostra
  texto(36, "data");
  v.setUint32(40, amostras.length * 2, true);

  for (let i = 0; i < amostras.length; i++) {
    const a = Math.max(-1, Math.min(1, amostras[i]));
    v.setInt16(44 + i * 2, a < 0 ? a * 0x8000 : a * 0x7fff, true);
  }

  return new Blob([bytes], { type: "audio/wav" });
}

/**
 * O arquivo decodificado, ou `null` se este navegador não sabe lê-lo.
 *
 * Decodifica **dentro de um contexto de 16 kHz** de propósito: `decodeAudioData`
 * entrega no `sampleRate` do contexto, e 17 min a 48 kHz float32 são ~200 MB
 * contra ~67 MB a 16 kHz. Isto roda no celular. O navegador que ignorar a taxa e
 * entregar no original não quebra nada — quem garante os 16 kHz do bloco é o
 * render, logo abaixo.
 */
async function decodificar(arquivo: File): Promise<AudioBuffer | null> {
  try {
    const ctx = new OfflineAudioContext(1, 1, TAXA);
    return await ctx.decodeAudioData(await arquivo.arrayBuffer());
  } catch (e) {
    console.warn("[fatiador] este navegador não decodifica o arquivo:", e);
    return null;
  }
}

/**
 * O arquivo em blocos de 30 s, ou `null` se não deu para decodificar.
 *
 * **O `null` é a parte que importa.** Formato que o navegador não lê cai no
 * caminho de hoje, que continua existindo inteiro: a importação sobe o arquivo
 * numa peça só, em `i = 0`, como sempre fez, e o STT pode dar conta dele mesmo
 * assim. Esta mudança não pode deixar a importação **pior** do que ela já é — no
 * pior caso ela fica igual. É o mesmo cuidado que `duracaoDoArquivo` já tem ao
 * devolver `NaN`.
 *
 * Cada bloco é renderizado sozinho, num `OfflineAudioContext` do tamanho dele:
 * reamostra por bloco e nunca segura um segundo buffer do tamanho do arquivo.
 */
export async function fatiarArquivo(arquivo: File): Promise<Blob[] | null> {
  if (typeof OfflineAudioContext === "undefined") return null;

  const decodificado = await decodificar(arquivo);
  if (!decodificado || decodificado.duration <= 0) return null;

  try {
    const total = Math.max(1, Math.ceil(decodificado.duration / DURACAO_CHUNK_S));
    const blocos: Blob[] = [];

    for (let i = 0; i < total; i++) {
      const de = i * DURACAO_CHUNK_S;
      const quanto = Math.min(DURACAO_CHUNK_S, decodificado.duration - de);
      if (quanto <= 0) break;

      // Contexto de um canal: o downmix de estéreo para mono é do próprio Web
      // Audio, e a taxa de saída é a do contexto — é aqui que os 16 kHz são
      // garantidos, decodifique o navegador na taxa que decodificar.
      const ctx = new OfflineAudioContext(1, Math.ceil(quanto * TAXA), TAXA);
      const fonte = ctx.createBufferSource();
      fonte.buffer = decodificado;
      fonte.connect(ctx.destination);
      fonte.start(0, de, quanto);

      const rendido = await ctx.startRendering();
      blocos.push(comoWav(rendido.getChannelData(0), TAXA));
    }

    return blocos.length > 0 ? blocos : null;
  } catch (e) {
    // Render que falha no meio deixaria a sessão com blocos faltando no meio, o
    // que é pior que não fatiar: o fallback sobe o arquivo inteiro e não perde
    // um segundo de fala.
    console.warn("[fatiador] não consegui fatiar, subindo o arquivo inteiro:", e);
    return null;
  }
}
