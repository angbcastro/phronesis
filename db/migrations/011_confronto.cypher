// 011 — Slice 5. Confrontar: relações entre átomos ao longo do tempo.
//
// ATENÇÃO: esta migration NÃO TEM STATEMENT NENHUM — como a 005, a 007 e a
// 010. Propriedade de valor livre e relação nova não se declaram no Aura
// Free (constraint de existência é recurso Enterprise, e a cota de índice já
// está no limite conhecido — ver §14 do ARCHITECTURE.md). Aplicá-la é um
// no-op; `scripts/migrate.ts` conta 0 statement(s) e segue.
//
// Ela existe porque `db/migrations/` é a definição canônica do schema
// (CLAUDE.md) e o contrato do grafo mudou: nascem quatro relações novas entre
// átomos, e `:Atomo` ganha o controle da varredura que as produz.
//
// PROPOSTA — não rodar sem minha aprovação (CLAUDE.md).
//
// ---------------------------------------------------------------------------
// 1. Quatro relações novas entre átomos, sempre do mais novo para o mais velho
// ---------------------------------------------------------------------------
//
//   (:Atomo mais_novo)-[:ATUALIZA    { execucao, motivo, confianca,
//                        :CONTRADIZ    criado_em, modelo, prompt_version }]
//                        :CONFIRMA
//                        :COMPLEMENTA]->(:Atomo mais_antigo)
//
//   ATUALIZA      o mais novo substitui a posição do mais antigo — mesma
//                 afirmação específica, mas ela mudou.
//   CONTRADIZ     o mais novo se opõe diretamente ao mais antigo.
//   CONFIRMA      o mais novo repete a mesma afirmação específica, sem
//                 acrescentar nem mudar nada.
//   COMPLEMENTA   o mais novo acrescenta informação nova e compatível sobre
//                 o mesmo assunto, sem mudar nem repetir o que já estava
//                 dito — o meio-termo que faltava entre os outros três.
//
//   execucao         id da rodada que gravou esta relação (auditoria — não é
//                    chave de desfazer; ver §3)
//   motivo           frase curta do agente `confronto`, em português
//   confianca        0..1
//   criado_em        ISO 8601
//   modelo           string `provedor/modelo` (regra 7, em espírito — a
//                    regra fala de átomo, e uma relação decidida por LLM
//                    pede a mesma auditoria)
//   prompt_version   carimbo do agente, com sufixo de override quando houver
//                    (overrides.ts)
//
// Direção fixa: quem inicia a aresta é sempre o átomo que estava sendo
// processado (o mais novo dos dois), nunca o candidato. Um átomo pode ter
// várias arestas de saída (relaciona com mais de um átomo antigo) e várias de
// entrada (átomos mais novos apontam pra ele) — cardinalidade N:N, como
// `:MENCIONA`.
//
// ---------------------------------------------------------------------------
// 2. :Atomo ganha o controle da varredura
// ---------------------------------------------------------------------------
//
//   (:Atomo { …,
//             confronto_estado, confronto_em,
//             confronto_execucao, confronto_motivo })
//
//   confronto_estado    ∈ 'rodando' | 'processado' | 'falhou'
//                        ausente = nunca tentado — o estado de todo átomo
//                        antes desta fatia rodar pela primeira vez, e o que
//                        o desfazer restaura
//   confronto_em         ISO 8601 — quando o estado mudou
//   confronto_execucao   id da última rodada que tocou este átomo (o mesmo
//                        valor que suas relações de saída carregam em
//                        `execucao`) — auditoria, não trava de desfazer
//   confronto_motivo      o erro, quando `falhou`; string vazia caso contrário
//
// TODOS AUSENTES CONTAM COMO "NUNCA TENTADO" NA LEITURA, pela mesma razão do
// `status` (004) e do `enriquecimento_estado` (010): a defesa tem que valer
// para o átomo que uma sessão de ontem gravou, não só para os que passaram
// pela varredura hoje.
//
// SEM ÍNDICE sobre `confronto_estado`, pela mesma razão da fila de
// enriquecimento (010): a varredura usa o índice `atomo_status` que já existe
// (002) e filtra `confronto_estado` em memória. Escrito aqui para quando a
// pergunta voltar, se o volume de átomos um dia justificar a cota.
//
// ---------------------------------------------------------------------------
// 3. Por que "uma geração" não precisa casar `execucao` para desfazer
// ---------------------------------------------------------------------------
//
// Ao contrário da ficha da entidade (010), que SOBRESCREVE um campo e por
// isso precisa de um `_anterior` para restaurar o que estava lá, uma relação
// é uma aresta que só existe se for escrita. `gravarRelacoes` (confronto.ts)
// APAGA todas as relações de saída do átomo antes de escrever as novas, toda
// vez que roda — então nunca há mais de uma geração de arestas viva ao mesmo
// tempo, e o desfazer não precisa filtrar por `execucao`: ele apaga o que
// existe agora, porque "o que existe agora" já É a última geração. Isso
// também cobre de graça o caso de uma rodada morrer entre gravar a relação e
// marcar `processado`: a tentativa seguinte substitui, nunca duplica ou
// deixa um tipo de relação órfão de uma decisão anterior diferente.
//
// `execucao` continua existindo, e continua igual entre o átomo e suas
// relações — é o rastro de auditoria ("que rodada decidiu isto"), não a trava
// de correção.
//
// ---------------------------------------------------------------------------
// 4. Nunca em tempo real, e o que isso implica para o schema
// ---------------------------------------------------------------------------
//
// A varredura roda só por cron próprio (`/api/cron/confronto`) e sob demanda
// (`POST /api/confronto/rodar`) — nunca amarrada à confirmação de um átomo
// (decisão da entrevista). Por isso `confronto_estado` de um átomo recém-
// confirmado é sempre "ausente": ele espera a próxima rodada, e não há
// nenhum caminho de escrita que precise saber disso na hora de confirmar.
// `sessoes.ts`/`atomos.ts` não mudam nesta fatia.
//
// ---------------------------------------------------------------------------
// 5. Contrato completo de :Atomo depois desta migration
// ---------------------------------------------------------------------------
//
//   (:Atomo { id, texto, tipo, inicios_s, fins_s, ancoras,
//             criado_em, valido_em, status,
//             prompt_version, modelo,
//             embedding, embedding_modelo,                        (006)
//             confronto_estado, confronto_em,
//             confronto_execucao, confronto_motivo })              (011)
//
//   (:Atomo mais_novo)-[:ATUALIZA|:CONTRADIZ|:CONFIRMA|:COMPLEMENTA
//     { execucao, motivo, confianca,
//       criado_em, modelo, prompt_version }]->(:Atomo mais_antigo)   (011)
//
// Nada além disto muda: `:Entidade` e as relações que já existiam (`:SOBRE`,
// `:MENCIONA`, `:PERFILA`, `:FUNDIDA_EM`, `:DISTINTA_DE`) ficam como estavam.
