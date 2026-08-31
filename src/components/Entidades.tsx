"use client";

/**
 * Tela de entidades — a manutenção do grafo, e a única janela para dentro dele.
 *
 * Três coisas acontecem aqui: eu vejo o que de fato entrou (até esta tela
 * existir, a resposta só saía rodando Cypher por fora); eu conserto o que entrou
 * torto — fundo duas grafias da mesma coisa, ou dou nome a uma entidade que
 * ficou como "meu pai"; e eu escrevo o **perfil** de cada uma (slice 4).
 *
 * O perfil não é enfeite: são os três campos que o agente de resolução lê para
 * decidir de quem eu estou falando quando dois nomes soam igual. "Raffa" e
 * "Rapha" chegam da transcrição com uma grafia só — a grafia não diz quem é, o
 * perfil diz. `fizemos juntos` costuma ser o mais forte dos três, porque
 * atividade compartilhada é o que aparece na transcrição.
 *
 * **Não é painel da revisão**, de propósito: a revisão só enxerga as entidades
 * da sessão atual, e o orçamento dela é 60 s — "revisão longa" é uma das formas
 * de morte da visão §8. Manutenção é trabalho de outro momento, e que eu faço
 * quando quiser, ou nunca.
 *
 * Procurar duplicatas e rascunhar um perfil são botões, não coisas que
 * acontecem ao abrir: a camada que compara nomes é de graça, mas a que julga e a
 * que escreve são chamadas de modelo.
 */
import { useCallback, useEffect, useState } from "react";
import { ehPronome, normalizarNome } from "@/lib/texto";
import { CAMPOS_PERFIL, TETO_PERFIL, TIPOS_ENTIDADE } from "@/lib/tipos";
import type { CampoPerfil, Perfil, TipoEntidade } from "@/lib/tipos";

interface Entidade {
  id: string;
  nome: string;
  nome_normalizado: string;
  tipo: TipoEntidade;
  sessoes: number;
  atomos: number;
  aliases: string[];
  perfil: Perfil;
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

  const carregar = useCallback(async () => {
    const r = await fetch("/api/entidades", { cache: "no-store" }).catch(() => null);
    if (!r?.ok) {
      setFalha("não deu para ler o grafo");
      return;
    }
    setEntidades(((await r.json()) as { entidades: Entidade[] }).entidades);
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

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
              {t.toLowerCase()}
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
                <span className="quando">
                  <span>{e.nome}</span>
                  <span className="meta">
                    {/* O tipo saiu daqui: agora ele é o select ao lado, editável. */}
                    {e.atomos} átomo(s) · {e.sessoes} sessão(ões)
                    {e.atomos === 0 && " · ainda não falada"}
                    {e.aliases.length > 0 && ` · antes: ${e.aliases.join(", ")}`}
                    {escritos > 0 && ` · perfil ${escritos}/3`}
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
                          {t.toLowerCase()}
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
                      className="reextrair"
                      aria-expanded={aberto}
                      onClick={() => setPerfilAberto(aberto ? null : e.nome_normalizado)}
                    >
                      {aberto ? "fechar perfil" : "perfil"}
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
                        <textarea
                          id={id}
                          rows={2}
                          maxLength={TETO_PERFIL}
                          value={valor}
                          placeholder="—"
                          onChange={(ev) =>
                            setTextos((t) => ({ ...t, [id]: ev.target.value }))
                          }
                        />
                        <div className="acoes-sessao">
                          <span className="meta">
                            {valor.length}/{TETO_PERFIL}
                          </span>
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
