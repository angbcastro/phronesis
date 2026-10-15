"use client";

/**
 * Tela de revisão — a última porta antes do grafo.
 *
 * O caso comum é aprovar tudo: a tela abre com todos os átomos marcados.
 * Discordar de um item custa um toque (desmarcar) e editar custa dois (botão
 * "editar"). Menos de 60 s numa sessão de 15 min, ou o sistema morre em três
 * semanas — `Specs/visao.md` §8.
 *
 * **A entidade se corrige em dois lugares, e a diferença entre eles é o alcance.**
 * Dentro do átomo, no bloco "entidades" do editor, eu troco o sujeito e as
 * menções **daquele** átomo. No painel do rodapé eu troco o nome de uma
 * candidata e **todos** os átomos que apontam para ela seguem junto — é assim
 * que "ela" vira "Marina" de uma vez só. Os dois usam a mesma barra pesquisável
 * (`SeletorEntidade`) sobre o grafo inteiro.
 *
 * Enquanto sobrar pronome, o confirmar fica travado: um nó chamado "ela" é
 * grafo apodrecido garantido — daqui a seis meses ninguém sabe quem era.
 *
 * **Dúvida destaca, não trava** (slice 4). O agente de resolução pode não ter
 * certeza de qual "Rafa" era; o átomo aparece marcado, com a sugestão já
 * preenchida e o motivo ao lado, e o confirmar continua liberado. Diferente do
 * pronome, que trava: ali o resultado seria um nó chamado "ela". Aqui o pior
 * caso é uma atribuição trocada, que eu conserto depois — e travar a cada
 * dúvida mataria os 60 s numa sessão que fale muito das duas pessoas.
 *
 * O player é o que torna a revisão confiável: escuto antes de aprovar. Um átomo
 * pode ter vários trechos, então há um botão por âncora. Átomo sem âncora não
 * ganha player e aparece marcado — trecho que não existe na transcrição costuma
 * ser afirmação que o modelo inventou.
 *
 * **Desde a slice 8.2 esta tela cresce debaixo da mão.** Ela não busca uma vez e
 * para: consome o fluxo de `/extracao/eventos` e troca a proposta inteira a cada
 * janela que fecha. Trocar a lista inteira é seguro **por construção** — os
 * índices dos átomos são carimbados na escrita (`aplicarJanela`) e nunca
 * renumeram, e `edicoes`, `rejeitados`, `renomes` e `abertos` são todos
 * chaveados por esse índice, nunca embutidos no array. O que eu já editei
 * sobrevive a cada evento.
 *
 * **O confirmar espera a proposta fechar** (decisão 3, e ela é absoluta):
 * enquanto `crescendo` for verdadeiro o botão fica travado, e uma linha discreta
 * no rodapé diz por quê. Confirmar metade da sessão partiria em duas tudo que é
 * chaveado por `sessao_id` — a captura de correções, os embeddings, o confronto.
 * Nem o teto da espera destrava: ele só troca a mensagem por uma honesta.
 *
 * **Desde a slice 11, a revisão fechada sabe pedir o que faltou.** Um "+" no
 * fim da lista abre um campo; eu escrevo em poucas palavras o que o extrator
 * deixou de fora, e o átomo volta pelo processo de sempre e entra no fim,
 * aprovado e com a linha "a pedido: «…»". Enquanto o pedido roda, o confirmar
 * trava pela mesma regra do `crescendo`: não gravar metade.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { esperouDemais } from "@/client/espera";
import { marcarRevisaoAberta } from "@/client/medidas";
import { lerEventos } from "@/client/ndjson";
import { SeletorEntidade } from "@/components/SeletorEntidade";
import { CATALOGO_VAZIO, montarCatalogo, resolver } from "@/lib/catalogo";
import { mencoesDe, sobreDe } from "@/lib/referencias";
import { localizarNoAudio } from "@/lib/transcricao";
import { anunciarGuardado } from "@/client/guardado";
import { dataCurta } from "@/lib/dia";
import { ehPronome, normalizarNome, plural, reescreverNomes } from "@/lib/texto";
import {
  CAMPOS_GESTO,
  ROTULO_TIPO_ATOMO,
  ROTULO_TIPO_ENTIDADE,
  TETO_PEDIDO,
  TIPOS_ATOMO,
  TIPOS_ENTIDADE,
} from "@/lib/tipos";
import type { Catalogo, EntidadeDoCatalogo } from "@/lib/catalogo";
import type { EventoDaProposta } from "@/lib/pipeline";
import type {
  AtomoProposto,
  BlocoAbsoluto,
  Camada,
  CampoPerfil,
  EntidadeCandidata,
  Gestos,
  MarcaPerfil,
  ReferenciaResolvida,
  TipoAtomo,
  TipoEntidade,
} from "@/lib/tipos";

export interface Proposta {
  status: string;
  /**
   * A proposta ainda vai crescer: faltam janelas (slice 8.2). É o que trava o
   * confirmar e o que acende a linha do rodapé.
   */
  crescendo?: boolean;
  trechos_totais?: number;
  trechos_faltando?: number;
  extracao: {
    atomos: AtomoProposto[];
    entidades: EntidadeCandidata[];
    descartados: { motivo: string }[];
    modelo: string;
    prompt_version: string;
    prompt_version_resolucao?: string | null;
    /**
     * A proposta saiu de uma resposta cortada no teto de saída (slice 4.10).
     * Muda o julgamento: uma lista curta aqui pode ser acidente, e não escolha
     * do modelo.
     */
    truncada?: boolean;
  };
  blocos: BlocoAbsoluto[];
  /**
   * A proposta que o `forcar` sobrescreveu, se houver (slice 4.6). Vem como
   * cabeçalho; a lista de átomos só chega com `?anterior=1`.
   */
  anterior?: {
    atomos: number;
    prompt_version: string;
    modelo: string;
    criado_em: string;
    lista?: AtomoProposto[];
  } | null;
}

/**
 * Edições locais de um átomo. Só o que eu mexi; o resto vem da proposta.
 *
 * As chaves são exatamente `CAMPOS_GESTO` (`tipos.ts`), e não por acaso: a
 * chave existir **é** o gesto que viaja em `gestos.atomos` (slice 4.6). Campo
 * novo aqui precisa entrar lá, ou a correção daquele campo nasce inferida.
 */
interface Edicao {
  texto?: string;
  tipo?: TipoAtomo;
  sobre?: string;
  /**
   * Lista inteira, não delta: mexer numa menção fixa as outras como estavam.
   * Guardar só a diferença exigiria saber distinguir "não mexi" de "apaguei",
   * e a lista é de dois ou três nomes.
   */
  menciona?: string[];
}

/** Como a entidade ficou depois que eu mexi nela. */
interface Renome {
  nome: string;
  tipo: TipoEntidade;
}

const ROTULO_CAMPO: Record<CampoPerfil, string> = {
  contexto: "contexto",
  pode_ajudar_com: "pode ajudar com",
  fizemos_juntos: "fizemos juntos",
};

const mmss = (s: number) =>
  `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/**
 * Mora em `transcricao.ts`, que é onde offset vira bloco. Reexportado aqui
 * porque esta tela foi a primeira a precisar dele e é por aqui que o teste o
 * alcança.
 */
export { localizarNoAudio };

/** Um átomo do jeito que ficou depois das minhas edições na tela. */
export interface AtomoEditado {
  indice: number;
  texto: string;
  tipo: TipoAtomo;
  sobre: string;
  menciona: string[];
  perfila: MarcaPerfil[];
}

/**
 * Uma referência do átomo com **onde** ela está.
 *
 * A tela precisa disso porque a dúvida deixou de ser só do sujeito (4.8.1):
 * `resolucao.ts` calcula `certo`, `motivo`, `alternativas` e `porque` **por
 * menção**, e até aqui a revisão lia tudo de `sobreDe` — discordância sobre
 * menção era invisível, mesmo com o `ARCHITECTURE.md` §4.7 prometendo o
 * contrário.
 */
export interface ReferenciaNoAtomo {
  papel: "sobre" | "menciona";
  /** A posição na lista de menções. `-1` no sujeito. */
  ordem: number;
  ref: ReferenciaResolvida;
}

/**
 * As referências do átomo — sujeito e menções —, na ordem em que a tela as
 * mostra.
 *
 * **A armadilha, e ela é silenciosa:** as menções na tela são uma lista de
 * strings por posição, e a referência casa com a posição **por índice**. Assim
 * que eu acrescento ou removo uma menção, o índice desloca e a sugestão
 * apareceria na linha errada — dizendo "escolhi Raffa" ao lado de outro nome.
 *
 * A trava é `mencoesEditadas`: enquanto eu não mexi na lista, ela é a da
 * proposta e o índice vale; a partir da primeira edição as menções saem daqui e
 * o átomo fica só com a dúvida do **sujeito**, que é um valor só e não desloca.
 * Perder a sugestão é o preço, e é o certo: sugestão na linha errada é pior que
 * sugestão nenhuma.
 */
export function referenciasDoAtomo(
  a: AtomoProposto,
  conhecidas?: ReadonlySet<string>,
  mencoesEditadas = false,
): ReferenciaNoAtomo[] {
  const lista: ReferenciaNoAtomo[] = [
    { papel: "sobre", ordem: -1, ref: sobreDe(a, conhecidas) },
  ];
  if (mencoesEditadas) return lista;
  mencoesDe(a, conhecidas).forEach((ref, ordem) =>
    lista.push({ papel: "menciona", ordem, ref }),
  );
  return lista;
}

/** As que o agente não teve certeza. Destacam, não travam (4.8). */
export const incertasDoAtomo = (
  a: AtomoProposto,
  conhecidas?: ReadonlySet<string>,
  mencoesEditadas = false,
): ReferenciaNoAtomo[] =>
  referenciasDoAtomo(a, conhecidas, mencoesEditadas).filter((i) => !i.ref.certo);

/**
 * As referências cuja sugestão veio de uma camada **semântica**, ou que trazem
 * evidência junto.
 *
 * É a lista que a tela mostra **sempre**, e não só na dúvida (4.8.1). O §4.10, o
 * tipo e o cabeçalho de `candidatosPorVizinhos` dizem a mesma frase: a camada 3b
 * herda atribuição passada, e a única coisa que a torna aceitável é estar na
 * tela — "sem o `porque`, esta camada não entraria". Ela estava na tela só
 * quando o agente hesitava; no caminho comum (`certo: true`) a herança era
 * invisível.
 *
 * `exato` e `string` ficam de fora de propósito: ali nada foi herdado — a grafia
 * é o que eu mesmo falei —, e uma linha em todo átomo viraria ruído na tela que
 * tem 60 s. `extrator` entra (4.9): ali o nome dentro do texto do átomo deixou
 * de ser o que eu falei.
 */
export const herdadasDoAtomo = (
  a: AtomoProposto,
  conhecidas?: ReadonlySet<string>,
  mencoesEditadas = false,
): ReferenciaNoAtomo[] =>
  referenciasDoAtomo(a, conhecidas, mencoesEditadas).filter(
    (i) =>
      i.ref.porque.length > 0 ||
      i.ref.camada === "perfil" ||
      i.ref.camada === "vizinhos" ||
      // `extrator` entra na lista pelo mesmo argumento da 3b, e mais forte: ele
      // não só herda atribuição passada como **reescreve o texto do átomo** com
      // o nome gravado do nó (4.9). Se isso não aparecesse na tela, o nome que
      // eu falei sumiria sem eu ver — e é o `citado` da referência que o guarda.
      i.ref.camada === "extrator",
  );

/** Como a tela chama a posição: "sobre" ou "menção 2". */
export const ondeEstaA = (i: ReferenciaNoAtomo): string =>
  i.papel === "sobre" ? "sobre" : `menção ${i.ordem + 1}`;

/**
 * O que cada camada tem a dizer de si, na primeira pessoa da tela.
 *
 * É o que separa "a grafia bateu" de "dois átomos seus votaram" — sem isto o
 * `porque` chega sem dizer se decidiu alguma coisa. A slice 4.9 acrescenta
 * `"extrator"`.
 */
export const FRASE_DA_CAMADA: Record<Camada, string> = {
  extrator: "o extrator reconheceu este nome no diário e o escreveu no átomo",
  exato: "a grafia bateu com o nome no grafo",
  string: "o nome é parecido com o que eu falei",
  perfil: "o perfil dela se parece com este átomo",
  vizinhos: "átomos passados seus votaram",
};

export interface CorpoDoConfirmar {
  aprovados: (Omit<AtomoEditado, "menciona"> & { menciona: string[] })[];
  entidades: { nome: string; tipo: TipoEntidade }[];
  /** O registro do toque, não um valor novo (slice 4.6). Opcional no servidor. */
  gestos: Gestos;
}

/**
 * O que o servidor não tem como derivar sozinho — só o navegador foi testemunha.
 *
 * O diff de uma correção é computado lá, comparando `extracao.json` com o que
 * eu aprovei; duplicá-lo aqui faria duas implementações divergirem, com a da
 * tela vencendo calada. O que não sobrevive à viagem são três coisas:
 *
 *   recusa       desmarcar a candidata tem a mesma aparência de não usá-la
 *   renome       o POST manda só o nome final; o par original→final se perde
 *   toque        editar um campo tem a mesma aparência da canonização, em que
 *                a grafia do grafo vence sem eu ter feito nada
 *
 * Nada aqui carrega valor: `gestos` é só o registro do gesto. Corpo sem ele
 * continua confirmando — o servidor infere pelo valor e marca `tocado: false`.
 */
export function montarGestos(entrada: {
  /** Edições por índice. A chave existir é o gesto; o valor já vai no corpo. */
  edicoes: Record<number, { texto?: string; tipo?: TipoAtomo; sobre?: string; menciona?: string[] }>;
  /** As candidatas da proposta, com o nome como o extrator as entregou. */
  entidades: EntidadeCandidata[];
  /** Como cada uma ficou depois que eu mexi no rodapé. */
  finalDe: (e: EntidadeCandidata) => { nome: string };
  /** Chaves **da proposta** das candidatas que de fato não viraram nó. */
  recusadas: ReadonlySet<string>;
  /** O que o extrator não viu e eu pedi — `faltantesDosPedidos` (slice 11). */
  faltantes?: { texto: string }[];
}): Gestos {
  const { edicoes, entidades, finalDe, recusadas, faltantes = [] } = entrada;

  const atomos = Object.entries(edicoes).flatMap(([indice, edicao]) => {
    const campos = CAMPOS_GESTO.filter((campo) => edicao[campo] !== undefined);
    return campos.length === 0 ? [] : [{ indice: Number(indice), campos }];
  });

  // Nome final igual ao proposto por normalização não é renome: é a mesma
  // trava que o servidor aplica, e aqui ela evita mandar o gesto de graça.
  const renomes = entidades.flatMap((e) => {
    const nome = finalDe(e).nome;
    const chave = normalizarNome(nome);
    return chave === "" || chave === e.nome_normalizado ? [] : [{ de: e.nome, para: nome }];
  });

  return {
    atomos,
    entidades_recusadas: entidades
      .filter((e) => recusadas.has(e.nome_normalizado))
      .map((e) => e.nome_normalizado),
    renomes,
    faltantes,
  };
}

/**
 * O "faltou um" da 4.6, enfim com botão (slice 11): cada átomo pedido que eu
 * **aprovei** vira um faltante, com o texto final — o que eu confirmei, e não o
 * que eu escrevi no pedido. Pedido de coisa que eu nem falei volta vazio e não
 * manda nada; átomo pedido desmarcado também não: nos dois casos o extrator
 * não deixou nada de fora.
 */
export function faltantesDosPedidos(
  aprovados: readonly AtomoProposto[],
  textoDe: (a: AtomoProposto) => string,
): { texto: string }[] {
  return aprovados.flatMap((a) => {
    if (!a.pedido) return [];
    const texto = textoDe(a).trim();
    return texto === "" ? [] : [{ texto }];
  });
}

/**
 * As entidades que só existem nesta revisão, como linhas do seletor.
 *
 * São as candidatas novas da proposta e as que eu criei pela linha `+ criar`
 * — com o nome **final**, o que o rodapé fez delas. Sem isto a barra de um
 * átomo só via o grafo, e a entidade que eu acabei de criar no átomo 1 não
 * existia para o átomo 2. Ficam de fora a que já casa com um nó (foi
 * re-apontada para ele, e a linha do grafo já está na lista) e a que ainda é
 * pronome: "ela" não é escolha que se ofereça.
 */
export function entradasLocais(
  entidades: EntidadeCandidata[],
  finalDe: (e: EntidadeCandidata) => { nome: string; tipo: TipoEntidade },
  grafo: Catalogo,
): EntidadeDoCatalogo[] {
  const vistas = new Set<string>();
  return entidades.flatMap((e) => {
    if (e.conhecida) return [];
    const f = finalDe(e);
    const chave = normalizarNome(f.nome);
    if (chave === "" || vistas.has(chave) || ehPronome(f.nome) || resolver(grafo, f.nome)) return [];
    vistas.add(chave);
    return [{ nome: f.nome.trim(), nome_normalizado: chave, chaves: [chave], tipo: f.tipo, sessoes: 0, aliases: [] }];
  });
}

/**
 * O caminho de volta de `nomeFinal`: o nome que eu escolhi na barra, se for o
 * nome final de uma candidata local, vira o nome **original** dela.
 *
 * É o que guarda no átomo a identidade da candidata e não a grafia do momento:
 * o renome seguinte no rodapé continua seguindo este átomo, porque `nomeFinal`
 * traduz pela chave original.
 */
export function nomeOriginalEm(
  entidades: EntidadeCandidata[],
  finalDe: (e: EntidadeCandidata) => { nome: string },
  nome: string,
): string {
  const chave = normalizarNome(nome);
  if (chave === "") return nome;
  const dona = entidades.find((e) => !e.conhecida && normalizarNome(finalDe(e).nome) === chave);
  return dona ? dona.nome : nome;
}

/**
 * O corpo de `POST /confirmar`, montado fora do componente porque é a lógica
 * mais fácil de quebrar em silêncio da tela inteira.
 *
 * Três regras vivem aqui, e as três são invisíveis se estiverem erradas:
 *
 * 1. **Toda entidade citada por um átomo aprovado tem de entrar em `entidades`.**
 *    O servidor descarta sem uma palavra a menção que não estiver na lista
 *    (`confirmar/route.ts`), então a menção que eu acabei de acrescentar à mão
 *    sumiria e eu só descobriria olhando o grafo depois.
 * 2. **Casou exato com o grafo, vai o nome do grafo.** É o que decide entre
 *    pendurar o átomo num nó que já existe e criar um segundo com outra grafia.
 *    `resolver` atravessa alias, acento e caixa — digitar uma grafia já fundida
 *    cai no vencedor da fusão em vez de ressuscitá-la.
 * 3. **Entidade desmarcada no rodapé fica só no texto do átomo.** É o que o
 *    checkbox de lá promete, e ele não pode valer só para o sujeito.
 *
 * O que **não** vem daqui é a procedência: `id`, offsets, âncoras,
 * `prompt_version` e `modelo` são relidos do R2 pelo servidor. Átomo com
 * procedência afirmada pelo navegador é pior que átomo nenhum.
 */
export function montarCorpoDoConfirmar(entrada: {
  aprovados: AtomoEditado[];
  /** As candidatas marcadas no rodapé, já com o nome final. */
  entidades: { nome: string; tipo: TipoEntidade }[];
  /** Chaves das candidatas desmarcadas: não viram nó, nem recebem menção. */
  recusadas: ReadonlySet<string>;
  catalogo: Catalogo;
}): Omit<CorpoDoConfirmar, "gestos"> {
  const { aprovados, entidades, recusadas, catalogo } = entrada;
  const paraGravar = new Map<string, { nome: string; tipo: TipoEntidade }>();

  /** A grafia do grafo quando casa exato; a que eu escrevi quando não casa. */
  const canonizar = (nome: string): { nome: string; tipo: TipoEntidade | null } => {
    const achada = resolver(catalogo, nome);
    return achada ? { nome: achada.nome, tipo: achada.tipo } : { nome: nome.trim(), tipo: null };
  };

  const incluir = (nome: string, tipo: TipoEntidade | null): string => {
    const chave = normalizarNome(nome);
    if (chave === "") return "";
    if (!paraGravar.has(chave)) paraGravar.set(chave, { nome, tipo: tipo ?? "Pessoa" });
    return chave;
  };

  for (const e of entidades) {
    const c = canonizar(e.nome);
    incluir(c.nome, c.tipo ?? e.tipo);
  }

  const corpoAtomos = aprovados.map((a) => {
    const sujeito = canonizar(a.sobre);
    const chaveSobre = incluir(sujeito.nome, sujeito.tipo);

    const mencoes = new Map<string, string>();
    for (const bruta of a.menciona) {
      const c = canonizar(bruta);
      const chave = normalizarNome(c.nome);
      if (chave === "" || chave === chaveSobre) continue;
      // Duas chaves: a que eu escrevi e a canônica. Uma grafia desmarcada no
      // rodapé pode ser alias de outra, e o alcance do checkbox é o nó.
      if (recusadas.has(chave) || recusadas.has(normalizarNome(bruta))) continue;
      incluir(c.nome, c.tipo);
      mencoes.set(chave, c.nome);
    }

    const perfila = a.perfila
      .map((m) => ({ entidade: canonizar(m.entidade).nome, campo: m.campo }))
      .filter((m) => paraGravar.has(normalizarNome(m.entidade)));

    return {
      indice: a.indice,
      texto: a.texto,
      tipo: a.tipo,
      sobre: sujeito.nome,
      menciona: [...mencoes.values()],
      perfila,
    };
  });

  return { aprovados: corpoAtomos, entidades: [...paraGravar.values()] };
}

/**
 * Em que caractere do texto o toque caiu — para o cursor nascer ali quando o
 * parágrafo vira campo (`Specs/interface.md`, a decisão 5). `null` quando o
 * navegador não sabe dizer, ou o ponto caiu fora do parágrafo.
 *
 * O parágrafo e o campo têm a mesma caixa — margem, fonte, entrelinha —, e é
 * isso que faz o caractere sob o dedo no parágrafo ser o mesmo no campo. O
 * texto oculto do leitor de tela vem **depois** do texto do átomo, então a
 * contagem do início até o ponto nunca o inclui.
 */
function posicaoDoToque(el: HTMLElement, x: number, y: number): number | null {
  const doc = el.ownerDocument as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  let no: Node | null = null;
  let deslocamento = 0;
  // O padrão (Firefox, Chrome recente) e o do WebKit (Safari, Chrome antigo).
  const ponto = doc.caretPositionFromPoint?.(x, y);
  if (ponto) {
    no = ponto.offsetNode;
    deslocamento = ponto.offset;
  } else {
    const faixa = doc.caretRangeFromPoint?.(x, y);
    if (faixa) {
      no = faixa.startContainer;
      deslocamento = faixa.startOffset;
    }
  }
  if (!no || !el.contains(no)) return null;
  const antes = doc.createRange();
  antes.setStart(el, 0);
  antes.setEnd(no, deslocamento);
  return antes.toString().length;
}

/**
 * Um nome de entidade na linha de resumo do átomo, com o ícone de fontes ao
 * lado quando `fonte` existir — só entidades com evidência de retrieval
 * (`herdadasDoAtomo`) ganham o ícone; as demais ficam só o nome.
 */
function EntidadeRef({
  nome,
  fonte,
  aoAbrir,
}: {
  nome: string;
  fonte?: ReferenciaNoAtomo;
  aoAbrir: (f: ReferenciaNoAtomo) => void;
}) {
  return (
    <span className="entidade-ref">
      {nome}
      {fonte && (
        <button
          type="button"
          className="fonte"
          aria-label={`ver fontes de ${nome}`}
          onClick={() => aoAbrir(fonte)}
        >
          ⓘ
        </button>
      )}
    </span>
  );
}

/**
 * Quanto se espera antes de reabrir um fluxo que caiu.
 *
 * O mesmo intervalo com que o servidor reconfere a proposta
 * (`INTERVALO_EVENTOS_MS`): reabrir mais depressa não traz o átomo antes, e
 * reabrir mais devagar é espera morta na única tela em que eu estou olhando.
 */
const INTERVALO_RECONEXAO_MS = 700;

/**
 * Quando um evento do fluxo substitui a proposta em tela (slice 8.2).
 *
 * Trocar a lista inteira é seguro — os índices são carimbados na escrita e não
 * renumeram —, mas **uma reconexão pode trazer um retrato mais velho**: o fluxo
 * cai, a tela reabre, e o primeiro evento da conexão nova pode ter sido montado
 * antes do último da conexão antiga. A lista só cresce, então "tem menos átomos
 * que a que está na tela" é exatamente a assinatura desse caso — e a resposta é
 * ignorar, não piscar para trás.
 */
export function mesclarProposta(atual: Proposta | null, nova: Proposta): Proposta {
  if (!atual) return nova;
  return nova.extracao.atomos.length < atual.extracao.atomos.length ? atual : nova;
}

/** Quantos trechos ainda faltam, para a linha do rodapé. `null` = não mostrar. */
export function faltamTrechos(p: Proposta | null): { faltam: number; total: number } | null {
  if (!p?.crescendo) return null;
  const total = p.trechos_totais ?? 0;
  const faltam = p.trechos_faltando ?? 0;
  return total > 0 && faltam > 0 ? { faltam, total } : null;
}

export function Revisao({ id }: { id: string }) {
  const router = useRouter();
  const [proposta, setProposta] = useState<Proposta | null>(null);
  const [falha, setFalha] = useState<string | null>(null);
  const [doGrafo, setDoGrafo] = useState<EntidadeDoCatalogo[]>([]);

  const [rejeitados, setRejeitados] = useState<Set<number>>(new Set());
  const [semEntidade, setSemEntidade] = useState<Set<string>>(new Set());
  const [renomes, setRenomes] = useState<Record<string, Renome>>({});
  /**
   * As entidades que eu criei pela linha `+ criar` de um átomo. Existem na
   * tela — no rodapé e nas barras de todos os átomos — e só viram nó no
   * confirmar, como qualquer candidata nova (regra 5).
   */
  const [criadas, setCriadas] = useState<EntidadeCandidata[]>([]);
  const [edicoes, setEdicoes] = useState<Record<number, Edicao>>({});
  const [abertos, setAbertos] = useState<Set<number>>(new Set());
  const [editandoTexto, setEditandoTexto] = useState<Set<number>>(new Set());
  const [fontesAbertas, setFontesAbertas] = useState<ReferenciaNoAtomo | null>(null);
  const [filtros, setFiltros] = useState<Record<number, TipoEntidade | "todas">>({});
  const [gravando, setGravando] = useState(false);
  /** O fluxo caiu e não voltou a tempo. Não destrava nada — só explica. */
  const [travouEspera, setTravouEspera] = useState(false);
  /** A lista da proposta anterior, buscada só quando eu peço para ver. */
  const [anterior, setAnterior] = useState<AtomoProposto[] | null>(null);
  /** O campo do "+" está aberto. Fechado por padrão: aprovar tudo não muda. */
  const [pedindo, setPedindo] = useState(false);
  const [textoPedido, setTextoPedido] = useState("");
  /** Um pedido está rodando. Trava o confirmar, como o `crescendo`. */
  const [procurando, setProcurando] = useState(false);
  /** A resposta do último pedido que não trouxe átomo: vazio ou falha. */
  const [avisoPedido, setAvisoPedido] = useState<string | null>(null);

  const audio = useRef<HTMLAudioElement | null>(null);
  const modalFontes = useRef<HTMLDivElement | null>(null);
  /**
   * Onde o cursor nasce quando um parágrafo vira campo: o caractere sob o dedo,
   * ou o fim do texto quando foi pelo teclado. Consumido uma vez, pelo `ref`
   * do campo — que roda a cada render, e não pode reposicionar o cursor no
   * meio da digitação.
   */
  const cursorPedido = useRef<{ indice: number; pos: number } | null>(null);
  const mediu = useRef(false);

  /**
   * O fluxo da proposta: abre, recebe, e reabre se cair antes de fechar.
   *
   * **A reconexão não é luxo, é o desenho.** O fluxo do servidor fecha sozinho
   * aos 280 s (`TETO_STREAM_MS`), 20 s antes de a plataforma o matar, e uma
   * sessão longa pode passar disso. Fechar limpo e reabrir é o que impede a
   * tela de ficar esperando para sempre um átomo que não vem — que é o limite
   * que a própria spec aponta como o que decide se a fatia é usável.
   *
   * O teto de `@/client/espera` é o fim da linha: passado ele sem a proposta
   * fechar, a tela diz o que aconteceu. **O confirmar continua travado** — a
   * decisão 3 não tem exceção, e destravá-lo aqui gravaria meia sessão.
   */
  useEffect(() => {
    let vivo = true;
    let fechou = false;
    let controle: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout>;
    // O relógio é o da visita, como no corredor: reabrir a revisão pela lista
    // recomeça a contagem.
    const abriu = Date.now();

    async function acompanhar() {
      controle = new AbortController();
      try {
        const r = await fetch(`/api/sessoes/${id}/extracao/eventos`, {
          cache: "no-store",
          signal: controle.signal,
        });
        if (!r.ok || !r.body) throw new Error(`o fluxo da proposta respondeu ${r.status}`);

        await lerEventos<EventoDaProposta>(
          r.body,
          (e) => {
            if (!vivo) return;
            if (e.tipo === "erro") {
              setFalha(e.erro);
              return;
            }
            setFalha(null);
            setProposta((p) =>
              mesclarProposta(p, {
                status: e.status,
                crescendo: e.proposta.crescendo,
                trechos_totais: e.proposta.trechos_totais,
                trechos_faltando: e.proposta.trechos_faltando,
                extracao: e.proposta.extracao as Proposta["extracao"],
                blocos: e.proposta.blocos,
                anterior: e.proposta.anterior ?? null,
              }),
            );
            if (!e.proposta.crescendo) fechou = true;

            // A terceira marca, e o fim da espera que a slice 8 mede: a
            // proposta está na tela. **Depois** do `setProposta`, e não antes —
            // o que se mede é a revisão montada, não a resposta chegando. Uma
            // vez só: os eventos seguintes são a lista crescendo, não a espera
            // acabando de novo. Só vale se esta aba passou pelo corredor
            // (`client/medidas.ts`).
            if (!mediu.current) {
              mediu.current = true;
              void marcarRevisaoAberta(id);
            }
          },
          "revisao",
        );
      } catch (e) {
        if (vivo && !controle.signal.aborted) {
          console.error("[revisao]", e);
        }
      }

      if (!vivo || fechou) return;
      if (esperouDemais(abriu)) {
        setTravouEspera(true);
        return;
      }
      timer = setTimeout(() => void acompanhar(), INTERVALO_RECONEXAO_MS);
    }

    void acompanhar();
    return () => {
      vivo = false;
      controle?.abort();
      clearTimeout(timer);
    };
  }, [id]);

  /**
   * A lista completa do grafo alimenta as barras de entidade. Rota que já
   * existia, sem nada novo do lado do servidor — e se ela falhar, as barras
   * continuam sendo campos de texto livre, que é o comportamento anterior.
   */
  useEffect(() => {
    let vivo = true;
    fetch("/api/entidades", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ entidades: EntidadeDoCatalogo[] }>) : null))
      .then((d) => vivo && d && setDoGrafo(d.entidades))
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, []);

  /**
   * O modal de fontes: fecha no Escape, do mesmo jeito que a gaveta de agentes,
   * e leva o foco junto — entra no "×" ao abrir e volta ao ⓘ que o abriu ao
   * fechar. Sem isto, quem navega por teclado abria o modal com o foco atrás do
   * véu.
   */
  useEffect(() => {
    if (!fontesAbertas) return;
    const quemAbriu = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    modalFontes.current?.querySelector<HTMLElement>("button")?.focus();
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFontesAbertas(null);
    };
    window.addEventListener("keydown", aoTeclar);
    return () => {
      window.removeEventListener("keydown", aoTeclar);
      quemAbriu?.focus();
    };
  }, [fontesAbertas]);

  /** Índice de busca do grafo — inclusive por alias, para o seletor. */
  const catalogo = useMemo(
    () => (doGrafo.length === 0 ? CATALOGO_VAZIO : montarCatalogo(doGrafo)),
    [doGrafo],
  );

  /** Toca o bloco certo no segundo certo. Uma URL presigned por clique. */
  const escutar = useCallback(
    async (segundo: number) => {
      if (!proposta) return;
      const alvo = localizarNoAudio(proposta.blocos, segundo);
      if (!alvo) return;

      const r = await fetch(`/api/sessoes/${id}/chunks/${alvo.i}/audio`);
      if (!r.ok) return;
      const { url } = (await r.json()) as { url: string };

      const el = audio.current;
      if (!el) return;
      el.pause();
      el.src = url;
      // Safari só aceita currentTime depois dos metadados; refazemos no evento.
      el.onloadedmetadata = () => {
        el.currentTime = alvo.dentro;
        void el.play();
      };
      el.currentTime = alvo.dentro;
      void el.play().catch(() => {});
    },
    [id, proposta],
  );

  const atomos = proposta?.extracao.atomos ?? [];
  const daProposta = useMemo(() => proposta?.extracao.entidades ?? [], [proposta]);

  /**
   * As candidatas da proposta mais as que eu criei. A da proposta vence a
   * colisão: uma janela nova pode trazer a mesma entidade que eu já tinha
   * criado à mão, e as duas são a mesma chave.
   */
  const entidades = useMemo(() => {
    const chaves = new Set(daProposta.map((e) => e.nome_normalizado));
    return [...daProposta, ...criadas.filter((e) => !chaves.has(e.nome_normalizado))];
  }, [daProposta, criadas]);

  /**
   * As chaves que já existiam no grafo quando a proposta foi montada. Serve à
   * leitura do formato antigo, em que o átomo guardava só o nome: `conhecida`
   * sai do casamento contra esta lista, que é a informação que havia.
   */
  const conhecidas = useMemo(
    () => new Set(entidades.filter((e) => e.conhecida).map((e) => e.nome_normalizado)),
    [entidades],
  );

  const referenciaDe = useCallback(
    (a: AtomoProposto) => sobreDe(a, conhecidas),
    [conhecidas],
  );

  const valorDe = useCallback(
    (a: AtomoProposto): Required<Edicao> => ({
      texto: edicoes[a.indice]?.texto ?? a.texto,
      tipo: edicoes[a.indice]?.tipo ?? a.tipo,
      sobre: edicoes[a.indice]?.sobre ?? referenciaDe(a).entidade,
      menciona: edicoes[a.indice]?.menciona ?? mencoesDe(a, conhecidas).map((m) => m.entidade),
    }),
    [conhecidas, edicoes, referenciaDe],
  );

  /** Grava uma mudança pontual no átomo, preservando o resto da edição. */
  const editarAtomo = useCallback((indice: number, mudanca: Edicao) => {
    setEdicoes((s) => ({ ...s, [indice]: { ...s[indice], ...mudanca } }));
  }, []);

  /** O que a entidade virou depois das minhas edições. */
  const finalDe = useCallback(
    (e: EntidadeCandidata): Renome => renomes[e.nome_normalizado] ?? { nome: e.nome, tipo: e.tipo },
    [renomes],
  );

  /**
   * Traduz um nome de entidade para o nome final. É isto que faz renomear a
   * entidade uma vez consertar todos os átomos que apontam para ela.
   */
  const nomeFinal = useCallback(
    (nome: string): string => {
      const chave = normalizarNome(nome);
      const candidata = entidades.find((e) => e.nome_normalizado === chave);
      return candidata ? finalDe(candidata).nome : nome;
    },
    [entidades, finalDe],
  );

  /**
   * O catálogo que as barras dos átomos veem: o grafo, e depois o que só
   * existe nesta revisão. O grafo vem primeiro e vence a colisão de chave.
   * `montarCorpoDoConfirmar` continua canonizando contra `catalogo` puro —
   * canonizar contra uma linha local não mudaria nada, e o grafo é a fonte.
   */
  const catalogoDaTela = useMemo(
    () => montarCatalogo([...catalogo.lista, ...entradasLocais(entidades, finalDe, catalogo)]),
    [catalogo, entidades, finalDe],
  );

  const nomeOriginal = useCallback(
    (nome: string) => nomeOriginalEm(entidades, finalDe, nome),
    [entidades, finalDe],
  );

  /**
   * A linha `+ criar` de um átomo: a entidade passa a existir na tela, para
   * os outros átomos e para o rodapé. O tipo é o do filtro daquele átomo,
   * quando há um — escolher "projetos" e criar é dizer que é projeto.
   */
  const criar = useCallback(
    (nome: string, filtro: TipoEntidade | "todas") => {
      const chave = normalizarNome(nome);
      if (chave === "" || resolver(catalogoDaTela, nome)) return;
      setCriadas((s) =>
        s.some((e) => e.nome_normalizado === chave)
          ? s
          : [
              ...s,
              {
                nome: nome.trim(),
                nome_normalizado: chave,
                tipo: filtro === "todas" ? "Pessoa" : filtro,
                conhecida: false,
                id: null,
                ocorrencias: 0,
                sessoes: 0,
                // Criar "ela" é possível, e cai na mesma trava do pronome.
                precisa_nome: ehPronome(nome),
              },
            ],
      );
    },
    [catalogoDaTela],
  );

  const aprovados = atomos.filter((a) => !rejeitados.has(a.indice));

  /** A proposta ainda vai crescer — o confirmar espera (decisão 3). */
  const crescendo = proposta?.crescendo === true;
  const faltando = faltamTrechos(proposta);

  /**
   * Entidade que é sujeito de um átomo aprovado não pode ser desmarcada: sem ela
   * o átomo ficaria sem `:SOBRE`, o que o schema não admite.
   */
  const travadas = useMemo(() => {
    const s = new Set<string>();
    for (const a of aprovados) s.add(normalizarNome(valorDe(a).sobre));
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aprovados, edicoes, valorDe]);

  const usada = (e: EntidadeCandidata) =>
    !semEntidade.has(e.nome_normalizado) || travadas.has(e.nome_normalizado);

  /**
   * As chaves que algum átomo cita hoje, com as minhas edições. A entidade
   * que eu criei só aparece no rodapé enquanto alguém a usa: criei, troquei de
   * ideia no átomo, e ela some — não há nada a renomear numa entidade órfã.
   */
  const emUso = useMemo(() => {
    const s = new Set<string>();
    for (const a of atomos) {
      const v = valorDe(a);
      for (const n of [v.sobre, ...v.menciona]) s.add(normalizarNome(n));
    }
    return s;
  }, [atomos, valorDe]);

  /**
   * O texto do átomo como a tela o mostra e o confirmar o manda: com o nome
   * da entidade antiga trocado pelo da nova (`reescreverNomes`).
   *
   * Derivado, e não gravado em `edicoes`: a troca não é um gesto meu sobre o
   * texto, e gravá-la marcaria `texto` como tocado. As listas de depois saem
   * como o corpo as manda — nome final, grafia do grafo, sem menção vazia,
   * repetida do sujeito ou desmarcada no rodapé —, porque `correcoes.ts` refaz
   * esta mesma conta com o que chegou, para saber o que foi edição minha.
   */
  const textoDe = useCallback(
    (a: AtomoProposto): string => {
      const v = valorDe(a);
      const canon = (n: string) => {
        const f = nomeFinal(n);
        return resolver(catalogo, f)?.nome ?? f.trim();
      };
      const recusadas = new Set(
        entidades.filter((e) => !usada(e)).map((e) => normalizarNome(finalDe(e).nome)),
      );
      const sobre = canon(v.sobre);
      const menciona = v.menciona.map(canon).filter((n) => {
        const k = normalizarNome(n);
        return k !== "" && k !== normalizarNome(sobre) && !recusadas.has(k);
      });
      return reescreverNomes(
        v.texto,
        {
          sobre: referenciaDe(a).entidade,
          menciona: mencoesDe(a, conhecidas).map((m) => m.entidade),
        },
        { sobre, menciona },
      );
    },
    // `usada` é recriada a cada render e lê o mesmo estado que já está aqui.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [valorDe, nomeFinal, catalogo, entidades, finalDe, semEntidade, travadas, referenciaDe, conhecidas],
  );

  /** Ainda é pronome, e algum átomo aprovado depende dela. */
  const pendentes = entidades.filter(
    (e) => e.precisa_nome && usada(e) && ehPronome(finalDe(e).nome),
  );

  /** Eu já mexi na lista de menções deste átomo? É a trava do índice (4.8.1). */
  const mexeuNasMencoes = useCallback(
    (a: AtomoProposto) => edicoes[a.indice]?.menciona !== undefined,
    [edicoes],
  );

  /**
   * As referências incertas do átomo — **sujeito e menções**. Até a 4.8.1 só o
   * sujeito contava, e discordância sobre menção não aparecia em lugar nenhum.
   */
  const incertasDe = useCallback(
    (a: AtomoProposto) => incertasDoAtomo(a, conhecidas, mexeuNasMencoes(a)),
    [conhecidas, mexeuNasMencoes],
  );

  /** As sugestões que vieram de camada semântica, ou com evidência junto. */
  const herdadasDe = useCallback(
    (a: AtomoProposto) => herdadasDoAtomo(a, conhecidas, mexeuNasMencoes(a)),
    [conhecidas, mexeuNasMencoes],
  );

  /** Atribuições que o agente não teve certeza. Destacam, não travam. */
  const duvidosos = aprovados.filter((a) => incertasDe(a).length > 0);

  /**
   * Só quando a versão do prompt mudou. Re-extrair com o mesmo prompt produz
   * uma lista que eu não tenho por que comparar — e uma linha que aparece
   * sempre vira ruído na tela mais apertada do sistema.
   */
  const mudouDeVersao =
    proposta?.anterior != null &&
    proposta.anterior.prompt_version !== proposta.extracao.prompt_version;

  /** A lista antiga custa uma ida à rede, e só quando eu peço. */
  async function verAnterior() {
    const r = await fetch(`/api/sessoes/${id}/extracao?anterior=1`, { cache: "no-store" }).catch(
      () => null,
    );
    if (!r || !r.ok) return;
    const d = (await r.json()) as { anterior?: { lista?: AtomoProposto[] } };
    setAnterior(d.anterior?.lista ?? []);
  }

  /** Pendente primeiro: é o que precisa da minha atenção. */
  const ordenadas = useMemo(
    () =>
      entidades
        .filter((e) => daProposta.includes(e) || emUso.has(e.nome_normalizado))
        .sort((a, b) => Number(b.precisa_nome) - Number(a.precisa_nome)),
    [entidades, daProposta, emUso],
  );

  function editarEntidade(e: EntidadeCandidata, mudanca: Partial<Renome>) {
    setRenomes((s) => ({
      ...s,
      [e.nome_normalizado]: {
        ...(s[e.nome_normalizado] ?? { nome: e.nome, tipo: e.tipo }),
        ...mudanca,
      },
    }));
  }

  /**
   * O "+": pede ao extrator o que faltou, e espera a resposta (slice 11).
   *
   * A proposta da resposta entra por `mesclarProposta` — a lista só cresce, e o
   * que eu já editei sobrevive porque tudo é chaveado por índice. Os átomos
   * pedidos entram **aprovados**: `rejeitados` não os conhece. O texto só sai
   * do campo quando achou; vazio ou falha, ele fica para eu reescrever.
   */
  async function pedir() {
    const texto = textoPedido.trim();
    if (!proposta || procurando || gravando || proposta.crescendo || texto === "") return;
    setProcurando(true);
    setAvisoPedido(null);

    const r = await fetch(`/api/sessoes/${id}/pedidos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texto }),
    }).catch(() => null);

    if (!r || !r.ok) {
      const motivo = r
        ? ((await r.json().catch(() => ({}))) as { erro?: string }).erro
        : "sem resposta do servidor";
      setAvisoPedido(motivo ?? "o pedido falhou");
      setProcurando(false);
      return;
    }

    const d = (await r.json()) as {
      pedido: { atomos: AtomoProposto[] };
      proposta: Proposta | null;
    };
    if (d.proposta) {
      const nova = d.proposta;
      setProposta((p) =>
        mesclarProposta(p, {
          status: nova.status,
          crescendo: nova.crescendo,
          extracao: nova.extracao,
          blocos: nova.blocos,
          anterior: nova.anterior ?? null,
        }),
      );
    }
    if (d.pedido.atomos.length === 0) {
      setAvisoPedido("não achei isso na transcrição");
    } else {
      setTextoPedido("");
      setPedindo(false);
    }
    setProcurando(false);
  }

  async function confirmar() {
    // `crescendo` entra na guarda, e não só no `disabled`: o botão é uma
    // aparência, esta linha é a regra. Gravar metade da sessão partiria em duas
    // tudo que é chaveado por `sessao_id`. O pedido em curso entra pelo mesmo
    // motivo (slice 11): o átomo que ele vai trazer ficaria para trás.
    if (!proposta || gravando || pendentes.length > 0 || proposta.crescendo || procurando) return;
    setGravando(true);
    setFalha(null);

    // As candidatas que de fato não viram nó. A lista sai daqui e não de
    // `semEntidade` cru: uma desmarcada que ainda é sujeito de átomo aprovado
    // continua entrando, e chamá-la de recusada seria mentir para a calibração.
    const naoUsadas = entidades.filter((e) => !usada(e));

    // Tudo já traduzido para o nome final do rodapé; o resto — casar com o
    // grafo, juntar as entidades citadas, respeitar o que eu desmarquei — é
    // `montarCorpoDoConfirmar`, que é puro e tem teste.
    const corpo: CorpoDoConfirmar = {
      ...montarCorpoDoConfirmar({
        aprovados: aprovados.map((a) => {
          const v = valorDe(a);
          return {
            indice: a.indice,
            texto: textoDe(a),
            tipo: v.tipo,
            sobre: nomeFinal(v.sobre),
            menciona: v.menciona.map(nomeFinal),
            perfila: (a.perfila ?? []).map((m: MarcaPerfil) => ({
              entidade: nomeFinal(m.entidade),
              campo: m.campo,
            })),
          };
        }),
        entidades: entidades.filter(usada).map(finalDe),
        recusadas: new Set(naoUsadas.map((e) => normalizarNome(finalDe(e).nome))),
        catalogo,
      }),
      // A chave aqui é a **da proposta**, e não a do nome final: é por ela que
      // o servidor acha a candidata que eu recusei e tira aquela entidade da
      // conta das menções.
      // Só as candidatas **da proposta**: renomear ou recusar uma entidade que
      // eu mesmo criei não é correção de agente nenhum.
      gestos: montarGestos({
        edicoes,
        entidades: daProposta,
        finalDe,
        recusadas: new Set(
          naoUsadas.filter((e) => daProposta.includes(e)).map((e) => e.nome_normalizado),
        ),
        faltantes: faltantesDosPedidos(aprovados, textoDe),
      }),
    };

    const r = await fetch(`/api/sessoes/${id}/confirmar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    }).catch(() => null);

    if (!r || !r.ok) {
      // O corpo pode nem ser JSON — um 502 da plataforma é página HTML —, e um
      // `json()` que estoura aqui deixava o botão preso em "guardando…".
      const motivo = r
        ? ((await r.json().catch(() => ({}))) as { erro?: string }).erro
        : "sem resposta do servidor";
      setFalha(motivo ?? `o servidor respondeu ${r?.status}`);
      setGravando(false);
      return;
    }
    // A home diz "guardado · N itens" por 3 s, uma vez só (`client/guardado.ts`).
    anunciarGuardado(aprovados.length);
    router.push("/");
  }

  if (falha && !proposta) {
    return (
      <main className="leitura">
        <h1>revisão</h1>
        <p className="aviso erro" role="alert">
          {falha}
        </p>
      </main>
    );
  }

  if (!proposta) {
    return (
      <main className="leitura">
        <h1>revisão</h1>
        {travouEspera ? (
          // O fluxo nunca trouxe um átomo. Sem esta linha a tela ficaria nas
          // reticências para sempre, que é a trava que a 8.2 foi acabar.
          <p className="aguardando">
            essa sessão não chegou a produzir nada para revisar no tempo que o servidor tem para
            trabalhar. O áudio está inteiro — dá para mandar extrair de novo pela lista de{" "}
            <Link href="/sessoes">sessões</Link>.
          </p>
        ) : (
          <p className="aguardando">…</p>
        )}
      </main>
    );
  }

  return (
    <main className="revisao">
      <header>
        <h1>o que eu entendi</h1>
        <p className="aguardando">
          {aprovados.length} de {atomos.length} — desmarque o que não presta, edite o que ficou torto
          {duvidosos.length > 0 &&
            ` · ${duvidosos.length} com dúvida de quem é (dá para confirmar assim mesmo)`}
        </p>
        {proposta.extracao.truncada && (
          <p className="aviso">
            a resposta do modelo veio cortada no meio — esta lista é o que deu para salvar, e
            pode estar faltando o fim dela
          </p>
        )}
      </header>

      <ol className="atomos">
        {atomos.map((a) => {
          const rejeitado = rejeitados.has(a.indice);
          const aberto = abertos.has(a.indice);
          const v = valorDe(a);
          const texto = textoDe(a);
          const ref = referenciaDe(a);
          const sobre = nomeFinal(v.sobre);
          // As referências desta lista casam com a posição **por índice**, e a
          // trava contra o índice deslocado está em `referenciasDoAtomo`.
          const incertas = incertasDe(a);
          const herdadas = herdadasDe(a);
          const mencoesDaProposta = mexeuNasMencoes(a) ? [] : mencoesDe(a, conhecidas);
          const incerto = incertas.length > 0;
          // Do valor editado, não da proposta: tirar uma menção tem de sumir
          // com ela da linha de resumo na hora, sem eu fechar o editor. O
          // `ordem` (índice original, pré-filtro) sobrevive para casar com
          // `herdadas`, que usa a mesma trava de posição.
          const mencoesEntradas = v.menciona
            .map((m, k) => ({ nome: nomeFinal(m), ordem: k }))
            .filter((e) => e.nome !== "" && normalizarNome(e.nome) !== normalizarNome(sobre));
          const fonteDe = (papel: "sobre" | "menciona", ordem: number) =>
            herdadas.find((i) => i.papel === papel && i.ordem === ordem);
          // `?? []` protege contra proposta gravada por um prompt anterior, de
          // quando o átomo tinha uma âncora só.
          const ancorados = (a.trechos ?? []).filter((t) => t.inicio_s !== null);
          const marcas = a.perfila ?? [];

          return (
            <li
              key={a.indice}
              className={`atomo${rejeitado ? " fora" : ""}${incerto ? " incerto" : ""}`}
            >
              <div className="linha">
                <input
                  type="checkbox"
                  checked={!rejeitado}
                  // O texto do átomo no nome: "manter este item" igual em toda
                  // linha não dizia, a quem ouve, qual item.
                  aria-label={`manter: ${texto}`}
                  onChange={() =>
                    setRejeitados((s) => {
                      const n = new Set(s);
                      if (n.has(a.indice)) n.delete(a.indice);
                      else n.add(a.indice);
                      return n;
                    })
                  }
                />
                <div className="corpo">
                  <span className="tipo">{ROTULO_TIPO_ATOMO[v.tipo] ?? v.tipo}</span>
                  {editandoTexto.has(a.indice) ? (
                    <textarea
                      className="texto-atomo editando"
                      value={texto}
                      aria-label="texto do átomo"
                      // Sem `rows` fixo: a altura segue o conteúdo, do mesmo
                      // jeito que o parágrafo cresce sozinho. `ref` acerta a
                      // altura assim que o campo aparece; `onChange` reajusta
                      // a cada tecla, senão o campo ficaria menor que o texto
                      // que ele mesmo mostra.
                      //
                      // E o foco é daqui, e não de um `autoFocus`: focar só
                      // poria o cursor no início do texto, e ele tem de nascer
                      // onde eu toquei. Isto roda dentro do toque — o React
                      // aplica o clique de uma vez —, que é o que deixa o
                      // teclado do celular subir.
                      ref={(el) => {
                        if (!el) return;
                        el.style.height = "auto";
                        el.style.height = `${el.scrollHeight}px`;
                        const pedido = cursorPedido.current;
                        if (pedido?.indice === a.indice) {
                          cursorPedido.current = null;
                          el.focus();
                          el.setSelectionRange(pedido.pos, pedido.pos);
                        }
                      }}
                      onChange={(e) => {
                        editarAtomo(a.indice, { texto: e.target.value });
                        e.target.style.height = "auto";
                        e.target.style.height = `${e.target.scrollHeight}px`;
                      }}
                      onBlur={() =>
                        setEditandoTexto((s) => {
                          const n = new Set(s);
                          n.delete(a.indice);
                          return n;
                        })
                      }
                    />
                  ) : (
                    <p
                      className="texto-atomo"
                      tabIndex={0}
                      role="button"
                      onClick={(e) => {
                        const pos = posicaoDoToque(e.currentTarget, e.clientX, e.clientY);
                        cursorPedido.current = {
                          indice: a.indice,
                          pos: Math.min(pos ?? texto.length, texto.length),
                        };
                        setEditandoTexto((s) => new Set(s).add(a.indice));
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          // Pelo teclado não há ponto: o cursor vai para o fim.
                          cursorPedido.current = { indice: a.indice, pos: texto.length };
                          setEditandoTexto((s) => new Set(s).add(a.indice));
                        }
                      }}
                    >
                      {texto}
                      {/* O nome do botão é o próprio texto; um `aria-label` aqui
                          o escondia de quem ouve a revisão. */}
                      <span className="so-leitor"> (editar)</span>
                    </p>
                  )}
                  <p className="meta">
                    sobre <EntidadeRef nome={sobre} fonte={fonteDe("sobre", -1)} aoAbrir={setFontesAbertas} />
                    {mencoesEntradas.length > 0 && (
                      <>
                        {" · menciona "}
                        {mencoesEntradas.map((e, i) => (
                          <span key={e.ordem}>
                            {i > 0 && ", "}
                            <EntidadeRef
                              nome={e.nome}
                              fonte={fonteDe("menciona", e.ordem)}
                              aoAbrir={setFontesAbertas}
                            />
                          </span>
                        ))}
                      </>
                    )}
                  </p>

                  {a.pedido && (
                    // Procedência do nascimento, e não marca de novidade: eu
                    // escrevi uma coisa, e o átomo pode ter achado outra. É a
                    // única linha que a slice 11 acrescenta ao átomo.
                    <p className="meta pedido">a pedido: «{a.pedido.texto}»</p>
                  )}

                  {incerto && (
                    // Destaca, não trava. A sugestão já está preenchida no
                    // seletor — só a decisão, sem explicar o motivo (o
                    // porquê mora no modal de fontes, quando houver).
                    //
                    // **Um** parágrafo por átomo, com uma linha por referência
                    // incerta — e não um bloco por referência. Esta é a tela
                    // mais apertada do sistema, e o formato é a mitigação
                    // declarada do custo (4.8.1).
                    <p className="duvida">
                      {incertas.map((i) => {
                        const escolhida = nomeFinal(i.ref.entidade);
                        return (
                          <span key={`${i.papel}${i.ordem}`}>
                            {i.papel === "sobre" ? "acho que é" : `${ondeEstaA(i)}: acho que é`}{" "}
                            <strong>{escolhida}</strong> — confirma?
                          </span>
                        );
                      })}
                    </p>
                  )}

                  {marcas.length > 0 && (
                    <p className="meta perfila">
                      vai para o perfil:{" "}
                      {marcas
                        .map((m) => `${nomeFinal(m.entidade)} · ${ROTULO_CAMPO[m.campo] ?? m.campo}`)
                        .join(" · ")}
                    </p>
                  )}

                  <div className="trechos">
                    {ancorados.map((t, k) => (
                      <button
                        key={k}
                        className="botao"
                        aria-label={`ouvir a partir de ${mmss(t.inicio_s!)}${t.ancora === "aproximada" ? ", trecho aproximado" : ""}`}
                        onClick={() => void escutar(t.inicio_s!)}
                      >
                        ▶ {mmss(t.inicio_s!)}
                        {t.ancora === "aproximada" && <span title="casamento aproximado">~</span>}
                      </button>
                    ))}
                    {ancorados.length === 0 && (
                      <span className="sem-ancora" title="o trecho não foi achado na transcrição">
                        sem áudio
                      </span>
                    )}
                    <button
                      className="botao editar"
                      onClick={() =>
                        setAbertos((s) => {
                          const n = new Set(s);
                          if (n.has(a.indice)) n.delete(a.indice);
                          else n.add(a.indice);
                          return n;
                        })
                      }
                    >
                      {aberto ? "fechar" : incerto ? "escolher" : "editar"}
                    </button>
                  </div>
                </div>
              </div>

              {aberto && (
                <div className="editor">
                  <div className="campos">
                    <select
                      value={v.tipo}
                      aria-label="tipo do átomo"
                      onChange={(e) => editarAtomo(a.indice, { tipo: e.target.value as TipoAtomo })}
                    >
                      {TIPOS_ATOMO.map((t) => (
                        <option key={t} value={t}>
                          {ROTULO_TIPO_ATOMO[t]}
                        </option>
                      ))}
                    </select>

                    {/* O filtro vale para as barras deste átomo — sujeito e
                        menções. Numa sessão que fala de projeto e de gente ao
                        mesmo tempo, é o que corta a lista pela metade. */}
                    <select
                      value={filtros[a.indice] ?? "todas"}
                      aria-label="filtrar por tipo de entidade"
                      onChange={(e) =>
                        setFiltros((s) => ({
                          ...s,
                          [a.indice]: e.target.value as TipoEntidade | "todas",
                        }))
                      }
                    >
                      <option value="todas">todas</option>
                      {TIPOS_ENTIDADE.map((t) => (
                        <option key={t} value={t}>
                          {ROTULO_TIPO_ENTIDADE[t]}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* As entidades do átomo. Um grupo rotulado, e não uma aba:
                      o átomo em dúvida abre o editor justamente para escolher
                      de quem ele é, e esconder isso atrás de mais um toque
                      custaria caro nos 60 s da tela. */}
                  <div className="entidades-do-atomo">
                    <span className="rotulo">entidades</span>

                    <div className="campo">
                      <span>sobre</span>
                      {/* A barra mostra o nome final e guarda o original:
                          renomear no rodapé aparece aqui, e o renome
                          seguinte continua seguindo este átomo. */}
                      <SeletorEntidade
                        valor={nomeFinal(v.sobre)}
                        aoMudar={(nome) => editarAtomo(a.indice, { sobre: nomeOriginal(nome) })}
                        aoCriar={(nome) => criar(nome, filtros[a.indice] ?? "todas")}
                        catalogo={catalogoDaTela}
                        filtro={filtros[a.indice] ?? "todas"}
                        sugestoes={ref.alternativas}
                        rotulo="sobre quem"
                      />
                    </div>

                    <div className="campo mencoes">
                      <span>menciona</span>
                      <div className="lista">
                        {v.menciona.map((m, k) => (
                          <SeletorEntidade
                            // O índice é a identidade aqui de propósito: a
                            // linha é a posição, e o nome muda enquanto digito.
                            key={k}
                            valor={nomeFinal(m)}
                            aoMudar={(nome) =>
                              editarAtomo(a.indice, {
                                menciona: v.menciona.map((antigo, j) =>
                                  j === k ? nomeOriginal(nome) : antigo,
                                ),
                              })
                            }
                            aoCriar={(nome) => criar(nome, filtros[a.indice] ?? "todas")}
                            aoRemover={() =>
                              editarAtomo(a.indice, {
                                menciona: v.menciona.filter((_, j) => j !== k),
                              })
                            }
                            catalogo={catalogoDaTela}
                            filtro={filtros[a.indice] ?? "todas"}
                            // As alternativas **daquela** menção (4.8.1). A
                            // lista é a da proposta enquanto eu não mexi nela;
                            // depois disso `mencoesDaProposta` fica vazia e a
                            // barra volta a abrir sem sugestão, porque o índice
                            // deslocou e a sugestão apareceria na linha errada.
                            sugestoes={mencoesDaProposta[k]?.alternativas ?? []}
                            rotulo={`menção ${k + 1}`}
                          />
                        ))}
                        <button
                          className="botao tracejado"
                          onClick={() =>
                            editarAtomo(a.indice, { menciona: [...v.menciona, ""] })
                          }
                        >
                          + menção
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {!crescendo && (
        // O "+" só existe com a proposta fechada: durante o `crescendo` o que
        // falta pode chegar na janela seguinte (slice 11).
        <div className="pedido-novo">
          {pedindo ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void pedir();
              }}
            >
              <input
                type="text"
                value={textoPedido}
                autoFocus
                maxLength={TETO_PEDIDO}
                placeholder="o que faltou?"
                aria-label="o que faltou"
                disabled={procurando}
                onChange={(e) => setTextoPedido(e.target.value)}
              />
              <button type="submit" className="botao" disabled={procurando || textoPedido.trim() === ""}>
                pedir
              </button>
              {!procurando && (
                <button
                  type="button"
                  className="botao discreto"
                  onClick={() => {
                    setPedindo(false);
                    setAvisoPedido(null);
                  }}
                >
                  fechar
                </button>
              )}
            </form>
          ) : (
            <button
              className="botao tracejado"
              aria-label="pedir o que faltou"
              onClick={() => setPedindo(true)}
            >
              +
            </button>
          )}
          {procurando && <p className="aguardando">procurando na transcrição…</p>}
          {!procurando && avisoPedido && <p className="aguardando">{avisoPedido}</p>}
        </div>
      )}

      {mudouDeVersao && (
        // Uma linha, no fim da lista, e fechada por padrão: comparar duas
        // propostas é trabalho de calibração, não de revisão — e a revisão
        // tem 60 s. Sem diff colorido e sem "melhorou/piorou": a defesa contra
        // regressão que esta fatia oferece é olho no olho, não placar.
        <div className="anterior">
          <p className="aguardando">
            esta sessão foi re-extraída · antes eram{" "}
            {plural(proposta.anterior?.atomos ?? 0, "item", "itens")}, por{" "}
            {proposta.anterior?.prompt_version}
            {anterior === null ? (
              <button className="botao discreto" onClick={() => void verAnterior()}>
                ver a anterior
              </button>
            ) : (
              <button className="botao discreto" onClick={() => setAnterior(null)}>
                fechar
              </button>
            )}
          </p>

          {anterior !== null && (
            <ol className="atomos antiga">
              {anterior.map((a) => (
                // Somente leitura: sem checkbox e sem editor. O que eu confirmo
                // é a proposta corrente; esta lista está aqui para eu olhar.
                <li key={a.indice} className="atomo">
                  <div className="linha">
                    <div className="corpo">
                      <span className="tipo">{ROTULO_TIPO_ATOMO[a.tipo] ?? a.tipo}</span>
                      <p>{a.texto}</p>
                      <p className="meta">sobre {sobreDe(a).entidade}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      <section className="entidades">
        <h2>entidades</h2>
        <p className="aguardando">
          o nome daqui vale para todos os átomos que a citam · desmarcada, fica só no texto do
          átomo e não vira nó no grafo
        </p>

        {ordenadas.map((e) => {
          const f = finalDe(e);
          const travada = travadas.has(e.nome_normalizado);
          const marcada = usada(e);
          const pedindoNome = e.precisa_nome && marcada && ehPronome(f.nome);

          return (
            <div
              key={e.nome_normalizado}
              className={`entidade${travada ? " travada" : ""}${pedindoNome ? " pedindo" : ""}`}
            >
              <input
                type="checkbox"
                checked={marcada}
                disabled={travada}
                aria-label={`incluir ${e.nome}`}
                title={travada ? "é o sujeito de um átomo aprovado" : undefined}
                onChange={() =>
                  setSemEntidade((s) => {
                    const n = new Set(s);
                    if (n.has(e.nome_normalizado)) n.delete(e.nome_normalizado);
                    else n.add(e.nome_normalizado);
                    return n;
                  })
                }
              />

              {e.conhecida ? (
                // O grafo vence: entidade que já existe mantém nome e tipo.
                <span className="nome">{e.nome}</span>
              ) : (
                <>
                  <SeletorEntidade
                    valor={f.nome}
                    // Escolher uma entidade que já existe re-aponta a candidata
                    // inteira para ela, e o tipo passa a ser o do nó: o grafo
                    // vence, aqui como na resolução.
                    aoMudar={(nome) =>
                      editarEntidade(e, { nome, tipo: resolver(catalogo, nome)?.tipo ?? f.tipo })
                    }
                    catalogo={catalogo}
                    rotulo={`nome de ${e.nome}`}
                    placeholder={pedindoNome ? "quem é?" : undefined}
                    pedindo={pedindoNome}
                  />
                  <select
                    value={f.tipo}
                    aria-label={`tipo de ${e.nome}`}
                    onChange={(ev) => editarEntidade(e, { tipo: ev.target.value as TipoEntidade })}
                  >
                    {TIPOS_ENTIDADE.map((t) => (
                      <option key={t} value={t}>
                        {ROTULO_TIPO_ENTIDADE[t]}
                      </option>
                    ))}
                  </select>
                </>
              )}

              <span className="meta">
                {pedindoNome
                  ? `quem é "${e.nome}"? · ${plural(e.ocorrencias, "menção", "menções")}`
                  : e.conhecida
                    ? `${ROTULO_TIPO_ENTIDADE[e.tipo]} · conhecida (${plural(e.sessoes, "sessão", "sessões")})`
                    : daProposta.includes(e)
                      ? `nova, citada ${e.ocorrencias}x`
                      : "nova, criada aqui"}
              </span>
            </div>
          );
        })}
      </section>

      <footer>
        {pendentes.length > 0 && (
          <p className="aguardando">
            diga quem {pendentes.length === 1 ? "é" : "são"}{" "}
            {pendentes.map((e) => `"${e.nome}"`).join(", ")} antes de confirmar
          </p>
        )}
        {/*
          A linha discreta da decisão 7: o confirmar travado precisa dizer por
          quê. Uma frase, e ela some quando a proposta fecha — sem barra de
          progresso e sem marca de "novo" em átomo nenhum. Esta é a tela mais
          apertada do sistema e ela foi enxugada de propósito.
        */}
        {travouEspera ? (
          <p className="aguardando">
            os últimos trechos não chegaram no tempo que o servidor tem para trabalhar. O que está
            aqui está inteiro no servidor — recarregue a página, ou mande extrair de novo pela lista de{" "}
            <Link href="/sessoes">sessões</Link>.
          </p>
        ) : (
          faltando && (
            <p className="aguardando">
              faltam {faltando.faltam} de {plural(faltando.total, "trecho", "trechos")}
            </p>
          )
        )}
        {falha && (
          <p className="aviso erro" role="alert">
            {falha}
          </p>
        )}
        <button
          className="confirmar"
          onClick={() => void confirmar()}
          disabled={gravando || pendentes.length > 0 || crescendo || procurando}
        >
          {/* "guardando", e não "gravando": na tela anterior, gravar é gravar áudio. */}
          {gravando ? "guardando…" : `confirmar ${plural(aprovados.length, "item", "itens")}`}
        </button>
        <Link className="botao discreto" href="/">
          depois
        </Link>
      </footer>

      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={audio} preload="none" />

      {fontesAbertas && (
        // As citações do GraphRAG saíram da vista padrão do átomo (item 2 do
        // pedido) e moraram aqui: só aparecem quando eu peço, pelo ícone ao
        // lado da entidade que a evidência resolveu.
        <>
          <div className="veu aberto" onClick={() => setFontesAbertas(null)} />
          <div
            ref={modalFontes}
            className="modal-fontes"
            role="dialog"
            aria-modal="true"
            aria-label={`fontes de ${nomeFinal(fontesAbertas.ref.entidade)}`}
          >
            <header>
              <h2>{nomeFinal(fontesAbertas.ref.entidade)}</h2>
              <button
                type="button"
                className="botao icone"
                onClick={() => setFontesAbertas(null)}
                aria-label="fechar"
              >
                ×
              </button>
            </header>
            {fontesAbertas.ref.camada && (
              <p className="motivo">{FRASE_DA_CAMADA[fontesAbertas.ref.camada]}</p>
            )}
            <ul className="citacoes">
              {fontesAbertas.ref.porque.map((e) => (
                <li key={e.atomo_id}>
                  {dataCurta(e.valido_em) !== ""
                    ? `você disse em ${dataCurta(e.valido_em)}: `
                    : "você disse: "}
                  “{e.texto}”
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </main>
  );
}
