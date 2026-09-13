"use client";

/**
 * A tela de gravar: um botão, um timer, um jeito de parar.
 *
 * O botão é o mesmo nó do DOM nos dois estados — ver `BotaoGravar`. Parado e
 * gravando não são duas telas, são a mesma tela com o círculo no centro; é o
 * que dá continuidade à transição em vez de um corte.
 *
 * O que muda em volta dele: parado, a engrenagem no canto; gravando, o timer, o
 * ponto de "salvo" e o "parar". A mecânica de upload continua invisível — sem
 * contador de blocos, sem barra de progresso. A onda lateral do botão mostra o
 * microfone, não a fila.
 *
 * **Nada de crônico entra aqui.** Havia um chip de recuperação que aparecia
 * sempre que existia sessão aberta, e num dos estados ele cobrava: "sessão de
 * 12 min esperando revisão". Cobrança na tela onde eu passo o tempo é a forma de
 * morte que `Specs/visao.md` §6 descreve. O que falta revisar se lê na lista de
 * sessões, pela cor, no lugar onde eu já vou procurar.
 *
 * E os três controles que sobravam — subir um áudio, sessões, entidades —
 * viraram um só: a engrenagem da `Gestao`, no meio da borda esquerda. O canto
 * superior esquerdo é da `Marca`, e continua sendo só dela. Ela sai do caminho
 * do olho, que vai direto ao círculo.
 *
 * **A bolha do chat entrou na slice 6, e ela não fura nenhuma dessas regras.**
 * Ela mora no mesmo ramo de "parado" que a `Gestao`: durante a gravação, some
 * inteira. Aberta, ela expande para o centro e o círculo minimiza e vai para o
 * topo — os dois ficam periféricos quando não estão em foco, e nenhum dos dois
 * desaparece.
 *
 * **Com o chat aberto, o primeiro toque no círculo não grava.** Ele restaura o
 * círculo ao centro e fecha o chat; só o segundo toque começa a gravar. Um
 * toque só — fechar e já gravar — foi considerado, por ser o gesto mais
 * parecido com o "um botão, um toque" que rege esta tela, e recusado: começar
 * uma gravação sem querer, só tentando sair do chat, custa mais que um toque.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Gravador, suportado } from "@/client/gravador";
import { acordar, enfileirar, observarFila, type EstadoFila } from "@/client/fila";
import { guardarSessaoAtual, limparSessaoAtual } from "@/client/deposito";
import { BotaoGravar } from "./BotaoGravar";
import { Chat } from "./Chat";
import { Gestao } from "./Gestao";

type Fase = "parado" | "abrindo" | "gravando" | "encerrando";

function mmss(segundos: number): string {
  const s = Math.max(0, Math.floor(segundos));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function Gravacao() {
  const router = useRouter();
  const gravador = useRef<Gravador | null>(null);
  const sessaoId = useRef<string | null>(null);

  const [fase, setFase] = useState<Fase>("parado");
  const [segundos, setSegundos] = useState(0);
  const [fila, setFila] = useState<EstadoFila>({ pendentes: 0, ultimo_salvo_em: null, offline: false });
  const [problema, setProblema] = useState<string | null>(null);
  // O stream vira estado, não só ref: a onda do botão precisa re-renderizar
  // quando o microfone abre, e um ref não avisa ninguém.
  const [faixa, setFaixa] = useState<MediaStream | null>(null);
  const [chatAberto, setChatAberto] = useState(false);

  useEffect(() => observarFila(setFila), []);
  useEffect(() => acordar(), []);

  useEffect(() => {
    if (fase !== "gravando") return;
    const t = setInterval(() => setSegundos((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [fase]);

  const comecar = useCallback(
    async () => {
      if (!suportado()) {
        setProblema("Este navegador não grava áudio no formato que o sistema usa.");
        return;
      }
      setProblema(null);
      setFase("abrindo");

      try {
        const r = await fetch("/api/sessoes", { method: "POST" });
        if (!r.ok) throw new Error(`/api/sessoes respondeu ${r.status}`);
        const id = ((await r.json()) as { id: string }).id;

        sessaoId.current = id;
        await guardarSessaoAtual(id);

        const g = new Gravador({
          aoBloco: ({ i, blob }) => void enfileirar(id, i, blob),
          aoErro: (e) => console.error("[gravador]", e),
        });

        await g.iniciar();
        gravador.current = g;
        setFaixa(g.faixa);
        setSegundos(0);
        setFase("gravando");
      } catch (e) {
        console.error(e);
        setProblema("Não consegui começar a gravar. O microfone está liberado?");
        setFase("parado");
      }
    },
    [],
  );

  const parar = useCallback(async () => {
    if (fase !== "gravando") return;
    setFase("encerrando");

    const g = gravador.current;
    const id = sessaoId.current;
    const duracao = g?.duracaoS() ?? segundos;

    await g?.parar();
    gravador.current = null;
    setFaixa(null);
    await limparSessaoAtual();
    acordar();

    if (id) {
      sessionStorage.setItem(`duracao:${id}`, String(Math.round(duracao)));
      router.push(`/sessao/${id}`);
    } else {
      setFase("parado");
    }
  }, [fase, router, segundos]);

  const gravando = fase === "gravando" || fase === "encerrando";
  const salvo = fila.pendentes === 0 && fila.ultimo_salvo_em !== null;

  /**
   * O toque no círculo, com o chat aberto, é "volta pro centro" — não "grava".
   * Gravar continua sendo o segundo toque, no círculo já central e inteiro.
   */
  const tocarNoCirculo = useCallback(() => {
    if (chatAberto) {
      setChatAberto(false);
      return;
    }
    void comecar();
  }, [chatAberto, comecar]);

  return (
    <main className={`tela ${gravando ? "gravando" : ""} ${chatAberto ? "com-chat" : ""}`}>
      <BotaoGravar
        gravando={gravando}
        ocupado={fase === "abrindo" || fase === "encerrando"}
        rotulo="Como foi seu dia?"
        faixa={faixa}
        aoTocar={tocarNoCirculo}
      />

      {gravando ? (
        <>
          {/* O timer deixou de ser o herói da tela quando o círculo virou o
              centro. Ele continua aqui porque é informação real — quanto tempo
              eu já falei —, só que no tamanho de informação, não de manchete. */}
          <div className="timer">{mmss(segundos)}</div>
          <div className={`ponto-salvo ${salvo ? "" : "pendente"}`}>
            <i /> {salvo ? "salvo" : "salvando"}
          </div>
          <button className="botao-parar" onClick={parar} disabled={fase === "encerrando"}>
            {fase === "encerrando" ? "encerrando…" : "parar"}
          </button>
        </>
      ) : (
        <>
          {/* Porta de serviço única, discreta de propósito: a tela de gravar é
              onde eu passo o tempo, e nada aqui pode virar cobrança. */}
          <Gestao />
          {/* Mesma condição, e não uma segunda: a bolha some durante a gravação
              pelo mesmo motivo que a engrenagem some. */}
          <Chat
            aberto={chatAberto}
            aoAbrir={() => setChatAberto(true)}
            aoFechar={() => setChatAberto(false)}
          />
        </>
      )}

      {problema && <p className="aviso">{problema}</p>}
    </main>
  );
}
