## 8. Neo4j

Acesso pela **HTTP Query API**, nunca pelo driver Bolt: serverless não sustenta
pool de conexões. `NEO4J_QUERY_URL` é o endpoint completo
(`https://<id>.databases.neo4j.io/db/<banco>/query/v2`). O `<banco>` **não é
necessariamente `neo4j`**: nesta instância Aura ele é o próprio id da instância,
o valor de `NEO4J_DATABASE` no arquivo de credenciais. Errar esse segmento dá
`Database does not exist` no `pnpm migrate`. `query()` traduz o par
`fields`/`values` da resposta em objetos e transforma `errors[0]` em
`Neo4jError`.

### O schema inteiro, por label e aresta

A definição canônica é `db/migrations/`; este é o contrato que ela escreve, com
a migration de origem de cada propriedade entre parênteses. Constraint de
existência (`IS NOT NULL`) é recurso Enterprise e o Aura Free a recusa: campo
obrigatório é garantido pelo código que grava e pelos testes, não pelo banco.

```
(:Sessao { id, iniciada_em, duracao_s, status, audio_key,              (001)
           transcricao_key, chunks_total,                               (001)
           descartada_em })                                             (008)

(:Atomo { id, texto, tipo, criado_em, valido_em, status,               (002)
          prompt_version, modelo,                                       (002)
          inicios_s, fins_s, ancoras,                                   (003)
          embedding, embedding_modelo,                                  (006)
          confronto_estado, confronto_em,
          confronto_execucao, confronto_motivo })                       (011)
tipo ∈ FATO | OPINIAO | SENTIMENTO | APRENDIZADO | CONQUISTA          (002)
     | DECISAO | ROTINA                                                 (003)
     | HISTORIA                                                         (007)

(:Entidade:Pessoa|:Projeto|:Objetivo                                    (002)
           |:Organizacao                                                (007)
  { id, nome, nome_normalizado, criado_em,                              (002)
    status,                                                             (004)
    contexto, pode_ajudar_com, fizemos_juntos,                          (005)
    embedding, embedding_modelo, embedding_fonte,                       (006)
    resumo, aliases, canonico,                                          (009)
    resumo_anterior, contexto_anterior,
    pode_ajudar_com_anterior, fizemos_juntos_anterior,
    enriquecimento_estado, enriquecimento_motivo,
    enriquecimento_em, enriquecimento_atomos })                         (010)
status ∈ 'ativa' | 'fundida'   resumo ≤ 500 (TETO_RESUMO)
perfil (contexto, pode_ajudar_com, fizemos_juntos) sem teto

(:Conversa { id, titulo, criado_em, atualizada_em,
             arquivada_em, mensagens_key })                             (012)

(:Sessao)-[:GEROU]->(:Atomo)                                            (002)
(:Atomo)-[:SOBRE]->(:Entidade)          exatamente 1, sujeito principal (002)
(:Atomo)-[:MENCIONA]->(:Entidade)       0..n                            (002)
(:Atomo)-[:PERFILA { campo }]->(:Entidade)                              (005)
(:Entidade)-[:FUNDIDA_EM]->(:Entidade)  fusão de duas entidades reais   (004)
(:Entidade)-[:DISTINTA_DE]->(:Entidade) recusa minha                    (004)
(:Atomo mais_novo)-[:ATUALIZA|:CONTRADIZ|:CONFIRMA|:COMPLEMENTA
  { execucao, motivo, confianca, criado_em, modelo, prompt_version,     (011)
    camada, origem, dono, editado_em,                                   (013)
    original_tipo, original_camada, original_motivo }]->(:Atomo mais_antigo)
(:Atomo)-[:CONFRONTO_RECUSADO { em, tipo }]->(:Atomo)                   (013)
```

| Constraint ou índice | Migration | Para quê |
|---|---|---|
| `sessao_id` (único), `sessao_status`, `sessao_iniciada_em` | 001 | a lista de sessões e a guarda de status |
| `atomo_id` (único), `atomo_status`, `atomo_tipo`, `atomo_valido_em` | 002 | o `MERGE` idempotente do confirmar e os filtros do chat e do confronto |
| `entidade_id` (único), `entidade_nome_normalizado` (único) | 002 | ver §8.1 |
| `entidade_status` | 004 | existe e não é usado — ver §8.2 |
| `atomo_embedding`, `entidade_embedding` (vetoriais) | 006 | ver §8.4 |

As outras migrations (003, 005, 007, 008, 009, 010, 011, 012, 013) **não têm
statement**: propriedade de valor livre e tipo de relação não se declaram no
Aura Free, e índice novo esbarra na cota (§14). Elas existem porque
`db/migrations/` é a definição canônica, e quem for ler tem que ver o contrato
inteiro. `scripts/migrate.ts` conta 0 statement(s) e segue.

### Quem escreve

| Módulo | Escreve | Quem chama |
|---|---|---|
| `sessoes.ts` | `:Sessao` — cria, atualiza com guarda de status, marca `descartada_em` | as rotas de `/api/sessoes` e o pipeline |
| `atomos.ts` | `:Atomo`, `:Entidade` e `:PERFILA` | **só o confirmar** — nenhum átomo entra antes da revisão (regra 5) |
| `fusao.ts` | `:Entidade` — funde, renomeia, troca tipo, cria, exclui, escreve `resumo`, edita `aliases`, marca `canonico` | as rotas de `/entidades`, com um toque meu em cada uma — e `registrarGrafia`, que o confirmar chama sozinho (§4.14) |
| `perfil.ts` | `:Entidade` — os três campos de perfil (8.3) | só `POST /api/entidades/perfil`, com um toque meu |
| `entidades.ts` | `:Entidade` — `embedding`, `embedding_modelo` e `embedding_fonte` (8.4) | `passadaDeVetores()` em `waitUntil`, nos pontos da tabela do §8.4, mais `POST /api/entidades/embutir` para o retrofill; o módulo que lê o catálogo é o mesmo que põe o vetor em dia |
| `enriquecimento.ts` | `:Entidade` — a ficha inteira, os `_anterior` e o estado da fila (8.3.2) | a fila do agente 4, a batida semanal e o retrato do "eu" (§4.9, §4.20) |
| `confronto.ts` | `:Atomo` — `confronto_*`; as quatro relações e a recusa (8.5, 8.7) | a fila do confronto, a batida diária e a minha edição em `/confronto` (§4.15) |
| `conversas.ts` | `:Conversa` (8.6) | `/api/chat` e `/api/conversas` |

Três deles gravam sem um toque meu: `entidades.ts`, cujo dado é derivável do
texto a qualquer momento e se refaz sozinho na passada seguinte;
`enriquecimento.ts`, que é a reabertura declarada do regime da ficha (§4.9); e
`confronto.ts`, que liga átomos já confirmados sem tocar no texto deles (§4.15).
Nenhum dos três cria átomo.

A regra 5 é sobre o **pipeline** não gravar sozinho. `fusao.ts` é o contrário
disso: é eu corrigindo à mão o que o pipeline deixou torto. A resolução de
entidade (4.6) continua só lendo. Labels que o código escreve:

```
(:Sessao { id, iniciada_em, duracao_s, status, audio_key,
           transcricao_key, chunks_total, descartada_em })          (008)
```

`:Sessao` é infraestrutura de gravação, não conteúdo: gravar o nó sem
confirmação não conflita com a regra 5 (nada entra no grafo sem aprovação) —
essa regra vale para átomo e entidade.

`descartada_em` (migration 008) é ISO, e **ausente é o caso normal**: sessão que
nunca foi descartada passa no `IS NULL` de `paginaDeSessoes`. Ele é o único efeito
do `DELETE` de sessão sobre o grafo — os átomos e o `:GEROU` ficam onde estavam
(regra 6, §10).

### 8.1 `:Atomo` e `:Entidade`: a base (migrations 002, 003 e 007)

Quem escreve átomo e entidade é o confirmar da revisão, por `atomos.ts`. O
`MERGE` com label literal por tipo, a constraint de `nome_normalizado` e as
listas paralelas como float são conferidos contra o Aura, não só contra o banco
mockado.

Neo4j não aceita label vindo de parâmetro e o projeto não usa APOC, então
`gravarEntidades` roda **uma consulta por tipo**, com o label literal na string.
É seguro porque o valor sai de `TIPOS_ENTIDADE`, constante fechada, e nunca do
cliente.

```
(:Atomo { id, texto, tipo, inicios_s, fins_s, ancoras,
          criado_em, valido_em, status, prompt_version, modelo })

tipo ∈ FATO | OPINIAO | SENTIMENTO | APRENDIZADO | CONQUISTA | DECISAO
     | HISTORIA | ROTINA
```

`HISTORIA` (007) é o contrário dos outros sete: eles pedem a afirmação
destilada, ela pede o episódio com o detalhe que foi contado (§4.6). Ela está
também em `TIPOS_SEMPRE_EU` (`tipos.ts`), junto com `SENTIMENTO`, `APRENDIZADO`
e `ROTINA`. **Nenhum átomo muda de tipo** depois de gravado: o `prompt_version`
carimbado é o que diz por que ele saiu daquele tipo.

`inicios_s`/`fins_s`/`ancoras` são listas paralelas, uma entrada por âncora —
Neo4j não guarda array de mapa como propriedade. A proposta no R2 guarda a forma
rica (`trechos: [{texto, inicio_s, fim_s, ancora}]`); o achatamento acontece no
confirmar. A 003 **não tem statement nenhum**: nada do que ela muda é declarável
no Aura Free, então ela documenta o contrato e o código o garante.

| Constraint | Alcance |
|---|---|
| `atomo_id` | id determinístico `<sessao_id>-<índice>` — é ele que faz o `MERGE` do confirmar ser idempotente |
| `entidade_id` | |
| `entidade_nome_normalizado` | único entre **todas** as entidades: `:Pessoa`, `:Projeto`, `:Objetivo` e `:Organizacao` carregam `:Entidade`, então um projeto e uma pessoa não podem ter o mesmo nome. Deliberado — é a trava que impede duplicata em corrida, ao custo de recusar colisão legítima de nome entre tipos |

`:Organizacao` (007) não tem constraint nem índice próprio: as duas constraints
acima são por `:Entidade`, e valem para os quatro labels de uma vez. Label
passa a existir quando o primeiro nó o recebe, no confirmar. **Nada é
reclassificado para trás**: a empresa que está no grafo como `:Pessoa` continua
`:Pessoa` até eu trocar o tipo à mão em `/entidades` (§8.2), e reclassificar em
massa exigiria adivinhar quais nós são empresas.

Índices em `:Atomo(status)`, `:Atomo(tipo)` e `:Atomo(valido_em)`.

Tipo de relação não se declara em Neo4j — `:GEROU`, `:SOBRE` e `:MENCIONA` só
passam a existir com a primeira aresta. Ficam registrados em comentário no topo
da migration, que é a definição canônica do schema.

**Mudança de schema = nova migration numerada**, proposta e aprovada antes de
rodar. `db/migrations/` é a definição canônica; `scripts/migrate.ts` aplica os
arquivos em ordem pela Query API. Nunca alterar schema direto no código ou no
console do Aura.

### 8.2 Higiene: fundir é criar alias (migration 004)

Duas grafias da mesma coisa entram como dois nós — a constraint de
`nome_normalizado` impede duplicata da **mesma** grafia, não de grafias
parecidas: "Exxmed" e "Exx Med" normalizam para chaves diferentes.

```
(:Entidade { …, status, aliases })       status ∈ 'ativa' | 'fundida'
                                         aliases: lista de grafias (009)
(:Entidade)-[:FUNDIDA_EM]->(:Entidade)   fusão de duas entidades reais
(:Entidade)-[:DISTINTA_DE]->(:Entidade)  recusa minha: não propor de novo
```

**São dois mecanismos.** Grafia (o que o STT errou, o nome antigo de um renome,
o que eu escrevo à mão) mora em `e.aliases`, uma lista de strings no próprio nó;
`:FUNDIDA_EM` significa uma coisa só — fusão de duas entidades reais, que é o
registro de uma decisão minha.

**Fundir não apaga** (regra 6). O perdedor fica com `status = 'fundida'` e uma
aresta `:FUNDIDA_EM`; as **três** arestas que apontam para entidade — `:SOBRE`,
`:MENCIONA` e `:PERFILA` — migram por `MERGE`, uma consulta por tipo: Neo4j não
aceita tipo de relação vindo de parâmetro, e repetir a linha é bem menos frágil
que uma subquery com `UNION`.

`:PERFILA` migra **fora do laço** das outras duas, e é a única que precisa
disso: ela carrega `campo` (migration 005), então o `MERGE` do destino tem de
casar o par (átomo, campo), que é a identidade da aresta. Generalizar o laço
para propriedade custaria mais que repetir a consulta uma vez.

O ponto do desenho: **como o perdedor mantém o `nome_normalizado`, a grafia
morta nunca renasce como nó novo.** Dita outra vez, ela casa com o alias e a
leitura segue até o vencedor. A fusão é o mecanismo de alias, não um efeito
colateral dele — e é o que faz ela valer para amanhã, não só arrumar o ontem.

#### A cadeia: fundir o vencedor leva os aliases dele junto (4.8.1)

**Todas as travessias de `:FUNDIDA_EM` do projeto são de um salto** — dez
lugares, em `atomos.ts`, `entidades.ts`, `perfil.ts` e `fusao.ts`. Isso está
certo e fica: fusão é rara e é escrita; leitura é quente e inclui duas consultas
de índice vetorial por janela, e pagar expansão de comprimento variável
(`-[:FUNDIDA_EM*1..]->`) em dez leituras para consertar um caso de escrita é o
lado errado da conta.

O preço é uma consulta a mais em `fundir()`, antes de marcar a perdedora: os
aliases que apontavam para ela passam a apontar para o vencedor novo.

```
MATCH (x:Entidade)-[r:FUNDIDA_EM]->(p:Entidade { nome_normalizado: $perdedora })
MATCH (v:Entidade { nome_normalizado: $vencedora })
MERGE (x)-[:FUNDIDA_EM]->(v)
DELETE r
```

Sem ela, `rapha2 → rapha` seguido de `rapha → raphael` deixava `rapha2`
pendurada num nó fundido. O efeito é silencioso e irreversível: a chave `rapha2`
sai de `chaves` no catálogo, e dita de novo numa sessão nova o `MERGE` do
confirmar reencontra o nó morto — a constraint da 002 impede o segundo — e
pendura o `:SOBRE` em **`rapha`**, que nenhuma listagem mostra e que a camada dos
vizinhos descarta. `MERGE` + `DELETE` como o resto: refazer a fusão cura, que é o
contrato que o §14 declara para ela não ser atômica.

**E `fundir` recusa vencedora com `status = 'fundida'`**: fundir **para
dentro** de um alias corrompe do mesmo jeito.

#### A grafia é item de `aliases` (migration 009)

A grafia falada é registrada no confirmar (`registrarGrafia`, §4.14): eu disse
"Jean", confirmei "Giampaolo Lepore", e na sessão seguinte "jean" casa por
grafia exata, sem depender da busca. Ela é um item de `aliases`, e não um nó:
a lista é editável em `/entidades`, e eu posso ensinar uma grafia **antes** de o
STT errar pela primeira vez, que é justamente quando ele mais erra.

| Escrita | O que ela faz |
|---|---|
| `registrarGrafia` (confirmar) | `SET v.aliases = coalesce(v.aliases, []) + $falada` |
| `renomear` | o nó assume o nome novo; o antigo entra em `aliases` |
| `fundir` | nó perdedor, `status = fundida`, `:FUNDIDA_EM`, arestas migradas |

As quatro recusas de `registrarGrafia`: grafia vazia, pronome ou igual à chave
do nó; nó alvo inexistente ou ele mesmo fundido; grafia que já é entidade
**ativa**; grafia que já é alias de outro nó. String dentro de array o banco não
recusa, então a quarta trava é uma leitura do catálogo, em memória — a mesma
decisão que `acharPorChave` toma. Pela mesma razão, `criarEntidade` e o conflito
de `renomear` também conferem a propriedade: sem isso eu semearia "Jean" como
pessoa nova enquanto "Jean" é grafia do Giampaolo, e o casamento exato passaria a
ter dois donos para a mesma chave.

Quem lê as grafias, e de onde:

| Onde | Fonte | Por quê |
|---|---|---|
| `listarEntidades` | `e.aliases` **∪** `alias.nome` | monta `chaves`; é o que faz o casamento exato atravessar a grafia sem consulta a mais |
| `garantirEmbeddings` | as duas, unidas em Cypher | a grafia entra na string canônica, então acrescentá-la muda o hash e a entidade se reembute sozinha |
| `buscarConhecidas` / `resolver` | `chaves` | "Exx Med" numa sessão nova volta como conhecida, com o nome do vencedor |
| `gravarAtomos` e `fundir` (`:SOBRE`, `:MENCIONA`, `:PERFILA`) | `:FUNDIDA_EM` | fusão real continua sendo nó, e a travessia continua igual |
| `nomesParaVocabulario` | **só `e.nome`** | mandar a grafia rejeitada ensinaria o STT a reproduzi-la — é escolha escrita na consulta, e não consequência do filtro de status |

Depois da travessia dois nomes distintos podem virar o mesmo nó, e `:SOBRE` +
`:MENCIONA` para a mesma entidade não é contrato válido — a menção redundante é
descartada, o sujeito vence.

**O tipo se conserta.** Depois da primeira revisão a entidade é `conhecida`, e a
revisão a mostra fixa (o grafo vence sobre o extrator). `trocarTipo` põe o label
novo e remove os outros, uma consulta com labels literais — `:Entidade` nunca
sai, porque é ele que carrega a constraint. Os outros são quatro (`:Pessoa`,
`:Projeto`, `:Objetivo`, `:Organizacao`), e é por aqui que passa a
reclassificação das empresas que nasceram `:Pessoa`: um nó por vez, com um toque
meu em cada um.

**Semear é criar entidade antes de falá-la.** `/entidades` deixa criar nome e
tipo à mão, e o nó nasce **órfão de propósito** — zero átomos, e a lista mostra
"ainda não falada". O confirmar evita órfão com cuidado, porque lá seria
acidente; aqui é o pedido. O ganho é que o nome entra no vocabulário do STT
**antes** da primeira menção, que é quando o transcritor mais erra, e quando ele
enfim for falado a resolução acha a entidade pronta com o tipo que eu escolhi,
em vez do palpite do extrator.

**`status` ausente conta como ativa, e a ausência é o caso normal — não o
legado.** `Specs/slice-3.md` põe a escolha em duas opções ("ou a migration
preenche com `'ativa'`, ou o código trata ausência como ativa") e decide pela
segunda, por ser mais barata e por sobreviver a nó criado por código antigo. A
implementação seguiu: `gravarEntidades` (`atomos.ts`), que é o caminho por onde
quase toda entidade nasce, grava `id`, `nome`, `nome_normalizado` e `criado_em`
e **não** grava `status`; quem grava `status: 'ativa'` é só a semeadura manual
de `/entidades/criar`. As três leituras de entidade usam
`coalesce(e.status, 'ativa') <> 'fundida'`, e a defesa está toda ali.

Duas consequências que só se descobrem lendo o código, e por isso ficam
escritas aqui:

- **o índice `entidade_status` da 004 não é usado.** `coalesce()` sobre a
  propriedade impede o planejador de usá-lo, e propriedade nula não entra em
  índice de faixa. Ele existe, está `ONLINE` e não serve a nenhuma das três
  consultas. Não custa nada com dezenas de nós; é candidato a `DROP` numa
  migration futura, não a conserto agora;

- **`WHERE e.status = 'ativa'` não é consulta válida neste grafo.** Quem ler só
  a migration vai escrevê-la e não achar quase nada. A forma certa, em Cypher
  novo, é sempre o `coalesce`.

**Nada é automático.** `duplicatas.ts` só propõe — string primeiro (de graça),
o modelo depois, sobre a lista curta e com os textos dos átomos como contexto.
Fundir é um toque meu: "Marina" e "Mariana" são distância 1 e duas pessoas, e o
custo do erro é assimétrico — duas entidades a mais é grafo um pouco sujo, uma
fusão errada é grafo mentindo, sem desfazer.

### 8.3 Perfil e a aresta que o alimenta (migration 005)

```
(:Entidade { …, contexto, pode_ajudar_com, fizemos_juntos })
(:Atomo)-[:PERFILA { campo }]->(:Entidade)
campo ∈ contexto | pode_ajudar_com | fizemos_juntos
```

A 005, como a 003, **não tem statement nenhum**: propriedade de valor livre não
se declara no Aura Free (constraint de existência é Enterprise) e tipo de relação
não se declara em Neo4j nenhum. Ela existe porque `db/migrations/` é a definição
canônica do schema, e quem for ler tem que ver o contrato inteiro.

**Campo de perfil ausente conta como vazio, na leitura** (`coalesce` em toda
consulta) — mesma decisão do `status` na 004 e pela mesma razão: a defesa tem que
valer para o nó que um deploy antigo criar amanhã, não só para os que existem
hoje. Sem índice: ninguém busca por perfil.

**Por que aresta, e não propriedade do átomo.** Duas razões, e a primeira é a que
manda: a marca precisa dizer **de quem** é a informação. "fui no parque andar de
slackline com o Raffa" é `sobre: "eu"` pelas regras de tipo do `extracao-9`, e a
informação de perfil é do Raffa. A segunda é que Neo4j não guarda array de mapa
como propriedade — foi isso que forçou as listas paralelas da 003. Aresta com
propriedade ele guarda bem, e fica consultável: "todo átomo que diz o que o Rapha
sabe fazer".

**Idempotente por construção**: o `campo` vai **dentro** do `MERGE`, então o par
(átomo, campo, entidade) é a identidade da aresta e reconfirmar não a dobra
(regra 4). Fora do `MERGE`, um `SET` depois criaria uma aresta nova a cada
confirmação. Como `:SOBRE` e `:MENCIONA`, ela **atravessa alias na escrita** e
**migra na fusão** (8.2): proposta montada antes de uma fusão penduraria a marca
num nó morto, e uma fusão posterior a deixaria lá.

A travessia sozinha não bastaria, e a assimetria é o motivo: `atomosMarcados`
vai do **alias para o vencedor**, nunca ao contrário. Marca esquecida no nó
perdido sumiria do perfil do vencedor sem erro e sem aviso — e fusão não tem
desfazer.

Neo4j também não aceita **nome de propriedade** vindo de parâmetro, então
`perfil.ts` monta o `SET alvo.<campo>` com o nome literal — mesmo padrão do label
literal em `atomos.ts`, e seguro pela mesma razão: o valor sai de `CAMPOS_PERFIL`,
constante fechada, e nunca do cliente.

**Perfil vazio é perfil válido**, e é como toda entidade nasce: entra no
catálogo do agente 2 só com nome e tipo.

### 8.3.1 A ficha se apresenta: `resumo`, `aliases`, `canonico` (migration 009)

```
(:Entidade { …, resumo, aliases, canonico })

resumo    texto livre, teto de 500 (TETO_RESUMO); ausente = ''
aliases   lista de grafias; ausente = []          — ver §8.2
canonico  booleano, marcado à mão; ausente = false
```

**O `resumo` é o retrato de identidade**: quem a entidade é para mim e, antes de
tudo, o que a distingue de outra parecida. É o que os **dois** agentes leem por
padrão — o dossiê do extrator (§4.14) e o catálogo do agente 2 (§4.8): uma
apresentação só, nos dois lugares.

**O teto de 500 não é estética**: sem teto, o custo de todo prompt passa a
depender do tamanho de cada ficha, e uma entidade muito falada empurra as outras
para fora do contexto. O corte é no servidor (`gravarResumo`).

**Resumo vazio é estado válido, e não ganha fallback.** A entidade sem resumo
entra no prompt com nome, tipo e grafias e mais nada; o agente devolve confiança
baixa, a confiança baixa dispara a segunda passada, e a segunda passada carrega
o perfil inteiro. É **comportamento esperado** (§14): a frequência da segunda
passada cai conforme os resumos são escritos.

**`canonico` é preferência, não obrigação.** "Esta é a ficha oficial desta
entidade": marcada à mão, um toque, reversível, sem consequência retroativa —
nenhum átomo já gravado muda. Ela não exige sobrenome, não impede entidade nova
de nascer e não trava unicidade nenhuma. O que ela faz:

| Onde | O que ela vale |
|---|---|
| no dossiê do extrator e no catálogo do agente 2 | uma palavra na linha do candidato dizendo que aquela é a ficha oficial |
| em `/entidades` | marca na linha e ordenação na frente (`ORDER BY canonico DESC`) |
| no desempate determinístico | quando dois candidatos empatam, o canônico vence — em código, antes de qualquer chamada |

Nome canônico é preferência do mesmo jeito: `:Pessoa` sem sobrenome funciona
igual, e `/entidades` mostra que falta. Nada bloqueia, e nenhuma gravação é
recusada por isso.

**Sem índice**, como o perfil: ninguém busca por `resumo` nem por `canonico`, e o
Aura Free tem cota de índice.

**O perfil não tem teto.** Os três campos não entram no caminho comum do agente
2: só aparecem na segunda passada, para os poucos candidatos de uma menção em
dúvida, e o custo de prompt que justificaria um teto não existe.

### 8.3.2 O desfazer e a fila (migration 010)

```
(:Entidade { …, resumo_anterior, contexto_anterior,
                pode_ajudar_com_anterior, fizemos_juntos_anterior,
                enriquecimento_estado, enriquecimento_motivo,
                enriquecimento_em, enriquecimento_atomos })

*_anterior             ausente = '' (não há geração guardada)
enriquecimento_estado  'na_fila' | 'rodando' | 'pronta' | 'falhou';
                       ausente = nunca enriquecida
enriquecimento_motivo  o erro, quando falhou
enriquecimento_em      ISO 8601 — quando o estado mudou
enriquecimento_atomos  quantos átomos entraram na última rodada; ausente = 0
```

A 010 não traz migração de dado: entidade sem `enriquecimento_estado`
simplesmente nunca foi enriquecida.

**Todos ausentes contam como vazio na leitura**, pela mesma razão do `status` na
004 e do perfil na 005: a defesa vale para o nó que um deploy antigo criar
amanhã, não só para os que existem hoje. Estado que o código não conhece é lido
como "nunca enriquecida", e não como erro.

**Os quatro `_anterior` são o desfazer** (§4.9): eles existem porque o agente 4
escreve a ficha sem eu ver antes.

**O estado da fila mora no nó, e não no R2**, ao contrário do acumulado de uma
sessão (§9). Lá a razão é a regra 5 — nada entra no grafo antes da revisão. Aqui
a entidade **já está** no grafo, e o que a fila guarda é sobre ela, não é
proposta de conteúdo nenhum. É esse estado que faz "fechar a aba não interrompe
nada" ser verdade: o elo seguinte lê o banco, não o navegador.

**Sem índice**, como o perfil e o resumo: a fila é varrida sobre o catálogo que
`listarEntidades()` já carrega inteiro, e o Aura Free tem cota de índice. É mais
um lugar que pediria índice no dia em que o catálogo não couber na memória de uma
função (§14).

### 8.4 O vetor no grafo (migration 006)

```
(:Atomo    { …, embedding: [1536 floats], embedding_modelo })
(:Entidade { …, embedding: [1536 floats], embedding_modelo, embedding_fonte })

CREATE VECTOR INDEX atomo_embedding    FOR (a:Atomo)    ON (a.embedding)
CREATE VECTOR INDEX entidade_embedding FOR (e:Entidade) ON (e.embedding)
  vector.dimensions: 1536, vector.similarity_function: 'cosine'
```

Diferente da 003 e da 005, esta migration **tem statement de verdade** — índice
se declara. Propriedade continua não se declarando no Aura Free, então os três
campos são contrato escrito, não statement.

**O tier Free aceita índice vetorial**, verificado contra a instância real
(Neo4j 5.27-aura): `CREATE` aceito, `ONLINE` em menos de 500 ms,
`db.index.vector.queryNodes` devolvendo vizinhos com score. **E a cota do Free
não é medida em bytes**: o teto publicado é de 200 mil nós e 400 mil arestas, e
embedding é propriedade em nó que já existe — não cria nó nem aresta. Com 4.000
átomos o grafo vai a ~4.050 nós, 2% do teto.

O resto da configuração fica no **padrão medido** (`quantization.type: SCALAR`,
`hnsw.m: 16`, `ef_construction: 100`, `default_search_expansion_factor: 1.5`).
Explicitar qualquer um desses seria fixar número que não foi calibrado contra
nada — e é o `SCALAR` do padrão que mantém o vetor **do índice** em torno de
6 MB para 4.000 átomos, contra os ~48 MB das propriedades.

**A dimensão é a única coisa aqui que amarra.** Trocar para um modelo de outra
dimensão exige `DROP` e recriar os dois índices, por migration nova;
`embedding.ts` estoura na porta quando a dimensão não bate, para o erro aparecer
antes do banco e dizendo o que fazer.

#### Os três campos, e por que cada um existe

| Campo | Onde | Para quê |
|---|---|---|
| `embedding` | átomo e entidade | o vetor |
| `embedding_modelo` | átomo e entidade | vetores de **dois modelos no mesmo índice não dão erro: dão vizinhança errada**. Sem o campo não há como saber quais nós voltam para a fila quando `EMBEDDING_MODEL` mudar |
| `embedding_fonte` | **só** entidade | hash da string canônica. É o que torna o refresh idempotente, e o que faz um gancho esquecido custar **atraso** em vez de vetor velho |

O átomo não tem `embedding_fonte`, e não é esquecimento: texto de átomo
confirmado não muda — deleção é soft (regra 6) e o `MERGE` é por
`<sessao_id>-<índice>`. Lá `embedding IS NULL` é a trava que basta.

O `embedding_fonte` é o que faz `/perfil`, `/renomear`, `/fundir`, `/tipo` e
`/criar` não precisarem lembrar de **invalidar** nada: a string canônica muda, o
hash muda, e a próxima passada de `garantirEmbeddings()` reembute.

**Quem faz essa próxima passada acontecer**, toda em `waitUntil` e toda
engolindo a falha com `[entidades]` no log:

| Call site | Por que ali |
|---|---|
| `POST /api/sessoes/:id/confirmar` | depois de `gravarAtomos`, junto do `capturarCorrecoes` — é onde nascem as entidades novas |
| `POST /api/entidades/perfil` e `/resumo` | o que mais muda a string canônica |
| `POST /api/entidades/renomear` e `/aliases` | nome e grafias entram na fonte |
| `POST /api/entidades/fundir` | o vencedor ganha alias, e alias entra na fonte |
| `POST /api/entidades/tipo` e `/canonico` | tipo e marca entram na fonte |
| `POST /api/entidades/criar` | é o passo zero: o nó semeado à mão só entra na 3a com vetor |
| `POST /api/entidades/enriquecer`, `/desfazer` e o desfazer do retrato | a ficha escrita ou trocada muda a fonte |
| `/api/cron/enriquecimento` | a batida semanal escreve fichas |
| `POST /api/entidades/embutir` | o retrofill à mão |

**O gancho não invalida nada: quem decide é o hash.** Esquecer um call site
custa atraso, não vizinhança errada, porque a próxima passada de qualquer outro
alcança. E rodar com nada fora de dia custa uma consulta e zero chamada de
modelo, o que é o que permite chamar à toa.

O teto de `limite = 500` de `garantirEmbeddings()` fica: grafo maior que isso é
problema de outra fatia, e a rota manual continua existindo para o retrofill.

**Sem migração de dado**: nenhum vetor é calculado pela migration. Quem preenche
são os call sites acima, e `POST /api/atomos/embutir` e `POST
/api/entidades/embutir` para o retrofill — que custa uma chamada de rota em vez
de uma reextração.

### 8.5 As relações de confronto (migration 011)

Sem `CREATE INDEX`/`CREATE CONSTRAINT`, mesmo padrão da 005, 007 e 010:
propriedade de valor livre e relação nova não se declaram no Aura Free, e a
cota de índice já está no limite conhecido (§14). A varredura de pendentes usa
o índice `atomo_status` (002) que já existe, filtrando `confronto_estado` em
memória — mesma decisão da fila de enriquecimento sobre o catálogo de
entidades (§8.3.2).

`:Atomo` ganha três propriedades de controle e `confronto_motivo`:

```
confronto_estado     'rodando' | 'processado' | 'falhou' — ausente = nunca tentado
confronto_em         ISO 8601
confronto_execucao   id da última rodada — auditoria, não trava de desfazer
confronto_motivo     o erro, quando falhou
```

E quatro relações novas, sempre do átomo mais novo para o mais antigo:

```
(:Atomo mais_novo)-[:ATUALIZA|:CONTRADIZ|:CONFIRMA|:COMPLEMENTA {
  execucao, motivo, confianca, criado_em, modelo, prompt_version
}]->(:Atomo mais_antigo)
```

`modelo` e `prompt_version` na relação vão além da letra da regra 7 do
`CLAUDE.md` (que fala de átomo), mas seguem o espírito: é um julgamento de LLM
como outro qualquer, e precisa da mesma auditoria. Detalhe de por que o
desfazer não precisa casar `execucao` — a gravação apaga a geração anterior
antes de escrever, então só existe uma viva por vez — está em §4.15 e, por
extenso, no cabeçalho da própria migration.

### 8.6 A conversa, e o primeiro label solto do grafo (migration 012)

Sem statement, como as outras de propriedade livre (§8). O contrato do nó está
no topo deste capítulo.

```
(:Conversa {
  id,                 // base36, o mesmo `novoId()` de :Sessao
  titulo,             // do agente `titulo-chat`; string vazia até ele responder
  criado_em,
  atualizada_em,      // é por ele que a lista ordena
  arquivada_em,       // ISO, ou AUSENTE — e ausente é o estado "ativa"
  mensagens_key       // a chave do objeto no R2
})
```

**Sem relação nenhuma, e é a característica que define o label.** `:Conversa`
não é `:Entidade` nem `:Atomo`, e não se liga a nada do grafo de conhecimento —
é metadado de aplicação, como `:Sessao`. Uma conversa enxerga o grafo pelas
ferramentas do agente `chat` (§4.16.2), nunca por aresta própria; e **uma
conversa nunca enxerga outra**. Conversas virarem fonte de busca umas das outras
— uma ferramenta com embedding nas mensagens — foi recusado: nasceu de uma
ambiguidade de linguagem, não de um pedido real.

**Sem índice, e nem constraint de unicidade em `id`.** `listarConversas` varre
`(:Conversa)` com `ORDER BY` e `LIMIT` sobre o grafo de uma pessoa só — a mesma
conta de `paginaDeSessoes` (008). E, ao contrário de `:Sessao` (001), nada aqui faz
`MERGE` por id: a conversa nasce de um `CREATE` com id sorteado, e a unicidade
vem da origem. Um índice para proteger o que a origem já garante seria cota
gasta por simetria.

**`arquivada_em` ausente conta como ativa, na leitura** — mesma decisão do
`status` na 004, do perfil na 005 e do `descartada_em` na 008, e pela mesma
razão: a defesa vale para o nó que um deploy antigo criar amanhã, não só para os
que existem hoje.

**Esta foi a primeira exceção à regra 6 do `CLAUDE.md`**, e ela é deliberada (a
segunda veio depois, sem migration: a exclusão de entidade, §11). A regra 6 fala de átomo: "deleção é soft, nunca `DELETE` em átomo".
Conversa não é átomo — não é conhecimento, é a transcrição de uma pergunta que
eu fiz a uma tela. Nada do grafo depende dela, nenhum átomo perde procedência
quando ela some, e o pedido da entrevista foi explícito em ter as **duas** ações
e não só uma: `arquivar` congela (`SET c.arquivada_em`), `apagar` apaga
(`DETACH DELETE` mais o objeto no R2). O `DETACH` é cinto de segurança, não
necessidade: o nó nasce sem aresta e deve morrer assim.

### 8.7 As duas camadas, a minha edição e a recusa (migration 013)

Slice 5.2. Sem statement, como a 011: propriedade de relação e relação nova não
se declaram no Aura Free, e não há índice novo — a busca de candidatos é a mesma
`atomo_embedding` (006). `:Atomo` não ganha nada.

As quatro relações de confronto ganham:

```
camada      'forte' | 'sutil'       ausente = forte (tudo o que a 5 e a 5.1 gravaram)
origem      'agente' | 'eu'         ausente = agente; 'eu' = congelada — o agente
                                    não a apaga nem reescreve, em nenhum caminho
dono        id do átomo cuja rodada escreveu a aresta
                                    ausente = o átomo de onde ela sai
editado_em  ISO 8601                ausente = nunca editei
original_tipo, original_camada, original_motivo
            o que o agente gravou, guardado na minha primeira edição — é o
            `antes` da correção que vai para /calibracao
```

E uma relação nova, a recusa do par — tipo próprio para nenhum leitor que casa
as quatro a enxergar por engano, mesmo espírito do `DISTINTA_DE`:

```
(:Atomo)-[:CONFRONTO_RECUSADO { em, tipo }]->(:Atomo)                   (013)
```

`dono` é o que mantém "uma geração" verdadeira (§4.15.3): o átomo é comparado
também com os mais novos, a rodada dele escreve aresta que **chega** a ele, e
"apagar as de saída" deixaria de apagar o que ela escreveu.
