# Slice 10 — O retrato do "eu"

**Objetivo:** que o sistema saiba **quem eu sou** com o mesmo cuidado com que sabe
quem são as outras pessoas — e com muito mais detalhe, porque quase tudo o que o
diário registra é sobre mim. Um retrato completo, separado por dimensões da minha
vida, que diz o que eu sou agora e como cheguei aqui, que eu leio numa tela e que o
chat consulta **uma dimensão por vez**.

**Pronto quando:**

1. Abro o "eu" em `/entidades`, vejo as dimensões que o agente propôs, edito, e
   aprovo.
2. Rodo o "eu" e leio, seção por seção, um retrato que eu reconheço: o **Agora** no
   topo, e em cada dimensão o que é hoje e o que mudou, com mês e ano.
3. O (i) de cada seção me mostra os trechos principais que a sustentaram.
4. Pergunto ao chat "como está meu treino?" e o (i) da resposta mostra que ele leu a
   dimensão do corpo — e só ela.
5. Na segunda-feira, se falei de mim na semana, o retrato está reescrito.

**Depende de** `Specs/slice-4.12.1.md` (sem teto de saída, fila que se retoma,
batida semanal) — no ar desde 29/09, mas **a primeira batida de segunda ainda não
rodou** (a próxima é 05/10). O critério 5 só conta depois de ela ter rodado uma vez
com as outras canônicas.

**E de o "eu" ser canônico.** `enfileirarCanonicasComNovidade` só pega
`canonico = true`, e nada no código garante isso para o "eu". Conferir nos dois
bancos antes do passo 2; se não for, marcar pela tela, que já tem o toggle.

## Por que agora

Porque a ficha de quatro campos, que serve às outras entidades, **não serve ao
"eu"**, e a rodada de 23/09 mostrou isso com número:

- **128 dos 151 átomos ativos (85%) são do "eu"**, e ele cresce ~150 por mês — é
  sujeito de todo `SENTIMENTO`, `APRENDIZADO`, `HISTORIA` e `ROTINA` por regra da
  extração.
- Com o teto consertado, a ficha dele saiu com **1391 caracteres a partir de ~49
  mil**: `resumo` 377, `contexto` 475, `pode_ajudar_com` 471, `fizemos_juntos`
  **vazio** — não existe "o que fiz junto comigo mesmo".
- O `resumo` como "o que distingue de outra parecida" não tem uso: a resolução
  prende "eu" por regra (guarda A2, `resolucao.ts`) e ninguém precisa desempatar.
- Os três campos de perfil viram o **vetor** da entidade (`garantirEmbeddings`,
  `entidades.ts`). Um retrato longo neles estouraria a entrada do modelo de
  embedding e derrubaria o lote de vetores de **todas** as entidades.

A 4.12 declarou este caso e o deixou de propósito para depois: "entidade grande
demais para caber — sem tratamento; se acontecer, a entidade falha, e a fatia que
consertar isso decide como". Aconteceu, e é esta.

**O que não está quebrado, e esta fatia não toca:** a ficha das outras entidades, a
extração, a resolução, a fusão, o vetor, e as três ferramentas que o chat já tem.

## As decisões

Perguntadas em 23/09, em três rodadas.

| Decisão | Escolhido | O que foi recusado, e por quê |
|---|---|---|
| **Quem lê o retrato** | **o chat, quando pedido, e uma tela para eu ler** — "as consultas devem ser segregadas; as informações sobre mim devem ser bem completas, com as informações relevantes podendo ser consultadas pelo agente do chat" | "O chat em toda pergunta" poria milhares de tokens em cada pergunta, a maioria sem relação com ela. "Os agentes do pipeline" aumentaria a entrada de toda janela para um ganho que ninguém pediu |
| **Como é escrito** | **uma chamada por dimensão, cada uma lendo todos os átomos do "eu"** | "Capítulos mensais + retrato por cima" escala para sempre, mas acrescenta um nível de resumo e peças que não são necessárias enquanto tudo cabe: o modelo tem 1M de contexto, e no ritmo de hoje o "eu" leva ~5 anos para passar disso. "Uma chamada para todas as dimensões" disputa os 32.768 tokens de saída com o raciocínio (7392 só de raciocínio para 128 átomos em 23/09). "Só linha do tempo" não diz o estado atual em lugar nenhum. "O eu nos quatro campos" é o que falhou |
| **O tempo** | **o atual, e o que mudou**, com mês e ano, em cada dimensão | "Evolução completa" faz cada seção virar uma crônica e esconde o presente no fim. "Só o atual" joga fora "como eu era em agosto", que só sairia por busca |
| **As dimensões** | **o agente propõe, eu aprovo** | "Eu dito a lista" pede que eu saiba de antemão como o diário me divide. "Emergem a cada rodada" muda a forma do retrato entre rodadas e torna impossível comparar |
| **Rever as dimensões** | **edito à mão, e posso pedir nova proposta** — que chega como sugestão ao lado da atual, e nada muda sem eu aceitar | "O agente sugere sozinho quando sobra átomo" é escrita de estrutura sem meu toque. "Só à mão" perde o agente quando o diário mudar de assunto |
| **Seção fixa** | **Agora** — o momento atual | "O que mudou" como seção própria repete o que cada dimensão já diz |
| **Procedência** | **sem citação no texto; um (i) por seção**, no esquema do (i) do chat, mostrando os trechos principais que a sustentaram | Citação por frase ([3][17]) deixa o texto pesado de ler. "Só contagem" não deixa ir do texto à evidência |
| **Quando reescreve** | **semanal, junto com as outras canônicas que têm átomo novo** (a batida da 4.12.1), e na mão pelo mesmo botão | "Depois de cada confirmação" reescreveria tudo por três átomos, várias vezes por dia. "Só na mão" deixa o retrato envelhecer quando eu esquecer |
| **Teto de saída** | **nenhum**, herdado da 4.12.1 | — |
| **Quantos agentes** (29/09) | **dois**: `retrato` e `retrato-dimensoes`, cada um com prompt, envelope e caixa no painel | "Um agente com envelope composto" deixaria o prompt da proposta fora da tela — o registro (`agentes.ts`) é um prompt e um envelope por agente, e `tests/agentes.test.ts` cobra que toda chamada tenha dono |
| **Desfazer** (29/09) | **um botão, que troca os dois**: os `_anterior` do nó e `eu.json` ↔ `eu.anterior.json` | "Só o retrato" deixaria `resumo`/`contexto` do "eu" sem desfazer. "Dois botões" desfaz meia rodada — e uma rodada é uma coisa só |

## 1. Onde mora — R2, e nenhuma migration

Texto longo vai para o R2, e o grafo guarda o curto: é o espírito da regra 2 e o que
a conversa do chat já faz (`mensagens_key`). O caminho é fixo por convenção, então
**nem a chave vai para o nó**, e o schema não muda.

```
config/retrato-eu.json      as dimensões
  { dimensoes: [{ id, nome, o_que_entra }],
    sugestao:  [{ id, nome, o_que_entra }] | null,
    atualizado_em }

retrato/eu.json             o retrato
  { secoes: {
      agora: Secao,
      <id>:  Secao, … },
    escrito_em, atomos, modelo }

  Secao = { texto, fontes: [atomo_id], atomos, ate, prompt_version, modelo, escrito_em }
  ate   = valido_em do átomo mais recente que a chamada leu

retrato/eu.anterior.json    uma geração — o desfazer
```

- **As dimensões são escritas por etag**, por `atualizarJson` (`src/lib/etag.ts`),
  o laço de todo objeto do R2 com mais de um escritor: a tela e a proposta do
  agente podem escrever o mesmo arquivo.
- **O `id` de uma dimensão é estável.** Renomear troca o `nome` e mantém o `id`, e
  a seção continua a mesma. Dimensão removida some na próxima rodada, e fica no
  `anterior` por uma geração. Até lá, a tela não mostra seção cujo `id` não está
  em `dimensoes`.
- **`agora` é id reservado.** O gerador de id a partir do nome (`slug`) nunca o
  devolve: uma dimensão chamada "Agora" vira `agora-2`, e não pisa a seção fixa.
- **O nó "eu" continua com `resumo` e `contexto` curtos**, escritos na fase 1 da
  mesma rodada. O vetor, a listagem de `/entidades` e o `buscar_entidades` do chat
  não mudam. `pode_ajudar_com` e `fizemos_juntos` do "eu" são gravados vazios (o
  que estava lá vai para o `_anterior`): as dimensões cobrem o primeiro, e o
  segundo não se aplica.
- **O desfazer é um só, e troca os dois lados** — os quatro `_anterior` do nó
  (`desfazerFicha`) e `eu.json` ↔ `eu.anterior.json` —, com a semântica da
  migration 010: uma geração, e um toque acidental se conserta com outro. Ordem:
  o R2 primeiro, o nó depois. **A troca não é atômica** entre Neo4j e R2: se o nó
  falhar depois de o R2 trocar, a rota responde erro e diz qual lado trocou; um
  segundo toque não conserta (trocaria o R2 de volta e o nó para a frente). Vai
  para o §14. Desfazer com rodada em `rodando` responde 409.
- **A escrita da rodada** é `eu.anterior.json` ← o `eu.json` atual, depois
  `eu.json` ← o novo. Morrer entre as duas deixa as duas iguais ao antigo: nada
  perdido, e o desfazer vira no-op até a próxima rodada.
- Chaves em `src/lib/chaves.ts`, ao lado de `chaveAgentes`.

## 2. Os agentes — `retrato-1` e `retrato-dimensoes-1`

`src/lib/retrato.ts`, novo. **Dois agentes** em `src/lib/agentes.ts` (e em
`AGENTE_IDS`, `tipos.ts`), cada um com caixa no painel e passando por
`efetivo()`/`carimbo()` de `overrides.ts`:

| id | versão | o que o prompt editável é | envelope |
|---|---|---|---|
| `retrato` | `retrato-1` | as regras do prefixo comum | vazio — os formatos dele são sufixos fixos no código |
| `retrato-dimensoes` | `retrato-dimensoes-1` | o sufixo da proposta, formato incluído | `dimensoes`, `nome`, `o_que_entra` |

O envelope vazio num agente **com** prompt é novidade: hoje vazio quer dizer "sem
prompt". Se `tests/agentes.test.ts` cobrar o contrário, o teste ganha o caso, com
o motivo — o formato do `retrato` não é editável porque três parsers dependem
dele.

Os dois leem `RETRATO_MODEL`, padrão o do enriquecimento, em
`src/lib/modelos.ts` — **uma variável para os dois**, porque a proposta tem de
bater no mesmo cache do provedor, e cache é por modelo. A variável entra em
`.env.example` e na lista do `CLAUDE.md`.

### O prompt tem duas partes, e a ordem importa

```
┌─ prefixo comum ────────────────────────────────┐
│ quem é o dono, as regras de escrita            │  igual em toda chamada
│ TODOS os átomos do "eu", numerados             │  da mesma rodada
└────────────────────────────────────────────────┘
┌─ sufixo ───────────────────────────────────────┐
│ a tarefa desta chamada E O FORMATO dela        │  muda por chamada
└────────────────────────────────────────────────┘
```

**O formato de saída mora no sufixo, e não no prefixo.** São três formatos
(`{resumo, contexto}`, `{texto, fontes}`, `{dimensoes}`), e qualquer coisa que
muda entre chamadas antes dos átomos quebra o cache no primeiro byte diferente.
O prompt editável do `retrato` é só a parte de regras do prefixo; editar o de
`retrato-dimensoes` não mexe no prefixo.

O prefixo é o mesmo em todas as chamadas de uma rodada para que ele saia do **cache
do provedor**: medido em 23/09, a segunda chamada com o mesmo bloco leu 14.080 dos
14.128 tokens de entrada do cache, que custa ~40× menos. Por isso a rodada tem duas
fases:

1. **`resumo` + `contexto`**, sozinha — ela escreve o cache.
2. **Agora + cada dimensão, em paralelo** — todas leem o cache.

**Paralelo não está medido.** Os 14.080 tokens de cache de 23/09 vieram de duas
chamadas **em sequência**. Com sete a treze ao mesmo tempo, o Gateway pode
distribuí-las por backends diferentes do mesmo modelo, e o cache de um não serve
ao outro. O passo 2 mede; se a fase 2 não ler o cache, a rodada fixa o provedor
por `providerOptions.gateway` com `provedorDe(modelo)` — continua sendo string
pelo Gateway (regra 8). `diagnostico()` (`modelos.ts`) passa a mostrar
`usage.inputTokenDetails.cacheReadTokens`, que hoje ele não lê — sem isso a
verificação da §6 não tem onde olhar.

**O bloco de átomos é próprio do retrato.** `atomosDaEntidade` (`enriquecimento.ts`)
é reusada e passa a devolver também `a.id` — campo a mais, que a ficha das outras
entidades ignora. **`blocoDeAtomos` não muda**: ele monta o prompt de toda ficha,
e numerá-lo mudaria o `enriquecimento-1` sem subir a versão. O retrato tem o
dele, `blocoNumerado`, em `retrato.ts`: linha `n` ↔ `ids[n-1]`, guardado fora do
prompt, para as fontes voltarem como id.

### O que cada seção devolve

```json
{ "texto": "...", "fontes": [12, 40, 41] }
```

- **`texto`**: o que eu sou agora nesta dimensão, e o que mudou, com mês e ano.
  Terceira pessoa, direto. **Só afirme o que os trechos sustentam** — a regra que
  mais importa, pela mesma razão da 4.12: ninguém revisa antes de gravar. Sem
  material, volta vazio.
- **`fontes`**: os trechos **principais** que sustentaram a seção, até 8.
  Validados contra o bloco: número que não existe é descartado, e o log diz quantos.
  É o que o (i) mostra.
- **Agora** é a mesma forma, com a instrução de olhar as últimas ~4 semanas antes
  do átomo mais recente. **A tela mostra o `ate` ao lado do título** ("até
  set/2026"): depois de três meses sem gravar, o Agora é de três meses atrás, e
  sem a data ele pareceria presente.

### A proposta de dimensões — `retrato-dimensoes-1`

Outra chamada, sobre o mesmo prefixo: devolve 6 a 12 dimensões, cada uma com `nome`
e `o_que_entra` (uma frase que diz que átomos pertencem a ela). O `id` é gerado pelo
código a partir do nome (nunca `agora`, §1). A proposta vai para `sugestao` e
**nunca** para `dimensoes` sem eu aceitar. É uma chamada do agente
`retrato-dimensoes`, e roda na fase 2 junto com as seções quando é a rodada que
pede — ou sozinha, sobre o mesmo prefixo, quando eu peço pela tela.

**A primeira rodada do "eu", sem dimensões aprovadas**, escreve só `resumo` +
`contexto` e o **Agora**, pede a proposta, e a tela me chama para aprovar.

### Quando o estado vira `pronta` — só no fim

`gravarFicha` põe `enriquecimento_estado = 'pronta'` na mesma consulta que grava
os campos, e isso **não serve ao "eu"**: se a fase 1 gravasse por ele e a função
morresse na fase 2, o nó diria `pronta`, o `eu.json` ficaria velho, e a retomada
pelo lease nunca o pegaria — ela só olha `rodando`.

Então a rodada do "eu" é:

1. fase 1 → os campos do nó, com `_anterior`, **sem tocar no estado** (o
   `gravarFicha` ganha um parâmetro que pula o `SET` do estado; o caminho das
   outras entidades não muda);
2. fase 2 → `eu.anterior.json`, depois `eu.json`;
3. só então `pronta`, com `enriquecimento_atomos`.

Morrer em qualquer ponto antes do 3 deixa o "eu" em `rodando`, e o lease o traz de
volta. A rodada repetida reescreve os campos do nó, e o `_anterior` passa a ser o
da fase 1 que morreu — o preço declarado da 010, uma geração.

### Falha parcial

Uma dimensão que falha **não derruba as outras**: a seção mantém o texto anterior,
o motivo vai para o log e para `enriquecimento_motivo`, e o estado da entidade fica
`pronta` com o motivo visível. Falha da fase 1 é falha da rodada inteira: `falhou`,
nada escrito no R2 — as seções não se escrevem sobre um nó que ficou para trás.

## 3. A fila

O "eu" entra na mesma fila, pelo mesmo estado no nó (`enriquecimento_estado`,
migration 010). `enriquecer()` (`enriquecimento.ts`) desvia para `retrato.ts`
quando `nome_normalizado === "eu"` — os dois caminhos que chamam `enriquecer()`,
o `{ chave }` e o elo, passam pelo desvio.

**Uma rodada do "eu" não cabe na margem da batida.** A ficha dele levou 62 s em
29/09 numa chamada só; o retrato são duas fases — ~60 s, e depois o tempo da mais
lenta de sete a treze chamadas paralelas, mais qualquer espera de rate limit. A
`cron/enriquecimento` começa entidade nova até 180 s (`ORCAMENTO_MS`) e deixa 120
s de margem para uma ficha só; o "eu" reivindicado aos 170 s morreria no meio, e
morta a função não chama a continuação.

O conserto, em dois lugares:

- **`reivindicarProxima` ordena o "eu" primeiro** (`ORDER BY e.nome_normalizado =
  'eu' DESC`, depois o carimbo). Na batida, ele entra no mesmo `SET` que as outras
  canônicas, e sai na primeira volta da primeira invocação, com o orçamento
  inteiro.
- **Passados 60 s da invocação, a reivindicação exclui o "eu"**
  (`reivindicarProxima({ semEu: true })`). Se ele entrar na fila no meio de uma
  invocação — pela tela, ou pelo lease —, fica para a continuação, que começa do
  zero e o pega primeiro.

O elo da tela não precisa disso: cada elo é uma invocação nova com os 300 s
inteiros. O `LEASE_MS` (300 s) continua valendo — nenhuma rodada viva passa
dele, porque a função morre antes.

**Medir no passo 2** o tempo da rodada inteira em dev. Os 60 s pressupõem rodada
de até 240 s; se ela passar disso, não cabe nem com o orçamento inteiro, e isto
volta para mim antes do passo 3.

## 4. A tela

Em `/entidades`, o painel da ficha do "eu" vira o retrato:

- **Agora** no topo, com o `ate` ao lado, depois uma seção por dimensão, na ordem
  aprovada; seção de dimensão que saiu da lista não aparece (§1);
- em cada seção, o **(i)**: os trechos das `fontes` — texto, tipo, data —, lidos do
  grafo pelo id. Átomo que depois foi rejeitado ou arquivado aparece riscado, e
  não some: o (i) diz o que sustentou a seção **quando ela foi escrita**;
- **as dimensões**: editar nome e `o_que_entra`, tirar, criar, reordenar; "pedir
  nova proposta", com a sugestão aparecendo **ao lado** da lista atual e um
  "aceitar". **Sem "juntar"**: é editar uma e tirar a outra, e a seção da que saiu
  some na rodada seguinte como qualquer removida;
- **enriquecer** e **desfazer** (um botão, os dois lados — §1), como nas outras
  fichas.

Rotas novas em `src/app/api/entidades/retrato/` — ler o retrato, ler e gravar as
dimensões, pedir proposta, desfazer, ler os átomos das fontes por id. Todas atrás
do middleware, como o resto. O desfazer do "eu" pela rota de sempre
(`/api/entidades/desfazer`) desvia para o do retrato, pelo mesmo teste de
`nome_normalizado` — senão o botão genérico trocaria só o nó.

## 5. O chat

Quarta ferramenta em `src/lib/chat.ts`, ao lado de `buscar_atomos`,
`historico_do_atomo` e `buscar_entidades`:

```
ler_retrato(dimensao?)
  sem argumento → o Agora, e a lista de dimensões com o `o_que_entra` de cada uma
  com argumento → só aquela seção, e as fontes (id, data, trecho curto)
```

- **É isto que "consultas segregadas" quer dizer:** o chat lê a lista, escolhe a
  dimensão, e só ela entra no contexto.
- Das fontes, o chat vai a `historico_do_atomo` (pelo id) ou a `buscar_atomos`
  quando a pergunta pedir evidência ou data exata.
- Seção vazia, ou retrato ainda não escrito, volta com `aviso` dizendo qual dos
  dois — e o chat segue por `buscar_atomos`, como já faz com ficha vazia.
- `INSTRUCOES` do chat: pergunta sobre mim — quem eu sou, como estou, o que tenho
  feito numa área da vida — começa por `ler_retrato`.
- O (i) da resposta mostra a dimensão lida, no mesmo `rastro` das outras
  ferramentas.
- `buscar_entidades` continua tirando o "eu" da listagem; buscado pelo nome, a
  resposta traz a ficha curta e um `aviso` **escrito pelo código** dizendo que o
  retrato está em `ler_retrato`. Não pelo `contexto`: ele é texto do modelo, e o
  próximo `retrato-1` editado no painel podia deixar de escrever a frase.

## 6. Verificação

- `pnpm test`: parse da seção (texto + fontes), fontes inválidas descartadas,
  número → id, dimensão sem material, falha parcial mantendo a seção anterior, troca
  do desfazer (os dois lados), `agora` nunca sai do gerador de id, o estado só vira
  `pronta` depois do `eu.json`, a reivindicação põe o "eu" primeiro e o exclui com
  `semEu`, e o prompt da ficha das outras entidades **byte a byte igual** ao de
  antes (`blocoDeAtomos` intocado). `tests/gateway.test.ts` e
  `tests/agentes.test.ts` continuam passando — os dois agentes registrados, o
  modelo por string, por `modelos.ts`.
- Em dev, contra o banco de desenvolvimento: pedir a proposta, editar, aprovar,
  rodar o "eu", ler o retrato, abrir o (i) de uma seção, desfazer, refazer.
- No log da rodada: o tempo das duas fases (§3), e a fase 2 com `cacheReadTokens`
  próximo da entrada inteira em **cada** chamada paralela (§2).
- No chat: "como está meu treino?" — o (i) mostra `ler_retrato` com a dimensão do
  corpo, e só ela.
- **A qualidade do retrato quem julga sou eu, lendo** — sem gabarito, sem fixture
  (`CLAUDE.md`). Quando estiver ruim, o que se ajusta é o prompt.

## Fora de escopo

- O retrato alimentar a extração, a resolução ou o confronto.
- Capítulos por período — é o caminho quando o "eu" não couber em uma chamada.
- Retrato das outras entidades por dimensões: a ficha de quatro campos continua
  sendo a delas.
- O confronto e a mesma doença do teto (registrado na 4.12.1).

## O que muda de arquivo

| arquivo | o quê |
|---|---|
| `src/lib/retrato.ts` | **novo** — os dois agentes, o bloco numerado, a leitura/escrita no R2, o desfazer dos dois lados |
| `src/lib/enriquecimento.ts` | o desvio do "eu"; `a.id` em `atomosDaEntidade`; `gravarFicha` sem o estado quando pedido; `reivindicarProxima` com o "eu" primeiro e `semEu` |
| `src/app/api/cron/enriquecimento/route.ts` | `semEu` depois de 60 s |
| `src/app/api/entidades/desfazer/route.ts` | o desvio do "eu" |
| `src/lib/chaves.ts` | as três chaves, ao lado de `chaveAgentes` |
| `src/lib/modelos.ts`, `.env.example`, `CLAUDE.md` | `RETRATO_MODEL`; `cacheReadTokens` no `diagnostico()`; "retrato" na lista de usos do `AI_GATEWAY_API_KEY` |
| `src/lib/agentes.ts`, `src/lib/tipos.ts` | os dois agentes no registro; os tipos do retrato e o passo `ler_retrato` do rastro |
| `src/app/api/entidades/retrato/` | **novo** — as rotas |
| `src/components/Entidades.tsx` | o painel do "eu" |
| `src/lib/chat.ts` | `ler_retrato`, a instrução, o `aviso` do "eu" em `buscar_entidades` |
| `tests/retrato.test.ts` | **novo** |
| `ARCHITECTURE.md` | módulo novo, layout do R2, agente e variável, rotas, ferramenta do chat, §14 |

## Ordem de execução

0. Conferir `canonico` do "eu" nos dois bancos (ver "Depende de").
1. `retrato.ts` com a proposta de dimensões (`retrato-dimensoes`) e o R2 de
   `config/retrato-eu.json`. Ponto de retorno: pedir a proposta em dev e ler o
   JSON.
2. A rodada — duas fases, seções, fontes, estado só no fim — e o desvio em
   `enriquecer()`; a ordem da reivindicação e o `semEu` da batida. Ponto de
   retorno: `{ chave: "eu" }` escreve `retrato/eu.json`, e o log diz o tempo das
   duas fases e o cache de cada chamada. **Se a rodada passar de 240 s, ou a fase
   2 não ler o cache, paro e volto a você** (§2, §3).
3. As rotas e o painel em `/entidades`, com o desfazer dos dois lados.
4. `ler_retrato` no chat.
5. `ARCHITECTURE.md` acompanhando cada passo.

## Limites que esta fatia cria (para o §14)

- **Uma chamada por dimensão lê todos os átomos do "eu".** Cabe enquanto o bloco
  couber no contexto do modelo — ~5 anos no ritmo de 23/09 para o padrão de 1M.
  Trocar `RETRATO_MODEL` por um de contexto menor antecipa esse dia. O conserto,
  quando vier, é capítulos por período.
- **O cache do provedor é uma economia, não um contrato.** Se o provedor não
  cachear, a rodada custa N vezes a entrada inteira — mais caro, igualmente certo.
- **O retrato escreve sem eu revisar antes**, como a ficha da 4.12. A defesa é a
  mesma: eu leio depois, e o desfazer está a um toque.
- **O (i) mostra o que o modelo disse que usou**, não uma prova de que cada frase
  está sustentada. Frase sem apoio só aparece quando eu leio.
- **O desfazer do "eu" não é atômico** entre Neo4j e R2 (§1). Falha no meio deixa
  um lado trocado, e a rota diz qual; o conserto é à mão.
- **O "eu" na batida depende da ordem da reivindicação.** Rodada que cresça além
  de ~240 s não cabe numa invocação nem começando no segundo zero, e aí a batida
  deixa de reescrever o retrato — em silêncio, a não ser pelo `rodando` que volta
  pelo lease toda semana.
