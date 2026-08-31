// 005 — Slice 4. Identidade por contexto: a entidade ganha perfil, e o átomo
// ganha como dizer que carrega informação de perfil sobre alguém.
//
// ATENÇÃO: esta migration não tem statement nenhum — como a 003. Propriedade de
// valor livre não se declara no Aura Free (constraint de existência é recurso
// Enterprise) e tipo de relação não se declara em Neo4j nenhum. Aplicá-la é um
// no-op; `scripts/migrate.ts` conta 0 statement(s) e segue.
//
// Ela existe porque db/migrations/ é a definição canônica do schema (CLAUDE.md)
// e o contrato mudou. Quem lê o schema tem que ver a verdade, não a verdade de
// duas semanas atrás.
//
// ---------------------------------------------------------------------------
// 1. :Entidade ganha três campos de perfil
// ---------------------------------------------------------------------------
//
//   (:Entidade { id, nome, nome_normalizado, criado_em, status,
//                contexto, pode_ajudar_com, fizemos_juntos })
//
//   contexto         contexto geral sobre ela: quem é para mim — "colega de
//                    trabalho", "amigo, mora comigo" — e qualquer outra coisa
//                    que me seja relevante saber: momento de vida, situação,
//                    o que está acontecendo com ela
//   pode_ajudar_com  habilidades: o que sabe, com o que já trabalhou
//   fizemos_juntos   as histórias — o que já vivemos juntos
//
// Texto livre, editável à mão em /entidades, com teto de 300 caracteres por
// campo (`TETO_PERFIL`, em src/lib/tipos.ts). O teto não é estética: os três
// campos de TODAS as entidades entram no prompt do agente de resolução, e sem
// teto o custo daquela chamada cresce com o tamanho do grafo.
//
// Para que servem: são o que o agente 2 lê para decidir de QUEM eu estou
// falando quando duas pessoas têm nome homófono. "Raffa" e "Rapha" são o mesmo
// som, o STT escreve uma grafia só para os dois, e a grafia carrega zero sinal
// sobre quem é. Só o contexto resolve — e `fizemos_juntos` é o mais forte dos
// três, porque atividade compartilhada ("slackline no parque") é exatamente o
// que aparece na transcrição.
//
// CAMPO AUSENTE CONTA COMO VAZIO, na leitura (`coalesce` em toda consulta).
// Mesma decisão do `status` na 004 e pela mesma razão: a defesa tem que valer
// para o nó que um deploy antigo criar amanhã, não só para os que existem hoje.
//
// Sem índice: ninguém busca por perfil, e o Aura Free tem cota de índice.
//
// ---------------------------------------------------------------------------
// 2. (:Atomo)-[:PERFILA { campo }]->(:Entidade)
// ---------------------------------------------------------------------------
//
//   campo ∈ contexto | pode_ajudar_com | fizemos_juntos
//
// "Este átomo diz algo que pertence ao perfil daquela entidade, naquele campo."
// Quem marca é o agente 2, que já está olhando átomo e entidade juntos; quem
// grava é o confirmar, junto com os átomos, e nunca antes (regra 5).
//
// Aresta, e não propriedade do átomo, por duas razões:
//
//   - a marca precisa dizer DE QUEM é a informação. "fui no parque andar de
//     slack com o Raffa" é `sobre: "eu"` pelas regras de tipo do extracao-5, e
//     a informação de perfil é do Raffa;
//   - Neo4j não guarda array de mapa como propriedade — foi isso que forçou as
//     listas paralelas da 003. Aresta com propriedade ele guarda bem, e fica
//     consultável: "todo átomo que diz o que o Rapha sabe fazer".
//
// Idempotente por construção: o MERGE inclui a propriedade `campo`, então
// reconfirmar a mesma sessão não cria aresta repetida (regra 4).
//
// ---------------------------------------------------------------------------
// 3. Sem migração de dado
// ---------------------------------------------------------------------------
//
// Nenhum nó é convertido e nenhum campo é preenchido. As entidades de hoje
// entram no catálogo do agente 2 só com nome e tipo, que é o comportamento
// anterior a esta slice — perfil vazio é perfil válido.
//
// Contrato completo de :Entidade depois desta migration:
//
//   (:Entidade { id, nome, nome_normalizado, criado_em, status,
//                contexto, pode_ajudar_com, fizemos_juntos })
//   status ∈ 'ativa' | 'fundida'
//
//   (:Entidade)-[:FUNDIDA_EM]->(:Entidade)    do alias para o vencedor    (004)
//   (:Entidade)-[:DISTINTA_DE]->(:Entidade)   recusa minha                (004)
//   (:Atomo)-[:PERFILA { campo }]->(:Entidade)                            (005)
