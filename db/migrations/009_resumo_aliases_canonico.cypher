// 009 — Slice 4.11. A entidade passa a se apresentar: ganha `resumo`, `aliases`
// como propriedade e `canonico` — e as grafias que hoje são nó viram item de
// array.
//
// ATENÇÃO: esta migration TEM statements, e é a primeira desde a 006 que tem.
// Ela também é a primeira deste projeto que APAGA nós. Leia a seção 3 antes de
// aprovar.
//
// Os três campos novos, como sempre, não se declaram: propriedade de valor livre
// não tem constraint no Aura Free (existência e valor são recurso Enterprise).
// O que precisa de statement é a CONVERSÃO DO DADO que já está no grafo.
//
// PROPOSTA — não rodar sem minha aprovação (CLAUDE.md).
//
// ---------------------------------------------------------------------------
// 1. :Entidade ganha resumo, aliases e canonico
// ---------------------------------------------------------------------------
//
//   (:Entidade { id, nome, nome_normalizado, criado_em, status,
//                contexto, pode_ajudar_com, fizemos_juntos,
//                embedding, embedding_modelo, embedding_fonte,
//                resumo, aliases, canonico })
//
//   resumo    texto livre, teto de 500 caracteres (TETO_RESUMO, src/lib/tipos.ts).
//             É o RETRATO DE IDENTIDADE da entidade: quem ela é para o dono do
//             diário e, antes de tudo, o que a distingue de outra parecida.
//
//             Para que serve: é o que os DOIS agentes leem por padrão a partir
//             desta slice — o dossiê do extrator (blocoDasCandidatas) e o
//             catálogo do agente de resolução (descrever). Até aqui eles liam
//             coisas diferentes da mesma entidade: o extrator via só `contexto`,
//             e o agente 2 via os três campos inteiros de TODAS as entidades em
//             toda chamada. Uma apresentação só, nos dois lugares.
//
//             Nasce VAZIO. Quem o preenche é a slice 4.12 (enriquecimento em
//             lote) ou a minha mão em /entidades. Resumo vazio é estado válido:
//             o agente devolve confiança baixa, e confiança baixa é o que
//             dispara a segunda passada com o perfil inteiro.
//
//   aliases   lista de strings — as grafias como elas foram faladas ou escritas
//             ("Jean", "Giam", "Dapta"). Editável à mão em /entidades, em
//             qualquer um dos quatro tipos de entidade.
//
//             É o que resolve o caso que a 4.9 abriu: o STT erra nome próprio o
//             tempo todo, eu confirmo o átomo com o nome certo, e a grafia
//             errada fica registrada para casar exato na sessão seguinte. Ver a
//             seção 3 para o que muda de mecanismo.
//
//   canonico  booleano, marcado À MÃO, ausente contando como false.
//
//             "Esta é a ficha oficial desta entidade." É sinal e desempate, e
//             não trava: nó marcado aparece destacado em /entidades, entra
//             marcado nos dois prompts, e vence quando dois candidatos empatam.
//             Não impede entidade nova de nascer, não exige sobrenome, e é
//             reversível sem consequência retroativa.
//
// O TETO_PERFIL DE 300 SAI, e é esta slice que o mata. A migration 005 declarou
// o teto com o motivo certo: "os três campos de TODAS as entidades entram no
// prompt do agente de resolução, e sem teto o custo daquela chamada cresce com
// o tamanho do grafo". A partir daqui os três campos NÃO entram mais no caminho
// comum — eles só aparecem na segunda passada, para os poucos candidatos de uma
// menção em dúvida. O motivo do teto deixou de existir, e o teto com ele.
//
// SEM ÍNDICE. Ninguém busca por resumo nem por canonico. O casamento exato de
// alias passa a acontecer EM MEMÓRIA, sobre o catálogo que listarEntidades() já
// carrega inteiro — a mesma decisão que a 007 registrou para o filtro de label,
// e pela mesma razão: o Aura Free tem cota de índice.
//
// ---------------------------------------------------------------------------
// 2. O que muda no mecanismo do alias
// ---------------------------------------------------------------------------
//
// ANTES (slice 4.9): a grafia falada vira um NÓ.
//
//   registrarGrafia() cria (:Entidade { nome_normalizado: 'jean',
//   status: 'fundida' })-[:FUNDIDA_EM]->(:Pessoa { nome: 'Giampaolo Lepore' })
//
//   Funciona, e funciona de graça: "jean" casa pelo índice único de
//   nome_normalizado na sessão seguinte, sem depender do RAG.
//
// DEPOIS (slice 4.11): a grafia falada vira ITEM DE `aliases` no próprio nó.
//
//   SET v.aliases = v.aliases + 'Jean'
//
// POR QUE TROCAR ALGO QUE FUNCIONA: porque o grafo passou a ter duas espécies
// de nó fundido com a MESMA FORMA, e nenhuma consulta as distingue —
//
//   a) a grafia que o STT errou, criada sozinha no confirmar;
//   b) o perdedor de uma fusão que eu mandei fazer, com arestas migradas.
//
// São coisas diferentes: (b) é o registro de uma decisão minha, que eu quero
// poder ver e datar; (a) é conserto de transcrição, que não é decisão de nada.
// Com a mesma forma, /entidades mostra as duas como "histórico do nome", e a
// lista não é editável — eu não consigo ensinar uma grafia ANTES de o STT errar
// pela primeira vez, que é justamente quando ele mais erra.
//
// FUNDIDA_EM CONTINUA EXISTINDO, e continua significando exatamente o que
// significava na 004: fusão de duas entidades reais. É só a espécie (a) que
// deixa de usá-la.
//
// O QUE O CASAMENTO EXATO PERDE: o índice. `chaves` (EntidadeDoGrafo) passa a
// ser montada a partir da propriedade e não mais só das arestas, e acharPorChave
// continua varrendo em memória, exatamente como já varre hoje. Nenhuma consulta
// a mais, nenhum índice a mais. O dia em que o catálogo não couber na memória de
// uma função, a saída é um índice full-text sobre `aliases` — recusado agora por
// cota, e escrito aqui para quando a pergunta voltar.
//
// ---------------------------------------------------------------------------
// 3. A conversão: como distinguir (a) de (b), e por que NÃO é contando átomos
// ---------------------------------------------------------------------------
//
// O DISCRIMINADOR É O LABEL.
//
//   - o nó de grafia nasce SÓ com :Entidade —
//     `CREATE (alias:Entidade { ... })`, em registrarGrafia e em renomear
//     (src/lib/fusao.ts). Nenhum label de tipo é posto nele;
//
//   - toda entidade real ganha o label do tipo no ON CREATE —
//     `MERGE (n:Entidade {...}) ON CREATE SET n:${tipo}` (src/lib/atomos.ts),
//     e continua com esse label depois de perder uma fusão.
//
// Então: size(labels(g)) = 1 é grafia; 2 ou mais é entidade real.
//
// CONTAR ÁTOMOS NÃO SERVE, e este parágrafo existe para que ninguém tente:
// fundir() migra :SOBRE, :MENCIONA e :PERFILA para o vencedor, então o perdedor
// de uma fusão real TAMBÉM fica com zero átomo. Os dois casos são
// indistinguíveis por contagem, e um deles não pode ser apagado.
//
// O ALIAS DE RENOMEAR VAI JUNTO, e é o certo: o nome antigo de uma entidade
// depois de um renome é uma grafia daquela entidade, exatamente como a que o STT
// errou. As duas passam a ser item do mesmo array — e passam a ser
// indistinguíveis também na leitura, o que já era verdade na escrita.
//
// O QUE SE PERDE: um :DISTINTA_DE que aponte para um nó de grafia vai junto no
// DETACH DELETE. É uma recusa minha desaparecendo — declarada aqui, e aceita
// porque uma recusa contra uma GRAFIA (e não contra uma entidade) não é uma
// decisão que se sustente sozinha depois que a grafia deixa de ser um nó.
//
// IDEMPOTENTE, e tem que ser: `pnpm migrate` roda TODAS as migrations em ordem,
// toda vez. O statement 1 deduplica antes de escrever; o statement 2 só apaga o
// que o statement 1 comprovadamente preservou. Na segunda execução os dois não
// encontram nada e não fazem nada.
//
// A ORDEM IMPORTA: preservar antes de apagar. O statement 2 exige que o nome da
// grafia JÁ ESTEJA em v.aliases — se o statement 1 não tiver alcançado aquele nó
// (cadeia de fusão sem vencedor terminal, por exemplo), ele fica no grafo em vez
// de ser apagado sem ter sido salvo.

// ── 1. Cada grafia vira item de `aliases` do vencedor terminal da cadeia ──
//
// FUNDIDA_EM* porque a 4.8.1 permite cadeia: a grafia aponta um nó que pode,
// depois, ter perdido uma fusão. O vencedor é o único da cadeia que não aponta
// para mais ninguém.
//
// reduce() em vez de apoc.coll.toSet: este projeto não usa APOC, e a dedupe em
// Cypher puro é o que faz a segunda execução ser no-op.

MATCH (g:Entidade)-[:FUNDIDA_EM*]->(v:Entidade)
WHERE size(labels(g)) = 1
  AND NOT (v)-[:FUNDIDA_EM]->()
WITH v, collect(DISTINCT g.nome) AS grafias
SET v.aliases = reduce(acc = coalesce(v.aliases, []), n IN grafias |
      CASE WHEN n IN acc THEN acc ELSE acc + [n] END);

// ── 2. Os nós de grafia preservados são apagados ──
//
// A condição `g.nome IN coalesce(v.aliases, [])` é a trava: só some o que o
// statement 1 gravou. Nó de grafia que por qualquer motivo não foi preservado
// continua no grafo, funcionando como sempre funcionou.
//
// DETACH e não DELETE simples: o nó tem a aresta :FUNDIDA_EM, e pode ter um
// :DISTINTA_DE — ver a seção 3.

MATCH (g:Entidade)-[:FUNDIDA_EM*]->(v:Entidade)
WHERE size(labels(g)) = 1
  AND NOT (v)-[:FUNDIDA_EM]->()
  AND g.nome IN coalesce(v.aliases, [])
DETACH DELETE g;

// ---------------------------------------------------------------------------
// 4. Contrato completo depois desta migration
// ---------------------------------------------------------------------------
//
//   (:Entidade { id, nome, nome_normalizado, criado_em, status,
//                contexto, pode_ajudar_com, fizemos_juntos,
//                embedding, embedding_modelo, embedding_fonte,
//                resumo, aliases, canonico })                          (009)
//
//   status ∈ 'ativa' | 'fundida'
//   resumo    ≤ 500 caracteres (TETO_RESUMO); ausente = ''
//   aliases   lista de strings; ausente = []
//   canonico  booleano; ausente = false
//
//   contexto, pode_ajudar_com, fizemos_juntos — SEM TETO a partir daqui  (009)
//
//   :Pessoa | :Projeto | :Objetivo | :Organizacao — sempre com :Entidade (007)
//
//   (:Entidade)-[:FUNDIDA_EM]->(:Entidade)   fusão de duas entidades reais (004)
//                                            — grafia de STT NÃO usa mais  (009)
//   (:Entidade)-[:DISTINTA_DE]->(:Entidade)  recusa minha                  (004)
//   (:Atomo)-[:PERFILA { campo }]->(:Entidade)                             (005)
