// 010 — Slice 4.12. A ficha se escreve sozinha: a entidade ganha o estado da
// fila de enriquecimento e uma geração de desfazer.
//
// ATENÇÃO: esta migration NÃO TEM STATEMENT NENHUM — como a 005 e a 007.
// Propriedade de valor livre não se declara no Aura Free (constraint de
// existência é recurso Enterprise). Aplicá-la é um no-op; `scripts/migrate.ts`
// conta 0 statement(s) e segue.
//
// Ela existe porque `db/migrations/` é a definição canônica do schema
// (CLAUDE.md) e o contrato de `:Entidade` mudou. Quem lê o schema tem que ver a
// verdade, não a verdade de uma fatia atrás.
//
// PROPOSTA — não rodar sem minha aprovação (CLAUDE.md).
//
// ---------------------------------------------------------------------------
// 1. :Entidade ganha o desfazer e o estado da fila
// ---------------------------------------------------------------------------
//
//   (:Entidade { …,
//                resumo_anterior, contexto_anterior,
//                pode_ajudar_com_anterior, fizemos_juntos_anterior,
//                enriquecimento_estado, enriquecimento_motivo,
//                enriquecimento_em, enriquecimento_atomos })
//
//   resumo_anterior            o que a última escrita sobrescreveu — UMA geração
//   contexto_anterior          idem
//   pode_ajudar_com_anterior   idem
//   fizemos_juntos_anterior    idem
//
//   enriquecimento_estado      'na_fila' | 'rodando' | 'pronta' | 'falhou'
//   enriquecimento_motivo      o erro, quando falhou
//   enriquecimento_em          ISO 8601 — quando o estado mudou
//   enriquecimento_atomos      quantos átomos entraram na última rodada
//
// TODOS AUSENTES CONTAM COMO VAZIO NA LEITURA (`coalesce` em toda consulta),
// pela mesma razão do `status` na 004 e do perfil na 005: a defesa tem que valer
// para o nó que um deploy antigo criar amanhã, não só para os que existem hoje.
// Entidade sem `enriquecimento_estado` simplesmente NUNCA FOI ENRIQUECIDA — não
// é erro, e é o estado de todas elas hoje.
//
// SEM MIGRAÇÃO DE DADO. Nenhuma ficha existente é tocada. Um `_anterior` vazio
// quer dizer "não há geração anterior guardada", e é assim que toda entidade
// entra nesta fatia.
//
// ---------------------------------------------------------------------------
// 2. Por que os quatro `_anterior` existem, e por que esta migration é própria
// ---------------------------------------------------------------------------
//
// Porque O LOTE ESCREVE SOZINHO. A 4.12 reabre, de propósito, o que o
// ARCHITECTURE.md §4.9 declarava: até aqui nada entrava no perfil sem o meu
// toque campo a campo, porque perfil errado contamina toda atribuição futura e
// o erro se realimenta. A tela de aprovação em lote foi RECUSADA — ela é o
// próprio atrito que deixou cinco entidades sem ficha nenhuma desde 02/09 —, e
// a seleção mais o botão passam a ser o meu toque.
//
// O DESFAZER É O QUE SUBSTITUI AQUELA TELA. Ele é a razão de esta fatia ter
// migration própria em vez de caber na 009: os quatro campos existem porque
// alguma coisa passou a escrever sem eu ver antes.
//
// A REGRA 5 DO CLAUDE.md CONTINUA VALENDO INTEIRA. Ela fala de ÁTOMO e da tela
// de revisão: nenhum átomo entra no grafo por este caminho. O que muda é o
// perfil, e o que muda é o §4.9 — reescrito nesta fatia dizendo que o perfil
// trocou de regime e por quê.
//
// UMA GERAÇÃO, E O DESFAZER É UMA TROCA. Desfazer põe o `_anterior` de volta no
// campo e guarda no `_anterior` o que estava lá — então o toque acidental se
// conserta com outro toque, e o invariante "o `_anterior` é sempre a geração
// imediatamente anterior" continua verdadeiro depois dele.
//
// O PREÇO, DECLARADO: rodar o lote duas vezes seguidas na mesma entidade perde o
// texto original, porque o `_anterior` da segunda rodada é o resultado da
// primeira. Histórico com data e origem foi recusado por custar nós ou
// propriedades novas e uma tela para ler isso — e por cobrir um caso que ainda
// não aconteceu. Uma geração cobre o caso real: rodei, olhei, não gostei, voltei.
//
// QUEM MAIS GRAVA `_anterior`: as duas escritas à mão de campo de ficha —
// `gravarCampo` (src/lib/perfil.ts) e `gravarResumo` (src/lib/fusao.ts). Não é
// enfeite de simetria: sem isso, uma edição minha depois do lote deixaria o
// `_anterior` apontando para duas gerações atrás, e o botão de desfazer
// apagaria o que eu tinha acabado de escrever.
//
// ---------------------------------------------------------------------------
// 3. Por que o estado da fila mora no NÓ, e não no R2
// ---------------------------------------------------------------------------
//
// O acumulado de uma sessão mora no R2 (§9) porque nada pode ser gravado no
// grafo antes da minha confirmação (regra 5). Aqui é o oposto: a entidade JÁ
// ESTÁ no grafo, e o que a fila guarda é sobre ela — não é proposta de
// conteúdo nenhum.
//
// E é o que faz "fechar a aba não interrompe nada" ser verdade: o elo seguinte
// da fila lê o estado do banco, não do navegador. `enriquecimento_estado` é a
// trava de idempotência da fatia (regra 4), chaveada pela entidade.
//
// SEM ÍNDICE, como o perfil (005) e o resumo (009). A fila é varrida sobre o
// catálogo que `listarEntidades()` já carrega inteiro, e o Aura Free tem cota de
// índice. O dia em que o catálogo não couber na memória de uma função, este é
// mais um lugar que pede índice — escrito aqui para quando a pergunta voltar.
//
// ---------------------------------------------------------------------------
// 4. Contrato completo de :Entidade depois desta migration
// ---------------------------------------------------------------------------
//
//   (:Entidade { id, nome, nome_normalizado, criado_em, status,
//                contexto, pode_ajudar_com, fizemos_juntos,
//                embedding, embedding_modelo, embedding_fonte,
//                resumo, aliases, canonico,                            (009)
//                resumo_anterior, contexto_anterior,
//                pode_ajudar_com_anterior, fizemos_juntos_anterior,    (010)
//                enriquecimento_estado, enriquecimento_motivo,
//                enriquecimento_em, enriquecimento_atomos })           (010)
//
//   status                 ∈ 'ativa' | 'fundida'
//   resumo                 ≤ 500 (TETO_RESUMO); ausente = ''
//   aliases                lista de grafias; ausente = []
//   canonico               booleano; ausente = false
//   contexto, pode_ajudar_com, fizemos_juntos — SEM TETO desde a       (009)
//   *_anterior             ausente = '' (não há geração guardada)
//   enriquecimento_estado  ausente = nunca enriquecida
//   enriquecimento_atomos  ausente = 0
//
//   :Pessoa | :Projeto | :Objetivo | :Organizacao — sempre com :Entidade (007)
//
//   (:Entidade)-[:FUNDIDA_EM]->(:Entidade)   fusão de duas entidades reais (004)
//                                            — grafia de STT não usa mais (009)
//   (:Entidade)-[:DISTINTA_DE]->(:Entidade)  recusa minha                 (004)
//   (:Atomo)-[:PERFILA { campo }]->(:Entidade)                            (005)
//
// O :PERFILA NÃO É TOCADO por esta fatia, e o agente 3 continua existindo. O
// lote lê `:SOBRE` + `:MENCIONA`, TODOS, sem teto: `:PERFILA` é o filtro que o
// agente 2 aplica em tempo de extração, com o critério dele, e o lote não
// precisa desse filtro — ele lê tudo e decide o que importa com todos os átomos
// na frente, que é uma decisão melhor informada que a de quem viu um por vez.
