# Slice 12 — O chat que navega o grafo

> **Estado: em construção — passos 1 a 3 feitos.** As decisões estão tomadas
> (entrevista de 13/10), e o protótipo (ordem 0) rodou contra produção no mesmo
> dia: as receitas da §5 são as que rodaram. O passo 1 pôs a trava à prova
> contra a instância e mediu o piso com vetor de pergunta: não há número que
> separe o tema do resto (§5).

**Objetivo:** que o chat responda as perguntas **globais** — contar, ordenar,
comparar períodos, acompanhar uma mudança — escrevendo a própria Cypher, só de
leitura, com a busca por sentido disponível dentro dela, e com cada consulta à
vista no (i).

**Pronto quando:**

1. As nove perguntas (§1) respondidas com a informação certa, julgadas por mim,
   e a Cypher de cada passo visível no (i), com as linhas que o modelo leu.
2. Nenhuma escrita possível pela ferramenta: `CREATE`, `MERGE`, `SET`, `DELETE`,
   `REMOVE` e `CALL` de procedure de escrita recusados **antes de executar**; e
   `LOAD CSV`, `:Conversa` e `USE` recusados também (teste).
3. `embedding` nunca aparece na saída (teste), e o corte diz quanto cortou e
   manda agregar (teste).
4. As nove rodadas em `anthropic/claude-sonnet-5.5`, `deepseek/deepseek-v4.1-flash`
   e `zai/glm-5.3-flash`, com passos por pergunta, consultas com erro, tempo até a
   resposta e tokens registrados no "Como ficou" — e o vencedor é o
   `MODELO_CHAT_PADRAO`.
5. "Me teste no que aprendi na última semana", no app: uma pergunta por vez, e a
   correção contra o texto do átomo.
6. Uma pergunta local do tipo Isinha responde como antes.
7. O `chat-9` está no ar sem as ferramentas que o (i) mostrou sem uso nas nove —
   ou o "Como ficou" diz por que ficaram.

**Depende de** nada que não esteja no ar.

## Por que agora

O diário tem a informação. O chat não a acha. As perguntas que eu quero fazer:

| Pergunta | Família |
|---|---|
| quem são as pessoas mais próximas a mim? | ranking por peso afetivo |
| quais sonhos e objetivos eu mais falo? | ranking por recorrência |
| quais vêm sendo minhas prioridades nos últimos meses? | ranking com recorte de tempo |
| quais são os meus maiores medos? / maiores sonhos? | ranking por sentido |
| o que mais me desafiou nos últimos tempos? | ranking por sentido + tempo |
| como lido com stress? o que funciona pra mim? | padrão: situação → o que fiz |
| como minhas posições políticas mudaram? | evolução: ordem no tempo + `ATUALIZA`/`CONTRADIZ` |
| me teste no que aprendi na última semana | filtro de tipo e período + conversa |

Quase todas são **globais**. O `chat-7` (§4.16) foi desenhado para a pergunta
**local**:

- `buscar_atomos` devolve no máximo `TETO_ATOMOS = 8` trechos, por similaridade
  dentro de `K_BUSCA = 48` vizinhos, acima de `PISO_BUSCA = 0,45` — piso nunca
  medido para pergunta contra átomo (§14);
- nenhuma ferramenta **agrega** — contar por entidade, por mês, por tipo —, e
  nenhuma anda pelo grafo além de `historico_do_atomo`;
- "maiores medos" vira uma amostra de oito trechos que dizem a palavra "medo", e
  o modelo responde a partir dela;
- o modelo (`deepseek/deepseek-v4.1-flash`) foi escolhido para devolver JSON curto
  e nunca foi medido em ferramenta (§14).

A estrutura que essas perguntas pedem **já existe no grafo**: o `tipo` do átomo,
`:Pessoa`/`:Projeto`/`:Objetivo`/`:Organizacao`, `:SOBRE`/`:MENCIONA`, `:GEROU`, as
quatro relações do confronto e o índice vetorial. Falta o chat poder perguntar
qualquer coisa a ele.

## As decisões

Perguntadas em 13/10.

| Decisão | Escolhido | O que foi recusado, e por quê |
|---|---|---|
| **Como o chat alcança a pergunta global** | **uma ferramenta, `consultar_grafo`, em que o agente escreve a própria Cypher, só de leitura, com a busca por sentido dentro** — o que a Neo4j chama de Text2Cypher. As famílias viram **receitas** no prompt; receita só vira template (Cypher escrita por nós) quando o (i) mostrar o modelo errando nela de forma recorrente | Pôr o diário inteiro no contexto, como o retrato faz: não é agêntico, não usa o grafo, e tem teto de ~1 ano no ritmo atual. Facetas pré-computadas (tema, intensidade): o grafo já tem o que as nove pedem; voltam se o (i) mostrar que falta. Templates para tudo (o padrão da Neo4j): código novo por pergunta, num schema grande e com muitos usuários — aqui o schema é pequeno e um usuário só lê o rastro de cada resposta. O MCP oficial dentro do app: fala Bolt por stdio, e o app só fala a Query API (§8). O Aura Agent: modelo fora do Gateway (regra 8), fora do país, sem histórico, sem (i). Os modelos text2cypher ajustados da Neo4j: hospedagem fora do Gateway. Uma ferramenta por dimensão: já recusada no §4.16.2 |
| **A trava de leitura** | **`EXPLAIN` com `queryType = 'r'`, e `accessMode: Read` nas duas idas**, depois de bloqueios textuais (§3.2) | Transação explícita que sempre termina em rollback: desnecessária — a Query API devolve a classificação no `EXPLAIN` sem executar, verificado na instância. Só `accessMode`: a escrita seria recusada durante a execução, e não antes dela. Só lista negra de palavras: nunca está completa |
| **As ferramentas antigas** | **ficam no `chat-8` durante a medição, e a fatia fecha com um `chat-9`** que tira as que o (i) mostrar sem uso nas nove | Sair já, com o `chat-8` só com `consultar_grafo` e `ler_retrato`: a pergunta local (o caso Isinha) pioraria se o modelo escrevesse Cypher pior que as consultas afinadas de `buscar_atomos`, e ninguém mediria. Ficar e decidir numa fatia futura |
| **Os modelos** | **`anthropic/claude-sonnet-5.5`, `deepseek/deepseek-v4.1-flash` (a linha de base) e `zai/glm-5.3-flash`**, comparados por um script lado a lado (§7) | Trocar o modelo pelo painel e medir na tela: vinte e sete conversas gravadas e o tempo cronometrado à mão |
| **O tamanho e a forma da resposta global** | **sem teto, e forma livre** — lista, tabela, título, o que servir. A pergunta **local** fica como está. Os princípios de conteúdo valem nas duas (§4.4) | Quatro ou cinco frases em prosa, sempre: um ranking ou uma evolução de meses espremidos em três nomes. Lista curta de até cinco: o corte num número fixo, e não no que a pergunta pede. Só o tamanho livre, em prosa |
| **"Pessoas mais próximas"** | **peso afetivo**: os trechos `SENTIMENTO` e `HISTORIA` que citam a pessoa | Presença (quantos trechos, quando foi a última). As duas, ditas separadas. Uma ordem só combinando as duas, com o critério dentro do modelo |
| **O teste** | **uma pergunta aberta por vez, e só quando eu peço**; ele corrige contra o texto do átomo e faz a próxima. Sem guardar resultado. A visão (§10, "não pergunta nada de volta") ganha a exceção escrita | Todas as perguntas de uma vez, corrigidas juntas. Deixar o teste para a "fatia C" da visão |
| **O (i) do passo novo** | **a Cypher e as linhas que o modelo leu, recolhidas por padrão** | Só a Cypher e a contagem: auditar o resultado pediria rodar a consulta de novo. Tudo aberto: três consultas de cinquenta linhas viram uma rolagem longa |
| **O teto de saída** | **`MAX_TOKENS_SAIDA` de 4.000 para 100.000**, como na resolução — o limite que sobra é o relógio da rota | Ficar em 4.000/8.000: dois dos três candidatos raciocinam, e o pensamento come o teto antes da resposta global, que agora não tem teto |
| **O protótipo** | **o MCP oficial da Neo4j, só leitura, contra produção, antes de esta spec fechar** (ordem 0) | Rodar as nove pela Query API à mão — testaria também a busca por sentido, que o MCP não faz. Deixar a validação para o primeiro passo da construção |
| **O dia que o chat diz** | **o de Brasília, no chat inteiro**: `$hoje`, o "Hoje é" do `montarSistema`, as datas e os filtros de período das ferramentas antigas, as datas do (i) e as da lista de conversas. O schema do prompt ensina a expressão do dia do átomo (§4, item 3) | Ficar em UTC: `valido_em` é ISO em UTC, e 60 dos 226 átomos (10 sessões gravadas depois das 21h) saem com o dia seguinte — e o teste diz a data dentro da frase. Consertar o sistema inteiro nesta fatia (retrato, confronto, enriquecimento, correções): é fora do chat, e vai para o §14 |

## 1. As nove perguntas

São o instrumento da fatia — da medição, da escolha do modelo e da decisão sobre
as ferramentas antigas:

1. quem são as pessoas mais próximas a mim?
2. quais sonhos e objetivos eu mais falo?
3. quais vêm sendo minhas prioridades nos últimos meses?
4. quais são os meus maiores medos?
5. quais são os meus maiores sonhos?
6. o que mais me desafiou nos últimos tempos?
7. como lido com stress? o que funciona pra mim?
8. como minhas posições políticas mudaram?
9. me teste no que aprendi na última semana

**Não são gabarito** (`CLAUDE.md`): não há resposta esperada escrita em lugar
nenhum. Se a informação está certa, quem diz sou eu, lendo o (i).

**O que o diário tem hoje**, contado em 13/10 — é o pano de fundo de qualquer
julgamento: 226 átomos ativos (8 em agosto, 179 em setembro, 39 em outubro); 51
pessoas, 13 organizações, 3 projetos, 2 objetivos; o "eu" é sujeito de 181; 16
`OPINIAO`; 80 relações de confronto, só 2 `ATUALIZA` e 14 `CONTRADIZ`. "Últimos
meses" é um mês e meio.

O protótipo acrescentou duas coisas. **Nenhuma das 16 `OPINIAO` é política**, e
a busca por palavra também não acha posição política nos outros tipos: o que
chega mais perto são dois trechos de uma aula de economia brasileira. Hoje a
resposta certa para a 8 é "não há posição registrada", dita assim, junto com o
que há de mais perto. **Projetos e objetivos são 5 entidades com 16 trechos**,
uma delas `aniversário`: a 2 e a 3 não se respondem por entidade (§5).

## 2. A ferramenta `consultar_grafo`

```
consultar_grafo({ cypher: string, texto?: string })
```

O que ela faz, em ordem:

1. **Bloqueios textuais** (§3.2), antes de qualquer ida ao banco.
2. **Os parâmetros que o servidor injeta.** `$hoje` sempre (`AAAA-MM-DD`, o dia
   de Brasília, para o modelo não calcular data à mão). Com `texto`, `$vetor`: o embedding do texto
   pela porta de sempre (`embedding.ts`), memoizado por `leituraDaPergunta()` —
   a mesma memória do turno que `buscar_atomos` já usa.
3. **`EXPLAIN <cypher>`** com `accessMode: Read` e os mesmos parâmetros. Erro de
   sintaxe volta aqui, sem executar nada. Só segue com `queryType = 'r'`.
4. **A execução**, de novo com `accessMode: Read` e `maxExecutionTime` de 10 s.
5. **A saída limpa e com teto** (§3.3).
6. **Erro volta como texto, nunca como exceção** — sintaxe, consulta que não é
   leitura, bloqueio, timeout, `$vetor` sem `texto`. A mesma regra das ferramentas
   de hoje (§4.16.2): o modelo lê e reescreve.
7. **O rastro** (§6).

**O padrão que o prompt ensina: panorama → leitura.** Primeiro uma consulta
larga e barata — ids, datas, tipos, contagens, `left(a.texto, 120)`; depois o
texto inteiro só dos átomos escolhidos.

**Por que o banco agrega e a ferramenta corta.** Com 300 ou 30 mil átomos, a
saída tem o mesmo teto, e o agente aprende a contar no banco em vez de despejar.
Estrutura nova — uma data do fato, um `:Tema` — entra como uma linha no schema do
prompt, e não como ferramenta nova.

`vistos` (a memória do turno, §4.16.2) **não se aplica** à saída tabular: as
colunas são do modelo, e uma linha não é um átomo. `TETO_FERRAMENTAS` fica em 8 —
o padrão panorama → leitura gasta duas.

## 3. A porta e a trava

### 3.1 `neo4j.ts` ganha a resposta crua

`query()` devolve só as linhas, e a ferramenta precisa do resto. Uma função nova
no mesmo módulo devolve `fields`, `values`, `queryType` e `notifications`, joga
`Neo4jError` com o código, e aceita `accessMode` e `maxExecutionTime`. `query()`
passa a delegar a ela sem mudar contrato — continua `Write` por padrão, que é o
que as escritas de hoje precisam.

O que foi conferido na instância, e decide o desenho:

| | |
|---|---|
| `EXPLAIN` | devolve `queryType` (`r`, `rw`, `w`, `s`) sem executar: `EXPLAIN CREATE …` é `rw`, `EXPLAIN … DETACH DELETE` é `w`, leitura é `r` |
| erro de sintaxe | `Neo.ClientError.Statement.SyntaxError`, com linha e coluna |
| `accessMode: "Read"` e `maxExecutionTime` | aceitos |
| nó no JSON | `{ elementId, labels, properties }` |
| relação no JSON | `{ elementId, startNodeElementId, endNodeElementId, type, properties }` |
| Cypher | 25 por padrão (runtime 2026.09), embora o kernel ainda se chame "5.27-aura" |
| `SEARCH` | funciona, e devolve **o mesmo score** do `queryNodes` — `2 * score - 1` continua sendo o cosseno |
| `queryNodes` | funciona, com aviso de depreciação em favor do `SEARCH` |
| `SEARCH … FOR v` | aceita variável, e não só parâmetro: o `embedding` de um átomo serve de vetor, sem chamar o modelo de embedding |
| `valido_em` | ISO em UTC (`…T22:44:04.000Z`); `datetime({datetime: datetime(a.valido_em), timezone: 'America/Sao_Paulo'})` converte |
| `LOAD CSV FROM 'https://…'` | classificado `r` — por isso o bloqueio textual |
| `TERMINATE TRANSACTIONS` | classificado `r` também — e encerra a transação de outro, a do pipeline inclusive. Bloqueio textual (passo 1) |
| `CALL db.labels()` / `CALL db.createLabel(…)` | `r` / `w`: a classificação acerta, e o bloqueio de `CALL` fica pela procedure que ela errasse |
| a escrita em `accessMode: "Read"` | recusada antes de tocar em linha, mesmo sem nenhuma linha casando: `Neo.ClientError.Statement.AccessMode` (passo 1) |
| o estouro do `maxExecutionTime` | chega como `Neo.ClientError.Transaction.Terminated` ("terminated by the user"), e não como "timed out" (passo 1) |

### 3.2 A trava, em camadas

1. **Bloqueios textuais**, sobre a Cypher sem comentários e sem literais de
   string (para "use" dentro de um texto não disparar nada):
   - `LOAD CSV` — é leitura para o banco, e é uma porta para fora;
   - `CALL` de procedure — `CALL {` e `CALL (`, de subquery, passam. A busca por
     sentido é a cláusula `SEARCH`, e nenhuma receita precisa de procedure;
   - o label `:Conversa` — uma conversa nunca enxerga outra (§8.6). Procurado
     também dentro dos literais, com a maiúscula: o label se alcança por texto
     (`'Conversa' IN labels(n)`, `n:$('Conversa')`), e `'conversa'` em
     minúscula, que é como se busca no texto do átomo, passa. O nó de conversa
     que chegar sem o label escrito (`MATCH (n)`) vira uma marca na limpeza;
   - `USE` — outro banco;
   - `TERMINATE` — o banco o classifica como leitura;
   - `EXPLAIN` e `PROFILE` no começo — quem os põe é a ferramenta.
2. **`EXPLAIN` com `accessMode: Read`**, exigindo `queryType = 'r'`. `s` também é
   recusado.
3. **A execução em `accessMode: Read`**: é o que segura uma procedure
   classificada como leitura por engano — o aviso que o próprio MCP oficial dá
   sobre a classificação.

A regra 5 e o §4.16.3 ficam intactos: o chat continua não escrevendo nada, e
agora isso está em três lugares em vez de um.

### 3.3 A saída

- **Nó e relação viram só propriedades** — `elementId` sai; o nó leva os labels,
  a relação leva o tipo.
- **`embedding` nunca volta**, nem qualquer lista de número longa (mais de 16
  itens), em qualquer profundidade.
- **Teto de ~150 linhas e ~12 mil caracteres**, o que vier primeiro. Quando
  corta, a primeira linha diz: `cortado em N de M linhas — agregue, filtre ou
  projete menos.`
- **Zero linhas é dito, e com as causas.** Consulta válida que volta vazia é o
  erro que mais parece resposta (`CLAUDE.md`): filtro estreito demais, nome de
  label ou propriedade errado, `status` que não existe. A linha diz isso.
- **Os avisos do banco vão junto.** Label, tipo de relação ou propriedade que
  não existe no grafo vêm como `notification` da Neo4j; eles entram no texto,
  antes das linhas. É o que separa "não há nada" de "você perguntou por um nome
  que não existe".
- **O formato é tabela em texto**: o cabeçalho das colunas e uma linha por
  registro. Texto e não JSON pela razão de sempre (§4.16.2): o modelo lê para
  escrever prosa.

## 4. O prompt — `chat-8`

O texto final se escreve na construção, sobre o que o protótipo mostrar. As
seções:

1. **As cinco ferramentas**, com `consultar_grafo` descrita como a que conta,
   ordena, compara períodos e anda pelo grafo.
2. **O schema de leitura**, ~40 linhas, condensado do §8 — só o que serve para
   ler: `:Atomo`, `:Entidade` e os quatro labels, `:Sessao`, as arestas, os
   valores de cada campo (os oito `tipo`, `status`, `camada`). Sem os campos de
   fila e de controle (`confronto_*`, `enriquecimento_*`, `*_anterior`). **Sem
   nenhum dos rótulos que nunca existiram** (`CLAUDE.md`).
3. **As armadilhas deste grafo**, que nenhum `get-schema` conhece:
   - átomo ativo é `a.status = 'ativo'`;
   - entidade viva é `coalesce(e.status, 'ativa') <> 'fundida'` — e
     `e.status = 'ativa'` **não** é consulta válida aqui (§8.2): devolve 0 das
     73;
   - átomo nunca aponta para nó fundido: a fusão migra as arestas (§8.2), e o
     protótipo conferiu — 4 fundidos, nenhuma aresta. Ranking que parte do átomo
     não atravessa nada. O fundido existe como **grafia**: achar entidade por
     nome atravessa `:FUNDIDA_EM`, um salto, até o vencedor ("Nicole Salgado"
     acha "Nicolle Salgado");
   - o "eu" é `nome_normalizado: 'eu'`, e é sujeito de quase tudo — sai de
     ranking de pessoas;
   - `SENTIMENTO`, `APRENDIZADO`, `HISTORIA` e `ROTINA` são sempre `:SOBRE` o
     "eu": a outra pessoa aparece por `:MENCIONA` (`TIPOS_SEMPRE_EU`);
   - nome de entidade se casa por `nome`, `nome_normalizado` (minúsculas, sem
     acento) **e** `aliases` — a grafia que eu falo pode morar só no alias
     (§8.2);
   - `valido_em` é o começo da **sessão**, não a data do fato, e está em UTC. O
     dia é `date(datetime({datetime: datetime(a.valido_em), timezone:
     'America/Sao_Paulo'}))`: é ele que se compara com `date($hoje)` e é ele que
     se devolve. `left(a.valido_em, 10)` erra o dia de quem gravou depois das
     21h;
   - `2 * score - 1` converte o score do `SEARCH` em cosseno, e o cosseno **só
     ordena**: não há piso (§5). Frase curta contra átomo dá número baixo — 0,3
     a 0,6 no melhor caso — e isso é normal; o tema acaba onde os trechos
     deixam de falar dele, e quem vê isso é o modelo, lendo. A coluna `sim` vai
     sempre na saída;
   - relação de confronto vai sempre do mais novo para o mais antigo; `camada`
     ausente é forte; a sutil é "parece ligado a", nunca afirmação (§4.15);
   - nunca devolver o nó inteiro.
4. **Pitfalls de Cypher**, da `neo4j-cypher-skill` (`neo4j-contrib/neo4j-skills`):
   padrões com direção, `LIMIT` em leitura exploratória, `sum(CASE …)` no lugar
   de `count(x WHERE …)`, `IS NULL`, a sintaxe do `SEARCH`.
5. **As receitas** (§5), uma por família.
6. **Quando usar o quê.** "Quem eu sou / como estou numa área" começa por
   `ler_retrato`. Ranking, evolução, padrão, contagem e recorte de tempo vão por
   `consultar_grafo`. A pergunta local — um evento, uma pessoa, "depois de quê" —
   pode seguir pelas ferramentas de hoje enquanto elas existirem.
7. **`COMO BUSCAR`**, ajustado: o panorama → leitura; o número dito na resposta
   vem da consulta, nunca de estimativa; o recorte usado é dito.
8. **`COMO RESPONDER`, em duas partes.** A **local** é a de hoje: as duas
   primeiras frases respondem, quatro ou cinco frases, prosa, um ou dois
   trechos. A **global** — a que conta, ordena, compara períodos ou acompanha uma
   mudança — não tem teto nem forma fixa: lista, tabela, título, o que servir. Nas
   duas valem os princípios de conteúdo: bibliotecário e não coach, nada que não
   veio de uma consulta, as duas pontas de uma contradição, a relação sutil como
   "parece ligado a".
9. **O teste.** Só quando eu peço. Uma pergunta aberta sobre um átomo; espera a
   minha resposta; corrige contra o texto do átomo — relido por consulta, porque o
   rastro do turno anterior não volta ao modelo (§4.16.4) —, com a data dentro da
   frase; e faz a próxima. Termina quando eu paro ou quando acabam os átomos do
   recorte.

**A data de hoje continua fora do texto editável** (`montarSistema`, §4.16.1), e
agora vai também como `$hoje`.

## 5. As receitas — as que rodaram no protótipo

Rodadas contra produção pelo MCP oficial, só leitura, em 13/10. `$hoje` e
`$vetor` vêm do servidor. `dia` é sempre o de Brasília (§4, item 3), calculado
uma vez num `WITH`. A busca por sentido rodou com o vetor de um átomo no lugar
de `$vetor`: a sintaxe e a forma das linhas ficaram conferidas ali, e o piso, com
vetor de pergunta, no passo 1.

**O que o protótipo mudou no rascunho:**

- **O salto de `:FUNDIDA_EM` saiu das receitas que partem do átomo.** Nenhuma
  aresta aponta para nó fundido, e o salto só ensinaria o modelo a escrever o
  que não faz nada. Ele fica onde serve: achar entidade por nome.
- **As prioridades e os sonhos não moram nas entidades.** `:Projeto` e
  `:Objetivo` são 5 nós com 16 trechos. O que pesou nos últimos meses está em
  `DECISAO` e `CONQUISTA`, a maioria sobre o "eu" (28 no diário). A receita
  por entidade virou complemento.
- **A evolução não filtra por tipo.** Das 16 `ATUALIZA`/`CONTRADIZ`, uma só tem
  `OPINIAO` numa das pontas: mudança de posição aparece em `APRENDIZADO`,
  `CONQUISTA` e `ROTINA`.
- **O stress agrupa por sessão.** Com uma linha por situação, a mesma sessão se
  repetia, e o que veio nela parecia resposta à situação. Uma linha por sessão
  diz o que a receita sabe — "na mesma gravação" — e não o que ela não sabe: se
  uma coisa levou à outra. O que funciona tem uma busca própria.
- **O vetor pode ser o de um átomo.** `SEARCH … FOR v` aceita variável: "mais
  trechos como este" é uma consulta, sem `texto` e sem chamada de embedding.

**O piso: não há.** Átomo contra átomo, os vizinhos do protótipo ficaram entre
0,49 e 0,69. O passo 1 mediu pergunta contra átomo, com o `$vetor` de verdade de
doze buscas — as palavras das receitas abaixo, "meus maiores medos", e cinco
temas para conferir, um deles ausente do diário —, sobre os 226 átomos:

| busca | melhor | mediana | ≥ 0,45 | ≥ 0,35 |
|---|---|---|---|---|
| medo, receio, insegurança… | 0,51 | 0,28 | 5 | 31 |
| sonho, desejo, o que eu quero um dia | 0,46 | 0,32 | 1 | 71 |
| desafio, dificuldade, o que foi difícil | 0,45 | 0,27 | 1 | 18 |
| stress, ansiedade, pressão | 0,50 | 0,26 | 3 | 20 |
| o que me ajuda quando estou ansioso… | 0,59 | 0,32 | 12 | 80 |
| política, governo, eleição, ideologia | 0,35 | 0,20 | 0 | 0 |
| meus maiores medos | 0,54 | 0,29 | 5 | 45 |
| futebol, time, campeonato | 0,34 | 0,21 | 0 | 0 |
| religião, Deus, fé | 0,32 | 0,21 | 0 | 0 |
| dinheiro, finanças, investimento | 0,43 | 0,24 | 0 | 10 |
| minha família, meus pais | 0,53 | 0,28 | 3 | 19 |
| Isinha | 0,60 | 0,24 | 5 | 13 |

**Nenhum número separa o tema do resto**, e o que decide é a sobreposição:

- **O relevante desce abaixo do irrelevante de outra busca.** "O jogo do Galo
  foi fantástico" é futebol, e fica em 0,33; em "sonho", um trecho sobre o surf
  já marcado com a Nicole, que é plano e não sonho, fica em 0,375.
- **A escala anda com a busca.** A mediana vai de 0,20 (política) a 0,32
  (sonho): "o que eu quero um dia" parece com quase tudo que se diz na primeira
  pessoa. O mesmo 0,35 dá 0 trechos numa e 71 na outra.
- **Nem o melhor serve de sinal de tema ausente.** Religião, que o diário não
  tem, tem o melhor em 0,32; futebol, que tem, em 0,34.

Então **o prompt não ganha número**: as receitas ordenam por `sim`, trazem o
trecho curto, e o modelo lê em ordem até os trechos deixarem de falar do tema.
Se ele lê bem, o (i) das nove é que mostra: a coluna vai na saída. Para
a 8, a resposta continua sendo dita pelo texto: os dois trechos da aula de
economia, no topo, falam de Jango, e não de posição minha.

**O `PISO_BUSCA = 0,45` de `buscar_atomos` está medido também, e alto demais
para frase curta**: deixaria 5 trechos de medo, 1 de sonho, 1 de desafio e
nenhum de política ou de futebol — o Galo some. Ele foi feito para a pergunta
local, com nome e evento; se fica, e com que número, é o `chat-9` que decide,
com o (i) das nove na mão.

**Pessoas mais próximas** — peso afetivo:

```
MATCH (a:Atomo {status: 'ativo'})-[:SOBRE|MENCIONA]->(p:Pessoa)
WHERE a.tipo IN ['SENTIMENTO', 'HISTORIA'] AND p.nome_normalizado <> 'eu'
WITH p, a, date(datetime({datetime: datetime(a.valido_em),
                          timezone: 'America/Sao_Paulo'})) AS dia
RETURN p.nome AS pessoa, count(DISTINCT a) AS afetivos,
       sum(CASE WHEN a.tipo = 'HISTORIA' THEN 1 ELSE 0 END) AS historias,
       toString(max(dia)) AS ultima_vez
ORDER BY afetivos DESC LIMIT 15
```

"minha mãe" e "meu pai" são `:Pessoa` como as outras, e entram.

**Prioridades dos últimos meses** — o que eu decidi e o que conquistei, no
recorte; o modelo agrupa os temas a partir dos trechos:

```
MATCH (a:Atomo {status: 'ativo'})
WHERE a.tipo IN ['DECISAO', 'CONQUISTA']
WITH a, date(datetime({datetime: datetime(a.valido_em),
                       timezone: 'America/Sao_Paulo'})) AS dia
WHERE dia >= date($hoje) - duration({months: 3})
OPTIONAL MATCH (a)-[:SOBRE|MENCIONA]->(e:Entidade)
WHERE e.nome_normalizado <> 'eu'
WITH dia, a, collect(e.nome) AS cita
RETURN toString(dia) AS dia, a.tipo AS tipo, a.id AS id, cita,
       left(a.texto, 120) AS trecho
ORDER BY dia DESC LIMIT 80
```

O complemento, quando a pergunta é sobre projeto ou objetivo — por mês:

```
MATCH (a:Atomo {status: 'ativo'})-[:SOBRE|MENCIONA]->(e)
WHERE e:Projeto OR e:Objetivo
WITH e, a, date(datetime({datetime: datetime(a.valido_em),
                          timezone: 'America/Sao_Paulo'})) AS dia
WHERE dia >= date($hoje) - duration({months: 3})
WITH e, left(toString(dia), 7) AS mes, count(DISTINCT a) AS n
RETURN e.nome AS nome, labels(e) AS tipo, sum(n) AS total,
       collect(mes + ': ' + toString(n)) AS por_mes
ORDER BY total DESC LIMIT 15
```

**Sonhos que mais falo, maiores medos, maiores sonhos, o que me desafiou** — o
panorama por sentido (`texto` = "medo, receio, insegurança, preocupação com o
futuro"; "sonho, desejo, o que eu quero um dia"; o desafio ganha o recorte de
tempo). "Mais falo" é recorrência: a coluna `dia` deixa contar em quantas
sessões o tema volta.

```
MATCH (a:Atomo)
  SEARCH a IN (VECTOR INDEX atomo_embedding FOR $vetor LIMIT 200) SCORE AS score
WITH a, 2 * score - 1 AS sim
WHERE a.status = 'ativo'
WITH a, sim, date(datetime({datetime: datetime(a.valido_em),
                            timezone: 'America/Sao_Paulo'})) AS dia
RETURN a.id AS id, toString(dia) AS dia, a.tipo AS tipo,
       round(sim, 2) AS sim, left(a.texto, 120) AS trecho
ORDER BY sim DESC LIMIT 80
```

Depois, a leitura do texto inteiro só dos escolhidos:
`MATCH (a:Atomo) WHERE a.id IN [...] RETURN a.id AS id, a.tipo AS tipo, a.texto AS texto`.

**Mais trechos como este** — a semente é um átomo que o panorama já achou:

```
MATCH (q:Atomo {id: '<id>'})
WITH q.embedding AS v
MATCH (a:Atomo)
  SEARCH a IN (VECTOR INDEX atomo_embedding FOR v LIMIT 50) SCORE AS score
WITH a, 2 * score - 1 AS sim
WHERE a.status = 'ativo'
RETURN a.id AS id, a.tipo AS tipo, round(sim, 2) AS sim,
       left(a.texto, 120) AS trecho
ORDER BY sim DESC LIMIT 25
```

**Stress — as situações, uma linha por sessão** (`texto` = "stress, ansiedade,
pressão"):

```
MATCH (a:Atomo)
  SEARCH a IN (VECTOR INDEX atomo_embedding FOR $vetor LIMIT 150) SCORE AS score
WITH a, 2 * score - 1 AS sim
WHERE a.status = 'ativo' AND a.tipo IN ['SENTIMENTO', 'HISTORIA']
MATCH (s:Sessao)-[:GEROU]->(a)
WITH s, collect(left(a.texto, 100)) AS situacoes, max(sim) AS sim
OPTIONAL MATCH (s)-[:GEROU]->(d:Atomo)
WHERE d.status = 'ativo' AND d.tipo IN ['DECISAO', 'ROTINA', 'APRENDIZADO', 'CONQUISTA']
WITH s, situacoes, sim, collect(d.tipo + ': ' + left(d.texto, 100))[0..4] AS na_mesma_sessao
RETURN toString(date(datetime({datetime: datetime(s.iniciada_em),
                               timezone: 'America/Sao_Paulo'}))) AS dia,
       round(sim, 2) AS sim, situacoes, na_mesma_sessao
ORDER BY sim DESC LIMIT 20
```

E o que funciona, pela busca própria: o panorama por sentido acima, com
`texto` = "o que me ajuda quando estou ansioso, o que funciona pra mim" e
`a.tipo IN ['APRENDIZADO', 'ROTINA', 'DECISAO', 'CONQUISTA']`. A resposta diz
"na mesma gravação" para a primeira e "o que eu disse que funciona" para a
segunda — nunca que uma coisa causou a outra.

**Como algo mudou num tema** (`texto` = "política, governo, eleição, ideologia"
para a 8) — os mais parecidos, com o que o confronto ligou a eles, em ordem de
data:

```
MATCH (a:Atomo)
  SEARCH a IN (VECTOR INDEX atomo_embedding FOR $vetor LIMIT 200) SCORE AS score
WITH a, 2 * score - 1 AS sim
WHERE a.status = 'ativo'
WITH a, sim ORDER BY sim DESC LIMIT 40
OPTIONAL MATCH (a)-[r:ATUALIZA|CONTRADIZ]->(antigo:Atomo {status: 'ativo'})
WITH a, sim, collect(type(r) + ' ' + antigo.id) AS muda
OPTIONAL MATCH (novo:Atomo {status: 'ativo'})-[r2:ATUALIZA|CONTRADIZ]->(a)
WITH a, sim, muda, collect(type(r2) + ' por ' + novo.id) AS mudada_por
RETURN a.id AS id,
       toString(date(datetime({datetime: datetime(a.valido_em),
                               timezone: 'America/Sao_Paulo'}))) AS dia,
       a.tipo AS tipo, round(sim, 2) AS sim, left(a.texto, 120) AS trecho,
       muda, mudada_por
ORDER BY dia
```

**O que mudou, sem tema** — todas as `ATUALIZA`/`CONTRADIZ` (16 hoje):

```
MATCH (n:Atomo {status: 'ativo'})-[r:ATUALIZA|CONTRADIZ]->(v:Atomo {status: 'ativo'})
RETURN type(r) AS rel, coalesce(r.camada, 'forte') AS camada,
       toString(date(datetime({datetime: datetime(v.valido_em),
                               timezone: 'America/Sao_Paulo'}))) AS de,
       v.tipo AS tipo_antes, left(v.texto, 100) AS antes,
       toString(date(datetime({datetime: datetime(n.valido_em),
                               timezone: 'America/Sao_Paulo'}))) AS para,
       n.tipo AS tipo_depois, left(n.texto, 100) AS depois
ORDER BY para
```

**Achar uma entidade pelo nome** — a grafia pode ser de um nó fundido, ou morar
só num alias:

```
MATCH (x:Entidade)
WHERE toLower(x.nome) CONTAINS '<grafia>' OR x.nome_normalizado CONTAINS '<grafia>'
   OR any(al IN coalesce(x.aliases, []) WHERE toLower(al) CONTAINS '<grafia>')
OPTIONAL MATCH (x)-[:FUNDIDA_EM]->(v:Entidade)
WITH DISTINCT coalesce(v, x) AS e
OPTIONAL MATCH (a:Atomo {status: 'ativo'})-[:SOBRE|MENCIONA]->(e)
RETURN e.id AS id, e.nome AS nome, labels(e) AS tipo, count(a) AS trechos
```

`<grafia>` em minúsculas e sem acento.

**Me teste na última semana:**

```
MATCH (a:Atomo {status: 'ativo', tipo: 'APRENDIZADO'})
WITH a, date(datetime({datetime: datetime(a.valido_em),
                       timezone: 'America/Sao_Paulo'})) AS dia
WHERE dia >= date($hoje) - duration({days: 7})
RETURN a.id AS id, toString(dia) AS dia, a.texto AS texto
ORDER BY dia
```

O quiz acontece na conversa (§4, item 9).

## 6. O rastro e o (i)

`FERRAMENTAS_CHAT` ganha `consultar_grafo`, e `PassoDeFerramenta` ganha um campo
**opcional** — mensagem antiga continua legível sem retrofill, como na slice 9:

```
consulta?: {
  cypher: string;        // a executada, sem o EXPLAIN
  texto?: string;        // o que virou $vetor
  colunas: string[];
  linhas: unknown[][];   // as que foram ao modelo, já limpas e cortadas
  total: number;         // quantas o banco devolveu
  cortado: boolean;
  avisos?: string[];     // o que o banco avisou — o (i) precisa dizer por que veio vazio
}
```

`erro` e `duracao_ms` são os de sempre. `achados` fica vazio, como em
`buscar_entidades`, e `parametros` leva só o `texto`: a Cypher mora em
`consulta`, que nasce também na recusa e na falha — a consulta escrita é o que
explica o erro.

**No progresso**, no passado como os outros: `consultou o grafo — 15 linhas`,
`consultou o grafo — cortado em 150 de 412`, ou o erro.

**No (i):** o cabeçalho (linhas, corte, tempo); `sentido: "…"` quando houve
`texto`; a Cypher num bloco de código; e as linhas numa tabela **recolhida** —
"ver as 15 linhas", um toque abre. A tabela rola por dentro da própria caixa: a
página não ganha rolagem horizontal no celular.

**Tudo isso mora dentro de "como procurei ▸".** Desde a onda 3 da interface
(`Specs/interface-onda-3.md` §4) o (i) abre pelos trechos — os átomos que as
chamadas trouxeram, com ▶ —, e o técnico fica dobrado embaixo. O passo de
`consultar_grafo` não traz átomo (`achados` vazio), então não acrescenta trecho;
resposta que só consultou o grafo abre o (i) direto no técnico, com a Cypher à
vista.

**Quando o `chat-9` tirar uma ferramenta, o tipo do rastro não a perde.** A lista
do que o modelo pode chamar e a lista do que um passo gravado pode ser são duas
coisas: mensagem antiga com `buscar_atomos` continua desenhando o (i) dela.

## 7. A comparação dos modelos

`scripts/comparar-chat.ts`, no molde do `comparar-confronto.ts` (§4.15) — o mesmo
gancho para importar de `src/`, a mesma saída em HTML lado a lado:

- `COMPARAR_MODELOS=a,b,c` e as perguntas por argumento, de um arquivo de texto
  meu, uma por linha. **Não vira fixture no repositório** (`CLAUDE.md`);
- chama `responder()` com o modelo dado, sem ler o painel — `OpcoesResposta`
  ganha `modelo?`, e `Resposta` ganha o uso (tokens de entrada, saída e
  raciocínio) que o `generateText` já devolve;
- por pergunta e por modelo: a resposta, o rastro (a Cypher, as linhas, os
  erros), o número de chamadas, quantas consultas deram erro, o tempo até a
  resposta e os tokens;
- **não grava conversa** — nem `:Conversa`, nem R2. Só lê o grafo, e o custo é o
  das chamadas de modelo.

A pergunta 9 é de vários turnos: o script mede só o primeiro, e a correção se
confere no app.

**O vencedor vira `MODELO_CHAT_PADRAO`**, constante própria em `modelos.ts` — o
mesmo padrão do confronto na 5.2 —, e a linha do `CHAT_MODEL` no `CLAUDE.md`
acompanha se o padrão mudar.

## 8. O fechamento — `chat-9`

Com as nove rodadas no modelo escolhido, o (i) diz quais das três ferramentas
antigas foram chamadas. As sem uso saem: da lista de ferramentas, do prompt, do
envelope em `agentes.ts`. O "Como ficou" registra o que saiu e o que ficou, e por
quê. `ler_retrato` fica — ele lê o R2, não o grafo.

## 9. As bordas

- **O override vence o código** (§14). Hoje não há prompt do chat editado em
  `/agentes` — só o da `extracao` —, então o `chat-8` entra direto. O envelope
  ganha `consultar_grafo`: um prompt editado no futuro que não a cite não salva.
- **A pergunta seguinte não vê a Cypher da anterior.** O rastro não volta ao
  modelo (§4.16.4); "e no mês passado?" é uma consulta nova, escrita de novo.
- **`:Sessao` é legível**, e é de propósito: a receita do stress anda por
  `:GEROU`. `:Conversa`, não.
- **Nenhuma migration, nenhuma rota nova.** O §8 e o §10 não mudam de contrato.

## 10. Verificação

- `pnpm test`, com `tests/consulta.test.ts` novo, sem rede (o `fetch` mockado
  devolve o `queryType` que o teste quer):
  - `CREATE`, `MERGE`, `SET`, `DELETE`, `REMOVE` e `CALL` de procedure de escrita
    recusados **antes** da execução — a execução nunca é chamada;
  - `LOAD CSV`, `:Conversa` (escrito, entre crases ou num literal), `USE`,
    `TERMINATE`, `EXPLAIN`/`PROFILE` recusados sem ir ao banco; "use" dentro de
    um literal de string não dispara nada; `CALL {` e `CALL (x) {` passam;
  - `queryType` `rw`, `w` ou `s` recusado;
  - `embedding` e lista longa de número nunca na saída, nem aninhados;
  - o corte, por linhas e por caracteres, com a mensagem que manda agregar;
  - zero linhas com as causas; os avisos do banco no texto;
  - sintaxe, timeout e `$vetor` sem `texto` voltando como texto.
- `tests/chat.test.ts`: a ferramenta no conjunto, o rastro com `consulta`, o
  `$hoje` injetado, a mensagem antiga sem `consulta` desenhando o (i).
- `tests/dia.test.ts`: `…T01:30:00.000Z` é o dia anterior em Brasília, e
  `…T03:00:00.000Z` já é o mesmo; a data sem hora não se converte. O `$hoje` e o
  "Hoje é" às 22h de Brasília ficam em `tests/chat.test.ts`, onde as ferramentas
  e o sistema se montam.
- `tests/agentes.test.ts`, `tests/gateway.test.ts` e `tests/arquitetura.test.ts`
  passam: o envelope com `consultar_grafo`, o script sem pacote de provedor, o
  módulo novo com texto no §2.
- O script nas nove × três modelos (§7), e a leitura do HTML comigo.
- No app: a pergunta 9 em vários turnos, e uma pergunta local do tipo Isinha.
- **Se a resposta presta, quem julga sou eu**, pelo (i) — sem gabarito, sem
  fixture. Quando estiver ruim, o que se ajusta é o prompt, e uma receita que
  errar de forma recorrente vira template.

## Fora de escopo

- **A data do fato.** `valido_em` é a data da sessão (`atomos.ts`): uma história
  de 2019 contada hoje nasce com a data de hoje. "Como mudou ao longo dos anos"
  só responde bem depois disso — fatia própria, no extrator.
- Guardar o resultado do teste, `:Foco`, deduplicação de átomo.
- Migrar o `queryNodes` fora do chat (`entidades.ts`, `confronto.ts`): fica no
  §14, corrigido para o que a instância é de fato.
- Templates: só depois de evidência no (i).

## O que muda de arquivo

| arquivo | o quê |
|---|---|
| `src/lib/neo4j.ts` | a resposta crua, com `accessMode` e `maxExecutionTime`; `query()` delega |
| `src/lib/consulta.ts` | **novo** — os bloqueios, o `EXPLAIN`, a limpeza, o corte e o texto que volta ao modelo |
| `src/lib/dia.ts` | **novo** (client) — o dia de Brasília de um ISO, e o de hoje: um lugar só para o servidor e para o (i) |
| `src/lib/chat.ts` | `consultar_grafo`; o `chat-8` e depois o `chat-9`; `MAX_TOKENS_SAIDA`; `modelo?` em `OpcoesResposta`; o uso em `Resposta`; o "Hoje é", as datas e os filtros de período das ferramentas antigas no dia de Brasília |
| `src/lib/tipos.ts` | `consultar_grafo` em `FERRAMENTAS_CHAT`; `PassoDeFerramenta.consulta?`; a lista do que o rastro pode conter separada da do que o modelo pode chamar |
| `src/lib/agentes.ts` | o envelope, o `papel` e a `nota` do chat |
| `src/lib/modelos.ts` | `MODELO_CHAT_PADRAO`, depois da comparação |
| `src/components/Chat.tsx` | a frase do passo e o bloco do (i); as datas do (i) e da lista de conversas no dia de Brasília |
| `src/app/globals.css` | a tabela recolhida do (i) |
| `scripts/comparar-chat.ts` | **novo** |
| `tests/consulta.test.ts`, `tests/dia.test.ts` | **novos** |
| `tests/chat.test.ts`, `tests/agentes.test.ts` | a ferramenta, o rastro, o envelope |
| `ARCHITECTURE.md` | a linha 12 do estado, "O sistema numa página", `consulta.ts`, `dia.ts`, `chat.ts` e o script no mapa dos módulos |
| `arquitetura/04.16-chat.md` | §4.16 reescrito: a ferramenta, a trava, as receitas, a resposta local e a global, o teste |
| `arquitetura/14-limites.md` | os limites abaixo; a depreciação do `queryNodes` corrigida (a instância já é Cypher 25, e o `SEARCH` funciona) |
| `Specs/visao.md` | §10: a exceção do teste ao "não pergunta nada de volta" |
| `PROXIMOS-TESTES.md` | as nove, o teste em vários turnos, o caso Isinha |
| `CLAUDE.md` | a linha do `CHAT_MODEL`, se o padrão mudar |

## Ordem de execução

0. **O protótipo, antes de esta spec fechar.** O MCP oficial (`neo4j-mcp-server`,
   com `NEO4J_MCP_READ_ONLY=true`) contra produção: `get-schema`, `SHOW INDEXES`,
   as contagens e as nove pelo `read-cypher`. As que funcionarem viram a §5; as
   que falharem dizem o que a §4 precisa explicar. O MCP não gera embedding: ele
   testa grafo e agregação, não a busca por sentido. **Rodado em 13/10**: a §5
   é o que rodou, e a §4 ganhou o que ele mostrou.
1. `neo4j.ts` e `consulta.ts`, com o teste da trava, da limpeza e do corte.
   Ponto de retorno: `pnpm test` verde, um `EXPLAIN` de escrita de verdade
   recusado contra a instância, e **o piso medido** — as palavras de busca da
   §5 viram `$vetor` de verdade, e a distribuição de `sim` decide se o prompt
   ganha um número. **Feito em 13/10**: 50 testes; as escritas recusadas no
   `EXPLAIN` com uma guarda no `fetch` que só deixava sair `EXPLAIN`; e o piso
   medido — sem número (§5).
2. `dia.ts`, a ferramenta em `chat.ts`, os tipos, o rastro e o dia de Brasília
   nas ferramentas antigas. **Feito em 13/10**: a frase de progresso do passo
   novo e as datas do (i) e da lista entraram junto, porque são o mesmo dia; o
   bloco da Cypher e da tabela no (i) fica para o passo 4. A ferramenta está no
   conjunto, e o `chat-7` ainda não a cita — o modelo a vê só pela descrição até
   o passo 3.
3. O `chat-8` e o envelope. **Feito em 17/10**: o prompt tem as seções da §4 e
   as receitas da §5, conferidas de novo pelo MCP no mesmo dia; a do teste ordena
   por `dia, id`, e não só por `dia`, para a fila ser a mesma a cada turno. O
   `MAX_TOKENS_SAIDA` subiu para 100 mil junto, e a síntese perdeu o dobro.
4. O (i).
5. O script e a comparação. **Ponto de retorno: o HTML vai para mim**, e o modelo
   quem escolhe sou eu.
6. `MODELO_CHAT_PADRAO`.
7. O `chat-9`.
8. A documentação acompanhando cada passo, no mesmo commit.

## Limites que esta fatia cria (para o §14)

- **Consulta válida que responde errado não dá erro.** Uma Cypher que roda e
  conta a coisa errada — um label trocado, um filtro esquecido — devolve um número
  plausível. A defesa é o (i) mostrar a Cypher, e eu ler.
- **O vazio pode ser do nome, e não do diário.** Os avisos do banco pegam label e
  propriedade que não existem; não pegam um valor que não existe (`tipo:
  'MEDO'`). A linha de zero resultados diz as causas possíveis; não diz qual foi.
- **Não há piso na busca por sentido.** O passo 1 mediu, e nenhum número separa
  o tema do resto (§5): quem decide onde o tema acaba é o modelo, lendo os
  trechos em ordem. Um modelo que leia pouco para cedo, e um que leia mal leva
  trecho de fora; a defesa é a coluna `sim` e o trecho no (i).
- **O dia fora do chat é UTC.** Retrato, confronto, enriquecimento e correções
  leem `valido_em` com `slice(0, 10)`: a sessão gravada depois das 21h aparece
  com o dia seguinte nos prompts e nas telas deles. O chat é o único que
  converte.
- **A pergunta global custa o que o modelo decidir.** Sem teto de resposta e com
  100 mil de saída, o limite é o relógio da rota.
- **A trava depende da classificação do banco.** Uma procedure de leitura
  classificada errado passaria pelo `EXPLAIN`; o `accessMode: Read` da execução e o
  bloqueio de `CALL` de procedure são as duas camadas que cobrem isso.
