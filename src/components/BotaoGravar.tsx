"use client";

/**
 * O botão central de gravar: o círculo, o brilho que respira, as três ondas
 * de cada lado e o selo de REC.
 *
 * É um componente só, e ele **não troca de árvore** entre parado e gravando —
 * é o mesmo círculo, o mesmo canvas, o mesmo nó do DOM. É isso que permite a
 * transição de 400 ms existir: se a tela trocasse de elemento, não haveria o
 * que transicionar, só um corte.
 *
 * As ondas são canvas, não SVG animado: elas seguem o microfone em tempo real,
 * a 60 quadros por segundo, e reconstruir um path do DOM nessa cadência engasga
 * no celular — que é onde este botão vive.
 *
 * O laço de animação só existe enquanto grava. Parado, o brilho respira em CSS
 * puro e nenhum `requestAnimationFrame` fica de pé: a tela de gravar é onde eu
 * passo o tempo, e nada crônico roda ali à toa.
 */
import { useEffect, useRef } from "react";
import {
  ALFA_PONTA,
  alturaOnda,
  amplitudePx,
  CAMADAS,
  comAlfa,
  nivelRms,
  nivelSimulado,
  suavizar,
} from "@/lib/onda";

interface Props {
  gravando: boolean;
  /** Abrindo o microfone ou encerrando: o círculo esmaece e não aceita toque. */
  ocupado?: boolean;
  rotulo: string;
  /** O stream do microfone, quando existe. Sem ele a onda é simulada. */
  faixa?: MediaStream | null;
  aoTocar?: () => void;
}

/** Passo de amostragem da onda, em px. Mais fino que isso ninguém vê. */
const PASSO_PX = 2;

/** Velocidade da crista viajando para fora, em radianos por segundo. */
const VELOCIDADE = 3.2;

/** Abaixo disso não sobra percurso entre o círculo e a borda: sem onda. */
const PERCURSO_MINIMO_PX = 8;

export function BotaoGravar({ gravando, ocupado = false, rotulo, faixa, aoTocar }: Props) {
  const palco = useRef<HTMLDivElement | null>(null);
  const tela = useRef<HTMLCanvasElement | null>(null);
  const circulo = useRef<HTMLButtonElement | null>(null);
  const analisador = useRef<AnalyserNode | null>(null);
  const nivel = useRef(0);

  /**
   * Medir custa layout, e medir a cada quadro custa layout 60 vezes por
   * segundo. O `ResizeObserver` avisa quando muda — que é raro: girar o
   * aparelho, abrir o teclado. Entre um aviso e outro o laço só lê números.
   */
  const medidas = useRef({ largura: 0, altura: 0, raio: 0, dpr: 1 });

  useEffect(() => {
    const p = palco.current;
    if (!p) return;

    function medir() {
      const c = tela.current;
      const alvo = palco.current;
      if (!c || !alvo) return;

      const { width, height } = alvo.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.round(width * dpr);
      const h = Math.round(height * dpr);
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
      c.getContext("2d")?.setTransform(dpr, 0, 0, dpr, 0, 0);
      medidas.current = {
        largura: width,
        altura: height,
        raio: (circulo.current?.offsetWidth ?? 0) / 2,
        dpr,
      };
    }

    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(p);
    return () => observador.disconnect();
  }, []);

  /**
   * Web Audio só enquanto grava, e desmontado ao parar: um `AudioContext` de
   * pé segura hardware de áudio e conta como microfone em uso.
   *
   * O analisador não se liga ao destino — ligar devolveria o próprio microfone
   * pelo alto-falante, que é microfonia na cara de quem está falando.
   */
  useEffect(() => {
    if (!gravando || !faixa) return;

    const Contexto =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Contexto) return;

    let contexto: AudioContext;
    let fonte: MediaStreamAudioSourceNode;
    try {
      contexto = new Contexto();
      fonte = contexto.createMediaStreamSource(faixa);
      const no = contexto.createAnalyser();
      no.fftSize = 1024;
      no.smoothingTimeConstant = 0.8;
      fonte.connect(no);
      analisador.current = no;
    } catch {
      // Navegador sem Web Audio, ou stream que ele recusa: a onda simula.
      analisador.current = null;
      return;
    }

    return () => {
      analisador.current = null;
      fonte.disconnect();
      void contexto.close();
    };
  }, [gravando, faixa]);

  useEffect(() => {
    const c = tela.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;

    if (!gravando) {
      // O canvas some por opacidade, mas o último quadro fica pintado nele —
      // e reapareceria por um instante na gravação seguinte. Limpa.
      ctx.clearRect(0, 0, c.width, c.height);
      nivel.current = 0;
      return;
    }

    const semMovimento = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    // Resolvida uma vez: `getComputedStyle` por quadro é caro, e a cor do
    // acento é a mesma nos dois temas — só fundo e texto trocam.
    const cor = getComputedStyle(c).color;
    // Uma cor por camada, resolvida aqui: dentro do laço isso seria seis
    // concatenações de string por quadro, 360 por segundo, à toa.
    const cores = CAMADAS.map((camada) => ({
      saida: comAlfa(cor, camada.alfa),
      ponta: comAlfa(cor, camada.alfa * ALFA_PONTA),
    }));

    const amostras = new Uint8Array(1024);
    let quadro = 0;
    let inicio = 0;

    function desenhar(agora: number) {
      quadro = requestAnimationFrame(desenhar);
      if (inicio === 0) inicio = agora;

      const { largura, altura, raio } = medidas.current;
      const percurso = largura / 2 - raio;
      if (largura === 0 || percurso < PERCURSO_MINIMO_PX) return;

      ctx!.clearRect(0, 0, largura, altura);

      const meio = largura / 2;
      const eixo = altura / 2;

      const bruto = analisador.current
        ? (analisador.current.getByteTimeDomainData(amostras), nivelRms(amostras))
        : nivelSimulado(agora - inicio);
      nivel.current = suavizar(nivel.current, bruto);

      const amplitude = amplitudePx(nivel.current);
      // Sem movimento: a onda vira o nível do som parado, sem crista viajando.
      const fase = semMovimento ? 0 : ((agora - inicio) / 1000) * VELOCIDADE;

      ctx!.lineWidth = 1.5;
      ctx!.lineCap = "round";
      ctx!.lineJoin = "round";

      for (const lado of [-1, 1] as const) {
        const de = meio + lado * raio;
        const ate = meio + lado * (raio + percurso);

        CAMADAS.forEach((camada, i) => {
          // Degradê da borda do círculo até a ponta: a onda não termina, apaga.
          const grad = ctx!.createLinearGradient(de, 0, ate, 0);
          grad.addColorStop(0, cores[i].saida);
          grad.addColorStop(1, cores[i].ponta);
          ctx!.strokeStyle = grad;

          ctx!.beginPath();
          for (let d = 0; d <= percurso; d += PASSO_PX) {
            const x = meio + lado * (raio + d);
            const y =
              eixo +
              alturaOnda(d / percurso, amplitude * camada.amplitude, fase + camada.fase, camada.ciclos);
            if (d === 0) ctx!.moveTo(x, y);
            else ctx!.lineTo(x, y);
          }
          ctx!.stroke();
        });
      }
    }

    quadro = requestAnimationFrame(desenhar);
    return () => cancelAnimationFrame(quadro);
  }, [gravando]);

  return (
    <div ref={palco} className={`palco ${gravando ? "gravando" : ""}`}>
      <canvas ref={tela} className="ondas" aria-hidden="true" />
      <span className="brilho" aria-hidden="true" />

      <button
        ref={circulo}
        type="button"
        className={`botao-gravar ${ocupado ? "esmaecido" : ""}`}
        onClick={aoTocar}
        disabled={ocupado || gravando}
      >
        {rotulo}
      </button>

      {gravando && (
        <p className="selo-rec" role="status" aria-label="gravando">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <rect x="9" y="2.5" width="6" height="11.5" rx="3" />
            <path d="M5 11.5a7 7 0 0 0 14 0" />
            <path d="M12 18.5v3" />
          </svg>
          <i aria-hidden="true" />
          <span>REC</span>
        </p>
      )}
    </div>
  );
}
