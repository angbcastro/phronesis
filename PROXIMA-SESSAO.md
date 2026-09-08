# Checkpoint — 2026-09-05

Documento de trabalho, não de arquitetura. **As slices 4.8, 4.8.1, 4.9 e 4.10
estão construídas, commitadas e medidas em sessão real.** O que sobra aqui é
histórico e a fila do que vem — ver a seção 6.

Contexto permanente está em `CLAUDE.md` (regras), `ARCHITECTURE.md` (como o
sistema funciona hoje) e `Specs/slice-4.11.md` (o que a fatia atual tem que ser).
Este arquivo só diz o que fazer a seguir.

> **Atualizado em 08/09, no fim do dia: a seção 2 está feita, e as duas fatias
> da seção 6 estão especificadas.** As partes de UI e UX pedidas foram validadas
> e estão funcionando; todos os áudios gravados foram importados e conferidos na
> tela de revisão. A seção 2 deixou de ser trabalho e virou registro — está
> mantida abaixo pelo que ela documenta, não pelo que ela pede.
>
> Depois disso veio a entrevista das duas fatias novas, em sete rodadas, e as
> specs saíram dela: **`Specs/slice-4.11.md`** (o fluxo de resolução) e
> **`Specs/slice-4.12.md`** (o enriquecimento em lote). A migration 009 está
> escrita como **proposta** em `db/migrations/`, e **não foi rodada** — ela é a
> primeira deste projeto que apaga nós, e o passo 2 da 4.11 é aprová-la.

> **Atualizado em 08/09: a árvore estava suja com dois trabalhos misturados, e
> foi fechada.** A migration 008 foi aprovada e aplicada (§2.4.1, riscada). O
> conserto da importação — dez tentativas no manifest e 502 legível na rota
> `pronto` — virou `26850ad`; e a tela de revisão, que tinha sido enxugada sem
> documento nenhum acompanhando, virou `57b9562` com o `ARCHITECTURE.md` §4.7,
> §4.10, §4.14, §11 e §14 junto: o texto do átomo edita no lugar, a dúvida virou
> `acho que é X — confirma?` e a procedência do GraphRAG foi para um modal atrás
> do `ⓘ`. **Nenhuma dessas duas mudanças foi medida**: a de UI foi feita a olho e
> a de manifest só se prova na próxima importação — a §2.4 exercita as duas.
> Uma consequência que ficou escrita no §14: o `motivo` do agente 2 não tem mais
> caminho de UI nenhum; ele continua no `extracao.json`, e é lá que se olha
> quando a atribuição surpreender. Isso muda o que a §2.6 pede para olhar.

> **Atualizado em 07/09, mais uma vez: duas fatias novas na fila, ainda não
> escritas.** O fluxo de resolução de entidade vai mudar em duas frentes — o
> formato do candidato que a extração vê, o nome canônico e o papel do agente
> de validação (fatia A); e um enriquecimento em lote que constrói o perfil a
> partir de todos os átomos que apontam para a entidade, sem teto de
> caracteres (fatia B). Nenhuma das duas tem `Specs/slice-N.md` ainda — a
> seção 6 lista o que cada uma muda e deixa travado que a sessão que for
> escrever essas specs tem que me entrevistar a fundo antes, porque há
> tensões reais com o que já existe (o teto de 300 caracteres tem uma razão
> de custo documentada em `ARCHITECTURE.md` §4.9, e o `resumo` novo se
> relaciona com os três campos de perfil de um jeito que ainda não está
> decidido).

> **Atualizado em 07/09, de novo: a slice 4.10 está construída.** A sessão longa
> foi rodada de ponta a ponta e mediu o que os 869 testes não alcançam: quatro
> chamadas de modelo para entregar uma. Três consertos saíram daí, todos
> commitados — o arquivo importado passou a ser **fatiado em blocos de 30 s** no
> navegador (a janela e o RAG por bloco estavam inertes nesse caminho), a
> resposta cortada passou a ser **salva até o último átomo completo** em vez de
> ir inteira para o lixo, e `/sessões` ganhou um botão de **apagar sessão**,
> porque uma sessão de 17 min fatiada são 35 objetos no R2. `Specs/slice-4.10.md`
> tem o escopo; `ARCHITECTURE.md` §3.0, §4.5, §4.6, §5, §9, §10 e §14, o sistema.
> **A migration 008 (`descartada_em`) ainda não foi aplicada** — ela é no-op
> (0 statements) e espera aprovação, como o `CLAUDE.md` manda.
> A seção 2.4 abaixo foi reescrita: ela deixou de ser "conferir que nada mudou"
> e passou a ser **a verificação que decide a fatia**.

> **Atualizado em 07/09: a primeira janela real rodou, e falhou.** A sessão
> `mtqoeoqh3e3724514q1f` foi a primeira extração por janela desde a 4.8. A
> janela 0 voltou sem JSON nenhum — `finishReason=length`, os 8000 tokens de
> saída gastos raciocinando, 5210 de entrada —, a segunda tentativa era
> idêntica e falhou igual, e o passe único de fallback levou 429 do free tier.
> A sessão foi para `erro`, e o `POST /:id/extrair` respondia 409 em cima disso.
> **Os três consertos estão em código** (§4.6 e §5 do `ARCHITECTURE.md`): o
> escalonamento de teto, a leitura do pensamento e o `podeReextrair`. Limitar o
> raciocínio foi medido (`pnpm probe:raciocinio`) e **recusado**: dá para calar
> este modelo, e calar cobraria a conta na qualidade da lista — o §4.4 registra
> as duas opções que funcionam, para o dia em que a pergunta voltar. A seção 2
> continua de pé — a validação por olho ainda não aconteceu.

> **Atualizado em 06/09, depois da 4.9.** A `Specs/slice-4.9.md` foi executada
> inteira em código — o RAG por bloco, o dossiê da janela, o `extracao-7`, o
> `resolucao-3`, o alias da grafia no confirmar, o painel e o `ARCHITECTURE.md`
> §4.14. **A migration 007 veio em cima** (`HISTORIA` e `:Organizacao`), e os
> dois prompts já estão em `extracao-8` e `resolucao-4`: a sessão de validação
> vai exercitar as duas fatias de uma vez. **Verificada só por teste, como a 4.8**: nenhuma janela real foi
> extraída ainda, e a seção 2 abaixo continua sendo o pré-requisito escrito da
> própria 4.9 — agora com uma pergunta a mais para olhar na revisão (2.6).
> A pendência da seção 3 **está resolvida**: `comEsperaDeLimite` entrou na
> resolução, que era o conserto que a 4.9 tornou necessário.

> **Atualizado em 06/09.** A `Specs/slice-4.8.1.md` foi escrita e executada
> inteira, menos o passo 4 — que é justamente a **seção 2 deste arquivo**. Estão
> commitados: o lote de `resolucao.ts` (parser, motivos, fallback, dedupe,
> gateway), a guarda do `"eu"`, o gancho que põe o vetor da entidade em dia, a
> cadeia de fusão, e a dúvida de menção chegando à tela. O que falta é **gravar e
> olhar**: nenhuma janela real foi extraída até agora, e a `Specs/slice-4.9.md`
> tem esta seção como pré-requisito escrito. A pendência da seção 3 abaixo
> (`comEsperaDeLimite` na resolução) continua de pé, e é a 4.9 que a resolve.

> **Substitui o checkpoint de 02/09**, que descrevia a slice 4.5 como planejada e
> não escrita. Desde então foram construídas a 4.5, a 4.6, a 4.7 e a 4.8. O que
> restou de lá e continua valendo está na seção 4 — **não conferido nesta
> sessão**, porque depende de olhar o banco e a fila de revisão.

---

## 1. O que esta sessão fez

**`b71e860` — a extração deixou de esperar eu parar de falar.** A cada 4 blocos
transcritos (2 min) uma janela é extraída e resolvida durante a própria gravação,
e os átomos vão para `sessoes/<id>/parcial.json`. Quando eu paro, sobra a janela
do fim. `Specs/slice-4.8.md` tem o escopo; `ARCHITECTURE.md` §4.1 e §4.6, o
sistema. `src/lib/janela.ts` é novo e não fala com modelo nenhum.

**`08c042a` — o documento parou de dizer que a resolução roda sob demanda.** §5.3
e §14 listavam o `resolucao-2` como agente de clique, quando ele roda dentro da
extração desde a slice 4. Correção de texto; o conserto de código está na
seção 3.

Nada disto passou pelo Gateway. **Nenhuma janela real foi extraída ainda.**

---

## 2. As validações — feitas em 08/09

~~Nesta ordem.~~ **Feito.** As sessões foram gravadas e todos os áudios
importados e conferidos na tela de revisão; a UI e a UX pedidas foram validadas
e estão funcionando. As slices 4.8, 4.8.1, 4.9 e 4.10 deixaram de ser previsão.

O que segue abaixo fica como **registro do que foi olhado** — a tabela de sinais
de log continua servindo para a próxima estranheza, e o §2.6 continua sendo a
descrição de como o caso "Jean" se comporta. Nada aqui é trabalho pendente.

### 2.1 Gravar 3 minutos e ver a janela fechar antes de parar

Menos de 3 min não fecha janela nenhuma durante a fala — a janela é de 4 blocos,
e uma gravação curta cai no passe único, que é o caminho de antes da fatia. Então
uma sessão de teste de 40 s **não testa nada desta slice**.

```
scripts/dev.ps1
```

Gravar, e **antes de parar** procurar em `logs/dev-<data>.log`:

```
[janela] sessão <id> janela 0 (blocos 0-3): +N átomo(s), M estendido(s)
```

E conferir que `sessoes/<id>/parcial.json` já existe no bucket com átomos dentro,
com a janela 0 marcada `pronta`.

| O que aparece | O que quer dizer |
|---|---|
| a linha `[janela] … janela 0` | o caminho novo está vivo |
| nenhuma linha `[janela]` | o `avancarJanelas` não está sendo chamado, ou nenhum bloco fechou janela — conferir se os 4 primeiros blocos ficaram `transcrito: true` no manifest |
| `[janela] … falhou:` | o motivo está na própria linha; a janela fica `falhou` no parcial e é retentada no bloco seguinte |
| `[janela] … não fecharam` no fim | caiu no passe único. A sessão não morreu, mas a fatia não entregou nada — é o caso a investigar |

### 2.2 Cronometrar do botão até a revisão abrir

**É o número desta fatia, e ele não existe ainda.** Hoje a previsão é "de um a
dois minutos para segundos", e previsão não é medição. Cronometrar do toque em
parar até `/sessao/:id/revisar` abrir sozinha.

Se continuar em dezenas de segundos, o suspeito não é a extração: é a resolução
da janela do fim (embedding + duas consultas vetoriais + a chamada do agente 2),
que roda inteira ali.

### 2.3 Olhar a lista na revisão — o maior risco da fatia

Não há passada de costura no fim. O que segura o volume da lista é o `estende`,
que é **instrução de prompt**. Três coisas a olhar, e as três só olho vê:

- **o volume caiu na faixa?** Oito janelas pedindo de 1 a 3 dão de 8 a 24 no
  papel; é o `estende` que tem de puxar para baixo;
- **existe UM átomo `ROTINA`?** Dois é o sinal mais claro de que a instrução não
  pegou — a regra "no máximo uma por sessão" agora depende de a janela ver a
  ROTINA da janela anterior e estendê-la;
- **um assunto tocado no minuto 2 e retomado no 9 virou um átomo com dois
  trechos, ou dois átomos?** Um átomo com dois trechos é o `estende` funcionando.

**Se falhar, o conserto não é todo sem deploy.** A base do prompt é editável em
`/agentes`; o bloco da janela — que é onde mora a instrução do `estende` — é
montado em código, em `blocoDaJanela` (`src/lib/extracao.ts`). Está no §14 como
limite. Ajustar a instrução do `estende` hoje é deploy.

### 2.4 Importar o áudio de 17 min de novo — é o que decide a 4.10

**Existem duas sessões com o mesmo áudio**: `mtqoeoqh3e3724514q1f`, em
`em_revisao` com a proposta de 9 átomos, e `mtqpzopm5123432v291d`, em `erro`.
Guardar a primeira como o "antes" — **não apagar** — e importar o áudio de novo
para o "depois". Mesmo áudio dos dois lados é a única medida de qualidade que
este sistema aceita.

No `logs/dev-<data>.log`:

| O que aparece | O que quer dizer |
|---|---|
| `[janela] sessão <id> janela 0 (blocos 0-3)` | o caminho novo está vivo na importação — **é o critério da fatia** |
| nove linhas `[janela]`, nenhuma `não fecharam` | o fallback deixou de ser exercitado |
| `dossiê de K entidade(s)` | a 4.9 passou a rodar por bloco, e não uma vez por sessão |
| `[extracao] … resposta cortada, N átomo(s) recuperado(s)` | o salvamento pegou |
| `[limite] stt` em rajada | os 2 blocos simultâneos não bastaram — é o limite declarado no §14, e a saída é o bloco de 2 min |
| `[fatiador] …` | **o fatiamento não aconteceu** e tudo caiu no caminho antigo; nada na tela diz isso |

E o rótulo do botão tem de virar `subindo bloco 3 de 35…` enquanto sobe — se
ficar em "subindo o áudio…", `fatiarArquivo` devolveu `null`.

Três coisas que só olho vê:

- **o volume subiu para a faixa?** Nove átomos para 17 min está no piso dos 10 a
  20 por 15 min. Nove janelas pedindo de 1 a 3 devem dar mais — e se derem
  **demais**, o `estende` é que não pegou;
- **o átomo 0 se quebrou?** Hoje é uma `HISTORIA` só, com 18 trechos de 4 s a
  500 s, misturando a viagem, a cachoeira, o poema, o morcego no para-brisa e o
  vinho. É o modo de falhar que o §14 já previa para `HISTORIA`. Se continuar
  inteiro com janela de 2 min, o conserto é regra em `/calibracao`, não código;
- **um assunto retomado virou um átomo com dois trechos, ou dois átomos?** É o
  `estende`, e ele **nunca foi exercitado de verdade**: nenhuma janela chegou a
  fechar até hoje.

### 2.4.1 O botão de apagar, e a migration 008

~~Antes de gerar sessão de teste com 35 objetos cada, **aprovar e rodar a
migration 008**.~~ **Feito em 08/09**: aprovada e aplicada com `pnpm migrate`, as
oito em ordem, a 008 com 0 statement(s) como previsto. `descartada_em` está
declarado no schema, que é onde o `CLAUDE.md` manda a verdade morar.

Depois, apagar uma sessão de teste e conferir: a linha some da lista na hora, o
prefixo `sessoes/<id>/` fica vazio no console do R2, e o nó continua no Neo4j com
`descartada_em` preenchido (`MATCH (s:Sessao {id:$id}) RETURN s`). Sessão em
`transcrevendo` não pode nem oferecer o botão.

### 2.5 O rate limit, que mexeu nos dois sentidos

São ~8 chamadas de extração a mais na conta por sessão, mas espalhadas pelos 15
minutos e **sem prazo para esperar** (durante a gravação, `comEsperaDeLimite` vai
sem `ate`). A rajada que existia — a chamada grande logo depois de 30 blocos de
STT — deixou de existir.

Nenhuma das duas coisas foi medida, e uma sessão de 15 min nunca foi processada
inteira sob limite, nem antes desta fatia. O que procurar no log:
`[limite] extracao <modelo>: rate limit do Gateway — esperando Ns`.

### 2.6 A 4.9: o nome certo dentro do texto do átomo

**O caso de aceite é o áudio real em que o STT ouviu "Jean".** Importar de novo
(ou gravar dizendo "giam") e olhar a proposta:

- o átomo diz **"Giampaolo Lepore"** no texto, e não "Jean";
- o sujeito aponta o nó que **já existe** — a linha de procedência da revisão diz
  "o extrator reconheceu este nome no diário";
- confirmando, `logs/` mostra `[grafias] sessão <id>: N grafia(s) viraram alias`,
  e `/entidades` passa a listar "Jean" como grafia de Giampaolo Lepore;
- na sessão seguinte, "jean" resolve por casamento exato — sem depender da busca.

E o que procurar no log durante a gravação:

```
[janela] sessão <id> janela 0 (blocos 0-3): +N átomo(s), M estendido(s), dossiê de K entidade(s)
[candidatas] sessão <id> bloco <i>:            ← só se a busca falhou
```

`dossiê de 0 entidade(s)` numa sessão que cita gente conhecida é o sinal de que a
busca não está achando nada, e aí o extrator está rodando como na 4.8. Com o
grafo pequeno de hoje, K deve ser perto do número de entidades do grafo.

Três coisas que só olho vê, e que são o risco desta fatia:

- **o texto do átomo trocou só o nome próprio?** A instrução manda trocar o nome
  e mais nada. Se o resto da frase começar a soar como o modelo e não como eu, o
  `COM AS MINHAS PALAVRAS` está cedendo — e o conserto é o prompt;
- **apareceu nome de gente conhecida em átomo que não fala dela?** É o falso
  positivo do dossiê: a lista na frente do modelo é convite para ele usar um nome
  que combina com o assunto. O sinal é a discordância entre os dois agentes, que
  a revisão marca como dúvida — **mas desde 08/09 ela marca sem dizer por quê**:
  o `motivo` do agente 2 saiu da tela. Quando a marca aparecer e o `ⓘ` não
  explicar, o motivo está em `sessoes/<id>/extracao.json`;
- **quantas menções o agente 2 está julgando?** Agora são todas as que têm
  candidato — se a espera depois de parar de falar crescer, é aí.

---

## 3. Feito: a espera de rate limit na resolução

**`resolucao.ts` chama `comEsperaDeLimite` desde a 4.9.** Ele roda no caminho
automático, dentro da extração de cada janela, e agora em **toda** menção com
candidato — o que tornou o conserto necessário em vez de só correto. Ele recebe
o `ate` de quem o chamou, o mesmo da extração daquela janela. A linha do §14 que
dizia o contrário saiu.

O que continua sem medição é o limite em si: uma sessão de 15 min nunca foi
processada inteira sob rate limit, e agora ela tem ~8 chamadas de resolução a
mais na conta. É a seção 2.5.

---

## 4. Do checkpoint anterior — não conferido nesta sessão

Estes itens são de 02/09 e dependem de olhar o banco e a fila. **Podem já estar
resolvidos**; nada nesta sessão os tocou, e nada nesta sessão os verificou.

- **O passo zero das entidades.** Em 02/09 as cinco entidades do grafo não tinham
  nenhum dos três campos de perfil, e `Raffael do Vale` estava semeado numa
  grafia que a camada de string não casa com "Rafa". Sem perfil escrito, a camada
  3a da resolução nasce inerte — e a 4.5 foi construída depois disso. Vale abrir
  `/entidades` e ver como está.
- **A fila de revisão.** Eram 7 sessões esperando em 02/09, e o checkpoint
  anterior chamava isso pelo nome certo: `Specs/visao.md` §8 diz que revisão
  acumulada é abandono. Se ainda houver fila, ela vale mais que qualquer fatia —
  e agora tem uso duplo, porque revisar uma delas mede o "menos de 60 s" que
  segue sem medição.
- **`config/vocabulario.txt` ainda tem 3 nomes** (conferido: 3 linhas úteis). Só
  ele ensina um nome **antes** de eu falá-lo pela primeira vez, que é justamente
  quando o STT mais erra.
- **Bancada de comparação de modelos**, pedida e adiada cinco vezes. Desenho
  discutido está no checkpoint anterior, no histórico do git.

---

## 5. Decisões da 4.8 — não relitigar

| Decisão | Por quê |
|---|---|
| Janela de 4 blocos (2 min), não de 1 | 30 s corta frase no meio e dobra a exposição ao rate limit; 2 min é fala suficiente para um átomo nascer inteiro |
| Tudo por janela: extração **e** resolução | deixar a resolução no fim custaria 10-15 s da espera que a fatia existe para cortar |
| Sem passada de costura no fim | custaria um oitavo agente, mais um prompt para calibrar à mão para sempre, e ~10 s acrescentados exatamente à espera que se está cortando |
| `INSTRUCOES_BASE` não muda um byte | cinco versões de calibração produziram o que está lá |
| `extracao-6` mesmo com o texto igual | a entrada mudou; precedente do `resolucao-2` na 4.5 |
| `resolucao-2` **não** sobe de versão | o prompt dele é o mesmo e o bloco de contexto some quando vazio; o que um `prompt_version` resolve é um texto |
| `estende` não mexe em `sobre` nem `menciona` | é o que mantém a resolução incremental sem reabrir átomo já atribuído |
| Sem operação de renome na janela | o painel de entidades da revisão já reaponta todos os átomos num gesto |
| A sessão inteira é uma janela, não um caminho paralelo | um prompt só para calibrar, para sempre |
| `JANELA_BLOCOS = 0` desliga tudo | botão de pânico sem deploy de emergência |

---

## 6. Duas fatias novas: **especificadas em 08/09**

A entrevista aconteceu — sete rodadas, opções concretas e trade-off explícito em
cada uma — e as duas specs saíram dela:

| Fatia | Spec | O que é |
|---|---|---|
| A | **`Specs/slice-4.11.md`** | a entidade ganha `resumo`, `aliases` como propriedade e `canonico`; é isso o que os dois agentes leem por padrão; o agente 2 devolve **confiança** e, abaixo do limiar, um agente novo (`desempate`) faz a segunda passada com o perfil inteiro |
| B | **`Specs/slice-4.12.md`** | enriquecimento em lote: checkbox em `/entidades`, o agente 4 lê **todos** os átomos `SOBRE` + `MENCIONA` e **escreve sozinho** resumo e os três campos, com desfazer de um toque; fila assíncrona, sem janela aberta |

**Ordem: A primeiro, medida numa sessão real, e B logo em seguida.** A cria o
`resumo` vazio e B o preenche; no intervalo, quase toda menção cai na segunda
passada — que é comportamento esperado e está escrito como tal na 4.11.

**O próximo passo concreto é aprovar a migration 009**
(`db/migrations/009_resumo_aliases_canonico.cypher`), que já está escrita como
proposta. Ela **tem statements** e é a primeira deste projeto que **apaga nós**:
converte em item de `aliases` os nós de grafia (os que têm só o label
`:Entidade`) e os apaga, preservando antes de apagar. Fusão de duas entidades
reais continua sendo `FUNDIDA_EM`.

Duas coisas que a entrevista decidiu e que contrariam documento escrito — as
duas deliberadas, as duas com o preço anotado nas specs:

- **`TETO_PERFIL = 300` some** (4.11). O motivo declarado na migration 005 era o
  consumo do agente 2, e esse consumo saiu do caminho comum;
- **o lote escreve perfil sem revisão prévia** (4.12), o que reabre o
  `ARCHITECTURE.md` §4.9. A regra 5 do `CLAUDE.md` continua intocada — ela fala
  de átomo, e nenhum átomo entra por ali; a seleção mais o botão são o toque.

O que segue abaixo é o material **de antes** da entrevista, mantido porque
descreve o estado do código que as duas fatias vão encontrar.

### 6.1 Fatia A — o material de antes da entrevista

**Decidido: ver `Specs/slice-4.11.md`.** Os pontos marcados abaixo como "em
aberto para a entrevista" foram todos respondidos; a spec tem as respostas e o
que foi recusado em cada uma. Esta seção fica pelo mapa de código que ela traz.

- **Novo campo `resumo` no perfil da entidade**, para o agente de extração.
  Não existe no schema hoje — o perfil é só `contexto`, `pode_ajudar_com`,
  `fizemos_juntos` (migration 005). Decidido: o campo só é preenchido depois
  que a fatia B rodar; a fatia A cria o campo vazio.
- **O dossiê de candidatos do GraphRAG** (hoje `blocoDasCandidatas()` em
  `src/lib/extracao.ts`, alimentado por `src/lib/recuperacao.ts`) passa a
  mostrar **nome, resumo e aliases como lista** — hoje mostra nome, tipo,
  aliases como string e o campo `contexto` isolado. Aliases hoje não são uma
  propriedade armazenada: são derivados percorrendo
  `(:Entidade)-[:FUNDIDA_EM]->(:Entidade)` em `src/lib/entidades.ts`. A
  entrevista decide se isso muda.
- **Nome canônico = Nome + Sobrenome, só para `:Pessoa`** (Projeto, Objetivo e
  Organização ficam como estão). Apelidos e outras grafias continuam em
  aliases.
- **Flag manual de "canônico" em toda entidade** (item novo): um nó pode ser
  marcado à mão como canônico; nós marcados aparecem destacados em
  `/entidades` e são priorizados no fluxo de resolução. É schema novo — exige
  migration proposta e aprovada. Em aberto para a entrevista: prioridade em
  qual etapa exatamente (agente 1, agente 2, ou as duas)? o que "destacar"
  quer dizer na tela? a flag é só um sinal ou existe alguma trava de
  unicidade por pessoa?
- **O agente de validação (`src/lib/resolucao.ts`, hoje `resolucao-4`) muda
  de papel**: de "decide a atribuição" para primariamente **verificar e
  sinalizar** — confiança de que a entidade extraída no átomo é a canônica do
  grafo, sinalizando entidades novas e entidades em dúvida; resolve sozinho
  só quando a confiança permitir. Em aberto para a entrevista: o que muda no
  JSON de saída do agente? como a tela de revisão (`Revisao.tsx`) mostra
  "dúvida" hoje, e o que muda? "confiança suficiente para resolver sozinho" é
  um número, uma instrução de prompt, ou os dois?
- **Tensão a levar para a entrevista:** o `resumo` reduz o que entra no
  prompt do agente 1, mas o agente 2 hoje lê os três campos de perfil
  inteiros (`descrever()` em `src/lib/resolucao.ts`) — a fatia A muda isso
  também, ou só o agente 1?

### 6.2 Fatia B — o material de antes da entrevista

**Decidido: ver `Specs/slice-4.12.md`.** As duas tensões levantadas aqui — o
teto de 300 e o "escreve sozinho" — foram decididas contra o que estava
escrito, e as duas estão com o preço anotado na spec.

- **Chamada de API em lote** que pega todos os átomos que mencionam ou são
  sobre a entidade (`SOBRE` + `MENCIONA` — não só os marcados por
  `:PERFILA`) e usa tudo para construir o perfil. O único mecanismo parecido
  hoje é o agente 3 (`src/lib/perfil.ts`, `perfil-1`): manual, por campo, sob
  demanda, e só sobre átomos marcados via `:PERFILA`. `ARCHITECTURE.md` §4.9
  documenta esse desenho como deliberado, com risco escrito — perfil errado
  contamina toda atribuição futura, por isso "nada entra sem o meu toque". A
  entrevista decide se o lote escreve sozinho ou continua exigindo
  confirmação por toque: mudar isso é reabrir uma decisão de arquitetura já
  tomada, não só trocar a fonte dos átomos.
- **Tirar o teto de caracteres** (`TETO_PERFIL = 300`, `src/lib/tipos.ts`). O
  teto existe por custo documentado: os três campos de perfil de todas as
  entidades entram no prompt do agente 2 a cada resolução. Tirar o teto sem
  decidir o que o agente 2 passa a ler (fatia A, `resumo` vs. perfil inteiro)
  reintroduz esse custo — a entrevista precisa amarrar as duas fatias aqui.
