/**
 * A conversa: o nó `:Conversa` (migration 012), as mensagens no R2, e o agente
 * `titulo-chat` que lhe dá nome (slice 6).
 *
 * **Mesma separação de `:Sessao`**, e pela mesma razão (regra 2 do CLAUDE.md):
 * no Neo4j vai só o que a lista precisa para desenhar uma linha e ordenar; o
 * conteúdo pesado — as mensagens e o rastro de ferramentas de cada resposta —
 * fica em `conversas/<id>/mensagens.json`. Guardar tudo no R2, com um manifesto
 * e nenhum nó novo, foi considerado na entrevista e recusado: listar viraria
 * ler-e-regravar um arquivo em vez de uma query.
 *
 * **Duas ações de sumiço, não uma.** `arquivar` congela (a conversa não aceita
 * mensagem nova, sai da lista principal, continua legível); `apagar` apaga de
 * verdade — o nó e o objeto. Só soft-delete, o padrão de `:Sessao`, foi a
 * primeira proposta e foi recusada: o pedido foi ter as duas. A migration 012
 * explica por que isso não fere a regra 6 — ela fala de átomo, e conversa não é
 * conhecimento.
 *
 * **Este módulo não sabe responder nada.** Quem lê o grafo e escreve a resposta
 * é `chat.ts`; aqui só se guarda o que ele produziu. A única chamada de modelo
 * que mora neste arquivo é a do título, e é por isso que ele é o `modulo` do
 * agente `titulo-chat` no registro de `agentes.ts`.
 */
import { generateText } from "ai";
import { chaveMensagens } from "./chaves";
import { comEsperaDeLimite } from "./limite";
import {
  diagnostico,
  faltouOrcamento,
  garantirGateway,
  modeloTituloChat,
  textoDaResposta,
  veioDoPensamento,
} from "./modelos";
import { query, queryUm } from "./neo4j";
import { ConflitoR2Error, getJson, putJson, remover } from "./r2";
import { efetivo } from "./overrides";
import { novoId } from "./sessoes";
import type { Conversa, Mensagem, MensagensDaConversa } from "./tipos";

/** Quantas conversas a lista traz. Mesma ordem de grandeza de `todasSessoes`. */
export const TETO_CONVERSAS = 100;

/** O teto de um título. Uma linha na lista, e ela é estreita no telefone. */
export const TETO_TITULO = 60;

// ──────────────────────── o nó ────────────────────────

interface LinhaDeConversa {
  id: string;
  titulo: string;
  criado_em: string;
  atualizada_em: string;
  arquivada_em: string | null;
  mensagens_key: string;
}

const daLinha = (l: LinhaDeConversa): Conversa => ({
  id: l.id,
  titulo: typeof l.titulo === "string" ? l.titulo : "",
  criado_em: l.criado_em ?? "",
  atualizada_em: l.atualizada_em ?? "",
  // Campo ausente conta como ativa, na leitura — mesma decisão do `status` na
  // 004 e do `descartada_em` na 008: a defesa vale para o nó que um deploy
  // antigo criar amanhã, não só para os que existem hoje.
  arquivada_em: typeof l.arquivada_em === "string" && l.arquivada_em !== "" ? l.arquivada_em : null,
  // `||` e não `??`: o `coalesce` da consulta já devolve string vazia no lugar
  // de `null`, e é a vazia que significa "este nó não tem a propriedade" — um
  // nó que um deploy antigo criasse sem ela continuaria alcançável.
  mensagens_key: l.mensagens_key || chaveMensagens(l.id),
});

const CAMPOS = `c.id AS id, coalesce(c.titulo, '') AS titulo,
            coalesce(c.criado_em, '') AS criado_em,
            coalesce(c.atualizada_em, '') AS atualizada_em,
            c.arquivada_em AS arquivada_em,
            coalesce(c.mensagens_key, '') AS mensagens_key`;

export async function criarConversa(agora: Date = new Date()): Promise<Conversa> {
  const id = novoId(agora.getTime());
  const em = agora.toISOString();
  const conversa: Conversa = {
    id,
    titulo: "",
    criado_em: em,
    atualizada_em: em,
    arquivada_em: null,
    mensagens_key: chaveMensagens(id),
  };

  await query(
    `CREATE (c:Conversa {
       id: $id, titulo: $titulo, criado_em: $criado_em,
       atualizada_em: $atualizada_em, mensagens_key: $mensagens_key
     })`,
    {
      id,
      titulo: "",
      criado_em: em,
      atualizada_em: em,
      mensagens_key: conversa.mensagens_key,
    },
  );

  // `arquivada_em` não é escrito: ausente é o estado "ativa", e gravar `null`
  // seria a mesma coisa com uma propriedade a mais para toda leitura tratar.
  return conversa;
}

export async function buscarConversa(id: string): Promise<Conversa | null> {
  const r = await queryUm<LinhaDeConversa>(
    `MATCH (c:Conversa { id: $id }) RETURN ${CAMPOS}`,
    { id },
  );
  return r ? daLinha(r) : null;
}

/**
 * As conversas, da mais recentemente tocada para a mais antiga.
 *
 * As duas listas numa consulta só — ativas e arquivadas —, e a separação é de
 * quem desenha: o painel mostra as ativas e põe as arquivadas atrás de um
 * separador. Duas consultas pagariam duas varreduras pelo mesmo grafo de uma
 * pessoa só.
 */
export async function listarConversas(limite = TETO_CONVERSAS): Promise<Conversa[]> {
  const linhas = await query<LinhaDeConversa>(
    `MATCH (c:Conversa)
     RETURN ${CAMPOS}
     ORDER BY coalesce(c.atualizada_em, '') DESC
     LIMIT $limite`,
    { limite },
  );
  return linhas.map(daLinha);
}

/** Congela (ou descongela) uma conversa. `null` quando ela não existe. */
export async function arquivarConversa(
  id: string,
  arquivar: boolean,
  agora: Date = new Date(),
): Promise<Conversa | null> {
  const r = await queryUm<LinhaDeConversa>(
    arquivar
      ? `MATCH (c:Conversa { id: $id }) SET c.arquivada_em = $em RETURN ${CAMPOS}`
      : `MATCH (c:Conversa { id: $id }) REMOVE c.arquivada_em RETURN ${CAMPOS}`,
    { id, em: agora.toISOString() },
  );
  return r ? daLinha(r) : null;
}

/**
 * Apaga de vez: o nó e o objeto de mensagens.
 *
 * **O R2 primeiro, o grafo depois.** Se o R2 falhar, o nó continua lá e o botão
 * tenta de novo; na ordem inversa, uma falha no meio deixaria um objeto órfão
 * que ninguém mais alcança — `r2.ts` não tem `LIST`, e a chave só existia no nó
 * que acabou de sumir. É a mesma razão de `chavesDaSessao` pôr o manifest por
 * último.
 *
 * `false` quando a conversa não estava lá. Idempotente: apagar duas vezes é
 * apagar uma (`remover` trata 404 como sucesso).
 */
export async function apagarConversa(id: string): Promise<boolean> {
  const conversa = await buscarConversa(id);
  if (!conversa) return false;

  await remover(conversa.mensagens_key);
  await query(`MATCH (c:Conversa { id: $id }) DETACH DELETE c`, { id });
  return true;
}

// ──────────────────────── as mensagens, no R2 ────────────────────────

export interface MensagensLidas {
  mensagens: Mensagem[];
  /** Para o read-modify-write de `acrescentarMensagens`. */
  etag: string | null;
}

/** As mensagens de uma conversa. Objeto ausente é conversa nova, não erro. */
export async function lerMensagens(id: string): Promise<MensagensLidas> {
  const o = await getJson<MensagensDaConversa>(chaveMensagens(id));
  const lista = o?.valor?.mensagens;
  return { mensagens: Array.isArray(lista) ? lista : [], etag: o?.etag ?? null };
}

/**
 * Acrescenta mensagens ao fim e sobe `atualizada_em` do nó.
 *
 * **Read-modify-write por etag**, como o manifest: eu sou um usuário só, mas
 * uma resposta que demora e um "nova pergunta" apressado são duas escritas
 * concorrentes de verdade — e a segunda não pode apagar a primeira.
 * `ConflitoR2Error` relê e reaplica uma vez; duas vezes seguidas é problema de
 * verdade e sobe.
 *
 * O `atualizada_em` sobe **depois** do R2: a lista ordenar por uma escrita que
 * não aconteceu seria mentir na única tela onde a conversa é encontrada.
 */
export async function acrescentarMensagens(
  id: string,
  novas: readonly Mensagem[],
  agora: Date = new Date(),
): Promise<Mensagem[]> {
  if (novas.length === 0) return (await lerMensagens(id)).mensagens;

  let todas: Mensagem[] = [];
  for (let tentativa = 0; ; tentativa++) {
    const { mensagens, etag } = await lerMensagens(id);
    todas = [...mensagens, ...novas];
    const corpo: MensagensDaConversa = { conversa_id: id, mensagens: todas };
    try {
      await putJson(chaveMensagens(id), corpo, etag ? { ifMatch: etag } : { ifNoneMatch: "*" });
      break;
    } catch (e) {
      if (!(e instanceof ConflitoR2Error) || tentativa >= 1) throw e;
      console.warn(`[conversas] ${id}: outra escrita chegou antes; relendo e reaplicando.`);
    }
  }

  await query(`MATCH (c:Conversa { id: $id }) SET c.atualizada_em = $em`, {
    id,
    em: agora.toISOString(),
  });

  return todas;
}

// ──────────────────────── o agente `titulo-chat` ────────────────────────

/** Muda sempre que o prompt mudar — mesma disciplina de todo agente (regra 7). */
export const PROMPT_VERSION_TITULO = "titulo-chat-1";

export const INSTRUCOES_TITULO = `Você dá nome a uma conversa sobre um diário pessoal, a partir da primeira pergunta e da primeira resposta.

O título é para eu reconhecer a conversa numa lista, semanas depois. Ele é o assunto, não um resumo.

REGRAS
No máximo seis palavras.
Em português, sem ponto final, sem aspas, sem emoji.
Sem maiúscula de título: só a primeira letra e os nomes próprios.
Nomeie o assunto concreto, não o gesto de perguntar. "o fim com a Isinha" serve; "pergunta sobre um relacionamento" não.
Use os nomes próprios que aparecerem — eles são o que eu procuro na lista.
Se a conversa não tem assunto claro, descreva o que foi perguntado, ainda em seis palavras.

FORMATO
Responda somente com JSON, sem texto antes ou depois:
{"titulo":"..."}`;

export function montarPromptDeTitulo(
  pergunta: string,
  resposta: string,
  base: string = INSTRUCOES_TITULO,
): string {
  return `${base}

PERGUNTA:
${pergunta}

RESPOSTA:
${resposta}`;
}

/** Tolerante como os outros parsers: cerca de markdown, frase antes, lista solta. */
export function parsearTitulo(bruto: string): string {
  const semCerca = bruto.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "");
  const inicio = semCerca.indexOf("{");
  const fim = semCerca.lastIndexOf("}");
  if (inicio === -1 || fim <= inicio) return "";

  let cru: unknown;
  try {
    cru = JSON.parse(semCerca.slice(inicio, fim + 1));
  } catch {
    return "";
  }

  const t = (cru as { titulo?: unknown })?.titulo;
  if (typeof t !== "string") return "";
  // Aspas e ponto final vêm de vez em quando mesmo com a regra escrita; cortar
  // aqui é mais barato que uma segunda chamada.
  return t
    .trim()
    .replace(/^["'“”]+|["'“”.]+$/g, "")
    .slice(0, TETO_TITULO)
    .trim();
}

/**
 * O nome da conversa, numa chamada barata sobre a primeira troca.
 *
 * Título por truncamento da primeira mensagem foi recusado na entrevista: sai
 * sem sentido quando a pergunta é longa ou vaga, e o produto citado como
 * referência (ChatGPT/Claude) gera título por modelo.
 *
 * **String vazia é resultado válido.** Se o modelo falhar, a conversa fica sem
 * título e a lista mostra a primeira pergunta cortada — nada quebra, e ninguém
 * perde uma resposta porque o batismo não saiu.
 */
export async function titularConversa(pergunta: string, resposta: string): Promise<string> {
  garantirGateway();
  const meu = await efetivo("titulo-chat", {
    prompt: INSTRUCOES_TITULO,
    modelo: modeloTituloChat(),
  });

  const r = await comEsperaDeLimite(`titulo-chat ${meu.modelo}`, () =>
    generateText({
      // String de propósito: id em string sai pelo Gateway (regra 8).
      model: meu.modelo,
      prompt: montarPromptDeTitulo(pergunta, resposta, meu.prompt),
      temperature: 0,
      maxOutputTokens: 600,
      maxRetries: 0,
    }),
  );

  if (faltouOrcamento(r)) {
    console.warn(`[titulo-chat] o raciocínio comeu o orçamento; a conversa fica sem título.`, diagnostico(r));
    return "";
  }
  if (veioDoPensamento(r)) {
    console.warn(`[titulo-chat] texto vazio, lendo o JSON do pensamento.`, diagnostico(r));
  }

  return parsearTitulo(textoDaResposta(r));
}

/** Grava o título e devolve o carimbo — a procedência da frase que a lista mostra. */
export async function gravarTitulo(id: string, titulo: string): Promise<void> {
  const limpo = titulo.trim().slice(0, TETO_TITULO);
  if (limpo === "") return;
  await query(`MATCH (c:Conversa { id: $id }) SET c.titulo = $titulo`, { id, titulo: limpo });
}

