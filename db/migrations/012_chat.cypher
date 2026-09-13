// 012 — Slice 6. O chat: a conversa vira nó, e as mensagens vão para o R2.
//
// ATENÇÃO: esta migration NÃO TEM STATEMENT NENHUM — como a 005, a 007, a 008,
// a 010 e a 011. Propriedade de valor livre não se declara no Aura Free
// (constraint de existência é recurso Enterprise), e índice novo não entra por
// cota (§14 do ARCHITECTURE.md). Aplicá-la é um no-op; `scripts/migrate.ts`
// conta 0 statement(s) e segue.
//
// Ela existe porque `db/migrations/` é a definição canônica do schema
// (CLAUDE.md) e o contrato do grafo mudou: nasce um label novo.
//
// PROPOSTA — não rodar sem minha aprovação (CLAUDE.md).
//
// ---------------------------------------------------------------------------
// 1. O label novo
// ---------------------------------------------------------------------------
//
//   (:Conversa {
//      id,                  // base36, o mesmo formato de :Sessao (`novoId`)
//      titulo,              // gerado pelo agente `titulo-chat` sobre a primeira
//                           // troca; string vazia enquanto ele não respondeu
//      criado_em,           // ISO 8601
//      atualizada_em,       // ISO 8601 — é por ele que a lista ordena
//      arquivada_em,        // ISO 8601 ou AUSENTE. Ausente = ativa
//      mensagens_key        // a chave do objeto de mensagens no R2
//   })
//
// SEM RELAÇÃO NENHUMA. `:Conversa` **não** é `:Entidade` nem `:Atomo`, e não se
// liga a nada do grafo de conhecimento — é metadado de aplicação, como
// `:Sessao`. Uma conversa enxerga o grafo pelas duas ferramentas do agente
// `chat`, nunca por aresta própria; e uma conversa nunca enxerga outra
// (decisão da entrevista, `Specs/slice-6.md`).
//
// ---------------------------------------------------------------------------
// 2. Por que nó leve no Neo4j e mensagens no R2
// ---------------------------------------------------------------------------
//
// É o padrão de `:Sessao`, e pela mesma razão: listar conversa tem de ser uma
// query, e o conteúdo é pesado. Guardar tudo no R2, com um manifesto em JSON e
// nenhum nó novo, foi considerado e recusado — listar viraria ler-e-regravar
// um arquivo em vez de `MATCH`, e a regra 2 do CLAUDE.md ("no Neo4j vai só a
// chave") já descreve exatamente esta separação.
//
//   conversas/<conversa_id>/mensagens.json
//
// O objeto guarda a conversa inteira: papel, texto, `criado_em` e — só nas do
// agente — o rastro completo de ferramentas (nome, parâmetros, o que voltou),
// que é o que o botão (i) mostra.
//
// ---------------------------------------------------------------------------
// 3. Apagar é apagar, e arquivar é congelar — as duas, e não só uma
// ---------------------------------------------------------------------------
//
// **Esta é a única exceção à regra 6 do CLAUDE.md em todo o sistema, e ela é
// deliberada.** A regra 6 fala de átomo: "deleção é soft, nunca DELETE em
// átomo". Conversa não é átomo — não é conhecimento, é a transcrição de uma
// pergunta que eu fiz a uma tela. Nada do grafo depende dela, nenhum átomo
// perde procedência quando ela some, e o pedido da entrevista foi explícito:
// ter as duas ações, não só uma.
//
//   apagar    `DETACH DELETE` no nó + `remover` no objeto do R2. Some de vez.
//   arquivar  `SET c.arquivada_em = <ISO>`. A conversa congela: não aceita
//             mensagem nova, sai da lista principal e continua legível num
//             separador de arquivadas. `REMOVE` desarquiva.
//
// O `DETACH` no delete é cinto de segurança, não necessidade: o nó nasce sem
// aresta nenhuma (§1) e deve morrer assim. Se um dia alguém pendurar algo
// nele, o delete continua funcionando em vez de estourar.
//
// ---------------------------------------------------------------------------
// 4. Sem índice, e o que isso custa
// ---------------------------------------------------------------------------
//
// `listarConversas` varre `(:Conversa)` com `ORDER BY c.atualizada_em DESC` e
// `LIMIT`, sobre o grafo de uma pessoa só — a mesma conta de `todasSessoes`
// (008), e a mesma razão para não gastar cota: Aura Free tem cota de índice, e
// ela já está no limite conhecido (§14) por causa dos dois índices vetoriais
// da 006.
//
// Nem constraint de unicidade em `id`: ao contrário de `:Sessao` (001), nada
// aqui faz `MERGE` por id — a conversa nasce de um `CREATE` com id sorteado em
// `novoId()`, e a unicidade vem da origem. Um índice para proteger o que a
// origem já garante seria cota gasta por simetria.
//
// ---------------------------------------------------------------------------
// 5. Contrato completo do grafo depois desta migration
// ---------------------------------------------------------------------------
//
// Nada do que já existia muda. `:Atomo`, `:Entidade`, `:Sessao` e as relações
// (`:SOBRE`, `:MENCIONA`, `:PERFILA`, `:FUNDIDA_EM`, `:DISTINTA_DE`, `:GEROU`,
// e as quatro da 011) ficam exatamente como estavam. O que entra é um label
// solto, e é por ser solto que ele não pode quebrar nada:
//
//   (:Conversa { id, titulo, criado_em, atualizada_em,
//                arquivada_em, mensagens_key })                       (012)
