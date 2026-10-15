/**
 * O tocador dos trechos: o ▶ da revisão, da calibração e do (i) do chat.
 *
 * Eram cópias de "pedir a URL do bloco e tocar", e nenhuma dizia nada — sem
 * carregando, sem tocando, sem parar, falha calada, e tocando do trecho até o
 * fim do bloco de 30 s. Agora é um gancho só (`Specs/interface-onda-3.md`,
 * decisão 4):
 *
 * - toca de **2 s antes** do início do trecho até o fim dele, e para sozinho;
 * - tocar de novo no mesmo ▶ para; tocar outro para o anterior — um por tela;
 * - o estado de cada ▶ é `carregando`, `tocando` ou `falhou`, e a tela o mostra;
 * - trecho que atravessa a borda de um bloco continua no seguinte;
 * - trecho sem fim (a correção da calibração guarda só o início, e átomo antigo
 *   pode não ter `fins_s`) toca até o fim do bloco.
 *
 * O áudio nunca passa por function (regra 1): cada bloco é uma URL presigned de
 * 5 min, pedida no toque, e o navegador busca os bytes direto no R2.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { BlocoAbsoluto } from "@/lib/tipos";

/** Quanto antes do início do trecho a escuta começa — o fio da frase. */
export const MARGEM_ANTES_S = 2;

/** Um pedaço de escuta dentro de um bloco: de onde a onde, em segundos dele. */
export interface Segmento {
  i: number;
  de: number;
  /** `null` é "até o fim do bloco". */
  ate: number | null;
}

/**
 * O que ouvir, recortado em blocos. Puro, para o teste.
 *
 * A margem não entra no bloco anterior: ela para no começo do bloco do trecho,
 * porque emendar dois blocos para ouvir dois segundos de respiração custaria
 * uma requisição a mais por toque. O fim, sim, atravessa: o que eu disse não
 * pode ser cortado no meio.
 */
export function intervaloDeEscuta(
  blocos: readonly BlocoAbsoluto[],
  inicio_s: number,
  fim_s: number | null,
  margem: number = MARGEM_ANTES_S,
): Segmento[] {
  const ordem = [...blocos].sort((a, b) => a.offset_s - b.offset_s);
  if (ordem.length === 0 || !Number.isFinite(inicio_s)) return [];

  let k = ordem.length - 1;
  while (k > 0 && ordem[k].offset_s > inicio_s) k--;
  const primeiro = ordem[k];
  const de = Math.max(0, inicio_s - margem - primeiro.offset_s);

  const fim = fim_s !== null && Number.isFinite(fim_s) && fim_s > inicio_s ? fim_s : null;
  if (fim === null) return [{ i: primeiro.i, de, ate: null }];

  const segmentos: Segmento[] = [];
  for (let j = k; j < ordem.length; j++) {
    const bloco = ordem[j];
    const proximo = ordem[j + 1];
    const comeco = j === k ? de : 0;
    if (!proximo || fim <= proximo.offset_s) {
      segmentos.push({ i: bloco.i, de: comeco, ate: fim - bloco.offset_s });
      break;
    }
    segmentos.push({ i: bloco.i, de: comeco, ate: null });
  }
  return segmentos;
}

const mmss = (s: number) =>
  `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export type EstadoDoTocador = "carregando" | "tocando" | "falhou";

/** O texto do ▶, em cada estado. Puro, para o teste. */
export function textoDoOuvir(
  estado: EstadoDoTocador | null,
  inicio_s: number,
  fim_s: number | null,
): string {
  if (estado === "falhou") return "sem áudio";
  if (estado === "carregando") return `… ${mmss(inicio_s)}`;
  if (estado === "tocando") {
    const de = Math.max(0, inicio_s - MARGEM_ANTES_S);
    return fim_s === null ? `■ ${mmss(de)}` : `■ ${mmss(de)}–${mmss(fim_s)}`;
  }
  return `▶ ${mmss(inicio_s)}`;
}

/** O nome que o leitor de tela ouve, em cada estado. */
export function nomeDoOuvir(estado: EstadoDoTocador | null, inicio_s: number): string {
  if (estado === "falhou") return `não consegui tocar o trecho de ${mmss(inicio_s)} — tocar tenta de novo`;
  if (estado === "carregando") return `carregando o trecho de ${mmss(inicio_s)}`;
  if (estado === "tocando") return `parar o trecho de ${mmss(inicio_s)}`;
  return `ouvir a partir de ${mmss(inicio_s)}`;
}

export interface PedidoDeEscuta {
  sessao_id: string;
  inicio_s: number;
  fim_s: number | null;
}

/**
 * Toca um bloco do segundo `de` ao `ate`, e resolve quando acaba, falha ou é
 * cancelado. `timeupdate` chega umas quatro vezes por segundo: o corte no fim
 * erra por um quarto de segundo, que é menos que uma sílaba.
 */
function tocarSegmento(
  el: HTMLAudioElement,
  url: string,
  seg: Segmento,
  cancelado: () => boolean,
  aoComecar: () => void,
): Promise<"fim" | "erro" | "cancelado"> {
  return new Promise((resolve) => {
    const limpar = () => {
      el.onloadedmetadata = null;
      el.onplaying = null;
      el.ontimeupdate = null;
      el.onended = null;
      el.onerror = null;
      el.onpause = null;
    };
    const acabar = (como: "fim" | "erro" | "cancelado") => {
      limpar();
      resolve(como);
    };
    el.pause();
    el.src = url;
    // Safari só aceita `currentTime` depois dos metadados.
    el.onloadedmetadata = () => {
      el.currentTime = seg.de;
      el.play().catch(() => acabar(cancelado() ? "cancelado" : "erro"));
    };
    el.onplaying = aoComecar;
    el.ontimeupdate = () => {
      if (cancelado()) return acabar("cancelado");
      if (seg.ate !== null && el.currentTime >= seg.ate) {
        el.pause();
        acabar("fim");
      }
    };
    el.onpause = () => {
      if (cancelado()) acabar("cancelado");
    };
    el.onended = () => acabar("fim");
    el.onerror = () => acabar(cancelado() ? "cancelado" : "erro");
    el.load();
  });
}

/**
 * O gancho. `blocosDe` diz onde está cada segundo de uma sessão — a revisão já
 * tem os blocos; a calibração e o chat buscam, uma vez por sessão.
 */
export function useTocador(blocosDe: (sessao_id: string) => Promise<readonly BlocoAbsoluto[] | null>) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [atual, setAtual] = useState<{ chave: string; estado: EstadoDoTocador } | null>(null);
  const atualRef = useRef(atual);
  atualRef.current = atual;
  const geracao = useRef(0);
  const fonteDosBlocos = useRef(blocosDe);
  fonteDosBlocos.current = blocosDe;

  const parar = useCallback(() => {
    geracao.current++;
    audio.current?.pause();
    setAtual(null);
  }, []);

  // Sair da tela para o som: um áudio tocando sem tela é microfone de outro.
  useEffect(() => () => {
    geracao.current++;
    audio.current?.pause();
  }, []);

  const tocar = useCallback(
    async (chave: string, pedido: PedidoDeEscuta) => {
      const agora = atualRef.current;
      if (agora?.chave === chave && agora.estado !== "falhou") {
        parar();
        return;
      }
      const minha = ++geracao.current;
      const vale = () => minha === geracao.current;
      audio.current?.pause();
      audio.current ??= new Audio();
      const el = audio.current;
      el.preload = "auto";
      setAtual({ chave, estado: "carregando" });

      const falhar = () => vale() && setAtual({ chave, estado: "falhou" });

      const blocos = await fonteDosBlocos.current(pedido.sessao_id).catch(() => null);
      if (!vale()) return;
      const segmentos = blocos ? intervaloDeEscuta(blocos, pedido.inicio_s, pedido.fim_s) : [];
      if (segmentos.length === 0) return falhar();

      for (const seg of segmentos) {
        const r = await fetch(`/api/sessoes/${pedido.sessao_id}/chunks/${seg.i}/audio`).catch(() => null);
        if (!vale()) return;
        if (!r || !r.ok) return falhar();
        const { url } = (await r.json()) as { url: string };
        if (!vale()) return;
        const como = await tocarSegmento(el, url, seg, () => !vale(), () => {
          if (vale()) setAtual({ chave, estado: "tocando" });
        });
        if (como === "cancelado" || !vale()) return;
        if (como === "erro") return falhar();
      }
      if (vale()) setAtual(null);
    },
    [parar],
  );

  const estadoDe = useCallback(
    (chave: string): EstadoDoTocador | null => (atual?.chave === chave ? atual.estado : null),
    [atual],
  );

  return { tocar, parar, estadoDe };
}
