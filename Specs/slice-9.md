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
