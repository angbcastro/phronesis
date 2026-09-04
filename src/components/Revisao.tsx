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
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { SeletorEntidade } from "@/components/SeletorEntidade";
import { CATALOGO_VAZIO, montarCatalogo, resolver } from "@/lib/catalogo";
import { mencoesDe, sobreDe } from "@/lib/referencias";
import { localizarNoAudio } from "@/lib/transcricao";
import { ehPronome, normalizarNome } from "@/lib/texto";
import { CAMPOS_GESTO, TIPOS_ATOMO, TIPOS_ENTIDADE } from "@/lib/tipos";
import type { Catalogo, EntidadeDoCatalogo } from "@/lib/catalogo";
import type {
  AtomoProposto,
  BlocoAbsoluto,
  CampoPerfil,
  EntidadeCandidata,
  Gestos,
  MarcaPerfil,
  TipoAtomo,
  TipoEntidade,
} from "@/lib/tipos";

interface Proposta {
  status: string;
  extracao: {
    atomos: AtomoProposto[];
    entidades: EntidadeCandidata[];
    descartados: { motivo: string }[];
    modelo: string;
    prompt_version: string;
    prompt_version_resolucao?: string | null;
  };
  blocos: BlocoAbsoluto[];
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

/** "2026-08-12T…" → "12 de ago", no fuso de quem lê. Só a data, que é o que situa a lembrança. */
function diaMes(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");
}

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
  /** O que o extrator não viu e eu digitei. Vazio enquanto o botão não existe. */
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

export function Revisao({ id }: { id: string }) {
  const router = useRouter();
  const [proposta, setProposta] = useState<Proposta | null>(null);
  const [falha, setFalha] = useState<string | null>(null);
  const [doGrafo, setDoGrafo] = useState<EntidadeDoCatalogo[]>([]);

  const [rejeitados, setRejeitados] = useState<Set<number>>(new Set());
  const [semEntidade, setSemEntidade] = useState<Set<string>>(new Set());
  const [renomes, setRenomes] = useState<Record<string, Renome>>({});
  const [edicoes, setEdicoes] = useState<Record<number, Edicao>>({});
  const [abertos, setAbertos] = useState<Set<number>>(new Set());
  const [filtros, setFiltros] = useState<Record<number, TipoEntidade | "todas">>({});
  const [gravando, setGravando] = useState(false);

  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch(`/api/sessoes/${id}/extracao`, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(((await r.json()) as { erro?: string }).erro ?? `erro ${r.status}`);
        return (await r.json()) as Proposta;
      })
      .then((d) => vivo && setProposta(d))
      .catch((e: Error) => vivo && setFalha(e.message));
    return () => {
      vivo = false;
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
  const entidades = proposta?.extracao.entidades ?? [];

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

  const aprovados = atomos.filter((a) => !rejeitados.has(a.indice));

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

  /** Ainda é pronome, e algum átomo aprovado depende dela. */
  const pendentes = entidades.filter(
    (e) => e.precisa_nome && usada(e) && ehPronome(finalDe(e).nome),
  );

  /** Atribuições que o agente não teve certeza. Destacam, não travam. */
  const duvidosos = aprovados.filter((a) => !referenciaDe(a).certo);

  /** Pendente primeiro: é o que precisa da minha atenção. */
  const ordenadas = useMemo(
    () => [...entidades].sort((a, b) => Number(b.precisa_nome) - Number(a.precisa_nome)),
    [entidades],
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

  async function confirmar() {
    if (!proposta || gravando || pendentes.length > 0) return;
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
            texto: v.texto,
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
      gestos: montarGestos({
        edicoes,
        entidades,
        finalDe,
        recusadas: new Set(naoUsadas.map((e) => e.nome_normalizado)),
      }),
    };

    const r = await fetch(`/api/sessoes/${id}/confirmar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    }).catch(() => null);

    if (!r || !r.ok) {
      const motivo = r ? ((await r.json()) as { erro?: string }).erro : "sem resposta do servidor";
      setFalha(motivo ?? "falhou");
      setGravando(false);
      return;
    }
    router.push("/");
  }

  if (falha && !proposta) {
    return (
      <main className="leitura">
        <h1>revisão</h1>
        <p className="aguardando">{falha}</p>
      </main>
    );
  }

  if (!proposta) {
    return (
      <main className="leitura">
        <h1>revisão</h1>
        <p className="aguardando">…</p>
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
      </header>

      <ol className="atomos">
        {atomos.map((a) => {
          const rejeitado = rejeitados.has(a.indice);
          const aberto = abertos.has(a.indice);
          const v = valorDe(a);
          const ref = referenciaDe(a);
          const sobre = nomeFinal(v.sobre);
          const incerto = !ref.certo;
          // Do valor editado, não da proposta: tirar uma menção tem de sumir
          // com ela da linha de resumo na hora, sem eu fechar o editor.
          const mencoes = v.menciona
            .map(nomeFinal)
            .filter((m) => m !== "" && normalizarNome(m) !== normalizarNome(sobre));
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
                  aria-label="manter este item"
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
                  <span className="tipo">{v.tipo}</span>
                  <p>{v.texto}</p>
                  <p className="meta">
                    sobre {sobre}
                    {mencoes.length > 0 && ` · menciona ${mencoes.join(", ")}`}
                  </p>

                  {incerto && (
                    // Destaca, não trava. A sugestão já está preenchida no
                    // seletor; o motivo é o que me deixa decidir em um segundo.
                    <p className="duvida">
                      de quem é? escolhi <strong>{sobre}</strong>
                      {ref.citado !== "" && ref.citado !== sobre && ` para "${ref.citado}"`}
                      {ref.motivo !== "" && ` — ${ref.motivo}`}
                      {ref.alternativas.length > 0 && ` · também podia ser ${ref.alternativas.join(", ")}`}
                    </p>
                  )}

                  {incerto && ref.porque.length > 0 && (
                    // O porquê da camada dos vizinhos (slice 4.5). Ela sugere
                    // por semelhança com átomos que já são de alguém, o que é
                    // herdar atribuição passada — e a única coisa que torna
                    // isso aceitável é estar na tela, com o átomo à mão. Sem
                    // esta lista, a camada não entraria.
                    <ul className="porque">
                      {ref.porque.map((e) => (
                        <li key={e.atomo_id}>
                          parece com o que você disse
                          {diaMes(e.valido_em) !== "" && ` em ${diaMes(e.valido_em)}`}:{" "}
                          <span>“{e.texto}”</span>
                        </li>
                      ))}
                    </ul>
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
                      <button key={k} className="ouvir" onClick={() => void escutar(t.inicio_s!)}>
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
                      className="editar"
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
                  <textarea
                    value={v.texto}
                    rows={3}
                    aria-label="texto do átomo"
                    onChange={(e) => editarAtomo(a.indice, { texto: e.target.value })}
                  />
                  <div className="campos">
                    <select
                      value={v.tipo}
                      aria-label="tipo do átomo"
                      onChange={(e) => editarAtomo(a.indice, { tipo: e.target.value as TipoAtomo })}
                    >
                      {TIPOS_ATOMO.map((t) => (
                        <option key={t} value={t}>
                          {t}
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
                          {t.toLowerCase()}
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
                      <SeletorEntidade
                        valor={v.sobre}
                        aoMudar={(nome) => editarAtomo(a.indice, { sobre: nome })}
                        catalogo={catalogo}
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
                            valor={m}
                            aoMudar={(nome) =>
                              editarAtomo(a.indice, {
                                menciona: v.menciona.map((antigo, j) => (j === k ? nome : antigo)),
                              })
                            }
                            aoRemover={() =>
                              editarAtomo(a.indice, {
                                menciona: v.menciona.filter((_, j) => j !== k),
                              })
                            }
                            catalogo={catalogo}
                            filtro={filtros[a.indice] ?? "todas"}
                            rotulo={`menção ${k + 1}`}
                          />
                        ))}
                        <button
                          className="acrescentar"
                          onClick={() =>
                            editarAtomo(a.indice, { menciona: [...v.menciona, ""] })
                          }
                        >
                          + menção
                        </button>
                      </div>
                    </div>
                  </div>

                  <p className="aguardando">
                    aqui muda só este átomo — para trocar um nome em todos de uma vez, edite a
                    entidade lá embaixo
                  </p>
                </div>
              )}
            </li>
          );
        })}
      </ol>

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
                        {t.toLowerCase()}
                      </option>
                    ))}
                  </select>
                </>
              )}

              <span className="meta">
                {pedindoNome
                  ? `quem é "${e.nome}"? · ${e.ocorrencias} menção(ões)`
                  : e.conhecida
                    ? `${e.tipo.toLowerCase()} · conhecida (${e.sessoes} sessões)`
                    : `nova, citada ${e.ocorrencias}x`}
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
        {falha && <p className="aguardando">{falha}</p>}
        <button
          className="confirmar"
          onClick={() => void confirmar()}
          disabled={gravando || pendentes.length > 0}
        >
          {gravando ? "gravando…" : `confirmar ${aprovados.length} item(ns)`}
        </button>
        <Link className="voltar" href="/">
          depois
        </Link>
      </footer>

      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={audio} preload="none" />
    </main>
  );
}
