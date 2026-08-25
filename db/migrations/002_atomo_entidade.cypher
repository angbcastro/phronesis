// 002 — Slice 2. O conteúdo do diário entra no grafo: :Atomo e :Entidade.
//
// Esta migration não grava dado nenhum. Ela declara constraint e índice; o que
// escreve átomo é o confirmar da revisão — regra 5, nada entra no grafo antes
// da minha confirmação.
//
// Tipo de relação não se declara em Neo4j: :GEROU, :SOBRE e :MENCIONA passam a
// existir quando a primeira aresta é criada. Ficam aqui em comentário porque
// db/migrations/ é a definição canônica do schema e quem lê este arquivo tem
// que ver o contrato inteiro:
//
//   (:Sessao)-[:GEROU]->(:Atomo)
//   (:Atomo)-[:SOBRE]->(:Entidade)       // exatamente 1, sujeito principal
//   (:Atomo)-[:MENCIONA]->(:Entidade)    // 0..n
//
// :Pessoa, :Projeto e :Objetivo carregam sempre também :Entidade. Constraint é
// por label, então as de :Entidade abaixo valem para os três de uma vez.
//
// Constraint de existência de propriedade (IS NOT NULL) não entra: é recurso
// Enterprise e o Aura Free recusa. Campo obrigatório é garantido pelo código
// que grava e pelos testes, não pelo banco.

// :Atomo { id, texto, tipo, inicio_s, fim_s, criado_em, valido_em,
//          status, prompt_version, modelo }
//
// id determinístico: <sessao_id>-<índice>. É o que faz o MERGE do confirmar ser
// idempotente — retry não duplica átomo (regra 4).
CREATE CONSTRAINT atomo_id IF NOT EXISTS
FOR (a:Atomo) REQUIRE a.id IS UNIQUE;

// :Entidade { id, nome, nome_normalizado, criado_em }
CREATE CONSTRAINT entidade_id IF NOT EXISTS
FOR (e:Entidade) REQUIRE e.id IS UNIQUE;

// A trava contra o grafo apodrecido. Duas menções à mesma pessoa não viram dois
// nós — nem em corrida, porque quem garante é o banco e não o código de
// resolução. Note o alcance: o nome é único entre TODAS as entidades, então um
// :Projeto e uma :Pessoa não podem se chamar a mesma coisa. É deliberado nesta
// slice: colisão de nome entre tipos é rara, e falhar na hora de confirmar é
// melhor que criar silenciosamente duas coisas com o mesmo nome.
CREATE CONSTRAINT entidade_nome_normalizado IF NOT EXISTS
FOR (e:Entidade) REQUIRE e.nome_normalizado IS UNIQUE;

// Revisão e deleção soft filtram por status; o grafo nunca perde átomo (regra 6).
CREATE INDEX atomo_status IF NOT EXISTS
FOR (a:Atomo) ON (a.status);

CREATE INDEX atomo_tipo IF NOT EXISTS
FOR (a:Atomo) ON (a.tipo);

// Eixo temporal do "como eu estava em julho". Índice, não feature: a busca é
// slice 3, mas acrescentar índice depois custa outra migration.
CREATE INDEX atomo_valido_em IF NOT EXISTS
FOR (a:Atomo) ON (a.valido_em);
