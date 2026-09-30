"use client";

/**
 * O painel do "eu" em `/entidades` — o retrato no lugar da ficha (slice 10).
 *
 * A ficha de quatro campos não serve ao "eu": quase tudo o que o diário
 * registra é sobre ele. Aqui ela vira um retrato por dimensões da minha vida,
 * que eu leio seção por seção:
 *
 * - **o Agora no topo**, com o "até" ao lado — depois de três meses sem gravar,
 *   o Agora é de três meses atrás, e sem a data ele pareceria presente;
 * - **uma seção por dimensão**, na ordem que eu aprovei. Seção de dimensão que
 *   saiu da lista não aparece, mesmo que ainda esteja no `eu.json`;
 * - **o (i) de cada seção**: os trechos que a sustentaram, lidos do grafo pelo
 *   id. O átomo que depois foi rejeitado ou arquivado aparece riscado, e não
 *   some — o (i) diz o que sustentou a seção quando ela foi escrita;
 * - **as dimensões**: editar, tirar, criar, reordenar; e "pedir nova proposta",
 *   que chega **ao lado** da lista atual e só vale se eu aceitar. Sem "juntar":
 *   é editar uma e tirar a outra;
 * - **reescrever** e **desfazer** — um botão, os dois lados (o nó e o R2).
 *
 * Tudo aqui passa pelas rotas de `/api/entidades/retrato/`, atrás do
 * middleware. Este componente não sabe do grafo nem do R2.
 */
import { useCallback, useEffect, useState } from "react";
import {
  ID_AGORA,
  mesAno,
  type ConfigRetrato,
  type DimensaoDoRetrato,
  type Enriquecimento,
  type RetratoDoEu as Retrato,
  type SecaoDoRetrato,
} from "@/lib/tipos";

interface Fonte {
  id: string;
  texto: string;
  tipo: string;
  valido_em: string;
  status: string;
}

/** Uma dimensão na edição: sem `id` quando é nova — quem dá o id é o servidor. */
interface DimensaoEditada {
  id?: string;
  nome: string;
  o_que_entra: string;
}

export interface SecaoNaTela {
  id: string;
  nome: string;
  /** `null` quando a dimensão é nova e nenhuma rodada a escreveu ainda. */
  secao: SecaoDoRetrato | null;
}

/**
 * O que a tela desenha, e em que ordem: o Agora, depois as dimensões aprovadas
 * na ordem da lista. **Seção cujo `id` não está em `dimensoes` não aparece** —
 * ela fica no `eu.json` até a próxima rodada, e no `anterior` por mais uma.
 */
export function secoesVisiveis(retrato: Retrato | null, config: ConfigRetrato): SecaoNaTela[] {
  const secoes = retrato?.secoes ?? {};
  return [
    { id: ID_AGORA, nome: "Agora", secao: secoes[ID_AGORA] ?? null },
    ...config.dimensoes.map((d) => ({ id: d.id, nome: d.nome, secao: secoes[d.id] ?? null })),
  ];
}

/** Troca a dimensão `i` de lugar com a vizinha. Fora dos limites, nada muda. */
export function moverDimensao<T>(lista: readonly T[], i: number, delta: -1 | 1): T[] {
  const j = i + delta;
  if (i < 0 || i >= lista.length || j < 0 || j >= lista.length) return [...lista];
  const nova = [...lista];
  [nova[i], nova[j]] = [nova[j], nova[i]];
  return nova;
}

const mesmaLista = (a: readonly DimensaoEditada[], b: readonly DimensaoDoRetrato[]) =>
  a.length === b.length &&
  a.every((d, i) => d.id === b[i].id && d.nome === b[i].nome && d.o_que_entra === b[i].o_que_entra);

const dia = (iso: string) => (iso === "" ? "" : iso.slice(0, 10).split("-").reverse().join("/"));

const erroDe = async (r: Response | null) =>
  r ? (((await r.json().catch(() => ({}))) as { erro?: string }).erro ?? "falhou") : "sem resposta";

export function RetratoDoEu({
  enriquecimento,
  contexto,
  aoMudar,
}: {
  enriquecimento: Enriquecimento;
  /** O `contexto` curto do nó — a fase 1 da rodada o escreve. */
  contexto: string;
  /** Recarrega a lista de entidades: é a linha que conta o estado da rodada. */
  aoMudar: () => void;
}) {
  const [retrato, setRetrato] = useState<Retrato | null>(null);
  const [config, setConfig] = useState<ConfigRetrato | null>(null);
  const [temAnterior, setTemAnterior] = useState(false);
  const [falha, setFalha] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  /** A lista em edição. `null` = a que está gravada. */
  const [edicao, setEdicao] = useState<DimensaoEditada[] | null>(null);
  /** O (i) aberto, por id de seção, com as fontes já lidas. */
  const [fontes, setFontes] = useState<Record<string, Fonte[] | "lendo">>({});

  const ler = useCallback(async () => {
    const r = await fetch("/api/entidades/retrato", { cache: "no-store" }).catch(() => null);
    if (!r?.ok) {
      setFalha(`não deu para ler o retrato: ${await erroDe(r)}`);
      return;
    }
    const v = (await r.json()) as { retrato: Retrato | null; config: ConfigRetrato; tem_anterior: boolean };
    setRetrato(v.retrato);
    setConfig(v.config);
    setTemAnterior(v.tem_anterior);
  }, []);

  // Relê quando a rodada muda de estado — é o carimbo que a lista já traz, e é
  // o que faz o retrato novo aparecer quando a fila termina com a tela aberta.
  useEffect(() => {
    void ler();
  }, [ler, enriquecimento.estado, enriquecimento.em]);

  async function postar(rota: string, corpo: unknown, rotulo: string) {
    setOcupado(rotulo);
    setFalha(null);
    const r = await fetch(rota, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo ?? {}),
    }).catch(() => null);
    setOcupado(null);
    if (!r?.ok) {
      setFalha(await erroDe(r));
      return null;
    }
    return r.json() as Promise<Record<string, unknown>>;
  }

  async function salvarDimensoes() {
    if (!edicao) return;
    const v = await postar("/api/entidades/retrato/dimensoes", { dimensoes: edicao }, "dimensoes");
    if (!v) return;
    setConfig(v.config as ConfigRetrato);
    setEdicao(null);
  }

  async function responderSugestao(gesto: "aceitar" | "descartar") {
    const v = await postar("/api/entidades/retrato/dimensoes", { [gesto]: true }, gesto);
    if (!v) return;
    setConfig(v.config as ConfigRetrato);
    setEdicao(null);
  }

  async function pedirProposta() {
    const v = await postar("/api/entidades/retrato/proposta", {}, "proposta");
    if (v) setConfig(v.config as ConfigRetrato);
  }

  /** A rodada inteira. A resposta espera — são duas fases, e pode levar minutos. */
  async function reescrever() {
    await postar("/api/entidades/enriquecer", { chave: "eu" }, "reescrever");
    aoMudar();
    void ler();
  }

  /** Um botão, os dois lados. Outro toque traz de volta. */
  async function desfazer() {
    const v = await postar("/api/entidades/retrato/desfazer", {}, "desfazer");
    if (v) aoMudar();
    void ler();
  }

  async function alternarFontes(id: string, ids: string[]) {
    if (fontes[id]) {
      setFontes(({ [id]: _fora, ...resto }) => resto);
      return;
    }
    setFontes((f) => ({ ...f, [id]: "lendo" }));
    const r = await fetch("/api/entidades/retrato/fontes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    }).catch(() => null);
    if (!r?.ok) {
      setFalha(await erroDe(r));
      setFontes(({ [id]: _fora, ...resto }) => resto);
      return;
    }
    const lidas = ((await r.json()) as { fontes: Fonte[] }).fontes;
    setFontes((f) => ({ ...f, [id]: lidas }));
  }

  if (!config) {
    return (
      <div className="secao">
        <p className="aguardando">{falha ?? "lendo o retrato…"}</p>
      </div>
    );
  }

  const lista: DimensaoEditada[] = edicao ?? config.dimensoes;
  const mexida = edicao !== null && !mesmaLista(edicao, config.dimensoes);
  const mudar = (i: number, campo: "nome" | "o_que_entra", valor: string) =>
    setEdicao(lista.map((d, j) => (j === i ? { ...d, [campo]: valor } : d)));
  const rodando = enriquecimento.estado === "rodando" || enriquecimento.estado === "na_fila";

  return (
    <>
      {falha && <p className="aviso">{falha}</p>}

      {contexto !== "" && (
        <div className="secao">
          <p className="aguardando">
            a ficha curta — o que os outros agentes leem, e o vetor de busca do &ldquo;eu&rdquo;
          </p>
          <p className="retrato-texto">{contexto}</p>
        </div>
      )}

      {/* O retrato, seção por seção. */}
      <div className="secao retrato">
        {retrato === null && (
          <p className="aguardando">
            nenhuma rodada escreveu o retrato ainda. A primeira escreve o Agora e pede a proposta
            de dimensões.
          </p>
        )}
        {secoesVisiveis(retrato, config).map(({ id, nome, secao }) => {
          const aberto = fontes[id];
          return (
            <section key={id} className="retrato-secao" aria-label={nome}>
              <h3>
                {nome}
                {secao && mesAno(secao.ate) !== "" && (
                  <span className="meta"> até {mesAno(secao.ate)}</span>
                )}
                {secao && secao.fontes.length > 0 && (
                  <button
                    className="info-fontes"
                    aria-expanded={aberto !== undefined}
                    aria-label={`os trechos que sustentaram ${nome}`}
                    title="os trechos principais que sustentaram esta seção"
                    onClick={() => void alternarFontes(id, secao.fontes)}
                  >
                    i
                  </button>
                )}
              </h3>
              {secao === null ? (
                <p className="aguardando">aparece na próxima rodada</p>
              ) : secao.texto === "" ? (
                <p className="aguardando">sem material nesta rodada</p>
              ) : (
                secao.texto
                  .split(/\n{2,}/)
                  .map((p, i) => (
                    <p key={i} className="retrato-texto">
                      {p}
                    </p>
                  ))
              )}
              {aberto === "lendo" && <p className="aguardando">lendo os trechos…</p>}
              {Array.isArray(aberto) && (
                <ul className="retrato-fontes">
                  {aberto.map((f) => (
                    <li key={f.id} className={f.status === "ativo" ? "" : "saiu"}>
                      <span className="meta">
                        {f.tipo} · {dia(f.valido_em) || "sem data"}
                        {f.status === "ativo" ? "" : ` · ${f.status} depois`}
                      </span>
                      <span className="texto-fonte">{f.texto}</span>
                    </li>
                  ))}
                  {aberto.length === 0 && (
                    <li className="aguardando">nenhum dos trechos existe mais no grafo</li>
                  )}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      {/* A rodada e o que a desfaz — à vista de quem acabou de ler o retrato. */}
      <div className="secao">
        <p className="aguardando">
          o agente lê TODOS os átomos do &ldquo;eu&rdquo; uma vez por seção e reescreve o retrato
          inteiro — e grava, sem eu aprovar seção a seção. Toda segunda-feira, se houve átomo novo.
        </p>
        <div className="acoes-sessao">
          <button
            className="reextrair"
            disabled={ocupado !== null || rodando}
            onClick={() => void reescrever()}
          >
            {ocupado === "reescrever" || rodando ? "escrevendo…" : "reescrever o retrato"}
          </button>
          {(enriquecimento.tem_anterior || temAnterior) && (
            <button
              className="reextrair"
              disabled={ocupado !== null || rodando}
              title="volta o retrato e a ficha curta para a geração anterior — outro toque traz de volta"
              onClick={() => void desfazer()}
            >
              {ocupado === "desfazer" ? "voltando…" : "desfazer"}
            </button>
          )}
        </div>
      </div>

      {/* As dimensões: o agente propõe, eu aprovo. */}
      <div className="secao">
        <p className="aguardando">
          dimensões — como o retrato divide a minha vida. Mudar aqui vale a partir da próxima
          rodada.
        </p>
        {config.dimensoes.length === 0 && config.sugestao && (
          <p className="aviso-retrato">
            ainda não há dimensão aprovada: leia a proposta abaixo e aceite, ou edite antes.
          </p>
        )}

        {lista.map((d, i) => (
          <div className="campo-perfil dimensao" key={d.id ?? `nova-${i}`}>
            <div className="acoes-sessao">
              <input
                className="campo-nome"
                aria-label={`nome da dimensão ${i + 1}`}
                value={d.nome}
                maxLength={60}
                onChange={(ev) => mudar(i, "nome", ev.target.value)}
              />
              <button
                className="reextrair"
                aria-label={`subir ${d.nome}`}
                disabled={i === 0}
                onClick={() => setEdicao(moverDimensao(lista, i, -1))}
              >
                ↑
              </button>
              <button
                className="reextrair"
                aria-label={`descer ${d.nome}`}
                disabled={i === lista.length - 1}
                onClick={() => setEdicao(moverDimensao(lista, i, 1))}
              >
                ↓
              </button>
              <button
                className="reextrair"
                aria-label={`tirar ${d.nome}`}
                onClick={() => setEdicao(lista.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </div>
            <textarea
              rows={2}
              aria-label={`o que entra em ${d.nome}`}
              placeholder="que trechos pertencem a esta dimensão"
              value={d.o_que_entra}
              maxLength={400}
              onChange={(ev) => mudar(i, "o_que_entra", ev.target.value)}
            />
          </div>
        ))}

        <div className="acoes-sessao">
          <button
            className="reextrair"
            onClick={() => setEdicao([...lista, { nome: "", o_que_entra: "" }])}
          >
            + dimensão
          </button>
          <button
            className="reextrair"
            disabled={!mexida || ocupado !== null || lista.some((d) => d.nome.trim() === "")}
            onClick={() => void salvarDimensoes()}
          >
            {ocupado === "dimensoes" ? "salvando…" : "salvar dimensões"}
          </button>
          {edicao !== null && (
            <button className="reextrair" onClick={() => setEdicao(null)}>
              desfazer edição
            </button>
          )}
          <button
            className="reextrair"
            disabled={ocupado !== null}
            title="o agente lê todos os átomos do eu e propõe a lista inteira — ela chega ao lado da atual, e nada muda sem eu aceitar"
            onClick={() => void pedirProposta()}
          >
            {ocupado === "proposta" ? "propondo…" : "pedir nova proposta"}
          </button>
        </div>

        {config.sugestao && (
          // Ao lado, nunca por cima: a lista atual é minha.
          <div className="proposta-perfil">
            <p className="meta">proposta do agente — {config.sugestao.length} dimensão(ões)</p>
            <ol className="sugestao-dimensoes">
              {config.sugestao.map((d) => (
                <li key={d.id}>
                  <strong>{d.nome}</strong>
                  {d.o_que_entra !== "" && <span className="meta"> — {d.o_que_entra}</span>}
                </li>
              ))}
            </ol>
            <div className="acoes-sessao">
              <button
                className="reextrair"
                disabled={ocupado !== null}
                onClick={() => void responderSugestao("aceitar")}
              >
                aceitar
              </button>
              <button
                className="reextrair"
                disabled={ocupado !== null}
                onClick={() => void responderSugestao("descartar")}
              >
                descartar
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
