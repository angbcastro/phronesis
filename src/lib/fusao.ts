/**
 * Escrita de manutenção de entidade: fundir, renomear, trocar tipo, criar,
 * recusar, e — desde a 4.11 — escrever o resumo, editar as grafias e marcar a
 * ficha oficial. É o par de `atomos.ts` — lá o grafo recebe o que a revisão
 * aprovou, aqui ele recebe as correções que eu faço depois, em `/entidades`.
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
 * **Grafia deixou de ser nó na 4.11** (migration 009). Até aqui duas coisas
 * diferentes tinham a mesma forma no grafo — a grafia que o STT errou e o
 * perdedor de uma fusão que eu mandei fazer —, e nenhuma consulta as
 * distinguia. Agora `registrarGrafia` e `renomear` escrevem em `e.aliases`, uma
 * lista de strings no próprio nó, e `:FUNDIDA_EM` significa uma coisa só:
 * **fusão de duas entidades reais**, que é o registro de uma decisão minha e
 * por isso continua sendo nó, com data e arestas migradas.
 *
 * O casamento exato não perdeu nada com a troca: `listarEntidades` monta
 * `chaves` a partir das duas fontes, e `acharPorChave` varre em memória como
 * já varria. O que se perdeu foi o índice único como trava — e é por isso que
 * as recusas de `registrarGrafia` e de `criarEntidade` passaram a conferir a
 * propriedade, em vez de deixar o banco recusar.
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
 * `registrarGrafia`, que roda sozinha no confirmar, **deixou de ser exceção a
 * essa regra** (4.11): escrever uma string num array não funde nada. Ela
 * acrescenta uma grafia ao nó que eu acabei de confirmar, e desfazê-la é tirar
 * um item da lista em `/entidades`. O que continua nunca sendo automático é
 * juntar duas entidades que **já existem**.
 */
import { query } from "./neo4j";
import { novoId } from "./sessoes";
import { ehPronome, normalizarNome } from "./texto";
import { TETO_RESUMO, TIPOS_ENTIDADE } from "./tipos";
import type { TipoEntidade } from "./tipos";

export const STATUS_ENTIDADE_ATIVA = "ativa";
export const STATUS_ENTIDADE_FUNDIDA = "fundida";

export class FusaoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FusaoError";
  }
}

/**
 * Quem já responde por uma chave — e é a pergunta que a 4.11 tornou necessária.
 *
 * Até a migration 009 ela não existia: **toda** grafia era um nó, e o índice
 * único de `nome_normalizado` (002) recusava sozinho qualquer chave repetida,
 * inclusive em corrida. Grafia dentro de um array o banco não tem como recusar,
 * então as duas escritas que criam chave nova — `criarEntidade` e `renomear` —
 * passam a perguntar antes, em memória, sobre o mesmo catálogo que
 * `acharPorChave` já varre.
 *
 * Devolve `null` quando a chave está livre. `alias: true` quando quem responde
 * por ela é uma grafia de outro nó, e não o nome dele — a diferença é o que
 * permite dizer *por que* a escrita foi recusada.
 */
async function donoDaChave(
  chave: string,
): Promise<{ chave: string; nome: string; alias: boolean } | null> {
  if (chave === "") return null;

  const linhas = await query<{
    nome: string | null;
    chaveDoNo: string | null;
    fundida: boolean;
    donos: { chave: string | null; nome: string | null; aliases: string[] | null }[];
  }>(
    `OPTIONAL MATCH (e:Entidade { nome_normalizado: $chave })
     OPTIONAL MATCH (e)-[:FUNDIDA_EM]->(v:Entidade)
     WITH e, v
     OPTIONAL MATCH (dono:Entidade)
     WHERE size(coalesce(dono.aliases, [])) > 0
     WITH e, v,
          collect({ chave: dono.nome_normalizado, nome: dono.nome, aliases: dono.aliases }) AS donos
     RETURN coalesce(v.nome, e.nome) AS nome,
            coalesce(v.nome_normalizado, e.nome_normalizado) AS chaveDoNo,
            v IS NOT NULL AS fundida, donos`,
    { chave },
  );
  const l = linhas[0];

  if (typeof l?.chaveDoNo === "string" && typeof l.nome === "string") {
    return { chave: l.chaveDoNo, nome: l.nome, alias: l.fundida === true };
  }

  // A normalização acontece aqui, e não em Cypher: quem define o que é a mesma
  // grafia é `normalizarNome`, e duas normalizações diferentes seriam a falha
  // que `texto.ts` existe para evitar.
  const dono = (l?.donos ?? []).find(
    (d) =>
      typeof d?.chave === "string" &&
      (d.aliases ?? []).some((a) => typeof a === "string" && normalizarNome(a) === chave),
  );
  return dono
    ? { chave: dono.chave as string, nome: (dono.nome as string) ?? (dono.chave as string), alias: true }
    : null;
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
 * Renomear é dar outro nome ao mesmo nó, guardando o antigo como grafia.
 *
 * O nó ganha o nome novo e a chave nova; a grafia velha entra em `e.aliases`, o
 * que resolve o limite que existia até aqui — renomear uma entidade que já está
 * no grafo criava um segundo nó, porque a resolução casa por `nome_normalizado`.
 * Agora "meu pai" dito de novo cai no nó do nome de verdade.
 *
 * **A grafia velha era um nó até a 4.11**, criado exatamente como o de
 * `registrarGrafia`, e ela vai pelo mesmo caminho que ele: um item no array.
 * Deixar só uma das duas escrevendo propriedade recriaria, no primeiro renome
 * depois desta fatia, a mesma "duas espécies de nó fundido com a mesma forma"
 * que a migration 009 acabou de desfazer. O preço está declarado no §14: nome
 * antigo de um renome e grafia que o STT errou eram indistinguíveis na escrita,
 * e agora são indistinguíveis também na leitura.
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

  // Nó com essa chave, ou grafia de outro nó: os dois são conflito, e desde a
  // 4.11 só o primeiro o banco recusaria sozinho.
  const conflito = await donoDaChave(chaveNova);
  if (conflito) {
    throw new FusaoError(
      conflito.alias
        ? `"${novo}" já é uma grafia de "${conflito.nome}" — tire-a de lá antes, ou funda as duas`
        : `já existe uma entidade chamada "${novo}" — em vez de renomear, funda as duas`,
    );
  }

  // O nó assume o nome novo, e a grafia velha entra em `aliases`.
  //
  // A grafia sai de `e.nome`, lido antes do SET — e **não** do argumento. Quem
  // chama passa a chave normalizada (é o que a tela tem em mãos), então usar o
  // argumento gravava "zztestefusao" onde devia estar "ZZTesteFusao", e a lista
  // mostrava a chave crua como histórico do nome.
  await query(
    `MATCH (e:Entidade { nome_normalizado: $atual })
     WITH e, e.nome AS nomeVelho
     SET e.nome = $novo, e.nome_normalizado = $chaveNova,
         e.aliases = CASE WHEN nomeVelho IN coalesce(e.aliases, [])
                          THEN coalesce(e.aliases, [])
                          ELSE coalesce(e.aliases, []) + nomeVelho END`,
    { atual, chaveNova, novo },
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

  // Conferir antes é o que permite dizer *por que*, inclusive quando o nome
  // colide com uma grafia de outra entidade. Contra um **nó** a constraint de
  // `nome_normalizado` recusaria de qualquer jeito; contra uma grafia em
  // `aliases` não há constraint nenhuma desde a 4.11, e esta leitura é a única
  // trava — sem ela eu semearia "Jean" como pessoa nova enquanto "Jean" é a
  // grafia do Giampaolo, e o casamento exato passaria a ter dois destinos.
  const existente = await donoDaChave(chave);
  if (existente) {
    throw new FusaoError(
      existente.alias
        ? `"${limpo}" já existe no grafo, como grafia de "${existente.nome}"`
        : `"${existente.nome}" já está no grafo`,
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
 * Tira uma grafia de `aliases`, à mão, em `/entidades` (slice 4.11).
 *
 * É o par de `registrarGrafia`, e é o que faz a lista ser **editável** — o que
 * não existia enquanto a grafia era nó. Sem isto, o STT errando de três jeitos
 * deixava três grafias no nó para sempre, e apagar uma era ir ao console.
 *
 * A comparação é por string exata, e é de propósito: a tela mostra a lista e
 * manda de volta o item que eu cliquei. Grafia que **não** está na propriedade é
 * o nome de um nó que perdeu uma fusão real — ela não sai por aqui, e a recusa
 * diz isso, porque desfazer uma fusão é outra decisão e não tem este botão.
 */
export async function removerGrafia(
  chaveDoNo: string,
  grafia: string,
): Promise<{ removida: boolean; motivo: string }> {
  const chave = normalizarNome(chaveDoNo);
  if (chave === "") throw new FusaoError("remover grafia exige a entidade");
  if (grafia.trim() === "") return { removida: false, motivo: "a grafia está vazia" };

  const linhas = await query<{ antes: number; depois: number }>(
    `MATCH (v:Entidade { nome_normalizado: $chave })
     WITH v, coalesce(v.aliases, []) AS antes
     SET v.aliases = [a IN antes WHERE a <> $grafia]
     RETURN size(antes) AS antes, size(v.aliases) AS depois`,
    { chave, grafia },
  );

  if (linhas.length === 0) {
    throw new FusaoError(`"${chaveDoNo}" não está no grafo`);
  }
  if (linhas[0].antes === linhas[0].depois) {
    return {
      removida: false,
      motivo:
        `"${grafia}" não está na lista de grafias deste nó — se ela aparece na tela, ` +
        `é o nome de uma entidade que perdeu uma fusão, e isso não se desfaz por aqui`,
    };
  }
  return { removida: true, motivo: "" };
}

/**
 * O retrato de identidade, e a marca de ficha oficial (migration 009).
 *
 * Os dois são escrita minha e de mais ninguém, como os três campos de perfil: o
 * `resumo` é o que os **dois** agentes leem por padrão desde a 4.11, e perfil
 * escrito errado contamina toda atribuição futura (§4.9). A 4.12 é que vai
 * propor texto para ele — e mesmo lá a escrita continua sendo um toque meu.
 *
 * O corte em `TETO_RESUMO` acontece aqui, no servidor, pela mesma razão que o
 * corte do perfil acontecia: regra que só vale na tela não é regra.
 *
 * Atravessa alias como `gravarCampo`: escrever no perdedor de uma fusão tem de
 * ir para o vencedor, senão o texto ficaria num nó que nenhuma leitura enxerga.
 */
export async function gravarResumo(
  chaveOuNome: string,
  texto: string,
): Promise<{ id: string; nome: string; resumo: string }> {
  const chave = normalizarNome(chaveOuNome);
  if (chave === "") throw new FusaoError("gravar resumo exige a entidade");

  const resumo = texto.trim().slice(0, TETO_RESUMO);
  const r = await query<{ id: string; nome: string }>(
    // `resumo_anterior` pela mesma razão de `gravarCampo` (010): o desfazer de
    // `/entidades` volta UMA geração, e ela tem de ser a imediatamente anterior
    // — senão um toque no desfazer apagaria o que eu acabei de escrever aqui.
    `MATCH (e:Entidade { nome_normalizado: $chave })
     OPTIONAL MATCH (e)-[:FUNDIDA_EM]->(v:Entidade)
     WITH coalesce(v, e) AS alvo
     SET alvo.resumo_anterior = coalesce(alvo.resumo, '')
     SET alvo.resumo = $resumo
     RETURN alvo.id AS id, alvo.nome AS nome`,
    { chave, resumo },
  );
  if (r.length === 0) throw new FusaoError(`"${chaveOuNome}" não está no grafo`);

  return { ...r[0], resumo };
}

/**
 * Marca ou desmarca a ficha oficial. Um toque, reversível, sem consequência
 * retroativa: nenhum átomo já gravado muda por causa disto.
 *
 * **É preferência, não obrigação.** Não exige sobrenome, não impede entidade
 * nova de nascer e não trava unicidade nenhuma — a flag é sinal nos dois
 * prompts e desempate determinístico quando dois candidatos empatam.
 */
export async function marcarCanonico(chaveOuNome: string, canonico: boolean): Promise<void> {
  const chave = normalizarNome(chaveOuNome);
  if (chave === "") throw new FusaoError("marcar canônico exige a entidade");

  const r = await query<{ id: string }>(
    `MATCH (e:Entidade { nome_normalizado: $chave })
     OPTIONAL MATCH (e)-[:FUNDIDA_EM]->(v:Entidade)
     WITH coalesce(v, e) AS alvo
     SET alvo.canonico = $canonico
     RETURN alvo.id AS id`,
    { chave, canonico },
  );
  if (r.length === 0) throw new FusaoError(`"${chaveOuNome}" não está no grafo`);
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
 * (slice 4.9, reescrita na 4.11).
 *
 * O ganho é o mesmo desde a 4.9: eu disse "giam", confirmei "Giampaolo Lepore",
 * e na sessão seguinte "giam" casa por grafia exata, de graça, sem depender do
 * RAG. O que mudou é onde a grafia mora — **um item em `v.aliases`**, e não
 * mais um `:Entidade` com `status = 'fundida'` pendurado por `:FUNDIDA_EM`.
 *
 * **Isto nunca foi uma fusão**, e agora a forma no grafo diz isso. Um nó de
 * grafia e o perdedor de uma fusão real tinham a mesma forma e nenhuma consulta
 * os distinguia; a migration 009 converteu os primeiros e deixou os segundos.
 * Ver o cabeçalho do módulo.
 *
 * As recusas são **correção, não política** — nenhuma delas protege o grafo de
 * mim, todas protegem de um dado que não fecha:
 *
 *   1. grafia vazia, pronome, ou igual à chave do próprio nó — nada a registrar;
 *   2. o nó alvo não existe, ou ele mesmo é o perdedor de uma fusão — a grafia
 *      ficaria num nó que nenhuma listagem mostra;
 *   3. a grafia já existe como nó **ativo** — seria fundir duas entidades reais
 *      automaticamente, e fusão nunca é automática;
 *   4. a grafia já é alias de **outro** nó — agora conferida contra a **união
 *      das duas fontes** (a propriedade e os nós de fusão real), e a resposta
 *      continua sendo recusar: gravá-la aqui a roubaria de quem já a tem, e o
 *      casamento exato passaria a ter dois destinos para a mesma chave.
 *
 * A recusa 4 é a que deixou de ser de graça. Até a 009 o índice único de
 * `nome_normalizado` era a trava: a grafia era nó, e um segundo nó com a mesma
 * chave não nascia nem em corrida. Agora ela é string dentro de um array, o
 * banco não tem o que recusar, e a trava é esta leitura — sobre o catálogo
 * inteiro, em memória, que é a mesma decisão que `acharPorChave` já tomava
 * (§14: o dia em que o catálogo não couber, a saída é um índice full-text).
 *
 * Segunda chamada com a mesma grafia é no-op (regra 4): a checagem prévia
 * recusa, e o `SET` ainda deduplica por baixo — a mesma disciplina da migration.
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
    donos: { chave: string | null; aliases: string[] | null }[];
  }>(
    `OPTIONAL MATCH (v:Entidade { nome_normalizado: $chave })
     OPTIONAL MATCH (g:Entidade { nome_normalizado: $grafia })
     OPTIONAL MATCH (g)-[:FUNDIDA_EM]->(d:Entidade)
     WITH v, g, d
     OPTIONAL MATCH (dono:Entidade)
     WHERE size(coalesce(dono.aliases, [])) > 0
     WITH v, g, d,
          collect({ chave: dono.nome_normalizado, aliases: dono.aliases }) AS donos
     RETURN v.id AS alvo, coalesce(v.status, 'ativa') = 'fundida' AS alvoFundido,
            g.id AS ja, coalesce(g.status, 'ativa') = 'fundida' AS jaFundida,
            d.nome_normalizado AS destino, donos`,
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

  // A recusa 4 pela propriedade. A normalização acontece **aqui**, e não em
  // Cypher, porque quem define o que é a mesma grafia é `normalizarNome` — e
  // duas normalizações diferentes seriam exatamente a falha que `texto.ts`
  // existe para evitar.
  const dono = (l.donos ?? []).find(
    (d) =>
      typeof d?.chave === "string" &&
      (d.aliases ?? []).some((a) => typeof a === "string" && normalizarNome(a) === grafia),
  );
  if (dono) {
    return dono.chave === chave
      ? { criada: false, motivo: "já era grafia deste nó" }
      : { criada: false, motivo: `"${falada}" já é grafia de "${dono.chave}"` };
  }

  // A grafia entra **como eu a falei**, e não a chave normalizada: é ela que a
  // lista de `/entidades` mostra, e é ela que eu reconheço. Mesmo cuidado do
  // `renomear`, que lê `e.nome` antes do SET em vez de usar o argumento.
  //
  // O `WHERE NOT ... IN` é a dedupe, e ela é a trava de idempotência por baixo
  // da checagem acima: dois confirmares da mesma sessão em corrida não
  // acrescentam o mesmo item duas vezes (regra 4).
  await query(
    `MATCH (v:Entidade { nome_normalizado: $chave })
     WHERE NOT $falada IN coalesce(v.aliases, [])
     SET v.aliases = coalesce(v.aliases, []) + $falada`,
    { chave, falada },
  );

  return { criada: true, motivo: "" };
}
