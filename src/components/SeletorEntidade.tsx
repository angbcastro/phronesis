"use client";

/**
 * A barra de entidade da revisão: uma lista pesquisável sobre o grafo inteiro.
 *
 * Era um `<input list>` com `<datalist>`, escolhido na slice 4 por não custar
 * biblioteca nenhuma. Ele não sustenta o que a revisão precisa hoje: não busca
 * por trecho no meio da palavra em todo navegador, não mostra tipo nem apelido,
 * não atravessa alias — e no celular, que é onde este app vive, degrada para uma
 * tirinha de sugestão que às vezes nem aparece. Este é o mesmo desenho, escrito
 * à mão: foco abre a lista, apagar tudo mostra o grafo inteiro, digitar filtra.
 *
 * **Continua aceitando nome que não existe.** O campo é de texto livre; a lista
 * é ajuda, não trava. O que decide entre reusar um nó e criar outro é o
 * casamento exato de `catalogo.resolver`, na hora de montar o payload — a linha
 * `+ criar "X"` existe só para eu ver de que lado eu estou antes de confirmar.
 *
 * Não há biblioteca de UI neste projeto (seis dependências no total), e não é
 * este componente que vai introduzir uma.
 */
import { useId, useMemo, useState } from "react";
import { apelidoQueCasa, buscar, resolver } from "@/lib/catalogo";
import { normalizarNome } from "@/lib/texto";
import type { Catalogo, EntidadeDoCatalogo } from "@/lib/catalogo";
import { ROTULO_TIPO_ENTIDADE } from "@/lib/tipos";
import type { TipoEntidade } from "@/lib/tipos";

interface Props {
  valor: string;
  aoMudar: (nome: string) => void;
  catalogo: Catalogo;
  /** Rótulo acessível — todo controle sem rótulo visível tem um. */
  rotulo: string;
  filtro?: TipoEntidade | "todas";
  /** As alternativas do agente de resolução: vão para o topo da lista. */
  sugestoes?: string[];
  placeholder?: string;
  /** Quando presente, a barra ganha um `✕`. Só as menções passam isto. */
  aoRemover?: () => void;
  /** Marca de erro — a entidade ainda é um pronome. */
  pedindo?: boolean;
}

/** Quantas linhas a lista mostra. Rolar é pior que filtrar mais um pouco. */
const TETO = 12;

export function SeletorEntidade({
  valor,
  aoMudar,
  catalogo,
  rotulo,
  filtro = "todas",
  sugestoes = [],
  placeholder,
  aoRemover,
  pedindo,
}: Props) {
  const [aberto, setAberto] = useState(false);
  const [termo, setTermo] = useState<string | null>(null);
  const [destacado, setDestacado] = useState(0);
  const idLista = useId();

  // `termo` só existe enquanto eu estou digitando. Fechado, o campo mostra o
  // valor escolhido; aberto sem ter digitado nada, a lista mostra o grafo
  // inteiro em vez de filtrar pelo nome que já está lá — é o "apago tudo e
  // começo a digitar" sem eu precisar apagar.
  const busca = termo ?? "";

  const opcoes = useMemo(() => {
    const achadas = buscar(catalogo, busca, filtro);
    // As alternativas do agente primeiro, na ordem em que ele as deu, e sem
    // repetir a linha lá embaixo. Elas são a resposta certa mais vezes que
    // qualquer ordenação genérica.
    const alvo = normalizarNome(busca);
    const primeiro = sugestoes
      .map((s) => resolver(catalogo, s) ?? fantasma(s))
      // Sugestão que ainda não é nó do grafo não aparece em `achadas` — ela
      // nasceria no confirmar —, então o casamento dela é contra o termo.
      .filter(
        (e) =>
          alvo === "" ||
          achadas.some((a) => a.nome_normalizado === e.nome_normalizado) ||
          e.nome_normalizado.includes(alvo),
      );
    const chaves = new Set(primeiro.map((e) => e.nome_normalizado));
    return [...primeiro, ...achadas.filter((e) => !chaves.has(e.nome_normalizado))].slice(0, TETO);
  }, [catalogo, busca, filtro, sugestoes]);

  // Só oferece criar quando o que está escrito não é uma entidade que existe.
  const escrito = termo ?? valor;
  const criando = normalizarNome(escrito) !== "" && resolver(catalogo, escrito) === null;
  const linhas = criando ? opcoes.length + 1 : opcoes.length;

  function escolher(indice: number) {
    const e = opcoes[indice];
    aoMudar(e ? e.nome : escrito);
    fechar();
  }

  function fechar() {
    setAberto(false);
    setTermo(null);
    setDestacado(0);
  }

  function teclado(ev: React.KeyboardEvent<HTMLInputElement>) {
    if (ev.key === "Escape") {
      fechar();
      return;
    }
    if (ev.key === "Tab") {
      setAberto(false);
      return;
    }
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      if (!aberto) {
        setAberto(true);
        return;
      }
      if (linhas === 0) return;
      const passo = ev.key === "ArrowDown" ? 1 : -1;
      setDestacado((d) => (d + passo + linhas) % linhas);
      return;
    }
    if (ev.key === "Enter" && aberto) {
      ev.preventDefault();
      escolher(destacado);
    }
  }

  return (
    <div className={`seletor${pedindo ? " pedindo" : ""}`}>
      <input
        role="combobox"
        aria-expanded={aberto}
        aria-controls={idLista}
        aria-autocomplete="list"
        aria-activedescendant={aberto && linhas > 0 ? `${idLista}-${destacado}` : undefined}
        aria-label={rotulo}
        placeholder={placeholder}
        value={termo ?? valor}
        onFocus={() => setAberto(true)}
        onClick={() => setAberto(true)}
        onBlur={fechar}
        onKeyDown={teclado}
        onChange={(ev) => {
          setTermo(ev.target.value);
          setDestacado(0);
          setAberto(true);
          aoMudar(ev.target.value);
        }}
      />

      {aoRemover && (
        <button
          type="button"
          className="remover"
          aria-label={`tirar ${valor || "esta menção"}`}
          // `onMouseDown` e não `onClick`: o `blur` do campo dispara primeiro e
          // levaria o botão embora antes do clique chegar nele.
          onMouseDown={(ev) => {
            ev.preventDefault();
            aoRemover();
          }}
        >
          ✕
        </button>
      )}

      {aberto && linhas > 0 && (
        <ul className="opcoes" id={idLista} role="listbox" aria-label={rotulo}>
          {opcoes.map((e, k) => {
            const apelido = apelidoQueCasa(e, busca);
            return (
              <li
                key={e.nome_normalizado}
                id={`${idLista}-${k}`}
                role="option"
                aria-selected={k === destacado}
                className="opcao"
                onMouseEnter={() => setDestacado(k)}
                // Sem o `preventDefault`, o `blur` fecha a lista antes de o
                // clique chegar e a escolha se perde.
                onMouseDown={(ev) => {
                  ev.preventDefault();
                  escolher(k);
                }}
              >
                <span className="nome">
                  {e.nome}
                  {apelido && <em> ({apelido})</em>}
                </span>
                <span className="meta">
                  {ROTULO_TIPO_ENTIDADE[e.tipo]}
                  {e.sessoes > 0 && ` · ${e.sessoes} ${e.sessoes === 1 ? "sessão" : "sessões"}`}
                </span>
              </li>
            );
          })}

          {criando && (
            <li
              id={`${idLista}-${opcoes.length}`}
              role="option"
              aria-selected={opcoes.length === destacado}
              className="opcao criar"
              onMouseEnter={() => setDestacado(opcoes.length)}
              onMouseDown={(ev) => {
                ev.preventDefault();
                escolher(opcoes.length);
              }}
            >
              + criar “{escrito}”
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/**
 * Uma alternativa que o agente ofereceu e que ainda não está no grafo — ela
 * nasceria no confirmar. Aparece na lista como qualquer outra; o que a
 * distingue é não ter sessão nenhuma atrás dela.
 */
const fantasma = (nome: string): EntidadeDoCatalogo => ({
  nome,
  nome_normalizado: normalizarNome(nome),
  chaves: [normalizarNome(nome)],
  tipo: "Pessoa",
  sessoes: 0,
  aliases: [],
});
