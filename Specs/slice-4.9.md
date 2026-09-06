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

## 5. A grafia vira alias no confirmar

`fusao.ts` ganha `registrarGrafia(chaveDoNo, grafiaFalada)`, que cria o nó de
alias exatamente como `renomear` já faz: `:Entidade` com `status = 'fundida'` e
`-[:FUNDIDA_EM]->` o nó. Três recusas, e as três são correção, não política:

1. grafia vazia, pronome (`ehPronome`), ou igual à chave do próprio nó;
2. `nome_normalizado` que **já existe como nó ativo** — seria fundir duas
   entidades reais automaticamente, e fusão nunca é automática;
3. segunda chamada com a mesma grafia é no-op — a checagem prévia é a trava.

`POST /api/sessoes/:id/confirmar` chama **em `waitUntil`, depois de
`gravarAtomos`**: casa `original.sobre.citado` e `original.menciona[i].citado`
— relidos de `extracao.json` pelo índice, nunca do corpo (§4.7) — com a chave
final vinda da tela, e registra quando as duas diferem. Falha só loga
`[grafias]`: mesma precedência do embedding, nada no caminho do alias impede uma
gravação.

Dois efeitos de graça: `fonteDaEntidade` inclui aliases, então o hash muda e
`garantirEmbeddings` reembute a entidade sozinho; e `nomesParaVocabulario`
exclui fundidos, então "Jean" **não** é ensinado ao STT.

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
- **Tela.** Nenhuma. O `porque` de cada sugestão já chega à revisão pelo caminho
  da 4.5.

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

| # | Passo |
|---|---|
| 0 | ✅ feito: a 4.8 está commitada em `b71e860`, sozinha |
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

E um que **sai** do §14: a linha que diz que a resolução não espera rate limit.
