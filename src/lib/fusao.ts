/**
 * Escrita de manutenção de entidade: fundir, renomear, trocar tipo, criar,
 * recusar. É o par de `atomos.ts` — lá o grafo recebe o que a revisão aprovou,
 * aqui ele recebe as correções que eu faço depois, em `/entidades`.
 *
 * **Fundir é criar alias, não apagar** (regra 6). O nó perdedor fica, ganha
 * `status = 'fundida'` e uma aresta `:FUNDIDA_EM` para o vencedor; as três
 * arestas que apontam para entidade — `:SOBRE`, `:MENCIONA` e `:PERFILA` —
 * migram por `MERGE`, então átomo que citava as duas grafias fica com uma
 * aresta, não duas.
 *
 * O ponto do desenho: como o perdedor mantém o `nome_normalizado` — constraint
 * única desde a 002 —, a grafia morta **nunca renasce como nó novo**. Dita
 * outra vez numa sessão futura, ela casa com o alias e a resolução segue até o
 * vencedor (`buscarConhecidas`, em `entidades.ts`). A fusão é o mecanismo de
 * alias, não um efeito colateral dele.
 *
 * **Fundir o vencedor leva os aliases dele junto** (slice 4.8.1). As dez
 * travessias de `:FUNDIDA_EM` do projeto são de **um salto**, e é o lado certo
 * da conta: fusão é rara e é escrita, leitura é quente e inclui duas consultas
 * de índice vetorial por janela — pagar expansão de comprimento variável ali
 * para consertar um caso de escrita seria caro no lugar errado. O preço é esta
 * consulta a mais: antes de marcar a perdedora, os aliases que apontavam para
 * ela passam a apontar para o vencedor novo. Sem isso, `a → b` seguido de
 * `b → c` deixava `a` pendurada em `b`: a chave `a` saía do catálogo, o `MERGE`
 * do confirmar reencontrava o nó morto (a constraint impede o segundo) e o
 * átomo ia parar num nó que nenhuma listagem mostra.
 *
 * **Fundir não é automático: quem funde sou eu, na tela.** Fundir duas pessoas
 * diferentes é irreversível num sistema que não desfaz, e o custo do erro é
 * assimétrico — duas entidades a mais é grafo um pouco sujo, uma fusão errada é
 * grafo mentindo.
 *
 * A exceção nasceu na 4.9 e é uma só: `registrarGrafia`, que cria o **nó de
 * alias** da grafia que eu falei quando eu confirmo o átomo. Ela cabe porque não
 * é uma fusão — o nó nasce com zero átomo e nenhuma aresta a migrar, e desfazê-lo
 * é apagar a aresta e o nó. O que continua nunca sendo automático é juntar duas
 * entidades que **já existem**.
 */
import { query } from "./neo4j";
import { novoId } from "./sessoes";
import { ehPronome, normalizarNome } from "./texto";
import { TIPOS_ENTIDADE } from "./tipos";
import type { TipoEntidade } from "./tipos";

export const STATUS_ENTIDADE_ATIVA = "ativa";
export const STATUS_ENTIDADE_FUNDIDA = "fundida";

export class FusaoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FusaoError";
  }
}

export interface ResultadoFusao {
  vencedora: string;
  perdedora: string;
  /** Arestas :SOBRE, :MENCIONA e :PERFILA movidas. Um átomo com duas conta duas vezes. */
  arestas_migradas: number;
}

/**
 * Funde `perdedora` em `vencedora`, as duas por `nome_normalizado`.
 *
 * Idempotente: a guarda de `status` faz a segunda chamada não achar nada para
 * migrar e devolver zero, sem quebrar.
 */
export async function fundir(
  chaveVencedora: string,
  chavePerdedora: string,
): Promise<ResultadoFusao> {
  const vencedora = normalizarNome(chaveVencedora);
  const perdedora = normalizarNome(chavePerdedora);

  if (vencedora === "" || perdedora === "") {
    throw new FusaoError("fundir exige as duas entidades");
  }
  if (vencedora === perdedora) {
    throw new FusaoError("uma entidade não se funde nela mesma");
  }

  // As duas existem, a perdedora ainda não foi fundida em outra coisa — e a
  // vencedora também não. Fundir **para dentro** de um alias corrompe do mesmo
  // jeito que a cadeia: o átomo vai para um nó que nenhuma listagem mostra, e
  // fusão não tem desfazer. Até a 4.8 só a perdedora era conferida.
  const par = await query<{
    v: string | null;
    p: string | null;
    jaFundida: boolean;
    vencedoraFundida: boolean;
  }>(
    `OPTIONAL MATCH (v:Entidade { nome_normalizado: $vencedora })
     OPTIONAL MATCH (p:Entidade { nome_normalizado: $perdedora })
     RETURN v.id AS v, p.id AS p,
            coalesce(p.status, 'ativa') = 'fundida' AS jaFundida,
            coalesce(v.status, 'ativa') = 'fundida' AS vencedoraFundida`,
    { vencedora, perdedora },
  );
  const linha = par[0];
  if (!linha?.v) throw new FusaoError(`"${chaveVencedora}" não está no grafo`);
  if (!linha?.p) throw new FusaoError(`"${chavePerdedora}" não está no grafo`);
  if (linha.vencedoraFundida) {
    throw new FusaoError(
      `"${chaveVencedora}" já é uma grafia fundida em outra entidade — ` +
        `funda na que venceu, não nela`,
    );
  }
  if (linha.jaFundida) {
    return { vencedora, perdedora, arestas_migradas: 0 };
  }

  // Migra o que aponta para a perdedora. Uma consulta por tipo de aresta, com o
  // tipo literal: Neo4j não aceita tipo de relação vindo de parâmetro, e a
  // alternativa (subquery com UNION para escolher o tipo) é bem mais frágil do
  // que repetir duas linhas. `MERGE` no destino, porque o átomo que citava as
  // duas grafias não pode acabar com a aresta dobrada.
  let migrados = 0;
  for (const tipo of ["SOBRE", "MENCIONA"] as const) {
    const r = await query<{ n: number }>(
      `MATCH (p:Entidade { nome_normalizado: $perdedora })
       MATCH (v:Entidade { nome_normalizado: $vencedora })
       MATCH (a:Atomo)-[r:${tipo}]->(p)
       MERGE (a)-[:${tipo}]->(v)
       DELETE r
       RETURN count(DISTINCT a) AS n`,
      { vencedora, perdedora },
    );
    migrados += r[0]?.n ?? 0;
  }

  // `:PERFILA` migra também, e fora do laço: ela carrega `campo` (migration
  // 005), e o `MERGE` do destino tem de casar o par (átomo, campo) — a
  // identidade da aresta é essa. Generalizar o laço para propriedade custaria
  // mais do que repetir a consulta uma vez.
  //
  // Sem isto a marca de perfil fica pendurada no nó morto, e o efeito é
  // assimétrico e silencioso: `atomosMarcados` atravessa do alias para o
  // vencedor, então perguntar pela grafia morta acharia os átomos do vencedor,
  // e perguntar pelo vencedor **não** acharia os que ficaram no alias. O botão
  // de perfil pararia de ver átomos que o agente 2 marcou, sem erro e sem
  // aviso — e fusão não tem desfazer.
  const perfis = await query<{ n: number }>(
    `MATCH (p:Entidade { nome_normalizado: $perdedora })
     MATCH (v:Entidade { nome_normalizado: $vencedora })
     MATCH (a:Atomo)-[r:PERFILA]->(p)
     WITH a, v, r, r.campo AS campo
     MERGE (a)-[:PERFILA { campo: campo }]->(v)
     DELETE r
     RETURN count(r) AS n`,
    { vencedora, perdedora },
  );
  migrados += perfis[0]?.n ?? 0;

  // Um átomo podia citar as duas grafias: sujeito numa, menção na outra. Depois
  // da migração isso viraria :SOBRE e :MENCIONA para o mesmo nó, e o contrato
  // do schema não admite — o sujeito vence, a menção redundante cai.
  await query(
    `MATCH (a:Atomo)-[m:MENCIONA]->(v:Entidade { nome_normalizado: $vencedora })
     WHERE (a)-[:SOBRE]->(v)
     DELETE m`,
    { vencedora },
  );

  // Os aliases da perdedora passam a apontar para o vencedor novo, **antes** de
  // ela virar alias também. É a consulta que impede a cadeia: sem ela,
  // `rapha2 → rapha` seguido de `rapha → raphael` deixa `rapha2` pendurada num
  // nó fundido, e a chave `rapha2` some de `chaves` no catálogo — dita de novo,
  // o `MERGE` do confirmar reencontra o nó morto (a constraint da 002 impede o
  // segundo) e pendura o `:SOBRE` num nó que nenhuma listagem mostra e que a
  // camada dos vizinhos descarta.
  //
  // `MERGE` + `DELETE` como o resto: refazer a fusão não duplica aresta nem
  // perde alias, que é o contrato que o §14 já declara para ela não ser
  // atômica.
  await query(
    `MATCH (x:Entidade)-[r:FUNDIDA_EM]->(p:Entidade { nome_normalizado: $perdedora })
     MATCH (v:Entidade { nome_normalizado: $vencedora })
     MERGE (x)-[:FUNDIDA_EM]->(v)
     DELETE r`,
    { vencedora, perdedora },
  );

  // O alias. `status` e a aresta são o que faz toda leitura pular este nó, e são
  // as duas únicas coisas que a fusão carimba: o schema canônico
  // (`db/migrations/004`) declara `status`, e propriedade que não está lá não
  // se inventa a partir do código (`CLAUDE.md`).
  await query(
    `MATCH (p:Entidade { nome_normalizado: $perdedora })
     MATCH (v:Entidade { nome_normalizado: $vencedora })
     SET p.status = $fundida
     MERGE (p)-[:FUNDIDA_EM]->(v)`,
    { vencedora, perdedora, fundida: STATUS_ENTIDADE_FUNDIDA },
  );

  return { vencedora, perdedora, arestas_migradas: migrados };
}

/**
 * Renomear é fundir consigo mesma sob outro nome.
 *
 * O nó ganha o nome novo e a chave nova; a grafia velha fica como **alias
 * apontando para ele**, o que resolve o limite que existia até aqui — renomear
 * uma entidade que já está no grafo criava um segundo nó, porque a resolução
 * casa por `nome_normalizado`. Agora "meu pai" dito de novo cai no nó do nome
 * de verdade.
 */
export async function renomear(chaveAtual: string, nomeNovo: string): Promise<void> {
  const atual = normalizarNome(chaveAtual);
  const novo = nomeNovo.trim();
  const chaveNova = normalizarNome(novo);

  if (atual === "") throw new FusaoError("renomear exige a entidade");
  if (chaveNova === "") throw new FusaoError("o nome novo não pode ser vazio");
  if (atual === chaveNova) {
    // Só mudou a caixa ou a pontuação: troca o nome de exibição e pronto,
    // porque a chave é a mesma e não há alias a criar.
    await query(
      `MATCH (e:Entidade { nome_normalizado: $atual }) SET e.nome = $novo`,
      { atual, novo },
    );
    return;
  }

  const conflito = await query<{ id: string }>(
    `MATCH (e:Entidade { nome_normalizado: $chaveNova }) RETURN e.id AS id`,
    { chaveNova },
  );
  if (conflito.length > 0) {
    throw new FusaoError(
      `já existe uma entidade chamada "${novo}" — em vez de renomear, funda as duas`,
    );
  }

  // O nó assume o nome novo, e nasce um alias com a grafia velha apontando para
  // ele. O alias precisa de id próprio: `entidade_id` é constraint única.
  //
  // O nome do alias sai de `e.nome`, lido antes do SET — e **não** do argumento.
  // Quem chama passa a chave normalizada (é o que a tela tem em mãos), então
  // usar o argumento gravava "zztestefusao" onde devia estar "ZZTesteFusao", e
  // a lista mostrava a chave crua como histórico do nome.
  await query(
    `MATCH (e:Entidade { nome_normalizado: $atual })
     WITH e, e.nome AS nomeVelho
     SET e.nome = $novo, e.nome_normalizado = $chaveNova
     CREATE (alias:Entidade {
       id: $idAlias, nome: nomeVelho, nome_normalizado: $atual,
       criado_em: $agora, status: $fundida
     })
     MERGE (alias)-[:FUNDIDA_EM]->(e)`,
    {
      atual,
      chaveNova,
      novo,
      idAlias: novoId(),
      agora: new Date().toISOString(),
      fundida: STATUS_ENTIDADE_FUNDIDA,
    },
  );
}

/**
 * Troca o label de tipo de uma entidade.
 *
 * Existe porque o tipo só era editável enquanto a entidade era **nova**, na
 * primeira revisão em que aparecia: depois disso ela vira `conhecida`, a
 * revisão a mostra como texto fixo (o grafo vence sobre o extrator) e não havia
 * mais como consertar. "Rodozanco" nascido `:Pessoa` por um palpite errado do
 * extrator ficava `:Pessoa` para sempre — e label errado é exatamente o grafo
 * apodrecido que esta parte do sistema existe para evitar.
 *
 * Uma consulta por tipo alvo, com os labels literais: Neo4j não aceita label
 * vindo de parâmetro, e o valor sai de `TIPOS_ENTIDADE`, constante fechada,
 * nunca do cliente. Mesmo padrão de `statementDeEntidade` em `atomos.ts`.
 *
 * `:Entidade` nunca é removido — é ele que carrega a constraint de
 * `nome_normalizado` e é por ele que toda leitura encontra o nó.
 */
function statementDeTipo(tipo: TipoEntidade): string {
  if (!TIPOS_ENTIDADE.includes(tipo)) throw new FusaoError(`Tipo inválido: ${tipo}`);
  const outros = TIPOS_ENTIDADE.filter((t) => t !== tipo);
  const remocao = outros.length > 0 ? `\n     REMOVE ${outros.map((t) => `e:${t}`).join(", ")}` : "";
  return `MATCH (e:Entidade { nome_normalizado: $chave })
     SET e:${tipo}${remocao}
     RETURN e.id AS id`;
}

export async function trocarTipo(chaveOuNome: string, tipo: TipoEntidade): Promise<void> {
  const chave = normalizarNome(chaveOuNome);
  if (chave === "") throw new FusaoError("trocar o tipo exige a entidade");
  if (!TIPOS_ENTIDADE.includes(tipo)) throw new FusaoError(`Tipo inválido: ${tipo}`);

  const r = await query<{ id: string }>(statementDeTipo(tipo), { chave });
  if (r.length === 0) throw new FusaoError(`"${chaveOuNome}" não está no grafo`);
}

/**
 * Cria uma entidade à mão, antes de ela ser falada.
 *
 * **Cria nó órfão de propósito** — entidade sem átomo nenhum apontando para
 * ela. O confirmar da revisão evita isso com cuidado (aprovar uma entidade e
 * depois rejeitar todos os átomos dela não pode deixar lixo no grafo), mas ali
 * o órfão seria acidente; aqui é o pedido. A diferença aparece na tela: a lista
 * mostra `0 átomo(s)`, e é isso mesmo até a primeira vez que eu falar o nome.
 *
 * O ganho é duplo, e o segundo é o que importa: o nome entra no vocabulário do
 * STT **antes** da primeira menção — que é justamente quando o transcritor mais
 * erra —, e quando ele finalmente for falado a resolução acha a entidade já
 * pronta, com o tipo que eu escolhi, em vez do palpite do extrator.
 */
export async function criarEntidade(
  nome: string,
  tipo: TipoEntidade,
): Promise<{ id: string; nome: string; tipo: TipoEntidade }> {
  const limpo = nome.trim();
  const chave = normalizarNome(limpo);

  if (chave === "") throw new FusaoError("o nome não pode ser vazio");
  if (ehPronome(chave)) throw new FusaoError(`"${limpo}" é um pronome, não um nome`);
  if (!TIPOS_ENTIDADE.includes(tipo)) throw new FusaoError(`Tipo inválido: ${tipo}`);

  // A constraint de `nome_normalizado` recusaria de qualquer jeito; conferir
  // antes é o que permite dizer *por que*, inclusive quando o nome colide com
  // uma grafia já fundida em outra coisa.
  const existente = await query<{ nome: string; fundida: boolean }>(
    `MATCH (e:Entidade { nome_normalizado: $chave })
     OPTIONAL MATCH (e)-[:FUNDIDA_EM]->(v:Entidade)
     RETURN coalesce(v.nome, e.nome) AS nome, v IS NOT NULL AS fundida`,
    { chave },
  );
  if (existente.length > 0) {
    const { nome: atual, fundida } = existente[0];
    throw new FusaoError(
      fundida
        ? `"${limpo}" já existe no grafo, como grafia de "${atual}"`
        : `"${atual}" já está no grafo`,
    );
  }

  const id = novoId();
  await query(
    `CREATE (e:Entidade:${tipo} {
       id: $id, nome: $nome, nome_normalizado: $chave,
       criado_em: $agora, status: $ativa
     })`,
    { id, nome: limpo, chave, agora: new Date().toISOString(), ativa: STATUS_ENTIDADE_ATIVA },
  );

  return { id, nome: limpo, tipo };
}

/**
 * "Essas duas são pessoas diferentes." Grava para não voltar a ser perguntado.
 *
 * Sem isso a tela vira cobrança: a mesma sugestão toda vez que eu peço
 * duplicatas. Ignorar é saída válida (visão §5.3); ignorar a mesma pergunta
 * doze vezes não é.
 *
 * Uma aresta só, em direção arbitrária — quem lê consulta nos dois sentidos.
 */
export async function marcarDistintas(chaveA: string, chaveB: string): Promise<void> {
  const a = normalizarNome(chaveA);
  const b = normalizarNome(chaveB);
  if (a === "" || b === "") throw new FusaoError("marcar distintas exige as duas entidades");
  if (a === b) throw new FusaoError("uma entidade não é distinta dela mesma");

  await query(
    `MATCH (x:Entidade { nome_normalizado: $a })
     MATCH (y:Entidade { nome_normalizado: $b })
     MERGE (x)-[:DISTINTA_DE]->(y)`,
    { a, b },
  );
}

/** Os pares que eu já disse serem coisas diferentes, nos dois sentidos. */
export async function paresDistintos(): Promise<Set<string>> {
  const linhas = await query<{ a: string; b: string }>(
    `MATCH (x:Entidade)-[:DISTINTA_DE]-(y:Entidade)
     RETURN x.nome_normalizado AS a, y.nome_normalizado AS b`,
  );
  const pares = new Set<string>();
  for (const l of linhas) {
    pares.add(chaveDoPar(l.a, l.b));
  }
  return pares;
}

/** Chave estável de um par, independente da ordem em que ele veio. */
export const chaveDoPar = (a: string, b: string): string => [a, b].sort().join("|");

/** O que aconteceu com uma grafia falada. `criada: false` nunca é erro. */
export interface ResultadoGrafia {
  criada: boolean;
  /** Por que não criou, quando não criou. Vazio quando criou. */
  motivo: string;
}

/**
 * Registra a grafia que eu falei como **alias** do nó que eu confirmei
 * (slice 4.9).
 *
 * O nó de alias nasce exatamente como o de `renomear`: `:Entidade` com
 * `status = 'fundida'` e uma aresta `:FUNDIDA_EM` para o vencedor. O efeito é o
 * de sempre — a grafia morta resolve para o vencedor em vez de renascer como nó
 * novo —, e o ganho é o da fatia: eu disse "giam", confirmei "Giampaolo
 * Lepore", e na sessão seguinte "giam" casa por grafia exata, de graça, sem
 * depender do RAG.
 *
 * **Este alias não é uma fusão.** O nó nasce com zero átomo e nenhuma aresta a
 * migrar, então desfazê-lo é apagar a aresta e o nó — ao contrário de uma fusão
 * de verdade, que não tem desfazer. É por isso que ele pode ser automático e ela
 * não, e é essa a linha que a 4.9 move em `ARCHITECTURE.md` §8.2.
 *
 * As recusas são **correção, não política** — nenhuma delas protege o grafo de
 * mim, todas protegem de um dado que não fecha:
 *
 *   1. grafia vazia, pronome, ou igual à chave do próprio nó — nada a registrar;
 *   2. o nó alvo não existe, ou ele mesmo já é uma grafia fundida — o alias
 *      apontaria para um nó que nenhuma listagem mostra;
 *   3. a grafia já existe como nó **ativo** — seria fundir duas entidades reais
 *      automaticamente, e fusão nunca é automática;
 *   4. a grafia já é alias de **outro** nó — criar a aresta ali roubaria a
 *      grafia de quem já a tem, ou a deixaria com dois destinos.
 *
 * Segunda chamada com a mesma grafia é no-op: a checagem prévia é a trava
 * (regra 4).
 */
export async function registrarGrafia(
  chaveDoNo: string,
  grafiaFalada: string,
): Promise<ResultadoGrafia> {
  const chave = normalizarNome(chaveDoNo);
  const falada = grafiaFalada.trim();
  const grafia = normalizarNome(falada);

  if (chave === "") throw new FusaoError("registrar grafia exige a entidade");
  if (grafia === "") return { criada: false, motivo: "a grafia está vazia" };
  if (grafia === chave) return { criada: false, motivo: "é a própria grafia do nó" };
  if (ehPronome(grafia)) return { criada: false, motivo: `"${falada}" é um pronome, não um nome` };

  const linhas = await query<{
    alvo: string | null;
    alvoFundido: boolean;
    ja: string | null;
    jaFundida: boolean;
    destino: string | null;
  }>(
    `OPTIONAL MATCH (v:Entidade { nome_normalizado: $chave })
     OPTIONAL MATCH (g:Entidade { nome_normalizado: $grafia })
     OPTIONAL MATCH (g)-[:FUNDIDA_EM]->(d:Entidade)
     RETURN v.id AS alvo, coalesce(v.status, 'ativa') = 'fundida' AS alvoFundido,
            g.id AS ja, coalesce(g.status, 'ativa') = 'fundida' AS jaFundida,
            d.nome_normalizado AS destino`,
    { chave, grafia },
  );
  const l = linhas[0];

  if (!l?.alvo) return { criada: false, motivo: `"${chaveDoNo}" não está no grafo` };
  if (l.alvoFundido) {
    return { criada: false, motivo: `"${chaveDoNo}" já é uma grafia fundida em outra entidade` };
  }
  if (l.ja) {
    if (!l.jaFundida) {
      return { criada: false, motivo: `"${falada}" já é uma entidade própria no grafo` };
    }
    return l.destino === chave
      ? { criada: false, motivo: "já era grafia deste nó" }
      : { criada: false, motivo: `"${falada}" já é grafia de "${l.destino}"` };
  }

  // O nome de exibição é a grafia **como eu a falei**, e não a chave: é ela que
  // a lista de `/entidades` mostra como histórico do nome. Mesmo cuidado do
  // `renomear`, que lê `e.nome` antes do SET em vez de usar o argumento.
  await query(
    `MATCH (v:Entidade { nome_normalizado: $chave })
     CREATE (alias:Entidade {
       id: $idAlias, nome: $falada, nome_normalizado: $grafia,
       criado_em: $agora, status: $fundida
     })
     MERGE (alias)-[:FUNDIDA_EM]->(v)`,
    {
      chave,
      grafia,
      falada,
      idAlias: novoId(),
      agora: new Date().toISOString(),
      fundida: STATUS_ENTIDADE_FUNDIDA,
    },
  );

  return { criada: true, motivo: "" };
}
