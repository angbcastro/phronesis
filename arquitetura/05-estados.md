## 5. Estados da sessão

```
gravando → finalizando → transcrevendo → transcrito → extraindo → em_revisao → confirmada
                                                          ▲            │
                                                          └────────────┘  reextrair
   qualquer um destes ────────────────────────────────────────────▶ erro
   (menos confirmada)                                               │
                                                                    └──▶ retry manual:
                                                                        finalizando,
                                                                        transcrevendo,
                                                                        transcrito ou
                                                                        extraindo
```

`transcrito` não é terminal: a extração emenda nele. O fim da linha é
`confirmada`, e quem confirma sou eu, na revisão. `confirmada` **não tem
transição de saída**: as quatro escritas de `erro` (três em `pipeline.ts`, uma
na rota `/finalizar`) levam a lista de onde se pode cair em `erro`, e ela é a
máquina inteira menos `confirmada` — sem isso, um `/finalizar` numa sessão já
confirmada cuja `transcricao.json` tivesse sumido do R2 gravaria `erro` por
cima, com os átomos no grafo.

O `erro` sai de qualquer estado porque qualquer passo pode falhar — o que ele
não pode é desfazer o único estado terminal. `em_revisao → extraindo` é o botão
"reextrair" da lista de sessões, e a volta a partir de `erro` é retry manual.

**O retry a partir de `erro` passa por `podeReextrair`**, que é `temTranscricao`
mais `erro`: `POST /:id/extrair` existe para quando "a sessão ficou em
`extraindo` ou `erro`". As duas perguntas são separadas de propósito:
`temTranscricao` é "a transcrição está pronta para eu mostrar", e é o que a tela
de leitura e a lista usam; `podeReextrair` é "vale disparar a extração". Sessão
que caiu em `erro` antes de existir transcrição não vira 500 — `extrairSessao`
procura o `transcricao.json` e devolve `erro` com log próprio.

**Há duas representações desta máquina, e só uma roda.** `estados.ts` é a
**declarada**: `PERMITIDAS`, `podeIrPara` e as predicadas, verificadas por
`tests/estados.test.ts` e não importadas por nenhum caminho de produção. A que
roda é o `sePartirDe` do Cypher, escrita a escrita — e é ela que está descrita
no fim desta seção. As duas têm de contar a mesma história; quando divergirem,
quem está errada é a declarada. Unificá-las foi considerado e recusado: derivar
a guarda de `PERMITIDAS` dentro de `atualizarSessao` tiraria do ponto de uso a
resposta a "o que impede esta escrita", e poria guarda implícita em escritas que
levam dado junto do status — `pipeline.ts` grava `transcrito` com
`chunks_total` e `duracao_s` no mesmo `SET`, e uma guarda que falhasse ali
engoliria os três em silêncio.

Quatro predicadas dizem o que cada estado significa para as telas:

| Predicada | Verdadeira em | Para quê |
|---|---|---|
| `temTranscricao` | `transcrito`, `extraindo`, `em_revisao`, `confirmada` | a leitura para o polling; a extração corre atrás |
| `estaPendenteDeRevisao` | `em_revisao` | tem proposta esperando |
| `terminouDeProcessar` | `em_revisao`, `confirmada`, `erro` | a leitura para o polling |
| `estaConcluida` | `confirmada` | terminal: o grafo já recebeu o que eu aprovei |

`estaConcluida` é a única das quatro sem consumidor em `src/`: a lista de
sessões reescreve a mesma comparação à mão, em `jaRevisada`. Está aqui porque é
exportada e testada, e porque duas cópias da mesma regra divergem no primeiro
ajuste.

**`terminouDeProcessar` é também a guarda do `DELETE` de sessão** (§10): apagar
no meio do pipeline correria com um `waitUntil` vivo, que voltaria a gravar o
que acabou de sumir. A pergunta é a mesma — "nada mais vai mudar sozinho aqui" —
e por isso é a mesma predicada, na rota e no botão.

**`descartada_em` não é um estado, e é de propósito** (migration 008). A máquina
descreve o que a sessão está *fazendo*; descartar é gesto meu, por fora, sobre
uma sessão que já parou. Como valor de `status` obrigaria toda transição e todo
guard a conhecer um estado que não transiciona para lugar nenhum. Como
propriedade à parte, ele é lido num lugar só: o `WHERE s.descartada_em IS NULL`
de `paginaDeSessoes`.

**Não há máquina de recuperação.** Uma gravação que a aba interrompeu fica em
`gravando` até `/finalizar` levá-la adiante (§14). O que existe é uma marca só,
na lista de sessões, e ela sai de `confirmada` — verde é sessão revisada, branco
é sessão com trabalho pendente (`jaRevisada`, seção 11).

`terminouDeProcessar` existe porque `completa` não serve para parar o polling da
leitura: `completa` é sobre a transcrição e fica verdadeiro em `transcrito`, ou
seja, antes de a extração acabar — a tela nunca veria o link para a revisão
aparecer.

A guarda real da idempotência está no Cypher: `atualizarSessao(id, mudança,
sePartirDe)` só grava se o status atual estiver na lista, então um segundo
`finalizar` não rebaixa uma sessão já `em_revisao`, e nada devolve `confirmada`
para trás.

**Guarda que não casa não estoura: devolve `null`.** A cláusula é um `WHERE`, e
não casar é resultado vazio, não exceção — o chamador segue como se tivesse
gravado. É o que faz a trava ser barata e idempotente, e é também o que faz uma
guarda errada ser invisível. Quem precisa saber se a transição aconteceu tem de
olhar o retorno; hoje ninguém precisa.

### 5.1 Onde o motivo de uma falha aparece

`erro` é um estado sem explicação, e cobre duas coisas diferentes:
falha de transcrição e falha de extração. A tela só sabe dizer que falhou e
o grafo guarda o status, não a causa — `:Sessao` não tem propriedade de erro, e
acrescentar uma é mudança de schema. **O motivo existe só no log do servidor**,
com prefixo:

| Linha | Quem escreve | Quando |
|---|---|---|
| `[stt] sessão <id> bloco <i> falhou:` | rota `/chunks/:i/pronto` | o bloco falhou ao ser transcrito na subida (ou o avanço das janelas estourou) |
| `[pipeline] sessão <id> bloco <i> não transcreveu:` | laço de espera em `finalizarSessao` | a retentativa da finalização falhou |
| `[pipeline] sessão <id>: desistiu após 150s…` | `finalizarSessao` | o prazo estourou; lista os blocos que faltaram, e diz se a causa foi rate limit |
| `[limite] <rótulo>: rate limit do Gateway — esperando Ns` | `comEsperaDeLimite` | o Gateway recusou por excesso e vai haver outra tentativa |
| `[limite] <rótulo>: sem orçamento para esperar Ns` | `comEsperaDeLimite` | o limite ainda vale, mas esperar estouraria o prazo de quem chamou |
| `[limite] <rótulo>: a chamada não voltou em Ns — cortada.` | `comEsperaDeLimite` | a quarta classe de falha (§5.3): o Gateway não respondeu dentro do prazo e **eu** cortei, antes que o `maxDuration` matasse a função |
| `[limite] <rótulo>: sem orçamento para chamar o modelo` | `comEsperaDeLimite` | o que sobrava do prazo não cabia nem a chamada; melhor não chamar do que morrer no meio dela |
| `[janela] sessão <id> janela <n> (blocos a-b): +N átomo(s)…` | `avancarJanelas` | uma janela fechou — é o `console.log` que mostra a extração acontecendo durante a gravação, e ele diz de quantas entidades era o dossiê |
| `[candidatas] sessão <id> bloco <i>:` | `/pronto` e `candidatasDaJanela` | a busca daquele bloco falhou; o dossiê fica menor e a janela roda sem aquelas candidatas |
| `[grafias] sessão <id>: N grafia(s) viraram alias` | `/confirmar` | a grafia que eu falei virou alias do nó que eu confirmei (§4.14) |
| `[janela] sessão <id> janela <n> falhou:` | `avancarJanelas` | a janela não fechou; ela fica `falhou` no `parcial.json` e é retentada na passada seguinte |
| `[janela] sessão <id>: sem orçamento para a janela <n>` | `avancarJanelas` | o prazo do `finalizar` acabou antes de a janela do fim rodar |
| `[janela] sessão <id>: janela(s) N não fecharam…` | `propostaDaSessao` | a sessão vai para `erro` e espera eu mandar re-extrair (§4.18) |
| `[janela] sessão <id> janela <n>: outro worker está nela, esperando` | `esperarQuemEstaNela` | o `/finalizar` encontrou um lease vivo e está esperando quem está na janela — condição normal, não defeito |
| `[janela] sessão <id>: janela <n> presa até o fim do orçamento` | `esperarQuemEstaNela` | esperou e o lease não soltou; é daqui que a sessão cai em `erro` |
| `[stt] sessão <id> bloco <i>: já tem dono, deixando com ele` | `transcreverBloco` | a trava do bloco funcionou e o STT **não** foi pago duas vezes (§4.18) |
| `[extracao] sessão <id> falhou:` | `extrairSessao` | o modelo estourou, ou a resposta não era JSON válido |
| `[extracao] sessão <id>: sem transcricao.json…` | `extrairSessao` | pediram extração de uma sessão sem transcrição gravada |
| `[finalizar] sessão <id> falhou:` | rota `/finalizar` | `finalizarSessao` estourou uma exceção |
| `[extrair] sessão <id> falhou:` | rota `/extrair` | a re-extração manual morreu — é o log do botão "reextrair" da lista |
| `[calibracao] sessão <id>: …` | `capturarCorrecoes` | as correções daquela revisão foram (ou não foram) registradas |
| `[atomos] N átomo(s) gravados sem vetor;` | `gravarAtomos` | o confirmar gravou e o embedding falhou — `POST /api/atomos/embutir` alcança depois (§4.10) |
| `[overrides] <id>: o hash <h> não resolve texto nenhum, usando a base` | `resolver` | um prompt editado sumiu do R2; o agente cai na base **e** carimba a base (§4.13) |
| `[overrides] não consegui ler o prompt <agente>+<hash>:` | `promptPorHash` | o mesmo, um nível abaixo — o R2 recusou a leitura |
| `[medidas] sessão <id>: não consegui gravar a medida:` | `comMedicao` | o cronômetro tropeçou; a sessão segue inteira, e é só a medida daquela invocação que se perde (§4.17) |

Os cinco últimos não são falha de sessão: a sessão segue, e o que se perde é
material de calibração, um vetor, um prompt editado ou uma medida. Estão aqui
porque esta é a tabela que responde "onde aparece o motivo", e um log que ninguém
sabe que existe não é diferente de log nenhum. As três linhas de `[janela]` e a
de `[stt]` sobre o dono do bloco também não são falha: elas dizem que uma trava
**funcionou**, e é por elas que se distingue "o sistema esperou" de "o sistema
travou".

**Falha de bloco sempre deixa rastro**: o laço de espera loga o erro do bloco em
vez de engoli-lo, e `tests/pipeline.test.ts` fixa isso.

Log de terminal morre com a janela. Por isso `scripts/dev.ps1` também escreve
tudo em `logs/dev-<data>.log` (seção 13) — sem isso, diagnosticar uma falha
exige reproduzi-la.

### 5.2 Quando a falha é da rede, e não do sistema

Tudo que este sistema faz sai por `fetch`: Neo4j pela HTTP Query API, R2 pela
API S3, modelo pelo AI Gateway. O undici derruba a conexão que não completa o
handshake em **10 s** — o erro é `TypeError: fetch failed` com
`UND_ERR_CONNECT_TIMEOUT` no `cause`, e o pedido **nunca saiu**. Em link com
meia dúzia de saltos e jitter alto isso acontece de verdade: o handshake frio
falha, e as tentativas seguintes abrem em menos de 400 ms.

**Esses 10 s não são configuráveis.** O `fetch` do Node usa a cópia interna do
undici, e ela recusa um dispatcher vindo do pacote `undici` do npm — por símbolo
global ou pelo `init`, dá `UND_ERR_INVALID_ARG`. Aumentar o prazo exigiria
trocar a implementação de `fetch` do processo inteiro e atropelar o cache de
fetch do Next. Não faz falta: quem conserta é o retry, não o prazo maior.

`rede.ts` classifica o erro pelo código dentro do `cause` e decide se repetir é
seguro — a pergunta é sempre a mesma, "o pedido chegou a sair?":

| Classe | Códigos | Repete |
|---|---|---|
| antes do envio | `UND_ERR_CONNECT_TIMEOUT`, `ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN`, `EHOSTUNREACH`, `ENETUNREACH` | sempre — a conexão nem abriu, não há efeito para duplicar |
| depois de abrir | `ECONNRESET`, `ETIMEDOUT`, `EPIPE`, `UND_ERR_SOCKET`, `UND_ERR_HEADERS_TIMEOUT`, `UND_ERR_BODY_TIMEOUT` | só em leitura (`{ leitura: true }`) |
| erro do serviço | Cypher inválido, 404, 412 | nunca — repetir o que vai falhar de novo só faz a tela esperar mais |

É a regra inviolável 4 vista pelo outro lado: `query` do Neo4j serve escrita
também, e por isso vai sem `leitura` — só repete o que comprovadamente não saiu.
O mesmo vale para o `put` do R2, que é condicional: se o primeiro PUT chegou, o
segundo levaria 412 e viraria conflito falso no manifest. `getTexto`, `getBytes`
e `existe` são leitura pura e repetem as duas classes.

São **3 tentativas**, com o mesmo backoff da fila de upload (1 s, 2 s, com
jitter). Pior caso de uma chamada: ~33 s antes de desistir.

O caminho do modelo não passa por `rede.ts` e não precisa: o AI SDK reconhece o
`fetch failed` como `isRetryable` e já repete por conta própria (`maxRetries`
padrão 2). O que precisa de `rede.ts` é o que fala direto com Neo4j e R2.

Quando desiste, a rota responde **502** por `erroDeInfra`, com a causa no log e
uma frase legível na tela — `fetch failed` não diz nada a quem está olhando.
Sem esse tratamento o erro subiria cru e o Next responderia **500** com
stack de undici, o que faz a rede parecer defeito do sistema:

| Linha | Quem escreve | Quando |
|---|---|---|
| `[rede] <alvo>: <código> — tentativa n/3` | `comRetry` | uma tentativa falhou e vai haver outra |
| `[sessoes] …` | `GET`/`POST /api/sessoes` | Neo4j fora |
| `[extracao] …` | `GET /api/sessoes/:id/extracao` | Neo4j ou R2 fora |
| `[entidades] …` | `GET /api/entidades` | Neo4j fora |

A outra metade do conserto é não pagar a latência quatro vezes: as quatro buscas
de `GET /api/sessoes/:id/extracao` (uma no Neo4j e três no R2 — `extracao.json`,
`transcricao.json` e `extracao-anterior.json`) são independentes e
vão em `Promise.all`. Em série, essa tela custaria a soma de quatro idas à rede.

### 5.3 Quando a falha é pressa, e não defeito

O AI Gateway pode recusar rajada de chamada, **na conta inteira e não por
modelo** (§4.2.1). É a terceira classe de falha deste sistema, e a única em que
o conserto é o relógio:

| Classe | Onde mora | O que fazer |
|---|---|---|
| rede | `rede.ts` | repetir já, se o pedido não saiu |
| serviço | quem chamou | subir: repetir vai falhar igual |
| **limite de taxa** | **`limite.ts`** | **esperar dezenas de segundos e repetir** |
| **a chamada que não volta** | **`limite.ts`** | **cortar dentro do orçamento e subir — nunca repetir** |

`rede.ts` não serve aqui, e juntar os dois seria erro: lá a pergunta é "o pedido
chegou a sair?", e um 429 cairia em "erro do serviço — nunca repete", que é o
oposto do certo. O pedido saiu, foi recusado inteiro, repetir não duplica nada;
o que falta é **quando**.

O erro chega embrulhado — o AI SDK já tentou três vezes por conta própria e
sobe um `RetryError` com o `GatewayRateLimitError` em `lastError`. Por isso
`ehLimiteDeTaxa` percorre a cadeia (`lastError`, `errors`, `cause`) e reconhece
pela forma, em quatro sinais: `name`, `type`, `statusCode` e, por último, a
mensagem. **Nada disso importa `@ai-sdk/gateway`** — regra inviolável 8 vale
também para o tipo do erro; `tests/limite.test.ts` é quem avisa se o SDK mudar
o embrulho.

As esperas são **20 s e 60 s**, com o jitter da fila de upload, sempre para
cima: a medição mostrou ~75 s de janela, e esperar menos que o medido é o jeito
de a espera não servir para nada. São duas e não cinco porque o teto de cima é o
`maxDuration` de 300 s da rota, e a extração ainda roda depois.

**O limite é do free tier.** Com créditos na conta ele não aparece, e por isso
**paralelismo é escolha, não risco** — num sistema de um usuário, requisição à
toa não é custo. A escada longa fica porque custa zero enquanto o limite não
volta, e porque conta gratuita é um estado ao qual se pode voltar.

**Duas escadas, e a diferença é o diagnóstico.** Tratar tudo que não é 429 como
definitivo faria um 502 do Gateway, um socket que morreu no meio ou um
`overloaded` do provedor derrubarem a janela na primeira tentativa — e com o
penhasco sendo erro (§4.18), falha boba de rede custaria a sessão.
`ehTransitorio` reconhece as três formas — código de rede dentro do `cause`,
status 5xx ou 408, e o `overloaded` que vem no corpo —, e elas levam
`ESPERAS_TRANSITORIA_MS`, de 1 s e 3 s. Os **contadores são separados**: um blip
de rede no começo não gasta a paciência que o 429 vai precisar depois. Fora das
duas listas nada é repetido — modelo inexistente, prompt que estoura o contexto
e JSON inválido falham igual na segunda vez.

Quem chama dentro de um prazo passa o seu (`ate`): `finalizarSessao` tem 150 s
para os blocos que faltam, e as janelas do fim ficam com o que sobrar até
`PRAZO_DA_FUNCAO_MS` (280 s contados do começo da função). Uma espera que não
caiba nesse orçamento é pior que não esperar — o `waitUntil` morre antes de a
chamada voltar, e a falha fica sem nem o log. **O `/pronto` também passa
`ate`**, o mesmo `PRAZO_DA_FUNCAO_MS` contado da chegada do pedido. Durante a
gravação esperar o limite passar é de graça — eu ainda estou falando —, dentro
da vida da função; o prazo existe porque uma chamada pode durar 180 s, e
extração e resolução em série passariam do `maxDuration` sem ele.

Os pontos que falam com modelo no caminho automático estão cobertos: `stt.ts`,
`extracao.ts` e `resolucao.ts`. A extração não roda concentrada logo depois
dos 30 blocos de STT, quando o limite estaria mais perto de estourar: são oito
chamadas menores espalhadas pela gravação.

**A resolução espera também.** O critério é "quem roda em `waitUntil` espera",
e o agente 2 roda em **toda** janela com candidato, oito vezes por sessão de
15 min, na mesma rajada em que o STT disputa o limite da conta. Ele recebe o
`ate` de quem o chamou — o mesmo da extração daquela janela. Se mesmo assim
falhar, as menções voltam como dúvida e a revisão me deixa escolher (§4.8).

Perfil, duplicatas e embedding **não** estão cobertos: saem de um clique meu, e
ali a falha aparece na tela em vez de matar uma sessão em `waitUntil`.

A busca por candidatas (§4.14) não precisa de espera própria: ela sai por
`candidatosSemanticos`, que engole a própria falha, e o `semantico: false` do
arquivo é o que manda o `/finalizar` refazer o bloco uma vez.

Quando a espera não basta, a linha de desistência diz isso com todas as letras —
"a causa foi rate limit do AI Gateway… chamar /finalizar de novo daqui a alguns
minutos costuma resolver" —, porque a alternativa é procurar defeito no código
onde só havia pressa. O áudio fica intacto no R2 e o retry é o mesmo de sempre.

**A quarta classe não é pressa: é silêncio.** Uma chamada de modelo pode não
voltar nunca — o Gateway não devolve um token, e a chamada morre no
`headersTimeout` do undici, que é 300 s, **exatamente o `maxDuration` da
rota**. Quando ele dispara não sobra orçamento nenhum para o `catch` gravar a
falha, marcar a sessão como `erro` ou cair em outro caminho — a função é morta
no meio e a sessão fica presa em `extraindo` para sempre, com a tela batendo. E
**sem streaming** nas chamadas de modelo, o Gateway só manda headers quando a
geração inteira acaba — então aquele teto é, na prática, "tempo total de
geração", e um modelo que pensa demais é indistinguível de um Gateway
pendurado.

**O conserto é o prazo por chamada, e ele mora onde já mora o orçamento.**
`comEsperaDeLimite` entrega um `AbortSignal` a quem ela embrulha, e as
quatro chamadas do caminho automático o repassam ao `generateText`/`transcribe`
(`stt.ts`, `extracao.ts`, `resolucao.ts`, `desempate.ts`); `embedding.ts` leva o
mesmo teto direto, sem a escada, porque quem o chama já engole a falha.

| | Prazo da chamada |
|---|---|
| quem passa `ate` (`/pronto`, `/finalizar`, `/extrair`) | o menor entre `TETO_CHAMADA_MS` (180 s) e o que sobra do prazo, menos `FOLGA_PARA_GRAVAR_MS` (5 s) |
| quem não passa | `TETO_CHAMADA_MS`, 180 s |

`TETO_CHAMADA_MS` é 180 s: com o `deepseek/deepseek-v4.1-flash` a extração passa
de 90 s na cauda, e a resolução tem teto de 100 mil tokens. Com 180 s a corrente
do `/pronto` não cabe nos 300 s sem prazo, e quem segura a função é o `ate`,
que as quatro chamadas do caminho automático recebem todas. Fora dele, o
confronto corta pelo prazo do próprio elo (§4.15.3), o chat pelo meu "parar", e
enriquecimento e retrato não têm prazo por chamada. A folga de 5 s existe porque
prazo que termina junto com o orçamento é o mesmo defeito outra vez, só que
menor: quando a chamada é cortada ainda falta escrever `parcial.json`, o objeto
de medidas e o estado da sessão, e os três são laços por etag.

**O sinal é passado, e não uma corrida por fora**, porque cortar o socket é o que
faz a chamada *terminar* — e chamada que termina é chamada que `medirAgente`
consegue contar. Corrida por fora deixaria a promessa pendurada e o custo dela
fora do registro, justamente no caso que a slice 8 existe para medir.

**E o corte não é transitório.** `PrazoDeChamadaError` sobe na primeira, como o
modelo inexistente e o JSON inválido, e `ehTransitorio` o recusa na primeira
linha. Sem essa amarra o conserto viraria o defeito: `UND_ERR_HEADERS_TIMEOUT`
está em `DEPOIS_DE_ABRIR` (`rede.ts`), então uma chamada pendurada seria lida
como blip de rede e ganharia a escada curta — três chamadas cortadas onde havia
uma, num `waitUntil` que morre aos 300 s. Vindo de fora, sem ter sido eu a
cortar, o mesmo código continua sendo transitório.

**Orçamento que não cabe a chamada não vira chamada**: sobe `PrazoDeChamadaError`
com `prazo_ms: 0` e quem chamou tem tempo de gravar — chamar assim mesmo faria o
`waitUntil` morrer no meio, sem deixar sequer o log.

### 5.4 Quando não há o que transcrever

Há uma quarta classe, e ela não é falha nenhuma: **o bloco em que ninguém fala.**
Trinta segundos de silêncio existem em toda sessão real — eu paro para pensar, o
arquivo importado tem uma pausa longa. O provedor não devolve texto, e o AI SDK
levanta `AI_NoTranscriptGeneratedError`.

Tratar isso como falha derrubaria a **sessão inteira**: o erro é
determinístico, e o laço de `finalizarSessao` insistiria no mesmo bloco mudo
pelos 150 s de `ESPERA_MAX_MS`, sempre com a mesma resposta.

`ehSemTranscricao` (`stt.ts`) reconhece esse erro e devolve **bloco vazio**:
texto `""`, nenhuma palavra. O bloco é gravado, o manifest anda, a sessão segue.
A concatenação já sabia lidar com ele — `juntarTexto` descarta texto vazio e o
bloco não contribui palavra nenhuma —, e a janela de extração cujo texto sai
vazio devolve lista vazia em vez de chamar o modelo (§4.6). Só a sessão **inteira**
vazia continua estourando, que é o comportamento que `extrair` sempre teve.

Reconhecido pelo `isInstance` do próprio SDK, com o `name` como segunda via para
o erro que atravessou serialização — a mesma prudência de `ehLimiteDeTaxa`. `ai`
não é pacote de provedor: a regra inviolável 8 continua de pé.

**O que se perde:** um tropeço do provedor que devolva nada tem exatamente a
mesma cara que silêncio, e vira bloco vazio em silêncio em vez de erro
barulhento. A troca é de olho aberto — o outro lado dela é perder a sessão
inteira toda vez que eu faço uma pausa —, e o sinal é a linha
`[pipeline] … STT não ouviu fala — bloco vazio`, que sai em todo bloco vazio.
Transcrição com um buraco se confere ali, contra o áudio, que está intacto no R2.

