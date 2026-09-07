// 007 — Dois modos que faltavam: o átomo ganha HISTORIA, e a entidade ganha
// :Organizacao.
//
// ATENÇÃO: esta migration não tem statement nenhum — como a 003 e a 005. Valor
// de propriedade não se declara no Aura Free (constraint de valor e de
// existência são recurso Enterprise), e label novo não se declara em Neo4j
// nenhum: `:Organizacao` passa a existir quando o primeiro nó a recebe, no
// confirmar da revisão. Aplicá-la é um no-op; `scripts/migrate.ts` conta
// 0 statement(s) e segue.
//
// Ela existe porque db/migrations/ é a definição canônica do schema (CLAUDE.md)
// e o contrato mudou nos dois lados. Quem lê o schema tem que ver a verdade, e
// não a verdade de duas semanas atrás.
//
// ---------------------------------------------------------------------------
// 1. `tipo` de :Atomo ganha HISTORIA
// ---------------------------------------------------------------------------
//
//   tipo ∈ FATO | OPINIAO | SENTIMENTO | APRENDIZADO | CONQUISTA | DECISAO
//        | HISTORIA | ROTINA
//
// HISTORIA — o episódio vivido, contado com o detalhe que eu contei: quem
//   estava, onde foi, o que foi dito, como terminou.
//
//   É o CONTRÁRIO dos outros sete, e é por isso que precisa de tipo próprio.
//   Todos eles pedem a afirmação destilada — uma frase que se sustente sozinha
//   daqui a um ano —, e a disciplina de volume do prompt ("prefira sempre o
//   átomo maior e mais organizado", "de 10 a 20 numa sessão de 15 minutos")
//   existe justamente para impedir o recorte miúdo. Sob essa disciplina, uma
//   história vira uma linha: "briguei com o Rafa no jantar". A linha é
//   verdadeira e não devolve nada — o que devolve a noite é o detalhe, e sem um
//   tipo que o autorize o detalhe não tem onde caber.
//
//   O prompt do extrator diz, na seção A HISTÓRIA GUARDA O DETALHE, que este é
//   o único tipo em que o texto pode ser longo, e que aqui não se resume.
//
//   HISTORIA ENTRA EM `TIPOS_SEMPRE_EU` (src/lib/tipos.ts), junto com
//   SENTIMENTO, APRENDIZADO e ROTINA: o sujeito é sempre `eu`, porque quem
//   viveu a história fui eu. Quem a viveu comigo vai em :MENCIONA — e é lá,
//   e não no sujeito, que a marca de perfil `fizemos_juntos` cai. O :PERFILA
//   da 005 já dizia isso com todas as letras ("a informação é DE QUEM ELA
//   FALA, não de quem é o sujeito do átomo"); HISTORIA é o tipo que mais o usa.
//
// SEM MIGRAÇÃO DE DADO. Nenhum átomo muda de tipo: HISTORIA é um valor a mais,
// não uma releitura dos que já estão gravados. O que o `extracao-7` colapsou em
// FATO continua FATO, e o carimbo de `prompt_version` é o que diz por quê.
//
// ---------------------------------------------------------------------------
// 2. :Entidade ganha o label :Organizacao
// ---------------------------------------------------------------------------
//
//   :Pessoa, :Projeto, :Objetivo, :Organizacao — todos carregam também
//   :Entidade, e as constraints da 002 (`id`, `nome_normalizado`) continuam
//   valendo para os quatro de uma vez, porque são por :Entidade.
//
// :Organizacao — empresa, ONG, startup, escola, faculdade, igreja, time,
//   cliente, fornecedor. A instituição em si.
//
//   Até aqui ela não tinha onde ficar, e caía num dos dois lugares errados: em
//   :Pessoa, que é o TIPO_PADRAO de quem o extrator não classifica, ou em
//   :Projeto, quando o extrator via trabalho acontecendo. A Adapta não é uma
//   pessoa; e o que corre dentro dela é que é o projeto. Com o label errado, o
//   filtro de tipo da revisão e do seletor mente, e o perfil de uma empresa
//   fica sob a mesma etiqueta do perfil de um amigo.
//
//   SEM CAMPO NOVO: uma organização tem os mesmos `contexto`,
//   `pode_ajudar_com` e `fizemos_juntos` da 005, e os três continuam servindo
//   — "cliente desde 2024", "faz integração com ERP", "fizemos o piloto do
//   Rodozanco juntos". Nada aqui pede propriedade nova.
//
//   O LABEL É ASCII, DE PROPÓSITO: `:Organizacao`, sem cedilha nem til. Neo4j
//   aceita acento em label, mas o label vai LITERAL na string de toda consulta
//   que grava ou troca tipo (`atomos.ts`, `fusao.ts`), porque ele não pode vir
//   de parâmetro. Como o tipo é escrito na tela é outra coisa, e mora em
//   `ROTULO_TIPO_ENTIDADE` (src/lib/tipos.ts): "organização".
//
// SEM MIGRAÇÃO DE DADO, e esta é a parte que importa: as empresas que já estão
// no grafo como :Pessoa NÃO são reclassificadas aqui. Reclassificar exigiria
// adivinhar quais nós são empresas — e "Adapta" ou "Exxmed" só são óbvias para
// quem conhece o diário. O conserto é o que já existe desde a slice 3: trocar
// o tipo à mão em /entidades, um nó de cada vez, com um toque meu em cada um
// (`trocarTipo`, que já remove os outros labels e põe o escolhido).
//
// SEM ÍNDICE. Ninguém busca por label: o catálogo sai de :Entidade e filtra em
// memória, e o Aura Free tem cota de índice.
//
// ---------------------------------------------------------------------------
// 3. Contrato completo depois desta migration
// ---------------------------------------------------------------------------
//
//   (:Atomo { id, texto, tipo, inicios_s, fins_s, ancoras, valido_em,
//             status, prompt_version, modelo, criado_em,
//             embedding, embedding_modelo })
//
//   tipo ∈ FATO | OPINIAO | SENTIMENTO | APRENDIZADO | CONQUISTA | DECISAO
//        | HISTORIA | ROTINA                                           (007)
//
//   (:Entidade { id, nome, nome_normalizado, criado_em, status,
//                contexto, pode_ajudar_com, fizemos_juntos,
//                embedding, embedding_modelo, embedding_fonte })
//
//   :Pessoa | :Projeto | :Objetivo | :Organizacao  — sempre com :Entidade (007)
