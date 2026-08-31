"use client";

/**
 * Tela de entidades — a manutenção do grafo, e a única janela para dentro dele.
 *
 * Duas coisas acontecem aqui: eu vejo o que de fato entrou (até esta tela
 * existir, a resposta só saía rodando Cypher por fora), e eu conserto o que
 * entrou torto — fundo duas grafias da mesma coisa, ou dou nome a uma entidade
 * que ficou como "meu pai".
 *
 * **Não é painel da revisão**, de propósito: a revisão só enxerga as entidades
 * da sessão atual, e o orçamento dela é 60 s — "revisão longa" é uma das formas
 * de morte da visão §8. Manutenção é trabalho de outro momento, e que eu faço
 * quando quiser, ou nunca.
 *
 * Procurar duplicatas é um botão, não algo que acontece ao abrir: a camada que
 * compara nomes é de graça, mas a que julga é uma chamada de modelo.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ehPronome, normalizarNome } from "@/lib/texto";
import { TIPOS_ENTIDADE } from "@/lib/tipos";
import type { TipoEntidade } from "@/lib/tipos";

interface Entidade {
  id: string;
  nome: string;
  nome_normalizado: string;
  tipo: TipoEntidade;
  sessoes: number;
  atomos: number;
  aliases: string[];
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

  return (
    <main className="sessoes">
      <header>
        <h1>entidades</h1>
        <p className="aguardando">
          {entidades ? `${entidades.length} no grafo` : "…"} — o que já entrou, e onde se conserta
          o que entrou torto
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
        {(entidades ?? []).map((e) => (
          <li key={e.id}>
            <span className="quando">
              <span>{e.nome}</span>
              <span className="meta">
                {/* O tipo saiu daqui: agora ele é o select ao lado, editável. */}
                {e.atomos} átomo(s) · {e.sessoes} sessão(ões)
                {e.atomos === 0 && " · ainda não falada"}
                {e.aliases.length > 0 && ` · antes: ${e.aliases.join(", ")}`}
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
              </div>
            )}
          </li>
        ))}
      </ul>

      {entidades?.length === 0 && (
        <p className="aguardando">
          nada no grafo ainda — entidade nasce quando eu confirmo uma revisão.
        </p>
      )}

      <Link className="voltar" href="/">
        voltar
      </Link>
    </main>
  );
}
