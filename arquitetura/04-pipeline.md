## 4. O pipeline: da fala à proposta, e dela ao grafo

### 4.1 Paralela, não no fim: a transcrição e a extração acompanham a fala

Cada bloco é transcrito assim que sobe, disparado por `waitUntil` na rota
`/pronto` — o cliente não espera pelo STT, ele volta a gravar. Quando a gravação
de 15 minutos para, só falta o último bloco. É isso que faz o sistema parecer
rápido (aceite 5).

A extração acompanha a fala pelo mesmo motivo: uma chamada de raciocínio sobre a
transcrição inteira, feita só depois de eu parar, responderia por quase toda a
espera entre parar de falar e revisar.

Na mesma rota `/pronto`, encadeados no mesmo `waitUntil`, rodam
`recuperarCandidatas` — a busca que pergunta ao grafo quem aquele bloco cita
(§4.14) — e `avancarJanelas`: a cada `JANELA_BLOCOS` (4) blocos transcritos, uma
janela de 2 minutos é extraída e resolvida, e os átomos dela vão para
`parcial.json` (§4.6). Quando eu paro, `/finalizar` fecha a janela do fim — no
máximo 3 blocos — e monta a proposta a partir do acumulado.

Três consequências que valem estar escritas:

- **A chamada mais cara não acontece logo depois de 30 chamadas de STT**, que
  seria o pior momento para o rate limit da conta (§5.3): ela é oito chamadas
  pequenas espalhadas pelos 15 minutos, e durante a gravação esperar o limite
  passar é de graça — não há prazo a estourar.
- **A resposta da extração pode truncar mesmo numa janela pequena.** O teto de
  saída cobre **raciocínio e texto juntos**, e o volume do pensamento não
  encolhe com a entrada do jeito que o JSON encolhe. Encolher a janela não
  protege nada; o que protege está no §4.6.
- **O caminho de uma janela só é o mesmo código.** Arquivo importado que o
  navegador não fatiou, e gravação de menos de dois minutos, passam por uma
  janela que se declara a sessão inteira. Janela que não fecha não cai num passe
  único: a sessão vai para `erro` e espera eu mandar re-extrair (§4.18).

### 4.2 Porta única de modelo (Vercel AI Gateway)

**Todo tráfego de LLM deste sistema sai pelo Vercel AI Gateway** — STT,
extração, resolução, embedding, chat, todos. Uma chave (`AI_GATEWAY_API_KEY`),
um lugar para ver custo e latência, e trocar de provedor é mudar uma variável de
ambiente, sem tocar em código. É a regra inviolável 8.

O mecanismo está no próprio SDK. `resolveLanguageModel` e
`resolveTranscriptionModel` mandam qualquer `model` em string para o provedor
global:

```
getGlobalProvider() → globalThis.AI_SDK_DEFAULT_PROVIDER ?? gateway
```

Como o projeto nunca define `AI_SDK_DEFAULT_PROVIDER`, **id em string sai pelo
Gateway** (`https://ai-gateway.vercel.sh/v4/ai`) — vale para transcrição, texto,
embedding, imagem e fala. O que fura a porta é importar um pacote de provedor
(`@ai-sdk/openai`, `openai`, `groq-sdk`…) e passar o **objeto** de modelo: aí o
SDK fala direto com o provedor e o Gateway nunca vê a chamada.

Daí a forma da regra, que é verificável em vez de aspiracional:

| | |
|---|---|
| Endereçamento | string `provedor/modelo`, sempre por `src/lib/modelos.ts` |
| Dependências | nenhum pacote de provedor no `package.json` |
| Endpoints | nenhum host de provedor escrito à mão |
| Chaves | só `AI_GATEWAY_API_KEY`; chave de provedor não existe aqui |

`src/lib/modelos.ts` é o único lugar que resolve id de modelo: valida o formato
(`STT_MODEL` mal escrito estoura antes de qualquer byte sair), extrai o provedor
para `providerOptions` e confere a chave do Gateway antes da chamada.
`modeloExtracao()` está ao lado de `modeloStt()`, no mesmo formato — id literal
não se espalha pelo código.

`tests/gateway.test.ts` varre `src/` e `scripts/` a cada `pnpm test` e falha se
algum dos quatro pontos da tabela for furado. É o que sustenta a promessa de
"uma chave, um lugar para ver custo" a cada agente novo que entra.

**Passam por aqui catorze funções, uma por agente** — `modeloRetrato()` serve
aos dois do retrato —, cada uma com sua variável de ambiente (§12), e todos os
agentes com caixa no painel de `/agentes` (§4.13):

| Função | Agente | Padrão |
|---|---|---|
| `modeloStt()` | STT | `xai/grok-stt` |
| `modeloExtracao()` | `extracao-9` | `deepseek/deepseek-v4.1-flash` |
| `modeloResolucao()` | `resolucao-5` | o da extração |
| `modeloDesempate()` | `desempate-1` | o da resolução |
| `modeloPerfil()` | `perfil-1` | o da extração |
| `modeloEnriquecimento()` | `enriquecimento-1` | o da extração |
| `modeloRetrato()` | `retrato-1`, `retrato-dimensoes-1` | o do enriquecimento — um para os dois (slice 10, §4.20) |
| `modeloCalibracao()` | `calibracao-2` | o da extração |
| `modeloRedacao()` | `redacao-1` | o da calibração |
| `modeloDuplicatas()` | `duplicatas-2` | `deepseek/deepseek-v4.1-flash` |
| `modeloEmbedding()` | embedding | `openai/text-embedding-3-small` |
| `modeloConfronto()` | `confronto-3` | `deepseek/deepseek-v4.1-flash` — próprio (§4.15.3) |
| `modeloChat()` | `chat-7` | `deepseek/deepseek-v4.1-flash` — próprio, para a troca do modelo da extração não arrastar o chat |
| `modeloTituloChat()` | `titulo-chat-1` | o do chat |

A deduplicação de **entidade** é o `duplicatas-2` (§8.2). A de **átomo** não
existe: dizer a mesma coisa em duas sessões cria dois. `tests/agentes.test.ts`
é a guarda que impede um agente novo de nascer por fora desta porta.

### 4.2.1 Por que o STT é o `xai/grok-stt`, e não um melhor de texto

A pergunta não é quem transcreve melhor: é quem devolve **tempo**. Sem tempo não
há procedência, que a visão §4 lista como necessidade: todo átomo nasceria com
`inicios_s`, `fins_s` e `ancoras` vazios, o player da revisão sumiria e
"escuto antes de aprovar" deixaria de existir.

| Modelo | Tempo | Texto | Custo/30 s |
|---|---|---|---|
| `xai/grok-stt` | **palavra** — `segments` de uma palavra cada | o pior dos cinco | $0,0008 |
| `openai/whisper-1` | frase — segmentos de ~8 s | bom | $0,0029 |
| `google/gemini-3.5-transcribe` | **nenhum** | o melhor dos cinco | $0,0014 |
| `openai/gpt-4o-transcribe` | **nenhum** | bom | $0,0015 |
| `openai/gpt-4o-mini-transcribe` | **nenhum** | bom | $0,0008 |

`deepgram/*`, `assemblyai/*`, `elevenlabs/*`, `groq/whisper-*`,
`mistral/voxtral-*`, `fal/wizper`, `revai/*` e `azure/whisper`: `Model not
found`. Não estão neste Gateway — e é de **Deepgram** que vem o nome `keyterm`
usado em `stt.ts`, o que explica a opção estar lá.

O tempo elimina os três modelos sem timestamp por melhor que seja o texto
deles. O custo declarado é a prosa: o grok escreve pior que os outros, e
transcrição estranha numa sessão de verdade tem aqui a primeira suspeita.

#### O Gemini escreve melhor, e é surdo à lista de nomes

O `google/gemini-3.5-transcribe` escreve a prosa melhor que o grok, e acerta
sozinho nome próprio que o grok só acerta com a lista. Ele é recusado assim
mesmo, pelos dois eixos que decidem: não devolve tempo (`segments: 0`, nada em
`providerMetadata`), e **não tem por onde receber o vocabulário** — cinco nomes
de opção (`keyterm`, `phrases`, `speechContexts`, `vocabulary` e `prompt`)
devolvem saída byte a byte idêntica à chamada sem opção nenhuma, e o AI SDK não
emite um `warning` sequer. Num sistema em que o nome próprio é a chave da
entidade e o insumo do agente 2, um modelo que escreve melhor a prosa e pior o
nome piora exatamente o que importa.

A âncora por bloco de 30 s resolveria a falta de tempo (a gravação já é
fatiada, e `localizarNoAudio` já toca por bloco), **mas não a de
vocabulário** — por isso não foi construída: não há, neste Gateway, um modelo
pelo qual gastá-la.

#### O rate limit é da conta, não do modelo

```
GatewayRateLimitError: Free tier requests on this model are rate-limited.
```

Ele derruba todos os modelos da conta na mesma janela: trocar de modelo não
escapa dele, e uma espera de ~75 s destrava o que três tentativas seguidas do
próprio AI SDK não destravam. Uma sessão gravada de 15 min são 30 blocos de STT.
O tratamento está em `limite.ts` (§5.3).

### 4.3 Granularidade e procedência

O contrato de transcrição do SDK garante `segments` (início e fim por trecho).
Timestamps por palavra, quando existem, vêm em `providerMetadata` e variam por
provedor. `stt.ts` tenta `palavrasDoMetadata()` primeiro e cai para
`palavrasDosSegmentos()`, registrando no bloco qual dos dois foi:

```ts
granularidade: "palavra" | "segmento"
modelo: string      // qual modelo transcreveu de fato
```

A sessão inteira vale o elo mais fraco: um único bloco por segmento rebaixa
`granularidade` da transcrição toda. Procedência tem que dizer a verdade sobre a
própria precisão — o aceite 6 (clicar no minuto 9 e ouvir o minuto 9) degrada
para precisão de frase quando é só o que o provedor devolve.

**Bloco sem palavra nenhuma não vota.** O bloco mudo volta vazio (§5.4) e não
traz tempo de coisa alguma; deixá-lo entrar na conta faria uma pausa de 30 s
rebaixar a sessão inteira para `segmento` e apagar o player por palavra de
átomos cujas âncoras são por palavra. `granularidadeDaSessao` olha só quem
trouxe palavra.

**O `xai/grok-stt` não expõe nada em `providerMetadata`**, então o bloco é
registrado como `granularidade: "segmento"` — mas os `segments` que ele
devolve têm **uma palavra cada**. Na prática a precisão é por palavra e o campo
a subdeclara. Subdeclarar é o lado seguro do erro: reclassificar depende de
decidir se "um segmento de uma palavra" conta como timestamp por palavra, o que
é escolha de produto, não de implementação. É esse comportamento — `segments`
densos o bastante para ancorar palavra por palavra — que faz este modelo ser o
único do Gateway que serve.

### 4.4 Vocabulário

Metade do que se fala são nomes próprios que o modelo não conhece: "Rodozanco"
vira "rodo zanco". O vocabulário é a união de `config/vocabulario.txt` (uma
entrada por linha, `#` é comentário) com as entidades do grafo
(`nomesParaVocabulario`), mandada como `keyterm`, respeitando o teto da API:
100 termos, 50 caracteres cada, sem repetir a mesma palavra em outra caixa.
Termo longo demais é descartado inteiro, nunca truncado pela metade.

**A união não vai inteira: `termoUtil` corta duas classes**, e o corte vale para
o que vem do arquivo e para o que vem do grafo. O ganho do vocabulário está em
nome próprio incomum, e cada vaga gasta com palavra que o modelo já escreve
certo é uma vaga a menos para o nome que ele erra:

| Corte | Por quê |
|---|---|
| pronome nunca vira keyterm (`ehPronome`) | é a mesma lista que a revisão e o confirmar usam; a entidade `eu`, que §4.6 descreve como caso real, é `:Pessoa` no grafo e **nunca** é mandada ao STT |
| palavra comum, quando a entidade tem **uma** palavra só (`COMUNS`, 26 delas) | ensinar o STT a ouvir "casa" com mais força piora a transcrição inteira em troca de nada. Só filtra termo de uma palavra: "meu pai" passa, "pai" sozinho não — e "Ana Paula" passa mesmo que "ana" fosse comum |

**A lista final é cacheada por 5 minutos** (`TTL_MS`), não indefinidamente, e o
cache é do resultado da união — arquivo ∪ grafo —, não do arquivo. Duas
consequências que valem estar escritas: um nome que eu confirmo agora leva até
5 min para chegar ao STT, e o cache é por instância serverless, que é
exatamente o desenho que §4.13 **recusa** para `overrides.ts`. A assimetria é
deliberada e o critério é o que a demora custa: "salvei uma emenda e ela não
valeu" é uma promessa quebrada sem ninguém ver; "o nome que entrou agora só
entra nos keyterms daqui a cinco minutos" custa uma grafia numa sessão, e o
ritual é de uma vez por dia.

**A lista de fato muda a transcrição** — mesmo bloco, mesma chamada, só a lista
variando:

| Lista | Saída |
|---|---|
| sem lista | "Acordei em **Porto Alegre** hoje" |
| `["Xhavier"]` (controle irrelevante) | "Acordei em **Porto Alegre** hoje" |
| `["Portalegre"]` | "Acordei em **Portalegre** hoje" |

A grafia segue a lista, e o controle mostra que um termo que não foi falado
**não** se injeta na saída. É o que sustenta a metade A da slice 3: gerar a
lista das entidades do grafo tem efeito real, não decorativo.

**Num bloco de sessão real o efeito é maior**: a lista tira um nome do ruído
puro.

| Lista | Saída |
|---|---|
| sem lista | "eu me apoiou hoje para a **Bejewel Founders**" |
| `["Adapta", "Bearing Founders", "Phronesis"]` | "eu me apoiou hoje para a **Bearing Founders**" |

Mesmo áudio, mesma chamada, 236 e 237 segmentos. Note o que a lista **não**
conserta: "eu me **apoiou**" continua errado nas duas, e "na **Adapta**"
continua saindo como "na data" mesmo com "Adapta" na lista. Ela ensina grafia
de nome próprio, não corrige gramática — e nem todo nome ela salva.

**E o canal existe só no provedor de hoje.** No `google/gemini-3.5-transcribe`,
cinco nomes de opção diferentes produzem saída byte a byte idêntica à chamada
sem opção nenhuma, sem um `warning` sequer (§4.2.1). É por isso que
`OPCAO_DE_VOCABULARIO` tem **silêncio como padrão** para provedor desconhecido:
o vocabulário some sem avisar, e um `STT_MODEL` trocado leva junto a metade A da
slice 3 sem que nada na tela mude.

#### Dá para calar o raciocínio deste modelo, e não calamos

A mesma mecânica de opção-por-provedor vale para pedir a um modelo que **pense
menos**: quando o raciocínio come o teto de saída inteiro, a janela chega sem um
byte de JSON (§4.6). `scripts/raciocinio.ts` responde se dá, e dá.

**A decisão é não usar.** O raciocínio não é o defeito — é o que a extração faz
de útil. Ler um diário falado e decidir o que vira átomo, de quem é, e o que
estende o que já foi dito é exatamente a tarefa em que pensar antes de escrever
paga. Cortá-lo consertaria o sintoma no lugar em que ele dói menos e cobraria a
conta na **qualidade da lista**, que é a única coisa deste sistema sem teste
automático e que se julga à mão, sessão por sessão. O estouro tem defesa
própria, e ela é o escalonamento de teto do §4.6.

A medição fica registrada porque a pergunta pode voltar — outro
`EXTRACAO_MODEL`, outro provedor, outro comportamento —, e porque saber que o
canal existe é diferente de usá-lo.

`pnpm probe:raciocinio` mede, contra o modelo da extração em vigor, quais
opções de fato calam o raciocínio. Algumas zeram o pensamento e devolvem o mesmo
texto; outras são ignoradas em silêncio, e o que as denuncia é o número de
tokens de raciocínio igual, ou maior, ao da linha de base. É por isso que um
nome desses nunca pode ser escrito no código sem medir, e é a mesma armadilha do
vocabulário do STT. A sonda pergunta sob duas chaves (`PROBE_PROVEDOR`),
porque o Gateway pode resolver o id para outro provedor, e `PROBE_SO` roda uma
opção só, sem gastar o rate limit com a lista inteira. Enquanto a decisão for não
calar o raciocínio de modelo nenhum, a medição não precisa ser refeita a cada
troca de `EXTRACAO_MODEL`.

### 4.5 Concatenação

Cada `chunk_NNN.json` traz offsets relativos ao próprio início. O offset absoluto
é `relativo + 30 × i` (`DURACAO_CHUNK_S`). `concatenar()` ordena por `i`, soma os
offsets, junta o texto e registra o mapa `{ i, texto, offset_s }`.

Enquanto processa, a tela mostra só o **prefixo contíguo** dos blocos prontos
(`prefixoContiguo`): se o bloco 2 ainda está no STT, o 3 não aparece — texto
parcial nunca é lido fora de ordem.

**As duas funções servem à janela**: uma janela é `concatenar` sobre um
subconjunto de blocos, o que devolve uma `Transcricao` com offsets já absolutos
— nada na âncora nem no player precisa saber que ela é um pedaço. E `janelasDe`
fatia o mesmo prefixo contíguo pela mesma razão: com um buraco no meio, a janela
leria fala fora de ordem.

**A importação passa por aqui igual à gravação**: o arquivo importado é fatiado
em blocos de 30 s (§3.0), e `30 × i` continua sendo a conta. O preço são as
emendas — uma palavra pode ser cortada ao meio a cada 30 s (§14) —, e em troca a
importação tem a janela e o RAG por bloco.

### 4.6 Extração de átomos, janela a janela

**Dispara sozinha**, já durante a gravação: a cada quatro blocos transcritos,
`avancarJanelas` fecha uma janela de 2 minutos no mesmo `waitUntil` que
transcreveu o bloco. Ninguém aperta nada entre parar de falar e ter a proposta
(aceite 1 da slice 2), e o que falta quando eu paro é uma janela de no máximo
90 s de fala. Quem lê a proposta é a revisão (§4.7), e é o confirmar dela que a
leva ao grafo.

`extracao.ts` monta o prompt, valida a resposta item por item e carimba a
procedência. Sai pelo Gateway como o STT, por
`modeloExtracao()`. Devolve um `ResultadoDaJanela` — os átomos daquela fatia, já
ancorados e resolvidos. Cada átomo leva `id` determinístico
(`<sessao_id>-<índice>`, que é o que faz o `MERGE` do confirmar ser idempotente),
`prompt_version` e `modelo` (regra 7). Nada disso vai ao grafo (regra 5): o
acumulado vive em `parcial.json`, no R2.

#### A janela, e por que a extração não é a soma de oito extrações

Uma janela é uma corrida contígua de `JANELA_BLOCOS = 4` blocos **do prefixo
transcrito** — um buraco no meio segura a janela, pelo mesmo motivo que a
transcrição parcial só mostra o prefixo (§4.5). `concatenar` monta o texto dela,
com os offsets já absolutos, e é contra as palavras da própria janela que os
trechos são ancorados; o cursor de `offsets.ts` deixa de poder varrer a sessão
inteira atrás de um trecho, o que é ganho e não perda.

**4 blocos, e não 1.** O número é o meio-termo entre duas pressões opostas.
Menor, a janela corta frase no meio e multiplica a chamada de modelo, que é
justamente a rajada que o free tier recusa. Maior, sobra fala demais para a
janela do fim e a espera depois de parar volta a crescer. `JANELA_BLOCOS = 0`
desliga o caminho incremental — a sessão inteira sai num passe só. É o botão de
pânico: uma constante em `tipos.ts`, que pede deploy mas não refatoração.

**O prompt base não sabe que existe janela.** `INSTRUCOES_BASE` e `FORMATO`
descrevem a sessão; o que a janela acrescenta é um bloco injetado por
`inserirAntesDoFormato`: depois de tudo o que instrui, antes do envelope. Ele
carrega quatro coisas:

| O que | Por quê |
|---|---|
| "dos minutos 4 a 6", e que a fala continua depois | o modelo precisa saber que está lendo trecho, não sessão — senão ele conclui em cima de uma frase cortada |
| o orçamento, em proporção | a base pede 10 a 20 por 15 min; uma janela de 2 min pede de 1 a 3. Calculado (`orcamentoDaJanela`), não escrito à mão |
| a lista numerada do que já foi proposto | é o que o `ref` do `estende` endereça |
| a chave `estende` no JSON | a operação que impede a lista de virar trinta átomos |

Antes dele, no mesmo ponto, entra o dossiê das candidatas (§4.14). A ordem é
`INSTRUCOES_BASE → blocoDasCandidatas → blocoDaJanela → FORMATO → texto` — o
dossiê primeiro, porque é material; a janela depois, porque é sobre aquela
chamada e mais nenhuma.


**`blocoDaJanela` devolve string vazia quando a janela é a sessão inteira e o
acumulado está vazio.** Não é detalhe: é o que faz o arquivo importado e a
gravação de menos de dois minutos receberem o prompt sem bloco de janela, o
mesmo de um passe único.

#### `estende`: o que substitui a passada de costura

A janela devolve, além de `atomos`, uma lista `estende` de
`{ ref, texto, trechos }`: "o átomo 3 continua neste trecho; aqui está a
afirmação reescrita e o pedaço novo". `aplicarJanela` engorda o átomo referido —
texto novo, trechos somados — sem mexer no `id` nem na posição.

**Uma passada de costura no fim foi considerada e recusada.** Ela consertaria
volume e ROTINA duplicada depois do fato, ao custo de um oitavo agente, mais um
prompt para calibrar à mão para sempre, e ~10 s acrescentados exatamente à
espera que esta fatia existe para cortar. O `estende` faz o mesmo trabalho
**antes de o erro existir**, e o preço é o inverso: se o modelo ignorar a
instrução, a revisão abre com mais itens do que devia. Isso é coisa que eu vejo
na primeira sessão real, e conserto no prompt sem deploy (§4.13).

Duas coisas que o `estende` deliberadamente **não** faz:

- **não mexe em `sobre` nem em `menciona`.** É o que mantém a resolução
  estritamente incremental: átomo já atribuído não é reaberto a cada janela.
  Trocar o sujeito de um átomo é gesto meu, na revisão;
- **não apaga átomo.** `ref` fora da faixa vira `Descarte` com o motivo, nas
  duas pontas — no parser, contra a contagem que o prompt mostrou, e em
  `aplicarJanela`, contra a lista que está sendo gravada. É o único caminho por
  onde uma resposta de modelo escreveria sobre um átomo que já existe.

Item malformado não derruba a extração inteira: vai para `descartados` com o
motivo. Lista de descarte crescendo é sinal de prompt piorando — e é o único
sinal automático que existe, já que a qualidade é avaliada à mão na revisão.

O modelo da extração raciocina, e quando o raciocínio consome o orçamento
inteiro a resposta chega sem JSON nenhum, de forma intermitente: a mesma
transcrição às vezes passa. As defesas abaixo olham o `finishReason` da resposta
e a razão entre pensamento e texto, nunca o nome do modelo: num modelo que pensa
pouco elas simplesmente não disparam.

**São duas causas diferentes com consertos diferentes**, e o `finishReason` é o
que as separa:

| O que o diagnóstico mostra | O que aconteceu | Quem cuida |
|---|---|---|
| `finishReason=length`, `raciocinio` no teto | o raciocínio comeu o orçamento e a resposta foi cortada no meio dele | na extração, `faltouOrcamento()` → segunda tentativa com o dobro de teto. A resolução não repete: o teto dela (100 mil) já passa do `max_out` do modelo |
| `finishReason=stop`, saída sobrando, `pensamento` grande e `texto=0` | o modelo escreveu a resposta na parte de raciocínio, não na de texto | `textoDaResposta()` → lê o `reasoningText` |

A distinção não é acadêmica. Com `temperature: 0`, repetir a mesma chamada
depois de um `length` é **determinístico**: mesmo prompt, mesmo teto, mesmo
estouro. E no caso `stop`, repetir **mascararia** o problema acertando por
sorte, e ele voltaria na sessão seguinte.

As defesas de hoje, da que conserta para a que só conta o que houve:

| | |
|---|---|
| escalonamento do teto | cortado no pensamento, a segunda tentativa vai com `MAX_TOKENS_SAIDA * 2` em vez de repetir a mesma chamada. **É a defesa principal**, e custa uma chamada a mais nas janelas em que o modelo pensa muito |
| `fecharJsonTruncado(bruto)` | resposta cortada **depois** de começar a lista: corta no último átomo que fechou inteiro e fecha o array. Abaixo |
| `textoDaResposta(resposta)` | o JSON que foi parar no pensamento ainda é lido — **exceto** em `length`, onde o raciocínio está cortado no meio e `isolarJson` casaria um rascunho abandonado |
| a resposta crua no erro | os primeiros 400 caracteres vão na mensagem, e "resposta vazia" é dito com essas palavras |
| `diagnostico(resposta)` | `finishReason`, tokens de entrada/saída/raciocínio e o tamanho do texto e do pensamento, nas duas tentativas. Mora em `modelos.ts`: todo agente tem o mesmo modo de falha |

#### Truncou, e salva o que veio inteiro

Estourar o teto **no meio da lista** é pior que estourá-lo no pensamento: a
resposta traz átomos completos e um pela metade, `isolarJson` faz
`lastIndexOf("}")`, o `JSON.parse` estoura, e sem salvamento todos os
completos se perderiam — mais duas chamadas de modelo para chegar ao mesmo
lugar.

`fecharJsonTruncado` varre o texto com uma máquina de estados mínima —
dentro/fora de string, escape, profundidade de `{}` e `[]` — guardando o índice
logo depois de **cada elemento completo do array de átomos**, corta no último e
fecha o que ficou aberto. Sem nenhum elemento completo devolve `null`, e aí o
erro é o de sempre: inventar `[]` transformaria um acidente de teto numa lista
vazia legítima. O array é achado pela chave `"atomos"` e não pelo primeiro `[`,
porque o envelope pode trazer `"entidades"` antes.

**Separada de `isolarJson` de propósito.** Aquela responde "onde começa e termina
o JSON nesta resposta", e para um texto cortado a resposta dela está certa — o
problema é que não há fim. Misturar as duas perguntas faria `isolarJson` mentir
sobre resposta íntegra. Ela só é chamada no `catch` do `JSON.parse`: resposta
inteira nunca passa por ali.

Quando a resposta trunca:

- a **segunda** tentativa que trunca não mata a janela: usa o que foi salvo;
- a **primeira** que trunca dispara a segunda — o que veio pode estar faltando o
  fim da lista —, e fica **a melhor das duas pelo número de átomos**
  (`melhorLeitura`), no empate a íntegra;
- log próprio: `[extracao] sessão <id>: resposta cortada, N átomo(s)
  recuperado(s)`;
- `truncada` sobe da leitura ao `EstadoJanela`, dele ao `montarExtracao` — uma
  janela cortada basta — e da `Extracao` à revisão, que **avisa**. Eu julgo a
  lista à mão, e sem o aviso uma lista curta parece decisão do modelo em vez de
  acidente de teto.


**O teto é de 16.000 tokens (`MAX_TOKENS_SAIDA`), e a segunda tentativa vai com
32.000** (`FATOR_DE_FOLGA` 2) quando `finishReason` for `length`. Subir o teto
sozinho não resolve — o modelo ocupa o que houver, e o escalonamento é o que
resolve. O que justifica um piso alto é outra coisa: quando uma chamada estoura,
a **janela inteira** é refeita do zero (extração, resolução e desempate), não só
a chamada.

**Pedir ao modelo para pensar menos também não está na lista, e também é de
propósito** — ainda que se saiba exatamente como, e a medição esteja no §4.4. O
raciocínio é o que esta tarefa tem de mais útil; cortá-lo trocaria um estouro
raro, que já tem defesa, por uma perda de qualidade constante e sem teste que a
pegue. A troca escolhida é a outra: uma chamada a mais quando estoura.

As duas últimas defesas são as mais antigas e as que mais importam — sem a
resposta crua, "não é JSON válido" é indiagnosticável depois do fato, a mesma
lição que o STT já tinha ensinado uma vez (5.1).

O prompt proíbe **comentar a transcrição**: falar desorganizado é o esperado
num diário falado, e lista vazia é a resposta certa quando não há o que
extrair.

#### O que o prompt manda fazer (`extracao-9`)

O prompt **manda selecionar**, não picar: uma afirmação por item renderia ~150
átomos numa sessão de 15 min — duas condições de morte de `Specs/visao.md` §8
de uma vez: revisão que passa de um minuto, e rotina repetida todo dia
apodrecendo o grafo.

| Critério | Regra |
|---|---|
| Volume | 10 a 20 átomos numa sessão de 15 min; preferir o átomo maior ao recorte |
| O que entra | carga, conclusão, consequência, decisão, interação |
| Trivialidade | colapsa num único átomo `ROTINA` por sessão |
| Episódio | o que eu contei com detalhe vira **um** átomo `HISTORIA`, e ali o texto pode ser longo (007) |
| `texto` | frase limpa, com as palavras de quem falou — tira muleta, resolve pronome, não parafraseia nem interpreta |
| `trechos` | literais, 1..n, copiados da transcrição |
| Junção | o mesmo assunto dito em dois momentos é **um** átomo |
| `sobre` | `SENTIMENTO`, `APRENDIZADO`, `HISTORIA`, `ROTINA` → "eu"; `FATO`, `OPINIAO`, `CONQUISTA`, `DECISAO` → o assunto |
| Entidades | tipo proposto entre `PESSOA`, `ORGANIZACAO`, `PROJETO` e `OBJETIVO` (007) |

`"eu"` é uma `:Pessoa` como qualquer outra — decisão tomada, não acidente.

**`HISTORIA` é a única exceção à disciplina de volume, e ela precisa estar
escrita** (007). Todo o resto do prompt manda destilar — "prefira sempre o
átomo maior e mais organizado", "se você está produzindo um átomo por frase,
está errado" —, e sob essa regra uma noite inteira contada em detalhe vira uma
linha verdadeira que não devolve nada. A seção `A HISTÓRIA GUARDA O DETALHE`
autoriza o contrário: aqui não se resume, os detalhes ficam na ordem em que
foram contados, e `COM AS MINHAS PALAVRAS` continua valendo — guardar o detalhe
não é bordar em cima dele. Ela também demarca as duas fronteiras por onde o tipo
seria absorvido: o dia comum é `ROTINA`, e o fato solto sem episódio em volta é
`FATO`.

O sujeito da `HISTORIA` é `eu` como o dos outros três: **eu** vivi a história, e
quem a viveu comigo vai em `menciona` — que é, de propósito, onde a marca de
perfil `fizemos_juntos` cai (§8.3).

**Os offsets não saem do modelo.** `offsets.ts` casa cada `trecho` que o modelo
devolveu contra as `palavras[]` da transcrição e registra como conseguiu:

| Âncora | O que significa |
|---|---|
| `exata` | os tokens do trecho aparecem em sequência na transcrição |
| `aproximada` | uma janela do mesmo tamanho tem ao menos 60% deles — o modelo reescreveu de leve |
| `nenhuma` | o trecho não está lá; o átomo fica **sem** `inicio_s`/`fim_s` |

A comparação é por token normalizado (minúsculas, sem acento, sem pontuação),
com um cursor que avança a cada acerto. Sem o cursor, "eu acho que" casaria
sempre com a primeira ocorrência e a sessão inteira apontaria para o mesmo
segundo do áudio.

**Um átomo tem 1..n âncoras** (migration 003), porque ele junta o mesmo assunto
dito em momentos distintos e porque o átomo de `ROTINA` colapsa o dia. Com uma
âncora só, ele afirmaria mais do que dá para escutar — e "todo item aponta para
o segundo exato" é necessidade declarada na visão §4. Só o **primeiro** trecho de
cada átomo empurra o cursor (`localizar.semAvancar` cuida dos demais): deixar o
segundo trecho mover o cursor jogaria a busca do próximo átomo para o fim da
transcrição.

`ancora: "nenhuma"` é deliberado e **diverge do critério 3 da spec**, que pede
offset em todo átomo. Trecho que não existe na transcrição é quase sempre
afirmação que o modelo inventou, e dar a ela um offset plausível seria a mesma
procedência falsa que a regra dos timestamps existe para impedir. A revisão
mostra o átomo sem player, e ele é o primeiro a ser olhado com desconfiança.

Na granularidade `segmento` (4.3) o offset é o da frase inteira: o casamento
devolve a entrada de `palavras[]` de onde o token veio, com a precisão que o
provedor deu — nem mais, nem menos.

#### Resolução de entidade — o que este passo faz, e o que não faz

O extrator devolve, por menção, **o que a transcrição escreveu e o nó que ele
reconheceu**: `{"citado":"Jean","chave":"giampaolo lepore"}`. A chave é `null`
quando ele não reconhece nenhuma das candidatas do dossiê, e é sempre `null`
quando não há dossiê — aí ele devolve o nome cru como sempre devolveu, e
`parsearResposta` lê as duas formas.

O extrator conhece o grafo pelo dossiê (§4.14) porque o problema da grafia
**é** dele: quem escreve o texto do átomo é ele, e é no texto que o nome errado
se fixa — inclusive dentro do vetor, que sai só de `a.texto` (§4.10). O dossiê
entra por um bloco injetado, e não pela base do prompt.

Quem confronta com o grafo é o passo seguinte (4.8), que atribui **cada
menção** a um nó — não cada nome. A diferença é a slice 4 inteira: dois átomos
da mesma sessão dizendo "Rafa" podem ser duas pessoas. Ele vê também a chave que
o extrator apontou, como quinta camada de candidato, e valida **toda** menção
que tenha candidato.

`entidades.ts` tem as duas pontas disso:

| Função | Faz |
|---|---|
| `listarEntidades` | o catálogo: tudo que está no grafo, com tipo, sessões, grafias, `resumo`, `canonico` e os três campos de perfil. Uma consulta só, e é o mesmo objeto que a tela `/entidades` mostra |
| `acharPorChave` | casamento exato que **atravessa alias** de graça: `chaves` traz a grafia própria, as de `e.aliases` e as dos nós fundidos |
| `apresentarEntidade` | como a entidade aparece num prompt — **uma só, para os dois agentes** (§4.8) |
| `agregarCandidatas` | a visão agregada da revisão: uma linha por entidade, com quantas menções caíram nela |

**Só entidade recorrente deve virar nó, e quem filtra é quem revisa.** A
proposta traz "conhecida (3 sessões)" contra "nova, citada 1x"; desmarcada na
revisão, a entidade fica apenas dentro do texto do átomo. Não há regra
automática de recorrência: ela exigiria guardar candidata fora do grafo, e o
julgamento na revisão custa um toque.

Quando a entidade já existe, **o grafo vence**: a grafia gravada e o tipo dos
labels do nó. O extrator propor `:Pessoa` para o que já é `:Projeto` não muda
nada — trocar o tipo de uma entidade existente é edição em `/entidades` (8.2),
não efeito colateral de uma extração.

O tipo é proposto pelo extrator numa lista `entidades` à parte, entre os quatro
de `TIPOS_ENTIDADE` (`:Pessoa`, `:Projeto`, `:Objetivo` e `:Organizacao`),
e cai em `:Pessoa` quando falta ou vem inválido — num diário
falado, quase sempre acerta. **`:Organizacao` existe porque esse padrão mentia
com frequência**: empresa, ONG, startup e cliente ou nasciam `:Pessoa`, por ser
o padrão, ou `:Projeto`, quando o extrator via trabalho acontecendo — e o que
corre dentro da empresa é que é o projeto. O label é ASCII (`Organizacao`, sem
cedilha) porque vai literal na consulta que grava; como ele é escrito na tela e
nos dois prompts mora em `ROTULO_TIPO_ENTIDADE` (`tipos.ts`).
A contagem de ocorrências sai das referências resolvidas, não dessa lista:
entidade que o modelo listou e nenhuma referência aponta não entra, seria nó
órfão.

**`"eu"` é uma `:Pessoa` como qualquer outra** — decisão tomada, não acidente.
Um átomo sobre quem fala aponta `sobre: "eu"`, e o confirmar cria o nó.

E é **só leitura**: quem cria nó é o confirmar, depois da revisão (regra 5). A
trava contra duplicata em corrida não é este código — é a constraint de
`nome_normalizado` único (8.1), que vale entre todas as entidades.

A normalização é a mesma que o casamento de offsets usa, e por isso mora sozinha
em `texto.ts`. Se as duas divergissem, um nome acharia o áudio certo e ainda
assim criaria um segundo nó no grafo.

#### Pronome não vira nó

Uma sessão inteira sobre alguém que eu nunca nomeio em voz alta não tem contexto
para o modelo resolver — foi o que aconteceu na primeira sessão longa, que
rendeu uma `:Pessoa` chamada **"ela"** com 10 ocorrências. O sistema precisa
saber **pedir**.

A detecção é uma lista fechada em `texto.ts` (`ehPronome`): "ela", "ele", "a
gente", "esse cara", "alguém"… **`eu` fica de fora de propósito** — é entidade
legítima por decisão. Candidata nova cujo nome cai na lista recebe
`precisa_nome`, e a revisão trava o confirmar até eu dar um nome. Entidade que
já está no grafo nunca pede: ela passou por uma revisão minha, e se o nome dela
é o que é, foi porque eu deixei.

A lista mora em `texto.ts` e não em `entidades.ts` porque os dois lados precisam
dela com a mesma regra: a revisão, no navegador, para saber quando ainda falta
nomear; o confirmar, no servidor, para recusar o que passar mesmo assim. Duas
listas divergiriam e a trava valeria só na tela.

O prompt também tenta: manda procurar o nome na transcrição inteira antes de
desistir, e proíbe inventar nome ou apelido. Mas o prompt é tentativa, não
garantia — a trava é o código.

**Pronome trava; dúvida de identidade não** (4.8). São coisas diferentes: um nó
chamado "ela" é grafo apodrecido garantido, enquanto uma atribuição trocada é um
erro que eu conserto depois. Travar a cada dúvida mataria os 60 s da revisão numa
sessão que fale muito de duas pessoas de nome parecido.

### 4.7 Revisão e confirmação

A tela mais difícil de acertar, pela própria visão (§6): tem de mostrar muita
coisa e ser resolvível em menos de um minuto. O desenho segue disso — **abre com
tudo aprovado**. Desmarcar é um toque, corrigir o texto também: tocar no
parágrafo do átomo o transforma em campo, no próprio lugar. Tipo, sujeito e
menções continuam atrás do botão **editar**.

O player é o que torna a revisão confiável: escuto antes de aprovar. Cada âncora
do átomo vira um botão `▶ mm:ss`; átomo sem âncora nenhuma mostra "sem áudio" em
destaque, porque trecho que não existe na transcrição costuma ser afirmação
inventada. `localizarNoAudio` traduz o segundo absoluto em "bloco N, segundo M"
pegando o último bloco que começa antes dele — funciona igual para gravação (um
bloco a cada 30 s) e para importação (um bloco só), sem caso especial.

**O painel de entidades é onde se corrige de uma vez.** Entidade nova tem nome e
tipo editáveis; renomear "ela" para "Marina" uma vez faz todos os átomos que
apontam para ela passarem a apontar para o nome novo. Escolher na barra uma
entidade que **já existe** re-aponta a candidata inteira para ela, e o tipo passa
a ser o do nó: o grafo vence, aqui como na resolução (4.8). Entidade
**conhecida** não tem barra de nome — renomear nó que já existe é trabalho de
`/entidades`, e re-apontar um átomo que caiu no nó errado se faz pelo `sobre`
dele, dentro do átomo.

Entidade com `precisa_nome` vai para o topo, destacada, e **o confirmar fica
desabilitado** enquanto sobrar pronome. Desmarcar deixa a entidade só no texto do
átomo. **Entidade que é sujeito de um átomo aprovado fica travada**: sem ela o
átomo ficaria sem `:SOBRE`, o que o contrato do schema não admite.

O editor de um átomo abre por um botão **editar** — que num átomo em dúvida
(4.8) se chama **escolher**. Menção igual ao sujeito não é exibida nem enviada.

**O texto do átomo edita no lugar.** Ele é o campo que eu mais mexo — o
extrator escreve com as minhas palavras, mas erra pontuação e uma palavra aqui e
ali. O `<p>` vira `<textarea>` no clique (ou no Enter, porque ele é
`role="button"` com `tabIndex`), com a mesma margem, fonte e entrelinha do
parágrafo, altura seguindo o conteúdo (`scrollHeight` no `ref` e a cada tecla,
`resize: none`), e fecha no `blur`; o `cursor: text` do CSS sinaliza o
clique. O editor de baixo fica com o que **não** é texto corrido: tipo, sujeito,
menções e trechos.

**A entidade se corrige em dois lugares, e a diferença entre eles é o alcance.**
Dentro do átomo, no bloco "entidades" do editor, eu troco o sujeito e as menções
**daquele** átomo. No painel do rodapé eu troco o nome de uma candidata e
**todos** os átomos que a citam seguem junto — a tradução acontece em
`nomeFinal()`, na hora de montar o payload, e nenhuma edição de átomo é
gravada — o nome dentro do texto segue junto, derivado (ver abaixo). Os dois
usam a mesma barra: `SeletorEntidade`.

**A barra é uma lista pesquisável sobre o grafo inteiro.** Foco abre a lista;
apagar tudo mostra o grafo todo, mais falado primeiro; digitar filtra por
**trecho** — "nan" acha "Fernanda". Cada linha traz tipo e número de sessões, e
quando o casamento veio de um apelido ele aparece entre parênteses, senão a linha
apareceria sem motivo visível. As alternativas do agente de resolução vêm
primeiro. O filtro de tipo vale para todas as barras daquele átomo.

O combobox é escrito à mão, com os tokens de `globals.css`, e nenhuma
dependência entrou. Um `<input list>` com `<datalist>` não basta: casa só
prefixo em vários navegadores, não mostra tipo nem apelido, não atravessa alias,
e no celular — que é onde este app vive — degrada para uma tirinha de sugestão.

**O campo continua aceitando nome que não existe.** A lista é ajuda, não trava. O
que decide entre reusar um nó e criar outro é o **casamento exato** de
`catalogo.resolver` na montagem do payload: casou (por caixa, por acento ou por
alias), vai a grafia canônica do grafo e o tipo do nó; não casou, nasce entidade
nova com o que eu escrevi.

**A linha `+ criar "X"` cria — na tela, não no grafo.** Escolhê-la (clique ou
Enter) chama `aoCriar` do `SeletorEntidade`, e a `Revisao` guarda a entidade em
`criadas`, com o tipo do filtro daquele átomo (`Pessoa` em "todas"). Ela conta
como candidata para `finalDe`, `nomeFinal`, `usada` e o rodapé — onde aparece
como "nova, criada aqui" enquanto algum átomo a usa —, e o nó só nasce no
confirmar, como qualquer candidata nova: a regra 5 não tem exceção para isto.
Digitar e sair sem escolher a linha é texto livre.

As barras dos átomos leem `catalogoDaTela`: o grafo, e depois as entradas locais
(`entradasLocais`) — as candidatas novas da proposta e as criadas, **com o nome
final**, sem a que já casa com um nó e sem pronome. O confirmar continua
canonizando contra o catálogo do grafo puro. A barra mostra `nomeFinal` e guarda
o nome **original** (`nomeOriginalEm`): é isso que faz o renome seguinte no
rodapé continuar seguindo o átomo, já que `nomeFinal` traduz pela chave
original. `montarGestos` recebe só as candidatas da proposta: renomear ou
recusar uma entidade que eu criei não é correção de agente nenhum.

**O nome dentro do texto acompanha a entidade.** O `extracao-9` escreve o nome
gravado do nó dentro do texto (§4.14); se a resolução pendurou "a Nic" na
Nicolle Borsato, o texto diz "Nicolle Borsato", e corrigir a aresta deixava o
texto dizendo a pessoa errada. `reescreverNomes` (`texto.ts`) troca o nome
**antigo da entidade** pelo novo — sem caixa nem acento, palavra inteira —, nos
dois alcances: a troca dentro do átomo e o renome no rodapé. Só par
inequívoco: o sujeito, e nas menções apenas quando saiu exatamente uma e entrou
exatamente uma. A grafia falada ("Nic") não é tocada, nem `eu` ou pronome, e
nome que não aparece inteiro no texto (só "Nicolle") deixa o texto como está.
O texto reescrito é **derivado** (`textoDe`), não gravado em `edicoes`: é o que
a tela mostra, o que o campo edita e o que o corpo manda, e a troca não vira o
gesto "texto". Limite: depois de uma edição à mão, uma troca seguinte só
substitui o nome da proposta — um nome intermediário que já estava no texto
editado fica.

O catálogo vem de `GET /api/entidades`. Se ela falhar, as barras viram texto
livre; `tests/revisao.test.ts` fixa isso.

**O perfil não vem nesse payload** (4.8.1). A revisão baixa o grafo inteiro a
cada abertura (§14) e usa nome, chaves e tipo; os três campos de perfil são o
campo mais pesado da resposta e ninguém os lê ali. Quem quer os campos pede
`?perfil=1`, que é o que `/entidades` faz — a tela que os edita. `resumo` e
`canonico` (009) seguem o perfil, e pela mesma razão. O corte é campo
a campo e não `delete`, para que campo novo em `EntidadeDoGrafo` não vaze para o
contrato do catálogo sem alguém decidir.

**As menções são editáveis** — acrescentar e tirar, uma barra por menção:
menção errada se conserta sem rejeitar o átomo inteiro nem renomear a entidade
no rodapé. A lista viaja inteira nas edições do átomo, e não como delta: sem
isso não dá para distinguir "não mexi" de "apaguei todas".

**Átomo com atribuição incerta aparece marcado**, com a sugestão já preenchida no
seletor. O confirmar **não** trava: ver 4.8.

**A dúvida é de cada referência, e não só do sujeito.** O agente 2 decide por
menção (4.8) e devolve `certo`, `motivo`, `alternativas` e `porque` em cada
uma; a marca do átomo, o bloco de dúvida e a barra de cada menção olham a lista
de referências incertas: `referenciasDoAtomo` devolve o sujeito e as menções na
ordem da tela, e `incertasDoAtomo` filtra. As duas são funções puras exportadas
da `Revisao`, pelo mesmo motivo que `montarCorpoDoConfirmar`: é lógica que
quebra em silêncio, e `tests/revisao.test.ts` a fixa sem render.

O formato é **um** parágrafo por átomo, com uma linha por referência incerta, e
não um bloco por referência: esta é a tela mais apertada do sistema.

**A linha da dúvida é uma pergunta, e só isso**: `acho que é **X** —
confirma?` (e `menção 2: acho que é X — confirma?` para as menções, por
`ondeEstaA`). `citado`, `motivo` e `alternativas` continuam no dado e no
payload: as alternativas estão no topo da lista do seletor, que é onde elas
servem para alguma coisa, e o motivo é procedência, que mora no modal de fontes,
abaixo. A tela pergunta; quem quiser o porquê, pede.

#### As fontes moram atrás de um ícone, e não na vista padrão

A procedência do GraphRAG — a frase da camada (`FRASE_DA_CAMADA`) e os trechos
de átomos passados que votaram — fica fora da vista padrão: numa proposta de
nove átomos, com o dossiê resolvendo quase toda menção, ela seria a maior parte
do que a tela mostra, e nada disso é decisão: é explicação de uma decisão que
quase sempre está certa.

Ela é um **modal**. Cada nome na linha "sobre X · menciona Y" ganha um `ⓘ` ao
lado — `EntidadeRef` —, e só ganha quando aquela referência tem evidência
(`herdadasDoAtomo`, isto é, `porque` ou `camada`); as demais ficam só o nome,
sem ícone e sem espaço gasto. Clicar abre um diálogo centralizado com o nome da
entidade, a frase da camada e as citações. Diálogo e não gaveta lateral porque o
conteúdo é curto e é sobre **um** ponto da tela; `Escape` e o véu fecham, como
na gaveta de agentes (4.13).

**A trava de índice das menções vale para o ícone também**, e é por isso que
`mencoesEntradas` carrega o `ordem` original: filtrar a menção igual ao sujeito
desloca a posição na tela, e `herdadas` casa por índice pré-filtro. Ícone na
entidade errada é a mesma classe de erro que sugestão na linha errada — só que
mais silenciosa, porque o modal parece ter respondido.

**A condição da camada 3b é satisfeita a um toque.** O §4.10 declara que aquela
camada só é aceitável porque o átomo que a elegeu está na tela, corrigível. Ele
está — a um toque, e marcado com um ícone que só aparece quando há o que ver:
"sempre alcançável" no lugar de "sempre à vista". Uma tela que mostra tudo o
tempo todo não se resolve em 60 s, e o custo declarado é meu se eu deixar de
clicar.

**A armadilha do índice, e ela é silenciosa.** As menções na tela são uma lista
por posição, e a referência casa com a posição **por índice**. Assim que eu
acrescento ou removo uma menção daquele átomo, o índice desloca e a sugestão
apareceria na linha errada — dizendo "escolhi Raffa" ao lado de outro nome. A
trava é a edição: enquanto `edicoes[indice].menciona` for `undefined` a lista é a
da proposta e o índice vale; a partir da primeira edição as menções saem da
conta e sobra a dúvida do **sujeito**, que é um valor só e não desloca. Perder a
sugestão é o preço, e é o certo — sugestão na linha errada é pior que sugestão
nenhuma. Está no teste, e não só no comentário.

**As marcas de perfil aparecem, e não são editáveis.** Quando o agente 2 aponta
que um átomo diz algo do perfil de alguém, a linha "vai para o perfil: Raffa ·
fizemos juntos" fica visível no item — desmarcar o átomo, ou desmarcar a
entidade, é o que tira a marca. Elas viajam no corpo do confirmar com o nome
**final**, como `sobre` e `menciona`, porque são conteúdo e a revisão pode ter
renomeado a entidade. O servidor recusa campo fora do schema e entidade fora da
lista aprovada.

#### O que o cliente pode mandar, e o que não pode

`POST /api/sessoes/:id/confirmar` recebe quais átomos foram aprovados e como
foram editados — texto, tipo, sujeito, menções. O corpo é montado por
`montarCorpoDoConfirmar`, função pura exportada da `Revisao` porque é a lógica
que quebra em silêncio: entidade citada que não entrar em `entidades` é
descartada pelo servidor **sem uma palavra**, e o erro só aparece no grafo dias
depois. Toda menção que eu acrescentei entra na lista junto; toda entidade que eu
desmarquei no rodapé sai dela, e sai também das menções — o alcance do checkbox é
o nó, não só o sujeito. **Procedência não vem no corpo.**
`id`, offsets, âncoras, `prompt_version` e `modelo` são relidos de
`extracao.json` pelo índice do átomo. Se viessem do navegador, seriam uma
afirmação dele, e átomo com procedência falsa é pior que átomo nenhum.

Entidade só é gravada se algum átomo aprovado de fato a usa: aprovar na tela e
depois rejeitar todos os átomos dela não pode deixar nó órfão.

**A lista de entidades vem da tela, não da proposta**: o corpo manda
`entidades: [{ nome, tipo }]` com os nomes finais, e o cliente acrescenta
qualquer sujeito que eu tenha escrito à mão — sem isso, renomear o sujeito de um
átomo seria recusado. Duas guardas no servidor, porque a regra não pode depender
da UI: nome que caia na lista de pronomes é recusado com 400, e `tipo` é
validado contra `TIPOS_ENTIDADE`.

