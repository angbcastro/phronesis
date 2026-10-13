# Slice 5.2 — O confronto amplo

**Objetivo:** que o confronto deixe de ligar só o par explícito e passe a olhar
um horizonte largo — sentimento complementado pelo fato que o explica, a mesma
coisa atravessando dias, a ligação sutil que só se vê juntando os dois trechos —
sem que o chat passe a citar interpretação como se fosse registro. E que a
calibração dele vire contínua: eu corrijo relação por relação numa tela, e cada
correção alimenta o laço da slice 7.

**Pronto quando:** eu abro `/confronto`, toco num átomo (dos recentes ou de uma
busca por texto), vejo num radial todas as relações dele — fortes em traço cheio,
sutis em pontilhado —, troco o tipo de uma, rebaixo outra para sutil, apago uma
terceira; a apagada nunca mais volta, as editadas nunca mais são tocadas pelo
agente, e as três correções aparecem em `/calibracao` sob o agente `confronto`.

## Por que agora

O confronto é o pilar "Confrontar" da visão — "a coisa mais valiosa que o sistema
pode me dar" — e hoje ele enxerga pouco, por três travas que estão no código, não
no prompt:

1. **Candidatos só por top-8 vetor** (`K_CANDIDATOS = 8`). Oito vizinhos num
   diário inteiro é quase só o mesmo assunto dito de novo.
2. **Só contra data estritamente anterior** — e como `valido_em` é o
   `iniciada_em` da sessão (`confirmar/route.ts`), **dois átomos da mesma sessão
   nunca se comparam**. O sentimento e o fato que o explica, ditos na mesma
   gravação, nunca chegam a ser um par.
3. **O prompt `confronto-2` proíbe o que eu agora quero.** "Mesmo padrão de
   comportamento" e "mesma pessoa" não são motivo — regra que derrubou
   `67→5`, `80→26` e `93→29`, que eu tinha aprovado na 5.1.

A 5.1 escolheu precisão sobre cobertura, e a escolha continua de pé: falso
positivo contamina a resposta. O que muda é que a cobertura não precisa mais ser
paga em precisão — ela vai para uma **segunda camada**, rotulada, que o chat lê
como ligação provável e não como fato.

## As decisões

Perguntadas na entrevista de 12/10, antes de qualquer linha de código.

| Decisão | Escolhido | O que foi recusado, e por quê |
|---|---|---|
| **Quem consome** | o chat (`historico_do_atomo`) e, numa fatia futura, as 2–4 perguntas pós-gravação da visão §3 | "Mostrar na revisão o que conflita" foi recusado — peso na tela sagrada. A tela de navegação entrou, mas como instrumento de calibração (abaixo) |
| **Perguntas pós-gravação** | **preparar, não construir**: o juiz recebe o alvo como dado (texto, data, sessão, entidades), não como id do grafo | Construir junto foi recusado — uma fatia vertical por vez. Prepará-lo é só a forma da função; nenhuma rota nem tela nasce para isso (`CLAUDE.md`: não construir adiantado) |
| **Erro × cobertura** | **duas camadas**: `forte` grava e é lida como hoje; `sutil` grava rotulada, e o chat a cita como ligação provável | Fila de aprovação para o sutil (vira tarefa, visão §8), afrouxar numa camada só (contradiz "falso positivo contamina") e manter só precisão foram recusados |
| **O que separa as camadas** | **o portão de hoje**: forte = a afirmação comum se escreve com palavras dos dois trechos; sutil = ligação real que pede uma inferência | Corte por confiança (a 5.1 mediu que ela não separa certo de errado) e o modelo declarar sem critério foram recusados |
| **Até onde o sutil interpreta** | **liga, nunca nomeia**: o motivo aponta o que cada trecho diz, nunca nomeia padrão, traço ou diagnóstico | Nomear o padrão no motivo foi recusado — é interpretação psicológica, que a visão §7 proíbe |
| **Vocabulário** | **os quatro de hoje, redefinidos** para caber sentimento ↔ fato (tabela abaixo) | `EXPLICA`, `MESMO_EPISODIO`, `DESFECHO`, `VIRADA` foram desenhados e **adiados** — "posso querer incluir isso posteriormente; por ora, os 4 bastam". A virada já se compõe de `ATUALIZA` + o fato que a `COMPLEMENTA` |
| **Abrangência** | entre **quaisquer** tipos de átomo | Só sentimento ↔ fato foi recusado — "o fato explica a decisão" tem a mesma forma |
| **Agrupar** | **pares bastam** | Episódio como nó e padrão como nó foram recusados — label novo, e o segundo é interpretação |
| **Mesma sessão** | o **confronto** cria, de fundo | O extrator propor a ligação junto com os átomos foi recusado — pesaria a revisão de 60 s |
| **Candidatos** | **vetor no grafo inteiro, top-100, sem piso e sem filtro de data**: o alvo é comparado com o que é mais antigo **e** com o que é mais novo | Sessão inteira e janela de dias como fontes próprias não entraram — "o mais importante é olhar pra um horizonte amplo, e apenas 8 átomos é uma quantidade muito muito baixa" |
| **Direção** | a aresta **sempre** vai do mais novo para o mais antigo, e **quem decide qual é qual é o código**: data; na mesma sessão, o segundo do áudio | "Não precisa ser estritamente anterior… mas garantindo que a relação salva esteja na direção correta" |
| **Corte por relevância** | o próprio ranking do vetor; o juiz vê os 100 de uma vez, numa chamada por alvo | Triagem em duas passadas (pode cortar justamente o sutil) e 30–50 com piso foram recusados |
| **Piso do `COMPLEMENTA`** (0,7) | `COMPLEMENTA` forte abaixo dele **desce para sutil** em vez de sumir | Tirar o piso e manter descartando foram recusados |
| **Quantidade** | **no máximo 7 relações por átomo** | Sem limite foi recusado |
| **Teto de saída** | 100 mil tokens, sem segunda tentativa dobrada — como a resolução desde 30/09 | — |
| **Modelo** | **comparar modelos** do Gateway nos mesmos átomos antes de fixar; eu leio lado a lado e escolho. Feito em 13/10: **`deepseek/deepseek-v4.1-flash`**, agora padrão próprio do confronto (`MODELO_CONFRONTO_PADRAO`) | Manter o flash sem medir, e um modelo mais forte direto, foram recusados. Na comparação, o `opus` ficou de fora por pedido meu, o `deepseek-v4-pro` saiu depois de passar dos 180 s no primeiro átomo, e o `gemini-3.8-flash` e o `claude-sonnet-5.5` perderam para o flash |
| **Ritmo** | cron diário + "rodar agora" + **disparo de fundo ao confirmar uma sessão** | "Como hoje" foi recusado — o que eu gravei hoje só ganharia relação amanhã |
| **Lançamento** | **reprocessar do zero** | Congelar as 13 relações atuais como gabarito foi recusado |
| **Minha edição** | relação que eu editei fica **congelada** (o agente, o desfazer e o reprocessar não tocam); relação que eu apaguei vira **recusa lembrada** e o par nunca mais é proposto | "Fica, mas pode voltar" foi recusado — eu corrigiria o mesmo erro duas vezes |
| **A tela** | entrada pelos **recém-processados** e por **busca por texto**; desenho **radial**; tocar num vizinho **recentra** | Por sessão/dia e vindo do chat ficaram de fora; linha do tempo e lista com mini-grafo foram recusadas |
| **Os gestos** | trocar tipo, trocar camada, editar motivo, apagar | Criar relação nova foi recusado |
| **Como aprende** | cada gesto vira `Correcao` do agente `confronto` e entra em `/calibracao` (slice 7) | Exemplos vivos no prompt foram recusados — o prompt mudaria sem eu ver |
| **O chat** | vê as duas camadas, rotuladas | Sutil só a pedido, e o chat sem ver o sutil, foram recusados |

### Os quatro tipos, redefinidos

| Tipo | Era | Passa a ser |
|---|---|---|
| `ATUALIZA` | o mais novo substitui a mesma afirmação, que mudou | igual |
| `CONTRADIZ` | o mais novo se opõe diretamente | + o que aconteceu **desmentiu** um medo, expectativa ou plano anterior |
| `CONFIRMA` | o mais novo sustenta a mesma afirmação | + o que aconteceu **cumpriu** um medo, expectativa ou plano anterior |
| `COMPLEMENTA` | informação nova sobre o mesmo fato já nomeado | + o fato que **explica ou contextualiza** um sentimento; + **partes do mesmo episódio** |

## 1. Schema — migration 013

`db/migrations/013_confronto_amplo.cypher`, **sem statement** — como a 005, 007,
010 e 011. Propriedade nova e relação nova não se declaram no Aura Free.

As quatro arestas de confronto ganham:

```
camada      'forte' | 'sutil'   — ausente = forte (tudo o que a 5/5.1 gravou)
origem      'agente' | 'eu'     — ausente = agente; 'eu' = congelada
dono        id do átomo cuja rodada escreveu a aresta — ausente = o átomo de
            onde ela sai (era sempre assim até esta fatia)
editado_em  ISO 8601, quando eu a editei
```

**Por que `dono` é preciso.** Até a 5.1 a rodada de um átomo só escrevia arestas
que **saíam** dele, e "uma geração" era "apagar as de saída". Agora o alvo também
é comparado com átomos mais novos, e a aresta desse par sai do outro — a rodada
escreve aresta que **chega** ao alvo. `dono` é o que diz de qual rodada ela é.

E uma relação nova:

```
(:Atomo)-[:CONFRONTO_RECUSADO { em, tipo }]->(:Atomo)
```

A recusa é **do par**, não do tipo: apagar diz "estes dois não se relacionam".
Tipo próprio, e não uma propriedade nas quatro, para que nenhum leitor que case
`ATUALIZA|CONTRADIZ|CONFIRMA|COMPLEMENTA` a enxergue por engano — o mesmo
espírito do `DISTINTA_DE` das entidades.

## 2. O agente — `confronto-3`

### Os candidatos

`db.index.vector.queryNodes('atomo_embedding', 101, …)` a partir do vetor do
alvo, **sem filtro de data**: só ativos, só datados, não o próprio alvo, e fora
o par que já tenha recusa, aresta congelada ou aresta viva de **outra** rodada.
`K_CANDIDATOS = 100`. `PISO_CONFRONTO` sai — ele foi medido inerte na 5.1.

### A ordem do par, decidida pelo código

`maisNovo(a, b)`: `valido_em` maior é o mais novo; na mesma sessão (mesmo
`valido_em`), quem foi dito depois — `inicios_s[0]` maior; empate final por id.
O prompt apresenta cada candidato já marcado ("mais antigo · 3 dias antes",
"mais novo · mesma sessão, dito depois") e pede a relação **do ponto de vista do
mais novo**. O parser grava `(mais_novo)-[:TIPO]->(mais_antigo)` seja o alvo um
ou outro. O modelo nunca escolhe a direção.

### Um alvo por chamada

O acervo compartilhado da 5.1 não escala para 100 candidatos por alvo — dez alvos
viraram mil pares numa chamada. O elo reivindica `ALVOS_POR_ELO` (5) átomos e os
julga **em paralelo**, cada um na sua chamada. **A falha é por alvo**, não mais
do lote. A reivindicação, o lease e o `waitUntil` ficam como estão.

Dois alvos do mesmo elo podem se ter como candidato. O par fica só com o
primeiro — o segundo não o julga — e a gravação ainda confere, no Cypher, que o
par não ganhou aresta de outra rodada nem recusa enquanto o modelo pensava.

### O juiz recebe dado

`decidirAlvo(alvo, candidatos)` recebe os trechos como dado e não lê o grafo.
É o que o deixa pronto para julgar, numa fatia futura, um átomo da proposta que
ainda não foi gravado.

### O prompt

Cabeçalhos de seção em caixa alta, para o `redacao-1` poder emendar. O portão de
hoje vira a régua do **forte**; uma seção **SUTIL** diz o que vale (inferência
ancorada nos dois textos: o sentimento e o fato que não se citam, a mesma pessoa
e o mesmo comportamento) e o que continua proibido (mesmo tema ou mesmo dia
sozinhos; nomear padrão, traço ou diagnóstico). Saída:

```json
{"relacoes":[{"n":3,"tipo":"COMPLEMENTA","camada":"forte","confianca":0.8,"motivo":"…"}]}
```

### O parser

- `n` fora da lista, tipo fora dos quatro, `n` repetido: descartados em silêncio;
- `camada` inválida ou ausente vira **sutil** — na dúvida, a camada que o chat
  lê com ressalva;
- `COMPLEMENTA` forte abaixo de `LIMIAR_COMPLEMENTA` vira sutil;
- teto de **7**, descontadas as relações congeladas que o alvo já tem: forte
  primeiro, depois por confiança.

### A gravação, o desfazer e o reprocessar

| Operação | Apaga | Preserva |
|---|---|---|
| `gravarRelacoes(alvo)` | as arestas do agente cujo `dono` é o alvo | congeladas, recusas, e as de outras rodadas |
| `desfazerConfronto(alvo)` | o mesmo | o mesmo |
| `reprocessarTudo()` | **todas** as arestas do agente | congeladas e recusas |

### O teto de saída

`maxOutputTokens: 100_000`, sem o `FATOR_DE_FOLGA`. A chamada ganha o `ate` do
elo, para que uma chamada lenta não coma a função inteira (`limite.ts`).

## 3. O disparo ao confirmar

`POST /api/sessoes/[id]/confirmar`, depois de gravar os átomos, chama o elo do
confronto em `waitUntil` com o meu cookie. A resposta do confirmar não espera.
A fila anda do mais antigo pendente para o mais novo, como sempre: o que eu
acabei de gravar entra atrás do que já esperava.

## 4. A tela `/confronto`

- Fica: a fila, "rodar agora", "reprocessar tudo" em dois toques, a lista de
  recentes — que agora diz quantas relações fortes e quantas sutis cada um ganhou.
- **Busca por texto**, pela mesma busca vetorial do chat.
- **O radial**, em SVG próprio: o átomo no centro, os vizinhos em volta
  agrupados por tipo, seta na direção da aresta, forte cheio, sutil pontilhado.
  Tocar num vizinho recentra; "voltar" refaz o caminho. Tocar no rótulo de uma
  aresta abre tipo, camada, motivo, confiança, modelo e os gestos.

Rotas novas:

| Rota | O que faz |
|---|---|
| `GET /api/confronto/atomo/:id` | o átomo e todas as relações dele, nas duas direções, com os vizinhos |
| `POST /api/confronto/relacao` | `{novo_id, velho_id, acao, valor}` — `acao ∈ tipo\|camada\|motivo\|recusar`; edita a aresta, congela, e registra a correção |
| `GET /api/confronto/busca?q=` | busca por texto, para achar o átomo |

## 5. A captura para a calibração

`TipoCorrecao` ganha `relacao_tipo`, `relacao_camada`, `relacao_motivo` e
`relacao_recusada`. Id `${novo}|${velho}|${tipo}`; `agente: 'confronto'`;
`atomo_id` o mais novo; `antes`/`depois` como `"COMPLEMENTA · sutil"`;
`texto_proposto` com os dois trechos; `prompt_version` e `modelo` os da aresta.

**O `antes` é sempre o que o agente gravou.** A segunda edição do mesmo par
atualiza o `depois` da correção em aberto em vez de abrir outra; editar uma
aresta que já era minha, sem correção em aberto, não gera correção — eu estaria
corrigindo a mim mesmo. Voltar ao valor do agente fecha a correção.

`descreverCorrecao` (`calibracao.ts`) passa a mostrar os dois trechos quando a
correção é de relação — sem eles, "COMPLEMENTA virou CONFIRMA" não ensina nada.

## 6. A comparação de modelos

`scripts/comparar-confronto.ts`, **só leitura** do grafo: pega ~15 alvos reais,
roda `confronto-3` com cada modelo da lista e escreve uma página lado a lado, com
tempo e tokens de cada chamada. A lista de modelos sai do catálogo do Gateway e é
proposta a mim antes de rodar. O escolhido vai para o painel `/agentes`.

## 7. O chat

`historico_do_atomo` devolve a camada de cada elo, e anda **forte até 4 saltos,
sutil só 1**: com até 7 relações por átomo, quatro saltos pelas duas camadas
trariam centenas de trechos para uma resposta. O prompt vira `chat-7`: relação
sutil se diz "parece ligado a", nunca se afirma.

## Fora de escopo

- Os tipos novos (`EXPLICA`, `MESMO_EPISODIO`, `DESFECHO`, `VIRADA`).
- As perguntas pós-gravação — só a forma do juiz as prepara.
- Criar relação à mão na tela.
- Desfazer uma recusa pela tela — ela é para sempre até eu pedir outra coisa.
- Entrada no radial por sessão/dia ou vindo do (i) do chat.

## O que muda de arquivo

```
db/migrations/013_confronto_amplo.cypher  novo — camada, origem, dono, recusa
src/lib/tipos.ts                          camada, origem, a relação no radial, os 4 tipos de correção
src/lib/confronto.ts                      confronto-3: candidatos, ordem, juiz por alvo, gravação por dono, edição
src/lib/correcoes.ts                      a correção de relação, e a atualização da que está em aberto
src/lib/calibracao.ts                     rótulos e descrição da correção de relação
src/lib/agentes.ts                        papel, gatilho e envelope do confronto
src/lib/chaves.ts                         idDeAtomoValido — o id que vem da URL e do corpo
src/lib/chat.ts                           camada nos elos, travessia, chat-7
src/components/Calibracao.tsx             os rótulos das quatro correções de relação
src/app/api/confronto/atomo/[id]          novo — GET
src/app/api/confronto/relacao             novo — POST
src/app/api/confronto/busca               novo — GET
src/app/api/confronto/rodar               o `ate` do elo; função de encadear compartilhada
src/app/api/cron/confronto                o `ate` do elo
src/app/api/sessoes/[id]/confirmar        o disparo de fundo
src/components/Confronto.tsx              busca, radial, gestos
src/app/globals.css                       o radial
scripts/comparar-confronto.ts             novo
scripts/gancho-src.mjs (+ -resolver)      novo — o script importa de src/ em node puro
package.json                              `pnpm comparar:confronto`
tests/confronto.test.ts                   reescrito para o 3
tests/chat.test.ts, tests/calibracao.test.ts, tests/correcoes.test.ts, tests/confirmar.test.ts
ARCHITECTURE.md, CLAUDE.md, PROXIMOS-TESTES.md
```

## Ordem de execução

| # | Passo |
|---|---|
| 1 | esta spec |
| 2 | a migration 013, proposta — aprovada quando eu mandar buildar |
| 3 | o agente: candidatos, ordem, prompt, parser, gravação por dono |
| 4 | a edição, a recusa e a captura da correção |
| 5 | as rotas, o disparo ao confirmar, a tela |
| 6 | o chat |
| 7 | `ARCHITECTURE.md`, `CLAUDE.md`, `PROXIMOS-TESTES.md` |
| 8 | a comparação de modelos — rodada só depois de eu aprovar a lista |
| 9 | reprocessar tudo, com o modelo escolhido |

## Limites que esta fatia cria (para o §14)

- **O custo por átomo multiplica**: 100 trechos por chamada, uma chamada por
  átomo, onde a 5.1 dividia uma chamada entre dez. Centavos no deepseek, mas uma
  varredura completa fica mais lenta.
- **O teto de 7 é da rodada do átomo**: as arestas que rodadas de outros átomos
  apontam para ele não contam, então um átomo muito citado pode ter mais de 7.
- **A recusa não tem desfazer na tela.**
- **Uma relação congelada nunca é revisitada**, nem quando o prompt melhora.
- **Par julgado `NENHUMA` não deixa rastro**: ele pode ser julgado de novo quando
  o outro átomo for alvo, e pagar a leitura duas vezes.
- **Prompt editado no painel sombreia a base**: um override do `confronto` salvo
  antes desta fatia pede o envelope velho (`novo`/`velho`), e o parser novo não o
  lê. Ele precisa voltar à base em `/agentes` antes do reprocessar.

## Como ficou

O que o `ARCHITECTURE.md` contava desta fatia — datas, medições, o que era
antes —, movido quase literal quando ele passou a descrever só o presente
(`Specs/documentacao.md`).

### Do cabeçalho do `ARCHITECTURE.md`

**A slice 5.2 está construída, e não verificada.** A fatia
(`Specs/slice-5.2.md`) alarga o confronto (§4.15.3): cada átomo é julgado contra
os cem mais parecidos do grafo inteiro — mais antigos, mais novos e da mesma
sessão —, a direção da aresta é decidida pelo código, e toda relação ganha uma
**camada**, forte ou sutil, que o chat (`chat-7`) lê com ressalva. A tela
`/confronto` ganhou busca e um radial onde eu corrijo relação por relação; a
edição congela a relação, apagar vira recusa do par, e cada gesto vira correção
em `/calibracao`. Migration 013, sem statement. O modelo foi escolhido pela
comparação de 13/10 (`deepseek/deepseek-v4.1-flash`, agora padrão próprio), e o
painel de produção não tem override do `confronto` nem do `chat` (conferido no
mesmo dia). **O que falta:** buildar o commit da 013 e reprocessar tudo.
