/**
 * Repositório de :Sessao. Único label do grafo nesta slice.
 *
 * No grafo vai só a chave: manifest, áudio e texto vivem no R2 (regra 2).
 */
import { query, queryUm } from "./neo4j";
import { chaveTranscricao, prefixoSessao } from "./chaves";
import { STATUS_ABERTOS } from "./estados";
import type { Sessao, StatusSessao } from "./tipos";

/** id em base36: ordenável por tempo e casa com `idValido`. */
export function novoId(agora: number = Date.now()): string {
  const tempo = agora.toString(36);
  const aleatorio = Array.from(crypto.getRandomValues(new Uint8Array(6)))
    .map((b) => b.toString(36).padStart(2, "0"))
    .join("");
  return `${tempo}${aleatorio}`.slice(0, 24);
}

export async function criarSessao(): Promise<Sessao> {
  const id = novoId();
  const sessao: Sessao = {
    id,
    iniciada_em: new Date().toISOString(),
    duracao_s: 0,
    status: "gravando",
    audio_key: prefixoSessao(id),
    transcricao_key: chaveTranscricao(id),
    chunks_total: 0,
  };

  await query(
    `CREATE (s:Sessao {
       id: $id, iniciada_em: $iniciada_em, duracao_s: $duracao_s, status: $status,
       audio_key: $audio_key, transcricao_key: $transcricao_key, chunks_total: $chunks_total
     })`,
    sessao as unknown as Record<string, unknown>,
  );

  return sessao;
}

export async function buscarSessao(id: string): Promise<Sessao | null> {
  const r = await queryUm<{ sessao: Sessao }>(
    `MATCH (s:Sessao { id: $id }) RETURN s { .* } AS sessao`,
    { id },
  );
  return r?.sessao ?? null;
}

interface Atualizacao {
  status?: StatusSessao;
  duracao_s?: number;
  chunks_total?: number;
}

/**
 * Atualiza a sessão só se o status atual estiver em `sePartirDe`.
 * É a guarda de idempotência das rotas: um segundo `finalizar` não
 * rebaixa uma sessão já `transcrito`.
 */
export async function atualizarSessao(
  id: string,
  mudanca: Atualizacao,
  sePartirDe?: StatusSessao[],
): Promise<Sessao | null> {
  const guarda = sePartirDe ? `AND s.status IN $de` : "";
  const r = await queryUm<{ sessao: Sessao }>(
    `MATCH (s:Sessao { id: $id })
     WHERE true ${guarda}
     SET s += $mudanca
     RETURN s { .* } AS sessao`,
    { id, mudanca, de: sePartirDe ?? [] },
  );
  return r?.sessao ?? null;
}

/** Sessões não finalizadas, para o chip de recuperação da home. */
export async function sessoesAbertas(): Promise<Sessao[]> {
  // A lista vem de `estados.ts`: escrita à mão aqui, divergiria da predicada
  // na primeira vez que um estado novo aparecesse — foi o que a slice 2 quase
  // fez com `em_revisao`.
  const r = await query<{ sessao: Sessao }>(
    `MATCH (s:Sessao)
     WHERE s.status IN $abertos
     RETURN s { .* } AS sessao
     ORDER BY s.iniciada_em DESC
     LIMIT 10`,
    { abertos: STATUS_ABERTOS },
  );
  return r.map((l) => l.sessao);
}
