/**
 * O que eu corrigi na revisão, apurado do jeito que dá para conferir: uma
 * função pura entre a proposta e o que foi aprovado.
 *
 * **Por que no servidor, e não na tela.** Os dois lados de toda correção de
 * átomo já estão aqui: `extracao.json` guarda a proposta indexada por índice, e
 * o corpo do confirmar traz o valor final. Duplicar o diff no cliente faria as
 * duas implementações divergirem, com a da tela vencendo calada — o mesmo
 * argumento que pôs `referencias.ts` num módulo só.
 *
 * **O que a tela precisa mandar** é o que o valor não conta (`Gestos`): recusar
 * uma entidade de propósito não se distingue de não usá-la por acaso; o par
 * original→final de um renome se perde porque o POST manda só o final; e tocar
 * um campo não se distingue da canonização, em que a grafia do grafo vence sem
 * eu ter feito nada. Corpo sem `gestos` continua confirmando: o que dá para
 * inferir por valor é inferido, e sai marcado `tocado: false`.
 *
 * **Duas travas contra correção-fantasma de canonização**, nesta ordem:
 * (1) nome final igual ao proposto por normalização nunca é correção — mata
 * caixa e acento de graça; (2) chave diferente sem o campo em `gestos` é
 * provável travessia de alias, registrada mesmo assim, mas como inferida.
 *
 * Módulo puro: não fala com R2, grafo nem modelo. Quem persiste é
 * `calibracao.ts`; quem chama é o `waitUntil` do confirmar, **depois** de o
 * grafo já ter recebido os átomos.
 */
import { mencoesDe, sobreDe } from "./referencias";
import { ehPronome, normalizarNome } from "./texto";
import { CAMPOS_GESTO, GESTOS_VAZIOS, TETO_CORRECOES } from "./tipos";
import type {
  AgenteCorrecao,
  AtomoProposto,
  CampoGesto,
  Correcao,
  Extracao,
  Gestos,
  IndiceCalibracao,
  ReferenciaResolvida,
  TipoAtomo,
  TipoCorrecao,
  TipoEntidade,
} from "./tipos";

// ─────────────────────────────── as chaves ───────────────────────────────

/**
 * A chave **não** é sempre `${atomo_id}|${tipo}`: três tipos não têm átomo, e
 * com um id fixo por tipo os três colapsariam num registro só — uma correção
 * nova apagando a anterior em silêncio, o oposto de "as correções se acumulam".
 */
export const chaveDeAtomo = (atomo_id: string, tipo: TipoCorrecao) => `${atomo_id}|${tipo}`;

export const chaveDeEntidade = (sessao_id: string, tipo: TipoCorrecao, entidade: string) =>
  `${sessao_id}|${tipo}|${normalizarNome(entidade)}`;

export const chaveDeFaltou = (sessao_id: string, texto: string) =>
  `${sessao_id}|faltou|${normalizarNome(texto).slice(0, 40)}`;

// ────────────────────────────── os gestos ──────────────────────────────

/**
 * Lê `gestos` do corpo sem confiar em nada. Ausente devolve `null`, e a
 * apuração cai no que dá para inferir por valor — nenhum 400 novo nasce daqui.
 */
export function normalizarGestos(bruto: unknown): Gestos | null {
  if (!bruto || typeof bruto !== "object") return null;
  const g = bruto as Record<string, unknown>;

  const listaDeTexto = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : [];

  const atomos = Array.isArray(g.atomos)
    ? g.atomos.flatMap((a) => {
        const item = a as { indice?: unknown; campos?: unknown };
        if (!Number.isInteger(item?.indice)) return [];
        const campos = (Array.isArray(item.campos) ? item.campos : []).filter(
          (c): c is CampoGesto => (CAMPOS_GESTO as readonly unknown[]).includes(c),
        );
        return [{ indice: item.indice as number, campos }];
      })
    : [];

  const renomes = Array.isArray(g.renomes)
    ? g.renomes.flatMap((r) => {
        const item = r as { de?: unknown; para?: unknown };
        const de = typeof item?.de === "string" ? item.de.trim() : "";
        const para = typeof item?.para === "string" ? item.para.trim() : "";
        return de === "" || para === "" ? [] : [{ de, para }];
      })
    : [];

  const faltantes = Array.isArray(g.faltantes)
    ? g.faltantes.flatMap((f) => {
        const bruto = (f as { texto?: unknown })?.texto;
        const texto = typeof bruto === "string" ? bruto.trim() : "";
        return texto === "" ? [] : [{ texto }];
      })
    : [];

  return {
    atomos,
    entidades_recusadas: listaDeTexto(g.entidades_recusadas),
    renomes,
    faltantes,
  };
}

// ───────────────────────────── a apuração ─────────────────────────────

/** Um átomo como ele ficou depois da revisão, com os nomes **finais**. */
export interface AtomoConfirmado {
  indice: number;
  texto: string;
  tipo: TipoAtomo;
  /** Nome final do sujeito — o do rodapé, já canonizado. */
  sobre: string;
  /** Nomes finais das menções que de fato foram gravadas. */
  menciona: string[];
}

/** Uma entidade como ela entrou no grafo. */
export interface EntidadeConfirmada {
  nome: string;
  nome_normalizado: string;
  tipo: TipoEntidade;
}

export interface EntradaApuracao {
  proposta: Extracao;
  confirmados: readonly AtomoConfirmado[];
  entidades: readonly EntidadeConfirmada[];
  gestos: Gestos | null;
  /** ISO do momento da confirmação. */
  em: string;
  /**
   * Casa o texto do "faltou um" com as palavras da transcrição.
   *
   * Roda aqui e não na tela por um motivo mecânico: `GET /extracao` manda
   * `blocos`, nunca `palavras`, então o navegador não tem contra o que casar.
   * Ausente, a correção vale como texto e nasce sem âncora.
   */
  localizar?: (texto: string) => { inicio_s: number | null };
}

/**
 * De quem é a culpa quando eu corrijo sujeito ou menção.
 *
 * O sinal é **por átomo**, não por sessão: `resolucao.ts` roda a camada
 * determinística para toda menção, e `prompt_version_resolucao` só marca se
 * alguma teve que ir ao modelo — então uma sessão sem ambiguidade nenhuma
 * (comum com o grafo pequeno) pode ter batido no nó errado por acaso.
 *
 * `conhecida: true` é a resolução decidindo entre nós que existem;
 * `conhecida: false` é candidata nova, mais perto de "o extrator escreveu algo
 * que não bate com nada".
 */
const agenteDaReferencia = (ref: ReferenciaResolvida): AgenteCorrecao =>
  ref.conhecida ? "resolucao" : "extracao";

/**
 * As correções de uma revisão. Não grava nada, não faz rede — é a função que o
 * teste consegue apertar inteira.
 */
export function apurarCorrecoes(entrada: EntradaApuracao): Correcao[] {
  const { proposta, confirmados, entidades, em, localizar } = entrada;
  const g = entrada.gestos ?? GESTOS_VAZIOS;
  const sessao_id = proposta.sessao_id;

  const conhecidas = new Set(
    proposta.entidades.filter((e) => e.conhecida).map((e) => e.nome_normalizado),
  );
  const porIndice = new Map(confirmados.map((c) => [c.indice, c]));
  const tocadosDe = new Map(g.atomos.map((a) => [a.indice, new Set<CampoGesto>(a.campos)]));

  /**
   * Um renome no rodapé já muda o `sobre`/`menciona` resolvido de todo átomo
   * que cita aquela entidade, e uma entidade desmarcada some das menções de
   * todos eles. As duas saem do conjunto avaliado antes de computar
   * `sujeito`/`mencao_*`: uma edição minha não pode virar dez correções.
   */
  const foraDaConta = new Set<string>();
  for (const r of g.renomes) {
    foraDaConta.add(normalizarNome(r.de));
    foraDaConta.add(normalizarNome(r.para));
  }
  for (const bruta of g.entidades_recusadas) foraDaConta.add(normalizarNome(bruta));

  const saida: Correcao[] = [];
  const vistos = new Set<string>();

  const registrar = (c: Correcao) => {
    if (c.id.trim() === "" || vistos.has(c.id)) return;
    vistos.add(c.id);
    saida.push(c);
  };

  /** O esqueleto de uma correção que não é de átomo nenhum. */
  const daSessao = {
    sessao_id,
    atomo_id: null,
    entidade_chave: null,
    tipo_atomo: null,
    texto_proposto: "",
    inicios_s: [] as number[],
    prompt_version: proposta.prompt_version,
    modelo: proposta.modelo,
    em,
    incorporada_em: null,
  };

  /** Procedência do átomo da proposta, nunca do corpo (regra 7). */
  const doAtomo = (a: AtomoProposto) => ({
    sessao_id,
    atomo_id: a.id,
    entidade_chave: null,
    tipo_atomo: a.tipo,
    texto_proposto: a.texto,
    inicios_s: (a.trechos ?? []).flatMap((t) => (t.inicio_s === null ? [] : [t.inicio_s])),
    prompt_version: a.prompt_version ?? proposta.prompt_version,
    modelo: a.modelo ?? proposta.modelo,
    em,
    incorporada_em: null,
  });

  for (const a of proposta.atomos) {
    const base = doAtomo(a);
    const ref = sobreDe(a, conhecidas);
    const confirmado = porIndice.get(a.indice);
    const tocados = tocadosDe.get(a.indice) ?? new Set<CampoGesto>();

    // Desmarcar não é inferência por valor: o átomo não estar entre os
    // aprovados **é** o gesto, e não há canonização que o imite.
    if (!confirmado) {
      registrar({
        ...base,
        id: chaveDeAtomo(a.id, "rejeitado"),
        agente: "extracao",
        tipo: "rejeitado",
        antes: a.texto,
        depois: "",
        tocado: true,
      });
      continue;
    }

    if (a.texto.trim() !== confirmado.texto.trim()) {
      registrar({
        ...base,
        id: chaveDeAtomo(a.id, "texto"),
        agente: "extracao",
        tipo: "texto",
        antes: a.texto,
        depois: confirmado.texto,
        tocado: tocados.has("texto"),
      });
    }

    if (a.tipo !== confirmado.tipo) {
      registrar({
        ...base,
        id: chaveDeAtomo(a.id, "tipo"),
        agente: "extracao",
        tipo: "tipo",
        antes: a.tipo,
        depois: confirmado.tipo,
        tocado: tocados.has("tipo"),
      });
    }

    const antesSobre = normalizarNome(ref.entidade);
    const depoisSobre = normalizarNome(confirmado.sobre);

    // Trava 1: a comparação é por nome normalizado, então caixa e acento nunca
    // viram correção. Trava 2 mora no `tocado`, logo abaixo.
    if (
      antesSobre !== depoisSobre &&
      !foraDaConta.has(antesSobre) &&
      !foraDaConta.has(depoisSobre)
    ) {
      registrar({
        ...base,
        id: chaveDeAtomo(a.id, "sujeito"),
        agente: agenteDaReferencia(ref),
        tipo: "sujeito",
        antes: ref.entidade,
        depois: confirmado.sobre,
        tocado: tocados.has("sobre"),
      });
    }

    const antesM = new Map<string, string>();
    for (const m of mencoesDe(a, conhecidas)) {
      const chave = normalizarNome(m.entidade);
      if (chave !== "" && !foraDaConta.has(chave)) antesM.set(chave, m.entidade);
    }
    const depoisM = new Map<string, string>();
    for (const m of confirmado.menciona) {
      const chave = normalizarNome(m);
      if (chave !== "" && !foraDaConta.has(chave)) depoisM.set(chave, m);
    }
    // Trocar o sujeito tira o nome novo das menções e devolve o antigo a elas.
    // Sem isto, uma troca de sujeito viraria três correções em vez de uma.
    for (const chave of [antesSobre, depoisSobre]) {
      antesM.delete(chave);
      depoisM.delete(chave);
    }

    const adicionadas = [...depoisM].filter(([k]) => !antesM.has(k)).map(([, nome]) => nome);
    const removidas = [...antesM].filter(([k]) => !depoisM.has(k)).map(([, nome]) => nome);

    if (adicionadas.length > 0) {
      registrar({
        ...base,
        id: chaveDeAtomo(a.id, "mencao_adicionada"),
        // Sempre `extracao`, e não `agenteDaReferencia`: acrescentar uma menção
        // que o extrator não listou é falha de extração por definição — não há
        // referência original para a resolução ter errado. Medido na primeira
        // rodada real: a única menção acrescentada saiu como `resolucao` porque
        // o `sobre` daquele átomo era entidade conhecida, o que é só ruído.
        agente: "extracao",
        tipo: "mencao_adicionada",
        antes: "",
        depois: adicionadas.join(", "),
        tocado: tocados.has("menciona"),
      });
    }
    if (removidas.length > 0) {
      registrar({
        ...base,
        id: chaveDeAtomo(a.id, "mencao_removida"),
        agente: agenteDaReferencia(ref),
        tipo: "mencao_removida",
        antes: removidas.join(", "),
        depois: "",
        tocado: tocados.has("menciona"),
      });
    }
  }

  // Desmarcar a candidata no rodapé: o extrator listou como entidade o que não
  // é pessoa, projeto nem objetivo. Só o navegador testemunha — não usar por
  // acaso tem exatamente a mesma aparência no corpo.
  for (const bruta of g.entidades_recusadas) {
    const chave = normalizarNome(bruta);
    if (chave === "") continue;
    const candidata = proposta.entidades.find((e) => e.nome_normalizado === chave);
    registrar({
      ...daSessao,
      id: chaveDeEntidade(sessao_id, "entidade_recusada", chave),
      entidade_chave: chave,
      agente: "extracao",
      tipo: "entidade_recusada",
      antes: candidata?.nome ?? bruta,
      depois: "",
      tocado: true,
    });
  }

  // Renome é higiene de grafia, não erro de agente — **exceto** quando o que eu
  // apaguei era pronome: aí o extrator furou a seção "NOME DE ENTIDADE É NOME",
  // que é justamente o que aquela correção calibra.
  for (const r of g.renomes) {
    const de = normalizarNome(r.de);
    const para = normalizarNome(r.para);
    if (de === "" || para === "" || de === para) continue;
    registrar({
      ...daSessao,
      id: chaveDeEntidade(sessao_id, "entidade_renomeada", de),
      entidade_chave: de,
      agente: ehPronome(r.de) ? "extracao" : "grafo",
      tipo: "entidade_renomeada",
      antes: r.de,
      depois: r.para,
      tocado: true,
    });
  }

  // O palpite de tipo da lista `entidades` do extrator. Derivável sem gestos:
  // `canonizar` só sobrescreve o tipo quando a entidade casa com um nó
  // existente, e para `conhecida: false` o tipo do corpo é o que eu escolhi.
  const finalPorChave = new Map(entidades.map((e) => [e.nome_normalizado, e]));
  for (const e of proposta.entidades) {
    if (e.conhecida || foraDaConta.has(e.nome_normalizado)) continue;
    const final = finalPorChave.get(e.nome_normalizado);
    if (!final || final.tipo === e.tipo) continue;
    registrar({
      ...daSessao,
      id: chaveDeEntidade(sessao_id, "entidade_tipo", e.nome_normalizado),
      entidade_chave: e.nome_normalizado,
      agente: "extracao",
      tipo: "entidade_tipo",
      antes: e.tipo,
      depois: final.tipo,
      tocado: true,
    });
  }

  // "Faltou um": o único gesto novo que esta fatia pede na revisão, opt-in e
  // fechado por padrão. Casando com a transcrição, nasce ancorado de graça.
  for (const f of g.faltantes) {
    const texto = f.texto.trim();
    if (texto === "") continue;
    const achado = localizar?.(texto);
    registrar({
      ...daSessao,
      id: chaveDeFaltou(sessao_id, texto),
      agente: "extracao",
      tipo: "faltou",
      antes: "",
      depois: texto,
      inicios_s: achado && achado.inicio_s !== null ? [achado.inicio_s] : [],
      tocado: true,
    });
  }

  return saida;
}

// ──────────────────────────────── o índice ────────────────────────────────

export const indiceVazio = (agora: string): IndiceCalibracao => ({
  correcoes: [],
  regras_correntes: null,
  visitado_em: null,
  atualizado_em: agora,
});

/**
 * Corta no teto removendo **fechadas** antes de **abertas**, da mais velha para
 * a mais nova.
 *
 * Fechada já cumpriu o papel, e o registro por sessão em `correcoes.json`
 * cobre auditoria. Aberta é a única que ainda importa para o `calibracao-1`, e
 * sem `LIST` no R2 perdê-la do índice a torna inatingível para sempre.
 */
export function podarIndice(lista: readonly Correcao[], teto = TETO_CORRECOES): Correcao[] {
  if (lista.length <= teto) return [...lista];

  let excesso = lista.length - teto;
  const manter = lista.map(() => true);

  for (let i = lista.length - 1; i >= 0 && excesso > 0; i--) {
    if (lista[i].incorporada_em !== null) {
      manter[i] = false;
      excesso--;
    }
  }
  for (let i = lista.length - 1; i >= 0 && excesso > 0; i--) {
    if (manter[i]) {
      manter[i] = false;
      excesso--;
    }
  }
  return lista.filter((_, i) => manter[i]);
}

/**
 * Funde as correções de uma revisão no índice. Mais novas primeiro.
 *
 * Id que já está no índice **não** é sobrescrito: `incorporada_em` só é
 * autoritativo aqui, e uma reapuração da mesma sessão devolveria `null` e
 * reabriria uma correção que já virou regra.
 *
 * Puro de propósito: quem chama roda isto **dentro** de cada tentativa do
 * retry condicional (`calibracao.ts`), relendo o corrente a cada volta.
 */
export function juntarNoIndice(
  indice: IndiceCalibracao,
  novas: readonly Correcao[],
  agora: string,
): IndiceCalibracao {
  const existentes = new Set(indice.correcoes.map((c) => c.id));
  const entrando = novas.filter((c) => !existentes.has(c.id));
  if (entrando.length === 0) return indice;

  return {
    ...indice,
    correcoes: podarIndice([...entrando, ...indice.correcoes]),
    atualizado_em: agora,
  };
}
