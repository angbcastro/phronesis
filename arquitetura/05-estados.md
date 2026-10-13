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

`transcrito` **não é mais terminal**: a extração emenda nele. O fim da linha é
`confirmada`, e quem confirma sou eu, na revisão — `estaConcluida` mudou junto.
`confirmada` **não tem transição de saída**, e desde 05/09 isso vale de fato: as
quatro escritas de `erro` (três em `pipeline.ts`, uma na rota `/finalizar`)
levam a lista de onde se pode cair em `erro`, e ela é a máquina inteira menos
`confirmada`. Antes elas iam sem guarda nenhuma, e um `/finalizar` numa sessão
já confirmada cuja `transcricao.json` tivesse sumido do R2 gravava `erro` por
cima: os átomos continuavam no grafo e a sessão aparecia como falha.

O `erro` sai de qualquer estado porque qualquer passo pode falhar — o que ele
não pode é desfazer o único estado terminal. `em_revisao → extraindo` é o botão
"reextrair" da lista de sessões, e a volta a partir de `erro` é retry manual.

**Esse retry esteve trancado por um guard de rota.** `POST /:id/extrair` barrava
em `temTranscricao`, que não inclui `erro`, e respondia `409 sessão em 'erro':
não há transcrição para extrair` — numa sessão cuja `transcricao.json` estava
intacta no R2, e dez linhas abaixo do próprio docstring que diz que a rota
existe para quando "a sessão ficou em `extraindo` ou `erro`". Todo o resto já
concordava: `PERMITIDAS.erro` inclui `extraindo`, e a escrita em `pipeline.ts`
lista `erro` como origem válida. Hoje o guard é `podeReextrair`, que é
`temTranscricao` mais `erro`. As duas perguntas ficaram separadas de propósito:
`temTranscricao` é "a transcrição está pronta para eu mostrar", e é o que a tela
de leitura e a lista continuam usando; `podeReextrair` é "vale disparar a
extração". Sessão que caiu em `erro` antes de existir transcrição não vira 500 —
`extrairSessao` procura o `transcricao.json` e devolve `erro` com log próprio.

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

**`terminouDeProcessar` ganhou um segundo consumidor na 4.10**, e é a guarda do
`DELETE` de sessão (§10): apagar no meio do pipeline correria com um `waitUntil`
vivo, que voltaria a gravar o que acabou de sumir. A pergunta é a mesma — "nada
mais vai mudar sozinho aqui" — e por isso é a mesma predicada, na rota e no botão.

**`descartada_em` não é um estado, e é de propósito** (migration 008). A máquina
descreve o que a sessão está *fazendo*; descartar é gesto meu, por fora, sobre
uma sessão que já parou. Como valor de `status` obrigaria toda transição e todo
guard a conhecer um estado que não transiciona para lugar nenhum. Como
propriedade à parte, ele é lido num lugar só: o `WHERE s.descartada_em IS NULL`
de `todasSessoes`.

**A máquina de recuperação foi apagada inteira.** Com o chip da home saíram
`GET /api/sessoes/abertas` e `sessoesAbertas()`, e com eles as peças que só
existiam para alimentá-los: `STATUS_ABERTOS`, `estaAberta`, `foiAbandonada` e
`duracaoPorChunks` (`estados.ts`), `ABANDONO_MIN` (`tipos.ts`), `proximoIndice` e
`duracaoEstimadaS` (`manifest.ts`), e a opção `indiceInicial` do `Gravador`.
Nenhuma delas ficou como código morto com teste em volta: elas estão no git, e a
que voltar a ser necessária se reescreve em três linhas. O que fica no lugar é
uma marca só, na lista de sessões, e ela sai de `confirmada` — verde é sessão
revisada, branco é sessão com trabalho pendente (`jaRevisada`, seção 11).

**`abandonada` saiu da máquina junto.** Ele estava em `STATUS_SESSAO`, na tabela
de transições e nos `sePartirDe` de `/pronto`, `/finalizar` e `pipeline.ts` — mas
nenhuma escrita no grafo jamais produziu esse status: `foiAbandonada()` só
reetiquetava a resposta de `/api/sessoes/abertas` em memória, nunca o nó. Era
vocabulário sem fato, e um estado que nunca acontece só serve para o próximo
leitor tratar como caso real. **Nenhum nó do banco carrega esse valor**, pelo
mesmo motivo — não há dado a migrar, e por isso a remoção não pede migration.
Uma gravação que a aba interrompeu fica em `gravando` até `/finalizar` levá-la
adiante, que é o que já acontecia de fato.

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

`erro` é um estado sem explicação — e agora ele cobre duas coisas diferentes,
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
| `[candidatas] sessão <id> bloco <i>:` | `/pronto` e `candidatasDaJanela` | a busca daquele bloco falhou; o dossiê fica menor e a janela roda como na 4.8 |
| `[grafias] sessão <id>: N grafia(s) viraram alias` | `/confirmar` | a grafia que eu falei virou alias do nó que eu confirmei (§4.14) |
| `[janela] sessão <id> janela <n> falhou:` | `avancarJanelas` | a janela não fechou; ela fica `falhou` no `parcial.json` e é retentada na passada seguinte |
| `[janela] sessão <id>: sem orçamento para a janela <n>` | `avancarJanelas` | o prazo do `finalizar` acabou antes de a janela do fim rodar |
| `[janela] sessão <id>: janela(s) N não fecharam…` | `propostaDaSessao` | a sessão vai para `erro` e espera eu mandar re-extrair. Era o fallback de passe único até a slice 8 (§4.18) |
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

O laço de espera engolia o erro do bloco em `catch {}` — a falha ia para `erro`
sem uma linha sequer, e depois do fato não havia o que investigar.
`tests/pipeline.test.ts` fixa isso: falha de bloco sempre deixa rastro.

Log de terminal morre com a janela. Por isso `scripts/dev.ps1` também escreve
tudo em `logs/dev-<data>.log` (seção 13) — sem isso, diagnosticar uma falha
exige reproduzi-la.

### 5.2 Quando a falha é da rede, e não do sistema

Tudo que este sistema faz sai por `fetch`: Neo4j pela HTTP Query API, R2 pela
API S3, modelo pelo AI Gateway. O undici derruba a conexão que não completa o
handshake em **10 s** — o erro é `TypeError: fetch failed` com
`UND_ERR_CONNECT_TIMEOUT` no `cause`, e o pedido **nunca saiu**. Em link com
meia dúzia de saltos e jitter alto isso acontece de verdade: medido no link que
produziu o primeiro caso, o handshake frio com o R2 falhou depois de 24,8 s e as
quatro tentativas seguintes abriram em menos de 400 ms cada.

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
padrão 2). Quem estava descoberto era só o que fala direto com Neo4j e R2.

Quando desiste, a rota responde **502** por `erroDeInfra`, com a causa no log e
uma frase legível na tela — `fetch failed` não diz nada a quem está olhando.
Rota sem esse tratamento deixava o erro subir cru e o Next respondia **500** com
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
vão em `Promise.all`. Em série, essa tela custava a soma de quatro idas à rede.

### 5.3 Quando a falha é pressa, e não defeito

Medido em 2026-09-02 (§4.2.1): o free tier do AI Gateway recusa rajada de
chamada, **na conta inteira e não por modelo**. É a terceira classe de falha
deste sistema, e a única em que o conserto é o relógio:

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

Quem chama dentro de um prazo passa o seu (`ate`): `finalizarSessao` tem 150 s
para os blocos que faltam, e as janelas do fim ficam com o que sobrar até
`PRAZO_DA_FUNCAO_MS` (280 s contados do começo da função). Uma espera que não
caiba nesse orçamento é pior que não esperar — o `waitUntil` morre antes de a
chamada voltar, e a falha fica sem nem o log. **Desde 30/09 o `/pronto` também
passa `ate`**, o mesmo `PRAZO_DA_FUNCAO_MS` contado da chegada do pedido. As
janelas que fecham durante a gravação iam sem prazo porque ali esperar o limite
passar é de graça — eu ainda estou falando —, e continua sendo, dentro da vida
da função. O que mudou é que uma chamada agora pode durar 180 s, e extração e
resolução em série passariam do `maxDuration` sem ele.

Os dois pontos que falam com modelo no caminho automático estão cobertos:
`stt.ts` e `extracao.ts`. A extração era a mais exposta das duas justamente por
rodar logo depois dos 30 blocos de STT, que é quando o limite está mais perto de
estourar; **a slice 4.8 desfez essa concentração** — são oito chamadas menores
espalhadas pela gravação, e sete delas sem prazo nenhum para esperar.

**A resolução entrou na lista na 4.9**, e ela é o terceiro ponto do caminho
automático. Até a 4.8 o agente 2 falhava em vez de esperar; a degradação já era
a certa (as menções voltam como dúvida e a revisão me deixa escolher, §4.8), mas
o critério declarado aqui é "quem roda em `waitUntil` espera", e ele estava do
lado errado da linha. O que tornou o conserto necessário foi a 4.9: o agente
passou a rodar em **toda** janela, oito vezes por sessão de 15 min, na mesma
rajada em que o STT já disputa o limite da conta. Ele recebe o `ate` de quem o
chamou — o mesmo da extração daquela janela.

Perfil, duplicatas e embedding **não** estão cobertos: saem de um clique meu, e
ali a falha aparece na tela em vez de matar uma sessão em `waitUntil`.

A busca por candidatas (§4.14) não precisa de espera própria: ela sai por
`candidatosSemanticos`, que engole a própria falha, e o `semantico: false` do
arquivo é o que manda o `/finalizar` refazer o bloco uma vez.

Quando a espera não basta, a linha de desistência diz isso com todas as letras —
"a causa foi rate limit do AI Gateway… chamar /finalizar de novo daqui a alguns
minutos costuma resolver" —, porque a alternativa é procurar defeito no código
onde só havia pressa. O áudio fica intacto no R2 e o retry é o mesmo de sempre.

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

**O conserto é o prazo por chamada, e ele mora onde já mora o orçamento.**
`comEsperaDeLimite` passou a entregar um `AbortSignal` a quem ela embrulha, e as
quatro chamadas do caminho automático o repassam ao `generateText`/`transcribe`
(`stt.ts`, `extracao.ts`, `resolucao.ts`, `desempate.ts`); `embedding.ts` leva o
mesmo teto direto, sem a escada, porque quem o chama já engole a falha.

| | Prazo da chamada |
|---|---|
| quem passa `ate` (`/pronto`, `/finalizar`, `/extrair`) | o menor entre `TETO_CHAMADA_MS` (180 s) e o que sobra do prazo, menos `FOLGA_PARA_GRAVAR_MS` (5 s) |
| quem não passa | `TETO_CHAMADA_MS`, 180 s |

`TETO_CHAMADA_MS` era 90 s e subiu para 180 s em 30/09: com o
`deepseek/deepseek-v4.1-flash` a extração passa de 90 s na cauda, e a resolução
ganhou teto de 100 mil tokens — a ~240 tokens/s, 90 s cortava por volta de 20
mil, antes do limite do próprio modelo (32.768). Com 90 s, a corrente do
`/pronto` cabia nos 300 s mesmo sem prazo; com 180 s não cabe, e quem segura a
função agora é o `ate`, que as quatro chamadas do caminho automático recebem
todas. Os agentes fora dele (chat, confronto, enriquecimento, retrato) não
repassam o sinal e não são afetados. A folga de 5 s
existe porque prazo que termina junto com o orçamento é o mesmo defeito outra
vez, só que menor: quando a chamada é cortada ainda falta escrever
`parcial.json`, o objeto de medidas e o estado da sessão, e os três são laços por
etag.

**O sinal é passado, e não uma corrida por fora**, porque cortar o socket é o que
faz a chamada *terminar* — e chamada que termina é chamada que `medirAgente`
consegue contar. Corrida por fora deixaria a promessa pendurada e o custo dela
fora do registro, justamente no caso que a slice 8 existe para medir.

**E o corte não é transitório.** `PrazoDeChamadaError` sobe na primeira, como o
modelo inexistente e o JSON inválido, e `ehTransitorio` o recusa na primeira
linha. Sem essa amarra o conserto viraria o defeito: `UND_ERR_HEADERS_TIMEOUT`
está em `DEPOIS_DE_ABRIR` (`rede.ts`), então uma chamada pendurada seria lida
como blip de rede e ganharia a escada curta — três chamadas de 90 s onde havia
uma, num `waitUntil` que morre aos 300 s. Vindo de fora, sem ter sido eu a
cortar, o mesmo código continua sendo transitório.

**Orçamento que não cabe a chamada não vira chamada.** Antes o modelo era chamado
assim mesmo e o `waitUntil` morria no meio dele, sem deixar sequer o log; agora
sobe `PrazoDeChamadaError` com `prazo_ms: 0` e quem chamou tem tempo de gravar.

### 5.4 Quando não há o que transcrever

Há uma quarta classe, e ela não é falha nenhuma: **o bloco em que ninguém fala.**
Trinta segundos de silêncio existem em toda sessão real — eu paro para pensar, o
arquivo importado tem uma pausa longa. O provedor não devolve texto, e o AI SDK
levanta `AI_NoTranscriptGeneratedError`.

Até 09/09 isso derrubava a **sessão inteira**. O erro é determinístico: o laço de
`finalizarSessao` insistia no mesmo bloco mudo pelos 150 s de `ESPERA_MAX_MS`,
sempre com a mesma resposta, e depois mandava tudo para `erro`. Medido na sessão
`mtu336r50a5i4j3k2o1g`: 9 blocos, 7 com fala, os blocos 4 e 8 com RMS de 0,004
contra 0,11 dos outros. Quatro minutos e meio de diário perdidos por duas pausas
minhas — e o diagnóstico custou baixar os WAV do R2 e medir, porque o log dizia
"não transcreveu" para silêncio e para defeito com as mesmas palavras.

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
mesma cara que silêncio, e agora vira bloco vazio em silêncio em vez de erro
barulhento. A troca foi feita de olho aberto — o outro lado dela era perder a
sessão inteira toda vez que eu faço uma pausa —, e o sinal é a linha
`[pipeline] … STT não ouviu fala — bloco vazio`, que sai em todo bloco vazio.
Transcrição com um buraco se confere ali, contra o áudio, que está intacto no R2.

