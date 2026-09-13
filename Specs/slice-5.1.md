# Slice 5.1 — Confronto calibrado: entidade no prompt, lote, e piso do COMPLEMENTA

**Objetivo:** consertar o que a primeira revisão à mão da slice 5 mostrou — as
relações que o agente escreveu sozinho no grafo de produção, lidas uma a uma —
e, no mesmo movimento, tirar do desenho a redundância de 3,3× que a medição
expôs.

**Pronto quando:** eu aperto "reprocessar tudo" em `/confronto`, a varredura
roda de novo com o prompt novo, e as cinco ligações que eu reprovei não voltam —
sem levar junto as dezesseis que eu aprovei.

## Por que agora

A slice 5 foi construída, aprovada (migration 011 no build de 13/09) e **medida
em uso real**: 58 átomos processados, 21 relações escritas, todas revisadas por
mim, uma a uma. Cinco reprovadas. Esta fatia é a resposta a essa medição — o
ciclo que o `CLAUDE.md` descreve ("quando a saída está ruim, o que se ajusta é o
prompt, e quem diz que está ruim sou eu") acontecendo pela primeira vez sobre o
`confronto`.

**As cinco reprovadas, e o que cada uma revelou:**

| Par | Veredito meu | Mecanismo |
|---|---|---|
| `94 → 57` | devia ser `CONFIRMA` | `CONFIRMA` estava definido estreito demais ("repete sem acrescentar nada"), então corroboração com fato novo escapava para `COMPLEMENTA` |
| `93 → 81` | não devia existir | **mesma gente, mesmo dia** — o único elo é Augusto e Débora aparecerem nos dois; o antigo é uma `ROTINA` ("no geral foi um bom dia"), que casa por vetor com tudo daquele dia |
| `99 → 38` | não devia existir | **referente presumido** — supôs que "a ideia do negócio"/Murta é a startup das petroleiras |
| `101 → 21` | não devia existir | **referente presumido** — supôs que "a conversa sobre a empresa" é a Behring Founders |
| `29 → 4` | não faz sentido | **abstração inventada** — o `motivo` do próprio modelo diz "generaliza a percepção antiga"; ele criou um tema ("máscara de força") e ligou por ele |

**Todos os cinco são `COMPLEMENTA`.** As seis relações que não são `COMPLEMENTA`
(1 `ATUALIZA`, 2 `CONFIRMA`, 3 `CONTRADIZ`) passaram inteiras.

## O que foi medido, e o que a medição descartou

Antes de propor conserto, dois botões óbvios foram medidos contra os dados
reais e **recusados**:

| Botão | Por que não |
|---|---|
| Subir `PISO_CONFRONTO` (0,45) | Está **inerte**: o par menos parecido dos 21 tem similaridade 0,728 — o piso nunca cortou nada, quem seleciona é o top-8 do índice. E um piso em 0,77, que mataria as cinco reprovadas, levaria junto duas das três `CONTRADIZ` aprovadas (0,733 e 0,769) |
| Piso de confiança **global** | Não separa: das reprovadas, três estão em 0,6 e duas em 0,7 — mas há três `COMPLEMENTA` aprovadas em 0,6 e três em 0,7 |

O que sobrou, e o que esta fatia faz: **prompt, informação e piso por tipo.**

E uma medida que decidiu o desenho do lote:

| Medida | Hoje |
|---|---|
| Chamadas por varredura completa | 39 (19 dos 58 átomos não têm candidato e não vão ao modelo) |
| Pares julgados | 115 |
| Texto de candidato enviado | 47.322 chars — dos quais só **14.431 são distintos** |
| Texto do grafo inteiro | ~23 mil chars (~6 mil tokens) |
| Nomes de entidade do grafo inteiro | **700 chars** |

O desenho de hoje manda o mesmo texto de candidato **3,3 vezes**. A informação
de entidade que conserta os dois erros de referente custa 700 caracteres no
grafo todo — o lote paga a própria conta com folga.

## As decisões

| Decisão | Escolhido | O que foi recusado, e por quê |
|---|---|---|
| **`CONFIRMA`** | **corrobora**: o novo sustenta ou valida a afirmação antiga — repetindo-a, **ou** trazendo evidência/resultado que mostra que ela se cumpriu | Manter "repete sem acrescentar nem mudar nada" foi recusado — é uma definição que quase nunca casa com fala real, e empurrava toda corroboração para `COMPLEMENTA`, que é justamente o tipo que está ruidoso |
| **`COMPLEMENTA`** | **fica, com piso de confiança próprio** e definição apertada | Remover o tipo foi considerado e recusado — ele acerta em `63→27` e `64→27` (a continuação da história da menina do rock), que eu aprovei. Deixar como está também: é a origem de 100% dos erros |
| **Piso do `COMPLEMENTA`** | `limiar` do agente, editável em `/agentes` — mesma peça da resolução (4.11), começando em **0,7** | Constante fixa em código foi recusada: o piso vai precisar de recalibração à mão, e recalibrar não pode ser deploy. Piso global, para todos os tipos, foi recusado pela medição acima |
| **O que mais entra no prompt** | **entidades ligadas, por nome** (`SOBRE` e `MENCIONA`), sem o `"eu"` | Sessão de origem foi recusada — "mesma sessão/mesmo dia" é exatamente a pista falsa que produziu `93→81`. Resumo da entidade foi recusado por ora: é o item caro e cresce com o número de entidades citadas |
| **Como a entidade é usada** | só para **barrar** suposição de referente — nunca para justificar ligação | Deixar o modelo tirar suas conclusões da lista foi recusado com evidência: `93` e `81` **compartilham** Augusto e Débora, então a lista ingênua pioraria esse falso positivo. Já `99`/`38` e `101`/`21` não compartilham nada além de "eu" |
| **Forma do lote** | **N alvos por chamada, com acervo numerado compartilhado** — cada texto uma vez só, depois a lista de pares a julgar. N = 10 de partida | Uma chamada por sessão foi recusada — tamanho variável, e um átomo antigo candidato de várias sessões volta a repetir entre chamadas. Tudo numa chamada só foi recusado — cabe hoje (~6 mil tokens) e quebra sozinho no primeiro ano de uso (~3.900 átomos) |
| **Falha no lote** | os N caem juntos em `falhou`, com o mesmo motivo, e voltam na varredura seguinte | Tentar salvar individualmente os alvos que vieram no JSON foi recusado — complica o parser para cobrir um caso que a retentativa já cobre de graça (regra 4) |
| **As 21 relações de hoje** | **botão "reprocessar tudo"** em `/confronto` | Limpar por script uma vez foi recusado — o prompt vai mudar de novo a cada recalibração, e isso faz do script um passo manual permanente. "Só daqui pra frente" foi recusado: perderia o único gabarito que existe, que são justamente esses 21 pares já julgados por mim |

## 1. Schema — nenhuma migration

**Esta fatia não muda o grafo.** As quatro relações, suas propriedades e os
quatro campos de controle em `:Atomo` são exatamente os da migration 011; o
`limiar` do agente mora no R2 (`overrides.ts`), como o dos outros. Não há
migration 012 nesta fatia — a próxima numerada continua sendo a da slice 6.

## 2. O prompt: `confronto-2`

Reescrito inteiro (`INSTRUCOES` em `src/lib/confronto.ts`), com
`PROMPT_VERSION_CONFRONTO` subindo para `confronto-2` — regra 7, e é o que faz
as relações novas serem distinguíveis das velhas no grafo.

O que muda de substância:

- **`NENHUMA` primeiro, e declarada como a resposta mais comum** — ela abre a
  lista de opções em vez de fechá-la;
- **o portão explícito**: antes de escolher um tipo, o modelo tem de conseguir
  dizer, numa frase, **qual afirmação específica os dois trechos têm em comum**,
  com palavras que apareçam nos **dois**. Não conseguiu, é `NENHUMA`;
- **o que não é motivo, dito por extenso**: mesma pessoa, mesma entidade, mesmo
  dia, mesma sessão, mesmo tema, mesmo padrão emocional. O diário é meu e quase
  todo trecho é sobre mim — semelhança de assunto é o normal, não é evidência;
- **proibido presumir referente**: "a empresa", "o negócio", "ela", "aquilo" só
  valem como a mesma coisa quando **os dois** trechos a nomeiam. As entidades
  ligadas estão ali para isso;
- **proibido generalizar**: o modelo não pode inventar um tema, um padrão ou uma
  leitura psicológica que ligue os dois trechos. Se a ligação precisa de uma
  frase que nenhum dos dois diz, é `NENHUMA`;
- **`CONFIRMA` redefinido** como corroboração (acima);
- **`COMPLEMENTA` apertado**: mesmo fato, episódio ou decisão **específica**,
  dito explicitamente nos dois — e o novo acrescenta algo **sobre aquilo**.

## 3. A apresentação do átomo, e o lote

**Cada átomo aparece assim**, uma vez só, no acervo numerado:

```
7. [SENTIMENTO 2026-09-09 · sobre: — · cita: —] Depois da conversa sobre a empresa...
3. [FATO 2026-09-01 · sobre: Behring Founders] Eu me inscrevi para a Behring Founders...
```

`"eu"` não é listado: ele é `SOBRE` em quase todo átomo do diário, e listá-lo só
ensinaria o modelo que "entidade em comum" é barato. Um átomo sem entidade
nomeada mostra `—`, e é **esse contraste** que desfaz `101→21`.

**O lote** leva até `ALVOS_POR_LOTE` (10) alvos, o acervo com o texto de cada
átomo envolvido — alvo ou candidato — uma vez só, e depois a lista de pares:

```
PARES A JULGAR (novo → antigo):
7 → 3
7 → 12
9 → 2
```

A saída referencia os números do acervo, não a posição na lista de candidatos:

```json
{"relacoes":[{"novo":7,"velho":3,"tipo":"ATUALIZA","confianca":0.8,"motivo":"…"}]}
```

Par ausente da lista é `NENHUMA` — resposta legítima e, agora por desenho, a
mais comum. `novo`/`velho` fora do acervo, ou um par que não estava na lista, é
descartado em silêncio, como o parser já fazia com `n` inválido.

O envelope guardado em `agentes.ts` passa a exigir `relacoes`, `novo` e `velho`:
um prompt meu que largue o formato de par deixa de poder ser salvo.

## 4. O piso do `COMPLEMENTA`

`LIMIAR_COMPLEMENTA = 0.7` vira o `limiarPadrao` do agente no registro — a mesma
peça que a resolução usa desde a 4.11, e que o painel de `/agentes` já desenha
sozinho para qualquer agente que declare um. Relação `COMPLEMENTA` com
`confianca` abaixo do limiar **não é gravada**; as outras três não têm piso.

O número é ponto de partida, não medição: as confianças de hoje saíram do prompt
velho e não transferem para o novo. O que o torna ajustável sem deploy é
justamente ele morar no painel.

## 5. Reprocessar tudo

`POST /api/confronto/reprocessar` — apaga **todas** as relações de confronto e
limpa os quatro campos de controle de todos os átomos; a fila volta a ter o
grafo inteiro. É o `desfazerConfronto` de um átomo, aplicado a todos, numa
consulta só.

Em `/confronto`, botão de **dois toques** (o padrão do apagar sessão em
`/sessoes`): o primeiro toque troca o rótulo para "apagar as N relações e rodar
tudo de novo?", o segundo executa. Ele existe porque toda recalibração de prompt
pede isso — sem ele, prompt novo só alcançaria átomo novo.

## 6. Dois consertos pequenos que vêm junto

- **A contagem da fila mentia**: `tamanhoDaFilaDeConfronto` contava todo átomo
  `ativo` pendente, mas `reivindicarProximoAtomo` só reivindica quem tem
  `embedding`. Hoje os 58 têm, então ninguém viu; com retrofill pendente, a tela
  mostraria uma fila que não anda. Um `AND a.embedding IS NOT NULL`.
- **O teto de saída sobe** de 1.500 para 4.000 tokens: um lote de 10 alvos pode
  julgar ~30 pares, e o teto de antes era dimensionado para um alvo.

## 7. Verificação

`pnpm test` e `pnpm typecheck` verdes — `tests/confronto.test.ts` (o acervo, os
pares, o parser novo, o piso do `COMPLEMENTA`, o reprocessar) e
`tests/agentes.test.ts` (o limiar do décimo agente).

Depois, o que só olho vê: **reprocessar tudo e reler as relações**. O gabarito
já existe — são os 21 pares que eu julguei:

| O que eu espero ver | O que quer dizer |
|---|---|
| as cinco reprovadas não voltam | o prompt pegou |
| `94→57` volta como `CONFIRMA` | a definição nova de corroboração pegou |
| as dezesseis aprovadas continuam lá | o conserto não foi um corte cego |
| `63→27` e `64→27` sobrevivem | `COMPLEMENTA` ainda serve para o que ela existe |
| menos relações no total, e mais `NENHUMA` | esperado, e é o objetivo |
| nenhuma relação sobrando, mas as boas também sumiram | o piso de 0,7 está alto — ajustar em `/agentes`, não no código |

## Fora de escopo

- **Resumo da entidade no prompt** — recusado por ora; se referente continuar
  confundindo depois desta fatia, é o próximo item a entrar;
- **Excluir `ROTINA` da lista de candidatos** — `81` é uma `ROTINA` e foi metade
  do problema de `93→81`, mas a entrevista da slice 5 decidiu "todos os tipos
  entram", e a regra nova de "mesmo dia não é motivo" ataca a causa sem reabrir
  aquela decisão. Se `ROTINA` reaparecer nos erros, aí sim;
- **Segunda passada para relação de baixa confiança** (nos moldes do
  `desempate-1`) — continua fora, como na slice 5. O piso agora **descarta** a
  `COMPLEMENTA` fraca em vez de mandá-la para uma segunda leitura;
- **Deduplicação de átomo** — continua não existindo;
- **Rate limit do Gateway** — o lote corta as chamadas de 39 para ~4 numa
  varredura completa, o que deve fazer o "só roda 5 por vez" desaparecer por
  consequência. Não é conserto dirigido, e não está medido.

## O que muda de arquivo

```
src/lib/confronto.ts              o prompt `confronto-2`, a entidade na apresentação,
                                   o acervo + pares, o parser novo, o piso do
                                   COMPLEMENTA, o lote na fila, o reprocessar
src/lib/tipos.ts                  EntidadesDoAtomo e AtomoNoAcervo; CandidatoDeConfronto
                                   passa a estender o acervo
src/lib/agentes.ts                limiarPadrao do confronto; envelope += novo/velho;
                                   papel e gatilho atualizados
.../api/cron/confronto            conta átomos e lotes, não elos
.../api/confronto/reprocessar     novo — POST
src/components/Confronto.tsx      botão de reprocessar, de dois toques
tests/confronto.test.ts           reescrito no que o formato novo tocou
ARCHITECTURE.md                   §4.15, §10, §14
Specs/slice-5.1.md                esta spec
```

Nenhuma migration, nenhuma variável de ambiente nova, nenhuma rota removida.

## Ordem de execução

| # | Passo |
|---|---|
| 1 | esta spec |
| 2 | a apresentação com entidade, o acervo e os pares — montagem e parser, sem tocar na fila |
| 3 | o prompt `confronto-2` e o piso do `COMPLEMENTA` |
| 4 | a fila em lote, e o teto de saída |
| 5 | o reprocessar: consulta, rota, botão de dois toques |
| 6 | `ARCHITECTURE.md` |

## Limites que esta fatia cria (para o §14)

- **O piso de 0,7 é palpite, como o `PISO_CONFRONTO` foi** — e agora há dois
  números de calibração no mesmo agente, um em código (similaridade) e um no
  painel (confiança). O primeiro está medido como inerte; o segundo nasce por
  medir.
- **Falha do lote derruba 10 átomos juntos.** A retentativa cobre, mas a linha
  de `/confronto` vai mostrar dez `falhou` com o mesmo motivo — ler isso como
  "dez problemas" seria errado.
- **O acervo compartilhado acopla os alvos de um lote**: um texto muito longo
  (uma `HISTORIA` de 2.000 chars) entra uma vez só, o que é o ganho, mas o lote
  inteiro cresce com ele. Sem teto de tamanho de lote além do número de alvos.
- **`reprocessar` é destrutivo e não tem desfazer**: ele apaga as relações de
  todos os átomos de uma vez. O contrapeso é que a varredura as reconstrói — e
  é por isso que ele pede dois toques.
