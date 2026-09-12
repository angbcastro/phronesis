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
  tudoTranscrito,
} from "./manifest";
import { ehLimiteDeTaxa } from "./limite";
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

  // O bloco vazio é legítimo (silêncio, `stt.ts`) e por isso não interrompe
  // nada — mas é também com o que um tropeço do provedor se pareceria, e aí
  // seriam 30 s de fala sumindo calados. A linha existe para essa segunda
  // hipótese: sessão com texto faltando se confere aqui, contra o áudio.
  if (texto.trim() === "") {
    console.warn(`[pipeline] sessão ${sessao_id} bloco ${i}: STT não ouviu fala — bloco vazio`);
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
  { ate, fechando = false }: { ate?: number; fechando?: boolean } = {},
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
      return;
    }

    const parcial = await carregarParcial(sessao_id);
    if (estadoDaJanela(parcial, j.n)?.estado === "pronta") continue;

    // Outro `waitUntil` já está nela. Parar, e não pular: ver acima.
    if (!(await reivindicarJanela(sessao_id, j))) return;

    try {
      const blocos = await blocosProntos(sessao_id, indicesDa(j));
      const trecho = concatenar(sessao_id, blocos);

      // O grafo lido uma vez por janela, e usado duas: aqui, para montar o
      // dossiê, e dentro de `extrairJanela`, para a resolução. Sem tratamento
      // próprio de propósito — o catálogo já era condição da resolução antes
      // desta fatia, e uma janela que não consegue lê-lo falha e é retentada,
      // como sempre foi. O que degrada em silêncio é a busca **dentro** dele
      // (`candidatasDaJanela`), não a leitura.
      const catalogo = await listarEntidades();
      const dossie = await montarDossie(sessao_id, j, parcial.atomos, catalogo, fechando);

      const r = await extrairJanela(trecho, {
        jaPropostos: parcial.atomos,
        unica,
        ate,
        dossie,
        catalogo,
      });

      await atualizarParcial(sessao_id, (p) => aplicarJanela(p, j, r, new Date()));
      console.log(
        `[janela] sessão ${sessao_id} janela ${j.n} (blocos ${j.de}-${j.ate}): ` +
          `+${r.novos.length} átomo(s), ${r.estende.length} estendido(s), ` +
          `dossiê de ${dossie.length} entidade(s)`,
      );
    } catch (e) {
      const motivo = e instanceof Error ? e.message : String(e);
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
      blocos: await candidatasDaJanela(sessao_id, indicesDa(j), {
        catalogo,
        refazerDegradado: fechando,
      }),
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
    // Áudio intacto, retry manual.
    await atualizarSessao(sessao_id, { status: "erro" }, DE_ONDE_SE_CAI_EM_ERRO);
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
    await atualizarSessao(sessao_id, { status: "erro" }, DE_ONDE_SE_CAI_EM_ERRO);
    return { status: "erro" };
  }

  await atualizarSessao(sessao_id, { status: "extraindo" }, ["transcrito", "extraindo", "erro"]);

  try {
    // Forçar recalibra o caminho que **roda de verdade**, e não um paralelo:
    // zera o acumulado e refaz janela por janela. Sem isso, calibrar o prompt
    // exercitaria o passe único enquanto a gravação usa as janelas.
    if (forcar) await zerarParcial(sessao_id);

    await avancarJanelas(sessao_id, {
      fechando: true,
      ate: Date.now() + ORCAMENTO_JANELAS_MS,
    });

    const extracao = await propostaDaSessao(sessao_id, transcricao.valor);

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
 * A proposta da sessão: a lista que as janelas acumularam, ou o passe único.
 *
 * O fallback é o seguro desta fatia. Janela que não fechou — modelo fora,
 * limite de taxa que não cedeu, resposta sem JSON duas vezes — não pode custar
 * a sessão: o passe único é o caminho de antes da 4.8, com o mesmo prompt e o
 * mesmo parser, e no pior caso a espera volta a ser a de antes.
 */
async function propostaDaSessao(sessao_id: string, transcricao: Transcricao): Promise<Extracao> {
  const m = await carregarManifest(sessao_id);
  const janelas = janelasDe(m, { fechando: true });
  const parcial = await carregarParcial(sessao_id);

  if (todasProntas(parcial, janelas)) {
    return montarExtracao(parcial, transcricao, await listarEntidades());
  }

  // Sem janela nenhuma não há o que ter falhado: é o manifest vazio, e o passe
  // único é o caminho certo, não o de recuperação. Só o outro caso é erro.
  if (janelas.length > 0) {
    const faltando = janelas
      .filter((j) => estadoDaJanela(parcial, j.n)?.estado !== "pronta")
      .map((j) => j.n);
    console.error(
      `[janela] sessão ${sessao_id}: janela(s) ${faltando.join(", ")} não fecharam; ` +
        `extraindo a sessão inteira num passe só. O motivo de cada uma está em ` +
        `parcial.json e nas linhas [janela] acima.`,
    );
  }
  return extrair(transcricao);
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
