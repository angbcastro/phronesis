# Slice 4.9 — O extrator conhece o grafo

**Objetivo:** dar ao extrator, **antes** de ele ler cada janela, a lista de quem
o grafo acha que aquele trecho cita — buscada por RAG a cada bloco transcrito.
Com a lista na mão ele extrai já apontando o nó canônico: por mais que eu tenha
dito "giam", o nó atribuído é "Giampaolo Lepore", e é esse nome que entra no
texto do átomo.

**Pronto quando:** eu importo de novo o áudio real em que o STT ouviu "Jean", e a
proposta chega com o átomo dizendo "Giampaolo Lepore", o sujeito apontando o nó
que já existe, e a referência guardando `citado: "Jean"`. Confirmo, e "jean"
passa a existir no grafo como grafia daquele nó — de modo que na sessão seguinte
ele resolve por casamento exato, de graça. E uma sessão com o grafo vazio sai
exatamente como saía na 4.8.

## Por que agora

**Porque é o erro mais frequente que o sistema comete, e ele foi medido.** Nas 5
primeiras sessões reais confirmadas, **um terço das 21 correções capturadas era
conserto de grafia de nome próprio que o STT errou** — "Beijing"→"Behring
Founders", "Jean"→"Giampaolo Lepore", "Dapta"→"Adapta" — e não erro de extração.
Elas saem etiquetadas `extracao` ou `grafo` porque o extrator copiou fielmente o
que a transcrição dizia: a culpa não é dele.

**E porque nenhuma das duas defesas existentes alcança o caso.** O vocabulário do
STT (§4.4) ensina grafia de nome que eu **já tenho** no grafo, e mesmo assim
"Adapta" continuou saindo como "na data" na medição de 02/09. A camada de string
do agente 2 mede Levenshtein e palavra em comum, e "giam" fica longe demais de
"giampaolo lepore" nos dois — é apelido, não erro de uma letra.

**O que isto inverte.** `ARCHITECTURE.md` §4.6 diz hoje, com todas as letras, que
o prompt da extração **não sabe que entidades existem no grafo, e é de propósito**
— cinco versões de calibração produziram uma extração que presta, e enfiar o
catálogo lá arriscaria o que está bom por um problema que não é dele. A inversão
é deliberada, e o argumento que a sustenta é que o problema **é** dele: quem
escreve o texto do átomo é o extrator, e é no texto que o nome errado se fixa —
inclusive dentro do vetor, que sai só de `a.texto` (§4.10).

**O que isto não é:** não é entregar o catálogo inteiro ao extrator. É entregar
os até 30 nós que o trecho parece citar, escolhidos por busca. Com um grafo
pequeno os dois são a mesma coisa; a diferença aparece quando ele cresce, e o
desenho tem de estar pronto antes disso.

## As quatro decisões

Perguntadas antes de a fatia começar, porque as quatro são de produto e nenhuma
se infere do código.

| Decisão | Escolhido | O que foi recusado, e por quê |
|---|---|---|
| **O que acontece com o agente 2** | **continua validando toda menção** | "Vira árbitro do que sobrou" era mais barato, e "some, vira um agente só" era mais barato ainda. Nenhuma atribuição do extrator entra sem segunda opinião — e o preço é explícito: o **crit. 5 da slice 4 morre**, sessão sem ambiguidade passa a pagar |
| **O texto do átomo** | **herda o nome canônico** | Guardar a grafia falada respeitaria ao pé da letra a regra `COM AS MINHAS PALAVRAS`, mas o vetor do átomo sai **só** de `a.texto`: texto com nome errado envenena a camada dos vizinhos para sempre, e é ela que sugere a próxima atribuição |
| **A grafia falada no confirmar** | **vira alias do nó** | "Nunca automático" protegeria o grafo de aprender erro do STT. Recusado: sem isso "giam" depende do RAG toda sessão, e com isso ele resolve por casamento exato já na seguinte |
| **Marcas de perfil** | **aceito que fiquem mais raras** | Nada a construir. Com o agente 2 rodando em toda janela elas na prática não ficam raras — a resposta se anulou com a primeira decisão, e fica registrada assim de propósito |

## 1. O RAG por bloco

`src/lib/recuperacao.ts`, novo. Recebe o texto de um bloco e o catálogo; devolve
quem o grafo acha que aquele trecho cita. **Cinco camadas aditivas**, e a segunda
é a que faz o caso "giam" funcionar:

| Camada | Sinal | Pega |
|---|---|---|
| `exato` | n-grama de 1..3 tokens do bloco = uma `chave` do catálogo | grafia conhecida, alias inclusive |
| `prefixo` | **nova** — token de ≥4 letras que é prefixo de uma palavra de uma chave de ≥6 letras | "giam" → "giampaolo lepore" |
| `parecido` | `proximidade()` de `duplicatas.ts` sobre os mesmos n-gramas | homófono: "Bejewel" → "Behring Founders" |
| `perfil` | `candidatosPorPerfil` com o texto do bloco | entidade com perfil e sem átomo |
| `vizinhos` | `candidatosPorVizinhos`, voto por `:SOBRE`/`:MENCIONA` | entidade com átomos e sem perfil |

As três primeiras são **puras** — `candidatasPorGrafia(texto, catalogo)`,
testável sem rede, mesma divisão que `duplicatas.ts` já tem. As duas últimas
reusam `candidatosSemanticos` de `entidades.ts` **sem alterá-lo**: ele já aceita
texto arbitrário e já engole a própria falha devolvendo lista vazia.

Guardas contra falso positivo: n-grama de **um** token exige ≥4 letras e não ser
pronome (`ehPronome`, `texto.ts`); a camada `prefixo` exige palavra-alvo de ≥6
letras, senão "casa" puxa "Casanova". Teto `TETO_POR_BLOCO = 12`.

**Onde vive, e a trava:** `sessoes/<id>/candidatas_NNN.json`, e a existência do
objeto é a chave de idempotência — espelho exato de `chunk_NNN.json` (regra 4).

**O arquivo diz se a camada semântica de fato rodou** (`semantico: boolean`). Com
o Gateway sob rate limit, `candidatosSemanticos` devolve lista vazia e o arquivo
sairia **degradado e cacheado como completo**; com o campo, o catch-up do
`/finalizar` recalcula uma vez os que saíram `false`. Sem ele, um limite de 75 s
no meio da gravação apagaria o vetor da sessão inteira em silêncio.

**Gatilho:** o `waitUntil` do `/pronto`, encadeado **entre** os dois passos que
já estão lá, porque a janela precisa das candidatas dos blocos dela:

```
transcreverBloco(id, i) → recuperarCandidatas(id, i) → avancarJanelas(id)
```

Falhar aqui **nunca** derruba nada: sem `candidatas_NNN.json` o dossiê fica
menor, e dossiê vazio faz o extrator se comportar exatamente como na 4.8. É a
regra de precedência da 4.5 — nada no caminho do vetor impede uma gravação.

## 2. O dossiê da janela

`dossieDaJanela()`, puro, no mesmo módulo. A janela `n` recebe a união de duas
fontes, e a segunda é de graça:

1. as `candidatas_NNN.json` dos blocos **daquela janela**;
2. as entidades **já atribuídas nas janelas anteriores**, lidas de
   `parcial.atomos` por `sobreDe`/`mencoesDe` — camada `ja_nesta_sessao`, e ela
   vai na **frente de todas**. É o sinal mais forte que existe dentro de uma
   sessão, e é o análogo incremental do "procure o nome na transcrição INTEIRA"
   que o prompt base já manda fazer.

União por `chave`, ordenada `ja_nesta_sessao > exato > prefixo > parecido >
vizinhos > perfil`, depois score, depois `sessoes`; teto `TETO_DO_DOSSIE = 30`.
`avancarJanelas` calcula as candidatas que faltarem antes de extrair a janela —
catch-up idempotente, dentro do `ate` que ele já recebe.

Com um grafo pequeno o teto de 30 significa na prática "o catálogo inteiro
entra", e isso está certo: o RAG só começa a **selecionar** quando o grafo passa
de 30 entidades.

## 3. `extracao-7`: um bloco injetado, e a base intacta

**`INSTRUCOES_BASE` e `FORMATO` não mudam um byte.** O bloco novo entra por
`inserirAntesDoFormato`, como `blocoDeRegras` e `blocoDaJanela` já entram, e
declara a chave nova **de dentro de si** — precedente que o `estende` da 4.8
abriu:

```
INSTRUCOES_BASE → blocoDeRegras → blocoDasCandidatas → blocoDaJanela → FORMATO → texto
```

`blocoDasCandidatas(dossie)` devolve `""` com dossiê vazio, e aí **a chamada sai
byte a byte igual à da 4.8**. Grafo vazio, primeira sessão da vida do sistema,
Gateway fora: tudo como antes. É o mesmo no-op que `blocoDeRegras([]) === ""`
garante desde a 4.6.

O que o bloco manda fazer:

- lista as candidatas com **chave**, nome gravado, tipo, aliases e `contexto`;
- devolver a **chave** quando a menção for uma delas, `null` quando não for, e
  **nunca inventar chave fora da lista**;
- escrever no `texto` do átomo o **nome gravado**, não o que a transcrição
  escreveu — com a amarra explícita de que **só o nome próprio se troca**, e que
  no resto continua valendo `COM AS MINHAS PALAVRAS`;
- devolver em `citado` a grafia como ela aparece na transcrição;
- o envelope: `"sobre":{"citado":"Jean","chave":"giampaolo lepore"}`, e
  `menciona` como lista desses objetos.

`AtomoCru.sobre` passa de `string` para
`MencaoCrua = { citado: string; chave: string | null }`, e `menciona` para
`MencaoCrua[]`. **`parsearResposta` aceita as duas formas** — string vira
`{ citado, chave: null }` —, que é o que mantém intacto o caminho sem dossiê e lê
qualquer resposta no formato antigo.

`AtomoProposto`, `Extracao` e `Parcial` **não mudam**: `janela.ts`,
`referencias.ts`, `correcoes.ts` e a revisão não têm formato novo para aprender.
`EstadoJanela` ganha `candidatas?: string[]` — as chaves que aquela janela viu,
que é procedência (regra 7) e é o que responde "por que ele apontou aquele nó"
três meses depois. Campo opcional em JSON do R2: nada a migrar.

**`PROMPT_VERSION` sobe para `extracao-7`** mesmo com a base igual: a **entrada**
mudou. O precedente é o `extracao-6` da própria 4.8.

## 4. `resolucao-3`: valida toda menção

- `candidatosDe` ganha a chave do extrator como **quinta camada, `extrator`**, na
  cabeça da união; `TOP_K` sobe de 3 para 4 para ela caber junto com as três.
  Chave que não existe no catálogo é **descartada em silêncio**, mesma regra que
  `comoCandidatos` já aplica ao que o vetor devolve.
- `decidir()` continua como está, mas o resultado dele vira o **prior**, não a
  resposta: toda menção da janela passa a ser `Pendente` e entra no prompt.
- O prompt diz, por menção, `o extrator apontou "giampaolo lepore"` — ou que ele
  não apontou nenhuma —, seguido dos candidatos com o `porque` de cada um. O
  bloco `ÁTOMOS JÁ PROPOSTOS ANTES DESTA JANELA` da 4.8 fica onde está.

| A resposta do agente | O que fica |
|---|---|
| concorda com o extrator | `certo: true`, motivo curto |
| discorda | a do agente 2 vence, `certo: false` — dois agentes discordando é exatamente o que a revisão tem de ver |
| não respondeu, ou falhou | o **prior** de `decidir()`, com o `certo` de hoje |

A degradação é a de hoje, item por item: nunca o parecido, sempre o exato quando
existe, ou entidade nova quando não.

**`comEsperaDeLimite` entra na chamada da resolução.** A 4.8 deixou isso fora de
escopo de propósito; esta fatia é o que torna o conserto necessário — o agente
passa a rodar em **toda janela**, oito vezes por sessão de 15 min, na mesma
rajada em que o STT já disputa o limite da conta.

**`PROMPT_VERSION_RESOLUCAO` sobe para `resolucao-3`:** a entrada mudou duas
vezes — a chave do extrator, e o fato de a lista ser de todas as menções.

> **Emenda da 4.8.1 — o que mais entra no `resolucao-3`.** Como esta fatia é a
> que sobe a versão do prompt, as duas frases que a 4.8.1 recusou subir por conta
> própria vêm junto, e com elas uma decisão de ordem:
>
> - **a regra de tipo, em `INSTRUCOES`**: "SENTIMENTO, APRENDIZADO e ROTINA são
>   sempre de `eu`". A guarda de código já existe desde a 4.8.1 e recusa o
>   julgamento que quebra a regra; a frase é o que impede o agente de gastar a
>   decisão numa pergunta cuja resposta o código já sabe. Ela vale igual para o
>   **extrator**: `blocoDasCandidatas` não pode fazer o `sobre` de um SENTIMENTO
>   apontar para um nó do dossiê, e a mesma guarda entra no parse do passo 4;
> - **o escopo das chaves, por menção**: o prompt diz que só as chaves listadas
>   **naquela** menção valem. A distância entre o que ele mostra (até 30 do
>   dossiê) e o que o código aceita (4 candidatos) cresce nesta fatia;
> - **E6, e é decisão, não consequência**: com `TOP_K = 4` e `extrator` na
>   cabeça, `exato` mais dois parecidos ocupam as quatro vagas e espremem o vetor
>   para fora da união. Pode estar certo — o dossiê já traz o semântico pelo lado
>   do extrator —, mas tem de ser escrito aqui, e não sair da ordem do laço.
>
> O resto do que a primeira versão desta lista adiava voltou para a 4.8.1 e já
> está feito: o parser, os motivos, o fallback, a dedupe de menção. O §4 acima
> diz que "a degradação é a de hoje, item por item" — ou seja, esta fatia herda o
> que estiver lá, e o lugar de consertar era antes.

## 5. A grafia vira alias no confirmar

`fusao.ts` ganha `registrarGrafia(chaveDoNo, grafiaFalada)`, que cria o nó de
alias exatamente como `renomear` já faz: `:Entidade` com `status = 'fundida'` e
`-[:FUNDIDA_EM]->` o nó. Três recusas, e as três são correção, não política:

1. grafia vazia, pronome (`ehPronome`), ou igual à chave do próprio nó;
2. `nome_normalizado` que **já existe como nó ativo** — seria fundir duas
   entidades reais automaticamente, e fusão nunca é automática;
3. `nome_normalizado` que já existe como nó **`fundida` apontando para outro
   nó** — criar a aresta ali roubaria a grafia de quem já a tem, ou a deixaria
   com dois destinos (emenda da 4.8.1). Com a reposição de alias que a 4.8.1 pôs
   em `fundir()` o caso fica raro; a guarda continua sendo correção, não
   política;
4. segunda chamada com a mesma grafia é no-op — a checagem prévia é a trava.

`POST /api/sessoes/:id/confirmar` chama **em `waitUntil`, depois de
`gravarAtomos`**: casa `original.sobre.citado` e `original.menciona[i].citado`
— relidos de `extracao.json` pelo índice, nunca do corpo (§4.7) — com a chave
final vinda da tela, e registra quando as duas diferem. Falha só loga
`[grafias]`: mesma precedência do embedding, nada no caminho do alias impede uma
gravação.

Dois efeitos de graça: `fonteDaEntidade` inclui aliases, então o hash muda e
`garantirEmbeddings` reembute a entidade sozinho; e `nomesParaVocabulario`
exclui fundidos, então "Jean" **não** é ensinado ao STT.

> **Emenda da 4.8.1.** O primeiro só é verdade desde ela. Até a 4.8,
> `garantirEmbeddings` tinha um chamador só — `POST /api/entidades/embutir`, uma
> rota que nenhuma tela chama —, e "a próxima passada" não existia. Quem a roda
> agora é `passadaDeVetores()`, em `waitUntil`, no confirmar e nas cinco rotas de
> `/entidades`. O alias desta fatia entra na fonte e é reembutido no mesmo gesto
> que o cria.

**Este alias não é uma fusão.** O nó nasce com zero átomo e nenhuma aresta a
migrar, então desfazê-lo é apagar a aresta e o nó — ao contrário de uma fusão de
verdade, que não tem desfazer. A distinção vai escrita no `ARCHITECTURE.md` §8.2,
cuja primeira linha ("Nada aqui é automático") deixa de ser verdade com esta
fatia.

## 6. Idempotência

| Trava | Onde | Efeito |
|---|---|---|
| existência de `candidatas_NNN.json` | `recuperarCandidatas` | bloco não é reconsultado nem repago |
| `semantico: false` | catch-up do `/finalizar` | a camada que caiu é refeita **uma** vez, não a cada passada |
| checagem prévia da grafia | `registrarGrafia` | confirmar duas vezes não cria dois aliases |
| as quatro da 4.8 | `janela.ts` | seguem valendo sem mudança |

## Fora de escopo

- **Nome dito depois da janela.** Se eu digo "ela" no minuto 2 e o nome no
  minuto 10, a janela 1 continua sem saber — mesma limitação que a 4.8 já
  declarou, mesmo conserto: o painel de entidades da revisão, num gesto.
- **Realimentar o vocabulário do STT.** A candidata achada no bloco 3 poderia
  entrar como `keyterm` do bloco 4. É outra fatia: mexe em `vocabulario.ts`, no
  cache de 5 min e no teto de 100 termos.
- **Um agente que julgue a lista de candidatas.** O julgamento é do próprio
  extrator, que já está com a lista e o texto na frente. Um sexto prompt para
  calibrar à mão para sempre não se paga.
- **Tela.** Nenhuma — e agora **porque** a 4.8.1 já mexeu nela. O `porque` de
  cada sugestão chega à revisão pelo caminho da 4.5, e desde a 4.8.1 ele aparece
  sempre, não só na dúvida; a discordância entre os dois agentes sobre uma
  **menção** também aparece, que é o que a linha "discorda → `certo: false`" do
  §4 promete. Sem aquela fatia, esta prometeria a discordância numa tela que não
  a mostrava.

## O que muda de arquivo

```
src/lib/recuperacao.ts    novo — o RAG por bloco e o dossiê da janela
src/lib/chaves.ts         chaveChunkCandidatas
src/lib/extracao.ts       blocoDasCandidatas; parse das duas formas de menção
src/lib/resolucao.ts      camada `extrator`, TOP_K 4, toda menção ao agente,
                          comEsperaDeLimite
src/lib/janela.ts         o dossiê entra no que a janela recebe
src/lib/pipeline.ts       catch-up das candidatas dentro de avancarJanelas
src/lib/fusao.ts          registrarGrafia
src/lib/tipos.ts          MencaoCrua; EstadoJanela.candidatas
src/lib/agentes.ts        papel, gatilho, e o nó `candidatas` no desenho
.../chunks/[i]/pronto     encadeia recuperarCandidatas no waitUntil
.../[id]/confirmar        registra a grafia depois de gravar
tests/recuperacao.test.ts novo
```

Nenhuma tela. Nenhuma rota nova. **Nenhuma migration** — o grafo ganha nós de
alias, que é o mecanismo da 004, e nenhuma propriedade nova.

## Ordem de execução

Sete passos, cada um verde no `pnpm test` antes do seguinte, e cada um um commit.

> **Antes do passo 2, ler `PROXIMA-SESSAO.md` §2.** A 4.8 está commitada
> (`b71e860`) e **verificada só por teste**: nenhuma janela real foi extraída
> ainda, e a promessa dela — "de um a dois minutos para segundos" — continua sendo
> previsão. Esta fatia mexe no mesmo prompt e no mesmo caminho. **Rodar as
> validações da 4.8 primeiro**, com uma gravação de **3 min ou mais** — abaixo
> disso nenhuma janela fecha durante a fala e a sessão cai no passe único, sem
> exercitar o caminho novo uma vez. Empilhar a 4.9 sobre uma 4.8 não medida faz
> qualquer estranheza de volume ficar sem dono.
>
> **E a `Specs/slice-4.8.1.md` inteira antes disso** (emenda dela): ela é quem
> põe o vetor da entidade em dia — sem isso a camada 3a e a camada `perfil` do
> RAG são código que não pode achar nada —, quem conserta a cadeia de fusão que
> `registrarGrafia` vai exercitar em série, e quem faz a discordância de menção
> chegar à tela.

| # | Passo |
|---|---|
| 0 | ✅ feito: a 4.8 está commitada em `b71e860`, sozinha |
| 0.1 | **a `Specs/slice-4.8.1.md` inteira**, incluindo o passo 4 dela (as validações da 4.8 numa sessão real) — pré-requisito do passo 2 |
| 1 | esta spec |
| 2 | o RAG por bloco, puro + semântico, com teste |
| 3 | encadear no `waitUntil` e o dossiê da janela |
| 4 | `extracao-7`: o bloco das candidatas e o parse das duas formas |
| 5 | `resolucao-3`: valida toda menção, e a espera de rate limit |
| 6 | o alias no confirmar |
| 7 | painel, desenho e `ARCHITECTURE.md` |

**Depois do 3 o sistema roda inteiro e não mudou de comportamento**: as
candidatas são calculadas, gravadas e ignoradas. É o ponto de retorno barato — do
4 em diante, o que estranhar é do prompt, não do RAG.

## Limites que esta fatia cria (para o §14)

- Toda grafia confirmada vira nó permanente: o STT errando de três jeitos deixa
  três aliases pendurados no mesmo nó, e eles engordam a string canônica do vetor.
- O dossiê é uma **foto do grafo no momento da janela** — nome dito depois dela
  não volta atrás.
- A resolução passou a custar em **toda** janela, não só quando há dúvida.
- A camada `prefixo` é heurística **sem medição**: os pisos de 4 e 6 letras
  saíram de raciocínio, não de dado. Quem os ajusta sou eu, olhando a revisão,
  sessão real por sessão real.
- **O agente 2 continua livre para discordar de si mesmo entre janelas** (emenda
  da 4.8.1). `ja_nesta_sessao` (§2) amarra o **extrator** às entidades já
  atribuídas; o agente 2 não, e a mesma grafia pode sair `NOVA` numa janela e
  cair num nó na seguinte, com o catálogo idêntico. Reduzido, não eliminado. O
  complemento barato — o mapa `citado → decidido` da sessão entrando como camada
  em `candidatosDe` — fica anotado, não construído.

E um que **sai** do §14: a linha que diz que a resolução não espera rate limit.

## Como ficou

O que o `ARCHITECTURE.md` contava desta fatia — datas, medições, o que era
antes —, movido quase literal quando ele passou a descrever só o presente
(`Specs/documentacao.md`).

### Do cabeçalho do `ARCHITECTURE.md`

**E o extrator deixou de ignorar o grafo** (seções 4.6, 4.14 e 8.2). Era decisão
declarada até a 4.8 — "o prompt da extração não sabe que entidades existem, e é
de propósito" —, e a medição de 04/09 a derrubou: **um terço das 21 correções de
5 sessões reais era conserto de grafia de nome próprio que o STT errou**
("Jean"→"Giampaolo Lepore", "Dapta"→"Adapta"), e nenhuma das duas defesas
existentes alcançava o caso. Agora, a cada bloco transcrito, uma busca de cinco
camadas pergunta ao grafo quem aquele trecho parece citar, e a janela recebe o
**dossiê** das até 30 candidatas antes de extrair. O extrator responde
`{citado, chave}`: a grafia que a transcrição escreveu, e o nó que ele
reconheceu — e escreve o **nome gravado** dentro do texto do átomo, que é onde o
nome errado se fixava, inclusive dentro do vetor.

Três consequências, e as três são decisões: o agente 2 passou a **validar toda
menção** com candidato (o critério 5 da slice 4 morreu de propósito, e sessão
sem ambiguidade passou a pagar); a grafia que eu falei **vira alias do nó** no
confirmar, então "jean" resolve por casamento exato já na sessão seguinte; e a
primeira linha do §8.2 — "nada aqui é automático" — deixou de valer para o nó de
alias, que não é uma fusão porque nasce sem átomo e desfazê-lo é apagar duas
coisas.

*Fora de fatia, no mesmo período (07/09): `extracao-8` e a migration 007.*

**O diário passou a ter história e organização** (migration 007, seções 4.6 e
8.1). `:Atomo` ganhou o tipo `HISTORIA` — o episódio contado com o detalhe que
eu contei, e o único tipo em que o prompt manda **não** resumir, porque a
disciplina de volume que rege os outros sete espremeria uma noite inteira numa
linha. `:Entidade` ganhou o label `:Organizacao` — empresa, ONG, startup,
escola, cliente —, que até aqui nasciam `:Pessoa`, o padrão de quem o extrator
não classifica, ou `:Projeto`, quando ele via trabalho acontecendo. Os dois
prompts subiram junto: `extracao-9` e `resolucao-5`. **Nada é reclassificado
para trás**: a empresa que já está no grafo como `:Pessoa` continua `:Pessoa`
até eu trocar o tipo à mão em `/entidades`.

### Do §14 (limites conhecidos)

*Fora de fatia, no mesmo período: `extracao-8` e a migration 007.*

- **`HISTORIA` puxa contra a disciplina de volume, e as duas moram no mesmo
  prompt** (007). Uma seção manda destilar e não passar de 10 a 20 átomos; a
  outra manda não resumir o episódio. O extrator decide sozinho qual das duas
  vale para cada trecho, e o modo de falhar é conhecido de antemão nos dois
  sentidos: `HISTORIA` que engole o dia inteiro (uma janela que devolve um átomo
  gigante e nada mais), ou `HISTORIA` que nunca aparece porque a regra de volume
  venceu. Nenhum teste pega isso — é qualidade de extração, que eu avalio à mão
  na revisão, sessão real por sessão real —, e o conserto, se for preciso, é uma
  regra aprovada em `/calibracao`, não código.

- **Perfil, duplicatas e embedding não esperam o rate limit**, e é deliberado:
  saem de um clique meu e falham na minha frente (§5.3). STT, extração e — desde
  a 4.9 — resolução chamam `comEsperaDeLimite`.

- **O agente 2 pode discordar de si mesmo entre janelas.** Ele vê os átomos já
  propostos num bloco de contexto (§4.8), mas nada o amarra à decisão anterior —
  o `ja_nesta_sessao` da 4.9 amarra o **extrator**, não ele, então o risco ficou
  reduzido e não eliminado:
  o mesmo "Rafa" pode sair `NOVA` na janela 1 e cair no nó "Raffa" na janela 2,
  com o catálogo idêntico, fechando a sessão com duas candidatas para uma pessoa.
  Quem vê é a revisão, e o painel de entidades reaponta as duas num gesto. O
  complemento barato — o mapa `citado → decidido` da própria sessão entrando como
  camada em `candidatosDe` — está anotado e não construído.

- **A resolução passou a custar em toda janela**, não só quando há dúvida (4.9).
  São até oito chamadas de agente 2 por sessão de 15 min onde antes podia ser
  zero. Não medido sob rate limit, como quase tudo nesta faixa.

- **Uma menção sem candidato nenhum não é validada** (4.9). Ela resolve como
  entidade nova, de graça, sem passar pelo agente 2 — é o que mantém a promessa
  de a sessão com o grafo vazio sair como saía na 4.8, e é a única brecha na
  regra "nenhuma atribuição entra sem segunda opinião". A brecha é estreita por
  construção: sem candidato não há atribuição, só um nome novo.

- **A marca de perfil ficou mais frequente, não mais rara — e isso foi uma
  pergunta respondida ao contrário** (4.9). Até a 4.8 quem aponta perfil é o
  agente 2, e ele só era chamado quando alguma menção precisava de julgamento:
  numa sessão sem nome ambíguo, "o Rapha sabe produzir evento" **não** virava
  `:PERFILA`. A 4.9 pôs o agente 2 em toda janela com candidato, e na prática
  isso resolve o buraco de graça. O que fica registrado é o preço na direção
  oposta: a sessão limpa deixou de ser de graça, e é isso que o critério 5 da
  slice 4 comprava.

- **O agente 2 só enxerga os candidatos da menção, não o grafo inteiro.** Quem
  não casa por chave nem se parece por string nunca chega ao prompt — desde a
  4.9 o dossiê do extrator alcança mais um pedaço disso (prefixo e as duas
  camadas semânticas sobre o bloco), mas um apelido sem nenhuma letra em comum
  com o nome do nó ("Bidu" para "Roberto") continua virando entidade nova, e o conserto é fundir depois em `/entidades`. É deliberado —
  mandar o catálogo todo seria pagar por texto que não muda resposta nenhuma —,
  mas é um limite, não um detalhe. O que a barra pesquisável faz é baratear o
  conserto: o grafo inteiro está a duas letras de distância dentro do próprio
  átomo, então "Bidu" vira "Roberto" na revisão em vez de virar nó e fusão.

- **Um terço das correções capturadas é erro de STT, e sai etiquetado como erro
  de agente.** Medido em 2026-09-04, nas 5 primeiras sessões confirmadas: de 21
  correções, 5 eram conserto de grafia de nome próprio ("Beijing"→"Behring
  Founders", "Jean"→"Giampaolo Lepore", "Dapta"→"Adapta") e outras 2 misturavam
  grafia com edição de conteúdo. O extrator não errou nada nessas — ele copiou
  fielmente o que a transcrição dizia —, mas elas saem como `extracao` (correção
  de texto) ou `grafo` (renome), porque nenhum sinal no material distingue "o
  modelo escreveu errado" de "o microfone ouviu errado". O risco concreto é o
  `calibracao-2` ver quatro casos do mesmo padrão e propor, para o `extracao-9`,
  um padrão que conserta algo que nunca chegou até ele.
  **A saída foi construída na 4.9** (§4.14), e não é etiqueta nem regra de
  prompt: é a busca por bloco entregando ao extrator os nós que o trecho parece
  citar, para ele já apontar o nó e escrever o nome gravado no texto do átomo.
  O que continua valendo deste item é a **medição** e o risco enquanto a 4.9 não
  for verificada numa sessão real: correção de grafia que sobreviver à fatia
  continua saindo etiquetada `extracao` ou `grafo`, e o `calibracao-2` continua
  podendo propor padrão para um erro que nunca chegou ao extrator. O que segura é
  a amarra do `calibracao-2` e o meu descarte na pauta.

### Do §8 (Neo4j)

*Fora de fatia, no mesmo período: a migration 007.*

Depois das migrations 003 e 007 o contrato de `:Atomo` é:

`HISTORIA` entrou na 007, e é o contrário dos outros sete: eles pedem a
afirmação destilada, ela pede o episódio com o detalhe que foi contado (§4.6).
Ela entra também em `TIPOS_SEMPRE_EU` (`tipos.ts`), junto com `SENTIMENTO`,
`APRENDIZADO` e `ROTINA`. **Nenhum átomo muda de tipo**: o que o `extracao-7`
colapsou em `FATO` continua `FATO`, e o `prompt_version` carimbado é o que diz
por quê.

`:Organizacao` entrou na 007 e não trouxe constraint nem índice novo: as duas
constraints acima são por `:Entidade`, e valem para os quatro labels de uma vez.
A migration é um no-op, como a 003 e a 005 — label passa a existir quando o
primeiro nó o recebe, no confirmar. **Nada é reclassificado para trás**: a
empresa que já está no grafo como `:Pessoa` continua `:Pessoa` até eu trocar o
tipo à mão em `/entidades` (§8.2), e reclassificar em massa exigiria adivinhar
quais nós são empresas.

### Do §4.1–4.7 (o pipeline)

E desde a 4.9 há **um segundo bloco injetado**, no mesmo ponto e antes deste: o
dossiê das candidatas (§4.14). A ordem é `INSTRUCOES_BASE → blocoDasCandidatas →
blocoDaJanela → FORMATO → texto` — o dossiê primeiro, porque é material; a janela
depois, porque é sobre aquela chamada e mais nenhuma.

**Até a 4.8 este parágrafo dizia o contrário**, e com todas as letras: o prompt
da extração não sabia que entidades existem no grafo, e era de propósito. A
inversão é a slice 4.9 e está no §4.14, com o argumento que a sustenta: o
problema **é** do extrator, porque quem escreve o texto do átomo é ele, e é no
texto que o nome errado se fixa — inclusive dentro do vetor, que sai só de
`a.texto` (§4.10). O que **não** mudou é o resto: `INSTRUCOES_BASE` e `FORMATO`
continuam byte a byte os da 4.7, e o dossiê entra por um bloco injetado.

Quem confronta com o grafo continua sendo o passo seguinte (4.8), que atribui
**cada menção** a um nó — não cada nome. A diferença é a slice 4 inteira: dois
átomos da mesma sessão dizendo "Rafa" podem ser duas pessoas. Desde a 4.9 ele
vê também a chave que o extrator apontou, como quinta camada de candidato, e
valida **toda** menção que tenha candidato.

### Do §4.8, §4.8.1, §4.10 e §4.14 (identidade)

A frase equivalente dentro de `INSTRUCOES` — repetir a regra de tipo para o
agente não gastar a decisão à toa — **entrou no `resolucao-3`** (slice 4.9), que
era a fatia que já ia subir a versão do prompt de qualquer jeito. A regra passou
a ser dita nos dois prompts e imposta nas duas pontas do código; a migration 007
acrescentou `HISTORIA` aos três tipos, nos quatro lugares de uma vez, porque
`TIPOS_SEMPRE_EU` é a lista única que todos leem (§14).

`TOP_K = 3` sobre a **união** das quatro camadas, e piso de score por camada —
e desde a 4.9 são `TOP_K = 4` e cinco camadas (§4.14), porque a chave do extrator
tinha de caber **junto** com as três e não no lugar de uma.
Sem teto e sem piso, todo átomo ganha candidato e a lista de dúvida da revisão
vira lista de nomes. **Uma camada semântica sem piso é uma camada que sempre
acha alguém.**

O outro argumento que sustentava os dois **caducou na 4.9**: até a 4.8 eles eram
o que fazia `decidir()` não cair sempre em `julgar` e o critério 5 da slice 4
sobreviver — sessão sem ambiguidade não pagava nada, porque o caso comum era a
grafia casar com um nó e os vizinhos votarem **no mesmo nó**, união de tamanho 1,
decisão de graça. A 4.9 pôs o agente 2 em toda menção com candidato de propósito
(§4.14), e o critério morreu ali. O que **não** morreu é a deduplicação: ela
continua sendo o que mantém a lista curta e honesta.

**O erro mais frequente do sistema não era do extrator, e mesmo assim era ele
quem o fixava.** Medido em 2026-09-04, nas 5 primeiras sessões confirmadas: de
21 correções capturadas, **um terço era conserto de grafia de nome próprio que o
STT errou** — "Beijing"→"Behring Founders", "Jean"→"Giampaolo Lepore",
"Dapta"→"Adapta". O extrator não errou nada nessas; ele copiou fielmente o que a
transcrição dizia. Só que o texto do átomo é escrito por ele, e é no texto que o
nome errado se fixa — inclusive dentro do vetor, que sai só de `a.texto`
(§4.10).

Nenhuma das duas defesas existentes alcançava o caso. O vocabulário do STT
(§4.4) ensina a grafia de nome que **já** está no grafo, e ainda assim "Adapta"
saiu como "na data" na medição de 02/09. A camada de string do agente 2 mede
Levenshtein e palavra em comum, e "giam" fica longe demais de "giampaolo lepore"
nos dois — é apelido, não erro de uma letra.

Por isso a 4.9 inverte a decisão que o §4.6 declarava desde a slice 4: o prompt
da extração passa a saber que entidades existem. **Não o catálogo inteiro** — os
até 30 nós que o trecho parece citar, escolhidos por busca. Com um grafo pequeno
os dois são a mesma coisa; a diferença aparece quando ele cresce, e o desenho
tem de estar pronto antes disso.

Os três no mesmo `waitUntil` de `/pronto`, porque cada um precisa do anterior: a
busca precisa do texto, a janela precisa das candidatas dos blocos dela. **O
passo do meio nunca derruba os outros dois**: sem `candidatas_NNN.json` o dossiê
fica menor, e dossiê vazio faz o extrator se comportar exatamente como na 4.8. É
a regra de precedência da 4.5 — nada no caminho do vetor impede uma gravação —, e
o sinal é a linha `[candidatas]` no log.

`avancarJanelas` monta o dossiê antes de extrair, calculando o que faltar
(catch-up idempotente, dentro do `ate` que ele já recebe) e lendo o catálogo
**uma vez** por janela, que é o mesmo número de consultas de antes: ele agora
viaja para dentro de `extrairJanela`, que antes o lia sozinha.

#### `extracao-7`: um bloco injetado, e a base intacta

> Os dois números desta seção são os que **a 4.9 produziu**, e não os que estão
> em vigor: a migration 007 subiu os dois logo depois, para `extracao-8` e
> `resolucao-4`, e a 4.11 os subiu de novo, para `extracao-9` e `resolucao-5`
> (§4.6, §4.8 e §8.1). O que a 4.9 fez com o prompt continua descrito aqui; o que
> cada versão diz de si está em `PROMPT_VERSION` e `PROMPT_VERSION_RESOLUCAO`.

`INSTRUCOES_BASE` e `FORMATO` **não mudaram um byte**. O bloco novo entra por
`inserirAntesDoFormato`, como `blocoDaJanela` já entrava, e
declara a chave nova de dentro de si — precedente que o `estende` da 4.8 abriu.
`blocoDasCandidatas([])` devolve `""`, e aí a chamada sai **byte a byte igual à
da 4.8**: grafo vazio, primeira sessão da vida do sistema, Gateway fora. É o
mesmo no-op que toda fatia que injeta texto neste prompt garante — e o que torna
cada uma reversível olhando uma linha.

> **Como a candidata se apresenta mudou na 4.11**, e só isso: chave, nome, tipo,
> a marca de ficha oficial, as grafias **como lista** e o `resumo`, no lugar dos
> aliases concatenados numa string e do `contexto` isolado. É a mesma
> apresentação que o agente 2 vê — `apresentarEntidade`, uma função só (§4.8). O
> resto do bloco ficou byte a byte igual: ele foi calibrado e funciona. Foi essa
> troca que levou `PROMPT_VERSION` a `extracao-9`.

`AtomoCru.sobre` passou de `string` para
`MencaoCrua = { citado, chave: string | null }`, e `menciona` para
`MencaoCrua[]`. **`parsearResposta` aceita as duas formas** — string vira
`{ citado, chave: null }` —, que é o que mantém intacto o caminho sem dossiê e
lê qualquer resposta no formato antigo. `AtomoProposto`, `Extracao` e `Parcial`
não mudaram: a revisão e o confirmar não têm formato novo para aprender.
`EstadoJanela` ganhou `candidatas?: string[]`, que é procedência (regra 7) e é o
que responde "por que ele apontou aquele nó" três meses depois — o dossiê é uma
foto do grafo no momento da janela, e o grafo de hoje não a reconstrói.

**A guarda do `eu` ganhou o lado da extração.** A lista de conhecidos na frente
do modelo é convite para pendurar um `SENTIMENTO` em outra pessoa; o prompt pede
o contrário, e o parse recusa: nos quatro tipos que são sempre de `eu` (§4.8) a
chave cai, e o `citado` fica como veio — quem arbitra sujeito errado do extrator
continua sendo a revisão.

`PROMPT_VERSION` subiu para `extracao-7` mesmo com a base igual, pelo critério
de sempre: a **entrada** mudou. Precedente do `extracao-6` da própria 4.8.

#### `resolucao-3`: valida toda menção

- `candidatosDe` ganhou a chave do extrator como **quinta camada, `extrator`**,
  na cabeça da união; `TOP_K` subiu de 3 para 4 para ela caber **junto** com as
  três. Chave que não existe no catálogo é descartada em silêncio.
- `decidir()` continua como está, mas o resultado dele virou o **prior**, não a
  resposta: toda menção com candidato entra no prompt.
- **A menção sem candidato nenhum não vai.** Ali não há atribuição a validar — a
  união vazia é entidade nova, e a única resposta válida seria a que o prior já
  dá. É o que mantém a promessa de uma sessão com o grafo vazio sair como saía
  na 4.8, sem pagar uma chamada para descobrir que não havia o que perguntar.

**O critério 5 da slice 4 morreu aqui, de propósito.** "Sessão sem ambiguidade
não paga nada" era promessa da 4; desde que o extrator aponta o nó e escreve o
nome dentro do texto, nenhuma atribuição dele entra sem segunda opinião, e o
preço é uma chamada de resolução por janela em vez de "só quando houver dúvida".

Duas frases entraram no texto de `INSTRUCOES` junto, e são as que a 4.8.1 recusou
subir sozinha: **a regra de tipo** ("SENTIMENTO, APRENDIZADO e ROTINA são sempre
de `eu`" — a guarda de código já existia, e a frase é o que impede o agente de
gastar decisão numa pergunta cuja resposta o código já sabe) e **o escopo das
chaves por menção** (só valem as listadas naquela menção — a distância entre o
que o prompt mostra, até 30 do dossiê, e o que o código aceita, 4 candidatos,
cresceu nesta fatia).

E `comEsperaDeLimite` entrou na chamada. A 4.8 deixou isso fora de escopo; esta
fatia é o que torna o conserto necessário — o agente passou a rodar em **toda**
janela, oito vezes por sessão de 15 min, na mesma rajada em que o STT já disputa
o limite da conta (§5.3).

Nenhuma tela nova, e nenhum gesto novo. A camada `extrator` entra na procedência
que a revisão dá de toda referência com evidência — as mesmas de `perfil` e
`vizinhos` (§4.7) —, e pelo mesmo argumento, mais forte: ali o nome dentro do
texto do átomo deixou de ser o que eu falei, e o `citado` da referência é o que
guarda a grafia. A discordância entre os dois agentes chega como dúvida comum.

> Desde que as fontes viraram modal (§4.7), essa procedência é **alcançável**, e
> não mais exibida por padrão — e o `motivo` que o agente 2 escreve deixou de
> aparecer na tela em qualquer caminho. Ele continua no `extracao.json`, e é
> lá que se olha quando a atribuição surpreende. Está no §14.
