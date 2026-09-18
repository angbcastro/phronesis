/**
 * Pipeline de transcrição e extração. Todo passo é idempotente, chaveado por
 * `sessao_id` (+ `chunk_index` quando aplicável) — regra 4.
 *
 * Cada bloco é transcrito assim que sobe, não no fim: quando a gravação
 * para, só falta o último bloco.
 *
 * Desde a slice 4.8 a **extração faz o mesmo**: a cada `JANELA_BLOCOS` blocos
 * transcritos uma janela fecha durante a própria gravação e soma os átomos dela
 * ao acumulado (`janela.ts`). Quando eu paro, sobra a janela do fim, e a
 * proposta é montada a partir do que já estava lá. Ninguém aperta nada entre
 * parar de falar e ter a proposta — só que agora isso custa segundos.
 */
import {
  chaveChunkAudio,
  chaveChunkTranscricao,
  chaveExtracao,
  chaveExtracaoAnterior,
  chaveTranscricao,
} from "./chaves";
import { listarEntidades } from "./entidades";
import type { EntidadeDoGrafo } from "./entidades";
import { extrair, extrairJanela } from "./extracao";
import { candidatasDaJanela, dossieDaJanela, entidadesJaAtribuidas } from "./recuperacao";
import type { Dossie } from "./recuperacao";
import {
  aplicarJanela,
  atualizarParcial,
  carregarParcial,
  estadoDaJanela,
  indicesDa,
  janelasDe,
  LEASE_MS,
  marcarFalha,
  montarExtracao,
  reivindicarJanela,
  todasProntas,
  zerarParcial,
} from "./janela";
import {
  atualizarManifest,
  carregarManifest,
  extensaoDoChunk,
  marcarTranscrito,
  pendentes,
  reivindicarTranscricao,
  soltarBloco,
  tudoTranscrito,
} from "./manifest";
import { ehLimiteDeTaxa } from "./limite";
import { medir, registrarFalha } from "./medidas";
import { ConflitoR2Error, getBytes, getJson, putJson } from "./r2";
import { atualizarSessao, buscarSessao } from "./sessoes";
import { temTranscricao } from "./estados";
import { transcrever } from "./stt";
import { concatenar, prefixoContiguo } from "./transcricao";
import type {
  AtomoProposto,
  Extracao,
  Janela,
  StatusSessao,
  Transcricao,
  TranscricaoBloco,
} from "./tipos";

/**
 * Transcreve um bloco e grava `chunk_NNN.json`.
 *
 * **Duas travas, e elas cobrem momentos diferentes** (regra 4). A existência de
 * `chunk_NNN.json` é a de sempre: bloco pronto não é retranscrito nem
 * sobrescrito. Ela só vale **depois** de o STT voltar, e entre o pedido e a
 * resposta havia uma janela de dezenas de segundos em que dois workers podiam
 * mandar o mesmo áudio — o `waitUntil` de `/chunks/:i/pronto` e o laço de espera
 * de `finalizarSessao`, que chega segundos depois do último `/pronto`. A segunda
 * trava, da slice 8, fecha essa janela: `transcrevendo_em` no manifest,
 * espelhando `reivindicarJanela`.
 *
 * **`null` = outro worker está neste bloco.** Não é falha: é a resposta certa, e
 * quem chama simplesmente segue — o laço de `finalizarSessao` relê o manifest na
 * volta seguinte e vê o bloco já transcrito.
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
): Promise<TranscricaoBloco | null> {
  const keyTranscricao = chaveChunkTranscricao(sessao_id, i);

  const pronto = await getJson<TranscricaoBloco>(keyTranscricao);
  if (pronto) {
    await atualizarManifest(sessao_id, (m) => marcarTranscrito(m, i));
    return pronto.valor;
  }

  // A reivindicação vai **antes** de buscar o áudio: os bytes de 30 s são a
  // parte cara do que se desperdiçaria ao descobrir o dono depois.
  if (!(await reivindicarTranscricao(sessao_id, i))) {
    console.log(`[stt] sessão ${sessao_id} bloco ${i}: já tem dono, deixando com ele`);
    return null;
  }

  try {
    return await comAudio(sessao_id, i, keyTranscricao, ate);
  } catch (e) {
    // Solta o lease antes de subir: o próximo a passar tenta na hora, em vez de
    // esperar dois minutos por um trabalho que já acabou — mal.
    await atualizarManifest(sessao_id, (m) => soltarBloco(m, i)).catch(() => {});
    throw e;
  }
}

async function comAudio(
  sessao_id: string,
  i: number,
  keyTranscricao: string,
  ate: number | undefined,
): Promise<TranscricaoBloco> {
  // A extensão sai do manifest: bloco gravado é `.webm`, arquivo importado
  // guarda o formato de origem. Chutar `.webm` mataria toda sessão importada.
  const manifest = await carregarManifest(sessao_id);
  const key = chaveChunkAudio(sessao_id, i, extensaoDoChunk(manifest, i));

  const audio = await getBytes(key);
  if (!audio) throw new Error(`Bloco ${i} da sessão ${sessao_id} não está no R2 (${key})`);

  // O passo `stt` é o trabalho de **um bloco**, e a volta pelo objeto pronto
  // acima fica de fora de propósito: ela não custa STT nenhum, e contá-la
  // faria a média por bloco cair sozinha a cada retry (`medidas.ts`).
  const { texto, palavras, modelo, granularidade } = await medir("stt", () =>
    transcrever(audio, { ate }),
  );

  // O bloco vazio é legítimo (silêncio, `stt.ts`) e por isso não interrompe
  // nada — mas é também com o que um tropeço do provedor se pareceria, e aí
  // seriam 30 s de fala sumindo calados. A linha existe para essa segunda
  // hipótese: sessão com texto faltando se confere aqui, contra o áudio.
  if (texto.trim() === "") {
    console.warn(`[pipeline] sessão ${sessao_id} bloco ${i}: STT não ouviu fala — bloco vazio`);
    // Registrado como falha de código `vazio`, e não como erro: o bloco mudo é
    // legítimo (§5.4). O que a linha responde é "esta sessão teve buraco?", que
    // é a pergunta que o log sozinho só responde a quem foi procurar.
    registrarFalha("stt", `bloco ${i} sem fala`, "vazio");
  }

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
 * Fecha as janelas que os blocos já transcritos permitem fechar.
 *
 * Chamada de dois lugares, e a diferença entre eles é o prazo:
 *
 *   `/chunks/:i/pronto`  depois de transcrever o bloco, **sem prazo** — a
 *                        gravação continua, e esperar o rate limit ali é de
 *                        graça (§5.3)
 *   `extrairSessao`      com `fechando: true` e um orçamento, para a janela do
 *                        fim, que divide o `waitUntil` com o resto do finalizar
 *
 * **Em ordem, e parando na primeira janela que não fechar.** A janela `n`
 * recebe no prompt o que a `n-1` propôs — é assim que ela estende um átomo em
 * vez de duplicá-lo, e é o que segura o volume da lista sem passada de costura.
 * Pular uma janela quebraria essa corrente em silêncio.
 *
 * **Desde a 4.9 ela monta o dossiê antes de extrair** (§4.14): as candidatas dos
 * blocos daquela janela, calculando as que faltarem — catch-up idempotente,
 * dentro do `ate` que ela já recebe. `fechando` é o que autoriza refazer o bloco
 * cuja camada semântica caiu, e é por isso que esse conserto acontece uma vez, no
 * `/finalizar`, e não a cada passada.
 */
export async function avancarJanelas(
  sessao_id: string,
  {
    ate,
    fechando = false,
    catalogo = catalogoUmaVez(),
  }: { ate?: number; fechando?: boolean; catalogo?: LeitorDoCatalogo } = {},
): Promise<void> {
  const m = await carregarManifest(sessao_id);
  const lista = janelasDe(m, { fechando });
  if (lista.length === 0) return;

  // Uma janela só, fechando a sessão: é a sessão inteira. Arquivo importado
  // (um bloco), gravação curta demais para fechar janela durante a fala. O
  // prompt então sai sem o bloco de janela, byte a byte igual ao da 4.7.
  const unica = fechando && lista.length === 1;

  for (const j of lista) {
    if (ate !== undefined && Date.now() >= ate) {
      console.error(`[janela] sessão ${sessao_id}: sem orçamento para a janela ${j.n}`);
      registrarFalha("janela", `sem orçamento para a janela ${j.n}`, "orcamento");
      return;
    }

    let parcial = await carregarParcial(sessao_id);
    if (estadoDaJanela(parcial, j.n)?.estado === "pronta") continue;

    if (!(await reivindicarJanela(sessao_id, j))) {
      // Outro `waitUntil` está nela. Durante a gravação, deixar com ele e parar
      // — parar, e não pular, porque a janela `n` precisa do acumulado da `n-1`.
      if (!fechando) return;

      // Fechando é diferente, e é o que a slice 8 conserta. O `/finalizar` chega
      // segundos depois do último `/pronto`, então encontrar um lease vivo aqui
      // é a **condição normal**, não defeito — e desistir dela era o que fazia a
      // proposta cair no passe único de 17 min, em silêncio (§4.18). Agora ela é
      // esperada: quem está nela quase sempre termina em segundos.
      const fim = await esperarQuemEstaNela(sessao_id, j, ate);
      if (fim === "desistiu") return;
      if (fim === "pronta") continue;
      parcial = await carregarParcial(sessao_id);
    }

    try {
      const blocos = await blocosProntos(sessao_id, indicesDa(j));
      const trecho = concatenar(sessao_id, blocos);

      // O grafo lido **uma vez por finalização**, e não uma por janela (slice
      // 8): é um Cypher com quatro `OPTIONAL MATCH` e vários `collect(DISTINCT
      // …)`, e o mesmo retrato serve as janelas que fecham no mesmo `waitUntil`
      // e a montagem da proposta depois delas. Sem tratamento próprio de
      // propósito — o catálogo já era condição da resolução antes desta fatia, e
      // uma janela que não consegue lê-lo falha e é retentada, como sempre foi.
      // O que degrada em silêncio é a busca **dentro** dele
      // (`candidatasDaJanela`), não a leitura.
      const lido = await catalogo();
      const dossie = await montarDossie(sessao_id, j, parcial.atomos, lido, fechando);

      const r = await medir("janela", () =>
        extrairJanela(trecho, {
          jaPropostos: parcial.atomos,
          unica,
          ate,
          dossie,
          catalogo: lido,
        }),
      );

      await atualizarParcial(sessao_id, (p) => aplicarJanela(p, j, r, new Date()));
      console.log(
        `[janela] sessão ${sessao_id} janela ${j.n} (blocos ${j.de}-${j.ate}): ` +
          `+${r.novos.length} átomo(s), ${r.estende.length} estendido(s), ` +
          `dossiê de ${dossie.length} entidade(s)`,
      );
    } catch (e) {
      const motivo = e instanceof Error ? e.message : String(e);
      registrarFalha("janela", e);
      // A marca da falha é o que faz a próxima passada retentar esta janela em
      // vez de esperar o lease vencer. Se nem ela conseguir gravar, o lease
      // ainda cobre — por isso a falha aqui não pode derrubar o log de baixo.
      await atualizarParcial(sessao_id, (p) => marcarFalha(p, j, motivo, new Date())).catch(
        () => {},
      );
      console.error(`[janela] sessão ${sessao_id} janela ${j.n} falhou:`, e);
      return;
    }
  }
}

/**
 * O catálogo do grafo, lido **uma vez** e reusado (slice 8).
 *
 * `listarEntidades()` rodava duas vezes por finalização — uma dentro de cada
 * janela e outra em `propostaDaSessao` — e nada entre as duas escreve entidade:
 * o grafo só muda no confirmar (regra 5). O mesmo retrato serve as duas, e a
 * leitura repetida era latência pura no meio do que esta fatia está encurtando.
 *
 * Um fecho, e não um cache de módulo: o retrato vale para **esta** finalização,
 * e a próxima lê de novo. Falha não é guardada — a próxima janela tenta outra
 * vez, que é o comportamento que o comentário dentro do laço descreve.
 */
export type LeitorDoCatalogo = () => Promise<EntidadeDoGrafo[]>;

export function catalogoUmaVez(): LeitorDoCatalogo {
  let lido: EntidadeDoGrafo[] | null = null;
  return async () => (lido ??= await medir("catalogo", () => listarEntidades()));
}

/** De quanto em quanto tempo se pergunta se quem está na janela terminou. */
const INTERVALO_LEASE_MS = 700;

/**
 * Espera quem reivindicou a janela terminar — e assume se ele não terminar.
 *
 * Três saídas: `pronta` (ele fechou, sigo para a próxima janela), `minha` (o
 * lease venceu e eu assumi) e `desistiu` (acabou o orçamento). O prazo, quando
 * quem chama não passa nenhum, é o do próprio lease: depois dele não há mais o
 * que esperar, porque quem estava nela está morto.
 */
async function esperarQuemEstaNela(
  sessao_id: string,
  j: Janela,
  ate?: number,
): Promise<"pronta" | "minha" | "desistiu"> {
  const prazo = ate ?? Date.now() + LEASE_MS;
  console.log(`[janela] sessão ${sessao_id} janela ${j.n}: outro worker está nela, esperando`);

  for (;;) {
    if (Date.now() >= prazo) {
      console.error(`[janela] sessão ${sessao_id}: janela ${j.n} presa até o fim do orçamento`);
      registrarFalha(
        "janela",
        `a janela ${j.n} ficou presa até o fim do orçamento`,
        "janela_presa",
      );
      return "desistiu";
    }
    await new Promise((r) => setTimeout(r, INTERVALO_LEASE_MS));

    const estado = estadoDaJanela(await carregarParcial(sessao_id), j.n)?.estado;
    if (estado === "pronta") return "pronta";
    // `falhou` ou lease vencido: a reivindicação é quem decide, e ela já sabe
    // ler as duas coisas (`janela.reivindicar`).
    if (await reivindicarJanela(sessao_id, j)) return "minha";
  }
}

/**
 * O dossiê de uma janela: quem o grafo acha que ela cita (slice 4.9).
 *
 * **Nada aqui pode custar a janela.** Dossiê vazio faz o extrator se comportar
 * exatamente como na 4.8, então qualquer tropeço na busca vira lista vazia com
 * uma linha `[candidatas]` no log — a mesma precedência do vetor (§4.10). O que
 * **não** é engolido é a leitura do catálogo, que já era condição da resolução
 * antes desta fatia e continua sendo de quem chama.
 */
async function montarDossie(
  sessao_id: string,
  j: Janela,
  jaPropostos: readonly AtomoProposto[],
  catalogo: EntidadeDoGrafo[],
  fechando: boolean,
): Promise<Dossie> {
  try {
    return dossieDaJanela({
      blocos: await medir("candidatas", () =>
        candidatasDaJanela(sessao_id, indicesDa(j), {
          catalogo,
          refazerDegradado: fechando,
        }),
      ),
      jaAtribuidas: entidadesJaAtribuidas(jaPropostos),
      catalogo,
    });
  } catch (e) {
    console.error(`[candidatas] sessão ${sessao_id} janela ${j.n}: sem dossiê:`, e);
    return [];
  }
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

/**
 * De quanto em quanto tempo o laço reconfere o manifest.
 *
 * Era 1 s, e a slice 8 o apertou para 400 ms. O número não é o custo de uma ida
 * ao R2 — é **latência pura** no instante em que eu estou olhando a tela: no
 * caso comum falta um bloco só, ele chega em menos de um segundo, e metade do
 * tempo entre "chegou" e "o laço percebeu" era esta constante. Junto com os
 * outros dois pollings do caminho (a fila do cliente e a tela de processamento)
 * eram ~3,5 s de espera que não era trabalho de ninguém.
 */
const INTERVALO_ESPERA_MS = 400;

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

  // O passo `espera_blocos` é o corredor inteiro, inclusive o que ele passa
  // dormindo: ele responde "quanto do meu tempo foi esperar bloco pendente?",
  // que é a pergunta que decide se o conserto é a fila do cliente ou o STT.
  await medir("espera_blocos", async () => {
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
          registrarFalha("espera_blocos", e);
          console.error(`[pipeline] sessão ${sessao_id} bloco ${c.i} não transcreveu:`, e);
        }
      }
      m = await carregarManifest(sessao_id);
      if (tudoTranscrito(m)) break;
      await new Promise((r) => setTimeout(r, INTERVALO_ESPERA_MS));
    }
  });

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
    registrarFalha(
      "espera_blocos",
      `desistiu com ${faltando.length} bloco(s) faltando: ${faltando.join(", ")}`,
      limitado ? "limite" : "servico",
    );
    // Áudio intacto, retry manual.
    await atualizarSessao(sessao_id, { status: "erro" }, DE_ONDE_SE_CAI_EM_ERRO);
    return { status: "erro", faltando };
  }

  const transcricao = await medir("concatenar", async () => {
    const blocos = await blocosProntos(sessao_id, m.chunks.map((c) => c.i));
    const t = concatenar(sessao_id, blocos);
    await putJson(chaveTranscricao(sessao_id), t);
    return t;
  });

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
    await atualizarSessao(sessao_id, { status: "erro" }, DE_ONDE_SE_CAI_EM_ERRO);
    return { status: "erro" };
  }

  await atualizarSessao(sessao_id, { status: "extraindo" }, ["transcrito", "extraindo", "erro"]);

  try {
    // Forçar recalibra o caminho que **roda de verdade**, e não um paralelo:
    // zera o acumulado e refaz janela por janela. Sem isso, calibrar o prompt
    // exercitaria o passe único enquanto a gravação usa as janelas.
    if (forcar) await zerarParcial(sessao_id);

    // Um retrato do grafo para a finalização inteira: as janelas que faltam
    // fechar e a montagem da proposta depois delas (slice 8).
    const catalogo = catalogoUmaVez();

    await avancarJanelas(sessao_id, {
      fechando: true,
      ate: Date.now() + ORCAMENTO_JANELAS_MS,
      catalogo,
    });

    const extracao = await medir("proposta", () =>
      propostaDaSessao(sessao_id, transcricao.valor, catalogo),
    );

    // A que está lá agora, lida antes de o PUT passar por cima dela. Só no
    // forçado: no caminho automático não existe proposta anterior nenhuma.
    const substituida = forcar ? await getJson<Extracao>(key) : null;

    // Forçado sobrescreve: é o modo de calibrar o prompt contra uma sessão já
    // gravada. Sem `ifNoneMatch` não há corrida a perder — quem forçou quer
    // exatamente a proposta nova no lugar da antiga.
    await putJson(key, extracao, forcar ? {} : { ifNoneMatch: "*" });

    // A cópia vai **depois**, e a ordem é deliberada: o PUT que importa é o da
    // proposta nova, que é o que eu pedi. Perder a cópia custa a comparação
    // lado a lado daquela sessão; perder a proposta custaria a re-extração.
    if (substituida) await guardarAnterior(sessao_id, substituida.valor);
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
    registrarFalha("proposta", e, e instanceof JanelaPresaError ? "janela_presa" : undefined);
    // Transcrição intacta, retry manual.
    await atualizarSessao(sessao_id, { status: "erro" }, DE_ONDE_SE_CAI_EM_ERRO);
    return { status: "erro" };
  }
}

/**
 * Quanto tempo a finalização dá às janelas que faltam fechar.
 *
 * O teto de cima é o `maxDuration` de 300 s da rota, dos quais até 150 s já
 * podem ter ido nos blocos pendentes (`ESPERA_MAX_MS`). No caminho normal isto
 * cobre uma janela de menos de dois minutos de fala e sobra; o número existe
 * para o caso ruim, em que ele decide **quando desistir e cair no passe único**
 * em vez de o `waitUntil` morrer sem deixar proposta nenhuma.
 */
export const ORCAMENTO_JANELAS_MS = 120_000;

/**
 * Uma janela não fechou, e a sessão não tem proposta por causa disso.
 *
 * Existe para `extrairSessao` distinguir este caso dos outros na hora de
 * classificar a falha — e para quem lê o log saber que o conserto é mandar
 * re-extrair, não investigar o modelo.
 */
export class JanelaPresaError extends Error {
  constructor(readonly janelas: readonly number[]) {
    super(`janela(s) ${janelas.join(", ")} não fecharam`);
    this.name = "JanelaPresaError";
  }
}

/**
 * A proposta da sessão: a lista que as janelas acumularam. **Só isso.**
 *
 * Aqui havia um fallback, e ele era o seguro da 4.8: janela que não fechasse
 * fazia a sessão inteira sair num passe só, com o mesmo prompt e o mesmo parser,
 * e no pior caso a espera voltava a ser a de antes. A slice 8 o removeu, e a
 * razão está no relógio: esse "pior caso" é o caminho de 1–2 min que a 4.8
 * existe para eliminar, e ele acontecia **em silêncio** — nada na tela
 * distinguia uma proposta montada de oito janelas de uma tirada num passe de
 * 17 minutos. Eu pagava sem saber, e é justamente o que esta fatia foi acabar.
 *
 * O gatilho mais comum era nem defeito: um lease de 120 s ainda segurado por um
 * `waitUntil` anterior no instante em que o `/finalizar` rodava. Isso agora é
 * **esperado** em vez de desistido (`esperarQuemEstaNela`), e o que sobra aqui é
 * janela genuinamente presa — modelo fora, limite que não cedeu, orçamento
 * estourado. Isso é defeito, e defeito vai para `erro` com o motivo: eu mando
 * re-extrair, e nunca mais pago um passe único de 17 minutos sem saber.
 *
 * **A troca está declarada**: uma sessão que antes entregaria nove átomos por
 * passe único passa a parar e pedir re-extração. É a troca que eu quis —
 * prefiro saber. O áudio, a transcrição e o acumulado continuam todos no R2.
 */
async function propostaDaSessao(
  sessao_id: string,
  transcricao: Transcricao,
  catalogo: LeitorDoCatalogo,
): Promise<Extracao> {
  const m = await carregarManifest(sessao_id);
  const janelas = janelasDe(m, { fechando: true });
  const parcial = await carregarParcial(sessao_id);

  if (todasProntas(parcial, janelas)) {
    return montarExtracao(parcial, transcricao, await catalogo());
  }

  // Sem janela nenhuma não há o que ter falhado: é o manifest vazio, e o passe
  // único é o caminho certo, não o de recuperação. Só o outro caso é erro.
  if (janelas.length === 0) return extrair(transcricao);

  const faltando = janelas
    .filter((j) => estadoDaJanela(parcial, j.n)?.estado !== "pronta")
    .map((j) => j.n);
  console.error(
    `[janela] sessão ${sessao_id}: janela(s) ${faltando.join(", ")} não fecharam; ` +
      `a sessão vai para 'erro' e espera eu mandar re-extrair. O motivo de cada ` +
      `uma está em parcial.json e nas linhas [janela] acima.`,
  );
  throw new JanelaPresaError(faltando);
}

/**
 * Guarda em `extracao-anterior.json` a proposta que o `forcar` substituiu.
 *
 * É a única defesa contra regressão silenciosa que a slice 4.6 oferece: com uma
 * regra nova em vigor, ver a lista anterior ao lado da nova é o que permite
 * dizer "piorou" olhando, sem inventar métrica de qualidade nenhuma.
 *
 * **Nunca derruba a re-extração**, e guarda só a última tentativa — histórico
 * de propostas seria acumular no R2 o que eu nunca vou reler. Sem condicional
 * no PUT de propósito: a anterior à anterior não interessa mais.
 */
async function guardarAnterior(sessao_id: string, substituida: Extracao): Promise<void> {
  try {
    await putJson(chaveExtracaoAnterior(sessao_id), substituida);
  } catch (e) {
    console.error(`[extracao] sessão ${sessao_id}: não consegui guardar a proposta anterior:`, e);
  }
}

/**
 * De onde se pode cair em `erro`, e é a lista inteira menos `confirmada`.
 *
 * Sem esta guarda, um `/finalizar` numa sessão já confirmada cuja
 * `transcricao.json` tivesse sumido do R2 gravava `erro` por cima de
 * `confirmada` — e `confirmada` é o único estado terminal desta máquina (§5).
 * Os átomos continuariam no grafo, e a sessão apareceria como falha.
 *
 * A guarda vai explícita em cada escrita, e não derivada de `estados.ts`:
 * quem lê a chamada vê o que a impede, sem ir a outro arquivo.
 */
const DE_ONDE_SE_CAI_EM_ERRO: StatusSessao[] = [
  "gravando",
  "finalizando",
  "transcrevendo",
  "transcrito",
  "extraindo",
  "em_revisao",
  "erro",
];

/** `confirmada` não volta para `em_revisao`: a guarda é quem impede. */
const marcarEmRevisao = (sessao_id: string) =>
  atualizarSessao(sessao_id, { status: "em_revisao" }, [
    "transcrito",
    "extraindo",
    "em_revisao",
    "erro",
  ]);
