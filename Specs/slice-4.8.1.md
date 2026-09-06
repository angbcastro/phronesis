# Slice 4.8.1 — As travas que a 4.9 vai apoiar em cima

**Objetivo:** fechar os buracos que a validação de ponta a ponta do fluxo de
resolução achou (05/09). Não é fatia nova: é correção do que as fatias 4, 4.5,
4.6 e 4.8 deixaram.

**O número diz a ordem.** Vai **antes** da `Specs/slice-4.9.md`, que continua como
está — não toquei nela. As emendas que ela precisa receber estão listadas no fim.

**Nada disto rodou ainda, e é o ponto de partida:** a 4.8 está commitada e
**verificada só por teste** (`PROXIMA-SESSAO.md` §2 — "nenhuma janela real foi
extraída ainda"), a 4.9 é spec sem uma linha de código, e a validação desta fatia
foi leitura mais um harness de vitest. A primeira janela real ainda não existe. É
por isso que o passo 2 abaixo é o primeiro: ele põe instrumento antes dela.

**Pronto quando**, as seis em sessão real:

1. uma resposta do agente 2 que o parser não entende **aparece no log** e no
   motivo da tela, em vez de virar "o agente não respondeu";
2. um `SENTIMENTO` continua `sobre: "eu"` mesmo quando o vizinho vetorial vota em
   outra pessoa;
3. edito o perfil de uma entidade em `/entidades` e, **sem chamar rota nenhuma à
   mão**, a sessão seguinte traz aquela entidade como candidata pela camada 3a;
4. fundo `A` em `B`, depois `B` em `C`; digo "A" numa sessão nova e o átomo cai
   em `C`;
5. uma sessão em que o agente ficou em dúvida sobre uma **menção** abre com o
   átomo marcado, o motivo ao lado, e a sugestão preenchida na barra **daquela**
   menção;
6. `pnpm test` verde, com testes que **falhariam hoje**: array solto no parser,
   `eu` reatribuído, cadeia de fusão, dúvida de menção, e o vetor da entidade
   posto em dia pelo confirmar.

## Por que antes da 4.9

Não é preferência de ordem. Três coisas da 4.9 não funcionam sem isto, e estão
escritas na spec dela:

| Linha da `slice-4.9.md` | O que ela assume | O que é verdade hoje |
|---|---|---|
| 210-211: "`fonteDaEntidade` inclui aliases, então o hash muda e **`garantirEmbeddings` reembute a entidade sozinho**" | que alguém roda `garantirEmbeddings` | **ninguém roda.** Um dos dois "efeitos de graça" da fatia não acontece (A4) |
| §1, camada `perfil` do RAG: "reusa `candidatosPorPerfil` **sem alterá-lo**" | que existe vetor de entidade para consultar | entidade nascida num confirmar fica sem vetor para sempre (A4) |
| 178: "discorda → `certo: false` — **dois agentes discordando é exatamente o que a revisão tem de ver**" + 240: "**Tela.** Nenhuma." | que a revisão mostra `certo: false` | mostra só o do **sujeito**. Discordância sobre menção é invisível (B1) |

E uma quarta que a 4.9 **piora de vez**: ela cria nó de alias automaticamente
(`registrarGrafia`), e o §14 dela já declara que "o STT errando de três jeitos
deixa três aliases pendurados no mesmo nó". Esses aliases são filhos de um salto.
Uma fusão posterior daquele nó — gesto normal em `/entidades` — orfana todos eles
de uma vez (A3). A 4.9 fabrica em série exatamente os nós que a cadeia de fusão
perde.

## O critério de corte: texto de prompt vai para a 4.9, código vem para cá

A primeira versão desta spec adiava metade dos achados para o passo 5 da 4.9, com
o argumento de que ela reescreve `resolucao.ts`. **O argumento está errado.** A
spec da 4.9 declara para aquele arquivo exatamente quatro coisas (linha 249:
"camada `extrator`, TOP_K 4, toda menção ao agente, `comEsperaDeLimite`") e diz,
no §4, que "**a degradação é a de hoje, item por item**". Quer dizer:
`parsearResposta`, o ramo do `NOVA`, o fallback e `listarMencoes` **não são
reescritos** — são herdados como estão, com os defeitos dentro. Adiar para lá não
seria economizar uma edição; seria garantir que aqueles bugs nunca fossem
consertados.

O corte que vale é outro, e é mecânico:

- **muda o texto de um prompt** → vai para a 4.9, porque `PROMPT_VERSION` sobe
  quando o prompt muda (regra 7) e a 4.9 já sobe o dela para `resolucao-3`. Subir
  agora significaria queimar o `resolucao-3` e obrigar a 4.9 a virar
  `resolucao-4`, por uma frase;
- **é código** → vem para esta fatia, com o prompt intacto. Nenhum
  `prompt_version` se mexe aqui.

## O mapa: onde cada achado mora

| # | Achado | A 4.9… | Onde |
|---|---|---|---|
| A1 | resposta em array solto some sem erro nem log | herda o defeito | **aqui** |
| A2 | `sobre: "eu"` reatribuído com `certo: true` | **piora** — toda menção vai ao agente por desenho | **aqui** (guarda) + 4.9 (a frase no prompt) |
| A3 | fusão encadeada orfana alias | **piora muito** — passa a criar alias automaticamente | **aqui** |
| A4 | nada reembute entidade | **depende** | **aqui** |
| B1 | dúvida de menção invisível | **depende** | **aqui** |
| B2 | `porque` só aparece na dúvida | **piora** — `certo: true` vira o caso comum | **aqui** |
| C1 | chave válida fora dos candidatos → motivo falso | herda o defeito | **aqui** (motivo) + 4.9 (a frase no prompt) |
| C2 | `NOVA` colidindo com nó existente | herda o defeito, e piora — o texto do átomo já carrega o nome canônico | **aqui** |
| C3 | `porque` perdido no fallback | herda o defeito, e o fallback vira o caminho normal | **aqui** |
| D1 | mesma grafia, duas resoluções na sessão | **resolve pela metade** — `ja_nesta_sessao` amarra o extrator, não o agente 2 | 4.9 (metade) + §14 (resto) |
| D2 | menções idênticas viram duas perguntas | **piora** — toda menção é pendente | **aqui** |
| D3 | `estende` troca o texto e mantém a atribuição | neutra | §14 |
| E1 | comentário promete tolerância que não existe | — | **aqui**, junto de A1 |
| E2 | `garantirGateway` depois de já ter batido no Gateway | — | **aqui** |
| E3 | resolução sem `comEsperaDeLimite` | **resolve** | nada a fazer |
| E4 | `catalogo.ts` mente sobre o payload de `/api/entidades` | neutra | **aqui** |
| E5 | `collect` do `porque` sem `DISTINCT` | neutra | **aqui** |
| E6 | `TOP_K` corta o vetor quando há muitos parecidos | **muda** — `TOP_K` vai a 4 com `extrator` na cabeça | 4.9 |

Sobra para a 4.9: **E6**, duas frases de prompt, e o que ela já ia fazer.

---

# Parte 1 — esta fatia

## 1. O lote de `resolucao.ts` (A1, C1, C2, C3, D2, E1, E2)

Um commit, prompt intacto, `PROMPT_VERSION_RESOLUCAO` continua `resolucao-2`.
Vem primeiro porque é o mais barato e porque **põe instrumento antes da primeira
janela real** — que ainda não aconteceu.

**A1 — a resposta que some.** `parsearResposta` (`resolucao.ts:489-513`) só
procura `{`. Um array solto **não estoura**: pega do primeiro `{` ao último `}`,
devolve um objeto válido sem `referencias`, e as duas listas voltam vazias.
`falha` fica `null`, e cada menção sai com `motivo: "o agente não respondeu por
esta menção"` — que é a etiqueta errada, porque ele respondeu e a chamada foi
paga.

- aceitar `[` como `isolarJson` já faz na extração (`extracao.ts:346`);
- quando há pendentes e a resposta produz **zero** julgamento, `console.error`
  com `[resolucao]` e `diagnostico(resposta)`, e `falha` marcada — para o motivo
  na tela dizer a verdade;
- o comentário da linha 489 para de prometer o que o código não faz (**E1**).

Sob a 4.9 isto deixa de ser uma menção e passa a ser a **janela inteira**: toda
menção é pendente, então uma resposta engolida faz o extrator passar sem segunda
opinião — que é exatamente o que a decisão 1 da 4.9 comprou pagando o critério 5.
Consertar antes é o que impede a fatia seguinte de nascer com um modo de falha
mudo no meio.

**C1 — motivo verdadeiro.** Separar "não respondeu" de "respondeu fora dos
candidatos", e no segundo caso nomear a chave que veio. A política de descarte
fica como está (é o §4.8 que a declara); o que muda é a frase, que hoje afirma
silêncio onde houve resposta — e é essa frase que eu leio para decidir se o
agente está funcionando.

**C2 — `NOVA` que colide.** Quando o agente responde `NOVA` e o `citado`
normaliza para uma chave que já existe no grafo, `agregarCandidatas` remapeia
para o nó e o confirmar pendura o átomo nele: o agente disse "é outra pessoa" e o
sistema respondeu "é a mesma", com `certo: true` e nada na tela. A causa raiz é
legítima (constraint global de `nome_normalizado`, migration 002 — dois nós com o
mesmo nome não existem). O conserto é o sinal: `certo: false` com o motivo
nomeando o conflito, que é o que me manda renomear um dos dois. E `alternativas`
para de incluir o próprio nome escolhido (`resolucao.ts:662`).

**C3 — a evidência perdida no fallback.** `porque: exato?.porque ??
candidatos[0]?.porque` nunca cai para o segundo: `??` não passa por `[]`, e a
camada `exato` **sempre** tem `porque: []`. Primeiro não-vazio, não primeiro
não-nulo. Sob a 4.9 o fallback vira o caminho normal quando o agente cala.

**D2 — menções idênticas.** Duas menções iguais no mesmo átomo viram duas
perguntas numeradas com listas de candidatos idênticas, e podem receber respostas
diferentes. Colapsam antes de numerar as pendentes. (Entre átomos **não**
colapsam: é o ponto da slice 4.)

**E2 — `garantirGateway()`** sobe para antes de `candidatosSemanticos`. Hoje só
roda no ramo com pendentes, depois de o Gateway já ter sido chamado para embutir.

**Teste:** `tests/resolucao.test.ts` já tem todo o andaime (mock de
`generateText`, de `candidatosSemanticos`, e os nós `RAFFA`/`RAPHA`). Casos
novos: array solto vira erro visível; resposta vazia com pendentes loga e marca
falha; chave fora dos candidatos tem motivo próprio; `NOVA` colidindo volta
incerta; fallback com exato sem evidência traz a dos outros; menção repetida vira
uma pergunta.

**`ARCHITECTURE.md` no mesmo commit:** §4.8, a tabela "Resposta ruim degrada para
dúvida" — ela hoje tem três linhas e passa a ter quatro.

## 2. A guarda do `"eu"` (A2)

As camadas semânticas são calculadas **por átomo** (`resolucao.ts:564-582`) e
entregues a todas as menções dele sem filtro pelo citado. `"eu"` casa exato, a 3b
traz de quem são os vizinhos, união = 2, `julgar`. Provado no harness: um
`SENTIMENTO` saiu `sobre: "Giampaolo Lepore"` com `certo: true` — sem marca
nenhuma na tela.

Isto está acontecendo **hoje**: as 5 sessões confirmadas de 04/09 puseram átomos
no grafo, e átomo ganha vetor no confirmar (`gravarAtomos:170`), então a camada
3b está viva. É o único achado que corrompe dado em toda sessão que eu gravar
daqui até o conserto.

**O conserto é validação, não atalho.** "Não mandar `eu` ao agente" contradiz a
decisão 1 da 4.9 ("continua validando toda menção"), tomada de propósito. Então o
agente continua vendo a menção e o **código** recusa a resposta que quebra o
contrato de quem veio antes — mesma forma de `validarMarcas`, que já deixa o
agente 2 opinar e recusa a marca sobre entidade que o átomo não cita:

- `SENTIMENTO`, `APRENDIZADO` e `ROTINA` têm `sobre: "eu"` por contrato do
  `extracao-6`. Julgamento que tire o sujeito de `eu` nesses três tipos é
  descartado, com motivo dizendo isso. `resolverReferencias` já recebe os átomos
  crus, então o `tipo` está à mão;
- vale igual para o **extrator** sob a 4.9: `blocoDasCandidatas` não poderá fazer
  o `sobre` de um `SENTIMENTO` apontar para um nó do dossiê. Mesma guarda, no
  parse do passo 4 dela.

**A frase no prompt fica para a 4.9.** Repetir a regra de tipo em `INSTRUCOES`
faz o agente não gastar a decisão à toa — mas muda o texto, e mudar o texto sobe
`PROMPT_VERSION_RESOLUCAO` para `resolucao-3`, que é o número que a 4.9 já
reservou. Por uma frase não vale queimar o nome; a guarda de código sozinha já
impede o dado errado, que é o que urge.

**`ARCHITECTURE.md` no mesmo commit:** §4.8 (a regra de tipo passa a ser
arbitrada pelo código, e não só pedida ao extrator).

## 3. O vetor da entidade volta a existir (A4)

`garantirEmbeddings()` tem um chamador: `POST /api/entidades/embutir`. Nenhuma
tela chama essa rota — a varredura de `fetch("/api/…")` em `src/` dá 30 chamadas
e nenhuma é essa. Não há cron nem `waitUntil`. O §8.4 e o cabeçalho da própria
função descrevem "a **próxima passada** de `garantirEmbeddings()`", e não existe
próxima passada.

**O conserto é o gancho, e o argumento contra ele não se aplica.** §8.4 recusa
gancho por um motivo bom — "um lugar a mais onde alguém esquece de invalidar".
Mas o gancho aqui não invalida nada: quem decide é o hash. Esquecer um call site
custa **atraso**, não vetor velho — a próxima passada de qualquer outro alcança.
É exatamente isso que `embedding_fonte` compra.

Seis call sites, todos em `waitUntil`, todos engolindo a falha com `[entidades]`
no log (mesma precedência do embedding de átomo, §4.10 — nada no caminho do vetor
impede uma gravação):

```
POST /api/sessoes/:id/confirmar   depois de gravarAtomos, junto do capturarCorrecoes
POST /api/entidades/perfil        o que mais muda a string canônica
POST /api/entidades/renomear
POST /api/entidades/fundir
POST /api/entidades/tipo
POST /api/entidades/criar         é o "passo zero" — nasce e já entra na 3a
```

Rodar com nada fora de dia custa **uma consulta e zero chamada de modelo**
(`entidades.ts:333`). O teto de `limite = 500` fica; grafo maior é problema de
outra fatia, e a rota manual continua existindo para o retrofill.

**Teste:** `tests/entidades-grafo.test.ts` já mocka `query` e `embutirVarios`.
Falta "o confirmar dispara a passada" e "o gancho rodando duas vezes embute uma".

**`ARCHITECTURE.md` no mesmo commit:** §8.4 (a frase da "próxima passada" nomeia
os call sites), §4.10, §2 (mapa dos módulos).

## 4. A cadeia de fusão (A3)

As dez travessias de `:FUNDIDA_EM` do projeto são de **um salto**
(`atomos.ts:140,155,295`, `entidades.ts:113,304,416,475`, `perfil.ts:63,118`,
`fusao.ts:276`), e `fundir()` não repõe os aliases da perdedora no vencedor novo.

Fundir `rapha2`→`rapha` e depois `rapha`→`raphael` deixa
`rapha2 → rapha → raphael`. A chave `rapha2` sai de `chaves` do catálogo; dita de
novo, o `MERGE` reencontra o nó morto (a constraint da 002 impede o segundo nó) e
`gravarAtomos:139-142` pendura o `:SOBRE` em **`rapha`**, que nenhuma listagem
mostra e que a camada 3b descarta.

**Conserto no lado da escrita, não no da leitura.** Uma consulta a mais em
`fundir()`, antes de marcar a perdedora, no estilo das cinco que já estão lá:

```
MATCH (x:Entidade)-[r:FUNDIDA_EM]->(p:Entidade { nome_normalizado: $perdedora })
MATCH (v:Entidade { nome_normalizado: $vencedora })
MERGE (x)-[:FUNDIDA_EM]->(v)
DELETE r
```

Idempotente como o resto, e refazer a fusão cura — o contrato que o §14 já
declara para ela não ser atômica.

A alternativa — `-[:FUNDIDA_EM*1..]->` nas dez travessias — foi recusada: fusão é
rara e é escrita; leitura é quente e inclui **duas consultas de índice vetorial
por janela**. Pagar expansão de comprimento variável ali para consertar um caso
de escrita é o lado errado da conta.

**Mais uma guarda:** `fundir()` recusa vencedor com `status = 'fundida'`. Hoje só
a perdedora é checada (`fusao.ts:67-79`), e fundir **para dentro** de um alias
corrompe do mesmo jeito.

**Teste:** `tests/fusao.test.ts` tem 9 casos de `fundir`, nenhum com cadeia.
Faltam: "fundir o vencedor leva os aliases dele junto", "recusa vencedor já
fundida", "refazer a cadeia não duplica aresta".

**`ARCHITECTURE.md` no mesmo commit:** §8.2, §14 (a linha de "fundir não é
atômico" ganha a consulta nova na conta).

## 5. A dúvida da menção chega à tela (B1)

`Revisao.tsx` lê tudo de `sobreDe`: `duvidosos` (`:432`), a classe `incerto`
(`:564`), o bloco de dúvida (`:602`) e o `sugestoes` da barra (`:725`).
`resolucao.ts` calcula `certo`, `motivo`, `alternativas` e `porque` **por
menção**, e o que a tela lê de `mencoesDe` é só o nome (`:381`).
`ARCHITECTURE.md` §4.7 promete o contrário com todas as letras.

**A lógica sai do componente, como as outras duas que quebram em silêncio.**
`montarCorpoDoConfirmar` e `montarGestos` já são funções puras exportadas da
`Revisao` por isso, e `tests/revisao.test.ts` só testa função pura — não há render
de componente no projeto e esta fatia não introduz um.

`duvidosos` e a classe `incerto` passam a olhar a lista de referências incertas
do átomo; o bloco de dúvida ganha **uma linha por referência incerta**, dizendo
se é o sujeito ou qual menção; e cada `SeletorEntidade` de menção recebe as
`alternativas` da referência daquela posição.

**A armadilha, e ela é silenciosa:** as menções na tela são uma lista de strings
por posição (`v.menciona`), e a referência casa com a posição **por índice**.
Assim que eu acrescento ou removo uma menção naquele átomo, o índice desloca e a
sugestão apareceria na linha errada. A trava é a que já existe: enquanto
`edicoes[a.indice]?.menciona === undefined` a lista é a da proposta e o índice
vale; a partir da primeira edição as sugestões daquele átomo somem. Isso vai no
teste, não só no comentário.

**O custo é real e vai declarado:** esta é a tela mais apertada do sistema e o
"menos de 60 s" segue sem medição (§14). A mitigação é o formato — **um**
parágrafo de dúvida por átomo, listando as referências incertas, não um bloco por
referência.

**`ARCHITECTURE.md` no mesmo commit:** §4.7, §4.8.

## 6. O porquê deixa de depender da dúvida (B2)

```tsx
{incerto && ref.porque.length > 0 && ( … )}
```

§4.10, `tipos.ts:143-160` e o cabeçalho de `candidatosPorVizinhos` dizem a mesma
frase: a camada 3b herda atribuição passada, e **a única coisa que a torna
aceitável é estar na tela** — "Sem o `porque`, esta camada não entraria." Ela está
na tela só quando o agente hesitou. No caminho comum (`certo: true`) a herança é
invisível.

Sob a 4.9 o laço fecha inteiro e sem janela: átomo passado → camada 3b → dossiê →
o extrator escreve o nome canônico **dentro do `texto`** → o vetor daquele átomo
sai desse texto → vota na próxima. É a realimentação que a 4.5 recusou ao deixar
os átomos fora de `fonteDaEntidade`, entrando pela outra porta.

1. mostrar o `porque` sempre que existir — uma linha discreta, não o bloco de
   dúvida;
2. `ReferenciaResolvida` ganha `camada?: Camada`, que é o que deixa a tela dizer
   **por que** aquele nome foi escolhido ("a grafia bateu" contra "dois átomos
   seus votaram"). Hoje o `porque` chega sem dizer se decidiu alguma coisa. Campo
   opcional, ausente = proposta antiga — mesmo padrão de `certo` e `porque` em
   `referencias.comoReferencia`. Já nasce pronto para a 4.9, que acrescenta
   `"extrator"` a `Camada`.

**Mudança de tipo em `tipos.ts` obriga `ARCHITECTURE.md` no mesmo commit**
(CLAUDE.md): §4.8, §4.10, §4.7.

## 7. Os dois de brinde (E4, E5)

- **E4** — `catalogo.ts:23-26` diz que `perfil` "fica de fora" de
  `GET /api/entidades`; a rota devolve `listarEntidades()` inteiro, com os três
  campos, e a revisão baixa o perfil do grafo todo a cada abertura. Enxugar o
  payload: o §14 já declara que a revisão carrega o grafo inteiro, e o perfil é o
  campo mais pesado de uma resposta que ninguém lê ali.
- **E5** — `entidades.ts:474`, `MATCH (a)-[:SOBRE|:MENCIONA]->(e)` dá duas linhas
  se as duas arestas existirem; `count(DISTINCT a)` protege o voto, o `collect`
  do `porque` não. Hoje inalcançável (`atomos.ts:157` e `fusao.ts:126-131`
  impedem o par), mas é invariante mantida a distância.

Nenhum dos dois pede `ARCHITECTURE.md`.

---

# Parte 2 — o que sobra para a 4.9

| | O quê |
|---|---|
| **E6** | com `TOP_K = 4` e `extrator` na cabeça, `exato` + parecidos podem ocupar as quatro vagas e espremer o vetor para fora. O dossiê já traz o semântico pelo lado do extrator, então pode estar certo — mas tem de ser decisão escrita, não consequência acidental da ordem do laço |
| **A2, a frase** | `INSTRUCOES` repete a regra de tipo ("SENTIMENTO, APRENDIZADO e ROTINA são sempre de `eu`"), para o agente não gastar a decisão. Muda o texto → sobe para `resolucao-3`, que a 4.9 já ia gastar |
| **C1, a frase** | o prompt diz, por menção, que só as chaves listadas **naquela** menção valem. Sob a 4.9 a distância entre o que o prompt mostra (até 30 do dossiê) e o que o código aceita (4 candidatos) cresce |
| **E3** | `comEsperaDeLimite` — a 4.9 já faz |

---

# Parte 3 — vai para o §14, não vira código

- **D1, o resto.** `ja_nesta_sessao` (4.9, §2) amarra o **extrator** às entidades
  já atribuídas nas janelas anteriores. O agente 2 continua livre para discordar
  de si mesmo entre janelas: provado, "Rafa" → `NOVA` na janela 1 e → `Raffa` na
  janela 2, com o mesmo catálogo, fechando a sessão com duas candidatas para uma
  pessoa. Reduzido, não eliminado. O complemento barato — o mapa
  `citado → decidido` da sessão entrando como camada em `candidatosDe` — fica
  anotado, não construído.
- **D3.** `estende` (`janela.ts:161-175`) troca o `texto` e mantém
  `sobre`/`menciona`/`perfila` da janela de origem. É decisão declarada
  (`PROXIMA-SESSAO.md` §5) e é a certa; falta declarar a consequência: `a.texto`
  é a **fonte única** do vetor do átomo (§4.10), então um átomo estendido entra no
  índice com o texto da última janela e a atribuição da primeira.

---

## O que muda em `Specs/slice-4.9.md`

Não editei o arquivo. Seis emendas, quando esta fatia entrar:

1. **linhas 210-211** — "então o hash muda e `garantirEmbeddings` reembute a
   entidade sozinho" passa a ser verdade, e vale citar de onde: o gancho no
   confirmar e nas rotas de entidade, da 4.8.1.
2. **§5, recusa 2 de `registrarGrafia`** — hoje recusa `nome_normalizado` que "já
   existe como nó **ativo**". Falta a terceira: chave que já existe como nó
   `fundida` apontando para **outro** nó. Com a reposição da 4.8.1 o caso fica
   raro; a guarda continua sendo correção, não política.
3. **§4** — a lista do que o `resolucao-3` muda ganha E6 e as duas frases de
   prompt (A2 e C1). O resto do que eu tinha adiado para lá **volta para a
   4.8.1**, porque o §4 declara que "a degradação é a de hoje, item por item" —
   ou seja, a 4.9 herda os defeitos em vez de reescrevê-los.
4. **"Fora de escopo → Tela. Nenhuma."** — continua verdade, e agora **porque** a
   4.8.1 já mexeu na tela. Sem essa frase, a 4.9 promete que a discordância entre
   os dois agentes aparece numa tela que não a mostra.
5. **"Limites que esta fatia cria"** — acrescentar o resto de D1.
6. **"Ordem de execução"** — a 4.8.1 entra como pré-requisito do passo 2, ao lado
   das validações da 4.8 que a nota já exige.

## Idempotência

| Trava | Onde | Efeito |
|---|---|---|
| `embedding_fonte` + `embedding_modelo` | `garantirEmbeddings` | o gancho novo rodando à toa custa uma consulta e zero chamada de modelo |
| `MERGE` + `DELETE` na reposição de alias | `fundir` | refazer a fusão não duplica aresta nem perde alias |
| as travas da 4.8 | `janela.ts` | intocadas |

Nenhum `prompt_version` muda nesta fatia. `resolucao-2` continua `resolucao-2`, e
o `resolucao-3` fica reservado para a 4.9.

## Fora de escopo

- **Medir os pisos.** `PISO_PERFIL` e `PISO_VIZINHOS` continuam ponto de partida
  (§14). Esta fatia faz a camada 3a **existir**; calibrá-la é olhar a revisão.
- **Desfazer fusão.** Continua não existindo (§14).
- **Editar a marca de perfil na revisão.** Segue como está (§14).
- **Rota de busca de entidade.** E4 enxuga o payload, não muda o desenho.

## O que muda de arquivo

```
src/lib/resolucao.ts       parser, motivos, fallback, dedupe, guarda de tipo, gateway
src/lib/entidades.ts       doc de garantirEmbeddings + DISTINCT (E5)
src/lib/fusao.ts           reposição de alias, guarda de vencedor fundida
src/lib/catalogo.ts        o comentário que mente (E4)
src/lib/tipos.ts           ReferenciaResolvida.camada?
src/lib/referencias.ts     comoReferencia lê camada ausente
src/components/Revisao.tsx as referências incertas, o bloco de dúvida, sugestoes por menção
src/app/api/entidades/route.ts                       enxuga o perfil do payload
src/app/api/sessoes/[id]/confirmar/route.ts          waitUntil(garantirEmbeddings())
src/app/api/entidades/{perfil,renomear,fundir,tipo,criar}/route.ts   idem
tests/resolucao.test.ts    array solto, motivo próprio, NOVA colidindo, fallback, dedupe, eu
tests/fusao.test.ts        cadeia, vencedor fundida, refazer
tests/revisao.test.ts      as incertas, e a trava do índice deslocado
tests/entidades-grafo.test.ts  o gancho dispara, e duas vezes embute uma
ARCHITECTURE.md            §2, §4.7, §4.8, §4.10, §8.2, §8.4, §14
```

Nenhuma migration. Nenhuma rota nova. Nenhum agente novo. Nenhum prompt alterado.

## Ordem de execução

Sete passos, cada um verde no `pnpm test` antes do seguinte, cada um um commit —
com a fatia do `ARCHITECTURE.md` **no mesmo commit** (CLAUDE.md).

| # | Passo | Por que nesta posição |
|---|---|---|
| 1 | esta spec | |
| 2 | **A1 + C1 + C2 + C3 + D2 + E1 + E2** — o lote de `resolucao.ts` | o mais barato, e põe instrumento antes da primeira janela real |
| 3 | **A2** — a guarda do `"eu"` | é o único achado que corrompe dado em toda sessão gravada daqui até o conserto |
| 4 | **as validações da 4.8** (`PROXIMA-SESSAO.md` §2) | gravar 3 min e olhar. Aqui, e não antes: com 2 e 3 no ar, a primeira janela real roda com o log honesto e sem reatribuir sujeito |
| 5 | **A4** — o vetor da entidade volta a existir | o que a 4.9 mais espera; sem ele a 3a e o RAG `perfil` são código que não pode achar nada |
| 6 | **A3** — cadeia de fusão e guarda de vencedor | irreversível quando acontecer, e a 4.9 fabrica os nós que o expõem |
| 7 | **B1 + B2 + E4 + E5** — a tela e os dois de brinde | fecha a condição declarada da 3b antes de a 4.9 realimentá-la pelo texto |

O passo 4 é a única coisa aqui que não é código, e é a mais importante: **nenhuma
janela real foi extraída até hoje.** Empilhar 4.8.1 e 4.9 inteiras sobre uma 4.8
não medida faz qualquer estranheza ficar sem dono.

## Limites que esta fatia cria

- **O confirmar passa a disparar uma passada de embedding**, em `waitUntil`, fora
  do caminho da resposta, engolindo falha. É mais uma coisa acontecendo depois do
  clique que eu não vejo; o sinal é a linha `[entidades]` no log.
- **A fusão ganha uma sexta consulta e continua sem transação.** O limite do §14
  muda de tamanho, não de natureza. Refazer continua curando.
- **A revisão fica mais densa**, na tela que tem 60 s e nunca foi cronometrada. Se
  incomodar, o botão é o formato do parágrafo de dúvida, não voltar a esconder a
  informação.
- **`ReferenciaResolvida.camada` nasce opcional e assim fica.** Proposta antiga
  não tem, e a tela não diz de onde veio a sugestão naquela sessão — mesma
  degradação que `porque` e `certo` já têm.
- **A regra de tipo passa a ser arbitrada em dois lugares** — pedida ao extrator
  no prompt, imposta pelo código na resolução. Enquanto a frase não entrar no
  `resolucao-3` (4.9), o agente 2 continua gastando decisão numa pergunta cuja
  resposta o código já sabe.
