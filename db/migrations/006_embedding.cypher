// 006 — Slice 4.5. O grafo ganha vetor: :Atomo e :Entidade passam a carregar um
// embedding, e a resolução de identidade ganha uma camada de candidato que
// enxerga significado e não grafia.
//
// DIFERENTE DA 003 E DA 005, esta migration TEM statements de verdade: índice
// se declara. Propriedade continua não se declarando no Aura Free (constraint
// de existência é Enterprise), então os campos abaixo são contrato escrito, não
// statement.
//
// ---------------------------------------------------------------------------
// 1. Os campos novos
// ---------------------------------------------------------------------------
//
//   (:Atomo    { …, embedding: [1536 floats], embedding_modelo })
//   (:Entidade { …, embedding: [1536 floats], embedding_modelo, embedding_fonte })
//
//   embedding         o vetor. Do texto e só do texto, no átomo; da string
//                     canônica (nome + tipo + aliases + os três campos de
//                     perfil), na entidade
//   embedding_modelo  qual modelo o produziu. Vetores de dois modelos no mesmo
//                     índice NÃO DÃO ERRO — dão vizinhança errada. Sem este
//                     campo não há como saber quais nós voltam para a fila
//                     quando EMBEDDING_MODEL mudar
//   embedding_fonte   hash da string canônica da entidade. É o que torna o
//                     refresh idempotente e dispensa gancho nas cinco rotas que
//                     mexem em entidade: hash bate, está em dia; não bate,
//                     reembute
//
// O ÁTOMO NÃO TEM `embedding_fonte`, e não é esquecimento: texto de átomo
// confirmado não muda — deleção é soft (regra 6) e o MERGE é por
// `<sessao_id>-<índice>`. `embedding IS NULL` é a trava que basta lá.
//
// CAMPO AUSENTE CONTA COMO "PRECISA EMBUTIR", na leitura. Mesma decisão do
// `status` na 004 e do perfil na 005, pela mesma razão: a defesa vale para o nó
// que um deploy antigo criar amanhã, não só para os que existem hoje.
//
// SEM MIGRAÇÃO DE DADO. Nenhum vetor é calculado aqui — quem preenche são
// POST /api/atomos/embutir e POST /api/entidades/embutir, que é o que permite
// o retrofill custar uma chamada de rota em vez de uma reextração.
//
// ---------------------------------------------------------------------------
// 2. Os dois índices
// ---------------------------------------------------------------------------
//
// Verificado contra a instância real (0adada47, Neo4j 5.27-aura) em 2026-09-02:
// o tier Free ACEITA CREATE VECTOR INDEX. Ficou ONLINE em menos de 500 ms e
// db.index.vector.queryNodes devolveu vizinhos com score. A doc negava só
// "Vector Optimization" (configuração ≥ 4 GB), que é outra coisa.
//
// A DIMENSÃO É A ÚNICA COISA AQUI QUE AMARRA. 1536 é o que
// `openai/text-embedding-3-small` devolve — o padrão de `modeloEmbedding()`,
// escolhido por medição contra o catálogo deste Gateway. Trocar para um modelo
// de outra dimensão exige DROP e recriar os dois índices, por migration nova;
// `src/lib/embedding.ts` estoura na porta se a dimensão não bater, para que o
// erro apareça antes do banco.
//
// O RESTO DA CONFIGURAÇÃO FICA NO PADRÃO, medido na mesma sondagem:
// quantization.type SCALAR, hnsw.m 16, ef_construction 100,
// default_search_expansion_factor 1.5. Explicitar `hnsw.m` ou `ef_construction`
// aqui seria fixar número que não foi calibrado contra nada — e o SCALAR do
// padrão é o que mantém o vetor DO ÍNDICE em torno de 6 MB para 4.000 átomos.
//
// IF NOT EXISTS mantém a migration reaplicável, como todas as outras
// (scripts/migrate.ts não tem tabela de controle).

CREATE VECTOR INDEX atomo_embedding IF NOT EXISTS
FOR (a:Atomo) ON (a.embedding)
OPTIONS { indexConfig: { `vector.dimensions`: 1536,
                         `vector.similarity_function`: 'cosine' } };

CREATE VECTOR INDEX entidade_embedding IF NOT EXISTS
FOR (e:Entidade) ON (e.embedding)
OPTIONS { indexConfig: { `vector.dimensions`: 1536,
                         `vector.similarity_function`: 'cosine' } };

// ---------------------------------------------------------------------------
// 3. O que o índice devolve, e em que espaço os pisos vivem
// ---------------------------------------------------------------------------
//
// `db.index.vector.queryNodes` com similaridade cosseno devolve o score
// NORMALIZADO para [0,1]:  score = (1 + cosseno) / 2.  É o que explica o 0,500
// da sondagem de 2026-09-02 — dois vetores ortogonais, cosseno 0.
//
// As consultas desta slice devolvem `2 * score - 1`, ou seja, o cosseno de
// volta, e os pisos de `resolucao.ts` vivem em espaço de cosseno. A razão é
// poder comparar o piso com o que eu meço à mão: `cosineSimilarity` do pacote
// `ai` fala cosseno, e um piso que só existe no espaço do banco seria número
// que ninguém consegue conferir fora dele.
//
// ---------------------------------------------------------------------------
// 4. Limite conhecido que esta migration cria
// ---------------------------------------------------------------------------
//
// `db.index.vector.queryNodes` está DEPRECADO a partir do Neo4j 2026.04, em
// favor da cláusula SEARCH. A instância é 5.27 e o procedimento funciona;
// quando a Aura subir, é uma linha a trocar em `src/lib/entidades.ts`.
//
// Contrato completo depois desta migration:
//
//   (:Atomo    { id, texto, tipo, inicios_s, fins_s, ancoras, valido_em,
//                status, prompt_version, modelo, criado_em,
//                embedding, embedding_modelo })                        (006)
//   (:Entidade { id, nome, nome_normalizado, criado_em, status,
//                contexto, pode_ajudar_com, fizemos_juntos,
//                embedding, embedding_modelo, embedding_fonte })       (006)
