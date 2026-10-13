# Slice 9 — A resposta vem antes do despejo

**Objetivo:** que o chat responda em vez de relatar. Hoje ele devolve um relatório
das buscas que fez; deve devolver a resposta, curta, com a data na frase, e o resto
atrás do (i) — que já guarda tudo. E que a busca pare de mentir por omissão: dizer
quanto cortou, e por que voltou vazia.

**Pronto quando:** eu pergunto "quais são minhas prioridades" e leio a resposta
inteira sem rolar a tela; ela diz o recorte que usou porque **recebeu o número**, e
não por chute; quando volta magra, o (i) me diz se foi o piso ou o filtro que
cortou; e quando eu pergunto por alguém, o agente alcança a ficha da pessoa em vez
de reconstruí-la relendo átomos.

## Por que agora

A slice 6 construiu o chat, a 8.1 consertou o teclado e a lista, a 8.2 mexeu na
tela em volta. O **miolo** nunca foi revisto: como a pergunta vira busca e como a
busca vira resposta. A 4.16.2 apertou o volume depois da primeira pergunta vaga de
verdade — piso de 0,30 para 0,45, doze átomos para oito —, e aquele aperto cuidou
de **quanto** vem. Esta fatia cuida de **o que se faz com o que veio**.

Três incômodos declarados, nesta ordem: a resposta em si; o tempo até ela; o que a
busca acha. O tom pedido é explícito — **conversacional e sucinto**.

E há um fato que empurra: `CHAT_MODEL` herda `modeloExtracao()`, que virou
`deepseek/deepseek-v4.1-flash` num commit que não falava do chat. O §14 já
registrava que tool-calling multi-passo nunca foi medido; agora o padrão herdado é
um modelo escolhido para devolver JSON curto, que não é a mesma habilidade.

## As decisões

### 1. A resposta para de fazer o trabalho do (i)

O `chat-2` manda três coisas que empurram para relatório — *"Cite as datas"*,
*"Cite no máximo cinco trechos"*, *"mostre os dois"* — e uma só que puxa para
curto, na forma mais fraca que existe: *"Sem lista com marcador **quando** duas
frases bastam"*, uma negativa condicional. Não há teto de tamanho e não há ordem,
então evidência e resposta saem misturadas.

O `chat-3` inverte: a resposta responde nas duas primeiras frases, antes de
qualquer evidência; tem teto de tamanho em número de frases, não em adjetivo;
prosa, e lista só se eu pedir nessas palavras; a data entra **dentro** da frase; e
o teto de cinco trechos vira um ou dois, porque a procedência inteira já mora no
(i).

**O que não muda:** bibliotecário atento e não coach, não inventar, mostrar as duas
pontas de uma contradição, segunda pessoa. É o `visao.md` §7 e ele não está em
questão — "sucinto" aqui é o oposto de "relatório", não de "com origem". O
princípio 4 do §5 continua valendo, e continua sendo cumprido: a origem não sai da
resposta, sai o bloco de citações.

Recusado: mexer no tom do §7 para soar mais conversacional. O que fazia a resposta
parecer relatório era o comprimento e a ordem, não a voz.

### 2. A busca diz o que cortou — e as três causas de vazio deixam de ser uma

`TETO_ATOMOS = 8` e o modelo nunca recebeu o total: uma pergunta sobre um mês com
trinta átomos vê oito e não sabe disso. O §14 chama isso de "conserto honesto não
feito", e o `chat-2` **já manda** dizer o recorte usado sem nunca dar o número com
que fazer isso.

Passa a dizer. E **os dois caminhos não contam a mesma coisa**, que é o detalhe que
erraria calado: sem `texto`, o total é do corpus; com `texto`, o `queryNodes` só
olha `K_BUSCA = 48` vizinhos, e escrever "8 de 34" ali seria trocar um silêncio por
uma mentira — o que se pode dizer é "8 dos 19 que passaram do piso, entre os 48
mais parecidos".

E `nenhum trecho encontrado` deixa de ser uma frase para três coisas diferentes:
nada passou do piso (com a melhor similaridade abaixo dele), passou e o filtro
cortou (com quantos passaram), ou nada mesmo. É onde mora a maior parte de "traz
pouco": o prompt manda *"alargar é só para o vazio"* sem nunca dizer de que vazio
se trata — e alargar o período é certo no segundo caso e inútil no primeiro.

Recusado: mexer em `PISO_BUSCA`. Ele foi calibrado contra medida de átomo contra
átomo (os 0,728 de `confronto.ts`), e busca de chat é pergunta contra átomo —
distribuição diferente e assimétrica. Os 0,728 não dizem nada sobre ela. O que
entra é o instrumento: quantos ficaram abaixo do piso e qual foi o melhor cortado,
no (i), ao lado da similaridade que ele já mostra. Quem decide o número sou eu,
olhando.

### 3. Uma terceira ferramenta, sobre a entidade — `buscar_entidades`

O chat só alcança a camada dos átomos. O índice `entidade_embedding` da migration
006 existe, a extração o usa, e o chat nunca o tocou. E a ficha inteira que as
slices 4.11 e 4.12 construíram — `resumo`, `contexto`, `pode_ajudar_com`,
`fizemos_juntos` — é **ilegível para o chat**: "quem pode me ajudar com X" só se
responde relendo átomos e re-deduzindo o que a ficha já diz por escrito.

`buscar_entidades({ nome?, texto?, tipo? })`: por nome com alias e grafia próxima,
por sentido sobre o vetor de perfil, filtrável por tipo. Devolve a ficha, as
contagens, e as entidades que **co-ocorrem**.

**Isto não reverte a decisão da slice 6.** O que aquela entrevista recusou foram
quatro fatias do **mesmo substantivo** — semântica, entidade, período, confronto,
todas sobre átomo — e o argumento era que parâmetro de lista ganha de ferramenta
separada. Esta é um substantivo diferente, com ficha própria, índice próprio e
contagens próprias.

Recusado: **uma ferramenta por label** (`buscar_projetos`, `buscar_pessoas`).
`:Projeto` já é um tipo de `:Entidade`; por label seria exatamente a decisão que a 6
recusou. É parâmetro.

Recusado: **travessia de grafo entre entidades**, que é o que "busca por projeto"
sugere. Não existe o que atravessar: `:ENVOLVIDA_EM`, `:CONTRIBUI_PARA`,
`:APONTA_PARA`, `:Foco` e `:Pergunta` estão no contrato resumido do `CLAUDE.md` e
**em nenhum outro lugar do repositório** — nenhuma migration os cria, nenhum código
os escreve. As únicas arestas entre duas entidades são `:FUNDIDA_EM` e
`:DISTINTA_DE`, que são escrituração de identidade, não sentido. Uma ferramenta que
andasse por elas voltaria vazia sempre, que é a armadilha que o §14 já registra
sobre `historico_do_atomo` e o confronto. O que funciona é co-ocorrência: os átomos
ligados à entidade, e quais outras entidades **esses átomos** citam.

Recusado: **injetar o catálogo de entidades no prompt**, que era a primeira ideia
para o mesmo problema. A §4.14 já decidiu essa pergunta contra o catálogo inteiro,
para o extrator. E o custo nunca foi o token — 43 entidades são ~300 tokens: é que
o catálogo dá ao modelo nomes que ele **não buscou**, enquanto o prompt inteiro se
apoia em *"você não sabe nada sobre esta pessoa que não tenha vindo de uma busca"*.
A ferramenta resolve o mesmo problema puxando em vez de empurrando.

### 4. O catálogo e o vetor da pergunta, lidos uma vez

Cada `buscar_atomos` com `entidade` chama `listarEntidades()` — o Cypher de quatro
`OPTIONAL MATCH` — e cada busca com `texto` chama `embutir()`. Com o teto de oito
chamadas, são até oito de cada por pergunta.

Um fecho por chamada de `responder()`, no molde de `catalogoUmaVez()`, memoiza os
dois. Ele nasce **fora** do laço de `comEsperaDeLimite`, ao contrário de `rastro` e
`vistos`: o grafo não muda no meio de uma pergunta, porque o chat não escreve.

E isso vale mais do que parece no caso do vetor: `embutir` **não tem escada de
repetição**, então um 429 no modelo de embedding faz toda busca com `texto` falhar
macia. Memoizar reduz a exposição de oito chamadas para uma.

Recusado: `umaVezPorInvocacao`. Ele hoje é **transparente no chat**, porque nenhuma
rota abre `comInvocacao` — só os três `waitUntil` do pipeline. Usá-lo exigiria
abrir esse contexto na rota e arrastar `configAgentes()` para dentro de um cache que
o `overrides.ts` avisa ser delicado: alcance grande para ganhar nada.

### 5. Busca paralela é autorizada, e o teto passa a ser piso

O SDK já agrupa várias chamadas de ferramenta num passo; o prompt nunca disse que
podia. Duas buscas que não dependem uma da outra passam a sair juntas.

**A consequência vai escrita:** `stopWhen` é avaliado **entre** passos, então um
passo com três chamadas paralelas parte de 7 e chega a 10. `TETO_FERRAMENTAS` deixa
de ser "no máximo 8" e passa a ser "pelo menos 8". Já era verdade; autorizar
paralelismo transforma o caso raro em caso comum. O transbordo é limitado e barato,
e documentá-lo basta.

Recusado: cortar o transbordo com `prepareStep`/`activeTools`. Custo de desenho para
um risco que não se manifestou.

### 6. O streaming do texto final é condicional, e vem por último

`responder()` usa `generateText`: o texto chega inteiro no fim, e a tela mostra
`"escrevendo…"` durante toda a síntese.

Trocar por `streamText` conserta a espera morta — mas não reduz latência nenhuma,
só espera percebida. E a espera que ele conserta **encolhe junto com a resposta**:
se a decisão 1 levar a resposta de seiscentas para noventa palavras, o streaming
passa a consertar poucos segundos ao custo do passo mais arriscado da fatia.

Pior: um modelo que escreve a resposta na parte de raciocínio — o modo de falha
mais visto neste projeto — emite **zero** delta de texto, e o streaming entrega
exatamente a tela de hoje mais o código todo.

Então: **decide-se depois**, com o tempo medido na mão e o modelo já escolhido. Se
não valer, fica na gaveta, e esta spec registra o critério em vez de a fatia inteira
ficar esperando por uma decisão que só a medida pode tomar.

> **Decidido em 23/09: não acontece.** Sem medir: o streaming fica na gaveta, e a
> fatia fecha sem ele. Está tudo bem a resposta chegar inteira no fim — a
> decisão 1 encurta a espera que ele consertaria, e o risco do modo de falha do
> raciocínio fica de fora junto. O critério acima continua escrito para o dia em
> que a espera voltar a doer.

### 7. `CHAT_MODEL` passa a ter valor explícito, e é medido antes de tudo

O motivo não é qualidade, é acoplamento: hoje trocar o modelo da extração **muda a
resposta do chat em silêncio**.

E a medição vem **antes de qualquer linha de código**, porque é o único passo desta
fatia que se mede sem deploy: `/agentes/consulta` grava override de modelo, e
`efetivo("chat", …)` o relê a cada pergunta. As cinco perguntas reais que a
entrevista da 6 nomeou, por candidato, olhando no (i) quantas chamadas foram gastas
e no log se o texto vazou para o raciocínio.

É a medida que decide a decisão 6, e é pré-requisito da decisão 3: ir de duas para
três ferramentas num modelo que já encadeia mal piora a resposta em vez de melhorar.

## O que muda no sistema

- **O prompt do chat vira `chat-3`**, e a seção `COMO RESPONDER` é reescrita. O
  envelope validado por `POST /api/agentes/:id` passa a exigir também o nome da
  ferramenta nova.
- **As duas Cypher de `buscar_atomos` passam a contar**, e a pendurar as entidades
  **depois** do `LIMIT` em vez de antes — hoje os dois `OPTIONAL MATCH` rodam sobre
  todo átomo que passou no filtro, e limitar primeiro faz esse trabalho cair para
  oito nós. Latência de graça, no mesmo commit.
- **`ResultadoDeBusca` e `PassoDeFerramenta` ganham campos**, todos opcionais —
  então mensagem antiga no R2 continua legível sem retrofill.
- **O (i) mostra o recorte e a duração de cada passo.** É o instrumento desta fatia;
  `medidas.ts` não serve, e é por desenho — `comMedicao` é chaveado por `sessao_id`,
  e o chat não tem sessão.
- **Uma ferramenta nova**, e é a primeira vez que o chat lê a camada de entidade.
- **Nenhuma migration.** Nada aqui toca label, propriedade, índice ou constraint; as
  Cypher novas são de leitura sobre o que já existe.

> **Decidido em 23/09: o valor explícito entra, a medição não.** O padrão virou
> `MODELO_CHAT_PADRAO = "deepseek/deepseek-v4.1-flash"` — o mesmo id que o chat
> já herdava, agora desacoplado da extração, que era o motivo declarado da
> decisão. As cinco perguntas por candidato não foram feitas, e as decisões 3 e
> 6 não esperaram por elas: a 3 foi construída mesmo assim, e a 6 foi
> descartada. O risco fica registrado em "Limites" — se o modelo encadear mal,
> a terceira ferramenta piora a resposta, e o conserto é `CHAT_MODEL` ou o
> painel de `/agentes`, sem deploy.

## O escopo

### Entra

As decisões 1 a 5 e 7 — a 7 sem a medição (ver a nota dela). A decisão 6 era
condicionada à medida, e foi descartada em 23/09.

### Não entra

- **O catálogo de entidades no prompt** — substituído pela decisão 3.
- **Travessia de grafo entre entidades** — não há o que atravessar.
- **Mexer em `PISO_BUSCA`, `TETO_ATOMOS`, `K_BUSCA` ou `TETO_FERRAMENTAS`** —
  instrumento sim, número não.
- **Dar teto de 90 s à chamada do chat.** Tentador, porque é a causa de uma tela
  pendurada até os 300 s do `maxDuration` — mas mexe na decisão documentada em
  `limite.ts` e no cancelamento do botão de parar, duas coisas de uma vez. Se a
  medida da decisão 7 mostrar chamada pendurada, é emenda própria.
- **`medidas.json` para o chat** — fatia própria, se um dia.
- **Orçamento por conversa ou por dia** — o teto continua sendo por mensagem.
- **Resumir ou podar conversa longa** — continua fora, como na 6.
- **Editar mensagem enviada ou regenerar resposta** — continua não pedido.
- **Escrita no grafo pelo chat** — nunca, nem por ferramenta. A regra 5.
- **Migration.**

## Limites que esta fatia cria

- **O total do caminho vetorial conta dentro da janela de `K_BUSCA`, não do
  diário.** Com o corpus medido em 18/09 — 108 átomos — 48 é quase metade e o número
  é praticamente honesto; ele fica aproximado quando o diário crescer, e é aí que a
  frase do (i) precisa mudar junto.
- **`TETO_FERRAMENTAS` passa a ser piso, não teto** (decisão 5). Uma pergunta pode
  gastar dez chamadas onde o número escrito diz oito.
- **Com chamadas paralelas, qual busca mostra o átomo repetido fica
  indeterminado.** O `Set` de vistos é mutado concorrentemente, então qual das duas
  diz "já mostrado acima" varia. É cosmético, o (i) não é afetado, e a consequência
  prática é que **não se escreve teste sobre isso** — ele ficaria intermitente.
- **`buscar_entidades` vale o que a ficha tem dentro.** O `resumo` nasceu vazio de
  propósito na 4.11, e quem o preenche é o agente 4 da 4.12, que nunca foi medido
  numa sessão real. Ficha vazia faz a ferramenta custar uma chamada para devolver
  casca — e aí o conserto é rodar o lote de enriquecimento, não mexer nela. Isso se
  olha em `/entidades` antes de escrever a primeira linha dela.
- **Três ferramentas disputam mais atenção do modelo que duas.** Se o candidato
  escolhido na decisão 7 encadear mal, a ferramenta nova piora a resposta em vez de
  melhorar, e o conserto é o modelo ou o prompt, não remover a ferramenta.
- **Se a decisão 6 acontecer:** resposta parcialmente transmitida e interrompida
  **não é gravada** — o texto fica na tela até a próxima abertura da conversa, como
  a pergunta otimista já fica hoje. Hoje o contrato é binário, resposta completa
  gravada ou nada; o streaming introduz texto na tela que não está gravado em lugar
  nenhum. E o preview pode mostrar mais do que ficou gravado, se o modelo escrever
  texto num passo intermediário — mitigado pelo `chat-3` proibir preâmbulo.
- **Nada aqui foi medido contra gabarito, e não pode ser.** `CLAUDE.md` é explícito:
  quem julga qualidade de resposta sou eu, na tela, pergunta real por pergunta real.
  Os testes desta fatia são todos de mecanismo.

## Como ficou

O que o `ARCHITECTURE.md` contava desta fatia — datas, medições, o que era
antes —, movido quase literal quando ele passou a descrever só o presente
(`Specs/documentacao.md`).

### Do cabeçalho do `ARCHITECTURE.md`

**A slice 9 está construída, e sobe em partes.** A fatia (`Specs/slice-9.md`) é
o miolo do chat — como a pergunta vira busca e como a busca vira resposta. Em
quatro commits, cada um ponto de retorno: o prompt responde antes de despejar e
autoriza busca paralela (`chat-3`); o chat tem padrão de modelo próprio
(`MODELO_CHAT_PADRAO`); a busca diz quanto cortou e de que vazio se trata, o (i)
mostra o recorte e a duração de cada passo, e catálogo e vetor são lidos uma vez
por pergunta (`chat-4`); e a terceira ferramenta, `buscar_entidades`, lê a ficha
da entidade (`chat-5`, §4.16.2). **Não aconteceram, por decisão minha:** a
medição de `CHAT_MODEL` antes de fixar o padrão, e o streaming do texto final —
a resposta mais curta encolhe a espera que ele consertaria. Nada disto foi
julgado numa pergunta real ainda; é o que falta.

### Do §14 (limites conhecidos)

- **E o teto de oito é piso, não teto exato** (slice 9). `stopWhen` é avaliado
  entre passos, então um passo com três chamadas paralelas parte de 7 e termina em
  10. Sempre foi possível; o `chat-3` manda usar busca paralela e transforma o caso
  raro em comum. O transbordo é limitado pelo tamanho de um passo, e foi
  documentado em vez de cortado (§4.16.1).

- **`CHAT_MODEL` precisa de tool-calling multi-passo bom pelo Gateway, e isso
  não foi medido** (slice 6). Desde a slice 9 o padrão é **constante própria**
  (`MODELO_CHAT_PADRAO`), e não mais herança da extração: a troca de 20/09 mudou
  a resposta do chat num commit que não falava do chat. O id continua sendo
  `deepseek/deepseek-v4.1-flash` — escolhido para devolver JSON curto, que não é
  a mesma habilidade —, e continua escolha sem medição: a spec da 9 pedia medir
  cinco perguntas reais por candidato antes de fixar, e eu decidi fixar sem
  medir. Se ele encadear mal, o conserto é `CHAT_MODEL` ou o painel de
  `/agentes`, sem deploy; qual modelo serve continua pergunta aberta.

- **O total do caminho vetorial conta dentro da janela de `K_BUSCA`, não do
  diário** (slice 9). O "sem dizer que cortou" da slice 6 está resolvido — as
  duas Cypher contam, e o modelo lê o número antes dos trechos (§4.16.2) —, mas
  com `texto` a conta é de quantos dos 48 vizinhos passaram. Com 108 átomos
  (18/09) a janela era quase metade do diário; em 23/09 já eram 151, e ela é um
  terço. A linha diz isso com todas as letras ("não no diário inteiro"); quando o
  diário crescer mais, é o texto dela e o `K_BUSCA` que se revisitam juntos.

- **`buscar_entidades` vale o que a ficha tem dentro** (slice 9). Em 23/09, 2 das
  51 entidades ativas tinham `resumo`, 2 tinham `contexto`, 1 tinha
  `pode_ajudar_com`. Ficha vazia faz a ferramenta custar uma chamada para
  devolver casca — nome, contagens, datas e quem co-ocorre —, e o caminho por
  `texto` quase só acha pelo nome, porque é só o nome que está no vetor. O
  conserto é rodar o lote de enriquecimento em `/entidades` (4.12), não mexer
  na ferramenta; o agente 4 que escreve as fichas nunca foi medido numa sessão
  real.

- **Um prompt do chat editado em `/agentes` antes da slice 9 não conhece o que
  ela trouxe.** O override guardado no R2 vence o `chat-5` do código: a linha de
  recorte continua saindo da busca, e `buscar_entidades` continua oferecida,
  mas sem as instruções de como ler uma nem quando usar a outra.

- **O piso de 0,45 e o teto de 8 não foram medidos contra gabarito** (slice 6, e
  não podiam ser: `CLAUDE.md` diz que quem julga extração aqui sou eu, na tela).
  O que existe é uma medida emprestada — os 0,728 da varredura de confronto, em
  4.15, que é átomo contra átomo e não diz nada sobre pergunta contra átomo — e
  uma pergunta real que ficou ruim. Desde a slice 9 o instrumento está no (i):
  por passo, quantos passaram do piso, quantos ficaram abaixo e o melhor
  cortado.

### Do §4.1–4.7 (o pipeline)

| `modeloChat()` | `chat-7` | `deepseek/deepseek-v4.1-flash` — próprio desde a slice 9 |

### Do §4.16 (o chat)

**Oito é piso, e não teto exato — desde que a slice 9 autorizou busca paralela.**
`stopWhen` é avaliado **entre** passos, então um passo que pede três chamadas de uma
vez parte de 7 e termina em 10. Isso já era possível antes (o SDK sempre pôde
agrupar), mas o `chat-2` nunca dizia que podia, e o caso era raro; o `chat-3` manda
fazer, e o caso vira comum. O transbordo é limitado pelo tamanho de um passo e
barato, e por isso está documentado em vez de cortado — cortá-lo pediria
`prepareStep` ou `activeTools`, custo de desenho para um risco que não apareceu.

##### `chat-3`: a resposta para de fazer o trabalho do (i) (slice 9)

O aperto acima cuidou de **quanto** material vem da busca. O que sobrou errado era
o que a resposta fazia com ele: saía um relatório das buscas, e não uma resposta.

O `chat-2` empurrava para esse registro em três instruções — *"Cite as datas"*,
*"Cite no máximo cinco trechos"*, *"mostre os dois"* — e puxava para curto em uma
só, na forma mais fraca que existe: *"Sem lista com marcador **quando** duas frases
bastam"*, uma negativa condicional que autoriza a lista por omissão. Não havia teto
de tamanho nem ordem, então evidência e resposta saíam misturadas. E "cite no
máximo cinco" era lido como cota: cinco.

O `chat-3` inverte a seção `COMO RESPONDER`:

- **a resposta responde nas duas primeiras frases**, antes de qualquer evidência, e
  sem preâmbulo nem repetição da pergunta — os passos na tela já disseram que
  procurou;
- **teto em número de frases**, não em adjetivo. "Prosa curta" não é teto;
- **prosa, e lista só se eu pedir com essas palavras** — a permissão deixou de ser
  por omissão;
- **um trecho, no máximo dois**, e a justificativa entra no próprio prompt: a
  procedência inteira mora no (i), e a resposta estava duplicando o (i) em prosa;
- **a data entra dentro da frase**, não num bloco de citações.

**O tom do `Specs/visao.md` §7 não mudou, e o princípio 4 do §5 continua cumprido.**
Bibliotecário atento e não coach, não inventar, mostrar as duas pontas de uma
contradição: tudo fica. "Sucinto" aqui é o oposto de "relatório", não de "com
origem" — o que saiu da resposta foi o bloco de citações, não a origem, porque a
origem tem um lugar melhor desde a slice 6.

**E o `chat-3` autoriza busca paralela**, que o `chat-2` nunca disse que podia
embora o SDK já agrupasse: duas buscas que não dependem uma da outra saem no mesmo
passo. Junto vem o número que faltava — a maioria das perguntas se resolve em uma
ou duas buscas, e mais de três é sinal de varredura. Ver o transbordo do teto em
§4.16.1.

**Ficou de fora de propósito**: a instrução para o modelo ler a linha de recorte da
busca (`8 de 34 trechos`). Ela vai no `chat-4`, junto com a mudança que faz essa
linha existir — instrução sobre saída que ainda não existe é texto morto, e
atrapalharia o julgamento à mão que decide se o `chat-3` melhorou a resposta.

##### `chat-4`: a busca diz o que cortou, e de que vazio se trata (slice 9)

`TETO_ATOMOS = 8` e o modelo nunca recebia o total: uma pergunta sobre um mês com
trinta átomos via oito e não sabia disso. O `chat-2` já mandava dizer o recorte
usado, sem nunca dar o número com que fazer isso. Agora **as duas Cypher de
`buscar_atomos` contam**, e o que volta ao modelo começa por uma linha de recorte
(`linhaDoRecorte`), antes dos trechos.

O `chat-2` mandava "alargar é só para o vazio" sem nunca dizer de que vazio se
tratava, e era ali que morava boa parte de "traz pouco". O `chat-4` dá o nome de
cada um e o gesto que cabe a ele, e manda usar **o número da busca** quando disser
o recorte na resposta — nunca estimativa, e nunca "do diário inteiro" quando a
conta foi dentro da janela.

**As entidades se penduram depois do corte.** Antes, os dois `OPTIONAL MATCH` de
`ENTIDADES_DE` rodavam sobre **todo** átomo que passava no filtro e o `LIMIT`
jogava o trabalho fora no fim; agora a lista é cortada em `[0..$limite]` e só os
mostrados ganham `sobre`/`cita`. Latência de graça, no mesmo commit.

**`PISO_BUSCA` não mudou, e isso é decisão.** Os 0,45 foram alinhados com uma
medida de átomo contra átomo (os 0,728 de `confronto.ts`); busca de chat é
pergunta contra átomo, distribuição diferente e assimétrica, e aquela medida não
diz nada sobre ela. O que entrou foi o **instrumento**: o (i) mostra, por passo, o
piso, quantos passaram, quantos ficaram abaixo e o melhor cortado, ao lado da
similaridade que cada achado já mostrava (`fraseRecorte`, em `Chat.tsx`). Quem
decide o número é o dono do diário, olhando isso. Verificado contra o Aura em
23/09 com o vetor de um átomo real: 42 dos 48 vizinhos acima de 0,45, o melhor
cortado em 0,449 — e com um filtro impossível, `acima_do_piso = 42` e `total = 0`,
o caso "o filtro cortou" separado do "nada passou do piso".

**O (i) ganhou também a duração de cada passo** (`duracao_ms`). `medidas.ts` não
serve aqui, e é por desenho: `comMedicao` é chaveado por `sessao_id`, e o chat não
tem sessão.

`RecorteDaBusca` e os dois campos novos de `PassoDeFerramenta` (`recorte`,
`duracao_ms`) são **opcionais**: mensagem gravada no R2 antes da slice 9 continua
legível sem retrofill — o (i) dela mostra "8 trechos" como sempre mostrou.

##### O catálogo e o vetor, lidos uma vez por pergunta (slice 9)

Cada `buscar_atomos` com `entidade` chamava `listarEntidades()` — o Cypher de
quatro `OPTIONAL MATCH` — e cada busca com `texto` chamava `embutir()`. Com o teto
de oito chamadas, eram até oito de cada por pergunta.

##### A terceira ferramenta: `buscar_entidades` (slice 9, `chat-5`)

```
buscar_entidades({ nome?, texto?, tipo?: TipoEntidade })
```

Até aqui o chat só alcançava a camada dos átomos. A ficha que as slices 4.11 e
4.12 construíram — `resumo`, `contexto`, `pode_ajudar_com`, `fizemos_juntos` — era
**ilegível para ele**: "quem pode me ajudar com X" só se respondia relendo átomos
e re-deduzindo o que a ficha já diz por escrito. O índice `entidade_embedding` da
migration 006 existia, a extração o usava, e o chat nunca o tocou.

**O piso do caminho por texto é o `PISO_PERFIL` (0,34) da resolução, e não o
`PISO_BUSCA`.** É a mesma espécie de comparação — texto corrido contra a string
canônica curta de uma entidade, assimétrica, que pontua sistematicamente menos
que átomo contra átomo. Nenhum dos dois foi medido contra pergunta de chat; o
recorte vai para o (i) como na busca de átomos, com o melhor cortado. Conferido
contra o Aura em 23/09 com o vetor de um átomo real sobre a Isinha: 47 vizinhos,
três acima de 0,34, a Isinha em primeiro com 0,60.
