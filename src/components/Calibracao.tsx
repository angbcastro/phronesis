"use client";

/**
 * Tela de calibração — o que eu já corrigi, e o que fazer com isso.
 *
 * Não é placar e não é nota. Não há percentual, não há "melhorou", não há
 * contagem por sessão: `CLAUDE.md` proíbe métrica de qualidade automática, e
 * esta tela não é a exceção. O que ela mostra é **memória do que eu corrigi**,
 * para eu decidir, olhando, se aquilo virou padrão.
 *
 * **Dois níveis desde a slice 7.** Antes era uma tela só, porque havia um
 * agente só a calibrar; agora a porta abre numa lista de agentes e cada um tem
 * a sua página. A lista existe para eu não abrir uma parede de correções de
 * cinco agentes misturados e ter que separar com o olho — o que a tela de
 * confronto já ensinou a não fazer.
 *
 * **E o fluxo tem dois passos, nesta ordem, sempre.** Primeiro o `calibracao-2`
 * diz que padrão as correções revelam e eu confirmo, edito ou descarto — é o
 * gesto que a 4.6 já tinha. Só então o `redacao-1` decide **onde no prompt**
 * aquilo entra, e eu leio seção por seção antes de aprovar. O segundo passo
 * nunca acontece sem o primeiro: prompt não se reescreve, se emenda.
 *
 * O desenho da correção saiu do material, não do palpite. Medido na primeira
 * rodada real (5 sessões, 21 correções): **metade é correção de `texto`, com
 * `antes` e `depois` de 200 a 660 caracteres.** Então isto não é uma lista de
 * rótulos curtos — é uma tela de ler dois parágrafos e enxergar onde diferem.
 * Daí a regra: par curto vai em linha, com a seta; par longo vai empilhado, um
 * bloco embaixo do outro, cada um com sua etiqueta. Sem diff colorido: cor que
 * decide o que mudou é a tela afirmando uma leitura que eu não pedi — e isso
 * vale igual para a emenda, que é o par mais longo que esta tela já mostrou.
 *
 * **O áudio é o que torna a correção legível meses depois.** Um `antes → depois`
 * solto não diz se eu tinha razão; o trecho tocando diz.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { localizarNoAudio } from "@/lib/transcricao";
import { MAX_PADROES_POR_RODADA } from "@/lib/tipos";
import type { BlocoAbsoluto, Correcao, Edicao, Padrao, TipoCorrecao } from "@/lib/tipos";

/** O que eu fiz, dito como eu diria. O tipo interno é do código, não da tela. */
const ROTULO: Record<TipoCorrecao, string> = {
  rejeitado: "rejeitei o átomo",
  texto: "reescrevi o texto",
  tipo: "troquei o tipo",
  sujeito: "troquei o sujeito",
  mencao_adicionada: "acrescentei menção",
  mencao_removida: "tirei menção",
  entidade_recusada: "recusei a entidade",
  entidade_renomeada: "renomeei a entidade",
  entidade_tipo: "troquei o tipo da entidade",
  faltou: "faltou isto",
};

/** O que o redator fez com a seção, dito como eu leria. */
const ROTULO_OPERACAO: Record<string, string> = {
  acrescentar: "acrescentou ao fim",
  reescrever: "reescreveu",
  criar: "criou",
};

/**
 * Acima disto, o par não cabe numa linha e vai empilhado.
 *
 * 90 é onde os dois grupos do material real se separam: renome e troca de tipo
 * vivem abaixo de 30 caracteres, reescrita de átomo vive acima de 200.
 */
export const LIMITE_LINHA = 90;

export const cabeEmLinha = (antes: string, depois: string): boolean =>
  antes.length + depois.length <= LIMITE_LINHA;

const mmss = (s: number) =>
  `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/**
 * "2026-09-04T00:55Z" → "03 de set", no fuso de quem lê. Situa a correção sem
 * pesar a linha — e a data que importa é a local, que é quando eu revisei.
 */
export function diaMes(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");
}

/** O que a tela precisa de uma sessão para tocar o áudio e mostrar o refugo. */
interface DaSessao {
  blocos: BlocoAbsoluto[];
  descartados: { motivo: string }[];
}

/** Uma linha da porta: um agente, e quanto material dele está parado. */
interface NaLista {
  id: string;
  rotulo: string;
  papel: string;
  abertas: number;
  pauta: number;
}

interface Porta {
  agentes: NaLista[];
  grafo: number;
  atualizado_em: string;
}

interface DoAgente {
  agente: { id: string; rotulo: string; papel: string; versao: string | null };
  correcoes: Correcao[];
  pauta: Padrao[];
  secoes: string[];
  editado: boolean;
}

/** Um padrão na tela: o que já está na pauta ou o que o agente acabou de propor. */
interface PadraoNaTela {
  id: string;
  texto: string;
  cita: string[];
  substitui?: string;
  novo?: boolean;
}

/** A emenda proposta, com o texto de antes para eu ler os dois lados. */
interface Emenda {
  edicoes: Edicao[];
  texto: string | null;
  anterior?: string;
  protegida?: string | null;
}

/**
 * O que o parser recusou, agrupado por motivo.
 *
 * A revisão já carregava `descartados` e nunca os renderizou — item que o
 * modelo devolveu e a validação jogou fora, com o motivo. É o outro lado da
 * correção: ali eu digo o que ficou torto, aqui o código diz o que nem passou.
 */
export function agruparDescartes(
  porSessao: Record<string, DaSessao | undefined>,
): { motivo: string; n: number }[] {
  const contagem = new Map<string, number>();
  for (const dados of Object.values(porSessao)) {
    for (const d of dados?.descartados ?? []) {
      contagem.set(d.motivo, (contagem.get(d.motivo) ?? 0) + 1);
    }
  }
  return [...contagem]
    .map(([motivo, n]) => ({ motivo, n }))
    .sort((a, b) => b.n - a.n || a.motivo.localeCompare(b.motivo));
}

/**
 * O corpo de uma seção no prompt, para a tela poder mostrar o que ela dizia
 * antes ao lado do que vai passar a dizer.
 *
 * É a mesma leitura de `fatiar` em `redacao.ts`, e é de propósito que ela seja
 * **só de leitura** aqui: quem aplica a emenda é o servidor, das mesmas edições,
 * e uma segunda implementação de `aplicarEdicoes` na tela divergiria calada —
 * o mesmo argumento que pôs `referencias.ts` num módulo só.
 */
export function corpoDaSecao(prompt: string, secao: string): string {
  const linhas = prompt.split("\n");
  const i = linhas.findIndex((l) => l.trim() === secao.trim());
  if (i === -1) return "";

  const fim = linhas.findIndex(
    (l, k) => k > i && /^[A-ZÁÂÃÀÉÊÍÓÔÕÚÇ][A-ZÁÂÃÀÉÊÍÓÔÕÚÇ 0-9]{3,}$/.test(l),
  );
  return linhas
    .slice(i + 1, fim === -1 ? undefined : fim)
    .join("\n")
    .trim();
}

export function Calibracao() {
  const [porta, setPorta] = useState<Porta | null>(null);
  const [escolhido, setEscolhido] = useState<string | null>(null);
  const [dados, setDados] = useState<DoAgente | null>(null);
  const [falha, setFalha] = useState<string | null>(null);
  const [sessoes, setSessoes] = useState<Record<string, DaSessao | undefined>>({});
  const [refugoAberto, setRefugoAberto] = useState(false);

  /** A pauta inteira: o que já vale mais o que o agente acabou de propor. */
  const [pauta, setPauta] = useState<PadraoNaTela[]>([]);
  const [emenda, setEmenda] = useState<Emenda | null>(null);
  const [rascunhando, setRascunhando] = useState(false);
  const [redigindo, setRedigindo] = useState(false);
  const [aprovando, setAprovando] = useState(false);
  const [recado, setRecado] = useState<string | null>(null);

  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch("/api/calibracao", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(((await r.json()) as { erro?: string }).erro ?? `erro ${r.status}`);
        return (await r.json()) as Porta;
      })
      .then((d) => vivo && setPorta(d))
      .catch((e: Error) => vivo && setFalha(e.message));
    return () => {
      vivo = false;
    };
  }, []);

  const abrirAgente = useCallback(async (id: string) => {
    setEscolhido(id);
    setDados(null);
    setEmenda(null);
    setRecado(null);
    setRefugoAberto(false);

    const r = await fetch(`/api/calibracao?agente=${encodeURIComponent(id)}`, {
      cache: "no-store",
    }).catch(() => null);
    if (!r?.ok) {
      setFalha("não deu para ler o material deste agente");
      return;
    }
    const d = (await r.json()) as DoAgente;
    setDados(d);
    setPauta(d.pauta.map((p) => ({ id: p.id, texto: p.texto, cita: p.cita, substitui: p.substitui })));
  }, []);

  /** Uma ida por sessão, guardada. A tela abre sem buscar proposta nenhuma. */
  const carregarSessao = useCallback(
    async (sessao_id: string): Promise<DaSessao | null> => {
      const guardada = sessoes[sessao_id];
      if (guardada) return guardada;

      const r = await fetch(`/api/sessoes/${sessao_id}/extracao`, { cache: "no-store" }).catch(
        () => null,
      );
      if (!r || !r.ok) return null;

      const d = (await r.json()) as {
        blocos: BlocoAbsoluto[];
        extracao: { descartados?: { motivo: string }[] };
      };
      const dados: DaSessao = { blocos: d.blocos ?? [], descartados: d.extracao?.descartados ?? [] };
      setSessoes((s) => ({ ...s, [sessao_id]: dados }));
      return dados;
    },
    [sessoes],
  );

  /** Mesma mecânica da revisão: bloco certo, segundo certo, URL por clique. */
  const escutar = useCallback(
    async (sessao_id: string, segundo: number) => {
      const dados = await carregarSessao(sessao_id);
      if (!dados) return;

      const alvo = localizarNoAudio(dados.blocos, segundo);
      if (!alvo) return;

      const r = await fetch(`/api/sessoes/${sessao_id}/chunks/${alvo.i}/audio`);
      if (!r.ok) return;
      const { url } = (await r.json()) as { url: string };

      const el = audio.current;
      if (!el) return;
      el.pause();
      el.src = url;
      // Safari só aceita currentTime depois dos metadados, como na revisão.
      el.onloadedmetadata = () => {
        el.currentTime = alvo.dentro;
        void el.play();
      };
      el.currentTime = alvo.dentro;
      void el.play().catch(() => {});
    },
    [carregarSessao],
  );

  /** Passo 1: o agente enxerga o padrão. Uma chamada por toque, nunca ao abrir. */
  async function pedirPadroes() {
    if (!escolhido) return;
    setRascunhando(true);
    setRecado(null);
    setEmenda(null);

    const r = await fetch("/api/calibracao/padroes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agente: escolhido }),
    }).catch(() => null);
    setRascunhando(false);

    if (!r || !r.ok) {
      setRecado(r ? (((await r.json()) as { erro?: string }).erro ?? "falhou") : "sem resposta");
      return;
    }
    const d = (await r.json()) as { padroes: PadraoNaTela[] };
    if (d.padroes.length === 0) {
      setRecado(
        "o agente não achou padrão suficiente para propor — o que é uma resposta legítima, e frequente",
      );
      return;
    }
    setPauta((atual) => [...atual, ...d.padroes.map((p) => ({ ...p, novo: true }))]);
  }

  /** Passo 2: a pauta que eu confirmei vira emenda. Ainda não grava nada. */
  async function pedirEmenda() {
    if (!escolhido) return;
    setRedigindo(true);
    setRecado(null);

    const r = await fetch("/api/calibracao/redacao", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agente: escolhido,
        padroes: pauta.map(({ id, texto, cita, substitui }) => ({ id, texto, cita, substitui })),
      }),
    }).catch(() => null);
    setRedigindo(false);

    if (!r || !r.ok) {
      setRecado(r ? (((await r.json()) as { erro?: string }).erro ?? "falhou") : "sem resposta");
      return;
    }
    const d = (await r.json()) as Emenda;
    // A pauta foi gravada mesmo assim: posso fechar a aba e voltar a ela.
    setPauta((atual) => atual.map(({ novo: _, ...p }) => p));

    if (d.edicoes.length === 0) {
      setRecado("o redator não achou onde isto entra no prompt — a pauta continua guardada");
      return;
    }
    setEmenda(d);
  }

  /** O único toque que escreve. O corpo manda as edições, nunca o texto final. */
  async function aprovar() {
    if (!escolhido || !emenda) return;
    setAprovando(true);
    setRecado(null);

    const r = await fetch("/api/calibracao/aprovar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agente: escolhido, edicoes: emenda.edicoes }),
    }).catch(() => null);
    setAprovando(false);

    if (!r || !r.ok) {
      setRecado(r ? (((await r.json()) as { erro?: string }).erro ?? "falhou") : "sem resposta");
      return;
    }
    const d = (await r.json()) as { hash: string | null; secoes: number; fechadas: number };
    setEmenda(null);
    setRecado(
      `em vigor a partir da próxima chamada · ${d.hash} · ${d.secoes} seção(ões)` +
        (d.fechadas > 0 ? ` · ${d.fechadas} correção(ões) endereçada(s)` : ""),
    );
    await abrirAgente(escolhido);
  }

  async function abrirRefugo() {
    setRefugoAberto(true);
    const ids = [...new Set((dados?.correcoes ?? []).map((c) => c.sessao_id))];
    for (const id of ids) await carregarSessao(id);
  }

  if (falha && !porta) {
    return (
      <main className="leitura">
        <h1>calibração</h1>
        <p className="aguardando">{falha}</p>
      </main>
    );
  }

  if (!porta) {
    return (
      <main className="leitura">
        <h1>calibração</h1>
        <p className="aguardando">…</p>
      </main>
    );
  }

  // ─────────────────────────────── a porta ───────────────────────────────

  if (escolhido === null) {
    const comMaterial = porta.agentes.filter((a) => a.abertas > 0 || a.pauta > 0);

    return (
      <main className="calibracao">
        <header>
          <h1>o que eu corrigi</h1>
          <p className="aguardando">
            {comMaterial.length === 0
              ? "nada em aberto — toda correção já foi endereçada por alguma emenda"
              : "cada agente se calibra no próprio material; o que se repete é o que vale virar emenda do prompt dele"}
          </p>
        </header>

        {comMaterial.length === 0 ? (
          <p className="aguardando">
            As correções nascem sozinhas quando eu confirmo uma revisão em que mexi em alguma
            coisa — não há nada a apertar.
          </p>
        ) : (
          <ul className="lista-sessoes">
            {comMaterial.map((a) => (
              <li key={a.id}>
                <button className="linha-agente" onClick={() => void abrirAgente(a.id)}>
                  <span className="nome">{a.rotulo}</span>
                  <span className="meta">{a.papel}</span>
                  <span className="meta">
                    {a.abertas > 0 && `${a.abertas} em aberto`}
                    {a.abertas > 0 && a.pauta > 0 && " · "}
                    {a.pauta > 0 && `${a.pauta} na pauta`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {porta.grafo > 0 && (
          // Sem botão, de propósito: `grafo` não é agente, é higiene de grafia
          // minha. Não há prompt para emendar com isso — o que conserta grafia
          // é o vocabulário do STT. Esconder faria a soma não bater.
          <p className="aguardando">
            {porta.grafo} correção(ões) de grafia do grafo, que não emendam prompt nenhum: quem
            erra nome próprio é a transcrição, e nenhuma instrução faz um agente adivinhar um nome
            que nunca chegou até ele.
          </p>
        )}
      </main>
    );
  }

  // ───────────────────────── a tela de um agente ─────────────────────────

  if (!dados) {
    return (
      <main className="leitura">
        <h1>calibração</h1>
        <p className="aguardando">…</p>
      </main>
    );
  }

  const descartes = agruparDescartes(sessoes);

  return (
    <main className="calibracao">
      <header>
        <button className="voltar" onClick={() => setEscolhido(null)}>
          ←
        </button>
        <h1>{dados.agente.rotulo}</h1>
        <p className="aguardando">
          {dados.agente.papel} · {dados.agente.versao}
          {dados.editado && " · com emenda em vigor"}
        </p>
      </header>

      <section className="regras">
        <h2>a pauta</h2>
        <p className="aguardando">
          {pauta.length === 0
            ? "nada confirmado ainda — peça os padrões e veja se eles fazem sentido"
            : `${pauta.length} padrão(ões) · nada entra no prompt antes de eu ler a emenda`}
        </p>

        {pauta.map((p, k) => (
          <div key={p.id} className={p.novo ? "regra nova" : "regra"}>
            <textarea
              value={p.texto}
              rows={2}
              aria-label={`texto do padrão ${k + 1}`}
              onChange={(e) =>
                setPauta((atual) =>
                  atual.map((x) => (x.id === p.id ? { ...x, texto: e.target.value } : x)),
                )
              }
            />
            <div className="meta-regra">
              {p.novo && <span className="proposta">proposto agora</span>}
              {p.substitui && <span>contradiz {p.substitui}</span>}
              {/* `cita` é do agente e imutável na tela: é a procedência do que
                  motivou o padrão, não coisa minha para editar. */}
              <span>a partir de {p.cita.length} correção(ões)</span>
              <button
                className="apagar-regra"
                onClick={() => setPauta((atual) => atual.filter((x) => x.id !== p.id))}
              >
                descartar
              </button>
            </div>
          </div>
        ))}

        <div className="acoes-regras">
          <button
            className="rascunhar"
            disabled={rascunhando || pauta.length >= MAX_PADROES_POR_RODADA}
            onClick={() => void pedirPadroes()}
          >
            {rascunhando ? "lendo o que eu corrigi…" : "pedir os padrões"}
          </button>
          <button
            className="aprovar"
            disabled={redigindo || pauta.length === 0}
            onClick={() => void pedirEmenda()}
          >
            {redigindo ? "escrevendo a emenda…" : "escrever a emenda"}
          </button>
        </div>

        {recado && <p className="aguardando">{recado}</p>}
      </section>

      {emenda && emenda.texto !== null && (
        <section className="emenda">
          <h2>o que muda no prompt</h2>
          <p className="aguardando">
            {emenda.edicoes.length} seção(ões) de {dados.secoes.length}. O resto volta byte a byte:
            o redator devolve emendas, não o prompt inteiro.
          </p>

          {emenda.edicoes.map((e) => {
            const antes = emenda.anterior ? corpoDaSecao(emenda.anterior, e.secao) : "";
            return (
              <div key={e.secao} className="edicao">
                <div className="cabecalho">
                  <span className="selo">{e.secao}</span>
                  <span className="acao">{ROTULO_OPERACAO[e.operacao] ?? e.operacao}</span>
                </div>

                {/* Empilhado sempre, e sem cor: corpo de seção nunca cabe numa
                    linha, e cor apontando o que mudou é a tela afirmando uma
                    leitura que eu não pedi (a mesma regra da correção). */}
                <div className="par-longo">
                  {e.operacao !== "criar" && antes !== "" && (
                    <div className="lado">
                      <span className="rotulo">o que a seção diz hoje</span>
                      <p>{antes}</p>
                    </div>
                  )}
                  <div className="lado">
                    <span className="rotulo">
                      {e.operacao === "acrescentar" ? "o que entra no fim dela" : "o que ela passa a dizer"}
                    </span>
                    <p>{e.texto}</p>
                  </div>
                </div>
              </div>
            );
          })}

          <div className="acoes-regras">
            <button className="aprovar" disabled={aprovando} onClick={() => void aprovar()}>
              {aprovando ? "gravando…" : "aprovar a emenda"}
            </button>
            <button className="apagar-regra" onClick={() => setEmenda(null)}>
              descartar
            </button>
          </div>
        </section>
      )}

      <ul className="correcoes">
        {dados.correcoes.map((c) => {
          const emLinha = cabeEmLinha(c.antes, c.depois);
          // O texto do átomo só entra quando ele **não** é o próprio `antes`:
          // numa correção de texto seria a mesma coisa duas vezes na tela.
          const contexto =
            c.texto_proposto !== "" && c.texto_proposto !== c.antes ? c.texto_proposto : "";

          return (
            <li key={c.id} className="correcao">
              <div className="cabecalho">
                <span className="acao">{ROTULO[c.tipo] ?? c.tipo}</span>
                {c.tipo_atomo && <span className="tipo-atomo">{c.tipo_atomo}</span>}
                <span className="quando">{diaMes(c.em)}</span>
              </div>

              {contexto !== "" && <p className="contexto">{contexto}</p>}

              {emLinha ? (
                <p className="par-curto">
                  <span className="antes">{c.antes === "" ? "—" : c.antes}</span>
                  <span className="seta" aria-hidden="true">
                    →
                  </span>
                  <span className="depois">{c.depois === "" ? "—" : c.depois}</span>
                </p>
              ) : (
                <div className="par-longo">
                  {c.antes !== "" && (
                    <div className="lado">
                      <span className="rotulo">o que veio</span>
                      <p>{c.antes}</p>
                    </div>
                  )}
                  {c.depois !== "" && (
                    <div className="lado">
                      <span className="rotulo">o que eu deixei</span>
                      <p>{c.depois}</p>
                    </div>
                  )}
                </div>
              )}

              <div className="rodape">
                {c.inicios_s.map((s, k) => (
                  <button key={k} className="ouvir" onClick={() => void escutar(c.sessao_id, s)}>
                    ▶ {mmss(s)}
                  </button>
                ))}
                {!c.tocado && (
                  // Trava 2 (§4.11): chave diferente sem gesto que a testemunhe.
                  // Provável travessia de alias, não edição minha — e a tela
                  // tem que dizer isso, senão eu leio como correção que fiz.
                  <span className="inferida" title="deduzida do valor, sem gesto meu na tela">
                    inferida
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {dados.correcoes.length > 0 && dados.agente.id === "extracao" && (
        <section className="refugo">
          {refugoAberto ? (
            <>
              <h2>o que o parser recusou</h2>
              {descartes.length === 0 ? (
                <p className="aguardando">nada — todo item que o modelo devolveu passou</p>
              ) : (
                <ul>
                  {descartes.map((d) => (
                    <li key={d.motivo}>
                      <span className="n">{d.n}</span> {d.motivo}
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <button className="abrir-refugo" onClick={() => void abrirRefugo()}>
              o que o parser recusou
            </button>
          )}
        </section>
      )}

      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={audio} preload="none" />
    </main>
  );
}
