"use client";

/**
 * As três marcas do lado de cá (slice 8).
 *
 * O número da fatia é do **toque em parar** até a **revisão abrir**, e nenhum
 * desses dois instantes existe no servidor: o primeiro acontece antes de
 * qualquer requisição sair, o segundo depois de todas terem voltado. Só o
 * navegador pode marcá-los, e ele marca três:
 *
 *   parou        o toque em "parar" — ou, na importação, o arquivo aceito, que
 *                é o último gesto meu antes de a espera começar
 *   fila_vazia   o último bloco subiu e o `/finalizar` vai sair
 *   revisou      a revisão montou a proposta na tela. É o fim da espera
 *
 * **Os três vêm do mesmo relógio**, e é entre eles que a subtração acontece.
 * Nada aqui é comparado com instante de servidor — lá os passos são gravados
 * como duração, nunca como carimbo, justamente para essa conta não existir.
 *
 * **O `sessionStorage` é o que amarra as três**, e ele também é a guarda: a
 * marca da revisão só é mandada se esta aba passou pelo corredor. Abrir a
 * revisão de uma sessão de três semanas atrás pela lista não inventa uma espera
 * de três semanas.
 *
 * **Nada aqui pode custar o ritual.** Toda falha é engolida, e o `sessionStorage`
 * bloqueado (aba anônima, armazenamento negado) faz as marcas simplesmente não
 * existirem — a sessão grava, sobe, extrai e abre exatamente igual.
 */
import type { CaminhoDeEntrada, MarcasDoCliente } from "@/lib/tipos";

const chave = (sessao_id: string) => `medida:${sessao_id}`;

interface MarcaLocal {
  parou: number;
  caminho: CaminhoDeEntrada;
}

function ler(sessao_id: string): MarcaLocal | null {
  try {
    const cru = sessionStorage.getItem(chave(sessao_id));
    if (!cru) return null;
    const v = JSON.parse(cru) as Partial<MarcaLocal>;
    return typeof v?.parou === "number" ? { parou: v.parou, caminho: v.caminho ?? "gravacao" } : null;
  } catch {
    return null;
  }
}

/** Manda o que se sabe. Falha em silêncio: medida não interrompe nada. */
async function mandar(sessao_id: string, corpo: MarcasDoCliente & { caminho?: string }) {
  try {
    await fetch(`/api/sessoes/${sessao_id}/medidas`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    });
  } catch {
    // Sem rede, sem medida. O diário não depende dela.
  }
}

/**
 * O toque em parar. **Não vai à rede** — o instante fica guardado até a tela de
 * processamento ter o que somar a ele.
 *
 * Mandar daqui seria mandar no pior momento possível: é o mesmo instante em que
 * a fila acorda, a sessão é fechada e a navegação acontece.
 */
export function marcarParada(sessao_id: string, caminho: CaminhoDeEntrada = "gravacao"): void {
  try {
    sessionStorage.setItem(chave(sessao_id), JSON.stringify({ parou: Date.now(), caminho }));
  } catch {
    // Armazenamento negado: esta sessão não é medida, e só.
  }
}

/**
 * A fila esvaziou. Manda `parou` e `fila_vazia` juntos, num pedido só.
 *
 * Juntos porque é aqui que os dois existem, e porque um pedido a menos no
 * instante em que o `/finalizar` está saindo é exatamente o que esta fatia
 * está tentando encurtar.
 */
export async function marcarFilaVazia(sessao_id: string): Promise<void> {
  const local = ler(sessao_id);
  if (!local) return;
  await mandar(sessao_id, {
    parou: local.parou,
    fila_vazia: Date.now(),
    caminho: local.caminho,
  });
}

/**
 * A revisão montou. É o fim da espera, e é o que fecha o número.
 *
 * **Só se esta aba passou pelo corredor.** Sem a marca local não há espera
 * nenhuma a fechar — e a entrada é apagada aqui, para reabrir a mesma revisão
 * não sobrescrever o número com o instante da segunda visita.
 */
export async function marcarRevisaoAberta(sessao_id: string): Promise<void> {
  const local = ler(sessao_id);
  if (!local) return;
  try {
    sessionStorage.removeItem(chave(sessao_id));
  } catch {
    // Sem remover: no pior caso a marca é reenviada, e o servidor a sobrescreve.
  }
  await mandar(sessao_id, { parou: local.parou, revisou: Date.now(), caminho: local.caminho });
}
