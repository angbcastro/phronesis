// 003 — Calibração da extração: dois tipos novos de átomo e âncora múltipla.
//
// ATENÇÃO: esta migration não tem statement nenhum. Ela existe porque
// db/migrations/ é a definição canônica do schema (CLAUDE.md) e o contrato de
// :Atomo mudou — mas nada do que mudou é declarável no Aura Free, que não tem
// constraint de valor de propriedade nem de existência (recurso Enterprise).
// Aplicá-la é um no-op; `scripts/migrate.ts` conta 0 statement(s) e segue.
//
// Quem garante o contrato abaixo é `src/lib/tipos.ts` e os testes. O arquivo
// existe para que quem for ler o schema veja a verdade, e não a verdade de
// duas semanas atrás.
//
// ---------------------------------------------------------------------------
// 1. `tipo` de :Atomo ganha DECISAO e ROTINA
// ---------------------------------------------------------------------------
//
//   tipo ∈ FATO | OPINIAO | SENTIMENTO | APRENDIZADO | CONQUISTA | DECISAO | ROTINA
//
// DECISAO — "decidi parar de dar prazo sem multa". Não é fato (ainda não
//   aconteceu), não é opinião (é compromisso), não é aprendizado (é o que se
//   faz com ele). É o material mais rico para o trabalho "confrontar" da visão:
//   mudar de ideia sobre uma decisão é exatamente o que vale ser confrontado.
//
// ROTINA — o átomo único por sessão que colapsa as trivialidades do dia
//   ("lavei roupa, treinei, fiz o exercício da faculdade, comprei uma roupa").
//   Existe como tipo próprio para poder ser filtrado para fora de uma busca
//   por aprendizado e para dentro de uma busca por "como eram meus dias em
//   agosto". Sem ele, ou a trivialidade suja o grafo como FATO, ou se perde.
//
// ---------------------------------------------------------------------------
// 2. Um átomo passa a ter 1..n âncoras no áudio
// ---------------------------------------------------------------------------
//
// Antes:  inicio_s, fim_s, ancora        (escalares — uma âncora por átomo)
// Agora:  inicios_s, fins_s, ancoras     (listas paralelas, mesmo comprimento)
//
// O átomo passou a juntar o mesmo assunto dito em momentos distintos da sessão,
// e o átomo de ROTINA colapsa vários. Com uma âncora só, o átomo afirmaria mais
// do que é possível escutar — e "todo item aponta para o segundo exato do
// áudio" é uma necessidade declarada em Specs/visao.md §4. Listas paralelas
// porque Neo4j não guarda array de mapa como propriedade; a alternativa seria
// um nó :Trecho por âncora, que multiplica nó sem ninguém pedir.
//
// O índice atomo_valido_em (002) continua sendo o eixo temporal da busca.
// Não há índice sobre as listas: ninguém busca por offset.
//
// ---------------------------------------------------------------------------
// 3. Sem migração de dado
// ---------------------------------------------------------------------------
//
// O grafo tem ZERO :Atomo e ZERO :Entidade — nada foi confirmado ainda, porque
// a tela de revisão não existe. Não há nó para converter de escalar para lista.
// Se algum dia houver, a conversão é outra migration, não esta.
//
// Contrato completo de :Atomo depois desta migration:
//
//   (:Atomo { id, texto, tipo, inicios_s, fins_s, ancoras,
//             criado_em, valido_em, status, prompt_version, modelo })
