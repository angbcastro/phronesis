/**
 * A janela: a unidade de extração desde a slice 4.8.
 *
 * Até aqui a extração era um evento — uma chamada só, sobre a transcrição
 * inteira, depois de eu parar de falar. Era ela que fazia a espera entre parar
 * e revisar durar um a dois minutos, contra os "poucos segundos" que a visão §3
 * promete. Agora ela é um processo: a cada `JANELA_BLOCOS` blocos transcritos
 * uma janela fecha **durante a própria gravação**, e o que sobra quando eu paro
 * é só a janela do fim.
 *
 * **Este módulo não fala com modelo nenhum.** A chamada de extração continua
 * morando em `extracao.ts`, e a de resolução em `resolucao.ts` — é o que
 * permite a `tests/agentes.test.ts` continuar cobrando que todo `generateText`
 * do projeto pertence a um agente do registro. Aqui é orquestração: fatiar o
 * manifest, reivindicar a janela, e somar o que ela produziu ao acumulado.
 *
 * O acumulado vive em `sessoes/<id>/parcial.json`, no R2 e não no grafo: nada é
 * gravado antes da minha confirmação na revisão (regra 5).
 */
import { chaveParcial } from "./chaves";
import { PROMPT_VERSION } from "./extracao";
import type { ResultadoDaJanela } from "./extracao";
import { agregarCandidatas } from "./entidades";
import type { EntidadeDoGrafo } from "./entidades";
import { ConflitoR2Error, getJson, putJson } from "./r2";
import { mencoesDe, sobreDe } from "./referencias";
import { prefixoContiguo } from "./transcricao";
import { JANELA_BLOCOS } from "./tipos";
import type {
  AtomoProposto,
  Descarte,
  EstadoJanela,
  Extracao,
  Janela,
  Manifest,
  Parcial,
  Transcricao,
} from "./tipos";

/**
 * Quanto vale a reivindicação de uma janela.
 *
 * Não é o tempo que uma janela leva — é o tempo depois do qual vale mais
 * arriscar uma extração dobrada do que deixar a janela travada para sempre. O
 * `waitUntil` que a reivindicou pode ter morrido (em dev, fechar a janela do
 * servidor basta), e sem prazo a sessão nunca mais fecharia.
 */
export const LEASE_MS = 120_000;

const TENTATIVAS_PARCIAL = 6;

// ---------- puro ----------

export function parcialVazio(sessao_id: string): Parcial {
  return {
    sessao_id,
    janelas: [],
    atomos: [],
    entidades: [],
    descartados: [],
    atualizado_em: new Date(0).toISOString(),
  };
}

/**
 * As janelas que os blocos já transcritos permitem fechar.
 *
 * Sobre o **prefixo contíguo**, e não sobre todos os transcritos: um buraco no
 * meio faria a janela seguinte ler fala fora de ordem, que é o mesmo motivo
 * pelo qual a transcrição parcial só mostra o prefixo (§4.5).
 *
 * `fechando` inclui a janela incompleta do fim — a única que pode ter menos que
 * `JANELA_BLOCOS`. É ela que o `/finalizar` fecha, e é por ela que uma sessão
 * importada (um bloco só) e uma gravação curta passam inteiras numa janela só.
 */
export function janelasDe(m: Manifest, { fechando = false } = {}): Janela[] {
  const total = prefixoContiguo(m.chunks.filter((c) => c.transcrito)).length;
  if (total === 0) return [];

  // O botão de pânico: sem janela, a sessão inteira sai num passe só, como
  // antes desta fatia.
  if (JANELA_BLOCOS <= 0) return fechando ? [{ n: 0, de: 0, ate: total - 1 }] : [];

  const saida: Janela[] = [];
  let n = 0;
  for (; (n + 1) * JANELA_BLOCOS <= total; n++) {
    saida.push({ n, de: n * JANELA_BLOCOS, ate: (n + 1) * JANELA_BLOCOS - 1 });
  }
  if (fechando && n * JANELA_BLOCOS < total) {
    saida.push({ n, de: n * JANELA_BLOCOS, ate: total - 1 });
  }
  return saida;
}

export const indicesDa = (j: Janela): number[] =>
  Array.from({ length: j.ate - j.de + 1 }, (_, k) => j.de + k);

export const estadoDaJanela = (p: Parcial, n: number): EstadoJanela | undefined =>
  p.janelas.find((x) => x.n === n);

/** Todas as janelas que o manifest permite fechar já fecharam? */
export const todasProntas = (p: Parcial, janelas: readonly Janela[]): boolean =>
  janelas.length > 0 && janelas.every((j) => estadoDaJanela(p, j.n)?.estado === "pronta");

/**
 * Marca a janela como reivindicada, se ela estiver livre.
 *
 * Puro de propósito: quem grava é `atualizarParcial`, e o mutador dele é
 * reaplicado a cada conflito de etag. Uma decisão tomada fora dele decidiria
 * sobre um parcial que já não existe mais.
 */
export function reivindicar(p: Parcial, j: Janela, agora: Date): Parcial | null {
  const atual = estadoDaJanela(p, j.n);

  if (atual?.estado === "pronta") return null;
  // A pergunta é "o lease ainda está fresco?", e não "já venceu?". Com um `em`
  // corrompido a conta dá `NaN`, e NaN é falso em qualquer comparação: escrito
  // assim, o erro cai para o lado de reivindicar de novo. Janela extraída duas
  // vezes custa uma chamada; janela travada para sempre custa a sessão.
  if (atual?.estado === "em_curso" && agora.getTime() - Date.parse(atual.em) < LEASE_MS) {
    return null;
  }

  const nova: EstadoJanela = { ...j, estado: "em_curso", em: agora.toISOString() };
  return {
    ...p,
    janelas: [...p.janelas.filter((x) => x.n !== j.n), nova].sort((a, b) => a.n - b.n),
    atualizado_em: nova.em,
  };
}

function comEstado(p: Parcial, estado: EstadoJanela): Parcial {
  return {
    ...p,
    janelas: [...p.janelas.filter((x) => x.n !== estado.n), estado].sort((a, b) => a.n - b.n),
    atualizado_em: estado.em,
  };
}

/**
 * Soma ao acumulado o que a janela produziu.
 *
 * **Os ids são carimbados aqui, e não na extração.** `ancorar` já numerou os
 * átomos a partir do deslocamento que leu, mas entre aquela leitura e esta
 * escrita o parcial pode ter crescido; renumerar contra a lista que está sendo
 * gravada é o que impede dois átomos de nascerem com o mesmo
 * `<sessao_id>-<índice>` — e é esse id que faz o `MERGE` do confirmar ser
 * idempotente (regra 4).
 */
export function aplicarJanela(
  p: Parcial,
  j: Janela,
  r: ResultadoDaJanela,
  agora: Date,
): Parcial {
  const atomos = [...p.atomos];
  const descartados: Descarte[] = [...p.descartados, ...r.descartados];

  // Primeiro as extensões: elas apontam para a lista como o prompt a mostrou,
  // e os átomos novos vão para o fim dela.
  for (const e of r.estende) {
    const alvo = atomos[e.ref];
    if (!alvo) {
      descartados.push({
        motivo: `estende aponta para o átomo ${e.ref}, que não está mais na lista`,
        bruto: e,
      });
      continue;
    }
    atomos[e.ref] = {
      ...alvo,
      texto: e.texto.trim() === "" ? alvo.texto : e.texto,
      trechos: [...alvo.trechos, ...e.trechos],
    };
  }

  const base = atomos.length;
  const novos: AtomoProposto[] = r.novos.map((a, k) => ({
    ...a,
    id: `${p.sessao_id}-${base + k}`,
    indice: base + k,
  }));

  return comEstado(
    {
      ...p,
      atomos: [...atomos, ...novos],
      entidades: [...p.entidades, ...r.entidades],
      descartados,
    },
    {
      ...j,
      estado: "pronta",
      em: agora.toISOString(),
      prompt_version: r.prompt_version,
      modelo: r.modelo,
      prompt_version_resolucao: r.prompt_version_resolucao,
      modelo_resolucao: r.modelo_resolucao,
      // O dossiê que esta janela viu (4.9) — procedência, e a resposta a "por
      // que ele apontou aquele nó" três meses depois. O grafo de hoje não
      // reconstrói a foto de então.
      candidatas: r.candidatas,
    },
  );
}

/** A janela falhou. Fica registrada para ser retentada, com o motivo junto. */
export const marcarFalha = (p: Parcial, j: Janela, motivo: string, agora: Date): Parcial =>
  comEstado(p, { ...j, estado: "falhou", em: agora.toISOString(), motivo });

/** O último valor não vazio, na ordem das janelas. */
function ultimo<T>(p: Parcial, campo: (j: EstadoJanela) => T | null | undefined): T | null {
  for (let i = p.janelas.length - 1; i >= 0; i--) {
    const v = campo(p.janelas[i]);
    if (v !== null && v !== undefined && v !== "") return v;
  }
  return null;
}

/**
 * Do acumulado para a proposta que a revisão lê.
 *
 * A procedência de cada átomo já está **nele** (regra 7), carimbada pela janela
 * que o produziu. O que este cabeçalho carrega é a da última janela que de fato
 * chamou um modelo — a resposta a "com que prompt esta sessão foi extraída",
 * que numa sessão sem regra aprovada nova é a mesma para todas.
 */
export function montarExtracao(
  p: Parcial,
  transcricao: Transcricao,
  catalogo: readonly EntidadeDoGrafo[],
): Extracao {
  const refs = p.atomos.flatMap((a) => [sobreDe(a), ...mencoesDe(a)]);

  return {
    sessao_id: p.sessao_id,
    atomos: p.atomos,
    entidades: agregarCandidatas(refs, catalogo, p.entidades),
    descartados: p.descartados,
    prompt_version: ultimo(p, (j) => j.prompt_version) ?? PROMPT_VERSION,
    modelo: ultimo(p, (j) => j.modelo) ?? "",
    prompt_version_resolucao: ultimo(p, (j) => j.prompt_version_resolucao),
    modelo_resolucao: ultimo(p, (j) => j.modelo_resolucao),
    granularidade: transcricao.granularidade,
    criado_em: new Date().toISOString(),
  };
}

// ---------- com R2 ----------

export async function carregarParcial(sessao_id: string): Promise<Parcial> {
  const o = await getJson<Parcial>(chaveParcial(sessao_id));
  return o?.valor ?? parcialVazio(sessao_id);
}

/**
 * Aplica `mutador` ao parcial e grava condicionalmente. Em conflito — outra
 * janela gravou antes —, relê e reaplica; o mutador precisa ser puro.
 *
 * É o mesmo desenho de `manifest.atualizarManifest`, e é a terceira cópia dele
 * no projeto (manifest, índice de calibração, aqui). Extrair um helper para
 * `r2.ts` é refatoração fora do escopo desta fatia.
 */
export async function atualizarParcial(
  sessao_id: string,
  mutador: (p: Parcial) => Parcial | null,
): Promise<{ parcial: Parcial; mudou: boolean }> {
  const key = chaveParcial(sessao_id);

  for (let tentativa = 0; tentativa < TENTATIVAS_PARCIAL; tentativa++) {
    const atual = await getJson<Parcial>(key);
    const base = atual?.valor ?? parcialVazio(sessao_id);
    const novo = mutador(base);

    if (novo === null || novo === base) return { parcial: base, mudou: false };

    try {
      await putJson(key, novo, atual?.etag ? { ifMatch: atual.etag } : { ifNoneMatch: "*" });
      return { parcial: novo, mudou: true };
    } catch (e) {
      if (!(e instanceof ConflitoR2Error)) throw e;
      await new Promise((r) => setTimeout(r, 40 * 2 ** tentativa + Math.random() * 40));
    }
  }
  throw new Error(`Não consegui gravar o parcial de ${sessao_id} após ${TENTATIVAS_PARCIAL} tentativas`);
}

/**
 * Reivindica a janela. `true` = ela é minha e ninguém mais está nela.
 *
 * É a trava que impede dois `waitUntil` de extraírem — e pagarem — a mesma
 * janela. Ela não substitui a ordem: `avancarJanelas` para na primeira janela
 * que não conseguir, porque a janela `n` precisa do acumulado da `n-1`.
 */
export async function reivindicarJanela(
  sessao_id: string,
  j: Janela,
  agora: Date = new Date(),
): Promise<boolean> {
  const { mudou } = await atualizarParcial(sessao_id, (p) => reivindicar(p, j, agora));
  return mudou;
}

/** Zera o acumulado — só o `forcar` da re-extração passa por aqui. */
export const zerarParcial = (sessao_id: string): Promise<unknown> =>
  putJson(chaveParcial(sessao_id), parcialVazio(sessao_id));
