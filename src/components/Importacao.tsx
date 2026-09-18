"use client";

/**
 * Importar um arquivo de áudio já gravado — nota de voz do WhatsApp,
 * gravador do celular, o que for.
 *
 * **Desde a slice 4.10 o arquivo é fatiado em blocos de 30 s**, os mesmos da
 * gravação, e sobe um `chunk_NNN` por bloco. Antes ele ia inteiro em `i = 0`, e
 * era decisão consciente — "não fatiamos", dizia este docstring. O preço só
 * apareceu quando a janela existiu: com um bloco só, `janelasDe` devolve uma
 * janela que *é* a sessão inteira, e as slices 4.8 e 4.9 ficam inertes no
 * caminho importado. O que era para ser nove chamadas de 2 min virava uma
 * chamada de 17 min, e o RAG rodava uma vez para dezessete minutos em vez de a
 * cada 30 s.
 *
 * **O caminho antigo continua inteiro**, e é para onde cai o arquivo que este
 * navegador não decodifica: `fatiarArquivo` devolve `null` e o arquivo sobe numa
 * peça só, como sempre fez. Esta mudança não pode deixar a importação pior do
 * que ela já é — no pior caso ela fica igual.
 *
 * O áudio vai direto do navegador para o R2 pela presigned URL, como o
 * bloco gravado (regra 1). Não passa pelo IndexedDB: a fila local existe
 * para não perder fala quando a aba fecha no meio da gravação, e um
 * arquivo importado já está no disco de quem o escolheu.
 *
 * Mora dentro do menu de gestão (`Gestao`), como item. Clicar nele **não**
 * fecha a gaveta de propósito: o rótulo vira "subindo bloco 3 de 35…" e a recusa
 * de formato aparece logo abaixo — os dois precisam estar visíveis onde eu
 * cliquei.
 */
import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { atrasoBackoff } from "@/lib/backoff";
import { EXTENSOES_ACEITAS, formatoDeArquivo, motivoRecusa } from "@/lib/audio";
import { fatiarArquivo } from "@/client/fatiador";
import { marcarParada } from "@/client/medidas";

type Fase = "parado" | "lendo" | "subindo" | "fechando";

const ACCEPT = [...EXTENSOES_ACEITAS.map((e) => `.${e}`), "audio/*"].join(",");

const TENTATIVAS_PUT = 3;

/**
 * Quantos blocos sobem ao mesmo tempo.
 *
 * É a mitigação do único risco que esta fatia cria: trinta e cinco `/pronto` em
 * sequência disparam trinta e cinco chamadas de STT em cerca de um minuto, e a
 * gravação espalha as mesmas trinta e cinco por dezessete minutos reais. É
 * exatamente a rajada que a slice 4.8 existe para evitar, chegando pela porta
 * dos fundos. Dois de cada vez, e `comEsperaDeLimite` absorve o resto — se não
 * bastar, a saída registrada é o bloco de 2 min.
 */
const BLOCOS_SIMULTANEOS = 2;

/**
 * Duração real do arquivo, pelo próprio navegador. Container sem cabeçalho
 * de duração devolve `Infinity` ou `NaN` — quem decide o que fazer com isso
 * é `motivoRecusa`, que deixa passar. O servidor cai na contagem de blocos.
 */
function duracaoDoArquivo(arquivo: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(arquivo);
    const el = document.createElement("audio");
    const encerrar = (v: number) => {
      URL.revokeObjectURL(url);
      resolve(v);
    };
    el.preload = "metadata";
    el.onloadedmetadata = () => encerrar(el.duration);
    el.onerror = () => encerrar(NaN);
    // Arquivo que o navegador não decodifica não pode travar a importação:
    // o STT pode dar conta dele mesmo assim.
    setTimeout(() => encerrar(NaN), 5_000);
    el.src = url;
  });
}

async function json<T>(url: string, corpo?: unknown): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo ?? {}),
  });
  if (!r.ok) throw new Error(`${url} respondeu ${r.status}`);
  return (await r.json()) as T;
}

/** O PUT no R2, com as mesmas três tentativas que a gravação sempre teve. */
async function subir(url: string, corpo: Blob | File, mime: string): Promise<void> {
  for (let tentativa = 0; ; tentativa++) {
    try {
      const put = await fetch(url, {
        method: "PUT",
        body: corpo,
        headers: { "Content-Type": mime },
      });
      if (!put.ok) throw new Error(`PUT no R2 respondeu ${put.status}`);
      return;
    } catch (e) {
      if (tentativa >= TENTATIVAS_PUT - 1) throw e;
      console.warn(`[importacao] PUT tentativa ${tentativa + 1}:`, e);
      await new Promise((r) => setTimeout(r, atrasoBackoff(tentativa)));
    }
  }
}

/**
 * Um bloco: presigned, PUT, `/pronto`.
 *
 * **Sem `duracao_s` no `/pronto`**, e este é o detalhe que morde em silêncio se
 * escapar: aquela rota grava a duração na sessão a cada chamada, e o campo
 * existe porque "arquivo importado é um bloco só, de duração arbitrária".
 * Fatiado, ele deixa de ser — mandar `30` em cada bloco deixaria a sessão de
 * 17 min registrada como 30 s. Sem o campo vale a conta da gravação,
 * `chunks.length × 30`, que é a certa para blocos de 30 s. Quem manda a duração
 * real continua sendo o `/finalizar`, uma vez só.
 */
async function subirBloco(id: string, i: number, bloco: Blob): Promise<void> {
  const base = `/api/sessoes/${id}/chunks/${i}`;
  const { url } = await json<{ url: string }>(`${base}/url`, { ext: "wav" });
  await subir(url, bloco, "audio/wav");
  await json(`${base}/pronto`, { ext: "wav" });
}

export function Importacao() {
  const router = useRouter();
  const entrada = useRef<HTMLInputElement | null>(null);
  const [fase, setFase] = useState<Fase>("parado");
  const [progresso, setProgresso] = useState<{ feitos: number; total: number } | null>(null);
  const [problema, setProblema] = useState<string | null>(null);

  const importar = useCallback(
    async (arquivo: File) => {
      setProblema(null);
      setProgresso(null);
      setFase("lendo");

      const formato = formatoDeArquivo(arquivo.name, arquivo.type);
      if (!formato) {
        setProblema(`${arquivo.name} não é um áudio que eu saiba ler.`);
        setFase("parado");
        return;
      }

      const duracao_s = await duracaoDoArquivo(arquivo);
      const recusa = motivoRecusa(arquivo.size, duracao_s);
      if (recusa) {
        setProblema(recusa);
        setFase("parado");
        return;
      }

      // Antes de criar a sessão: decodificar e fatiar leva segundos num arquivo
      // de 17 min, e uma sessão criada aqui ficaria pendurada se isso falhasse.
      const blocos = await fatiarArquivo(arquivo);

      try {
        setFase("subindo");
        setProgresso({ feitos: 0, total: blocos?.length ?? 1 });
        const { id } = await json<{ id: string }>("/api/sessoes");

        if (blocos) {
          // Duas frentes, não trinta e cinco: ver `BLOCOS_SIMULTANEOS`. O
          // manifest aguenta a concorrência — toda escrita dele é
          // read-modify-write condicional por etag —, e a ordem de chegada não
          // importa, porque a janela só fecha sobre prefixo contíguo.
          let proximo = 0;
          const frente = async () => {
            for (let i = proximo++; i < blocos.length; i = proximo++) {
              await subirBloco(id, i, blocos[i]);
              setProgresso((p) => (p ? { ...p, feitos: p.feitos + 1 } : p));
            }
          };
          await Promise.all(
            Array.from({ length: Math.min(BLOCOS_SIMULTANEOS, blocos.length) }, frente),
          );
        } else {
          // O caminho de sempre: um arquivo, um bloco, a extensão de origem. É
          // aqui que `duracao_s` continua valendo, porque aqui o bloco de fato
          // tem duração arbitrária.
          const base = `/api/sessoes/${id}/chunks/0`;
          const { url } = await json<{ url: string }>(`${base}/url`, { ext: formato.ext });
          await subir(url, arquivo, formato.mime);
          await json(`${base}/pronto`, {
            ext: formato.ext,
            duracao_s: Number.isFinite(duracao_s) ? duracao_s : undefined,
          });
          setProgresso((p) => (p ? { ...p, feitos: 1 } : p));
        }

        // Quem chama `/finalizar` é a `Leitura`, como no caminho da gravação:
        // ela espera a fila (vazia aqui) e manda a duração do sessionStorage.
        // Dois finalizar concorrentes seriam inofensivos — a rota é idempotente
        // — mas duas responsabilidades iguais em lugares diferentes divergem.
        setFase("fechando");
        // O equivalente do "parar" neste caminho é o arquivo aceito — o último
        // gesto meu antes de a espera começar (slice 8). Ele é marcado só agora
        // porque o id da sessão não existia antes; `parou` carrega o instante em
        // que eu escolhi o arquivo, não este.
        marcarParada(id, "importacao");
        if (Number.isFinite(duracao_s)) {
          sessionStorage.setItem(`duracao:${id}`, String(Math.round(duracao_s)));
        }
        router.push(`/sessao/${id}`);
      } catch (e) {
        console.error("[importacao]", e);
        setProblema("Não consegui subir esse arquivo. Tente de novo.");
        setFase("parado");
        setProgresso(null);
      }
    },
    [router],
  );

  const ocupado = fase !== "parado";

  /**
   * Trinta e cinco PUTs demoram o suficiente para o silêncio virar dúvida, e
   * "subindo o áudio…" parado por dois minutos parece travado.
   */
  const rotulo = (): string => {
    if (fase === "parado") return "ou subir um áudio que já gravei";
    if (fase === "lendo") return "lendo o arquivo…";
    if (fase === "subindo" && progresso && progresso.total > 1) {
      return `subindo bloco ${Math.min(progresso.feitos + 1, progresso.total)} de ${progresso.total}…`;
    }
    return "subindo o áudio…";
  };

  return (
    <>
      <input
        ref={entrada}
        type="file"
        accept={ACCEPT}
        hidden
        onChange={(e) => {
          const arquivo = e.target.files?.[0];
          // Zera o valor para que escolher o mesmo arquivo de novo dispare.
          e.target.value = "";
          if (arquivo) void importar(arquivo);
        }}
      />
      <button className="item" onClick={() => entrada.current?.click()} disabled={ocupado}>
        {rotulo()}
      </button>
      {problema && <p className="aviso">{problema}</p>}
    </>
  );
}
