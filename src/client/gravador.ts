"use client";

/**
 * Captura de áudio em blocos independentes.
 *
 * `MediaRecorder` com `timeslice` não serve: só o primeiro blob carrega o
 * header WebM, os seguintes não são decodificáveis sozinhos e o STT
 * rejeita. Aqui o `MediaStream` é aberto uma vez e nunca tocado; a cada
 * 30 s o recorder é parado e recriado sobre o mesmo stream. Cada bloco sai
 * completo. A lacuna é de milissegundos e imperceptível na fala.
 */

export const DURACAO_CHUNK_MS = 30_000;
const MIME = "audio/webm;codecs=opus";
const BITRATE = 24_000; // ~4 MB numa sessão de 20 min

export interface OpcoesGravador {
  aoBloco: (bloco: { i: number; blob: Blob }) => void;
  aoErro?: (e: unknown) => void;
}

export function suportado(): boolean {
  return (
    typeof MediaRecorder !== "undefined" &&
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    MediaRecorder.isTypeSupported(MIME)
  );
}

export class Gravador {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pedacos: Blob[] = [];
  private proximo = 0;
  private parando = false;
  private aoParar: (() => void) | null = null;
  private inicioMs = 0;
  private trava: WakeLockSentinel | null = null;
  private aoVoltar: (() => void) | null = null;

  constructor(private readonly opcoes: OpcoesGravador) {}

  get indiceAtual(): number {
    return this.proximo;
  }

  /**
   * O stream aberto, para quem precisa ouvir junto — hoje a onda do botão de
   * gravar, via Web Audio. Só leitura: quem abriu o microfone fecha, e o
   * `MediaStream` é aberto uma vez e nunca tocado (ver o topo do arquivo).
   */
  get faixa(): MediaStream | null {
    return this.stream;
  }

  duracaoS(): number {
    return this.inicioMs === 0 ? 0 : (Date.now() - this.inicioMs) / 1000;
  }

  async iniciar(): Promise<void> {
    if (!suportado()) throw new Error(`Este navegador não grava ${MIME}`);

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    this.inicioMs = Date.now();
    await this.segurarTela();
    this.novoRecorder();
  }

  /**
   * Mantém a tela acesa enquanto grava.
   *
   * O recorder se recria a cada 30 s num `setTimeout` (topo do arquivo), e aba
   * em segundo plano no Chrome Android sofre estrangulamento de timer. Página
   * capturando mídia costuma ser isenta disso — **não foi medido neste
   * sistema**, e a trava existe para a pergunta não precisar de resposta: com a
   * tela acesa a aba nunca vai para segundo plano.
   *
   * Nunca é obrigatória. Navegador sem a API, ou sistema que recusa por bateria
   * baixa, grava do mesmo jeito — perder a trava é perder uma garantia, não a
   * gravação.
   */
  private async segurarTela(): Promise<void> {
    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    try {
      this.trava = await navigator.wakeLock.request("screen");
    } catch {
      this.trava = null;
    }

    // O sistema solta a trava sozinho quando a página some, e não a devolve na
    // volta. Sem repedir, uma notificação atendida no meio da sessão deixaria o
    // resto da gravação desprotegida.
    if (!this.aoVoltar) {
      this.aoVoltar = () => {
        if (document.visibilityState === "visible" && this.stream) void this.segurarTela();
      };
      document.addEventListener("visibilitychange", this.aoVoltar);
    }
  }

  private async soltarTela(): Promise<void> {
    if (this.aoVoltar) {
      document.removeEventListener("visibilitychange", this.aoVoltar);
      this.aoVoltar = null;
    }
    try {
      await this.trava?.release();
    } catch {
      // Já solta pelo sistema — soltar de novo não é erro que interesse.
    }
    this.trava = null;
  }

  private novoRecorder(): void {
    if (!this.stream) return;

    const rec = new MediaRecorder(this.stream, { mimeType: MIME, audioBitsPerSecond: BITRATE });
    this.pedacos = [];

    rec.ondataavailable = (e) => {
      if (e.data.size > 0) this.pedacos.push(e.data);
    };

    rec.onerror = (e) => this.opcoes.aoErro?.(e);

    rec.onstop = () => {
      const blob = new Blob(this.pedacos, { type: MIME });
      this.pedacos = [];

      if (blob.size > 0) this.opcoes.aoBloco({ i: this.proximo++, blob });

      if (this.parando) {
        this.aoParar?.();
        this.aoParar = null;
      } else {
        this.novoRecorder();
      }
    };

    rec.start(); // sem timeslice: um blob só, com header
    this.recorder = rec;

    this.timer = setTimeout(() => {
      if (rec.state === "recording") rec.stop();
    }, DURACAO_CHUNK_MS);
  }

  /** Fecha o bloco em andamento, emite-o e libera o microfone. */
  async parar(): Promise<void> {
    if (this.parando) return;
    this.parando = true;

    if (this.timer) clearTimeout(this.timer);
    this.timer = null;

    if (this.recorder && this.recorder.state !== "inactive") {
      await new Promise<void>((resolve) => {
        this.aoParar = resolve;
        this.recorder!.stop();
      });
    }

    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.recorder = null;
    await this.soltarTela();
  }
}
