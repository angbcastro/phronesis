"use client";

/**
 * A engrenagem, e o menu lateral atrás dela.
 *
 * A tela de gravar é "um botão, um timer, um jeito de parar — idealmente nada
 * mais" (`Specs/visao.md` §6). Ela tinha três controles competindo com o
 * círculo: o link de subir um áudio logo abaixo dele, e as portas "sessões ·
 * entidades" no rodapé. Três coisas para ler antes de falar.
 *
 * Os três viraram um. A engrenagem fica no **meio da borda esquerda**, na altura
 * do círculo, e sai do caminho do olho — que vai direto ao meio da tela.
 *
 * **Não** no canto superior esquerdo, de propósito: aquele canto é da `Marca`,
 * a volta ao início, em toda tela onde ela aparece. Pôr um segundo significado
 * ali diluiria o primeiro — o canto passaria a querer dizer duas coisas
 * conforme a tela, que é o tipo de ambiguidade que se paga toda vez.
 *
 * **Só em `/`, e só com a gravação parada.** Quem monta este componente é o ramo
 * de "parado" da `Gravacao`, o mesmo que abrigava os três links. Navegar para
 * fora no meio de uma gravação a mataria.
 */
import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { Importacao } from "./Importacao";

export function Gestao() {
  const [aberto, setAberto] = useState(false);
  const idGaveta = useId();
  const engrenagem = useRef<HTMLButtonElement | null>(null);
  const gaveta = useRef<HTMLElement | null>(null);

  // Esc fecha, de qualquer lugar de dentro. Só escuta enquanto está aberto:
  // um listener de teclado vivo numa tela de gravar é ruído que ninguém pediu.
  useEffect(() => {
    if (!aberto) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAberto(false);
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [aberto]);

  /**
   * O foco entra na gaveta ao abrir e volta para a engrenagem ao fechar. Sem
   * isto, quem navega por teclado abre o menu e continua com o foco atrás dele.
   *
   * `tocado` existe para o primeiro render não roubar o foco: `aberto` nasce
   * falso, e sem a guarda a tela de gravar abriria com o cursor na engrenagem.
   */
  const tocado = useRef(false);
  useEffect(() => {
    if (!tocado.current) {
      tocado.current = true;
      return;
    }
    if (aberto) gaveta.current?.querySelector<HTMLElement>("a, button")?.focus();
    else engrenagem.current?.focus();
  }, [aberto]);

  return (
    <>
      <button
        ref={engrenagem}
        className="engrenagem"
        aria-label="gestão"
        aria-expanded={aberto}
        aria-controls={idGaveta}
        onClick={() => setAberto((a) => !a)}
      >
        {/* SVG inline, como o ponto da marca: nenhum pacote de ícone entra por
            causa de um desenho só. */}
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Zm8.4-2.2a8.6 8.6 0 0 0 0-2.6l2-1.5-2-3.4-2.3 1a8.5 8.5 0 0 0-2.3-1.3L15.5 2h-4l-.3 2.5a8.5 8.5 0 0 0-2.3 1.3l-2.3-1-2 3.4 2 1.5a8.6 8.6 0 0 0 0 2.6l-2 1.5 2 3.4 2.3-1a8.5 8.5 0 0 0 2.3 1.3l.3 2.5h4l.3-2.5a8.5 8.5 0 0 0 2.3-1.3l2.3 1 2-3.4-2-1.5Z" />
        </svg>
      </button>

      {/* O véu fecha ao toque e escurece o que está atrás — a gaveta é modal de
          fato, mesmo sem prender o foco à força. */}
      <div className={`veu${aberto ? " aberto" : ""}`} onClick={() => setAberto(false)} />

      <nav
        ref={gaveta}
        id={idGaveta}
        className={`gaveta${aberto ? " aberta" : ""}`}
        aria-label="gestão"
        aria-hidden={!aberto}
      >
        <span className="titulo">gestão</span>

        {/* Navegar fecha sozinho: a tela some junto. O `onClick` existe para o
            caso de eu clicar na rota em que já estou. */}
        <Link className="item" href="/sessoes" onClick={() => setAberto(false)}>
          sessões
        </Link>
        <Link className="item" href="/entidades" onClick={() => setAberto(false)}>
          entidades
        </Link>
        {/* Fica aqui sempre, e não só quando há o que calibrar: a gaveta é o
            mapa da gestão, e porta que aparece e some é porta que eu procuro
            no lugar errado. Quem aparece por tempo é a sugestão (slice 4.6). */}
        <Link className="item" href="/calibracao" onClick={() => setAberto(false)}>
          calibração
        </Link>

        <hr />

        {/* Fica dentro da gaveta e **não** a fecha ao ser clicado: o próprio
            botão vira "subindo o áudio…" enquanto sobe, e mostra a recusa de
            formato ali mesmo. Fechar jogaria os dois fora da tela. Ela some
            sozinha quando o upload termina e a rota troca. */}
        <Importacao />
      </nav>
    </>
  );
}
