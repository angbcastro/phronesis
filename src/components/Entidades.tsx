"use client";

/**
 * Tela de entidades — a manutenção do grafo, e a única janela para dentro dele.
 *
 * Três coisas acontecem aqui: eu vejo o que de fato entrou (até esta tela
 * existir, a resposta só saía rodando Cypher por fora); eu conserto o que entrou
 * torto — fundo duas grafias da mesma coisa, ou dou nome a uma entidade que
 * ficou como "meu pai"; e eu escrevo a **ficha** de cada uma.
 *
 * A ficha não é enfeite: é o que os agentes leem para decidir de quem eu estou
 * falando quando dois nomes soam igual. "Raffa" e "Rapha" chegam da transcrição
 * com uma grafia só — a grafia não diz quem é, a ficha diz.
 *
 * **Desde a 4.11 ela tem quatro partes**, e a primeira é a que os dois agentes
 * leem por padrão:
 *
 *   resumo    o retrato de identidade, teto de 500. É o que entra no dossiê do
 *             extrator e no catálogo do agente 2. Nasce vazio — e desde a 4.12
 *             é o lote quem costuma preenchê-lo
 *   grafias   `aliases`, editável à mão — é o único jeito de ensinar uma grafia
 *             **antes** de o STT errar pela primeira vez, que é quando ele mais
 *             erra
 *   canônico  "esta é a ficha oficial". Sinal nos dois prompts e desempate
 *             quando dois candidatos empatam; não trava nada
 *   perfil    os três campos da 005. Saíram do caminho comum: agora só entram
 *             na segunda passada, para os candidatos de uma menção em dúvida.
 *             `fizemos juntos` continua sendo o mais forte dos três
 *
 * **Não é painel da revisão**, de propósito: a revisão só enxerga as entidades
 * da sessão atual, e o orçamento dela é 60 s — "revisão longa" é uma das formas
 * de morte da visão §8. Manutenção é trabalho de outro momento, e que eu faço
 * quando quiser, ou nunca.
 *
 * Procurar duplicatas e rascunhar um perfil são botões, não coisas que
 * acontecem ao abrir: a camada que compara nomes é de graça, mas a que julga e a
 * que escreve são chamadas de modelo.
 *
 * **Desde a 4.12 esta tela dispara o lote, e ele grava sem eu aprovar campo a
 * campo** — checkbox por linha, "selecionar todas", e o botão que enfileira. É a
 * única coisa daqui que escreve conteúdo sem o meu toque em cada campo, e é
 * decisão declarada (`ARCHITECTURE.md` §4.9): o atrito de aprovar campo por
 * campo é o que deixou as fichas vazias. O contrapeso é que **eu leio a ficha
 * aqui mesmo, depois**, e que o desfazer está a um toque.
 *
 * O estado da fila mora **na linha de cada entidade**, e em nenhum outro lugar:
 * a fatia recusou notificação fora do app. Enquanto houver fila, a tela relê
 * sozinha; fechar a aba não interrompe nada, só para de mostrar.
 */
import { useCallback, useEffect, useState } from "react";
import { ehPronome, normalizarNome } from "@/lib/texto";
import {
  CAMPOS_PERFIL,
  ROTULO_TIPO_ENTIDADE,
  TETO_RESUMO,
  TIPOS_ENTIDADE,
} from "@/lib/tipos";
import type { CampoPerfil, Enriquecimento, Perfil, TipoEntidade } from "@/lib/tipos";

interface Entidade {
  id: string;
  nome: string;
  nome_normalizado: string;
  tipo: TipoEntidade;
  sessoes: number;
  atomos: number;
  aliases: string[];
  resumo: string;
  canonico: boolean;
  perfil: Perfil;
  enriquecimento: Enriquecimento;
}

interface Par {
  a: string;
  b: string;
  nome_a: string;
  nome_b: string;
  sessoes_a: number;
  sessoes_b: number;
  motivo: string;
  explicacao: string;
}

interface Rascunho {
  texto: string;
  atual: string;
  atomos: number;
  modelo: string;
}

/** O nome do campo como eu leio, não como o grafo guarda. */
const ROTULO: Record<CampoPerfil, string> = {
  contexto: "contexto",
  pode_ajudar_com: "pode ajudar com",
  fizemos_juntos: "fizemos juntos",
};

const DICA: Record<CampoPerfil, string> = {
  contexto:
    "quem é para mim — “colega de trabalho”, “amigo, mora comigo” — e o resto que valha eu ter em mente: momento de vida, situação, o que está acontecendo",
  pode_ajudar_com: "o que sabe, com o que já trabalhou",
  fizemos_juntos: "o que já vivemos juntos — o melhor desambiguador dos três",
};

const PERFIL_VAZIO: Perfil = { contexto: "", pode_ajudar_com: "", fizemos_juntos: "" };

/** O mesmo do corredor: rápido o bastante para parecer vivo, e barato. */
const INTERVALO_FILA_MS = 4000;

/** Só a data. A hora não muda o que eu faço, e a linha já é longa. */
const dia = (iso: string) => (iso === "" ? "" : iso.slice(0, 10).split("-").reverse().join("/"));

/**
 * O estado do lote **na própria linha** — a fatia decidiu que nenhum aviso mora
 * fora desta tela. Notificação de PWA seria o único canal que me alcança com o
 * app fechado, e seria o primeiro uso de push neste sistema: recusado por agora.
 *
 * `null` (nunca enriquecida) não vira selo nenhum: é o estado de quase todo o
 * grafo, e um selo em toda linha não informa nada.
 */
function selo(e: Enriquecimento): string {
  if (e.estado === "na_fila") return " · na fila";
  if (e.estado === "rodando") return " · enriquecendo…";
  if (e.estado === "falhou") return ` · falhou: ${e.motivo || "sem motivo registrado"}`;
  if (e.estado === "pronta") {
    return e.atomos === 0
      ? ` · sem átomo para ler${e.em === "" ? "" : ` em ${dia(e.em)}`}`
      : ` · ficha de ${e.atomos} átomo(s)${e.em === "" ? "" : ` em ${dia(e.em)}`}`;
  }
  return "";
}

export function Entidades() {
  const [entidades, setEntidades] = useState<Entidade[] | null>(null);
  const [pares, setPares] = useState<Par[] | null>(null);
  const [falha, setFalha] = useState<string | null>(null);
  const [procurando, setProcurando] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState("");
  const [nomeNovo, setNomeNovo] = useState("");
  const [tipoNovo, setTipoNovo] = useState<TipoEntidade>("Pessoa");
  const [perfilAberto, setPerfilAberto] = useState<string | null>(null);
  /** O que está no textarea, por `chave|campo`. Ausente = o que veio do grafo. */
  const [textos, setTextos] = useState<Record<string, string>>({});
  /** O que o agente 3 propôs, por `chave|campo`. Nunca entra por cima do atual. */
  const [propostas, setPropostas] = useState<Record<string, Rascunho>>({});
  /** A grafia que estou digitando para acrescentar, por chave de entidade. */
  const [grafiaNova, setGrafiaNova] = useState<Record<string, string>>({});
  /** As chaves marcadas para o lote. Vazio = nada a enriquecer. */
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());

  const carregar = useCallback(async () => {
    // `?perfil=1`: esta é a tela que edita os três campos. A revisão não pede,
    // e por isso não baixa o campo mais pesado da resposta (4.8.1).
    const r = await fetch("/api/entidades?perfil=1", { cache: "no-store" }).catch(() => null);
    if (!r?.ok) {
      setFalha("não deu para ler o grafo");
      return;
    }
    setEntidades(((await r.json()) as { entidades: Entidade[] }).entidades);
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  /**
   * Enquanto houver fila, a tela relê sozinha.
   *
   * **É o único aviso que esta fatia dá**, e é por decisão: notificação de PWA
   * seria o primeiro uso de push neste sistema, e a informação mora onde a ação
   * foi disparada. Fechar a aba não interrompe a fila — só para de mostrar o
   * que ela está fazendo, e voltar aqui reencontra o estado no grafo.
   *
   * O intervalo é o do corredor (`Processando`), e o efeito se desliga sozinho
   * quando a última linha sai de `na fila` ou `enriquecendo`.
   */
  const andando = (entidades ?? []).some(
    (e) => e.enriquecimento.estado === "na_fila" || e.enriquecimento.estado === "rodando",
  );

  useEffect(() => {
    if (!andando) return;
    const t = setInterval(() => void carregar(), INTERVALO_FILA_MS);
    return () => clearInterval(t);
  }, [andando, carregar]);

  async function procurar() {
    setProcurando(true);
    setFalha(null);
    const r = await fetch("/api/entidades/duplicatas", { method: "POST" }).catch(() => null);
    setProcurando(false);
    if (!r?.ok) {
      setFalha(r ? ((await r.json()) as { erro?: string }).erro ?? "falhou" : "sem resposta");
      return;
    }
    setPares(((await r.json()) as { pares: Par[] }).pares);
  }

  /** Fundir é irreversível: a perdedora vira alias e não há como desfazer. */
  async function fundir(vencedora: string, perdedora: string) {
    setOcupado(`${vencedora}|${perdedora}`);
    setFalha(null);
    const r = await fetch("/api/entidades/fundir", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vencedora, perdedora }),
    }).catch(() => null);
    setOcupado(null);
    if (!r?.ok) {
      setFalha(r ? ((await r.json()) as { erro?: string }).erro ?? "falhou" : "sem resposta");
      return;
    }
    setPares((ps) => (ps ?? []).filter((p) => !(p.a === perdedora || p.b === perdedora)));
    void carregar();
  }

  async function saoDistintas(par: Par) {
    setOcupado(`${par.a}|${par.b}`);
    await fetch("/api/entidades/distintas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ a: par.a, b: par.b }),
    }).catch(() => null);
    setOcupado(null);
    setPares((ps) => (ps ?? []).filter((p) => !(p.a === par.a && p.b === par.b)));
  }

  /**
   * O tipo não era editável depois da primeira revisão — a entidade vira
   * `conhecida` e a revisão a mostra fixa. Aqui é onde o label errado tem
   * conserto.
   */
  async function trocarTipo(chave: string, tipo: TipoEntidade) {
    setOcupado(chave);
    setFalha(null);
    const r = await fetch("/api/entidades/tipo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chave, tipo }),
    }).catch(() => null);
    setOcupado(null);
    if (!r?.ok) {
      setFalha(r ? ((await r.json()) as { erro?: string }).erro ?? "falhou" : "sem resposta");
      return;
    }
    void carregar();
  }

  /** Semear: o nome entra no vocabulário do STT antes da primeira menção. */
  async function criar() {
    const nome = nomeNovo.trim();
    if (nome === "") return;
    setOcupado("criar");
    setFalha(null);
    const r = await fetch("/api/entidades/criar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nome, tipo: tipoNovo }),
    }).catch(() => null);
    setOcupado(null);
    if (!r?.ok) {
      setFalha(r ? ((await r.json()) as { erro?: string }).erro ?? "falhou" : "sem resposta");
      return;
    }
    setNomeNovo("");
    void carregar();
  }

  async function salvarNome(chave: string) {
    const nome = rascunho.trim();
    if (nome === "" || ehPronome(normalizarNome(nome))) return;
    setOcupado(chave);
    setFalha(null);
    const r = await fetch("/api/entidades/renomear", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chave, nome }),
    }).catch(() => null);
    setOcupado(null);
    if (!r?.ok) {
      setFalha(r ? ((await r.json()) as { erro?: string }).erro ?? "falhou" : "sem resposta");
      return;
    }
    setEditando(null);
    void carregar();
  }

  /** Grava um dos três campos. É o único caminho de escrita do perfil. */
  async function salvarPerfil(chave: string, campo: CampoPerfil, texto: string) {
    const id = `${chave}|${campo}`;
    setOcupado(id);
    setFalha(null);
    const r = await fetch("/api/entidades/perfil", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chave, campo, texto }),
    }).catch(() => null);
    setOcupado(null);
    if (!r?.ok) {
      setFalha(r ? ((await r.json()) as { erro?: string }).erro ?? "falhou" : "sem resposta");
      return;
    }
    setPropostas((p) => {
      const { [id]: _fora, ...resto } = p;
      return resto;
    });
    setTextos((t) => {
      const { [id]: _fora, ...resto } = t;
      return resto;
    });
    void carregar();
  }

  /**
   * O retrato de identidade. É o campo que os dois agentes leem por padrão
   * desde a 4.11 — escrito errado, ele contamina toda atribuição futura.
   */
  async function salvarResumo(chave: string, texto: string) {
    const id = `${chave}|resumo`;
    setOcupado(id);
    setFalha(null);
    const r = await fetch("/api/entidades/resumo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chave, texto }),
    }).catch(() => null);
    setOcupado(null);
    if (!r?.ok) {
      setFalha(r ? ((await r.json()) as { erro?: string }).erro ?? "falhou" : "sem resposta");
      return;
    }
    setTextos((t) => {
      const { [id]: _fora, ...resto } = t;
      return resto;
    });
    void carregar();
  }

  /**
   * Acrescentar ou tirar uma grafia. Um item por chamada: a lista na tela é a
   * união de duas fontes (a propriedade e os nós de fusão real), e mandar a
   * lista inteira de volta gravaria uma na outra.
   */
  async function mexerNaGrafia(chave: string, grafia: string, acao: "acrescentar" | "remover") {
    const id = `${chave}|grafia|${grafia}`;
    setOcupado(id);
    setFalha(null);
    const r = await fetch("/api/entidades/aliases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chave, grafia, acao }),
    }).catch(() => null);
    setOcupado(null);
    if (!r?.ok) {
      setFalha(r ? ((await r.json()) as { erro?: string }).erro ?? "falhou" : "sem resposta");
      return;
    }
    if (acao === "acrescentar") setGrafiaNova((g) => ({ ...g, [chave]: "" }));
    void carregar();
  }

  /** A ficha oficial. Um toque, reversível, sem consequência retroativa. */
  async function alternarCanonico(chave: string, canonico: boolean) {
    setOcupado(`${chave}|canonico`);
    setFalha(null);
    const r = await fetch("/api/entidades/canonico", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chave, canonico }),
    }).catch(() => null);
    setOcupado(null);
    if (!r?.ok) {
      setFalha(r ? ((await r.json()) as { erro?: string }).erro ?? "falhou" : "sem resposta");
      return;
    }
    void carregar();
  }

  /**
   * O agente 4 escreve a ficha inteira — e **grava**, sem eu ver antes.
   *
   * É a única coisa desta tela que escreve conteúdo sem o meu toque campo a
   * campo, e é decisão declarada da 4.12: o atrito de aprovar campo por campo é
   * o que deixou as fichas vazias. O contrapeso é o desfazer, logo abaixo.
   */
  async function enriquecerUma(chave: string) {
    const id = `${chave}|enriquecer`;
    setOcupado(id);
    setFalha(null);
    const r = await fetch("/api/entidades/enriquecer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chave }),
    }).catch(() => null);
    setOcupado(null);
    if (!r?.ok) {
      setFalha(r ? ((await r.json()) as { erro?: string }).erro ?? "falhou" : "sem resposta");
    }
    // Recarrega nos dois casos: quando falha, é a linha da entidade que passa a
    // mostrar o motivo, e é isso que a fatia prometeu.
    void carregar();
  }

  /** Os quatro campos voltam de uma vez. Um toque — ele restaura, não destrói. */
  async function desfazer(chave: string) {
    const id = `${chave}|desfazer`;
    setOcupado(id);
    setFalha(null);
    const r = await fetch("/api/entidades/desfazer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chave }),
    }).catch(() => null);
    setOcupado(null);
    if (!r?.ok) {
      setFalha(r ? ((await r.json()) as { erro?: string }).erro ?? "falhou" : "sem resposta");
      return;
    }
    // O textarea local tem de sair da frente: o que ele mostra é o texto de
    // antes do desfazer, e ele venceria o que veio do grafo.
    setTextos({});
    void carregar();
  }

  /**
   * O lote: as marcadas entram na fila, e a fila anda sozinha.
   *
   * A resposta volta na hora — o que ela confirma é que o `na_fila` está
   * gravado, não que o trabalho acabou. Daí em diante quem conta a história é o
   * selo de cada linha.
   */
  async function enriquecerMarcadas() {
    if (marcadas.size === 0) return;
    setOcupado("lote");
    setFalha(null);
    const r = await fetch("/api/entidades/enriquecer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chaves: [...marcadas] }),
    }).catch(() => null);
    setOcupado(null);
    if (!r?.ok) {
      setFalha(r ? ((await r.json()) as { erro?: string }).erro ?? "falhou" : "sem resposta");
      return;
    }
    // A seleção sai do caminho: o que interessa a partir daqui é o selo de cada
    // linha, e uma lista marcada por cima disso só atrapalharia a leitura.
    setMarcadas(new Set());
    void carregar();
  }

  /** O agente 3 propõe; nada é gravado até eu apertar salvar. */
  async function pedirRascunho(chave: string, campo: CampoPerfil) {
    const id = `${chave}|${campo}`;
    setOcupado(id);
    setFalha(null);
    const r = await fetch("/api/entidades/perfil/rascunho", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chave, campo }),
    }).catch(() => null);
    setOcupado(null);
    if (!r?.ok) {
      setFalha(r ? ((await r.json()) as { erro?: string }).erro ?? "falhou" : "sem resposta");
      return;
    }
    const proposto = (await r.json()) as Rascunho;
    setPropostas((p) => ({ ...p, [id]: proposto }));
  }

  return (
    <main className="sessoes">
      <header>
        <h1>entidades</h1>
        <p className="aguardando">
          {entidades ? `${entidades.length} no grafo` : "…"} — o que já entrou, onde se conserta
          o que entrou torto, e o perfil que diz de quem eu estou falando
        </p>
      </header>

      {falha && <p className="aviso">{falha}</p>}

      <div className="acoes-sessao criar-entidade">
        <input
          className="campo-nome"
          placeholder="nome que eu ainda vou falar"
          value={nomeNovo}
          onChange={(ev) => setNomeNovo(ev.target.value)}
          onKeyDown={(ev) => ev.key === "Enter" && void criar()}
        />
        <select
          className="campo-nome"
          value={tipoNovo}
          onChange={(ev) => setTipoNovo(ev.target.value as TipoEntidade)}
        >
          {TIPOS_ENTIDADE.map((t) => (
            <option key={t} value={t}>
              {ROTULO_TIPO_ENTIDADE[t]}
            </option>
          ))}
        </select>
        <button
          className="reextrair"
          disabled={ocupado === "criar" || nomeNovo.trim() === ""}
          onClick={() => void criar()}
        >
          criar
        </button>
        <button className="reextrair" onClick={() => void procurar()} disabled={procurando}>
          {procurando ? "olhando…" : "procurar duplicatas"}
        </button>
      </div>

      {/* O lote. Mesmo padrão do "procurar duplicatas" — eu escolho quando pagar
          e sobre quem —, e a contagem aparece ANTES de disparar, porque é a
          única coisa que a tela sabe dizer sobre o tamanho da conta (§14). */}
      <div className="acoes-sessao criar-entidade">
        <label className="marca-todas">
          <input
            type="checkbox"
            checked={marcadas.size > 0 && marcadas.size === (entidades ?? []).length}
            // Meio marcado quando é parte: sem isso, marcar duas de dez faria a
            // caixa do topo parecer "nenhuma".
            ref={(el) => {
              if (el) el.indeterminate = marcadas.size > 0 && marcadas.size < (entidades ?? []).length;
            }}
            onChange={(ev) =>
              setMarcadas(
                ev.target.checked
                  ? new Set((entidades ?? []).map((e) => e.nome_normalizado))
                  : new Set(),
              )
            }
          />
          <span>selecionar todas</span>
        </label>
        <button
          className="reextrair"
          disabled={ocupado === "lote" || marcadas.size === 0}
          title="o agente lê TODOS os átomos de cada uma e escreve a ficha inteira — e grava, sem eu aprovar campo a campo"
          onClick={() => void enriquecerMarcadas()}
        >
          {ocupado === "lote"
            ? "enfileirando…"
            : `enriquecer ${marcadas.size === 0 ? "" : `${marcadas.size} `}marcada(s)`}
        </button>
        {andando && (
          <span className="meta">a fila está andando — pode fechar a aba</span>
        )}
      </div>

      {pares?.length === 0 && (
        <p className="aguardando">nenhuma duplicata — o grafo está limpo.</p>
      )}

      {(pares ?? []).map((p) => {
        const chave = `${p.a}|${p.b}`;
        return (
          <div className="par" key={chave}>
            <p>
              <strong>{p.nome_a}</strong> e <strong>{p.nome_b}</strong> são a mesma coisa?
            </p>
            <p className="aguardando">
              {p.explicacao || p.motivo} · {p.sessoes_a} e {p.sessoes_b} sessão(ões)
            </p>
            <div className="acoes-sessao">
              {/* Qual sobrevive é escolha minha: o nome do vencedor vira o nome
                  de exibição e vai para o vocabulário do STT. */}
              <button
                className="reextrair"
                disabled={ocupado === chave}
                onClick={() => void fundir(p.a, p.b)}
              >
                manter {p.nome_a}
              </button>
              <button
                className="reextrair"
                disabled={ocupado === chave}
                onClick={() => void fundir(p.b, p.a)}
              >
                manter {p.nome_b}
              </button>
              <button
                className="reextrair"
                disabled={ocupado === chave}
                onClick={() => void saoDistintas(p)}
              >
                são diferentes
              </button>
            </div>
          </div>
        );
      })}

      <ul className="lista-sessoes">
        {(entidades ?? []).map((e) => {
          const perfil = e.perfil ?? PERFIL_VAZIO;
          const escritos = CAMPOS_PERFIL.filter((c) => perfil[c] !== "").length;
          const aberto = perfilAberto === e.nome_normalizado;

          return (
            <li key={e.id} className={aberto ? "com-perfil aberta" : "com-perfil"}>
              <div className="linha-entidade">
                <input
                  type="checkbox"
                  className="marca-lote"
                  aria-label={`marcar ${e.nome} para enriquecer`}
                  checked={marcadas.has(e.nome_normalizado)}
                  onChange={(ev) =>
                    setMarcadas((m) => {
                      const proximo = new Set(m);
                      if (ev.target.checked) proximo.add(e.nome_normalizado);
                      else proximo.delete(e.nome_normalizado);
                      return proximo;
                    })
                  }
                />
                <span className="quando">
                  <span>
                    {e.nome}
                    {/* A ficha oficial se vê na linha, sem abrir nada — é o que
                        "destacar" quer dizer aqui. */}
                    {e.canonico && (
                      <span className="canonica" title="ficha oficial desta entidade">
                        ★
                      </span>
                    )}
                  </span>
                  <span className="meta">
                    {/* O tipo saiu daqui: agora ele é o select ao lado, editável. */}
                    {e.atomos} átomo(s) · {e.sessoes} sessão(ões)
                    {e.atomos === 0 && " · ainda não falada"}
                    {e.aliases.length > 0 && ` · também: ${e.aliases.join(", ")}`}
                    {e.resumo === "" ? " · sem resumo" : " · com resumo"}
                    {escritos > 0 && ` · perfil ${escritos}/3`}
                    {selo(e.enriquecimento)}
                  </span>
                </span>

                {editando === e.nome_normalizado ? (
                  <span className="acoes-sessao">
                    <input
                      className="campo-nome"
                      value={rascunho}
                      autoFocus
                      onChange={(ev) => setRascunho(ev.target.value)}
                      onKeyDown={(ev) => {
                        if (ev.key === "Enter") void salvarNome(e.nome_normalizado);
                        if (ev.key === "Escape") setEditando(null);
                      }}
                    />
                    <button
                      className="reextrair"
                      disabled={ocupado === e.nome_normalizado}
                      onClick={() => void salvarNome(e.nome_normalizado)}
                    >
                      salvar
                    </button>
                  </span>
                ) : (
                  <div className="acoes-sessao">
                    <select
                      className="campo-nome tipo"
                      value={e.tipo}
                      disabled={ocupado === e.nome_normalizado}
                      aria-label={`tipo de ${e.nome}`}
                      onChange={(ev) =>
                        void trocarTipo(e.nome_normalizado, ev.target.value as TipoEntidade)
                      }
                    >
                      {TIPOS_ENTIDADE.map((t) => (
                        <option key={t} value={t}>
                          {ROTULO_TIPO_ENTIDADE[t]}
                        </option>
                      ))}
                    </select>
                    <button
                      className="reextrair"
                      onClick={() => {
                        setEditando(e.nome_normalizado);
                        setRascunho(e.nome);
                      }}
                    >
                      renomear
                    </button>
                    <button
                      className={e.canonico ? "reextrair canonico" : "reextrair"}
                      disabled={ocupado === `${e.nome_normalizado}|canonico`}
                      aria-pressed={e.canonico}
                      title="marcar esta como a ficha oficial desta entidade"
                      onClick={() => void alternarCanonico(e.nome_normalizado, !e.canonico)}
                    >
                      {e.canonico ? "★ canônica" : "☆ canônica"}
                    </button>
                    <button
                      className="reextrair"
                      aria-expanded={aberto}
                      onClick={() => setPerfilAberto(aberto ? null : e.nome_normalizado)}
                    >
                      {aberto ? "fechar ficha" : "ficha"}
                    </button>
                  </div>
                )}
              </div>

              {aberto && (
                <div className="perfil">
                  <p className="aguardando">
                    é isto que o agente lê para saber de quem eu estou falando quando dois nomes
                    soam igual
                  </p>

                  {/* O lote, e o que o desfaz. Ficam no topo da ficha porque
                      escrevem os quatro campos abaixo de uma vez só — e porque
                      o desfazer tem de estar à vista de quem acabou de ver a
                      ficha mudar sem ter aprovado nada. */}
                  <div className="acoes-sessao lote">
                    <button
                      className="reextrair"
                      disabled={ocupado === `${e.nome_normalizado}|enriquecer`}
                      title="o agente lê TODOS os átomos que falam dela e escreve a ficha inteira — e grava, sem eu aprovar campo a campo"
                      onClick={() => void enriquecerUma(e.nome_normalizado)}
                    >
                      {ocupado === `${e.nome_normalizado}|enriquecer`
                        ? "escrevendo…"
                        : "enriquecer esta"}
                    </button>
                    {e.enriquecimento.tem_anterior && (
                      <button
                        className="reextrair"
                        disabled={ocupado === `${e.nome_normalizado}|desfazer`}
                        title="volta os quatro campos para a geração anterior — outro toque traz de volta"
                        onClick={() => void desfazer(e.nome_normalizado)}
                      >
                        {ocupado === `${e.nome_normalizado}|desfazer` ? "voltando…" : "desfazer"}
                      </button>
                    )}
                  </div>

                  {/* O resumo vem primeiro porque é o que os dois agentes leem
                      por padrão. Os três campos abaixo dele só entram na segunda
                      passada, quando a primeira leitura não resolveu. */}
                  {(() => {
                    const id = `${e.nome_normalizado}|resumo`;
                    const valor = textos[id] ?? e.resumo;
                    const mexido = valor !== e.resumo;

                    return (
                      <div className="campo-perfil" key="resumo">
                        <label htmlFor={id}>
                          resumo{" "}
                          <span className="meta">
                            quem é, e sobretudo o que a distingue de outra parecida — é isto que
                            vai no prompt dos dois agentes
                          </span>
                        </label>
                        <textarea
                          id={id}
                          rows={3}
                          maxLength={TETO_RESUMO}
                          value={valor}
                          placeholder="—"
                          onChange={(ev) => setTextos((t) => ({ ...t, [id]: ev.target.value }))}
                        />
                        <div className="acoes-sessao">
                          <span className="meta">
                            {valor.length}/{TETO_RESUMO}
                          </span>
                          <button
                            className="reextrair"
                            disabled={ocupado === id || !mexido}
                            onClick={() => void salvarResumo(e.nome_normalizado, valor)}
                          >
                            salvar
                          </button>
                        </div>
                      </div>
                    );
                  })()}

                  {/* As grafias. Acrescentar à mão é o único jeito de ensinar
                      uma antes de o STT errar pela primeira vez. */}
                  <div className="campo-perfil grafias">
                    <label htmlFor={`grafia-${e.nome_normalizado}`}>
                      grafias{" "}
                      <span className="meta">
                        como esta entidade já foi falada ou escrita — o que o STT costuma errar
                      </span>
                    </label>
                    {e.aliases.length > 0 && (
                      <ul className="lista-grafias">
                        {e.aliases.map((a) => (
                          <li key={a}>
                            <span>{a}</span>
                            <button
                              type="button"
                              className="fraco"
                              aria-label={`tirar a grafia ${a}`}
                              disabled={ocupado === `${e.nome_normalizado}|grafia|${a}`}
                              onClick={() =>
                                void mexerNaGrafia(e.nome_normalizado, a, "remover")
                              }
                            >
                              ×
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="acoes-sessao">
                      <input
                        id={`grafia-${e.nome_normalizado}`}
                        className="campo-nome"
                        placeholder="grafia que o STT ainda vai errar"
                        value={grafiaNova[e.nome_normalizado] ?? ""}
                        onChange={(ev) =>
                          setGrafiaNova((g) => ({
                            ...g,
                            [e.nome_normalizado]: ev.target.value,
                          }))
                        }
                        onKeyDown={(ev) => {
                          if (ev.key !== "Enter") return;
                          const g = (grafiaNova[e.nome_normalizado] ?? "").trim();
                          if (g !== "") {
                            void mexerNaGrafia(e.nome_normalizado, g, "acrescentar");
                          }
                        }}
                      />
                      <button
                        className="reextrair"
                        disabled={(grafiaNova[e.nome_normalizado] ?? "").trim() === ""}
                        onClick={() =>
                          void mexerNaGrafia(
                            e.nome_normalizado,
                            (grafiaNova[e.nome_normalizado] ?? "").trim(),
                            "acrescentar",
                          )
                        }
                      >
                        acrescentar
                      </button>
                    </div>
                  </div>

                  {CAMPOS_PERFIL.map((campo) => {
                    const id = `${e.nome_normalizado}|${campo}`;
                    const valor = textos[id] ?? perfil[campo];
                    const proposta = propostas[id];
                    const mexido = valor !== perfil[campo];

                    return (
                      <div className="campo-perfil" key={campo}>
                        <label htmlFor={id}>
                          {ROTULO[campo]} <span className="meta">{DICA[campo]}</span>
                        </label>
                        {/* Sem `maxLength` e sem contador desde a 4.11: o teto
                            de 300 existia porque estes três campos entravam no
                            prompt do agente 2 em toda chamada, e isso acabou. */}
                        <textarea
                          id={id}
                          rows={2}
                          value={valor}
                          placeholder="—"
                          onChange={(ev) =>
                            setTextos((t) => ({ ...t, [id]: ev.target.value }))
                          }
                        />
                        <div className="acoes-sessao">
                          <button
                            className="reextrair"
                            disabled={ocupado === id || !mexido}
                            onClick={() => void salvarPerfil(e.nome_normalizado, campo, valor)}
                          >
                            salvar
                          </button>
                          <button
                            className="reextrair"
                            disabled={ocupado === id}
                            title="o agente propõe a partir dos átomos que marcaram este campo; nada é gravado"
                            onClick={() => void pedirRascunho(e.nome_normalizado, campo)}
                          >
                            {ocupado === id ? "pensando…" : "rascunhar"}
                          </button>
                        </div>

                        {proposta && (
                          // Ao lado, nunca por cima: o texto atual é meu, e o
                          // agente 3 é quem mais pode contaminar a resolução.
                          <div className="proposta-perfil">
                            <p className="meta">
                              proposto de {proposta.atomos} átomo(s) marcado(s) · {proposta.modelo}
                            </p>
                            <p>{proposta.texto}</p>
                            <div className="acoes-sessao">
                              <button
                                className="reextrair"
                                onClick={() =>
                                  setTextos((t) => ({ ...t, [id]: proposta.texto }))
                                }
                              >
                                usar este texto
                              </button>
                              <button
                                className="reextrair"
                                onClick={() =>
                                  setPropostas((p) => {
                                    const { [id]: _fora, ...resto } = p;
                                    return resto;
                                  })
                                }
                              >
                                descartar
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {entidades?.length === 0 && (
        <p className="aguardando">
          nada no grafo ainda — entidade nasce quando eu confirmo uma revisão.
        </p>
      )}

    </main>
  );
}
