"use client";

/**
 * Lista de sessões — a porta de serviço.
 *
 * Existe para duas coisas: achar uma sessão e forçar a re-extração dela — é
 * como se calibra o prompt sem gravar áudio novo, já que a trava de
 * idempotência impede reprocessar uma sessão que já tem proposta — e ler a
 * transcrição literal, que saiu da jornada de gravar e mora aqui.
 *
 * **A linha começa pelo que eu disse** (onda 4 da interface): a frase do
 * primeiro item, e embaixo a data, a duração, o status e quantos itens — em
 * revisão, quantos esperam. A data virou detalhe: eu acho a sessão pelo que
 * falei, não pelo dia. Sem item ainda, a data volta para cima.
 *
 * **A lista carrega sozinha** quando a rolagem chega ao fim, de 50 em 50.
 *
 * **É aqui que se vê o que falta revisar**, e é pela cor: verde é sessão que já
 * passou pela revisão, branco é sessão que ainda tem trabalho. Antes isso era um
 * chip na tela de gravar, que aparecia sozinho e cobrava. Um estado que eu leio
 * de relance no lugar onde eu já vou procurar não cobra nada.
 *
 * Fica atrás de um link discreto de propósito. A tela de gravar é "um botão,
 * um timer, um jeito de parar — idealmente nada mais" (`Specs/visao.md` §6), e
 * uma lista de sessões passadas ali vira cobrança: quantos dias, quanto tempo,
 * o que ficou pendente. Aqui não há contagem de nada.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { esperouDemais } from "@/client/espera";
import { dataEHora } from "@/lib/dia";
import { temTranscricao, terminouDeProcessar } from "@/lib/estados";
import { plural } from "@/lib/texto";
import type { StatusSessao } from "@/lib/tipos";

interface Sessao {
  id: string;
  iniciada_em: string;
  duracao_s: number;
  status: string;
  chunks_total: number;
  /** O texto do primeiro item. "" sem item. */
  frase?: string;
  /** Quantos itens: no grafo (confirmada) ou na proposta (em revisão). */
  itens?: number | null;
}

/** Uma página de `GET /api/sessoes`. */
interface Pagina {
  sessoes: Sessao[];
  mais: boolean;
  cursor: string | null;
  total?: number;
}

/** "hoje, 21:03", "ontem, 21:03", "12 ago, 21:03" — no dia de Brasília (`dia.ts`). */
export const quando = (iso: string): string => dataEHora(iso) || "data desconhecida";

export const duracao = (s: number): string =>
  s >= 60 ? `${Math.round(s / 60)} min` : `${Math.max(1, Math.round(s))} s`;

/**
 * O status como se fala, e não o enum: `replace("_", " ")` dava "em revisao",
 * sem acento, e só trocava o primeiro sublinhado. Status que este mapa não
 * conhece aparece cru — melhor que sumir.
 */
const ROTULO_STATUS: Record<StatusSessao, string> = {
  gravando: "gravando",
  finalizando: "guardando o áudio",
  transcrevendo: "transcrevendo",
  transcrito: "transcrito",
  extraindo: "extraindo",
  em_revisao: "em revisão",
  confirmada: "confirmada",
  erro: "erro",
};

export const rotuloStatus = (status: string): string =>
  ROTULO_STATUS[status as StatusSessao] ?? status;

/** A contagem do cabeçalho: o total da lista, que a primeira página traz. */
export const contagem = (n: number): string => plural(n, "sessão", "sessões");

/**
 * Quantos itens, como a linha diz: confirmada, os que estão no grafo; em
 * revisão, os que esperam revisão. "" quando não há o que contar.
 */
export function contaDaSessao(s: Pick<Sessao, "status" | "itens">): string {
  if (typeof s.itens !== "number") return "";
  if (s.status === "em_revisao") return `${s.itens} para revisar`;
  return plural(s.itens, "item", "itens");
}

/**
 * As duas linhas da sessão: em cima a frase, embaixo o resto. Sem frase — a
 * sessão ainda não tem item —, a data sobe: é ela que a identifica.
 */
export function linhasDaSessao(s: Sessao): { cima: string; baixo: string[] } {
  const frase = (s.frase ?? "").trim();
  const resto = [duracao(s.duracao_s), rotuloStatus(s.status), contaDaSessao(s)].filter(
    (p) => p !== "",
  );
  return frase === ""
    ? { cima: quando(s.iniciada_em), baixo: resto }
    : { cima: frase, baixo: [quando(s.iniciada_em), ...resto] };
}

/**
 * A releitura da primeira página, fundida com o que já está na tela: as
 * páginas antigas que eu já rolei não somem. O que é mais novo que o fim da
 * primeira página vem dela — inclusive as que sumiram —, o resto fica.
 */
export function fundirPrimeiraPagina(
  atual: readonly Sessao[] | null,
  primeira: readonly Sessao[],
  fimDaPrimeira: string | null,
): Sessao[] {
  if (atual === null || fimDaPrimeira === null) return [...primeira];
  return [...primeira, ...atual.filter((s) => s.iniciada_em < fimDaPrimeira)];
}

/** A cadência da releitura durante uma re-extração — a mesma da fila de `/entidades`. */
const INTERVALO_RELEITURA_MS = 4000;

/**
 * Para onde a sessão leva quando eu clico nela: **sempre para onde ainda há o
 * que fazer**.
 *
 * Proposta esperando abre na revisão. Sessão confirmada não tem mais trabalho
 * nenhum, e o que resta dela é o texto literal. Todo o resto — inclusive
 * `transcrito` e `extraindo` — vai para o corredor, que é quem sabe empurrar a
 * sessão para o passo seguinte e abre a revisão sozinho quando a proposta fica
 * pronta.
 *
 * `transcrito` levava ao texto literal, e isso era um beco: uma sessão que
 * transcreveu e nunca extraiu — `waitUntil` perdido, extração que morreu — não
 * tinha caminho nenhum até a revisão. Ler a transcrição continua a um toque
 * daqui, no botão ao lado, que é onde essa porta de serviço deve estar.
 */
export function destino(s: Sessao): string {
  if (s.status === "em_revisao") return `/sessao/${s.id}/revisar`;
  if (s.status === "confirmada") return `/sessao/${s.id}/transcricao`;
  return `/sessao/${s.id}`;
}

/**
 * A transcrição literal só se oferece quando ela está inteira no R2. Enquanto
 * a sessão transcreve, o texto ainda está crescendo e quem clica na linha cai
 * na tela de processamento, que é onde essa espera acontece.
 */
export const podeLerTranscricao = (s: Sessao): boolean => temTranscricao(s.status as StatusSessao);

/**
 * Uma sessão já confirmada não se re-extrai: os átomos dela estão no grafo e o
 * confirmar não aceita `confirmada` de novo, então a proposta nova nasceria
 * morta. Desfazer um confirmar não existe nesta slice.
 */
export const podeReextrair = (s: Sessao): boolean =>
  ["transcrito", "extraindo", "em_revisao", "erro"].includes(s.status);

/**
 * Já passou pela revisão: os átomos dela estão no grafo.
 *
 * É o único estado terminal da máquina (`ARCHITECTURE.md` §5) e o único que a
 * lista pinta. Verde tem de querer dizer "terminado" — pintar de verde uma
 * sessão que ainda tem trabalho é pior que não pintar nada.
 */
export const jaRevisada = (s: Sessao): boolean => s.status === "confirmada";

/**
 * Dá para apagar: nada mais vai mudar sozinho nesta sessão.
 *
 * A mesma guarda que a rota aplica, e pelo mesmo motivo — apagar no meio do
 * pipeline correria com um `waitUntil` vivo, que voltaria a gravar o que acabou
 * de sumir. Aqui ela só evita oferecer um botão que levaria 409.
 */
export const podeApagar = (s: Sessao): boolean => terminouDeProcessar(s.status as StatusSessao);

export function Sessoes() {
  const [sessoes, setSessoes] = useState<Sessao[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  /** Onde a próxima página começa, e se ela existe. */
  const [cursor, setCursor] = useState<string | null>(null);
  const [mais, setMais] = useState(false);
  const [carregandoMais, setCarregandoMais] = useState(false);
  const [falhaMais, setFalhaMais] = useState(false);
  const sentinela = useRef<HTMLDivElement | null>(null);
  /**
   * A lista como está na tela, para a releitura fundir sem esperar o render:
   * o `setSessoes` com função roda depois, e a conta do "reextraindo…" precisa
   * da lista fundida agora.
   */
  const sessoesAgora = useRef<Sessao[] | null>(null);
  useEffect(() => {
    sessoesAgora.current = sessoes;
  }, [sessoes]);
  const [falha, setFalha] = useState<string | null>(null);
  const [armado, setArmado] = useState<string | null>(null);
  const [armadoApagar, setArmadoApagar] = useState<string | null>(null);
  const [rodando, setRodando] = useState<string | null>(null);
  /** Re-extrações que eu pedi daqui, e quando: id → instante do pedido. */
  const [feito, setFeito] = useState<Map<string, number>>(new Map());

  /**
   * A primeira página — ao abrir, e na releitura de durante um reextrair. Na
   * releitura ela se funde com o que já está na tela, e o cursor só muda se eu
   * ainda não tinha rolado além dela.
   */
  const carregar = useCallback(async () => {
    const r = await fetch("/api/sessoes", { cache: "no-store" }).catch(() => null);
    if (!r || !r.ok) {
      setFalha("não deu para carregar a lista");
      return;
    }
    const pagina = (await r.json()) as Pagina;
    const lidas = fundirPrimeiraPagina(sessoesAgora.current, pagina.sessoes, pagina.cursor);
    sessoesAgora.current = lidas;
    setSessoes(lidas);
    if (lidas.length === pagina.sessoes.length) {
      setCursor(pagina.cursor);
      setMais(pagina.mais);
    }
    if (typeof pagina.total === "number") setTotal(pagina.total);

    // O "reextraindo…" sai quando a sessão volta a parar. Não na primeira
    // leitura: a rota responde antes de o `waitUntil` trocar o status, e logo
    // depois do pedido a sessão ainda aparece no estado de antes. Um intervalo
    // inteiro de folga cobre isso — extração nenhuma termina em 4 s. O teto é o
    // mesmo do corredor: passado ele, a linha para de prometer.
    const agora = Date.now();
    setFeito((atual) => {
      if (atual.size === 0) return atual;
      const status = new Map(lidas.map((s) => [s.id, s.status]));
      const segue = new Map(
        [...atual].filter(([id, desde]) => {
          const s = status.get(id);
          if (s === undefined || esperouDemais(desde, agora)) return false;
          return !(agora - desde > INTERVALO_RELEITURA_MS && terminouDeProcessar(s as StatusSessao));
        }),
      );
      return segue.size === atual.size ? atual : segue;
    });
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  /** A página seguinte, pedida pelo sentinela no fim da lista. */
  const carregarMais = useCallback(async () => {
    if (!cursor) return;
    setCarregandoMais(true);
    setFalhaMais(false);
    const r = await fetch(`/api/sessoes?antes=${encodeURIComponent(cursor)}`, {
      cache: "no-store",
    }).catch(() => null);
    setCarregandoMais(false);
    if (!r || !r.ok) {
      setFalhaMais(true);
      return;
    }
    const pagina = (await r.json()) as Pagina;
    setSessoes((atual) => {
      const vistas = new Set((atual ?? []).map((s) => s.id));
      return [...(atual ?? []), ...pagina.sessoes.filter((s) => !vistas.has(s.id))];
    });
    setCursor(pagina.cursor);
    setMais(pagina.mais);
  }, [cursor]);

  /**
   * O sentinela: quando o fim da lista chega a 400 px da tela, a próxima página
   * vem. O observador renasce a cada página — é o que faz uma lista curta, com
   * o sentinela já à vista, continuar pedindo até encher a tela. Depois de uma
   * falha ele espera o "tentar de novo": o sentinela parado na tela não
   * dispararia de novo sozinho.
   */
  useEffect(() => {
    const alvo = sentinela.current;
    if (!alvo || !mais || carregandoMais || falhaMais) return;
    const observador = new IntersectionObserver(
      (entradas) => {
        if (entradas.some((e) => e.isIntersecting)) void carregarMais();
      },
      { rootMargin: "400px 0px" },
    );
    observador.observe(alvo);
    return () => observador.disconnect();
  }, [mais, carregandoMais, falhaMais, carregarMais]);

  // Enquanto houver re-extração em curso, a lista relê sozinha: sem isto o
  // status ficava parado no que era no instante do pedido.
  useEffect(() => {
    if (feito.size === 0) return;
    const t = setInterval(() => void carregar(), INTERVALO_RELEITURA_MS);
    return () => clearInterval(t);
  }, [feito.size, carregar]);

  /**
   * Dois toques, não um: forçar sobrescreve uma proposta que eu posso já ter
   * revisado, e um toque acidental numa lista custaria esse trabalho.
   */
  async function reextrair(id: string) {
    if (armado !== id) {
      setArmado(id);
      return;
    }
    setArmado(null);
    setRodando(id);
    setFalha(null);

    const r = await fetch(`/api/sessoes/${id}/extrair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ forcar: true }),
    }).catch(() => null);

    setRodando(null);
    if (!r || !r.ok) {
      setFalha(r ? ((await r.json()) as { erro?: string }).erro ?? "falhou" : "sem resposta");
      return;
    }
    setFeito((s) => new Map(s).set(id, Date.now()));
    void carregar();
  }

  /**
   * Dois toques, como o reextrair, e pelo mesmo motivo escrito lá: um toque
   * acidental numa lista custaria trabalho. Aqui custaria a sessão — o áudio, a
   * transcrição e a proposta somem do R2 e não voltam.
   *
   * A linha sai da lista no sucesso em vez de recarregar: `paginaDeSessoes` já
   * filtra a descartada, mas recarregar seria uma ida ao grafo para descobrir o
   * que esta tela acabou de mandar acontecer.
   */
  async function apagar(id: string) {
    if (armadoApagar !== id) {
      setArmadoApagar(id);
      return;
    }
    setArmadoApagar(null);
    setRodando(id);
    setFalha(null);

    const r = await fetch(`/api/sessoes/${id}`, { method: "DELETE" }).catch(() => null);

    setRodando(null);
    if (!r || !r.ok) {
      setFalha(r ? ((await r.json()) as { erro?: string }).erro ?? "falhou" : "sem resposta");
      return;
    }
    setSessoes((atual) => (atual ?? []).filter((s) => s.id !== id));
    setTotal((t) => (t === null ? t : Math.max(0, t - 1)));
  }

  return (
    <main className="sessoes">
      <header>
        <h1>sessões</h1>
        <p className="aguardando">
          {total !== null ? contagem(total) : "…"} · verde é o que eu já revisei —
          reextrair chama o modelo de novo e sobrescreve a proposta atual; transcrição abre o
          texto literal; apagar tira o áudio e a proposta do R2 e some com a linha
        </p>
      </header>

      {falha && (
        <p className="aviso erro" role="alert">
          {falha}
        </p>
      )}

      <ul className="lista-sessoes">
        {(sessoes ?? []).map((s) => {
          const { cima, baixo } = linhasDaSessao(s);
          return (
          <li key={s.id} className={jaRevisada(s) ? "revisada" : undefined}>
            <Link href={destino(s)} className="quando">
              <span className={s.frase ? "frase" : undefined}>{cima}</span>
              <span className="meta">
                {baixo.join(" · ")}
                {feito.has(s.id) && " · reextraindo…"}
              </span>
            </Link>

            <div className="acoes-sessao">
              {podeLerTranscricao(s) && (
                <Link className="botao" href={`/sessao/${s.id}/transcricao`}>
                  transcrição
                </Link>
              )}

              {podeReextrair(s) ? (
                <button
                  className={armado === s.id ? "botao perigo" : "botao"}
                  disabled={rodando === s.id}
                  onClick={() => void reextrair(s.id)}
                  onBlur={() => armado === s.id && setArmado(null)}
                >
                  {rodando === s.id ? "…" : armado === s.id ? "sobrescrever?" : "reextrair"}
                </button>
              ) : (
                <span
                  className="meta"
                  title={
                    s.status === "confirmada"
                      ? "já está no grafo — desfazer um confirmar não existe"
                      : "ainda não tem transcrição"
                  }
                >
                  —
                </span>
              )}

              {podeApagar(s) && (
                <button
                  className={armadoApagar === s.id ? "botao perigo" : "botao"}
                  disabled={rodando === s.id}
                  onClick={() => void apagar(s.id)}
                  onBlur={() => armadoApagar === s.id && setArmadoApagar(null)}
                  title="apaga o áudio, a transcrição e a proposta no R2; o que já está no grafo fica"
                >
                  {rodando === s.id ? "…" : armadoApagar === s.id ? "apagar?" : "apagar"}
                </button>
              )}
            </div>
          </li>
          );
        })}
      </ul>

      {/* O fim da lista: o sentinela que pede a próxima página, e o que ele diz. */}
      <div ref={sentinela} className="fim-da-lista">
        {carregandoMais && <p className="aguardando">carregando…</p>}
        {falhaMais && (
          <p className="aviso erro" role="alert">
            não deu para carregar as seguintes —{" "}
            <button className="botao discreto" onClick={() => void carregarMais()}>
              tentar de novo
            </button>
          </p>
        )}
      </div>

      {sessoes?.length === 0 && <p className="aguardando">nenhuma sessão ainda</p>}

    </main>
  );
}
