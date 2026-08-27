/**
 * Pipeline de transcrição. Todo passo é idempotente, chaveado por
 * `sessao_id` (+ `chunk_index` quando aplicável) — regra 4.
 *
 * Cada bloco é transcrito assim que sobe, não no fim: quando a gravação
 * para, só falta o último bloco.
 */
import { chaveChunkAudio, chaveChunkTranscricao, chaveTranscricao } from "./chaves";
import {
  atualizarManifest,
  carregarManifest,
  extensaoDoChunk,
  marcarTranscrito,
  pendentes,
  tudoTranscrito,
} from "./manifest";
import { getBytes, getJson, putJson } from "./r2";
import { atualizarSessao, buscarSessao } from "./sessoes";
import { transcrever } from "./stt";
import { concatenar, prefixoContiguo } from "./transcricao";
import type { Transcricao, TranscricaoBloco } from "./tipos";

/**
 * Transcreve um bloco e grava `chunk_NNN.json`.
 *
 * A existência desse objeto é a chave de idempotência: se ele já está lá,
 * não chama o STT de novo nem sobrescreve o resultado pronto (aceite 9).
 */
export async function transcreverBloco(sessao_id: string, i: number): Promise<TranscricaoBloco> {
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

  const { texto, palavras, modelo, granularidade } = await transcrever(audio);
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

const ESPERA_MAX_MS = 45_000;
const INTERVALO_ESPERA_MS = 1_000;

/**
 * Fecha a sessão: espera os blocos pendentes, concatena com offsets
 * absolutos e grava `transcricao.json`.
 *
 * Idempotente: numa sessão já `transcrito`, devolve o que está gravado
 * sem reprocessar.
 */
export async function finalizarSessao(sessao_id: string): Promise<{
  status: "transcrito" | "erro";
  transcricao?: Transcricao;
  faltando?: number[];
}> {
  const sessao = await buscarSessao(sessao_id);
  if (!sessao) throw new Error(`Sessão ${sessao_id} não existe`);

  if (sessao.status === "transcrito") {
    const pronta = await getJson<Transcricao>(chaveTranscricao(sessao_id));
    if (pronta) return { status: "transcrito", transcricao: pronta.valor };
  }

  await atualizarSessao(sessao_id, { status: "transcrevendo" }, [
    "gravando",
    "finalizando",
    "transcrevendo",
    "abandonada",
    "erro",
  ]);

  // Espera os blocos que ainda estão no STT; retranscreve o que ficou para trás.
  const limite = Date.now() + ESPERA_MAX_MS;
  let m = await carregarManifest(sessao_id);

  while (!tudoTranscrito(m) && Date.now() < limite) {
    for (const c of pendentes(m)) {
      try {
        await transcreverBloco(sessao_id, c.i);
      } catch (e) {
        // Outro worker pode estar no mesmo bloco; a próxima volta relê o
        // manifest. Mas o motivo vai para o log: a tela só sabe dizer que
        // falhou, e sem esta linha a falha fica indiagnosticável depois.
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

  return { status: "transcrito", transcricao };
}
