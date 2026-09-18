/**
 * O prompt, o modelo e o limiar que eu editei na tela — o pedaço da configuração
 * dos agentes que não mora no git.
 *
 * **Decalcado de `regras.ts`, e pelas mesmas razões**, que estão escritas lá por
 * extenso: R2 porque serverless não tem disco gravável nem compartilhado;
 * snapshot imutável por hash porque `prompt_version` carrega o hash e um átomo
 * de três meses atrás precisa resolver o texto que o produziu; **sem cache de
 * instância** porque ele faria "salvei, vale na próxima" ser falso de um jeito
 * que ninguém vê — função serverless quente guarda estado de módulo entre
 * requisições, e o prompt velho continuaria valendo depois de eu salvar o novo.
 *
 * **Desde a slice 8 há cache por invocação, e ele não fura essa decisão**: a
 * próxima invocação começa com o mapa vazio e lê de novo (`invocacao.ts`). O que
 * ele elimina é a repetição dentro do mesmo trabalho — ver `configAgentes`.
 *
 * **Nunca propaga erro na leitura.** R2 fora do ar não pode impedir uma sessão
 * de ser transcrita ou extraída: sem override, o agente sai byte a byte igual ao
 * de antes desta fatia. A falha degrada para o comportamento bom, não para
 * nenhum — e é isso que torna a slice inteira um no-op até o meu primeiro toque.
 *
 * **Este módulo não sabe quais agentes existem.** Ele recebe o id e a base como
 * argumento, e é de propósito: o registro (`agentes.ts`) importa os módulos de
 * agente, e cada agente importa este. Se ele importasse o registro,
 * o ciclo fecharia — e ciclo de módulo com `const` no topo vira `undefined` em
 * tempo de execução, que é a pior forma de descobrir o problema.
 */
import { chaveAgentes, chavePromptAgente } from "./chaves";
import { umaVezPorInvocacao } from "./invocacao";
import { ConflitoR2Error, getJson, putJson } from "./r2";
import { hashDeTexto } from "./regras";
import type { AgenteId, ConfigAgentes, OverrideDeAgente, VersaoDePrompt } from "./tipos";

const VAZIA: ConfigAgentes = { overrides: {}, atualizado_em: "" };

/**
 * O índice inteiro, ou vazio. **Uma leitura por invocação** desde a slice 8.
 *
 * Era uma por chamada de agente, com o preço declarado: uma na extração, uma na
 * resolução, uma por bloco no STT — trinta numa sessão gravada de 15 min. O que
 * fez o preço deixar de ser aceitável foi o desempate (4.11), que roda em
 * `Promise.all`: N menções abaixo do limiar viravam **N GETs simultâneos do
 * mesmo objeto**, dentro do `waitUntil` que a fatia 8 está tentando encurtar.
 *
 * O cache é do escopo da invocação, não da instância (`invocacao.ts`), e é essa
 * diferença que preserva a promessa do cabeçalho: salvar no painel vale na
 * próxima sessão, porque a próxima invocação lê de novo. Fora de um contexto de
 * invocação — toda rota que não é do pipeline — nada é guardado, e a função se
 * comporta exatamente como antes.
 */
export async function configAgentes(): Promise<ConfigAgentes> {
  return umaVezPorInvocacao("config/agentes", async () => {
    try {
      const o = await getJson<ConfigAgentes>(chaveAgentes());
      const v = o?.valor;
      if (!v || typeof v !== "object" || typeof v.overrides !== "object" || v.overrides === null) {
        return VAZIA;
      }
      return v;
    } catch (e) {
      console.error("[overrides] não consegui ler a configuração, seguindo com a base:", e);
      return VAZIA;
    }
  });
}

/** O mesmo, com o etag — só o caminho de escrita precisa dele. */
async function configComEtag(): Promise<{ valor: ConfigAgentes; etag: string | null }> {
  const o = await getJson<ConfigAgentes>(chaveAgentes());
  const v = o?.valor;
  const ok = v && typeof v === "object" && typeof v.overrides === "object" && v.overrides !== null;
  return { valor: ok ? v : VAZIA, etag: o?.etag ?? null };
}

/** Um prompt editado, pelo hash. É como um átomo antigo resolve o carimbo dele. */
export async function versaoDePrompt(
  agente: AgenteId,
  hash: string,
): Promise<VersaoDePrompt | null> {
  try {
    const o = await getJson<VersaoDePrompt>(chavePromptAgente(agente, hash));
    return o?.valor ?? null;
  } catch (e) {
    console.error(`[overrides] não consegui ler o prompt ${agente}+${hash}:`, e);
    return null;
  }
}

/** Número de verdade, entre 0 e 1. O resto conta como ausente. */
export const ehLimiar = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;

export interface Efetivo {
  /** O prompt em vigor. Igual à base quando não há override. */
  prompt: string;
  /** O modelo em vigor, já validado por quem passou o padrão. */
  modelo: string;
  /**
   * O limiar em vigor (slice 4.11), quando quem chamou passou uma base para ele.
   * `undefined` em todo agente que não tem limiar — só a resolução tem.
   */
  limiar?: number;
  /**
   * O hash do prompt em vigor, ou `null` quando é a base.
   *
   * `null` é o que faz `prompt_version` sair sem sufixo — e um carimbo tem de
   * ser verdadeiro por omissão. Se o R2 falhar no meio, o prompt usado foi a
   * base, e o hash tem de dizer isso.
   */
  hash: string | null;
}

/**
 * O que este agente vai de fato usar nesta chamada.
 *
 * Uma função só, e não um par `promptEfetivo`/`modeloEfetivo`, para o call site
 * pagar **uma** leitura do índice em vez de duas. O segundo GET só acontece
 * quando há prompt editado — e aí ele é o objeto imutável daquele hash.
 */
export async function efetivo(
  id: AgenteId,
  base: { prompt?: string; modelo: string; limiar?: number },
): Promise<Efetivo> {
  const cfg = await configAgentes();
  return resolver(id, base, cfg);
}

/** O mesmo, sobre um índice já lido — é o que a tela usa para os oito de uma vez. */
export async function resolver(
  id: AgenteId,
  base: { prompt?: string; modelo: string; limiar?: number },
  cfg: ConfigAgentes,
): Promise<Efetivo> {
  const over = cfg.overrides[id];
  const prompt = base.prompt ?? "";
  const modelo = typeof over?.modelo === "string" && over.modelo.trim() !== "" ? over.modelo : base.modelo;

  // O limiar só existe para quem passou uma base dele — hoje, só a resolução.
  // Número fora de [0,1] no arquivo é ignorado como se não estivesse lá: o
  // arquivo é meu, mas ele não pode desligar a segunda passada por um typo.
  const limiar =
    base.limiar === undefined
      ? undefined
      : ehLimiar(over?.limiar)
        ? over.limiar
        : base.limiar;

  const comum = { prompt, modelo, ...(limiar === undefined ? {} : { limiar }) };

  const hash = typeof over?.prompt_hash === "string" ? over.prompt_hash : null;
  if (hash === null || base.prompt === undefined) return { ...comum, hash: null };

  const versao = await versaoDePrompt(id, hash);
  // Ponteiro sem objeto: o índice aponta para um prompt que não está lá. Cair na
  // base é o certo — e o hash volta `null` junto, senão o átomo sairia carimbado
  // com uma versão que não foi a usada.
  if (!versao || typeof versao.texto !== "string" || versao.texto.trim() === "") {
    console.error(`[overrides] ${id}: o hash ${hash} não resolve texto nenhum, usando a base`);
    return { ...comum, hash: null };
  }

  return { ...comum, prompt: versao.texto, hash };
}


/**
 * A versão que vai carimbada (regra 7): `resolucao-2` sem override,
 * `resolucao-2+p1b2c3d4` com.
 *
 * **O `p` não é enfeite: ele diz por qual chave o hash resolve.** A extração já
 * carimbava `extracao-6+a3f91c7d` para as regras aprovadas, e aquele hash se
 * acha em `calibracao/regras-<hash>.json`; este se acha em
 * `config/prompt-<agente>-<hash>.json`. São dois objetos diferentes, e um
 * átomo com prompt editado **e** regra aprovada carrega os dois sufixos
 * (`extracao-6+p1b2c3d4+a3f91c7d`) justamente porque um hash só não teria como
 * resolver os dois. Sem prefixo, ler um carimbo antigo viraria adivinhação.
 */
export const carimbo = (versaoBase: string, hash: string | null): string =>
  hash === null ? versaoBase : `${versaoBase}+p${hash}`;

/** O hash do que de fato foi mandado ao modelo. Reexportado para os call sites. */
export { hashDeTexto };

/**
 * Grava o override de um agente. **O único caminho de escrita.**
 *
 * `prompt`/`modelo` seguem a mesma semântica de `POST /api/calibracao/regras`:
 * o corpo diz o que deve valer daqui para frente, e `null` revoga aquele campo e
 * volta à base do git. `undefined` não mexe no campo.
 *
 * O snapshot vai com `ifNoneMatch: "*"` porque é imutável: reaprovar o mesmo
 * texto encontra o que já está lá e não escreve de novo — o conflito **é** o
 * resultado esperado, e não uma falha.
 */
export async function gravarOverride(
  id: AgenteId,
  mudanca: { prompt?: string | null; modelo?: string | null; limiar?: number | null },
  agora: string = new Date().toISOString(),
): Promise<OverrideDeAgente> {
  const { valor: cfg, etag } = await configComEtag();
  const atual = cfg.overrides[id];

  let prompt_hash = atual?.prompt_hash ?? null;
  if (mudanca.prompt === null) {
    prompt_hash = null;
  } else if (typeof mudanca.prompt === "string") {
    prompt_hash = await gravarVersaoDePrompt(id, mudanca.prompt, prompt_hash, agora);
  }

  let modelo = atual?.modelo ?? null;
  if (mudanca.modelo === null) modelo = null;
  else if (typeof mudanca.modelo === "string") modelo = mudanca.modelo;

  let limiar = atual?.limiar ?? null;
  if (mudanca.limiar === null) limiar = null;
  else if (typeof mudanca.limiar === "number") limiar = mudanca.limiar;

  const novo: OverrideDeAgente = { prompt_hash, modelo, limiar, atualizado_em: agora };

  const overrides = { ...cfg.overrides };
  // Override que não muda nada sai do índice inteiro: um objeto só com `null`
  // faria a tela dizer "editado" sobre um agente que está na base.
  if (prompt_hash === null && modelo === null && limiar === null) delete overrides[id];
  else overrides[id] = novo;

  await putJson(
    chaveAgentes(),
    { overrides, atualizado_em: agora } satisfies ConfigAgentes,
    etag ? { ifMatch: etag } : { ifNoneMatch: "*" },
  );

  return novo;
}

/**
 * O snapshot imutável, e o hash dele.
 *
 * O hash sai do **conteúdo**: salvar o mesmo texto duas vezes dá o mesmo hash e
 * não cria versão nova, e desfazer uma edição voltando o texto ao original
 * devolve o carimbo original. É o que faz `prompt_version` ser verificável em
 * vez de cronológico.
 */
export async function gravarVersaoDePrompt(
  agente: AgenteId,
  texto: string,
  anterior: string | null,
  criada_em: string = new Date().toISOString(),
): Promise<string> {
  const hash = hashDeTexto(texto);
  const chave = chavePromptAgente(agente, hash);

  if (await getJson<VersaoDePrompt>(chave)) return hash;

  const versao: VersaoDePrompt = { agente, hash, texto, anterior, criada_em };
  try {
    await putJson(chave, versao, { ifNoneMatch: "*" });
  } catch (e) {
    // Alguém gravou o mesmo texto entre a leitura e a escrita. O objeto existir
    // é o resultado que eu queria: o conteúdo é idêntico por construção.
    if (!(e instanceof ConflitoR2Error)) throw e;
  }
  return hash;
}
