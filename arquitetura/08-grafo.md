## 8. Neo4j

Acesso pela **HTTP Query API**, nunca pelo driver Bolt: serverless não sustenta
pool de conexões. `NEO4J_QUERY_URL` é o endpoint completo
(`https://<id>.databases.neo4j.io/db/<banco>/query/v2`). O `<banco>` **não é
necessariamente `neo4j`**: nesta instância Aura ele é o próprio id da instância,
o valor de `NEO4J_DATABASE` no arquivo de credenciais. Errar esse segmento dá
`Database does not exist` no `pnpm migrate`. `query()` traduz o par
`fields`/`values` da resposta em objetos e transforma `errors[0]` em
`Neo4jError`.

Quatro módulos escrevem em nó de conteúdo, e a divisão importa:

| Módulo | Escreve | Quem chama |
|---|---|---|
| `atomos.ts` | `:Atomo`, `:Entidade` e `:PERFILA` | **só o confirmar** — nenhum átomo entra antes da revisão (regra 5) |
| `fusao.ts` | `:Entidade` — funde, renomeia, troca tipo, cria, escreve `resumo`, edita `aliases`, marca `canonico` | as rotas de `/entidades`, com um toque meu em cada uma — e `registrarGrafia`, que o confirmar chama sozinho (§4.14) |
| `perfil.ts` | `:Entidade` — os três campos de perfil (8.3) | só `POST /api/entidades/perfil`, com um toque meu |
| `entidades.ts` | `:Entidade` — `embedding`, `embedding_modelo` e `embedding_fonte` (8.4) | `passadaDeVetores()` em `waitUntil`, no confirmar e nas oito rotas de `/entidades`, mais `POST /api/entidades/embutir` para o retrofill; o módulo que lê o catálogo é o mesmo que põe o vetor em dia |

`entidades.ts` está na lista porque escrever vetor é escrever no grafo, mesmo
que o que ele escreva seja derivável do texto a qualquer momento. Ele é a
exceção da regra de cima e a confirma: é o único dos quatro que grava sem um
toque meu, e é o único cujo dado se refaz sozinho na passada seguinte.

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

`descartada_em` (migration 008) é ISO, e **ausente é o caso normal**: toda sessão
de antes da 4.10 passa no `IS NULL` de `todasSessoes` sem migração de dado
nenhuma. Ele é o único efeito do `DELETE` de sessão sobre o grafo — os átomos e o
`:GEROU` ficam onde estavam (regra 6, §10).

### 8.1 Schema da slice 2, aplicado e em uso

A migration `002_atomo_entidade.cypher` já rodou: `:Atomo` e `:Entidade` têm
constraint e índice no Aura, e o grafo já recebeu conteúdo de sessões reais —
átomos com as duas listas de offsets, `ancoras`, `status`, `prompt_version` e
`modelo`, ligados por `:GEROU`, `:SOBRE` e `:MENCIONA`. O `MERGE` com label
literal por tipo, a constraint de `nome_normalizado` e as listas paralelas como
float foram conferidos contra o Aura, não só contra o banco mockado. Quem escreve neles é o confirmar da revisão, por
`atomos.ts`; `entidades.ts` só lê, por `nome_normalizado`.

Neo4j não aceita label vindo de parâmetro e o projeto não usa APOC, então
`gravarEntidades` roda **uma consulta por tipo**, com o label literal na string.
É seguro porque o valor sai de `TIPOS_ENTIDADE`, constante fechada, e nunca do
cliente.

Depois das migrations 003 e 007 o contrato de `:Atomo` é:

```
(:Atomo { id, texto, tipo, inicios_s, fins_s, ancoras,
          criado_em, valido_em, status, prompt_version, modelo })

tipo ∈ FATO | OPINIAO | SENTIMENTO | APRENDIZADO | CONQUISTA | DECISAO
     | HISTORIA | ROTINA
```

`HISTORIA` entrou na 007, e é o contrário dos outros sete: eles pedem a
afirmação destilada, ela pede o episódio com o detalhe que foi contado (§4.6).
Ela entra também em `TIPOS_SEMPRE_EU` (`tipos.ts`), junto com `SENTIMENTO`,
`APRENDIZADO` e `ROTINA`. **Nenhum átomo muda de tipo**: o que o `extracao-7`
colapsou em `FATO` continua `FATO`, e o `prompt_version` carimbado é o que diz
por quê.

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

`:Organizacao` entrou na 007 e não trouxe constraint nem índice novo: as duas
constraints acima são por `:Entidade`, e valem para os quatro labels de uma vez.
A migration é um no-op, como a 003 e a 005 — label passa a existir quando o
primeiro nó o recebe, no confirmar. **Nada é reclassificado para trás**: a
empresa que já está no grafo como `:Pessoa` continua `:Pessoa` até eu trocar o
tipo à mão em `/entidades` (§8.2), e reclassificar em massa exigiria adivinhar
quais nós são empresas.

Índices em `:Atomo(status)`, `:Atomo(tipo)` e `:Atomo(valido_em)`.

Constraint de existência de propriedade (`IS NOT NULL`) não existe aqui: é
recurso Enterprise e o Aura Free recusa. `prompt_version` e `modelo`
obrigatórios em todo átomo (regra 7) são garantidos por código e teste, não pelo
banco.

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

**Desde a 4.11 são dois mecanismos, e não um.** Grafia (o que o STT errou, o
nome antigo de um renome, o que eu escrevo à mão) mora em `e.aliases`, uma lista
de strings no próprio nó; `:FUNDIDA_EM` ficou significando uma coisa só — fusão
de duas entidades reais, que é o registro de uma decisão minha. Até a migration
009 as duas coisas tinham a **mesma forma** no grafo e nenhuma consulta as
distinguia. Ver "grafia deixou de ser nó", abaixo.

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

**E `fundir` recusa vencedora com `status = 'fundida'`.** Até a 4.8 só a
perdedora era conferida, e fundir **para dentro** de um alias corrompe do mesmo
jeito.

#### Grafia deixou de ser nó (migration 009, slice 4.11)

A grafia falada é registrada automaticamente no confirmar desde a 4.9
(`registrarGrafia`, §4.14): eu disse "Jean", confirmei "Giampaolo Lepore", e na
sessão seguinte "jean" casa por grafia exata, sem depender da busca. Até a 4.10
ela virava um **nó** `:Entidade` com `status = 'fundida'` e uma `:FUNDIDA_EM`
para o vencedor.

**O problema não era o efeito, era a forma.** O grafo passou a ter duas espécies
de nó fundido idênticas entre si — a grafia que o STT errou, criada sozinha, e o
perdedor de uma fusão que eu mandei fazer, com arestas migradas — e nenhuma
consulta as distinguia. `/entidades` mostrava as duas como "histórico do nome", a
lista não era editável, e eu não conseguia ensinar uma grafia **antes** de o STT
errar pela primeira vez, que é justamente quando ele mais erra.

A migration 009 converteu as primeiras em itens de `aliases` do vencedor
terminal da cadeia e apagou os nós. **O discriminador é o label**, e não a
contagem de átomos: nó de grafia nasce só com `:Entidade`, entidade real ganha o
label do tipo no `ON CREATE` — e o perdedor de uma fusão real também fica com
zero átomo, porque `fundir()` migra as três arestas.

Depois disso:

| Escrita | O que ela faz |
|---|---|
| `registrarGrafia` (confirmar) | `SET v.aliases = coalesce(v.aliases, []) + $falada` |
| `renomear` | o nó assume o nome novo; o antigo entra em `aliases` |
| `fundir` | inalterada: nó perdedor, `status = 'fundida'`, `:FUNDIDA_EM`, arestas migradas |

As quatro recusas de `registrarGrafia` continuam de pé — grafia vazia, pronome
ou igual à chave do nó; nó alvo inexistente ou ele mesmo fundido; grafia que já é
entidade **ativa**; grafia que já é alias de outro nó. A quarta é a que mudou de
mecanismo: até a 009 o índice único de `nome_normalizado` era a trava, porque a
grafia era nó. String dentro de array o banco não recusa, então a trava passou a
ser uma leitura do catálogo, em memória — a mesma decisão que `acharPorChave` já
tomava. Pela mesma razão, `criarEntidade` e o conflito de `renomear` também
conferem a propriedade: sem isso eu semearia "Jean" como pessoa nova enquanto
"Jean" é grafia do Giampaolo, e o casamento exato passaria a ter dois donos para
a mesma chave.

Quem lê as grafias, e de onde:

| Onde | Fonte | Por quê |
|---|---|---|
| `listarEntidades` | `e.aliases` **∪** `alias.nome` | monta `chaves`; é o que faz o casamento exato atravessar a grafia sem consulta a mais |
| `garantirEmbeddings` | as duas, unidas em Cypher | a grafia entra na string canônica, então acrescentá-la muda o hash e a entidade se reembute sozinha |
| `buscarConhecidas` / `resolver` | `chaves` | "Exx Med" numa sessão nova volta como conhecida, com o nome do vencedor |
| `gravarAtomos` e `fundir` (`:SOBRE`, `:MENCIONA`, `:PERFILA`) | `:FUNDIDA_EM` | fusão real continua sendo nó, e a travessia continua igual |
| `nomesParaVocabulario` | **só `e.nome`** | mandar a grafia rejeitada ensinaria o STT a reproduzi-la — e isso deixou de ser consequência do filtro de status para ser escolha escrita na consulta |

Depois da travessia dois nomes distintos podem virar o mesmo nó, e `:SOBRE` +
`:MENCIONA` para a mesma entidade não é contrato válido — a menção redundante é
descartada, o sujeito vence.

O que a 009 apaga não tem átomo, não tem perfil e não tem label de tipo. **Um
`:DISTINTA_DE` apontando para um nó de grafia ia junto no `DETACH DELETE`** — no
grafo em que ela rodou não havia nenhum, e a recusa contra uma *grafia* (e não
contra uma entidade) não se sustenta depois que a grafia deixa de ser nó.

**O tipo também se conserta.** Ele só era editável enquanto a entidade era
`nova`, na primeira revisão em que aparecia; depois disso ela vira `conhecida`,
a revisão a mostra fixa (o grafo vence sobre o extrator) e o label errado ficava
para sempre. `trocarTipo` põe o label novo e remove os outros, uma consulta com
labels literais — `:Entidade` nunca sai, porque é ele que carrega a constraint.
Desde a 007 os outros são três (`:Organizacao` entrou na lista), e é por aqui
que passa a reclassificação das empresas que nasceram `:Pessoa`: um nó por vez,
com um toque meu em cada um.

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

**Sem migração de dado.** Nenhum campo é preenchido: as entidades de hoje entram
no catálogo do agente 2 só com nome e tipo, que é o comportamento anterior à
slice. Perfil vazio é perfil válido.

### 8.3.1 A ficha se apresenta: `resumo`, `aliases`, `canonico` (migration 009)

```
(:Entidade { …, resumo, aliases, canonico })

resumo    texto livre, teto de 500 (TETO_RESUMO); ausente = ''
aliases   lista de grafias; ausente = []          — ver §8.2
canonico  booleano, marcado à mão; ausente = false
```

**O `resumo` é o retrato de identidade**: quem a entidade é para mim e, antes de
tudo, o que a distingue de outra parecida. Ele é o que os **dois** agentes leem
por padrão desde a 4.11 — o dossiê do extrator (§4.14) e o catálogo do agente 2
(§4.8). Até aqui eles liam coisas diferentes da mesma entidade: o extrator via só
`contexto`, escolhido em código entre os três, e o agente 2 via os três campos
inteiros de **todas** as entidades em toda chamada. Uma apresentação só, nos dois
lugares.

O teto de 500 não é estética, e é o mesmo argumento que a 005 usou com 300: sem
teto, o custo de todo prompt passa a depender do tamanho de cada ficha, e uma
entidade muito falada empurra as outras para fora do contexto. 300 era pouco para
um retrato — e este campo cobra sozinho o que antes se cobrava dos três juntos.
O corte é no servidor (`gravarResumo`), como o do perfil era.

**Resumo vazio é estado válido, e não ganha fallback.** É como toda entidade
nasce. A entidade sem resumo entra no prompt com nome, tipo e grafias e mais
nada; o agente devolve confiança baixa, a confiança baixa dispara a segunda
passada, e a segunda passada carrega o perfil inteiro — que é exatamente o que o
agente 2 lia antes desta fatia. Entre a 4.11 e a 4.12 essa passada vai ser a
regra, e isso é **comportamento esperado** (§14): a frequência cai sozinha
conforme os resumos forem escritos.

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

**O `TETO_PERFIL` de 300 saiu** com esta migration, e é ela que o mata. O motivo
declarado na 005 era o consumo do agente 2 — "os três campos de todas as
entidades entram no prompt de resolução, e sem teto o custo cresce com o grafo".
A partir da 4.11 os três campos **não entram mais no caminho comum**: eles só
aparecem na segunda passada, para os poucos candidatos de uma menção em dúvida.
O motivo do teto deixou de existir, e o teto com ele.

Contrato completo de `:Entidade` depois da 009:

```
(:Entidade { id, nome, nome_normalizado, criado_em, status,
             contexto, pode_ajudar_com, fizemos_juntos,
             embedding, embedding_modelo, embedding_fonte,
             resumo, aliases, canonico })
status ∈ 'ativa' | 'fundida'
resumo   ≤ 500 (TETO_RESUMO)   aliases  lista   canonico  booleano
contexto, pode_ajudar_com, fizemos_juntos — SEM TETO a partir da 009

(:Entidade)-[:FUNDIDA_EM]->(:Entidade)   fusão de duas entidades reais   (004)
                                         — grafia de STT não usa mais    (009)
(:Entidade)-[:DISTINTA_DE]->(:Entidade)  recusa minha                    (004)
(:Atomo)-[:PERFILA { campo }]->(:Entidade)                               (005)
```

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

A 010, como a 005 e a 007, **não tem statement nenhum**: propriedade de valor
livre não se declara no Aura Free. Ela existe porque `db/migrations/` é a
definição canônica do schema e o contrato mudou. **Sem migração de dado** —
nenhuma ficha existente é tocada, e entidade sem `enriquecimento_estado`
simplesmente nunca foi enriquecida, que é o estado de todas elas no dia em que a
migration foi escrita.

**Todos ausentes contam como vazio na leitura**, pela mesma razão do `status` na
004 e do perfil na 005: a defesa vale para o nó que um deploy antigo criar
amanhã, não só para os que existem hoje. Estado que o código não conhece é lido
como "nunca enriquecida", e não como erro.

**Os quatro `_anterior` são o desfazer** (§4.9), e são a razão de esta fatia ter
migration própria em vez de caber na 009: eles existem porque alguma coisa passou
a escrever a ficha sem eu ver antes.

**O estado da fila mora no nó, e não no R2**, ao contrário do acumulado de uma
sessão (§9). Lá a razão é a regra 5 — nada entra no grafo antes da revisão. Aqui
a entidade **já está** no grafo, e o que a fila guarda é sobre ela, não é
proposta de conteúdo nenhum. É esse estado que faz "fechar a aba não interrompe
nada" ser verdade: o elo seguinte lê o banco, não o navegador.

**Sem índice**, como o perfil e o resumo: a fila é varrida sobre o catálogo que
`listarEntidades()` já carrega inteiro, e o Aura Free tem cota de índice. É mais
um lugar que pediria índice no dia em que o catálogo não couber na memória de uma
função (§14).

Contrato completo de `:Entidade` depois da 010:

```
(:Entidade { id, nome, nome_normalizado, criado_em, status,
             contexto, pode_ajudar_com, fizemos_juntos,
             embedding, embedding_modelo, embedding_fonte,
             resumo, aliases, canonico,                            (009)
             resumo_anterior, contexto_anterior,
             pode_ajudar_com_anterior, fizemos_juntos_anterior,    (010)
             enriquecimento_estado, enriquecimento_motivo,
             enriquecimento_em, enriquecimento_atomos })           (010)
```

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
(`0adada47`, Neo4j 5.27-aura) em 2026-09-02: `CREATE` aceito, `ONLINE` em menos
de 500 ms, `db.index.vector.queryNodes` devolvendo vizinhos com score. A doc
negava só "Vector Optimization" (configuração ≥ 4 GB), que é outra coisa. **E a
cota do Free não é medida em bytes**: o teto publicado é de 200 mil nós e 400 mil
arestas, e embedding é propriedade em nó que já existe — não cria nó nem aresta.
Com 4.000 átomos o grafo vai a ~4.050 nós, 2% do teto.

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

**Quem faz essa próxima passada acontecer** (4.8.1), toda em `waitUntil` e toda
engolindo a falha com `[entidades]` no log:

| Call site | Por que ali |
|---|---|
| `POST /api/sessoes/:id/confirmar` | depois de `gravarAtomos`, junto do `capturarCorrecoes` — é onde nascem as entidades novas |
| `POST /api/entidades/perfil` | o que mais muda a string canônica |
| `POST /api/entidades/renomear` | nome novo e alias novo, dos dois lados |
| `POST /api/entidades/fundir` | o vencedor ganha alias, e alias entra na fonte |
| `POST /api/entidades/tipo` | o tipo entra na fonte |
| `POST /api/entidades/criar` | é o passo zero: o nó semeado à mão só entra na 3a com vetor |

Até a 4.8 o único chamador era `POST /api/entidades/embutir`, **que nenhuma tela
chama** — a varredura de `fetch("/api/…")` em `src/` dá 30 chamadas e nenhuma é
essa —, e não há cron nem `waitUntil` em lugar nenhum apontando para lá. Ou
seja: a "próxima passada" descrita neste parágrafo não existia. Entidade nascida
num confirmar ficava sem vetor para sempre, e a camada 3a (4.10) era código que
não podia achar nada.

O argumento que recusava o gancho continua escrito acima e continua bom — um
lugar a mais onde alguém esquece de invalidar. Ele não se aplica **porque o
gancho não invalida nada**: quem decide é o hash. Esquecer um call site custa
atraso, não vizinhança errada, porque a próxima passada de qualquer outro
alcança. E rodar com nada fora de dia custa uma consulta e zero chamada de
modelo, o que é o que permite chamar à toa.

O teto de `limite = 500` de `garantirEmbeddings()` fica: grafo maior que isso é
problema de outra fatia, e a rota manual continua existindo para o retrofill.

**Sem migração de dado**: nenhum vetor é calculado pela migration. Quem preenche
são `POST /api/atomos/embutir` e `POST /api/entidades/embutir` — e, desde a
4.8.1, os seis call sites da tabela acima. É isso que faz o retrofill custar uma
chamada de rota em vez de uma reextração.

Contrato completo depois da 006:

```
(:Atomo    { id, texto, tipo, inicios_s, fins_s, ancoras, valido_em, status,
             prompt_version, modelo, criado_em,
             embedding, embedding_modelo })                              (006)
(:Entidade { id, nome, nome_normalizado, criado_em, status,
             contexto, pode_ajudar_com, fizemos_juntos,
             embedding, embedding_modelo, embedding_fonte })             (006)
```

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

Contrato completo do que esta migration acrescenta:

```
(:Atomo { …,
          confronto_estado, confronto_em,
          confronto_execucao, confronto_motivo })                        (011)

(:Atomo mais_novo)-[:ATUALIZA|:CONTRADIZ|:CONFIRMA|:COMPLEMENTA
  { execucao, motivo, confianca,
    criado_em, modelo, prompt_version }]->(:Atomo mais_antigo)            (011)
```

### 8.6 A conversa, e o primeiro label solto do grafo (migration 012)

Slice 6. **Proposta — não rodada.** Como a 005, a 007, a 008, a 010 e a 011, ela
não tem statement nenhum: propriedade de valor livre não se declara no Aura Free
(constraint de existência é Enterprise) e índice novo não entra por cota (§14).
`scripts/migrate.ts` conta 0 statement(s) e segue. Ela existe porque
`db/migrations/` é a definição canônica do schema e o contrato do grafo mudou.

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
é metadado de aplicação, como `:Sessao`. Uma conversa enxerga o grafo pelas duas
ferramentas do agente `chat`, nunca por aresta própria; e **uma conversa nunca
enxerga outra**. Conversas virarem fonte de busca umas das outras — uma terceira
ferramenta, com embedding nas mensagens — foi considerado e recusado na
entrevista: nasceu de uma ambiguidade de linguagem, não de um pedido real.

**Sem índice, e nem constraint de unicidade em `id`.** `listarConversas` varre
`(:Conversa)` com `ORDER BY` e `LIMIT` sobre o grafo de uma pessoa só — a mesma
conta de `todasSessoes` (008). E, ao contrário de `:Sessao` (001), nada aqui faz
`MERGE` por id: a conversa nasce de um `CREATE` com id sorteado, e a unicidade
vem da origem. Um índice para proteger o que a origem já garante seria cota
gasta por simetria.

**`arquivada_em` ausente conta como ativa, na leitura** — mesma decisão do
`status` na 004, do perfil na 005 e do `descartada_em` na 008, e pela mesma
razão: a defesa vale para o nó que um deploy antigo criar amanhã, não só para os
que existem hoje.

**Esta é a única exceção à regra 6 do `CLAUDE.md` em todo o sistema**, e ela é
deliberada. A regra 6 fala de átomo: "deleção é soft, nunca `DELETE` em átomo".
Conversa não é átomo — não é conhecimento, é a transcrição de uma pergunta que
eu fiz a uma tela. Nada do grafo depende dela, nenhum átomo perde procedência
quando ela some, e o pedido da entrevista foi explícito em ter as **duas** ações
e não só uma: `arquivar` congela (`SET c.arquivada_em`), `apagar` apaga
(`DETACH DELETE` mais o objeto no R2). O `DETACH` é cinto de segurança, não
necessidade: o nó nasce sem aresta e deve morrer assim.

Contrato completo do que esta migration acrescenta — e nada do que já existia
muda:

```
(:Conversa { id, titulo, criado_em, atualizada_em,
             arquivada_em, mensagens_key })                              (012)
```

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

`dono` é o que mantém "uma geração" verdadeira (§4.15.3): desde que o átomo é
comparado também com os mais novos, a rodada dele escreve aresta que **chega**
a ele, e "apagar as de saída" deixaria de apagar o que ela escreveu.

Contrato completo depois desta migration:

```
(:Atomo mais_novo)-[:ATUALIZA|:CONTRADIZ|:CONFIRMA|:COMPLEMENTA
  { execucao, motivo, confianca, criado_em, modelo, prompt_version,     (011)
    camada, origem, dono, editado_em,                                   (013)
    original_tipo, original_camada, original_motivo }]->(:Atomo mais_antigo)

(:Atomo)-[:CONFRONTO_RECUSADO { em, tipo }]->(:Atomo)                   (013)
```


