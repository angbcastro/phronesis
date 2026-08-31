# Slice 4 — Identidade por contexto

**Objetivo:** o sistema descobre **de quem** eu estou falando pelo contexto, e
não pela grafia do nome. Duas pessoas cujo nome soa igual viram dois nós
distintos, e cada átomo vai para o certo.

**Pronto quando:** com o Raffa e o Rapha cadastrados e com perfil preenchido, eu
falo numa sessão só "fiz uma call com o Rapha pra fechar o evento" e "fui no
parque andar de slack com o Raffa", e na revisão os dois átomos aparecem
atribuídos a pessoas diferentes, sem eu ter tocado em nada.

## O fato que decide o desenho

**"Raffa" e "Rapha" são o mesmo som.** O STT vai escrever uma grafia só para os
dois — e ter os dois nomes no vocabulário não ajuda, só torna arbitrário qual
sai. A grafia na transcrição carrega **zero** sinal sobre quem é.

Isso mata de saída qualquer solução baseada em nome, e é o que separa esta slice
da 3. Lá o problema era duas grafias para a mesma coisa, e a chave
`nome_normalizado` resolvia. Aqui é o contrário — **uma grafia para duas
coisas** — e a chave não pode resolver, por construção. Só o contexto resolve.

## A arquitetura: dois agentes, não um

```
transcrição ──▶ agente 1: EXTRAÇÃO      (extracao-5, INTOCADO)
                  devolve átomos com o nome cru: "Rafa"
                        │
                        ▼
                agente 2: RESOLUÇÃO     (resolucao-1, novo)
                  vê os átomos + as entidades do grafo com perfil
                  decide, por menção: qual nó — ou nova
                  marca a confiança e o que é informação de perfil
                        │
                        ▼
                revisão ──▶ confirmar ──▶ grafo
```

**O `extracao-5` não muda.** Cinco versões de calibração produziram uma extração
que presta; enfiar o catálogo de entidades e a desambiguação dentro daquele
prompt arrisca justamente o que está bom, e por um problema que não é o dele. Os
dois agentes têm `prompt_version` própria (regra 7), calibram separado, e um erro
de atribuição se conserta sem tocar na extração.

De quebra: o agente 2 roda **sem re-extrair**. Calibrar a resolução não custa uma
chamada de extração a cada tentativa.

## Fora de escopo

- **Separar um nó que já conflacionou duas pessoas.** A máquina da slice 3 junta,
  não divide, e mover átomo entre entidades não existe. Hoje isso não morde — o
  grafo tem só `Isinha` e `eu` — e o caminho limpo é o passo zero abaixo.
- **Perfil escrito sem a minha aprovação.** O agente 3 propõe; quem grava sou eu.
- **As 2-4 perguntas do ritual e as relações entre átomos** (`:ATUALIZA`,
  `:CONTRADIZ`, `:CONFIRMA`) — slice 5, e continuam dependendo de material.
- Busca, tela Perguntar, `:Foco`, deduplicação de átomo.

## Passo zero: cadastrar os dois antes de falar

Antes de qualquer código desta slice funcionar para o seu caso, os dois têm que
existir no grafo. O "criar" da slice 3 (`/entidades`) já faz isso: nome, tipo, e
agora os três campos de perfil. Cadastrar **antes da primeira menção** é o que
evita o problema que esta slice não sabe desfazer — um nó só, com os átomos dos
dois misturados.

## Como a qualidade é avaliada

À mão, na revisão, como sempre. Sem gabarito, sem fixture, sem percentual.

A diferença é que agora existe um caso concreto de teste que **eu** sei a
resposta: a sessão com o Rapha e o Raffa. Se os dois átomos caem nos nós certos,
a resolução presta; se caem no mesmo, o que se ajusta é o `resolucao-1`.

## 1. Três campos de perfil em `:Entidade`

Texto livre, editáveis em `/entidades` do mesmo jeito que o nome já é:

| Campo | O que é |
|---|---|
| `contexto` | contexto geral sobre ela: quem é para mim — "colega de trabalho", "amigo, mora comigo" — e qualquer outra coisa que me seja relevante saber (momento de vida, situação, o que está acontecendo) |
| `pode_ajudar_com` | habilidades: o que sabe, com o que já trabalhou |
| `fizemos_juntos` | as histórias — o que já vivemos juntos |

Os três vão para o agente 2. `fizemos_juntos` é provavelmente o melhor
desambiguador dos três, porque atividade compartilhada ("slackline no parque") é
exatamente o que aparece na transcrição — mais do que um rótulo de relação.

Teto por campo, na ordem de 300 caracteres, para o prompt do agente 2 não inchar
conforme o grafo cresce. Entidade sem perfil nenhum entra no catálogo só com
nome e tipo, que é o comportamento de hoje.

## 2. A resolução é por menção, não por sessão

Hoje `coletar()` (`src/lib/entidades.ts`) colapsa todas as menções ao mesmo nome
numa `EntidadeCandidata` só, válida para a sessão inteira. **Isso deixa de
servir:** dois átomos da mesma sessão dizendo "Rafa" podem ser pessoas
diferentes, e uma candidata por nome não tem como expressar isso.

O resultado da resolução passa a viver no átomo:

```ts
interface ReferenciaResolvida {
  citado: string;        // o que o extrator escreveu: "Rafa"
  entidade: string;      // a quem foi atribuído: nome canônico do nó, ou nome novo
  conhecida: boolean;    // casou com nó do grafo, ou seria criada no confirmar
  certo: boolean;        // false = o agente não teve certeza; a revisão destaca
  alternativas: string[];// os outros candidatos, para o seletor já abrir com eles
  motivo: string;        // uma frase curta do porquê, mostrada na dúvida
}
```

`AtomoProposto.sobre` vira `ReferenciaResolvida` e `.menciona` vira
`ReferenciaResolvida[]`. O painel de entidades da revisão continua existindo,
agora como **visão agregada** do que foi resolvido — é lá que eu ainda decido se
uma entidade nova vira nó.

**Compatibilidade:** proposta antiga, com `sobre` string, é lida como resolvida
com `certo: true` e `conhecida` pelo casamento de nome. É o que impede as duas
sessões hoje em `em_revisao` de quebrarem a tela; re-extrair devolve o formato
novo.

## 3. Só chama o modelo quando há o que decidir

Antes do agente 2, uma passada determinística e de graça monta o conjunto de
candidatos de cada menção, reusando `proximidade` e `distancia` de
`src/lib/duplicatas.ts` — que pegam o caso homófono de brinde, porque "Rafa"
fica a uma ou duas letras de "Raffa" e de "Rapha".

| Situação da menção | O que acontece |
|---|---|
| um candidato exato, nenhum parecido | resolve ali, `certo: true`, não vai ao modelo |
| nenhum candidato | entidade nova, `certo: true`, não vai ao modelo |
| dois ou mais candidatos | vai ao agente 2 |
| um exato **e** um parecido | vai ao agente 2 |

A última linha é a que cobre o caso traiçoeiro: o STT escreve "Rapha" exatamente,
o casamento de string acerta por sorte, e como "Raffa" é parecido a menção vai
para o agente mesmo assim. Sem ela, metade das vezes o sistema acerta por
acidente e a outra metade erra em silêncio.

Se nenhuma menção precisar de julgamento, **o agente 2 não é chamado** e a sessão
não paga nada.

## 4. Dúvida destaca, não trava

Átomo cuja atribuição veio com `certo: false` aparece marcado na revisão, com a
sugestão **já preenchida** e o `motivo` ao lado. O confirmar continua liberado.

Diferente do pronome, que trava: ali o resultado seria um nó chamado "ela", grafo
apodrecido garantido. Aqui o pior caso é uma atribuição trocada, que eu conserto
depois — e travar a cada dúvida mataria os 60 s da revisão numa sessão que fale
muito das duas pessoas. "Ignorar é sempre uma saída válida" (visão §5.3).

### O seletor de sujeito

Hoje é um `<input>` de texto livre (`src/components/Revisao.tsx:365`). Vira
**filtro de tipo + lista pesquisável de todas as entidades do grafo**:
`<input list>` com `<datalist>`, que dá busca conforme eu digito sem biblioteca
nenhuma e sem estado novo na tela.

A lista vem de `GET /api/entidades`, que já existe e devolve exatamente isso —
nome, tipo, sessões e átomos. Rota nova nenhuma.

## 5. A marca de perfil é uma aresta

```
(:Atomo)-[:PERFILA { campo }]->(:Entidade)
campo ∈ contexto | pode_ajudar_com | fizemos_juntos
```

Quem marca é o **agente 2**, que já está olhando átomo e entidade juntos — mais
uma razão para o `extracao-5` não mudar.

Aresta, e não propriedade do átomo, por duas razões. A marca precisa dizer **de
quem** é a informação: "fui no parque andar de slack com o Raffa" é
`sobre: "eu"` pelas regras de tipo do `extracao-5`, e a informação de perfil é do
Raffa. E Neo4j não guarda array de mapa como propriedade — foi o que forçou as
listas paralelas da migration 003. Aresta com propriedade ele guarda bem, e fica
consultável: "todo átomo que diz o que o Rapha sabe fazer".

As arestas são gravadas **no confirmar**, junto com os átomos, e nunca antes
(regra 5).

## 6. O perfil se atualiza sozinho, e eu aprovo

**Agente 3 (`perfil-1`)**, sob demanda: um botão por entidade em `/entidades`, no
mesmo padrão do "procurar duplicatas" — coletar os átomos marcados é de graça, a
chamada de modelo não pode acontecer toda vez que a tela abre.

Ele junta os átomos ligados por `:PERFILA` àquele campo e propõe o texto novo. O
proposto aparece **ao lado** do atual, não por cima; eu aceito, edito ou ignoro.

Risco declarado: **o perfil é exatamente o que o agente 2 lê para desambiguar.**
Perfil rascunhado errado contamina toda atribuição futura, e o erro se
realimenta — átomo atribuído ao Rapha por engano vira evidência do perfil do
Rapha. É por isso que nada entra sem eu aprovar, e por isso que o texto atual
nunca é sobrescrito sem eu ver.

## Neo4j — migration 005

Proposta e aprovada antes de rodar (`CLAUDE.md`).

```
(:Entidade { …, contexto, pode_ajudar_com, fizemos_juntos })

(:Atomo)-[:PERFILA { campo }]->(:Entidade)
```

**Provavelmente zero statements**, como a 003: propriedade de valor livre não se
declara no Aura Free (constraint de existência é Enterprise) e tipo de relação
não se declara em Neo4j nenhum. Ela existe porque `db/migrations/` é a definição
canônica do schema, e quem for ler tem que ver o contrato inteiro.

Campo de perfil ausente conta como vazio, na leitura — mesma decisão do `status`
na 004, e pela mesma razão: a defesa tem que valer para o nó que um deploy antigo
criar amanhã, não só para os que existem hoje.

## Rotas

| Rota | Faz |
|---|---|
| `POST /api/entidades/perfil` | `{ chave, campo, texto }` — grava um dos três campos |
| `POST /api/entidades/perfil/rascunho` | `{ chave, campo }` — o agente 3 propõe; **não escreve nada** |
| `GET /api/entidades` | ganha os três campos no retorno; alimenta também o seletor da revisão |
| `GET /api/sessoes/:id/extracao` | mesma rota, proposta no formato novo |

Nenhuma rota nova de resolução: o agente 2 roda dentro do `waitUntil` da
extração, como parte do pipeline, e `POST /api/sessoes/:id/extrair` com
`{"forcar":true}` continua sendo o retry dos dois.

## Ambiente

```
RESOLUCAO_MODEL   opcional; padrão igual ao da extração
PERFIL_MODEL      opcional; padrão igual ao da extração
```

Os três agentes por `src/lib/modelos.ts`, string `provedor/modelo`, pelo Gateway
(regra 8). `tests/gateway.test.ts` continua sendo a guarda.

## Idempotência

| Trava | Onde |
|---|---|
| `extracao.json` existir | não rechama extração **nem** resolução; `forcar` refaz as duas |
| id do átomo `<sessao_id>-<índice>` | `MERGE` — confirmar duas vezes não duplica |
| `MERGE` na aresta `:PERFILA` | reconfirmar não cria aresta repetida |
| o rascunho de perfil não escreve | só o `POST .../perfil` grava, e só com o meu toque |

## Ordem de construção

Cada passo deixa o sistema funcionando:

1. os três campos + UI em `/entidades` — nada depende de modelo;
2. agente 2 e a resolução por menção, com a revisão destacando a dúvida;
3. o seletor pesquisável;
4. `:PERFILA` gravado no confirmar;
5. agente 3, o rascunho de perfil.

**Parar depois do 3 já resolve o caso do Rafa.** Do 4 em diante é o perfil se
mantendo sozinho conforme as sessões acumulam.

## Critérios de aceite

1. Os três campos de perfil se editam em `/entidades` e sobrevivem ao recarregar.
2. Numa sessão que fale das duas pessoas, os átomos caem em nós diferentes, sem
   eu tocar em nada. É o critério que importa; julgamento meu, na revisão.
3. "Falei com o Rafa hoje", sem mais contexto, chega destacado como incerto, com
   uma sugestão preenchida e o motivo visível — e o confirmar continua liberado.
4. O seletor de sujeito lista as entidades do grafo, filtra por tipo e pesquisa
   conforme eu digito.
5. Sessão em que nenhuma menção é ambígua **não chama** o agente 2.
6. Um átomo que diz o que alguém sabe fazer sai da revisão com `:PERFILA` para a
   entidade certa, no campo certo — conferível por Cypher.
7. O rascunho de perfil propõe texto a partir dos átomos marcados e **não grava**;
   o campo só muda quando eu aprovo.
8. Todo átomo continua com `prompt_version` e `modelo` (regra 7), e a proposta
   registra também a versão do `resolucao-1` que a atribuiu.
9. Reconfirmar não duplica átomo nem aresta `:PERFILA`.
10. Proposta antiga, do formato anterior, ainda abre na revisão.

## Depois desta slice

Com identidade confiável e perfil acumulando, a slice 5 abre o que sempre
dependeu de material: as 2-4 perguntas do ritual e as relações entre átomos —
`:ATUALIZA`, `:CONTRADIZ`, `:CONFIRMA`. Uma pergunta boa precisa saber de quem
se está falando, e é isso que esta slice entrega.
