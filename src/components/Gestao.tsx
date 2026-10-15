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
 * **Em `/`, só com a gravação parada.** Quem monta este componente ali é o ramo
 * de "parado" da `Gravacao`, o mesmo que abrigava os três links. Navegar para
 * fora no meio de uma gravação a mataria.
 *
 * **E nas telas de gestão, no canto superior direito** (`GestaoNoCanto`, no
 * layout). Antes a gaveta só existia em `/`, e ir de `/agentes` para
 * `/confronto` era marca, engrenagem, item — três toques e uma tela que não
 * tinha nada a ver com a ida. O canto é o direito porque o esquerdo é da marca;
 * a gaveta entra pelo lado de onde veio o toque, e marca a tela em que estou.
 * Não entra no corredor nem na revisão: o ritual não ganha porta de serviço, e
 * a saída de lá é a marca.
 */
import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ehRitual } from "@/lib/tipografia";
import { Importacao } from "./Importacao";

/**
 * Onde a engrenagem mora no canto: toda tela de gestão — o que não é ritual
 * (`tipografia.ts`) nem `/entrar`, que é anterior à sessão. A de `/` não passa
 * por aqui: ela é da `Gravacao`.
 */
export const mostraGestaoNoCanto = (rota: string | null): boolean =>
  rota !== null && rota !== "/entrar" && !ehRitual(rota);

/** A engrenagem das telas de gestão. Mora no layout, como a `Marca`. */
export function GestaoNoCanto() {
  const rota = usePathname();
  if (!mostraGestaoNoCanto(rota)) return null;
  return <Gestao lado="canto" />;
}

/** As portas da gaveta, na ordem dela. `prefixo` marca a tela atual. */
const PORTAS = [
  { href: "/sessoes", rotulo: "sessões", prefixo: "/sessoes" },
  { href: "/entidades", rotulo: "entidades", prefixo: "/entidades" },
  { href: "/agentes", rotulo: "agentes", prefixo: "/agentes" },
  { href: "/confronto", rotulo: "confronto", prefixo: "/confronto" },
  { href: "/calibracao", rotulo: "calibração", prefixo: "/calibracao" },
] as const;

export function Gestao({ lado = "borda" }: { lado?: "borda" | "canto" }) {
  const [aberto, setAberto] = useState(false);
  const rota = usePathname();
  /**
   * A sugestão de calibrar: **binária, nunca um número**.
   *
   * Consultada ao abrir a gaveta, e nunca em `/`: a tela de gravar é "um
   * botão, um timer, um jeito de parar", e um sinal no ícone da engrenagem
   * seria cobrança na única tela que não pode cobrar nada. A consulta é pura —
   * quem reseta o relógio por mais três semanas é a carga de `/calibracao`, e
   * não este toque, para a sugestão ter chance de valer os 21 dias inteiros.
   */
  const [sugere, setSugere] = useState(false);
  const idGaveta = useId();
  const engrenagem = useRef<HTMLButtonElement | null>(null);
  const gaveta = useRef<HTMLElement | null>(null);

  // No canto, a gaveta sobrevive à troca de tela (o layout não remonta): mudar
  // de rota — inclusive pelo voltar do navegador — fecha.
  useEffect(() => {
    setAberto(false);
  }, [rota]);

  useEffect(() => {
    if (!aberto) return;
    let vivo = true;
    fetch("/api/calibracao/sugestao", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ sugerir: boolean }>) : null))
      .then((d) => vivo && d && setSugere(d.sugerir))
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [aberto]);

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
        className={`engrenagem${lado === "canto" ? " no-canto" : ""}`}
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
        className={`gaveta gaveta-lateral ${lado === "canto" ? "direita" : "esquerda"}${aberto ? " aberta" : ""}`}
        aria-label="gestão"
        aria-hidden={!aberto}
      >
        <span className="titulo">gestão</span>

        {/* Navegar fecha sozinho: a tela some junto. O `onClick` existe para o
            caso de eu clicar na rota em que já estou. A ordem é a de antes —
            sessões, entidades, agentes (o fluxo desenhado e o prompt de cada
            um, slice 4.7), confronto (o "rodar agora" do agente que compara
            átomos, slice 5) e calibração. */}
        {PORTAS.map((p) => {
          const aqui = rota !== null && rota.startsWith(p.prefixo);
          return (
            <Link
              key={p.href}
              className="item"
              href={p.href}
              aria-current={aqui ? "page" : undefined}
              onClick={() => setAberto(false)}
            >
              {p.rotulo}
              {/* Calibração fica sempre, e não só quando há o que calibrar: a
                  gaveta é o mapa da gestão, e porta que aparece e some é porta
                  que eu procuro no lugar errado. Quem aparece por tempo é a
                  sugestão — uma linha, sem número: quantas, de quando e de que
                  tipo é a própria tela que responde (slice 4.6). */}
              {p.href === "/calibracao" && sugere && <span className="sugestao">tem o que olhar</span>}
            </Link>
          );
        })}

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
