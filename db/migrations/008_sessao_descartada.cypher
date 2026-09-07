// 008 — A sessão que eu apago some da lista, e o grafo fica inteiro.
//
// ATENÇÃO: esta migration não tem statement nenhum — como a 003, a 005 e a 007.
// Propriedade não se declara em Neo4j, e no Aura Free não há constraint de
// existência nem de valor para declará-la (recurso Enterprise). `descartada_em`
// passa a existir no primeiro nó que a recebe, no DELETE da rota. Aplicá-la é um
// no-op; `scripts/migrate.ts` conta 0 statement(s) e segue.
//
// Ela existe porque db/migrations/ é a definição canônica do schema (CLAUDE.md)
// e o contrato de :Sessao mudou. Quem lê o schema tem que ver a verdade.
//
// ---------------------------------------------------------------------------
// 1. :Sessao ganha `descartada_em`
// ---------------------------------------------------------------------------
//
//   (:Sessao { id, iniciada_em, duracao_s, status, audio_key, transcricao_key,
//              chunks_total, descartada_em })
//
// descartada_em — ISO do momento em que eu apaguei a sessão, ou AUSENTE.
//
//   Ausente é o caso normal, e é assim que fica toda sessão gravada antes desta
//   migration: `todasSessoes` filtra por `s.descartada_em IS NULL`, e ausente
//   passa nesse teste igual a null. SEM MIGRAÇÃO DE DADO — não há nada a
//   preencher, e preencher seria inventar uma data que ninguém viveu.
//
//   NÃO É UM `status`. A máquina de estados (`estados.ts`) descreve o que a
//   sessão está fazendo, e `descartada` não é um passo do pipeline: é um gesto
//   meu, por fora, sobre uma sessão que já terminou de processar — a rota recusa
//   com 409 qualquer outra. Enfiar o valor em `status` obrigaria toda transição
//   e todo guard a conhecer um estado que não transiciona para lugar nenhum.
//
// ---------------------------------------------------------------------------
// 2. O que o DELETE NÃO faz, e por quê
// ---------------------------------------------------------------------------
//
// SEM `DELETE` NO GRAFO. A regra 6 do CLAUDE.md proíbe `DELETE` em átomo, e um
// `DETACH DELETE` no `:Sessao` levaria junto o `GEROU` e orfanaria os átomos de
// uma sessão já confirmada — átomos que eu aprovei um a um na revisão. O nó de
// sessão fica, marcado; os átomos ficam, intactos; o que some é o material no
// R2.
//
// A CONSEQUÊNCIA, ACEITA E NÃO DESCUIDADA: `audio_key` e `transcricao_key` de
// uma sessão descartada passam a apontar para objetos que não existem mais. A
// procedência do átomo continua verdadeira sobre o que ele foi — `prompt_version`
// e `modelo` são o que a regra 7 pede, e nenhum dos dois mora no R2 —, mas o
// áudio que a sustentava não volta. É o preço de poder limpar sessão de teste.
//
// SEM ÍNDICE. `todasSessoes` já varre com `LIMIT 50` sobre um grafo de uma
// pessoa só, e o Aura Free tem cota de índice.
