/**
 * Pipeline de transcrição e extração. Todo passo é idempotente, chaveado por
 * `sessao_id` (+ `chunk_index` quando aplicável) — regra 4.
 *
 * Cada bloco é transcrito assim que sobe, não no fim: quando a gravação
 * para, só falta o último bloco. Terminada a transcrição, a extração dispara
 * sozinha — ninguém aperta nada entre parar de falar e ter a proposta.
 */
import { chaveChunkAudio, chaveChunkTranscricao, chaveExtracao, chaveTranscricao } from "./chaves";
import { extrair } from "./extracao";
import {
  atualizarManifest,
  carregarManifest,
  extensaoDoChunk,
  marcarTranscrito,
  pendentes,
  tudoTranscrito,
} from "./manifest";
import { ehLimiteDeTaxa } from "./limite";
import { ConflitoR2Error, getBytes, getJson, putJson } from "./r2";
import { atualizarSessao, buscarSessao } from "./sessoes";
import { temTranscricao } from "./estados";
import { transcrever } from "./stt";
import { concatenar, prefixoContiguo } from "./transcricao";
import type { Extracao, Transcricao, TranscricaoBloco } from "./tipos";

/**
 * Transcreve um bloco e grava `chunk_NNN.json`.
 *
 * A existência desse objeto é a chave de idempotência: se ele já está lá,
 * não chama o STT de novo nem sobrescreve o resultado pronto (aceite 9).
 *
 * `ate` é o prazo de quem chama: `transcrever` espera o rate limit do Gateway
 * passar (`limite.ts`), e dentro do laço de `finalizarSessao` essa espera tem
 * de caber no orçamento da função. Na subida do bloco não há prazo — o
 * `waitUntil` da rota `pronto` cuida de um bloco só.
 */
export async function transcreverBloco(
  sessao_id: string,
  i: number,
  { ate }: { ate?: number } = {},
): Promise<TranscricaoBloco> {
  const keyTranscricao = chaveChunkTranscricao(sessao_id, i);

  const pronto = await getJson<TranscricaoBloco>(keyTranscricao);
  if (pronto) {
    await atualizarManifest(sessao_id, (m) => marcarTranscrito(m, i));
    return pronto.valor;
  }

  // A extensão sai do manifest: bloco gravado é `.webm`, arquivo importado
  // guarda o formato de origem. Chutar `.webm` mataria toda sessão importada.
  const manifest = await carregarManifest(sessao_id);
  const key = chaveChunkAudio(sessao_id, i, extensaoDoChunk(manifest, i));

  const audio = await getBytes(key);
  if (!audio) throw new Error(`Bloco ${i} da sessão ${sessao_id} não está no R2 (${key})`);

  const { texto, palavras, modelo, granularidade } = await transcrever(audio, { ate });
  const bloco: TranscricaoBloco = { i, texto, palavras, modelo, granularidade };

  await putJson(keyTranscricao, bloco);
  await atualizarManifest(sessao_id, (m) => marcarTranscrito(m, i));

  return bloco;
}

/** Lê do R2 os blocos já transcritos. */
export async function blocosProntos(sessao_id: string, indices: number[]): Promise<TranscricaoBloco[]> {
  const lidos = await Promise.all(
    indices.map((i) => getJson<TranscricaoBloco>(chaveChunkTranscricao(sessao_id, i))),
  );
  return lidos.flatMap((o) => (o ? [o.valor] : []));
}

/** Texto parcial para a tela de processamento: só o prefixo contíguo. */
export async function transcricaoParcial(sessao_id: string): Promise<{ texto: string; blocos: number }> {
  const m = await carregarManifest(sessao_id);
  const transcritos = prefixoContiguo(m.chunks.filter((c) => c.transcrito));
  if (transcritos.length === 0) return { texto: "", blocos: 0 };

  const blocos = await blocosProntos(sessao_id, transcritos.map((c) => c.i));
  return { texto: concatenar(sessao_id, blocos).texto, blocos: blocos.length };
}

/**
 * Quanto a finalização espera pelos blocos que ainda faltam.
 *
 * Eram 45 s, e 45 s é **menos que uma janela de rate limit**: medido em
 * 2026-09-02, o limite do free tier levou ~75 s para ceder (`limite.ts`). O
 * laço estourava o prazo sem nunca ter chance de passar — e, pior, martelava o
 * Gateway de segundo em segundo enquanto isso, que é o jeito de fazer o limite
 * durar mais.
 *
 * O teto de cima é o `maxDuration` de 300 s da rota `/finalizar`, e a extração
 * roda depois disto, no mesmo `waitUntil` — daí 150 s e não 300 s. O custo é
 * assumido: um bloco que falha por motivo definitivo (modelo inexistente,
 * áudio corrompido) agora leva 150 s para ser declarado perdido em vez de 45 s.
 */
export const ESPERA_MAX_MS = 150_000;
const INTERVALO_ESPERA_MS = 1_000;

/**
 * Fecha a sessão: espera os blocos pendentes, concatena com offsets
 * absolutos e grava `transcricao.json`.
 *
 * Idempotente: numa sessão já `transcrito`, devolve o que está gravado
 * sem reprocessar.
 */
export async function finalizarSessao(sessao_id: string): Promise<{
  status: "em_revisao" | "transcrito" | "erro";
  transcricao?: Transcricao;
  faltando?: number[];
}> {
  const sessao = await buscarSessao(sessao_id);
  if (!sessao) throw new Error(`Sessão ${sessao_id} não existe`);

  if (temTranscricao(sessao.status)) {
    const pronta = await getJson<Transcricao>(chaveTranscricao(sessao_id));
    // A transcrição já está gravada; o que pode faltar é a extração. Chamar
    // de novo é o retry do caminho que o `waitUntil` pode ter perdido.
    if (pronta) {
      const { status } = await extrairSessao(sessao_id);
      return { status, transcricao: pronta.valor };
    }
  }

  await atualizarSessao(sessao_id, { status: "transcrevendo" }, [
    "gravando",
    "finalizando",
    "transcrevendo",
    "erro",
  ]);

  // Espera os blocos que ainda estão no STT; retranscreve o que ficou para trás.
  const limite = Date.now() + ESPERA_MAX_MS;
  let m = await carregarManifest(sessao_id);
  let limitado = false;

  while (!tudoTranscrito(m) && Date.now() < limite) {
    for (const c of pendentes(m)) {
      // Dentro do laço, não só na volta: com o rate limit, um único bloco pode
      // segurar dezenas de segundos, e uma rodada de dez blocos pendentes
      // passaria muito do prazo antes de alguém reconferir o relógio.
      if (Date.now() >= limite) break;
      try {
        await transcreverBloco(sessao_id, c.i, { ate: limite });
      } catch (e) {
        // Outro worker pode estar no mesmo bloco; a próxima volta relê o
        // manifest. Mas o motivo vai para o log: a tela só sabe dizer que
        // falhou, e sem esta linha a falha fica indiagnosticável depois.
        limitado = limitado || ehLimiteDeTaxa(e);
        console.error(`[pipeline] sessão ${sessao_id} bloco ${c.i} não transcreveu:`, e);
      }
    }
    m = await carregarManifest(sessao_id);
    if (tudoTranscrito(m)) break;
    await new Promise((r) => setTimeout(r, INTERVALO_ESPERA_MS));
  }

  if (!tudoTranscrito(m)) {
    const faltando = pendentes(m).map((c) => c.i);
    console.error(
      `[pipeline] sessão ${sessao_id}: desistiu após ${ESPERA_MAX_MS / 1000}s com bloco(s) faltando: ${faltando.join(", ")}. ` +
        (limitado
          ? "A causa foi rate limit do AI Gateway, que já foi esperado e não cedeu — " +
            "chamar /finalizar de novo daqui a alguns minutos costuma resolver. "
          : "") +
        `O motivo de cada um está nas linhas [pipeline] acima. Áudio intacto no R2.`,
    );
    await atualizarSessao(sessao_id, { status: "erro" }); // áudio intacto, retry manual
    return { status: "erro", faltando };
  }

  const blocos = await blocosProntos(sessao_id, m.chunks.map((c) => c.i));
  const transcricao = concatenar(sessao_id, blocos);

  await putJson(chaveTranscricao(sessao_id), transcricao);
  await atualizarManifest(sessao_id, (mm) => (mm.finalizado ? mm : { ...mm, finalizado: true }));
  await atualizarSessao(sessao_id, {
    status: "transcrito",
    chunks_total: m.chunks.length,
    duracao_s: sessao.duracao_s,
  });

  // Emenda direto na extração, no mesmo waitUntil (aceite 1 da slice 2: eu não
  // aperto nada entre parar de falar e ver a lista). Falhar aqui não desfaz a
  // transcrição, que já está no R2 e no estado da sessão.
  const { status } = await extrairSessao(sessao_id);
  return { status, transcricao };
}

/**
 * Extrai os átomos e grava a proposta em `extracao.json`.
 *
 * **Trava de idempotência: a existência do objeto.** Se a proposta já está no
 * R2, não se chama o modelo de novo nem se sobrescreve o que pode já ter sido
 * revisado (regra 4). O `If-None-Match: *` fecha a corrida entre dois workers:
 * quem chega em segundo recebe conflito e passa a usar a proposta do primeiro.
 *
 * `forcar` é a saída de emergência, e existe por um motivo só: calibrar o
 * prompt. Sem ela, cada tentativa de prompt novo exigiria gravar áudio novo,
 * porque a trava impede reprocessar a sessão que já tem proposta. O caminho
 * automático nunca força.
 *
 * Nada disso toca o grafo além do estado da própria `:Sessao` — átomo e
 * entidade só entram no confirmar, depois da revisão (regra 5).
 */
export async function extrairSessao(
  sessao_id: string,
  { forcar = false }: { forcar?: boolean } = {},
): Promise<{ status: "em_revisao" | "erro"; extracao?: Extracao }> {
  const key = chaveExtracao(sessao_id);

  const pronta = forcar ? null : await getJson<Extracao>(key);
  if (pronta) {
    await marcarEmRevisao(sessao_id);
    return { status: "em_revisao", extracao: pronta.valor };
  }

  const transcricao = await getJson<Transcricao>(chaveTranscricao(sessao_id));
  if (!transcricao) {
    console.error(`[extracao] sessão ${sessao_id}: sem transcricao.json, não há o que extrair`);
    await atualizarSessao(sessao_id, { status: "erro" });
    return { status: "erro" };
  }

  await atualizarSessao(sessao_id, { status: "extraindo" }, ["transcrito", "extraindo", "erro"]);

  try {
    const extracao = await extrair(transcricao.valor);
    // Forçado sobrescreve: é o modo de calibrar o prompt contra uma sessão já
    // gravada. Sem `ifNoneMatch` não há corrida a perder — quem forçou quer
    // exatamente a proposta nova no lugar da antiga.
    await putJson(key, extracao, forcar ? {} : { ifNoneMatch: "*" });
    await marcarEmRevisao(sessao_id);
    return { status: "em_revisao", extracao };
  } catch (e) {
    if (e instanceof ConflitoR2Error) {
      // Outro worker gravou primeiro. A proposta dele vale tanto quanto a
      // nossa, e é a que já está no R2 — duas propostas para a mesma sessão
      // seriam duas listas diferentes para eu revisar.
      const dele = await getJson<Extracao>(key);
      await marcarEmRevisao(sessao_id);
      return { status: "em_revisao", extracao: dele?.valor };
    }
    // A tela só sabe dizer que falhou; sem esta linha o motivo se perde.
    console.error(`[extracao] sessão ${sessao_id} falhou:`, e);
    await atualizarSessao(sessao_id, { status: "erro" }); // transcrição intacta, retry manual
    return { status: "erro" };
  }
}

/** `confirmada` não volta para `em_revisao`: a guarda é quem impede. */
const marcarEmRevisao = (sessao_id: string) =>
  atualizarSessao(sessao_id, { status: "em_revisao" }, [
    "transcrito",
    "extraindo",
    "em_revisao",
    "erro",
  ]);
