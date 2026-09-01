# Arquitetura

Como o Phronesis está construído hoje. Descreve o **sistema que existe**, não o
que está planejado — para o produto ver `Specs/visao.md`, para as regras
invioláveis `CLAUDE.md`, para o escopo da fatia atual `Specs/slice-4.md`.

> **Este arquivo acompanha o código.** Toda mudança que altere fluxo, contrato,
> layout de dado, dependência externa ou fronteira de segurança atualiza este
> arquivo no mesmo commit. Ver "Manutenção deste arquivo" no fim.

**Estado: slice 2 fechada e validada; slices 3 (higiene do grafo) e 4
(identidade por contexto) construídas.**
Gravar (ou importar), subir, transcrever, extrair, revisar, confirmar. Terminada
a transcrição, a extração dispara sozinha, grava a proposta em `extracao.json` e
deixa a sessão em `em_revisao` (seções 4.6 e 5); o confirmar da revisão grava
`:Atomo` e `:Entidade` no Neo4j (seções 4.7 e 8). Sessões reais já foram
confirmadas e os átomos conferidos no banco, com âncoras, `prompt_version` e
`modelo`.

**O grafo agora cuida do próprio nome** (seção 8.2). O vocabulário do STT é
gerado das entidades do grafo, em união com `config/vocabulario.txt`; e
`/entidades` é onde eu vejo o que entrou e conserto o que entrou torto —
fundindo duas grafias da mesma coisa, ou dando nome a quem ficou como "meu pai".
**Fundir não apaga: cria alias**, e é isso que faz a grafia morta resolver para
o vencedor na sessão seguinte em vez de renascer como nó novo.

**O sistema descobre de quem eu estou falando pelo contexto, e não pela grafia
do nome** (seções 4.8 e 8.3). "Raffa" e "Rapha" são o mesmo som: o STT escreve
uma grafia só para os dois, e a grafia carrega **zero** sinal sobre quem é. Por
isso são **dois agentes e não um** — o `extracao-5` extrai e devolve o nome cru,
e o `resolucao-1` atribui cada menção a um nó, lendo os três campos de perfil da
entidade. Dúvida **destaca, não trava**: a revisão marca o átomo, mostra o motivo
e o confirmar continua liberado. Sessão em que nenhuma menção é ambígua não
chama o agente 2 e não paga nada.

**A jornada não passa pela transcrição.** Parar de falar leva à tela de
processamento, e dela a revisão abre sozinha quando a proposta fica pronta. O
texto literal é porta de serviço: mora em `/sessao/:id/transcricao` e se alcança
pelo botão "transcrição" na lista de sessões (seção 11). Ler quinze minutos de
transcrição no meio do caminho é o atrito que mata o ritual — a transcrição é
insumo do extrator, não coisa que eu leio todo dia.

O que ainda não existe: busca, tela Perguntar, `:Foco`, as 2-4 perguntas do
ritual, as relações entre átomos (`:ATUALIZA`, `:CONTRADIZ`, `:CONFIRMA`) e a
deduplicação de **átomo** — dizer a mesma coisa em duas sessões ainda cria dois.
Tudo slice 5, e tudo dependente de material acumulado: uma pergunta boa precisa
saber de quem se está falando, que é o que a slice 4 entrega.

---

## 1. Topologia

```
┌─ navegador ─────────────┐   ┌─ Vercel ────────────┐   ┌─ serviços ───────────┐
│ MediaRecorder           │   │ middleware (auth)   │   │ Cloudflare R2        │
│ IndexedDB (blocos)      │   │ App Router /api/*   │   │  áudio + JSON        │
│ fila de upload          │   │ waitUntil (STT)     │   │ Neo4j Aura (HTTP)    │
│ React (5 telas)         │   │                     │   │  :Sessao + conteúdo  │
└──────────┬──────────────┘   └──────────┬──────────┘   │ Vercel AI Gateway    │
           │                             │              │  → modelo de STT     │
           │  PUT presigned (áudio)      │              └──────────────────────┘
           └─────────────────────────────┴──────────────▶ R2
```

Três planos de dado, cada um com uma responsabilidade única:

| Onde | O que guarda | Por quê |
|---|---|---|
| IndexedDB (navegador) | bloco de áudio até o PUT confirmar | fechar a aba no meio da gravação não pode perder fala |
| Cloudflare R2 | áudio, manifest, transcrição de bloco, transcrição final | blob e texto grande não pertencem ao grafo |
| Neo4j Aura | `:Sessao` com estado e **chaves** do R2; `:Atomo` e `:Entidade` a partir do confirmar | o grafo é para relação e afirmação, não para blob nem para texto corrido |

O áudio **nunca** atravessa uma function da Vercel (regra inviolável 1): o
navegador pede uma URL presigned e faz `PUT` direto no bucket.

## 2. Mapa dos módulos

```
src/lib/          servidor — exceto os módulos puros marcados (client), que não
                  leem credencial nem rede e por isso o navegador pode importar
  env.ts          leitura de variável de ambiente, falha cedo se faltar
  neo4j.ts        HTTP Query API (nunca driver Bolt)
  fusao.ts        fundir, renomear, recusar — a escrita de higiene no grafo
  duplicatas.ts   quem parece ser a mesma coisa: string + o modelo, só propõem
  sessoes.ts      repositório de :Sessao (criar, buscar, atualizar com guarda)
  r2.ts           S3 SigV4 via aws4fetch: get/put/head, presign, PUT condicional
  chaves.ts       layout do R2 num lugar só + validação de id (barra path traversal)
  manifest.ts     verdade sobre quais blocos existem; read-modify-write por etag
  estados.ts      máquina de estados da sessão e regra de abandono
  modelos.ts      porta única de modelo: todo LLM sai pelo Vercel AI Gateway,
                  e o diagnóstico de resposta vazia que os três agentes usam
  stt.ts          transcrição — pede o modelo a modelos.ts
  vocabulario.ts  nomes próprios → keyterms do STT
  transcricao.ts  offsets absolutos, prefixo contíguo, concatenação
  texto.ts        normalização, nome_normalizado e lista de pronomes       (client)
  extracao.ts     átomos a partir da transcrição: prompt, JSON estrito, procedência
  offsets.ts      trecho do modelo → segundo do áudio (modelo não dá timestamp)
  resolucao.ts    agente 2: de quem eu estava falando — atribui menção a menção
  perfil.ts       os três campos de perfil: ler, gravar, e o agente 3 que rascunha
  entidades.ts    catálogo do grafo + a visão agregada da revisão — só leitura
  referencias.ts  lê os dois formatos de proposta (antes e depois da 4)  (client)
  catalogo.ts     busca de entidade no navegador: trecho, acento, alias (client)
  tipografia.ts   qual tela é ritual e qual é gestão — a regra da fonte  (client)
  atomos.ts       escreve :Atomo, :Entidade e :PERFILA — só o confirmar chama
  pipeline.ts     transcrever bloco / finalizar sessão (o orquestrador)
  auth.ts         magic link HMAC, cookie httpOnly
  backoff.ts      backoff exponencial com jitter                          (client)
  audio.ts        formatos aceitos na importação, limites de arquivo       (client)
  onda.ts         a matemática da onda do botão de gravar — nível, envelope (client)
  rotas.ts        validação de parâmetro compartilhada pelas rotas
  tipos.ts        contratos do domínio + constantes (DURACAO_CHUNK_S = 30)

src/client/       navegador
  gravador.ts     MediaRecorder recriado a cada 30 s sobre um stream fixo;
                  expõe `faixa` (o MediaStream) para a onda do botão ouvir
  deposito.ts     IndexedDB: blocos pendentes + sessão em andamento
  fila.ts         upload serial com retry, observável pela UI

src/components/   Marca (o canto superior esquerdo — volta ao início),
                  Gravacao (a tela de gravar), BotaoGravar (o círculo, o halo,
                  as ondas laterais e o selo de REC), Gestao (a engrenagem e a
                  gaveta), Importacao (subir arquivo — item da gaveta),
                  Tipografia (a classe da fonte, conforme a rota),
                  Processando (fechar a sessão e esperar; leva à revisão),
                  Revisao (aprovar, editar, escutar, confirmar),
                  SeletorEntidade (a barra pesquisável de entidade, nos dois
                    lugares da revisão),
                  Leitura (a transcrição literal — porta de serviço),
                  Sessoes (lista de sessões — e a cor que diz o que falta
                    revisar), Entidades (higiene do grafo)
src/app/api/      as rotas de sessão e de entidade + 2 de auth (seção 10)
src/middleware.ts porta única: sem cookie válido nada responde
db/migrations/    definição canônica do schema
scripts/          migrate.ts (aplica migrations), smoke.ts (confere externos)
tests/            vitest sobre a lógica pura — nenhuma credencial, nenhuma rede
```

## 3. O caminho do áudio

```
navegador                             Vercel                       R2 / Gateway
─────────                             ──────                       ────────────
POST /api/sessoes ──────────────────▶ CREATE (:Sessao{gravando}) ─▶ Neo4j
getUserMedia (uma vez, nunca tocado)
loop a cada 30 s:
  stop() + new MediaRecorder(stream)
  blob ──▶ IndexedDB                  (persiste ANTES de qualquer rede)
  POST /chunks/:i/url ──────────────▶ presigned PUT, 5 min
  PUT ────────────────────────────────────────────────────────────▶ chunk_NNN.webm
  POST /chunks/:i/pronto ───────────▶ HEAD confere bytes
                                      manifest += bloco
                                      waitUntil(transcrever) ─────▶ STT
                                                                    chunk_NNN.json
  apaga do IndexedDB                  (só depois do PUT confirmado)
parar ──▶ /sessao/:id            (Processando: não mostra a transcrição)
  espera a fila esvaziar
  POST /finalizar ──────────────────▶ status = finalizando, responde na hora
                                      waitUntil: espera pendentes,
                                      concatena offsets ──────────▶ transcricao.json
                                      status = transcrito
                                      waitUntil: extrai ──────────▶ extracao.json
                                      status = em_revisao
  GET /api/sessoes/:id a cada 2 s ──▶ acompanha o status
  em_revisao ──▶ /sessao/:id/revisar   (replace: o corredor não volta)
```

### 3.0 O caminho curto: arquivo importado

Nota de voz do WhatsApp, gravador do celular, áudio antigo no disco. **Um
arquivo é uma sessão inteira, num bloco só (`i = 0`).**

```
navegador                             Vercel                       R2 / Gateway
─────────                             ──────                       ────────────
<input type=file>
  formatoDeArquivo(nome, mime)        (audio.ts — recusa antes de qualquer rede)
  duração pelo <audio>                (NaN em container sem cabeçalho: passa)
POST /api/sessoes ──────────────────▶ CREATE (:Sessao{gravando}) ─▶ Neo4j
POST /chunks/0/url  {ext} ──────────▶ presigned PUT, 5 min
PUT ──────────────────────────────────────────────────────────────▶ chunk_000.opus
POST /chunks/0/pronto {ext,duracao} ▶ HEAD, manifest += bloco com ext
                                      waitUntil(transcrever) ─────▶ STT
sessionStorage duracao:<id>
▶ /sessao/:id   (daqui em diante é o mesmo caminho da gravação: `Processando`
                 chama /finalizar com a duração, faz o polling de 2 s e abre a
                 revisão sozinho)
```

**Por que um bloco só.** `offsetDoBloco(0)` é zero, então os timestamps que o STT
devolve para o arquivo já são absolutos e a concatenação da seção 4.5 continua
correta sem nenhum caso especial. Fatiar exigiria decodificar e reencodar Opus no
navegador, e de quebra reintroduziria as emendas de 30 s que a gravação ao vivo
tem e o arquivo importado não.

**Sem IndexedDB.** A fila local (3.2) existe para não perder fala quando a aba
fecha no meio da gravação. Um arquivo importado já está no disco de quem o
escolheu: se o PUT falhar, `Importacao` tenta 3 vezes com o mesmo backoff e
depois pede o arquivo de novo.

**A duração vem do cliente.** `chunks.length * DURACAO_CHUNK_S` diria 30 s para um
diário de 15 min, então `/pronto` e `/finalizar` aceitam `duracao_s` no corpo e
ele vence a contagem. Duração desconhecida (`NaN`/`Infinity`, container sem
cabeçalho) é omitida e o servidor cai na contagem de blocos.

### 3.1 Por que o recorder é recriado

`MediaRecorder` com `timeslice` **não serve**: só o primeiro blob carrega o
header WebM; os seguintes não são decodificáveis sozinhos e o STT rejeita.

O `MediaStream` é aberto uma vez em `iniciar()` e nunca é tocado. A cada 30 s o
recorder é parado (`onstop` emite o bloco) e um novo é criado sobre o mesmo
stream. Cada bloco sai completo e decodificável; a lacuna é de milissegundos.

Formato: `audio/webm;codecs=opus`, mono, 24 kbps — ~120 kB por bloco de 30 s,
~4 MB numa sessão de 20 min (aceite 8).

### 3.2 Durabilidade da fila

`fila.ts` sobe um bloco por vez, na ordem em que foi falado:

1. `enfileirar` grava no IndexedDB **antes** de qualquer rede;
2. pede a presigned, faz o `PUT`, chama `/pronto`;
3. só então `removerChunk`.

Falha em qualquer ponto → backoff exponencial com jitter (`backoff.ts`, base 1 s,
teto 30 s) e o bloco continua no depósito. `window.addEventListener("online")`
acorda a fila. Rede caindo por um minuto atrasa a subida e não perde bloco
(aceite 4).

Antes de finalizar, `Processando` chama `aguardarFilaVazia()` — nenhuma sessão é
fechada com bloco ainda por subir.

## 4. Transcrição

### 4.1 Paralela, não no fim

Cada bloco é transcrito assim que sobe, disparado por `waitUntil` na rota
`/pronto` — o cliente não espera pelo STT, ele volta a gravar. Quando a gravação
de 15 minutos para, só falta o último bloco. É isso que faz o sistema parecer
rápido (aceite 5).

### 4.2 Porta única de modelo (Vercel AI Gateway)

**Todo tráfego de LLM deste sistema sai pelo Vercel AI Gateway** — STT hoje,
extração e deduplicação a partir da slice 2, e o que vier depois. Uma chave
(`AI_GATEWAY_API_KEY`), um lugar para ver custo e latência, e trocar de provedor
é mudar uma variável de ambiente, sem tocar em código. É a regra inviolável 8.

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
"uma chave, um lugar para ver custo" quando a extração chegar.

**Hoje passam por aqui o STT e a extração** — `modeloStt()` (padrão
`xai/grok-stt`, trocável por `STT_MODEL`) e `modeloExtracao()` (padrão
`zai/glm-5.3-flash`, trocável por `EXTRACAO_MODEL`). Deduplicação é slice 3 e não
existe: o que existe é a porta por onde ela vai passar, e a guarda que impede que
passe por fora.

### 4.2.1 Por que o STT é o `xai/grok-stt`, e não um melhor de texto

Medido em 2026-08-31, com o **mesmo bloco real** de 30 s para todos, pelo
Gateway. A pergunta não é quem transcreve melhor: é quem devolve **tempo**.

| Modelo | Tempo | Texto | Custo/30 s | Rate limit |
|---|---|---|---|---|
| `xai/grok-stt` | **palavra** — 64 segmentos de 1 palavra (`1.802–2.002 "Vamos"`) | pior dos cinco | $0,0008 | — |
| `openai/whisper-1` | frase — 4 segmentos de ~8 s | bom | $0,0029 | **free tier bloqueia** |
| `google/gemini-3.5-transcribe` | **nenhum** | melhor dos cinco | $0,0014 | — |
| `openai/gpt-4o-transcribe` | **nenhum** | bom | $0,0015 | — |
| `openai/gpt-4o-mini-transcribe` | **nenhum** | bom | $0,0008 | — |

`deepgram/*`, `assemblyai/*`, `elevenlabs/*`, `groq/whisper-*`,
`mistral/voxtral-*`, `fal/wizper`, `revai/*` e `azure/whisper`: `Model not
found`. Não estão neste Gateway — e é de **Deepgram** que vem o nome `keyterm`
usado em `stt.ts`, o que explica a opção estar lá e provavelmente nunca ter
feito efeito em provedor nenhum.

**Sem tempo não há procedência**, que a visão §4 lista como necessidade: sem
ele todo átomo nasce com `inicios_s`, `fins_s` e `ancoras` vazios, o player da
revisão some de todos os itens e "escuto antes de aprovar" deixa de existir.
Isso elimina os três modelos sem timestamp por melhor que seja o texto deles.
O `whisper-1` sairia por rate limit: uma sessão de 15 min são 30 blocos, e o
free tier travou já na segunda chamada seguida.

Sobra um. **A troca para `google/gemini-3.5-transcribe` foi tentada e revertida
no mesmo dia** — fica registrada aqui para ninguém repetir o teste daqui a três
meses achando que é ideia nova.

O custo declarado: no bloco medido o grok escreveu "Vamos testar se **a
secretária** está funcionando" onde os outros três ouviram "testar se **isso
aqui tá** funcionando". O bloco é um teste de microfone de 24/08, e as sessões
reais transcritas por ele produziram extração boa — mas transcrição estranha
numa sessão de verdade tem aqui a primeira suspeita, e não há para onde correr
dentro deste Gateway.

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

**Observado com `xai/grok-stt` (2026-08-24, primeira transcrição real):** o
provedor não expõe nada em `providerMetadata`, então o bloco é registrado como
`granularidade: "segmento"` — mas os `segments` que ele devolve têm **uma
palavra cada** (64 de 64 no bloco medido, ex.: `1.802–2.002 "Vamos"`). Na
prática a precisão é por palavra e o campo a subdeclara. Subdeclarar é o lado
seguro do erro, e nada foi mudado: reclassificar depende de decidir se
"um segmento de uma palavra" conta como timestamp por palavra, o que é escolha
de produto, não de implementação.

**Reconfirmado em 2026-08-31**, na medição de §4.2.1: mesmos 64 segmentos de uma
palavra, mesma ausência de `providerMetadata`. É exatamente esse comportamento —
`segments` densos o bastante para ancorar palavra por palavra — que faz este
modelo ser o único do Gateway que serve, e é sobre ele que as âncoras dos átomos
que já estão no grafo foram construídas.

### 4.4 Vocabulário

Metade do que se fala são nomes próprios que o modelo não conhece: "Rodozanco"
vira "rodo zanco". `config/vocabulario.txt` (uma entrada por linha, `#` é
comentário) é lido, cacheado em memória e mandado como `keyterm`, respeitando o
teto da API: 100 termos, 50 caracteres cada, sem repetir a mesma palavra em
outra caixa. Termo longo demais é descartado inteiro, nunca truncado pela
metade. Na slice 1 a lista é escrita à mão; a partir da slice 3 é gerada das
entidades do grafo.

**A lista de fato muda a transcrição** — medido em 2026-08-31, mesmo bloco,
mesma chamada, só a lista variando:

| Lista | Saída |
|---|---|
| sem lista | "Acordei em **Porto Alegre** hoje" |
| `["Xhavier"]` (controle irrelevante) | "Acordei em **Porto Alegre** hoje" |
| `["Portalegre"]` | "Acordei em **Portalegre** hoje" |

A grafia segue a lista, e o controle mostra que um termo que não foi falado
**não** se injeta na saída. É o que sustenta a metade A da slice 3: gerar a
lista das entidades do grafo tem efeito real, não decorativo.

### 4.5 Concatenação

Cada `chunk_NNN.json` traz offsets relativos ao próprio início. O offset absoluto
é `relativo + 30 × i` (`DURACAO_CHUNK_S`). `concatenar()` ordena por `i`, soma os
offsets, junta o texto e registra o mapa `{ i, texto, offset_s }`.

Enquanto processa, a tela mostra só o **prefixo contíguo** dos blocos prontos
(`prefixoContiguo`): se o bloco 2 ainda está no STT, o 3 não aparece — texto
parcial nunca é lido fora de ordem.

### 4.6 Extração de átomos

**Dispara sozinha** quando a transcrição termina, emendada no mesmo `waitUntil`
do `finalizarSessao` — ninguém aperta nada entre parar de falar e ter a proposta
(aceite 1 da slice 2). O que ainda não existe é quem a leia: a tela de revisão e
o confirmar.

`extracao.ts` monta o prompt, valida a resposta item por item e carimba a
procedência. Sai pelo Gateway como o STT, por
`modeloExtracao()`. Devolve uma `Extracao` — a proposta, que pertence ao R2 e não
ao grafo (regra 5). Cada átomo leva `id` determinístico (`<sessao_id>-<índice>`,
que é o que fará o `MERGE` do confirmar ser idempotente), `prompt_version` e
`modelo` (regra 7).

Item malformado não derruba a extração inteira: vai para `descartados` com o
motivo. Lista de descarte crescendo é sinal de prompt piorando — e é o único
sinal automático que existe, já que a qualidade é avaliada à mão na revisão.

#### O modelo raciocina, e o raciocínio come a saída

`zai/glm-5.3-flash` é modelo de raciocínio. Numa sessão de 4 mil caracteres ele
gastou **1720 tokens raciocinando para 122 de texto** — e quando o raciocínio
consome o orçamento inteiro a resposta chega sem JSON nenhum. Foi assim que a
sessão `mtgo3kaf5` falhou, de forma intermitente: a mesma transcrição às vezes
passava.

Quatro defesas, nenhuma dependente do provedor:

| | |
|---|---|
| `maxOutputTokens: 8000` | folga para o raciocínio caber sem espremer o JSON |
| uma segunda tentativa | resposta sem JSON é refeita uma vez, com `[extracao]` no log; a segunda falha sobe |
| a resposta crua no erro | os primeiros 400 caracteres vão na mensagem, e "resposta vazia" é dito com essas palavras |
| `diagnostico(resposta)` | `finishReason`, tokens de entrada/saída/raciocínio e o tamanho do texto e do pensamento, nas duas tentativas. Mora em `modelos.ts`: os três agentes têm o mesmo modo de falha |

As duas últimas são as que mais importam, e as duas foram acrescentadas depois
de uma falha real. Sem a resposta crua, "não é JSON válido" é indiagnosticável
depois do fato — a mesma lição que o STT já tinha ensinado uma vez (5.1).

**E sem o diagnóstico, "Vieram 0 caractere(s)" não distingue duas causas com
consertos opostos** — a dúvida que a sessão `mthu6r1y5h` deixou aberta:

| O que o diagnóstico mostra | O que aconteceu | Conserto |
|---|---|---|
| `finishReason=length`, `raciocinio` no teto | o raciocínio comeu o orçamento | subir `MAX_TOKENS_SAIDA`, ou trocar por `EXTRACAO_MODEL` |
| `finishReason=stop`, saída sobrando, `pensamento` grande e `texto=0` | o modelo escreveu na parte de raciocínio, não na de texto | ler `reasoningText` quando o texto vier vazio — a segunda tentativa hoje só acerta por sorte |

A segunda linha é a que dói: nela, a segunda tentativa **mascara** o problema em
vez de resolvê-lo, e ele volta na sessão seguinte. Distinguir custa uma linha de
log; adivinhar custa uma sessão por vez.

O prompt também ganhou uma proibição explícita de **comentar a transcrição**. O
modelo devolveu um átomo dizendo que o texto era confuso e circular; falar
desorganizado é o esperado num diário falado, e lista vazia é a resposta certa
quando não há o que extrair.

#### O que o prompt manda fazer (`extracao-3`)

A primeira versão pedia "uma afirmação por item" e só descartava hesitação. Numa
sessão real de 45 s isso rendeu 9 átomos — "acordei", "pedalei", "nadei", "fui
sauna" —, o que extrapolado dá ~150 numa sessão de 15 min. Duas condições de
morte de `Specs/visao.md` §8 de uma vez: revisão que passa de um minuto, e
rotina repetida todo dia apodrecendo o grafo. O prompt **manda selecionar**, não
picar:

| Critério | Regra |
|---|---|
| Volume | 10 a 20 átomos numa sessão de 15 min; preferir o átomo maior ao recorte |
| O que entra | carga, conclusão, consequência, decisão, interação |
| Trivialidade | colapsa num único átomo `ROTINA` por sessão |
| `texto` | frase limpa, com as palavras de quem falou — tira muleta, resolve pronome, não parafraseia nem interpreta |
| `trechos` | literais, 1..n, copiados da transcrição |
| Junção | o mesmo assunto dito em dois momentos é **um** átomo |
| `sobre` | `SENTIMENTO`, `APRENDIZADO`, `ROTINA` → "eu"; `FATO`, `OPINIAO`, `CONQUISTA`, `DECISAO` → o assunto |

`"eu"` é uma `:Pessoa` como qualquer outra — decisão tomada, não acidente.

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

O extrator devolve o **nome cru** que ouviu: "Rodozanco", "Rafa", "ela". Ele não
sabe o que existe no grafo, e é de propósito — cinco versões de calibração
produziram uma extração que presta, e enfiar o catálogo de entidades naquele
prompt arriscaria o que está bom por um problema que não é dele.

Quem confronta com o grafo é o passo seguinte (4.8), que atribui **cada menção**
a um nó — não cada nome. A diferença é a slice 4 inteira: dois átomos da mesma
sessão dizendo "Rafa" podem ser duas pessoas.

`entidades.ts` ficou com as duas pontas disso:

| Função | Faz |
|---|---|
| `listarEntidades` | o catálogo: tudo que está no grafo, com tipo, sessões, aliases e os três campos de perfil. Uma consulta só, e é o mesmo objeto que a tela `/entidades` mostra |
| `acharPorChave` | casamento exato que **atravessa alias** de graça: `chaves` traz a grafia própria e as já fundidas no nó |
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

O tipo é proposto pelo extrator numa lista `entidades` à parte, e cai em
`:Pessoa` quando falta ou vem inválido — num diário falado, quase sempre acerta.
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
tudo aprovado**. Desmarcar é um toque, editar são dois (tocar no texto abre o
editor de texto, tipo e sujeito).

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
a ser o do nó: o grafo vence, aqui como na resolução (4.6). Entidade
**conhecida** não tem barra de nome — renomear nó que já existe é trabalho de
`/entidades`, e re-apontar um átomo que caiu no nó errado se faz pelo `sobre`
dele, dentro do átomo.

Entidade com `precisa_nome` vai para o topo, destacada, e **o confirmar fica
desabilitado** enquanto sobrar pronome. Desmarcar deixa a entidade só no texto do
átomo. **Entidade que é sujeito de um átomo aprovado fica travada**: sem ela o
átomo ficaria sem `:SOBRE`, o que o contrato do schema não admite.

O editor de um átomo abre por um botão **editar** — que num átomo em dúvida
(4.8) se chama **escolher**. Antes ele abria clicando no texto, sem pista nenhuma
— e o CSS ainda dava `cursor: text` ali, sinalizando o contrário. Menção igual ao
sujeito não é exibida nem enviada.

**A entidade se corrige em dois lugares, e a diferença entre eles é o alcance.**
Dentro do átomo, no bloco "entidades" do editor, eu troco o sujeito e as menções
**daquele** átomo. No painel do rodapé eu troco o nome de uma candidata e
**todos** os átomos que a citam seguem junto — a tradução acontece em
`nomeFinal()`, na hora de montar o payload, e nenhum átomo é reescrito. Os dois
usam a mesma barra: `SeletorEntidade`.

**A barra é uma lista pesquisável sobre o grafo inteiro.** Foco abre a lista;
apagar tudo mostra o grafo todo, mais falado primeiro; digitar filtra por
**trecho** — "nan" acha "Fernanda". Cada linha traz tipo e número de sessões, e
quando o casamento veio de um apelido ele aparece entre parênteses, senão a linha
apareceria sem motivo visível. As alternativas do agente de resolução vêm
primeiro. O filtro de tipo continua, agora valendo para todas as barras daquele
átomo.

Era um `<input list>` com `<datalist>`, escolhido na slice 4 por não custar
biblioteca. Ele não sustenta o que falta: casa só prefixo em vários navegadores,
não mostra tipo nem apelido, não atravessa alias, e no celular — que é onde este
app vive — degrada para uma tirinha de sugestão. O combobox é escrito à mão, com
os tokens de `globals.css`; nenhuma dependência entrou.

**O campo continua aceitando nome que não existe.** A lista é ajuda, não trava. O
que decide entre reusar um nó e criar outro é o **casamento exato** de
`catalogo.resolver` na montagem do payload: casou (por caixa, por acento ou por
alias), vai a grafia canônica do grafo e o tipo do nó; não casou, nasce entidade
nova com o que eu escrevi. A linha `+ criar "X"` existe só para eu ver de que
lado eu estou antes de confirmar.

O catálogo vem de `GET /api/entidades`, rota que já existia — **rota nova
nenhuma, migration nenhuma**. Se ela falhar, as barras voltam a ser texto livre,
que era o comportamento anterior; `tests/revisao.test.ts` fixa isso.

**As menções são editáveis** — acrescentar e tirar, uma barra por menção.
Antes elas eram texto morto no item: menção errada só se consertava rejeitando o
átomo inteiro ou renomeando a entidade no rodapé, e as duas são grandes demais
para o erro. A lista viaja inteira nas edições do átomo, e não como delta: sem
isso não dá para distinguir "não mexi" de "apaguei todas".

**Átomo com atribuição incerta aparece marcado**, com a sugestão já preenchida, o
motivo do agente e as alternativas ao lado. O confirmar **não** trava: ver 4.8.

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

**A lista de entidades vem da tela, não da proposta.** Era o contrário, e por
isso renomear o sujeito de um átomo devolvia 400: o servidor exigia que ele
estivesse entre as entidades da extração, e a lista não tinha como crescer. Agora
o corpo manda `entidades: [{ nome, tipo }]` com os nomes finais, e o cliente
acrescenta qualquer sujeito que eu tenha escrito à mão. Duas guardas no servidor,
porque a regra não pode depender da UI: nome que caia na lista de pronomes é
recusado com 400, e `tipo` é validado contra `TIPOS_ENTIDADE`.

### 4.8 Identidade por contexto (agente 2, `resolucao-1`)

**"Raffa" e "Rapha" são o mesmo som.** O STT escreve uma grafia só para os dois,
e ter os dois nomes no vocabulário não ajuda — só torna arbitrário qual sai. A
grafia na transcrição carrega **zero** sinal sobre quem é.

Isso mata qualquer solução baseada em nome, e é o que separa esta slice da 3. Lá
o problema era duas grafias para a mesma coisa, e `nome_normalizado` resolvia
(8.2). Aqui é o contrário — **uma grafia para duas coisas** — e a chave não pode
resolver, por construção. Só o contexto resolve, e o contexto são os três campos
de perfil da entidade (8.3).

```
transcrição ──▶ agente 1: extracao-5   devolve o nome cru: "Rafa"
                      │
                      ▼
                agente 2: resolucao-1  vê os átomos + as entidades com perfil
                      │                decide POR MENÇÃO: qual nó, ou nova
                      ▼                marca o que é informação de perfil
                revisão ──▶ confirmar ──▶ grafo
```

Dois agentes e não um, com `prompt_version` própria cada um (regra 7): calibram
separado, e um erro de atribuição se conserta sem tocar na extração que está boa.
De quebra o agente 2 roda **sem re-extrair** — calibrar a resolução não custa uma
chamada de extração por tentativa.

#### A atribuição é por menção, não por sessão

`AtomoProposto.sobre` é uma `ReferenciaResolvida` e `.menciona` é uma lista
delas:

```ts
{ citado, entidade, conhecida, certo, alternativas, motivo }
```

`citado` guarda o que o extrator escreveu; `entidade` é a quem foi atribuído.
Até a slice 3 todas as menções ao mesmo nome colapsavam numa candidata só,
válida para a sessão inteira — o que não tem como expressar que dois "Rafa" da
mesma sessão são duas pessoas. O painel de entidades da revisão continua
existindo, agora como **visão agregada** do que foi resolvido.

**Compatibilidade:** proposta gravada antes da slice 4 tem `sobre` como string.
`referencias.ts` lê os dois formatos — string vira referência com `certo: true`,
porque o que o extrator disse era tudo o que havia e destacar dúvida ali seria
inventar uma que ninguém teve. É o que impede a tela de quebrar numa sessão que
já estava esperando em `em_revisao`.

#### Só chama o modelo quando há o que decidir

Uma passada determinística e de graça monta os candidatos de cada menção,
reusando `proximidade` de `duplicatas.ts` — que pega o homófono de brinde, porque
"Rafa" fica a uma ou duas letras de "Raffa" e de "Rapha".

| Situação da menção | O que acontece |
|---|---|
| um candidato exato, nenhum parecido | resolve ali, `certo: true`, de graça |
| nenhum candidato | entidade nova, `certo: true`, de graça |
| qualquer outra coisa | vai ao agente |

A última linha cobre o caso traiçoeiro, e é por isso que ela não é "dois ou mais
candidatos": o STT escreve "Rapha" exatamente, o casamento de string acerta **por
sorte**, e como "Raffa" é parecido a menção vai ao agente mesmo assim. Sem ela o
sistema acertaria metade das vezes por acidente e erraria a outra metade em
silêncio. Um parecido sozinho também vai — decidir entre "é o Raffa" e "é alguém
novo chamado Rafa" é exatamente o julgamento desta slice.

**Se nenhuma menção precisar de julgamento, o agente não é chamado** e a sessão
não paga nada. `prompt_version_resolucao` e `modelo_resolucao` ficam `null` na
proposta: registrar uma versão que não rodou seria mentira na procedência.

Uma chamada só para a sessão inteira. O catálogo que vai no prompt é o das
entidades que **esta sessão pode citar** — as já resolvidas e os candidatos —, e
não o grafo inteiro: uma menção só resolve para um candidato dela, e mandar o
resto seria pagar por texto que não muda resposta nenhuma.

#### Dúvida destaca, não trava

Átomo com `certo: false` aparece marcado na revisão, com a sugestão preenchida e
o motivo ao lado. O confirmar continua liberado. Diferente do pronome, que trava:
ali o resultado seria um nó chamado "ela", grafo apodrecido garantido. Aqui o
pior caso é uma atribuição trocada, que eu conserto depois — e travar a cada
dúvida mataria os 60 s da revisão. "Ignorar é sempre uma saída válida"
(visão §5.3).

#### Resposta ruim degrada para dúvida, nunca para atribuição errada

| O que aconteceu | O que o sistema faz |
|---|---|
| o agente não respondeu por uma menção | `certo: false`, com o motivo dizendo isso |
| respondeu uma entidade fora dos candidatos | idem, e a resposta é descartada |
| o agente falhou ou veio sem JSON | todas as pendentes voltam `certo: false`, com `[resolucao]` no log — e o mesmo `diagnostico()` da extração junto, porque o modo de falha é o mesmo |

Falha do agente **não derruba a extração**, que já foi paga: a proposta abre com
as dúvidas destacadas e eu escolho na mão. E o fallback é sempre o casamento
exato quando existe, ou entidade nova quando não — **nunca o parecido**. Duas
entidades a mais eu conserto em `/entidades`; fundir duas pessoas por um palpite
não tem desfazer.

### 4.9 O perfil, e o agente 3 (`perfil-1`)

Os três campos (`contexto`, `pode_ajudar_com`, `fizemos_juntos`) são texto livre,
editáveis à mão em `/entidades`, com teto de 300 caracteres cada — teto que não é
estética: os campos entram no prompt do agente 2, e sem ele o custo daquela
chamada cresceria junto com o grafo.

**Quem aponta o que é perfil é o agente 2**, que já está olhando átomo e entidade
juntos — mais uma razão para o `extracao-5` não mudar. A marca vira
`(:Atomo)-[:PERFILA { campo }]->(:Entidade)` no confirmar (8.3), e só ali
(regra 5). A validação é dupla: o agente só pode marcar uma entidade que o
**próprio átomo** cita, e o servidor só grava campo do schema e entidade
aprovada.

O agente 3 é **sob demanda**, num botão por campo, no mesmo padrão do "procurar
duplicatas": juntar os átomos marcados é de graça, propor o texto não é. Ele lê
os átomos ligados por `:PERFILA` àquele campo e devolve o texto novo — e **não
grava nada**. O proposto aparece **ao lado** do atual, nunca por cima; eu aceito,
edito ou ignoro.

**O risco está declarado, e é ele que desenha o fluxo:** o perfil é exatamente o
que o agente 2 lê para desambiguar. Perfil rascunhado errado contamina toda
atribuição futura, e o erro se realimenta — átomo atribuído ao Rapha por engano
vira evidência do perfil do Rapha. Por isso nada entra sem o meu toque, e por
isso o texto atual nunca é sobrescrito sem eu ver os dois lado a lado.

## 5. Estados da sessão

```
gravando → finalizando → transcrevendo → transcrito → extraindo → em_revisao → confirmada
                  ↓              ↓                         ↓
                 erro          erro                       erro    (o que está no R2 fica
                                                                   intacto, retry manual)
```

`transcrito` **não é mais terminal**: a extração emenda nele. O fim da linha é
`confirmada`, e quem confirma sou eu, na revisão — `estaConcluida` mudou junto.
`confirmada` não tem transição de saída.

`estados.ts` guarda as transições permitidas. Quatro predicadas dizem o que cada
estado significa para as telas:

| Predicada | Verdadeira em | Para quê |
|---|---|---|
| `temTranscricao` | `transcrito`, `extraindo`, `em_revisao`, `confirmada` | a leitura para o polling; a extração corre atrás |
| `estaPendenteDeRevisao` | `em_revisao` | tem proposta esperando |
| `terminouDeProcessar` | `em_revisao`, `confirmada`, `erro` | a leitura para o polling |

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

### 5.1 Onde o motivo de uma falha aparece

`erro` é um estado sem explicação — e agora ele cobre duas coisas diferentes,
falha de transcrição e falha de extração. A tela só sabe dizer que falhou e
o grafo guarda o status, não a causa — `:Sessao` não tem propriedade de erro, e
acrescentar uma é mudança de schema. **O motivo existe só no log do servidor**,
com prefixo:

| Linha | Quem escreve | Quando |
|---|---|---|
| `[stt] sessão <id> bloco <i> falhou:` | rota `/chunks/:i/pronto` | o bloco falhou ao ser transcrito na subida |
| `[pipeline] sessão <id> bloco <i> não transcreveu:` | laço de espera em `finalizarSessao` | a retentativa da finalização falhou |
| `[pipeline] sessão <id>: desistiu após 45s…` | `finalizarSessao` | o prazo estourou; lista os blocos que faltaram |
| `[extracao] sessão <id> falhou:` | `extrairSessao` | o modelo estourou, ou a resposta não era JSON válido |
| `[extracao] sessão <id>: sem transcricao.json…` | `extrairSessao` | pediram extração de uma sessão sem transcrição gravada |
| `[finalizar] sessão <id> falhou:` | rota `/finalizar` | `finalizarSessao` estourou uma exceção |

O laço de espera engolia o erro do bloco em `catch {}` — a falha ia para `erro`
sem uma linha sequer, e depois do fato não havia o que investigar.
`tests/pipeline.test.ts` fixa isso: falha de bloco sempre deixa rastro.

Log de terminal morre com a janela. Por isso `scripts/dev.ps1` também escreve
tudo em `logs/dev-<data>.log` (seção 13) — sem isso, diagnosticar uma falha
exige reproduzi-la.

## 6. Idempotência

Regra inviolável 4: todo passo é chaveado por `sessao_id` (+ `chunk_index`).
Três travas independentes:

| Trava | Onde | Efeito |
|---|---|---|
| `chunk_NNN.json` existir | `pipeline.transcreverBloco` | não rechama o STT nem sobrescreve resultado pronto |
| `extracao.json` existir | `pipeline.extrairSessao` | não rechama o modelo nem sobrescreve proposta que eu já posso ter revisado |
| `If-None-Match: *` no PUT da proposta | `pipeline.extrairSessao` | dois workers na mesma sessão geram uma proposta só: quem chega em segundo usa a do primeiro |
| entrada no manifest por `i` | `manifest.registrarChunk` | reenviar o mesmo bloco não duplica nem reabre bloco transcrito |
| `id` do átomo = `<sessao_id>-<índice>` | `atomos.gravarAtomos` (`MERGE`) | confirmar duas vezes não duplica átomo |
| `nome_normalizado` único (constraint) | `atomos.gravarEntidades` (`MERGE`) | duas menções à mesma pessoa viram um nó, mesmo em corrida |
| `campo` **dentro** do `MERGE` de `:PERFILA` | `atomos.gravarAtomos` | reconfirmar não dobra a aresta de perfil: a identidade dela é (átomo, campo, entidade) |
| o rascunho de perfil não escreve | `perfil.rascunhar` | pedir o rascunho dez vezes não muda o grafo; só `POST /api/entidades/perfil` grava |
| status na cláusula `WHERE` | `sessoes.atualizarSessao` | transição já feita não volta atrás; confirmar duas vezes não reprocessa |

A trava de `extracao.json` vale para **os dois agentes**: proposta pronta não
rechama nem a extração nem a resolução, e `forcar` refaz as duas. Calibrar o
`resolucao-1` custa, sim, uma extração junto — o que a arquitetura de dois
agentes barateia é o contrário: mexer no `resolucao-1` não mexe no `extracao-5`.

**A única saída da trava é `extrairSessao(id, { forcar: true })`**, exposta por
`POST /api/sessoes/:id/extrair` com `{"forcar": true}`. Ela existe para calibrar
o prompt: sem ela, cada versão nova exigiria gravar áudio novo, porque a proposta
existente bloqueia o reprocessamento. Forçado sobrescreve — inclusive proposta já
revisada — e por isso vai sem `If-None-Match`. O caminho automático nunca força.

`finalizar` numa sessão `em_revisao` ou `confirmada` devolve
`{ ja_finalizada: true }` sem reprocessar (aceite 9). Numa sessão que já
transcreveu mas ainda não extraiu, a segunda chamada **é** o retry da extração —
é por ela que se recupera um `waitUntil` que morreu no meio.

### 6.1 Concorrência no manifest

Vários `/pronto` podem chegar ao mesmo tempo. `atualizarManifest` faz
read-modify-write condicional: lê o objeto com o etag, aplica um mutador **puro e
idempotente**, grava com `If-Match` (ou `If-None-Match: *` na primeira vez). Em
412/409 (`ConflitoR2Error`) relê e reaplica, com backoff, até 6 tentativas.

Duas exigências de transporte do R2 sustentam isso, ambas dentro de `put()` em
`r2.ts`, ambas descobertas quebrando na primeira gravação real (2026-08-24):

- **`Content-Length` sempre explícito.** O undici o deduz de corpo em texto, mas
  essa dedução se perde quando o corpo chega como stream — que é o que acontece
  no caminho do `waitUntil`, depois da resposta já enviada. Sem o header a
  requisição sai *chunked* e o R2 responde **411 MissingContentLength**. Por isso
  `put()` codifica o corpo uma vez e manda o tamanho em bytes, nunca em
  caracteres.
- **`If-Match` só com validador forte.** O R2 comprime a resposta de GET de
  objeto compressível — o manifest é um — e nesse caso devolve o etag como
  `W/"…"`. O digest é o mesmo; só o prefixo sobra. Repassado cru, o R2 compara
  estrito e recusa com **412 em toda gravação**, esgotando as 6 tentativas.
  `etagForte()` remove o `W/` antes de assinar.

O primeiro erro mascarava o segundo: o 411 estourava antes de o laço de retry
chegar a exercitar o `If-Match`. `tests/r2.test.ts` cobre os dois.

### 6.2 Gravação interrompida

**Retomar não existe mais.** Havia um chip na home que oferecia "retomar" e
"revisar" no mesmo cartão; ele saiu para tirar a cobrança da tela de gravar
(visão §6), e o "retomar" foi junto — era o único lugar de onde podia ser
chamado, porque precisa do microfone e do `Gravador`. Todo o maquinário dele foi
apagado com ele (§5): `proximoIndice`, `foiAbandonada`, `ABANDONO_MIN`,
`indiceInicial`. Uma gravação nova sempre começa em `chunk_000` de uma sessão
nova.

**Fala não se perde por isso.** Os blocos que já subiram estão no R2, e a sessão
interrompida continua na lista de sessões levando a `/sessao/:id`, onde
`Processando` finaliza e transcreve o que existe. O que se perde é emendar fala
nova na mesma sessão — está no §14 como limite.

## 7. Fronteira de segurança

- **Auth:** magic link com um único e-mail permitido (`ALLOWED_EMAIL`). Token é
  `escopo.exp.HMAC-SHA256`, assinado com `AUTH_SECRET` via WebCrypto; comparação
  em tempo constante. Link vale 15 min, cookie de sessão 90 dias, `httpOnly` +
  `sameSite=lax` + `secure` em produção. Sem signup, sem roles, sem reset.
- **Middleware** é a porta única: só `/entrar` e `/api/auth/*` passam sem cookie.
  Requisição a `/api/*` sem cookie recebe 401; navegação vai para `/entrar`.
- **Nenhuma chave de servidor chega ao cliente** (regra 3): `src/lib/env.ts` só
  roda no servidor e nenhum segredo usa `NEXT_PUBLIC_`. O navegador recebe
  apenas URLs presigned de 5 minutos, uma por bloco.
- **Bucket privado**, sem acesso público. CORS (`config/r2-cors.json`) é
  obrigatório: sem ele o preflight barra o PUT e nada sobe — e a tela não mostra
  erro, porque a mecânica de upload é invisível.
- `idValido()` aceita só o formato que este sistema gera (`^[0-9a-z]{8,40}$`),
  barrando path traversal nas chaves do R2.
- **O áudio também não passa por function na volta** (regra 1): a rota
  `/chunks/:i/audio` assina um GET presigned de 5 min e o navegador busca os
  bytes direto no R2. A rota confere que a chave existe antes de assinar — URL
  para objeto inexistente faria o `<audio>` falhar calado.
- **O confirmar não aceita procedência do cliente** (4.7): offsets, âncoras,
  `prompt_version` e `modelo` são relidos do R2.

## 8. Neo4j

Acesso pela **HTTP Query API**, nunca pelo driver Bolt: serverless não sustenta
pool de conexões. `NEO4J_QUERY_URL` é o endpoint completo
(`https://<id>.databases.neo4j.io/db/<banco>/query/v2`). O `<banco>` **não é
necessariamente `neo4j`**: nesta instância Aura ele é o próprio id da instância,
o valor de `NEO4J_DATABASE` no arquivo de credenciais. Errar esse segmento dá
`Database does not exist` no `pnpm migrate`. `query()` traduz o par
`fields`/`values` da resposta em objetos e transforma `errors[0]` em
`Neo4jError`.

Dois módulos escrevem conteúdo, e a divisão importa:

| Módulo | Escreve | Quem chama |
|---|---|---|
| `atomos.ts` | `:Atomo`, `:Entidade` e `:PERFILA` | **só o confirmar** — nenhum átomo entra antes da revisão (regra 5) |
| `fusao.ts` | `:Entidade` — funde, renomeia, troca tipo, cria | só as rotas de `/entidades`, com um toque meu em cada uma |
| `perfil.ts` | `:Entidade` — os três campos de perfil (8.3) | só `POST /api/entidades/perfil`, com um toque meu |

A regra 5 é sobre o **pipeline** não gravar sozinho. `fusao.ts` é o contrário
disso: é eu corrigindo à mão o que o pipeline deixou torto. A resolução de
entidade (4.6) continua só lendo. Labels que o código escreve:

```
(:Sessao { id, iniciada_em, duracao_s, status, audio_key,
           transcricao_key, chunks_total })
```

`:Sessao` é infraestrutura de gravação, não conteúdo: gravar o nó sem
confirmação não conflita com a regra 5 (nada entra no grafo sem aprovação) —
essa regra vale para átomo e entidade.

### 8.1 Schema da slice 2, aplicado e em uso

A migration `002_atomo_entidade.cypher` já rodou: `:Atomo` e `:Entidade` têm
constraint e índice no Aura, e o grafo já recebeu conteúdo de sessões reais —
átomos com as duas listas de offsets, `ancoras`, `status`, `prompt_version` e
`modelo`, ligados por `:GEROU`, `:SOBRE` e `:MENCIONA`. O `MERGE` com label
literal por tipo, a constraint de `nome_normalizado` e as listas paralelas como
float foram conferidos contra o Aura, não só contra o banco mockado. Quem escreve neles é o confirmar da revisão, por
`atomos.ts`; `entidades.ts` só lê, por `nome_normalizado`.

Neo4j não aceita label vindo de parâmetro e o projeto não usa APOC, então
`gravarEntidades` roda **uma consulta por tipo**, com o label literal na string.
É seguro porque o valor sai de `TIPOS_ENTIDADE`, constante fechada, e nunca do
cliente.

Depois da migration 003 o contrato de `:Atomo` é:

```
(:Atomo { id, texto, tipo, inicios_s, fins_s, ancoras,
          criado_em, valido_em, status, prompt_version, modelo })

tipo ∈ FATO | OPINIAO | SENTIMENTO | APRENDIZADO | CONQUISTA | DECISAO | ROTINA
```

`inicios_s`/`fins_s`/`ancoras` são listas paralelas, uma entrada por âncora —
Neo4j não guarda array de mapa como propriedade. A proposta no R2 guarda a forma
rica (`trechos: [{texto, inicio_s, fim_s, ancora}]`); o achatamento acontece no
confirmar. A 003 **não tem statement nenhum**: nada do que ela muda é declarável
no Aura Free, então ela documenta o contrato e o código o garante.

| Constraint | Alcance |
|---|---|
| `atomo_id` | id determinístico `<sessao_id>-<índice>` — é ele que faz o `MERGE` do confirmar ser idempotente |
| `entidade_id` | |
| `entidade_nome_normalizado` | único entre **todas** as entidades: `:Pessoa`, `:Projeto` e `:Objetivo` carregam `:Entidade`, então um projeto e uma pessoa não podem ter o mesmo nome. Deliberado — é a trava que impede duplicata em corrida, ao custo de recusar colisão legítima de nome entre tipos |

Índices em `:Atomo(status)`, `:Atomo(tipo)` e `:Atomo(valido_em)`.

Constraint de existência de propriedade (`IS NOT NULL`) não existe aqui: é
recurso Enterprise e o Aura Free recusa. `prompt_version` e `modelo`
obrigatórios em todo átomo (regra 7) são garantidos por código e teste, não pelo
banco.

Tipo de relação não se declara em Neo4j — `:GEROU`, `:SOBRE` e `:MENCIONA` só
passam a existir com a primeira aresta. Ficam registrados em comentário no topo
da migration, que é a definição canônica do schema.

**Mudança de schema = nova migration numerada**, proposta e aprovada antes de
rodar. `db/migrations/` é a definição canônica; `scripts/migrate.ts` aplica os
arquivos em ordem pela Query API. Nunca alterar schema direto no código ou no
console do Aura.

### 8.2 Higiene: fundir é criar alias (migration 004)

Duas grafias da mesma coisa entram como dois nós — a constraint de
`nome_normalizado` impede duplicata da **mesma** grafia, não de grafias
parecidas: "Exxmed" e "Exx Med" normalizam para chaves diferentes.

```
(:Entidade { …, status })                status ∈ 'ativa' | 'fundida'
(:Entidade)-[:FUNDIDA_EM]->(:Entidade)   do alias para o vencedor
(:Entidade)-[:DISTINTA_DE]->(:Entidade)  recusa minha: não propor de novo
```

**Fundir não apaga** (regra 6). O perdedor fica com `status = 'fundida'` e uma
aresta `:FUNDIDA_EM`; as arestas `:SOBRE` e `:MENCIONA` migram por `MERGE`, uma
consulta por tipo — Neo4j não aceita tipo de relação vindo de parâmetro, e
repetir duas linhas é bem menos frágil que uma subquery com `UNION`.

O ponto do desenho: **como o perdedor mantém o `nome_normalizado`, a grafia
morta nunca renasce como nó novo.** Dita outra vez, ela casa com o alias e a
leitura segue até o vencedor. A fusão é o mecanismo de alias, não um efeito
colateral dele — e é o que faz ela valer para amanhã, não só arrumar o ontem.

Quem atravessa o alias:

| Onde | Por quê |
|---|---|
| `buscarConhecidas` / `resolver` | "Exx Med" numa sessão nova volta como conhecida, com o nome do vencedor |
| `gravarAtomos` (`:SOBRE` e `:MENCIONA`) | proposta montada antes da fusão penduraria átomo em nó morto — a trava é no servidor, não na tela |
| `nomesParaVocabulario` | mandar a grafia rejeitada ensinaria o STT a reproduzi-la |
| `listarEntidades` | o alias vira histórico do nome, não linha própria |

Depois da travessia dois nomes distintos podem virar o mesmo nó, e `:SOBRE` +
`:MENCIONA` para a mesma entidade não é contrato válido — a menção redundante é
descartada, o sujeito vence.

**Renomear é fundir consigo mesma sob outro nome:** o nó assume o nome novo e a
grafia velha nasce como alias apontando para ele. É o que fecha o limite da
slice 2 — renomear entidade existente criava um segundo nó.

**O tipo também se conserta.** Ele só era editável enquanto a entidade era
`nova`, na primeira revisão em que aparecia; depois disso ela vira `conhecida`,
a revisão a mostra fixa (o grafo vence sobre o extrator) e o label errado ficava
para sempre. `trocarTipo` põe o label novo e remove os outros, uma consulta com
labels literais — `:Entidade` nunca sai, porque é ele que carrega a constraint.

**Semear é criar entidade antes de falá-la.** `/entidades` deixa criar nome e
tipo à mão, e o nó nasce **órfão de propósito** — zero átomos, e a lista mostra
"ainda não falada". O confirmar evita órfão com cuidado, porque lá seria
acidente; aqui é o pedido. O ganho é que o nome entra no vocabulário do STT
**antes** da primeira menção, que é quando o transcritor mais erra, e quando ele
enfim for falado a resolução acha a entidade pronta com o tipo que eu escolhi,
em vez do palpite do extrator.

`status` ausente conta como ativa (`coalesce` em toda leitura). A 004 **não
migra dado** de propósito: preencher agora arrumaria os nós de hoje e não o que
um deploy antigo criasse amanhã. A defesa tem que estar na leitura.

**Nada é automático.** `duplicatas.ts` só propõe — string primeiro (de graça),
o modelo depois, sobre a lista curta e com os textos dos átomos como contexto.
Fundir é um toque meu: "Marina" e "Mariana" são distância 1 e duas pessoas, e o
custo do erro é assimétrico — duas entidades a mais é grafo um pouco sujo, uma
fusão errada é grafo mentindo, sem desfazer.

### 8.3 Perfil e a aresta que o alimenta (migration 005)

```
(:Entidade { …, contexto, pode_ajudar_com, fizemos_juntos })
(:Atomo)-[:PERFILA { campo }]->(:Entidade)
campo ∈ contexto | pode_ajudar_com | fizemos_juntos
```

A 005, como a 003, **não tem statement nenhum**: propriedade de valor livre não
se declara no Aura Free (constraint de existência é Enterprise) e tipo de relação
não se declara em Neo4j nenhum. Ela existe porque `db/migrations/` é a definição
canônica do schema, e quem for ler tem que ver o contrato inteiro.

**Campo de perfil ausente conta como vazio, na leitura** (`coalesce` em toda
consulta) — mesma decisão do `status` na 004 e pela mesma razão: a defesa tem que
valer para o nó que um deploy antigo criar amanhã, não só para os que existem
hoje. Sem índice: ninguém busca por perfil.

**Por que aresta, e não propriedade do átomo.** Duas razões, e a primeira é a que
manda: a marca precisa dizer **de quem** é a informação. "fui no parque andar de
slackline com o Raffa" é `sobre: "eu"` pelas regras de tipo do `extracao-5`, e a
informação de perfil é do Raffa. A segunda é que Neo4j não guarda array de mapa
como propriedade — foi isso que forçou as listas paralelas da 003. Aresta com
propriedade ele guarda bem, e fica consultável: "todo átomo que diz o que o Rapha
sabe fazer".

**Idempotente por construção**: o `campo` vai **dentro** do `MERGE`, então o par
(átomo, campo, entidade) é a identidade da aresta e reconfirmar não a dobra
(regra 4). Fora do `MERGE`, um `SET` depois criaria uma aresta nova a cada
confirmação. Como `:SOBRE` e `:MENCIONA`, ela **atravessa alias** (8.2): proposta
montada antes de uma fusão penduraria a marca num nó morto.

Neo4j também não aceita **nome de propriedade** vindo de parâmetro, então
`perfil.ts` monta o `SET alvo.<campo>` com o nome literal — mesmo padrão do label
literal em `atomos.ts`, e seguro pela mesma razão: o valor sai de `CAMPOS_PERFIL`,
constante fechada, e nunca do cliente.

**Sem migração de dado.** Nenhum campo é preenchido: as entidades de hoje entram
no catálogo do agente 2 só com nome e tipo, que é o comportamento anterior à
slice. Perfil vazio é perfil válido.

Contrato completo de `:Entidade` depois da 005:

```
(:Entidade { id, nome, nome_normalizado, criado_em, status,
             contexto, pode_ajudar_com, fizemos_juntos })
status ∈ 'ativa' | 'fundida'

(:Entidade)-[:FUNDIDA_EM]->(:Entidade)      do alias para o vencedor     (004)
(:Entidade)-[:DISTINTA_DE]->(:Entidade)     recusa minha                 (004)
(:Atomo)-[:PERFILA { campo }]->(:Entidade)                               (005)
```

## 9. Layout do R2

```
sessoes/<id>/manifest.json      { sessao_id, chunks: [{i, bytes, subido_em, transcrito, ext?}], finalizado }
sessoes/<id>/chunk_000.webm     áudio do bloco gravado no navegador
sessoes/<id>/chunk_000.opus     áudio importado — a extensão é a do arquivo de origem
sessoes/<id>/chunk_000.json     transcrição do bloco, offsets relativos, modelo, granularidade
sessoes/<id>/transcricao.json   final, offsets absolutos
sessoes/<id>/extracao.json      proposta: átomos ancorados, referências resolvidas, marcas de perfil, entidades agregadas, procedência dos dois agentes
_smoke/                         objetos temporários do `pnpm smoke`, apagados no fim
```

`chaves.ts` é o único lugar que monta chave — rota, worker e teste passam por ele.
Por isso é lá que a extensão é validada contra a lista de `audio.ts`, e não só na
rota: extensão é parte de caminho, e quem confia no chamador escreve fora do
prefixo da sessão mais cedo ou mais tarde.

`ext` só aparece no manifest quando **não** é `webm`. Ausente significa gravação,
o que mantém legível todo manifest escrito antes da importação existir
(`extensaoDoChunk`). É esse campo que diz ao `transcreverBloco` onde o áudio
está — procurar sempre em `.webm` mataria toda sessão importada.

## 10. Rotas

| Rota | Faz | Notas |
|---|---|---|
| `POST /api/sessoes` | cria `:Sessao {status:'gravando'}` | devolve `id` |
| `POST /api/sessoes/:id/chunks/:i/url` | presigned PUT de 5 min | corpo `{ext?}`; 415 fora da lista; o áudio não passa por aqui |
| `POST /api/sessoes/:id/chunks/:i/pronto` | HEAD + manifest + `waitUntil(STT)` | corpo `{ext?, duracao_s?}`; `maxDuration = 300` |
| `POST /api/sessoes/:id/finalizar` | `finalizando`, responde na hora, fecha **e extrai** em `waitUntil` | `ja_finalizada` a partir de `em_revisao`; antes disso, é o retry da extração |
| `GET /api/sessoes/:id` | estado + transcrição (parcial enquanto processa) | polling de 2 s, `force-dynamic`; `completa` é sobre a transcrição, não sobre a sessão |
| `POST /api/sessoes/:id/extrair` | dispara extração **e resolução** de uma sessão já transcrita | retry do `waitUntil` perdido; `{"forcar":true}` refaz as duas e sobrescreve |
| `GET /api/sessoes/:id/extracao` | a proposta + o mapa de blocos, para a revisão | o mapa é o que traduz offset em bloco |
| `GET /api/sessoes/:id/chunks/:i/audio` | presigned GET do bloco, para o player | 404 se a chave não existe, para o `<audio>` não falhar calado |
| `POST /api/sessoes/:id/confirmar` | grava os aprovados no grafo, com `:PERFILA` | `ja_confirmada` na segunda; procedência relida do R2, não do corpo |
| `GET /api/entidades` | o que está no grafo, com átomos, sessões, aliases e perfil | só leitura; nó fundido vira alias do vencedor; alimenta também o seletor da revisão |
| `POST /api/entidades/duplicatas` | propõe pares que parecem a mesma coisa | **não escreve nada**; é `POST` porque gasta chamada de modelo |
| `POST /api/entidades/fundir` | `{vencedora, perdedora}` — migra arestas, marca alias | idempotente pela guarda de `status` |
| `POST /api/entidades/distintas` | `{a, b}` — a recusa que impede a pergunta de voltar | |
| `POST /api/entidades/renomear` | `{chave, nome}` — grafia velha vira alias | recusa pronome, como o confirmar |
| `POST /api/entidades/tipo` | `{chave, tipo}` — troca o label | o tipo só era editável enquanto a entidade era nova |
| `POST /api/entidades/criar` | `{nome, tipo}` — semeia um nome antes de falá-lo | cria nó órfão de propósito |
| `POST /api/entidades/perfil` | `{chave, campo, texto}` — grava um dos três campos | o único lugar que escreve perfil; corta no teto de 300 no servidor |
| `POST /api/entidades/perfil/rascunho` | `{chave, campo}` — o agente 3 propõe | **não escreve nada**; é `POST` porque gasta chamada de modelo |
| `POST /api/auth/link` | pede o magic link | resposta idêntica com ou sem acerto no e-mail |
| `GET /api/auth/entrar?token=` | troca o link pelo cookie | |

Todas com `runtime = "nodejs"`.

## 11. Telas

| Rota | Componente | O que mostra |
|---|---|---|
| `/` | `Gravacao` + `BotaoGravar` + `Gestao` | o círculo "Como foi seu dia?" e uma engrenagem discreta no canto — **nada mais**; gravando: ondas laterais, selo de REC, timer e um ponto de "salvo" |
| `/sessao/:id` | `Processando` | o corredor: um verbo do passo atual, sem transcrição; abre a revisão sozinho |
| `/sessao/:id/revisar` | `Revisao` | a proposta: aprovar, editar, escutar cada trecho, resolver a dúvida de quem é, confirmar |
| `/sessao/:id/transcricao` | `Leitura` | o texto literal, em pedaços enquanto transcreve — porta de serviço |
| `/sessoes` | `Sessoes` | lista de sessões: abrir, ler a transcrição, forçar re-extração — e a cor que diz o que já foi revisado |
| `/entidades` | `Entidades` | o que está no grafo; fundir duplicata, renomear, escrever o perfil |
| `/entrar` | página de login | pede o e-mail permitido |

**Em `/` a porta de serviço inteira é uma engrenagem no meio da borda
esquerda** — sessões, entidades e subir um áudio, num menu lateral (`Gestao`).
Ela fica na altura do círculo, na margem, e **não** no canto superior esquerdo:
aquele canto é da `Marca`, a volta ao início. Um segundo significado ali faria o
canto querer dizer duas coisas conforme a tela. Eram
três controles soltos na tela — o link de importar logo abaixo do círculo e as
duas portas no rodapé —, e três coisas para ler antes de falar. Virar um
**aproxima** a tela do "um botão, um timer, um jeito de parar — idealmente nada
mais" da visão §6, em vez de afastá-la: o que sobra no caminho do olho é o
círculo.

A gaveta entra pela esquerda em 220 ms na mesma curva das ondas, fecha no véu, no
`Esc` e ao navegar, e o foco entra nela ao abrir e volta para a engrenagem ao
fechar. **Clicar em "subir um áudio" não a fecha**, de propósito: o botão vira
"subindo o áudio…" e a recusa de formato aparece logo abaixo — os dois precisam
ficar visíveis onde eu cliquei. Ela some sozinha quando o upload termina e a rota
troca. A engrenagem só existe com a gravação parada, como os três links que ela
substituiu: navegar para fora no meio de uma gravação a mataria.

Em toda tela dessa tabela menos `/` e `/entrar`, `Marca` fica fixa no canto
superior esquerdo e leva a `/`. É **só o ponto terracota** — o nome do projeto
não informa nada a quem já está dentro dele. O ponto tem 16 px, mas o link tem
40 px: alvo de toque menor que isso não se acerta num celular, e este é um app
de celular.

### 11.1 O botão de gravar

`BotaoGravar` é **um nó do DOM só**, parado e gravando. Antes eram duas árvores
diferentes — a de gravar trocava a tela inteira pelo timer — e por isso não
havia o que transicionar entre elas, só um corte. Agora o círculo permanece e o
que muda é o que o cerca: parado, as portas de serviço;
gravando, o timer, o "salvo" e o "parar".

O palco é um grid de uma célula com tudo empilhado (`.palco > * { grid-area: 1/1 }`):

- **o halo** (`.brilho`) é um disco terracota atrás do botão, do mesmo tamanho:
  parado ele some por baixo, e ao respirar (escala 1 → 1,036 e raio 24 px →
  42 px, 3,75 s `ease-in-out alternate`) aparece só a borda. O círculo cresce
  como peça só, com o texto parado no meio. O `background` dele não é
  decoração: sombra externa recorta a própria border-box, e sem fundo o anel
  entre o botão e a borda do halo ficava sem sombra **e** sem fundo — um anel
  preto pulsando em volta do círculo;
- **o círculo** é o botão, 264 px (`min(72vw, 264px)`, o `min` só para não
  estourar aparelho estreito), terracota, texto branco de 18 px/500;
- **as ondas** são **três de cada lado**, num `<canvas>` absoluto. O bloco que o contém vira a própria
  célula do grid, ou seja a faixa vertical do círculo — é o que põe o eixo da
  onda no centro dele sem número mágico. Some e aparece por opacidade em 400 ms
  com `cubic-bezier(.16,1,.3,1)`;
- **o selo de REC** fica dentro do círculo, abaixo da pergunta, mas **fora** do
  `<button>`: o botão fica `disabled` durante a gravação e levaria o selo junto
  para fora do alcance de um leitor de tela. Entra deslizando 8 px, no mesmo
  tempo e na mesma curva das ondas.

**O círculo cresceu 20% e a respiração junto** — 220 px → 264 px, 4,5 s →
3,75 s, e a amplitude (escala e raio do halo) 20% maior nas duas pontas. **O
`72vw` não cresceu**, e isso é deliberado: ele não é tamanho, é guarda. Num
aparelho de 320 px é ele quem impede o círculo de encostar nas bordas; crescê-lo
junto poria o círculo em 82% da largura da tela. Com `min(72vw, 264px)`, aparelho
normal ganha os 20% e aparelho estreito continua protegido — lá o círculo
simplesmente não cresce.

Efeito colateral a conhecer: as ondas nascem na borda do círculo e correm até a
borda da tela (`percurso = largura / 2 - raio`), então **o círculo maior encurta
a corrida delas**. Num celular de 390 px o percurso cai de ~65 px para ~43 px. O
`raio` é medido em tempo de execução (`circulo.current.offsetWidth / 2`), então
nada quebra e `onda.ts` não muda — mas três camadas com 3 a 4,25 ciclos cada
nesse espaço ficam mais apertadas. Se incomodar, o conserto é sangrar `.palco`
para a largura inteira com margem negativa de `1.25rem`, recuperando 40 px.

**Canvas, e não SVG animado**, porque a onda segue o microfone a 60 quadros por
segundo e reconstruir um path do DOM nessa cadência engasga no celular — que é
onde este botão vive. O `AnalyserNode` sai do `MediaStream` que o `Gravador`
agora expõe em `faixa`, e **não se liga ao destino**: ligar devolveria o próprio
microfone pelo alto-falante, que é microfonia na cara de quem está falando. Sem
Web Audio disponível, `nivelSimulado()` mantém a onda viva com duas senoides de
períodos incomensuráveis.

O laço de `requestAnimationFrame` **só existe enquanto grava**; parado, o halo
respira em CSS puro e nada fica de pé. O `AudioContext` é fechado ao parar —
um contexto vivo segura hardware de áudio e conta como microfone em uso.

A matemática mora em `src/lib/onda.ts`, fora do componente: é a única parte
desenhável que dá para testar sem canvas, sem microfone e sem navegador
(`tests/onda.test.ts`). O nível é RMS e não pico — pico pula com qualquer
estalo —, passa por média móvel exponencial, e a amplitude fica entre 15 px e
25 px. `envelope()` zera nas duas pontas: encostada no círculo a linha seria
cortada por ele, e na ponta precisa sumir em vez de ser decepada.

`CAMADAS` são as três linhas: amplitude e opacidade decrescentes — uma
principal com duas acompanhando, não três iguais disputando a faixa. Os ciclos
(3,55 · 4,25 · 3) foram **escolhidos por busca**, não a olho: em razão simples
as três se realinhariam a cada poucos segundos e o conjunto piscaria como uma
onda só, grossa. A razão mais próxima de um racional curto fica a 0,083 dele, e
o teste "os ciclos não estão em razão simples" é o que impede alguém de mexer
nesses números sem perceber.

`prefers-reduced-motion` para o halo no estado médio e tira o deslize do selo.
A onda continua, porque ali ela não é enfeite: é o retorno de que o microfone
está ouvindo.

**O timer deixou de ser o herói.** Ele era `clamp(3rem, 16vw, 5rem)` porque era
o centro da tela; com o círculo nesse posto, ficou em 1,5 rem, tabular, no tom
de texto fraco. Continua na tela porque é informação real — quanto tempo eu já
falei.

### 11.2 Tokens de cor

Um lugar só, no topo de `src/app/globals.css`. Nada de cor literal em regra de
componente — quem precisa de uma variação usa `color-mix()` sobre o token.

| Token | Valor | Onde |
|---|---|---|
| `--fundo` | `#0d0d0d` | fundo da tela |
| `--fundo-alto` | `#1a1a1c` | cartão, campo, chip |
| `--texto` / `--texto-fraco` | `#ececec` / `#8a8a8f` | texto e texto secundário |
| `--linha` | `#2a2a2e` | borda |
| `--acento` | `#d65a31` | terracota: círculo, ondas, confirmar, destaque |
| `--sobre-acento` | `#ffffff` | texto **sobre** terracota — a única superfície que não usa `--texto` |
| `--glow` | `rgba(214,90,49,.55)` | o halo do botão de gravar |
| `--status` | `#ffffff` a 0,7 | texto de status e ícone |
| `--rec` | `#ff4d3d` | o ponto vermelho do selo de REC |
| `--circulo` | `min(72vw, 264px)` | diâmetro do botão de gravar |
| `--ok` | `#6aa84f` | o ponto de "salvo" |

`--fundo` e `--acento` mudaram de `#0f0f10` e `#d8613c` para os valores acima
quando o botão foi redesenhado; a diferença é pequena, e manter dois terracotas
quase iguais no mesmo sistema seria pior que trocar o antigo.

**Phronesis é escuro, e só.** O bloco `prefers-color-scheme: light` saiu: um
segundo tema é uma segunda tela para manter certa a cada mudança, e o botão de
gravar foi desenhado sobre `#0d0d0d` — halo terracota sobre papel é outro
efeito, não o mesmo mais claro. `:root` declara `color-scheme: dark`, sem o que
o navegador desenharia os controles nativos (input, select, checkbox, barra de
rolagem) no tema claro do sistema em cima do fundo escuro.

### 11.3 Tipografia

Duas fontes, uma por natureza de tela:

| | Fonte | Telas |
|---|---|---|
| ritual | **Nunito** | `/`, `/sessao/:id`, `/sessao/:id/revisar` |
| gestão | **Inter** | `/sessao/:id/transcricao`, `/sessoes`, `/entidades`, `/entrar` |

Ritual é o que eu faço todo dia — falar, esperar processar, revisar. Gestão é
manutenção, e a transcrição literal está com ela de propósito: é porta de
serviço, não parte do ritual.

**A regra é por rota, não por classe CSS** (`src/lib/tipografia.ts`,
`ehRitual`). Não é preferência: `Processando` e a `Revisao` ainda carregando
renderizam `<main className="leitura">`, a mesma classe da tela de transcrição.
Pendurar a fonte na classe daria Nunito à transcrição **e** trocaria a fonte da
revisão no meio do carregamento. A rota não tem essa colisão, e tela nova nasce
com a fonte certa sem ninguém lembrar de marcá-la. Mesma forma de `mostraMarca`,
e fixada igual, por `tests/tipografia.test.ts` — o `$` dos padrões é o que impede
`/sessao/x/transcricao` de casar com o do corredor.

`Tipografia` (client) põe a classe `.ritual` ou `.gestao` em volta de
`{children}` no layout raiz. `usePathname()` resolve no SSR, então a classe já
vem no HTML e não há troca de fonte no primeiro quadro.

As duas fontes vêm de `next/font/google` no layout raiz, como variáveis CSS
(`--fonte-ritual`, `--fonte-gestao`). Elas são **baixadas na build e servidas do
próprio domínio**: nenhuma requisição a terceiros em tempo de execução, nada a
acrescentar na fronteira de segurança, e nenhum salto de layout. O stack do
sistema, que era a fonte do `body`, virou `--sistema` e é o fallback das duas.

`/entidades` é a única janela para dentro do grafo — até ela existir, saber o
que tinha lá dentro exigia rodar Cypher por fora. Cada linha traz um `select` de
tipo (editável), um botão de renomear e um botão **perfil**, que abre os três
campos da migration 005; no topo, um campo para semear um nome novo. Procurar
duplicatas e rascunhar um perfil são botões, não coisas que acontecem ao abrir: a
camada de string é de graça, a que julga e a que escreve são chamadas de modelo,
e manutenção que cobra sozinha vira cobrança.
Ela não é painel da revisão de propósito — a revisão só vê as entidades da
sessão atual, e o orçamento dela é 60 s (visão §8).

**A volta ao início é a marca, no canto superior esquerdo.** `Marca` mora no
layout raiz — nenhuma tela nova nasce sem caminho de volta — e é ela que decide
onde não aparecer: em `/`, que já *é* o início e é a tela de gravar, onde nada
crônico entra (visão §6), e em `/entrar`, que é anterior à sessão. `mostraMarca()`
é a regra, e `tests/marca.test.ts` a fixa. Ela é `position: fixed`: numa revisão
longa ou numa lista grande de entidades, um "voltar" de rodapé só existe depois
de rolar a tela inteira. Os "voltar → `/`" que ficavam no fim de `Sessoes`,
`Entidades`, `Processando` e da falha da `Revisao` saíram, por duplicarem a
marca. Ficaram os dois que não são ela: o "voltar" da `Leitura`, que vai para
`/sessoes` (de onde se chega), e o "depois" no rodapé da `Revisao`, que é adiar
a revisão, não navegar.

`Processando` é quem dispara `finalizar`, uma vez só (`useRef`), depois de
garantir a fila vazia; faz o polling de 2 s e, ao ver `em_revisao`, troca a URL
por `/sessao/:id/revisar` com `replace` — voltar de um corredor já atravessado
não faz sentido, o botão de voltar tem que sair da sessão.

**A transcrição saiu da jornada.** Ela era a tela que a gravação abria, com o
texto inteiro e um link para revisar; agora é `/sessao/:id/transcricao`, sem
finalizar nada e sem redirecionar, alcançável pelo botão "transcrição" na lista
de sessões, ao lado de "reextrair". Serve para conferir o literal — um nome que o
STT grafou errado, um trecho que ele comeu. `destino()` em `Sessoes` manda cada
linha para onde ainda há o que fazer: revisão se há proposta esperando,
transcrição se o texto já está inteiro, processamento no resto.

**A home não avisa nada, e a lista avisa pela cor.** Havia um `ChipRecuperacao`
na tela de gravar que aparecia sempre que existia sessão aberta e, num dos seus
dois estados, cobrava: "sessão de 12 min esperando revisão". Cobrança na tela
onde eu passo o tempo é a forma de morte da visão §6, e o chip era o único
elemento crônico que restava ali. Ele saiu inteiro.

O que ficou no lugar é `jaRevisada(s)` em `Sessoes`: a linha de uma sessão
`confirmada` sai em `--ok`, o mesmo verde do ponto de "salvo" da gravação, e o
resto da lista fica no branco de `--texto`. Não há classe para "falta revisar" —
uma marca em cada linha não marca nada —, e a legenda vai no cabeçalho, senão a
cor é adivinhação. `confirmada` é o único estado terminal da máquina (seção 5), o
que faz o verde querer dizer exatamente uma coisa; `tests/sessoes-lista.test.ts`
fixa isso, porque pintar de verde uma sessão que ainda tem trabalho é pior que
não pintar nada.

O nome da porta acompanhou: "áudios" virou **"sessões"**, que é como a coisa se
chama no resto do sistema (`:Sessao`, `/sessoes`, `sessao_id`). Áudio é o
arquivo; sessão é o que eu abro ali.

## 12. Ambiente

`next build` passa a precisar de **rede**: `next/font/google` busca Inter e
Nunito na hora da build para servi-las do próprio domínio (§11.3). Em tempo de
execução não há requisição a terceiros.

```
NEO4J_QUERY_URL, NEO4J_USER, NEO4J_PASSWORD
R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
AI_GATEWAY_API_KEY        única chave de modelo — STT, extração, resolução, perfil, deduplicação
STT_MODEL                 opcional; padrão xai/grok-stt
EXTRACAO_MODEL            opcional; padrão zai/glm-5.3-flash
DUPLICATAS_MODEL          opcional; padrão zai/glm-5.3-flash
RESOLUCAO_MODEL           opcional; padrão igual ao da extração
PERFIL_MODEL              opcional; padrão igual ao da extração
AUTH_SECRET, ALLOWED_EMAIL
```

`env.ts` usa getters: a variável só é exigida quando alguém de fato precisa dela,
e a falta vira erro claro em vez de `undefined` silencioso.

Não há chave de provedor (`OPENAI_API_KEY`, `XAI_API_KEY`, `STT_API_KEY`,
`LLM_API_KEY`…) — seção 4.2. `tests/gateway.test.ts` também confere isso no
`.env.example`, para o arquivo não voltar a oferecer o que a arquitetura proíbe.

## 13. Verificação

- `pnpm test` — vitest sobre a lógica pura (chaves, manifest, estados, offsets,
  vocabulário, backoff, migrate, formatos de importação). Nenhuma credencial,
  nenhuma rede.
- `tests/audio.test.ts` — resolução de formato, incluindo o `.opus` do WhatsApp
  que chega com `File.type` vazio, e os limites de tamanho e duração.
- `tests/importacao.test.ts` — `transcreverBloco` busca o áudio na extensão que o
  manifest registrou, e continua caindo em `.webm` quando o campo não existe.
- `tests/gateway.test.ts` — guarda da porta única de modelo (seção 4.2): varre
  `src/` e `scripts/` atrás de import de pacote de provedor, endpoint de
  provedor escrito à mão e leitura de chave de provedor, e confere as
  dependências e o `.env.example`. Roda junto com `pnpm test`.
- `pnpm typecheck` — `tsc --noEmit`.
- **Bater numa rota do dev server pela porta da frente.** O middleware barra tudo
  sem cookie, e fora de produção `POST /api/auth/link` devolve o magic link **no
  corpo da resposta** (`route.ts`, a função `entregar`). Então: pede o link com o
  `ALLOWED_EMAIL`, segue o link para receber o cookie, e usa o cookie nas
  chamadas seguintes. É o que permite verificar rota de verdade sem forjar token
  e sem `pnpm build` — que aliás não pode rodar com o dev server de pé, porque os
  dois compartilham o `.next`.
- **Validar Cypher sem escrever nada:** prefixar a consulta com `EXPLAIN` faz o
  Aura planejar sem executar, o que pega erro de sintaxe e de schema contra o
  banco real. Foi assim que as escritas da slice 3 foram conferidas antes de
  existir dado para exercitá-las.
- `scripts/dev.ps1` (Windows; atalho **Phronesis** na área de trabalho, recriável
  por `scripts/atalho.ps1`) — sobe o `pnpm dev` do jeito certo: recusa-se a subir
  um segundo servidor quando a 3000 já responde (o Next escolheria outra porta e
  o CORS do bucket, que libera só a 3000, barraria o upload em silêncio), abre o
  navegador quando a porta atende e espelha a saída em `logs/dev-<data>.log` —
  o `2>&1` fica a cargo do `cmd`, porque redirecionado pelo PowerShell cada linha
  de stderr viraria um `NativeCommandError` no meio do log.
- `pnpm smoke` — o que os testes unitários não alcançam: credencial, assinatura,
  CORS e uma transcrição de verdade (usa um `.webm` já gravado do bucket, ou
  `SMOKE_AUDIO=<caminho>`). É o script que responde se o Gateway aceita
  webm/opus, se vêm timestamps por palavra e se o `keyterm` passa adiante.
- Qualidade de extração (slice 2) não tem teste automático: a avaliação é à mão,
  na tela de revisão, sessão real por sessão real. Ver `Specs/slice-2.md`.
- `tests/fusao.test.ts` — que fundir não apaga nó, que a grafia velha vira alias
  e que fundir duas vezes não refaz nada.
- `tests/duplicatas.test.ts` — o viés da camada de string: pega "Exxmed"/"Exx
  Med" e não trata "Ana"/"Ane" como duplicata.
- `tests/vocabulario-grafo.test.ts` — a união arquivo + grafo, e que grafo fora
  do ar não derruba transcrição.
- `tests/vocabulario-entrega.test.ts` — provedor sem mecanismo conhecido não
  recebe opção nenhuma.
- `tests/resolucao.test.ts` — **quando** o agente 2 é chamado (sessão sem
  ambiguidade não paga nada) e o que acontece quando ele não responde direito:
  resposta ruim vira dúvida, nunca atribuição errada em silêncio.
- `tests/referencias.test.ts` — proposta do formato antigo ainda abre na revisão
  (critério 10 da slice 4).
- `tests/perfil.test.ts` — que o agente 3 **não escreve**, e que o teto de 300
  caracteres é cortado no servidor e não só na tela.
- Qualidade da resolução (slice 4) também não tem teste automático, e pelo mesmo
  motivo. A diferença é que agora existe um caso concreto de que eu sei a
  resposta: a sessão que fala do Rapha e do Raffa.
- O que o confirmar escreveu agora se vê em `/entidades`. Para o detalhe do
  átomo ainda é Cypher à mão no console do Aura:

  ```cypher
  MATCH (s:Sessao)-[:GEROU]->(a:Atomo)-[:SOBRE]->(e:Entidade)
  RETURN a.tipo, a.texto, e.nome, a.inicios_s, a.prompt_version, a.modelo
  ```

  E as marcas de perfil que a slice 4 grava (critério 6):

  ```cypher
  MATCH (a:Atomo)-[p:PERFILA]->(e:Entidade)
  RETURN e.nome, p.campo, a.texto, a.valido_em ORDER BY e.nome, p.campo
  ```

## 14. Limites conhecidos

- **O botão de gravar foi verificado por compilação e teste, não por olho.**
  `tests/onda.test.ts` cobre a matemática da onda, e `tsc` mais `next build`
  passam; ninguém abriu a tela e olhou o halo respirar. Não há navegador
  automatizado no projeto, e o `middleware` exige cookie para chegar em `/`.
- **Entrega do magic link**: não há provedor de e-mail configurado. O link sai no
  log do servidor e, fora de produção, no corpo da resposta. Único ponto a
  mexer: a função `entregar` em `src/app/api/auth/link/route.ts`.
- **`finalizarSessao` espera no máximo 45 s** pelos blocos pendentes; passando
  disso a sessão vai para `erro` com a lista do que faltou. O áudio fica intacto
  e o retry é manual.
- **`config/vocabulario.txt`** ainda tem só os três nomes de exemplo. Desde a
  slice 3 ele não é mais a lista inteira — as entidades do grafo entram junto —
  mas continua sendo o único jeito de ensinar um nome **antes** de falá-lo pela
  primeira vez, que é justamente quando o STT mais erra.
- **A importação aceita `opus`, `ogg`, `m4a`, `mp3`, `wav` e `webm`** — a lista
  está em `audio.ts`. `.mp4` ficou de fora de propósito: quase sempre é vídeo, e
  o pipeline manda os bytes crus para o STT. Teto de 25 MB e 30 min.
- **Não foi conferido se o `xai/grok-stt` aceita Ogg/Opus, M4A, MP3 e WAV.** A
  lista de importação promete os cinco; até agora ele só recebeu `audio/webm`.
  Se recusar algum, a saída seria converter, e conversão de áudio não cabe em
  function serverless — a alternativa real é estreitar a lista. Descobre-se no
  primeiro arquivo de cada tipo.
- **Sessão importada não se distingue de gravada no grafo.** `:Sessao` não tem
  `origem`; quem sabe é o `ext` no manifest, no R2. Acrescentar o campo é
  migration nova, e nada hoje lê essa distinção.
- **O "menos de 60 s" da revisão continua sem medição.** A tela já foi usada em
  sessões reais e o caminho inteiro fecha, mas ninguém cronometrou uma revisão de
  sessão de 15 min.
- **Editar não muda a procedência.** Reescrever o texto de um átomo mantém os
  offsets do trecho original — é o certo, mas quer dizer que um texto muito
  editado aponta para um áudio que já não o sustenta palavra por palavra.
- **Nome descritivo não é pronome.** "meu pai", "minha mãe" e "meu chefe" passam
  pela lista e viram nó com esse nome. É defensável — o referente é estável — e
  desde a slice 3 tem conserto: renomear em `/entidades` deixa a grafia velha
  como alias, então o nó vira o nome de verdade sem perder os átomos e sem "meu
  pai" recriar um segundo nó depois.
- **A lista de pronomes é fechada e em português.** Ela pega o que apareceu até
  agora; um placeholder que eu use e não esteja lá passa direto e vira nó. O
  conserto é acrescentar à lista em `texto.ts`.
- **Não há como desfazer uma fusão.** Migrar as arestas de volta exigiria saber
  quais eram de quem, e isso não é gravado. O que protege é a fusão nunca ser
  automática: o modelo propõe, eu confirmo. Recusar, sim, é reversível — a
  aresta `:DISTINTA_DE` se apaga à mão no console.
- **Sem átomo, o julgamento de duplicata tende ao NÃO.** Medido: um par de
  entidades semeadas com grafias equivalentes ("ZZTesteFusao" / "ZZ Teste
  Fusao") foi encontrado pela camada de string e **recusado** pelo modelo — sem
  átomo nenhum ele não tem contexto, e o prompt manda responder NÃO na dúvida.
  É o viés certo, mas quer dizer que **duplicata entre entidades semeadas não é
  proposta**; para essas, fundir é ir direto no par. Duplicata vinda de sessões
  reais tem os textos dos átomos como contexto, que é o caso para o qual o
  prompt foi escrito.
- **A qualidade da proposta em caso real não foi medida.** O grafo não tem
  duplicata vinda de sessão, então `duplicatas-1` nunca julgou um par com
  contexto de verdade. A mecânica, sim, está validada ponta a ponta.
- **Fundir não é atômico.** São quatro consultas pela Query API, sem transação
  entre elas. Cair no meio deixa as arestas migradas e o perdedor sem alias — um
  nó de zero átomos aparecendo na lista. **Refazer a fusão cura**: a segunda
  passada não acha aresta para migrar e marca o alias.
- **Não há como desfazer um confirmar.** `confirmada` não tem transição de saída
  e nada apaga átomo (regra 6). Corrigir depois de confirmar depende de edição
  no grafo, que não existe nesta slice.
- **A extração roda no mesmo `waitUntil` da transcrição.** Em dev isso é o mesmo
  processo: fechar a janela do servidor no meio mata o job e a sessão fica em
  `extraindo`. O retry é chamar `/finalizar` de novo.
- **A resolução rodou contra um grafo com entidades, uma vez.** As duas
  entidades nasceram às 13:28:17 e a sessão seguinte só começou às 13:28:37, então
  a extração dela encontrou as duas já lá e o caminho de "já conhecida"
  funcionou de verdade — o segundo confirmar reaproveitou os nós em vez de criar
  novos. O que continua sem uso é o grafo **cheio**: com duas entidades, nada
  disputa nome parecido.
- **`zai/glm-5.3-flash` é modelo de raciocínio.** Ele chegou a gastar 1720 tokens
  pensando para 122 de texto, daí `maxOutputTokens: 8000` e a segunda tentativa
  automática. Trocar é `EXTRACAO_MODEL`, sem tocar em código.
- **O alvo de 10 a 20 átomos por 15 min ainda é aposta.** O prompt está em
  `extracao-5` e as sessões julgadas até agora são curtas; a primeira sessão longa
  confirma ou derruba o número.
- **Transcrição longa pode truncar a resposta da extração.** Não há corte em
  pedaços nem limite de saída declarado; JSON truncado vira `ExtracaoError` na
  primeira sessão em que acontecer.
- **Não haverá medida automática da qualidade da extração.** A avaliação é à mão,
  na tela de revisão; sem gabarito rotulado nem percentual de recall, regressão de
  prompt não aparece em teste — só na revisão seguinte.
- **O `keyterm` vale só para o provedor de hoje.** Medido em 2026-08-31 e
  funciona no `xai/grok-stt` (§4.4). Desde a slice 3 o nome da opção é um mapa
  por provedor em `modelos.ts`, com **silêncio como padrão** para provedor
  desconhecido — trocar `STT_MODEL` por um provedor fora do mapa faz o
  vocabulário não ser mandado, e não derruba a transcrição. Mas continua sendo
  verdade que só um provedor foi medido.
- **Deduplicação de átomo não existe** (slice 5). A de **entidade** ficou pronta
  na slice 3, mas nada compara um átomo novo com os que já estão no grafo: dizer
  a mesma coisa em duas sessões cria dois átomos.
- **Sessão sem ambiguidade nenhuma não marca perfil.** Quem aponta o que é
  informação de perfil é o agente 2, e ele só é chamado quando alguma menção
  precisa de julgamento (4.8) — é o critério 5 da spec, e é o que faz uma sessão
  limpa não custar nada. A consequência é real e vale registrar: se eu falo do
  Rapha numa sessão em que nenhum nome é ambíguo, "o Rapha sabe produzir evento"
  **não** vira `:PERFILA`, e o perfil dele não se mantém sozinho. Enquanto o
  grafo não tiver nomes parecidos, o agente 3 vive de perfil escrito à mão. A
  saída, se incomodar, é chamar o agente também quando houver átomo com cara de
  perfil — o que troca "sessão limpa é de graça" por "perfil acumula sozinho".
- **A resolução nunca julgou um homófono de verdade.** O grafo tem `Isinha` e
  `eu`; nada disputa nome parecido, então o `resolucao-1` só rodou contra teste.
  O caso concreto de que eu sei a resposta — a sessão com o Rapha e o Raffa —
  depende dos dois estarem **cadastrados antes da primeira menção**.
- **O agente 2 só enxerga os candidatos da menção, não o grafo inteiro.** Quem
  não casa por chave nem se parece por string nunca chega ao prompt: um apelido
  sem nenhuma letra em comum com o nome do nó ("Bidu" para "Roberto") vira
  entidade nova, e o conserto é fundir depois em `/entidades`. É deliberado —
  mandar o catálogo todo seria pagar por texto que não muda resposta nenhuma —,
  mas é um limite, não um detalhe. O que a barra pesquisável faz é baratear o
  conserto: o grafo inteiro está a duas letras de distância dentro do próprio
  átomo, então "Bidu" vira "Roberto" na revisão em vez de virar nó e fusão.
- **A revisão carrega o grafo inteiro para buscar nele.** `GET /api/entidades`
  não tem `q`, nem limite, nem paginação, e não há índice de texto sobre `nome` —
  a busca é no cliente, sobre a lista toda. Num grafo de dezenas de entidades
  isso é mais rápido que ida ao servidor por tecla; em milhares, deixa de ser, e
  a saída é uma rota de busca com uma migration de índice atrás dela.
- **Não dá para retomar uma gravação interrompida.** O botão "retomar" morava no
  chip da home, e o chip saiu para tirar a cobrança da tela de gravar (11) — os
  dois verbos viviam no mesmo cartão, então perder um custou o outro. O
  maquinário dele foi apagado junto (§5, §6.2): nada ficou como código morto
  esperando uma tela que talvez nunca volte. O que **não** se perde: os blocos já
  subidos estão no R2, e a sessão interrompida continua na lista de sessões
  levando a `/sessao/:id`, onde `Processando` finaliza e transcreve o que
  existe — perde-se emendar fala nova na mesma sessão, não se perde fala. Se um
  dia incomodar, o caminho é um link `retomar` na linha da lista apontando para
  `/?retomar=<id>`, e as três linhas de `proximoIndice` se reescrevem.
- **Não há como separar um nó que já conflacionou duas pessoas.** A máquina da
  slice 3 junta, não divide, e mover átomo entre entidades não existe. É por isso
  que dois nomes homófonos têm que ser cadastrados em `/entidades` **antes** da
  primeira menção: depois de conflacionados, não há caminho de volta.
- **A marca de perfil não é editável na revisão.** Ela aparece no átomo e some se
  eu rejeitar o átomo ou desmarcar a entidade, mas não dá para trocar o campo nem
  apontar outra entidade — é a única das três relações do átomo que continua sem
  controle na tela, agora que `menciona` ganhou o dele (4.7). Se o agente 2 errar o campo com
  frequência, o que se ajusta é o `resolucao-1`.
- **O perfil realimenta a resolução, e isso é o risco declarado da slice.** O
  agente 2 lê o perfil para desambiguar; um perfil errado contamina toda
  atribuição futura, e átomo atribuído por engano vira evidência daquele mesmo
  perfil. As travas são o agente 3 nunca escrever, o proposto aparecer ao lado do
  atual e nunca por cima, e a escrita passar só por `POST /api/entidades/perfil`.
  Nenhuma delas impede eu mesmo aprovar um rascunho ruim depressa.
- `scripts/smoke.ts` roda solto no node e não importa de `src/`, então repete o
  id de modelo padrão. O teste "o smoke usa o mesmo modelo padrão que a lib"
  existe para as duas cópias não divergirem.

---

## Manutenção deste arquivo

Documento desatualizado é pior que documento nenhum: ele mente com autoridade.

Atualize `ARCHITECTURE.md` **no mesmo commit** da mudança sempre que mexer em:

- fluxo de dado ou ordem dos passos (seções 3 e 4);
- contrato de rota, formato de payload ou chave do R2 (seções 9 e 10);
- tipo do domínio em `src/lib/tipos.ts`, ou schema do grafo (seção 8);
- máquina de estados, trava de idempotência ou concorrência (seções 5 e 6);
- dependência externa, provedor ou variável de ambiente (seções 4.2 e 12);
- fronteira de segurança: auth, middleware, presign, CORS (seção 7);
- módulo novo, removido ou com responsabilidade trocada (seção 2);
- limite conhecido resolvido ou descoberto (seção 14).

Mudança que não toca nada disso — refatoração interna, ajuste de texto na tela,
teste novo sobre comportamento já descrito — não pede atualização.

Ao fechar uma slice, revise o arquivo inteiro: o cabeçalho declara qual slice
está no ar e o que ainda não existe.
