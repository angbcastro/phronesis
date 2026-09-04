/**
 * Onde as correções vivem: o R2, e só o R2.
 *
 * **Por que não o grafo.** A regra 2 já bastaria, e não vale uma migration para
 * isto. Mas o motivo forte é outro: o grafo é o que eu vivi; correção é o que o
 * pipeline errou. Um `:Atomo` dizendo "o modelo escreveu FATO onde era OPINIAO"
 * apareceria numa busca por "o que eu aprendi" e apodreceria a coisa que o
 * sistema existe para fazer.
 *
 * Dois objetos, com papéis diferentes:
 *
 *   sessoes/<id>/correcoes.json   o registro permanente daquela revisão — uma
 *                                 fotografia do momento da confirmação
 *   calibracao/indice.json        a mesa de trabalho, acumulada e podável, onde
 *                                 `incorporada_em` é autoritativo
 *
 * **Quando roda:** dentro do `waitUntil`, depois de a resposta já ter saído.
 * O que destrava o `router.push("/")` da revisão é a resposta HTTP; pagar idas
 * ao R2 nos 60 s da revisão por material de meta seria pagar no lugar errado.
 * `waitUntil` morto perde as correções daquela sessão, sem recuperação — custo
 * assumido, e o diário não perde nada: os átomos já estão no grafo.
 */
import { chaveCorrecoes, chaveIndiceCalibracao, chaveTranscricao } from "./chaves";
import { apurarCorrecoes, indiceVazio, juntarNoIndice } from "./correcoes";
import { criarLocalizador } from "./offsets";
import { ConflitoR2Error, getJson, putJson } from "./r2";
import type { AtomoConfirmado, EntidadeConfirmada } from "./correcoes";
import type { Correcao, Extracao, Gestos, IndiceCalibracao, Transcricao } from "./tipos";

/** Mesmo teto do manifest: a concorrência aqui é ainda menor que a de lá. */
const TENTATIVAS_INDICE = 6;

export async function carregarIndice(): Promise<IndiceCalibracao> {
  const o = await getJson<IndiceCalibracao>(chaveIndiceCalibracao());
  return o?.valor ?? indiceVazio(new Date().toISOString());
}

/**
 * Read-modify-write condicional por etag, com o laço de espera de
 * `atualizarManifest` — e não uma imitação sem ele.
 *
 * O mutador roda **dentro** de cada tentativa, sobre o que acabou de ser lido.
 * É o que faz duas escritas quase simultâneas se somarem em vez de a segunda
 * apagar a primeira: quem perde a corrida relê o corrente e reaplica.
 */
export async function atualizarIndice(
  mutador: (i: IndiceCalibracao) => IndiceCalibracao,
): Promise<IndiceCalibracao> {
  const key = chaveIndiceCalibracao();

  for (let tentativa = 0; tentativa < TENTATIVAS_INDICE; tentativa++) {
    const atual = await getJson<IndiceCalibracao>(key);
    const base = atual?.valor ?? indiceVazio(new Date().toISOString());
    const novo = mutador(base);

    if (novo === base && atual) return base; // nada mudou

    try {
      await putJson(key, novo, atual?.etag ? { ifMatch: atual.etag } : { ifNoneMatch: "*" });
      return novo;
    } catch (e) {
      if (!(e instanceof ConflitoR2Error)) throw e;
      await new Promise((r) => setTimeout(r, 40 * 2 ** tentativa + Math.random() * 40));
    }
  }
  throw new Error(`Não consegui gravar o índice de calibração após ${TENTATIVAS_INDICE} tentativas`);
}

/**
 * Registra que eu abri `/calibracao` de fato — é o relógio da sugestão (§5 da
 * spec), e olhar já conta, aprovando regra ou não.
 *
 * **Não cria o índice.** Sem índice não há correção em aberto, e sem correção
 * em aberto a sugestão nunca acende: gravar um objeto só para anotar a visita
 * a uma tela vazia seria escrever por escrever.
 */
export async function marcarVisita(agora: string = new Date().toISOString()): Promise<void> {
  const atual = await getJson<IndiceCalibracao>(chaveIndiceCalibracao());
  if (!atual) return;

  await atualizarIndice((i) => ({ ...i, visitado_em: agora }));
}

/**
 * O que o "faltou um" precisa para nascer ancorado.
 *
 * A transcrição só é lida quando há o que casar — o caso comum é não haver
 * nenhum faltante, e uma ida ao R2 por sessão para não usar nada seria
 * desperdício puro. `semAvancar` porque estes trechos não têm ordem entre si:
 * são coisas soltas que eu digitei, não a narrativa da sessão.
 */
async function localizadorDe(
  sessao_id: string,
  gestos: Gestos | null,
): Promise<((texto: string) => { inicio_s: number | null }) | undefined> {
  if (!gestos || gestos.faltantes.length === 0) return undefined;

  const t = await getJson<Transcricao>(chaveTranscricao(sessao_id));
  if (!t) return undefined;

  const localizar = criarLocalizador(t.valor.palavras);
  return (texto: string) => localizar.semAvancar(texto);
}

/**
 * Apura e guarda o que eu corrigi naquela revisão.
 *
 * Nunca toca o Neo4j, nunca bloqueia o confirmar, e uma falha aqui nunca
 * desfaz o que já foi gravado no grafo. Devolve quantas correções nasceram —
 * só para a linha de log de quem chamou.
 */
export async function capturarCorrecoes(entrada: {
  proposta: Extracao;
  confirmados: readonly AtomoConfirmado[];
  entidades: readonly EntidadeConfirmada[];
  gestos: Gestos | null;
  em?: string;
}): Promise<number> {
  const em = entrada.em ?? new Date().toISOString();
  const sessao_id = entrada.proposta.sessao_id;

  const correcoes = apurarCorrecoes({
    proposta: entrada.proposta,
    confirmados: entrada.confirmados,
    entidades: entrada.entidades,
    gestos: entrada.gestos,
    em,
    localizar: await localizadorDe(sessao_id, entrada.gestos),
  });

  await gravarRegistroDaSessao(sessao_id, correcoes, em);
  if (correcoes.length > 0) {
    await atualizarIndice((i) => juntarNoIndice(i, correcoes, em));
  }
  return correcoes.length;
}

/**
 * O registro permanente, com `ifNoneMatch` como toda escrita de uma-vez-só
 * deste sistema: reenviar o confirmar não sobrescreve o que já está lá.
 *
 * Grava mesmo quando não houve correção nenhuma. O objeto vazio é o que
 * distingue "revisei e não corrigi nada" de "o `waitUntil` morreu antes de
 * apurar" — e sem essa distinção não dá para confiar no que o índice não tem.
 */
async function gravarRegistroDaSessao(sessao_id: string, correcoes: Correcao[], em: string) {
  try {
    await putJson(
      chaveCorrecoes(sessao_id),
      { sessao_id, correcoes, em },
      { ifNoneMatch: "*" },
    );
  } catch (e) {
    // Já existe: a revisão foi confirmada uma vez, e aquele registro vale.
    if (!(e instanceof ConflitoR2Error)) throw e;
  }
}
