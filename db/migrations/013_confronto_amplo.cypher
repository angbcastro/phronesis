// 013 — Slice 5.2. O confronto amplo: duas camadas, a minha edição, e a recusa.
//
// ATENÇÃO: esta migration NÃO TEM STATEMENT NENHUM — como a 005, a 007, a 010
// e a 011. Propriedade nova de relação e relação nova não se declaram no Aura
// Free (constraint de existência é recurso Enterprise, e a cota de índice está
// no limite conhecido — §14 do ARCHITECTURE.md). Aplicá-la é um no-op;
// `scripts/migrate.ts` conta 0 statement(s) e segue.
//
// Ela existe porque `db/migrations/` é a definição canônica do schema
// (CLAUDE.md), e o contrato das relações de confronto (011) mudou.
//
// PROPOSTA — aprovada quando eu mandar buildar o commit que a contém (CLAUDE.md).
//
// ---------------------------------------------------------------------------
// 1. As quatro relações de confronto ganham quatro propriedades
// ---------------------------------------------------------------------------
//
//   (:Atomo mais_novo)-[:ATUALIZA|:CONTRADIZ|:CONFIRMA|:COMPLEMENTA {
//       execucao, motivo, confianca, criado_em, modelo, prompt_version,  (011)
//       camada, origem, dono, editado_em,                                (013)
//       original_tipo, original_camada, original_motivo                  (013)
//   }]->(:Atomo mais_antigo)
//
//   camada      'forte' | 'sutil'
//               forte: a afirmação que os dois têm em comum se escreve com
//               palavras dos DOIS trechos (o portão da 5.1).
//               sutil: a ligação é real mas pede uma inferência — o chat a
//               cita como ligação provável, nunca como fato.
//               AUSENTE = 'forte': tudo o que a 5 e a 5.1 gravaram passou
//               pelo portão.
//
//   origem      'agente' | 'eu'
//               'eu' = eu editei esta relação em /confronto. Ela fica
//               CONGELADA: o agente não a apaga nem a reescreve, nem na
//               rodada do átomo, nem no desfazer, nem no reprocessar.
//               AUSENTE = 'agente'.
//
//   dono        id do átomo cuja rodada escreveu esta aresta.
//               Até a 5.1 a rodada de um átomo só escrevia arestas que SAÍAM
//               dele. Desde a 5.2 o átomo é comparado também com os mais
//               novos, e a aresta desse par sai do outro — a rodada escreve
//               aresta que CHEGA ao alvo. "Uma geração" passa a ser "as
//               arestas cujo dono é o alvo", não "as de saída".
//               AUSENTE = o átomo de onde a aresta sai, que era sempre o caso.
//
//   editado_em  ISO 8601 — quando eu a editei. Ausente = nunca editei.
//
//   original_tipo, original_camada, original_motivo
//               o que o AGENTE tinha gravado, guardado na minha primeira
//               edição e nunca mais reescrito. É o "antes" da correção que a
//               edição manda para /calibracao: corrigir duas vezes a mesma
//               relação continua ensinando contra o que o agente fez, não
//               contra o que eu tinha deixado. Trocar o tipo é apagar e
//               recriar a aresta, e o original vai junto com as outras
//               propriedades. AUSENTE = nunca editei; o original é o valor.
//
// A direção continua fixa, e agora é decidida pelo código, nunca pelo modelo:
// `valido_em` maior é o mais novo; com o mesmo `valido_em` (mesma sessão), o
// que foi dito depois — `inicios_s[0]` maior; empate final por id.
//
// ---------------------------------------------------------------------------
// 2. Uma relação nova: a recusa
// ---------------------------------------------------------------------------
//
//   (:Atomo)-[:CONFRONTO_RECUSADO { em, tipo }]->(:Atomo)
//
//   Eu apaguei a relação entre estes dois em /confronto. A recusa é DO PAR,
//   não do tipo: o agente nunca mais os propõe, em direção nenhuma, com tipo
//   nenhum. A direção da aresta é a da relação recusada (mais novo → mais
//   antigo) e não significa nada na leitura.
//
//   em     ISO 8601
//   tipo   o tipo da relação que eu apaguei — auditoria
//
//   Tipo próprio, e não uma propriedade `status` nas quatro, para que nenhum
//   leitor que casa ATUALIZA|CONTRADIZ|CONFIRMA|COMPLEMENTA a enxergue por
//   engano — o chat, a tela, a contagem. Mesmo espírito do `DISTINTA_DE` (009).
//
//   Ela não é conhecimento, é escrituração da minha recusa — como o
//   `DISTINTA_DE`. E não se apaga: a regra 6 não abre exceção para ela.
//
// ---------------------------------------------------------------------------
// 3. O que não muda
// ---------------------------------------------------------------------------
//
// `:Atomo` não ganha nada: o controle da varredura (`confronto_estado`,
// `confronto_em`, `confronto_execucao`, `confronto_motivo`) é o da 011.
// Nenhum índice novo — a busca de candidatos é a mesma `atomo_embedding` (006).
