/**
 * O laço read-modify-write condicional por etag, num lugar só.
 *
 * É o desenho que todo objeto do R2 com mais de um escritor usa neste sistema:
 * ler com o etag, aplicar um mutador **puro** sobre o que acabou de ser lido,
 * gravar com `If-Match`, e em conflito reler e reaplicar. É o que faz duas
 * escritas quase simultâneas se **somarem** em vez de a segunda apagar a
 * primeira — e sem `LIST` no R2 (`r2.ts`), o que uma escrita apaga é
 * inalcançável para sempre.
 *
 * Ele estava copiado três vezes — `manifest.ts`, `janela.ts` e `calibracao.ts`
 * —, com a dívida declarada no docstring de `atualizarParcial` e no §14. A
 * quarta cópia seria a das medidas (slice 8), e quatro é onde uma correção
 * passa a alcançar só três.
 *
 * **Módulo próprio, e não uma função em `r2.ts`**, por um motivo de teste que é
 * estrutural: meia dúzia de arquivos de `tests/` trocam `@/lib/r2` inteiro por
 * uma fábrica com `getJson`/`putJson` mockados. Se o laço morasse lá, cada
 * fábrica dessas precisaria passar a fornecê-lo também — e quem esquecesse
 * receberia `undefined is not a function` no meio de outro teste. Daqui ele
 * **consome** o `r2.ts` mockado, e os mocks que já existem continuam valendo.
 *
 * O que ele não faz: decidir o que é conflito (isso é `ConflitoR2Error`, do
 * `r2.ts`) e conhecer o formato de nenhum dos quatro objetos. Cada chamador traz
 * o seu `normalizar` e o seu mutador.
 */
import { ConflitoR2Error, getJson, putJson } from "./r2";

export interface OpcoesAtualizacao {
  /** Quantas voltas antes de desistir. */
  tentativas?: number;
  /** A espera da primeira colisão, dobrando a cada volta. */
  base_ms?: number;
  /** Teto de uma espera — sem ele, dez tentativas viram dezenas de segundos. */
  teto_ms?: number;
  /** O nome do objeto na frase de quem desistiu. Por omissão, a chave. */
  rotulo?: string;
  /** Injetável no teste, para não dormir de verdade. */
  dormir?: (ms: number) => Promise<unknown>;
}

const dormirDeVerdade = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Aplica `mutador` ao objeto e grava condicionalmente.
 *
 * `normalizar` recebe o que estava lá — ou `undefined`, quando o objeto ainda
 * não existe — e devolve a base sobre a qual o mutador roda. É por ele que
 * `manifest.ts` materializa o manifest vazio e `calibracao.ts` conserta o índice
 * escrito por uma versão anterior do tipo. **Ele roda a cada volta**, e não uma
 * vez no começo: o mutador tem de ver o corrente, não o que foi lido antes de
 * alguém gravar por cima.
 *
 * `mudou` é a resposta a "a escrita foi minha?", e é isso que faz a
 * reivindicação de uma janela ou de um bloco ser uma trava de verdade: quem
 * recebe `false` sabe que outro worker chegou primeiro.
 *
 * O mutador devolve `null` para dizer "não é para gravar" — a reivindicação que
 * não pode acontecer —, e o **mesmo objeto** que recebeu para dizer "nada
 * mudou". Os dois casos economizam o PUT; a diferença é que o segundo ainda
 * grava quando o objeto não existia, porque criá-lo **é** a mudança.
 */
export async function atualizarJson<T>(
  key: string,
  normalizar: (cru: T | undefined) => T,
  mutador: (atual: T) => T | null,
  opcoes: OpcoesAtualizacao = {},
): Promise<{ valor: T; mudou: boolean }> {
  const {
    tentativas = 6,
    base_ms = 40,
    teto_ms = Number.POSITIVE_INFINITY,
    rotulo = key,
    dormir = dormirDeVerdade,
  } = opcoes;

  for (let tentativa = 0; tentativa < tentativas; tentativa++) {
    const atual = await getJson<T>(key);
    const base = normalizar(atual?.valor);
    const novo = mutador(base);

    if (novo === null) return { valor: base, mudou: false };
    if (novo === base && atual) return { valor: base, mudou: false };

    try {
      await putJson(key, novo, atual?.etag ? { ifMatch: atual.etag } : { ifNoneMatch: "*" });
      return { valor: novo, mudou: true };
    } catch (e) {
      if (!(e instanceof ConflitoR2Error)) throw e;
      const espera = Math.min(base_ms * 2 ** tentativa, teto_ms);
      await dormir(espera + Math.random() * 40);
    }
  }

  throw new Error(`Não consegui gravar ${rotulo} após ${tentativas} tentativas`);
}
