"use client";

/**
 * Importar um arquivo de áudio já gravado — nota de voz do WhatsApp,
 * gravador do celular, o que for.
 *
 * Um arquivo é uma sessão inteira, num bloco só (`i = 0`). Não fatiamos:
 * o offset do bloco 0 é zero, então os timestamps que o STT devolve já são
 * absolutos, e a sessão sai sem as emendas de 30 s da gravação ao vivo.
 *
 * O arquivo vai direto do navegador para o R2 pela presigned URL, como o
 * bloco gravado (regra 1). Não passa pelo IndexedDB: a fila local existe
 * para não perder fala quando a aba fecha no meio da gravação, e um
 * arquivo importado já está no disco de quem o escolheu.
 *
 * Mora dentro do menu de gestão (`Gestao`), como item. Clicar nele **não**
 * fecha a gaveta de propósito: o rótulo vira "subindo o áudio…" e a recusa de
 * formato aparece logo abaixo — os dois precisam estar visíveis onde eu cliquei.
 */
import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { atrasoBackoff } from "@/lib/backoff";
import { EXTENSOES_ACEITAS, formatoDeArquivo, motivoRecusa } from "@/lib/audio";

type Fase = "parado" | "lendo" | "subindo" | "fechando";

const ACCEPT = [...EXTENSOES_ACEITAS.map((e) => `.${e}`), "audio/*"].join(",");

const TENTATIVAS_PUT = 3;

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

export function Importacao() {
  const router = useRouter();
  const entrada = useRef<HTMLInputElement | null>(null);
  const [fase, setFase] = useState<Fase>("parado");
  const [problema, setProblema] = useState<string | null>(null);

  const importar = useCallback(
    async (arquivo: File) => {
      setProblema(null);
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

      try {
        setFase("subindo");
        const { id } = await json<{ id: string }>("/api/sessoes");
        const base = `/api/sessoes/${id}/chunks/0`;

        const { url } = await json<{ url: string }>(`${base}/url`, { ext: formato.ext });

        for (let tentativa = 0; ; tentativa++) {
          try {
            const put = await fetch(url, {
              method: "PUT",
              body: arquivo,
              headers: { "Content-Type": formato.mime },
            });
            if (!put.ok) throw new Error(`PUT no R2 respondeu ${put.status}`);
            break;
          } catch (e) {
            if (tentativa >= TENTATIVAS_PUT - 1) throw e;
            console.warn(`[importacao] PUT tentativa ${tentativa + 1}:`, e);
            await new Promise((r) => setTimeout(r, atrasoBackoff(tentativa)));
          }
        }

        await json(`${base}/pronto`, {
          ext: formato.ext,
          duracao_s: Number.isFinite(duracao_s) ? duracao_s : undefined,
        });

        // Quem chama `/finalizar` é a `Leitura`, como no caminho da gravação:
        // ela espera a fila (vazia aqui) e manda a duração do sessionStorage.
        // Dois finalizar concorrentes seriam inofensivos — a rota é idempotente
        // — mas duas responsabilidades iguais em lugares diferentes divergem.
        setFase("fechando");
        if (Number.isFinite(duracao_s)) {
          sessionStorage.setItem(`duracao:${id}`, String(Math.round(duracao_s)));
        }
        router.push(`/sessao/${id}`);
      } catch (e) {
        console.error("[importacao]", e);
        setProblema("Não consegui subir esse arquivo. Tente de novo.");
        setFase("parado");
      }
    },
    [router],
  );

  const ocupado = fase !== "parado";

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
        {fase === "parado" ? "ou subir um áudio que já gravei" : "subindo o áudio…"}
      </button>
      {problema && <p className="aviso">{problema}</p>}
    </>
  );
}
