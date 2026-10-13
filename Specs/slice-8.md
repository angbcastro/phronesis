# Slice 8 — O sistema se cronometra, e encolhe o que mede

**Objetivo:** que o tempo entre o toque em parar e a tela de revisão abrir encolha —
e que ele deixe de ser impressão e passe a ser um número gravado, sessão por sessão,
para sempre.

**Pronto quando:** eu gravo uma sessão real, a revisão abre, e o objeto de medida
daquela sessão me diz onde o tempo foi, passo a passo, com as falhas e o custo. E o
uso me diz que melhorou. **Quem fecha a fatia sou eu** — a medida existe para dizer
*onde* mexer, não para declarar que ficou bom.

## Por que agora

`PROXIMA-SESSAO.md` §2.2 já escreve o problema inteiro: *"É o número desta fatia, e
ele não existe ainda. Hoje a previsão é 'de um a dois minutos para segundos', e
previsão não é medição."* E a suspeita já está lá: se continuar em dezenas de
segundos, o culpado não é a extração — é a resolução da janela do fim (embedding,
duas consultas vetoriais e a chamada do agente 2), que roda inteira depois do stop.

A única sessão longa real que se olhou (`mtqoeoqh3e3724514q1f`, 1044 s) custou
**quatro chamadas de modelo para entregar uma**, e foi ela que gerou a 4.10 — mas o
que se mediu ali foi token e `finishReason`, não relógio. Desde então nada foi
cronometrado. O sistema saiu do `localhost`, roda no telefone, e o telefone é onde eu
espero olhando a tela.

## As decisões

Perguntadas na entrevista de 17/09, antes de qualquer linha de código.

### 1. A fatia abre medindo, e a medida fica

Não é andaime. O registro permanece para dizer, daqui a três fatias, se algo
regrediu.

**Por que não o log da Vercel:** ele expira. **Por que não Neo4j:** a cota de índice
do Aura Free já está no teto pelos dois índices vetoriais da 006 (§14, repetido nas
migrations `011` e `012`), e série temporal quer índice por data. **Por que R2 com
índice:** `src/lib/r2.ts` não tem `LIST` — é exatamente por isso que
`calibracao/indice.json` existe, e o mesmo molde serve aqui.

Três objetos, e o que impede de inchar é a forma, não a disciplina:

- `sessoes/<id>/medidas.json` — o detalhe daquela sessão. Tamanho máximo conhecido.
  Morre com a sessão: `chavesDaSessao` já varre o prefixo.
- `medidas/indice.json` — uma linha por sessão, com os números de manchete. Podado
  por teto, como `podarIndice` já faz com as correções.
- `medidas/<AAAA-MM>.json` — o resumo do mês (n, mediana, pior caso, por passo),
  escrito pela batida diária que já existe, **antes** da poda. O detalhe de março
  some; a linha de março fica para sempre. Doze objetos por ano.

**O que entra no registro:** tempo por passo, falha (o que quebrou e por quê) e custo
(chamadas por agente, e tokens quando o Gateway devolve). **O que não entra:** campo
sem pergunta atrás. Cada número gravado responde a uma pergunta que eu de fato faço —
"onde foi o tempo", "isso piorou desde a emenda", "quantas janelas ficaram para
trás". Log de depuração genérico é o que apodrece.

**Texto livre de erro fica no objeto da sessão**, que é limitado e some com ela; o
índice guarda código e contagem. É onde esse tipo de registro sempre incha.

**Sem tela nesta fatia.** Quando eu quiser olhar, eu peço. Se a leitura virar hábito,
a tela vira item da pauta (8.4).

**Apagar a sessão não apaga a linha do índice** — como a correção já sobrevive ao
átomo, de propósito (§9). A série não ganha buraco quando eu apago uma sessão de
teste, e sessão de teste que foi mal não some para melhorar a média sozinha.

### 2. O número é do toque em parar até a revisão abrir

Inclui subir o último bloco, transcrever, extrair, resolver, e a tela virar. Inclui a
rede, que não está sob controle do código e varia com o sinal — e inclui **de
propósito**: é o tempo que eu espero olhando o telefone, não o tempo que o servidor
gosta de contar. Os passos internos ficam no detalhe, para dizer onde mexer.

Isso obriga o cliente a marcar três instantes que o servidor não tem como saber: o
`parar()`, a fila vazia e a revisão montada.

### 3. O limite que justificava cautela era da conta gratuita

O `ARCHITECTURE.md` registra o 429 de 02/09 como limite do sistema — *"uma espera de
~75 s destravou o que três tentativas seguidas não destravaram"* — e observa que o
limite era da conta, não do modelo. **Aquilo era o free tier.** Desde a compra de
créditos não reapareceu.

O documento ganha essa nota, e a consequência é de projeto: **paralelismo deixa de
ser risco e vira escolha.**

### 4. Paraleliza tudo que é independente

Sem teto artificial — num sistema de um usuário, requisição à toa não é custo.

- `candidatasDaJanela` percorre os 4 blocos em `for`+`await`, cada um com GET no R2 e
  possível `embedMany` mais duas consultas vetoriais. Os blocos não dependem uns dos
  outros e nada no código exige ordem.
- A fila do cliente sobe um bloco por vez. Irrelevante durante a fala, onde chega um
  bloco a cada 30 s; no instante do stop é o último bloco esperando a fila drenar.

**O que continua serial:** a cadeia de janelas. A janela `n` recebe o acumulado da
`n-1`, e isso **é** a 4.8 — mexer ali muda a qualidade da extração, não só o tempo.
Fica fora desta fatia.

### 5. O penhasco vira erro

Hoje, se **qualquer** janela não estiver `pronta` na finalização, `propostaDaSessao`
descarta tudo que a 4.8 acumulou e roda `extrair()` sobre a sessão inteira num passe
só — em silêncio, sem nada na tela que distinga. É o caminho de 1–2 min que a 4.8
existe para eliminar, e ele dispara sempre que um lease de 120 s ainda está segurado
por um `waitUntil` anterior no instante em que `/finalizar` roda.

Janela presa é defeito, não condição normal. A sessão passa a ir para `erro` com o
motivo, e eu mando re-extrair. **Nunca mais pago um passe único de 17 minutos sem
saber.**

### 6. Primeiro o que elimina trabalho, depois o que paraleliza

- **O STT do último bloco pode ser pago duas vezes.** `transcreverBloco` só checa se
  `chunk_NNN.json` existe — não há lease. O `waitUntil` de `/chunks/:i/pronto` e o
  laço de espera de `finalizarSessao` podem atacar o mesmo bloco ao mesmo tempo,
  porque `/finalizar` chega segundos depois do último `/pronto`. Ganha lease,
  espelhando `reivindicarJanela`.
- **`listarEntidades()` roda duas vezes por finalização** — uma por janela e outra em
  `propostaDaSessao`. Cypher com quatro `OPTIONAL MATCH` e vários
  `collect(DISTINCT …)`, sem cache.
- **`configAgentes()` ganha cache por invocação.** Hoje é um GET no R2 a cada chamada
  de agente, e no desempate, que roda em `Promise.all`, são N GETs simultâneos do
  mesmo objeto. O comentário em `overrides.ts` diz que não há cache porque cache por
  instância faria "salvei, vale na próxima" ser mentira — **e continua valendo**:
  cache por invocação não fura isso, porque a próxima invocação lê de novo. A decisão
  declarada não é revogada; é lida com mais precisão, e o comentário passa a dizer
  isso.
- **Os ~3,5 s de polling puro** entre "acabou" e "abriu": 1 s no laço de espera dos
  blocos, 0,5 s na fila do cliente e 2 s no poll da tela de processamento. As três
  constantes apertam.

### 7. A escada de espera passa a depender do erro

`comEsperaDeLimite` espera 20 s e 60 s e trata **toda** falha igual. Foi calibrada
contra o 429 do free tier. Passa a distinguir: só o 429 leva a escada longa; qualquer
outra falha transitória tenta de novo em segundos. Hoje uma falha de rede boba custa
20 s parados no meio da finalização.

### 8. Vale para gravação e para importação

Os dois caminhos compartilham o pipeline depois do bloco subir, então a maioria dos
consertos vale para ambos de graça. A medida cobra o número nos dois.

## O escopo

### Entra

- O registro de medida: três objetos no R2, o resumo mensal na batida diária, a rota
  pequena que recebe as marcas do cliente, e a instrumentação nos pontos que já
  existem no pipeline.
- Os seis consertos: lease do bloco, `listarEntidades()` uma vez, cache por
  invocação, polling apertado, paralelismo do RAG e da fila, escada por tipo de erro.
- O penhasco virando `erro` com motivo.
- A nota no `ARCHITECTURE.md` de que o 429 de 02/09 era free tier.

### A ordem, que não é detalhe

**A medida vai primeiro, sozinha, e com uma sessão real gravada antes de qualquer
conserto.** Se instrumento e conserto subirem juntos, não se sabe o que melhorou — e
a fatia inteira existe para saber.

### Não entra

- **A revisão abrindo antes de terminar.** É a 8.2, e ela só existe se o número desta
  continuar ruim depois dos consertos.
- **Tela de medidas.** O objeto é lido sob demanda.
- **A saída bruta do modelo.** Nenhum `putJson` do projeto grava resposta crua hoje, e
  continua assim — está fora do recorte inteiro das 8.n.
- **A serialidade das janelas**, que é a 4.8.
- **Migration.** Nada nesta fatia toca o grafo.

## Limites que esta fatia cria

- **O número inclui a rede**, então duas sessões não são estritamente comparáveis. É
  o preço de medir o que eu sinto em vez do que é estável. O detalhe por passo é o
  que separa "a rede estava ruim" de "a resolução ficou lenta".
- **A medida é mais um objeto por sessão a manter em dia.** Se um passo novo entrar no
  pipeline e ninguém instrumentar, o registro passa a mentir por omissão — a mesma
  doença do documento desatualizado, agora em JSON.
- **O laço read-modify-write por etag passa a estar copiado quatro vezes** (manifest,
  janela, calibração e medidas), a menos que o helper seja extraído nesta fatia. A
  dívida já está declarada no docstring de `janela.ts`.
- **O penhasco virando erro troca uma proposta ruim por nenhuma proposta.** Uma sessão
  que hoje entregaria nove átomos por passe único passa a parar e pedir re-extração.
  É a troca que eu quis: prefiro saber.

## As 8.n

Esta fatia é a primeira de oito, recortadas da mesma lista de melhorias (17/09).

| # | Nome |
|---|---|
| 8 | O sistema se cronometra, e encolhe o que mede |
| 8.1 | As emendas — canônica, chat com teclado, chat abrindo a última conversa, e a procedência errada da `Correcao` |
| 8.2 | A revisão abre antes de terminar |
| 8.3 | O confronto mostra o outro lado |
| 8.4 | A pauta — feedbacks com estado, dentro do app |
| 8.5 | A página dos agentes |
| 8.6 | O movimento ganha sistema |
| 8.7 | A calibração ganha procedência — transcrição e prompt exato |

A **8.1 sai no intervalo desta**, porque não depende de nada e é o atrito diário que
faz eu não gravar a sessão que esta fatia precisa.

## Como ficou

O que o `ARCHITECTURE.md` contava desta fatia — datas, medições, o que era
antes —, movido quase literal quando ele passou a descrever só o presente
(`Specs/documentacao.md`).

### Do cabeçalho do `ARCHITECTURE.md`

**A slice 8 sobe em partes, e a ordem não é detalhe.** A primeira é só o
cronômetro (§4.17): três objetos no R2, as três marcas do cliente, a
instrumentação nos passos que já existem e o resumo mensal na batida diária.
Nenhum conserto de desempenho vai junto — se instrumento e conserto subissem no
mesmo deploy, não se saberia o que melhorou, e a fatia inteira existe para saber.
Depois vêm os seis consertos e o penhasco virando erro (§4.18). Entre as duas vai
**uma sessão real gravada**, com o `medidas.json` dela lido.

**A linha de base foi colhida em 2026-09-18, e ela não mediu uma espera: mediu
uma trava.** A sessão `mu73d88b0w4u6o5d440j` (203 s de fala, 7 blocos) ficou
presa em `extraindo` e nunca abriu a revisão. Tudo no pipeline foi rápido — fila
do cliente 2,7 s, STT 7,2 s somados, catálogo 88 ms, camada semântica 513 ms — e
**uma única chamada de extração gastou 300.116 ms sem devolver um token**,
morrendo no `headersTimeout` do undici, que é o mesmo `maxDuration` de 300 s da
rota. Isso refutou a suspeita que estava escrita: o custo não era a resolução da
janela do fim.

A consequência entrou **antes** dos seis consertos, e é a quarta classe de falha
do §5.3 — **prazo por chamada de modelo**, mais a medida que sobrevive à função
morta (§4.17) e o corredor com teto (§11). Sem ela os consertos pioravam este
caso exato: `ehTransitorio` passaria a repetir uma chamada pendurada, e no
caminho sem `ate` seriam três de 90 s num `waitUntil` que morre aos 300 s.

Quem fecha a fatia sou eu — a medida existe para dizer *onde* mexer, não para
declarar que ficou bom.

### Do §14 (limites conhecidos)

- **O penhasco virando erro troca uma proposta ruim por nenhuma proposta** (8,
  §4.18). Uma sessão que antes entregaria nove átomos por um passe único sobre a
  transcrição inteira passa a parar e pedir re-extração. É a troca deliberada:
  aquele passe custava 1–2 min **em silêncio**, e eu o pagava sem saber. O que
  reduz a frequência é a espera pelo lease vivo, que era o gatilho mais comum — o
  que sobra é janela genuinamente presa, que é defeito.

- **O lease do bloco troca recuperação rápida por não pagar duas vezes** (8,
  §4.18). Se o `waitUntil` que reivindicou um bloco morrer, o laço de
  `finalizarSessao` espera os 120 s do lease antes de tentar — e ele só tem 150 s
  de orçamento. Antes ele retranscrevia na hora, pagando o STT duas vezes no caso
  comum para recuperar depressa no caso raro. A troca foi feita de olho aberto, e
  o sinal de que ela doeu seria `espera_blocos` alto com `stt` baixo no
  `medidas.json` — que é exatamente o que a primeira metade da fatia existe para
  mostrar.

- **Sessão travada em `extraindo` não tem retry automático.** O corredor a deixa
  em paz de propósito: uma extração pode estar de fato correndo, e empurrar de
  novo pagaria uma segunda chamada de modelo pela mesma sessão. A saída continua
  sendo o **reextrair** da lista; `transcrito` e `erro`, esses, o corredor empurra
  sozinho. **O que mudou em 18/09 é que ela deixou de girar para sempre**: o
  corredor tem teto (`TETO_DA_ESPERA_MS`, 6 min) e passa a dizer que travou, com
  o caminho da lista. Seis minutos porque os 300 s de `maxDuration` do
  `/finalizar` têm de caber inteiros dentro dele — chamar de travado antes seria
  eu reextrair uma sessão viva e pagar duas vezes.

### Do §4.17–4.19 (medida e desempenho)

**O tempo entre o toque em parar e a revisão abrir deixou de ser impressão.** Até
esta fatia a previsão era "de um a dois minutos para segundos" e previsão não é
medição: nada nunca foi cronometrado desde que a 4.8 desconcentrou a extração. A
única sessão longa real que se olhou (`mtqoeoqh3e3724514q1f`, 1044 s) mediu token
e `finishReason`, nunca relógio — e o sistema saiu do `localhost`, roda no
telefone, e o telefone é onde eu espero olhando a tela.

**E o coletor descarrega no meio do caminho, não só no fim** (18/09). Gravar
apenas no `finally` deixava o registro cego exatamente onde ele é mais
necessário: função morta pelo `maxDuration` não chega ao `finally`, e a medida
inteira daquela invocação ia junto. Foi o que a sessão `mu73d88b0w4u6o5d440j`
mostrou — `espera_blocos` e `concatenar` **rodaram** (o `transcricao.json` e o
`finalizado: true` provam) e não estão no objeto, porque o `/finalizar` foi morto
no meio da chamada seguinte. `INTERVALO_DESCARGA_MS` é 30 s: uma passada de
`/pronto` típica dura segundos e não paga descarga nenhuma, e a de 300 s paga
dez, contra um registro inteiro perdido.

A segunda metade da fatia. Ela sobe **depois** de a medida ter rodado numa sessão
real, e a ordem não é cerimônia: com instrumento e conserto no mesmo deploy não
haveria como saber o que melhorou.

| # | O que era | O que é |
|---|---|---|
| 1 | o STT do último bloco podia ser pago **duas vezes** | o bloco ganha lease no manifest (`transcrevendo_em`), espelhando `reivindicarJanela` |
| 2 | `listarEntidades()` rodava **duas vezes por finalização** | um retrato só, passado às janelas e à montagem da proposta (`catalogoUmaVez`) |
| 3 | `configAgentes()` era um GET por chamada de agente | cache **por invocação** (`invocacao.ts`), que não fura "salvei, vale na próxima" |
| 4 | ~3,5 s de polling puro entre "acabou" e "abriu" | 1 s → 400 ms no laço dos blocos, 500 → 150 ms na fila, 2 s → 750 ms na tela |
| 5 | o RAG da janela percorria os 4 blocos em série | `Promise.all`, com o `catch` **por bloco** para um não levar os outros |
| 5 | a fila do cliente subia um bloco por vez | três frentes, que só importam no instante do `parar` |
| 6 | toda falha esperava a escada de 20 s e 60 s | só o 429; o resto tenta de novo em segundos (§5.3) |

**O lease do bloco fecha uma janela que a trava antiga não cobria.** A existência
de `chunk_NNN.json` só vale **depois** de o STT voltar; entre o pedido e a
resposta havia dezenas de segundos em que o `waitUntil` de `/chunks/:i/pronto` e
o laço de espera de `finalizarSessao` podiam mandar o mesmo áudio, e o
`/finalizar` chega segundos depois do último `/pronto`. Agora quem não reivindica
recebe `null` — que **não é falha**: é a resposta certa, e o laço relê o manifest
na volta seguinte e vê o bloco pronto. Bloco que falha **solta** o lease antes de
subir o erro, para o próximo não esperar dois minutos por um trabalho que já
acabou; e `marcarTranscrito` também o solta, porque bloco pronto não tem dono.

**O penhasco vira erro.** Até aqui, se **qualquer** janela não estivesse `pronta`
na finalização, `propostaDaSessao` descartava tudo que a 4.8 acumulou e rodava
`extrair()` sobre a sessão inteira num passe só — **em silêncio**, sem nada na
tela que distinguisse uma proposta montada de oito janelas de uma tirada num
passe de 17 minutos. É o caminho de 1–2 min que a 4.8 existe para eliminar, e eu
o pagava sem saber. Agora a sessão vai para `erro` com o motivo no log
(`JanelaPresaError`) e espera eu mandar re-extrair.

**E o gatilho mais comum dele nem era defeito.** Ele disparava sempre que um
lease de 120 s ainda estava segurado por um `waitUntil` anterior no instante em
que o `/finalizar` rodava — que é a condição **normal**, não a excepcional.
`avancarJanelas` deixou de desistir nesse caso: fechando a sessão, ela **espera**
quem está na janela (`esperarQuemEstaNela`, 700 ms entre conferências), e só
assume quando o lease vence de fato. As três saídas são `pronta` (ele fechou),
`minha` (o lease venceu e eu assumi) e `desistiu` (acabou o orçamento) — e só a
última vira erro. Durante a gravação nada mudou: quem encontra a janela ocupada
para, e não pula, porque a janela `n` precisa do acumulado da `n-1`.

**A troca está declarada:** uma sessão que antes entregaria nove átomos por passe
único passa a parar e pedir re-extração. É a troca que eu quis — prefiro saber.
Áudio, transcrição e acumulado continuam todos no R2, e o retry é
`POST /api/sessoes/:id/extrair`, o mesmo botão de sempre.

### Do §5 (estados da sessão)

**Aquele limite era do free tier, e desde a compra de créditos ele não
reapareceu.** A medição de 02/09 é real e o desenho que ela produziu continua
certo — mas o que ela mediu foi uma **conta gratuita**, não o modelo nem o
Gateway. A consequência é de projeto, e ela é a segunda metade da slice 8:
**paralelismo deixou de ser risco e virou escolha.** Num sistema de um usuário,
requisição à toa não é custo. A escada longa fica porque custa zero enquanto o
limite não volta, e porque conta gratuita é um estado ao qual se pode voltar.

**Duas escadas desde a slice 8, e a diferença é o diagnóstico.** O módulo nasceu
de uma medição só e tratava tudo que não fosse 429 como definitivo — um 502 do
Gateway, um socket que morreu no meio, um `overloaded` do provedor derrubavam a
janela na primeira tentativa. Isso ficou caro pelo lado oposto quando o penhasco
virou erro (§4.18): falha boba de rede passou a custar a sessão. `ehTransitorio`
reconhece as três formas — código de rede dentro do `cause`, status 5xx ou 408, e
o `overloaded` que vem no corpo —, e elas levam `ESPERAS_TRANSITORIA_MS`, de 1 s
e 3 s. Os **contadores são separados**: um blip de rede no começo não gasta a
paciência que o 429 vai precisar depois. Fora das duas listas nada é repetido —
modelo inexistente, prompt que estoura o contexto e JSON inválido falham igual na
segunda vez.

**A quarta classe foi medida em 2026-09-18, e ela não é pressa: é silêncio.** A
sessão `mu73d88b0w4u6o5d440j` — 203 s de fala, 7 blocos — gastou **300.116 ms**
numa única chamada de extração que o Gateway nunca respondeu, e morreu no
`headersTimeout` do undici. Todo o resto daquela sessão foi rápido: STT 7,2 s
somados (pior bloco 1,8 s), catálogo 88 ms, camada semântica 513 ms, a fila do
cliente drenando em 2,7 s. **Não foi volume**: 43 entidades, 108 átomos, uma
janela de dois minutos de fala, e o Gateway não devolveu um token sequer de uso.

O que torna isso estrutural, e não azar: **o `headersTimeout` do undici é 300 s,
que é exatamente o `maxDuration` da rota.** Quando ele dispara não sobra
orçamento nenhum para o `catch` gravar a falha, marcar a sessão como `erro` ou
cair em outro caminho — a função é morta no meio e a sessão fica presa em
`extraindo` **para sempre**, com a tela batendo. Foi o que aconteceu: quem
estourou primeiro (o `/pronto` do bloco 3, começado às 15:08:42) alcançou o
`catch` e deixou `parcial.json` e a medida; o `/finalizar`, começado às 15:10:06,
foi morto antes do seu. E **sem streaming em lugar nenhum** do sistema, o Gateway
só manda headers quando a geração inteira acaba — então aquele teto é, na
prática, "tempo total de geração", e um modelo que pensa demais é indistinguível
de um Gateway pendurado.

**Orçamento que não cabe a chamada não vira chamada.** Antes o modelo era chamado
assim mesmo e o `waitUntil` morria no meio dele, sem deixar sequer o log; agora
sobe `PrazoDeChamadaError` com `prazo_ms: 0` e quem chamou tem tempo de gravar.

### Do §6 (idempotência)

**O laço mora em `etag.ts` desde a slice 8, e é um só.** Ele estava copiado três
vezes — manifest, `parcial.json` e `calibracao/indice.json` —, com a dívida
declarada no docstring de `atualizarParcial` ("extrair um helper é refatoração
fora do escopo desta fatia"); a quarta cópia seria a das medidas, e quatro é onde
uma correção passa a alcançar só três. Cada chamador
continua trazendo o que é dele: a curva de espera (os números do manifest são os
únicos diferentes, e o porquê está logo abaixo), o `normalizar` que materializa o
objeto ausente ou conserta o formato antigo, e o mutador. O que o laço devolve a
mais é `mudou` — "a escrita foi minha?" —, e é isso que faz a reivindicação de
uma janela ser uma trava de verdade em vez de uma esperança.

### Do §11 (telas)

**E ele tem teto desde 18/09.** O laço não tinha nenhum, e a tela só sabia falar
em falha quando o **status** dizia `erro` — mas sessão cuja função morreu no
`maxDuration` nunca chega a `erro`: ela fica em `extraindo` no grafo (§5.3), e a
tela ficava em "lendo o que você disse…" indefinidamente. É o que faz uma trava
parecer lentidão. Passados `TETO_DA_ESPERA_MS` (6 min) o corredor para de
perguntar e diz o que aconteceu, apontando o reextrair da lista. O relógio é o da
**visita**: abrir a sessão de novo recomeça a contagem, que é o que se quer ao
voltar para conferir.
