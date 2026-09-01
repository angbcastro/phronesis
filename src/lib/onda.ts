/**
 * A matemática das ondas laterais do botão de gravar. (client)
 *
 * Fica fora do componente de propósito: é a única parte desenhável que dá para
 * testar sem canvas, sem microfone e sem navegador. O componente cuida de
 * pixels e de `requestAnimationFrame`; aqui só entram números.
 *
 * A onda sai da borda do círculo e morre na ponta. `envelope()` é quem faz
 * isso: sobe rápido nos primeiros 15 % do percurso — para a linha parecer
 * *saindo* do círculo, e não colada nele — e decai o resto do caminho.
 */

/** Altura máxima da onda, em px, do silêncio ao pico de fala. */
export const AMPLITUDE_MIN = 15;
export const AMPLITUDE_MAX = 25;

/** Fração do percurso em que a onda ainda está ganhando corpo. */
export const RAMPA = 0.15;

/**
 * Fala normal a 20 cm do celular dá RMS na casa de 0,05–0,20. Sem ganho, a
 * onda ficaria parada no mínimo o tempo todo; com ganho demais, saturada em
 * qualquer sílaba. 4 põe a conversa normal no meio da faixa.
 */
export const GANHO = 4;

/** Quanto o nível novo pesa contra o anterior. Baixo = onda menos nervosa. */
export const SUAVIZACAO = 0.18;

/**
 * Nível 0..1 a partir do domínio do tempo do `AnalyserNode`, que chega em
 * bytes centrados em 128. É RMS, não pico: pico pula com qualquer estalo.
 */
export function nivelRms(amostras: Uint8Array | number[]): number {
  if (amostras.length === 0) return 0;
  let soma = 0;
  for (let i = 0; i < amostras.length; i++) {
    const v = (amostras[i] - 128) / 128;
    soma += v * v;
  }
  return Math.min(1, Math.sqrt(soma / amostras.length) * GANHO);
}

/** Média móvel exponencial: o que impede a onda de tremer a cada quadro. */
export const suavizar = (anterior: number, novo: number): number =>
  anterior + (novo - anterior) * SUAVIZACAO;

/** Nível 0..1 → altura em px, dentro da faixa que a especificação fixa. */
export const amplitudePx = (nivel: number): number =>
  AMPLITUDE_MIN + (AMPLITUDE_MAX - AMPLITUDE_MIN) * Math.min(1, Math.max(0, nivel));

/**
 * Peso da amplitude ao longo do percurso, com `t` indo de 0 (borda do círculo)
 * a 1 (ponta). Zero nas duas extremidades: encostado no círculo a linha seria
 * cortada por ele, e na ponta ela precisa sumir em vez de ser decepada.
 */
export function envelope(t: number): number {
  if (t <= 0 || t >= 1) return 0;
  const subida = Math.min(1, t / RAMPA);
  const descida = (1 - t) ** 1.2;
  return subida * descida;
}

/** Quantas cristas cabem no percurso. Leve ainda, mas não um traço só. */
export const CICLOS = 3.55;

/**
 * Deslocamento vertical em px no ponto `t`. A fase entra subtraída para a
 * crista viajar do círculo para fora, e não o contrário.
 */
export const alturaOnda = (
  t: number,
  amplitude: number,
  fase: number,
  ciclos: number = CICLOS,
): number => envelope(t) * amplitude * Math.sin(2 * Math.PI * ciclos * t - fase);

export interface Camada {
  /** Fração da amplitude do momento. A primeira leva tudo. */
  amplitude: number;
  ciclos: number;
  /** Defasagem fixa, em radianos, para as três não nascerem juntas. */
  fase: number;
  /** Opacidade da linha na saída do círculo. */
  alfa: number;
}

/**
 * As três linhas de cada lado.
 *
 * Os `ciclos` são propositalmente incomensuráveis entre si (3,55 · 4,25 · 3):
 * em razão simples as três se realinhariam a cada poucos segundos e o conjunto
 * piscaria como uma onda só, grossa. Estes três foram escolhidos por busca — a
 * razão mais próxima de um racional curto ainda fica a 0,083 dele —, e é isso
 * que o teste "os ciclos não estão em razão simples" protege.
 *
 * A amplitude decresce e a opacidade também: é uma linha principal com duas
 * acompanhando, não três iguais disputando a mesma faixa.
 */
export const CAMADAS: readonly Camada[] = [
  { amplitude: 1, ciclos: CICLOS, fase: 0, alfa: 1 },
  { amplitude: 0.62, ciclos: 4.25, fase: 2.1, alfa: 0.68 },
  { amplitude: 0.4, ciclos: 3, fase: 4.3, alfa: 0.46 },
];

/**
 * Quando não há microfone para ouvir — navegador sem Web Audio, permissão
 * ainda pendente — a onda continua se mexendo com duas senoides de períodos
 * incomensuráveis, que é o que evita o vaivém óbvio de uma só.
 */
export const nivelSimulado = (ms: number): number =>
  0.45 + 0.25 * Math.sin(ms / 900) + 0.15 * Math.sin(ms / 337);

/**
 * Repinta uma cor computada com outro alfa.
 *
 * O canvas não entende `color-mix()` num `addColorStop`, e ler `--acento` cru
 * devolveria o texto do token, não uma cor resolvida. O caminho que funciona é
 * o navegador resolver (`getComputedStyle(...).color`, que sempre volta como
 * `rgb()`/`rgba()`) e trocarmos só o alfa aqui.
 */
export function comAlfa(cor: string, alfa: number): string {
  const n = cor.match(/-?[\d.]+/g);
  if (!n || n.length < 3) return cor;
  return `rgba(${n[0]}, ${n[1]}, ${n[2]}, ${alfa})`;
}

/** Opacidade da onda na ponta, onde ela atenua. */
export const ALFA_PONTA = 0.4;
