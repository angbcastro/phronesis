# Arquitetura

Como o Phronesis está construído hoje. Descreve o **sistema que existe**, não o
que está planejado — para o produto ver `Specs/visao.md`, para as regras
invioláveis `CLAUDE.md`, para o escopo da fatia atual `Specs/slice-4.8.md`.

> **Este arquivo acompanha o código.** Toda mudança que altere fluxo, contrato,
> layout de dado, dependência externa ou fronteira de segurança atualiza este
> arquivo no mesmo commit. Ver "Manutenção deste arquivo" no fim.

**Estado: slice 2 fechada e validada; slices 3 (higiene do grafo), 4
(identidade por contexto), 4.5 (o grafo ganha vetor), 4.6 (o prompt aprende
com a revisão), 4.7 (o painel dos agentes) e 4.8 (a extração acompanha a fala)
construídas.**
Gravar (ou importar), subir, transcrever, extrair, revisar, confirmar. A
extração acontece **durante** a gravação, janela a janela, e quando eu paro
sobra só a janela do fim; a proposta vai para `extracao.json` e a sessão para
`em_revisao` (seções 4.6 e 5); o confirmar da revisão grava `:Atomo` e
`:Entidade` no Neo4j (seções 4.7 e 8). Sessões reais já foram confirmadas e os
átomos conferidos no banco, com âncoras, `prompt_version` e `modelo`.

**O grafo agora cuida do próprio nome** (seção 8.2). O vocabulário do STT é
gerado das entidades do grafo, em união com `config/vocabulario.txt`; e
`/entidades` é onde eu vejo o que entrou e conserto o que entrou torto —
fundindo duas grafias da mesma coisa, ou dando nome a quem ficou como "meu pai".
**Fundir não apaga: cria alias**, e é isso que faz a grafia morta resolver para
o vencedor na sessão seguinte em vez de renascer como nó novo.

**O sistema descobre de quem eu estou falando pelo contexto, e não pela grafia
do nome** (seções 4.8 e 8.3). "Raffa" e "Rapha" são o mesmo som: o STT escreve
uma grafia só para os dois, e a grafia carrega **zero** sinal sobre quem é. Por
isso são **dois agentes e não um** — o `extracao-6` extrai e devolve o nome cru,
e o `resolucao-2` atribui cada menção a um nó, lendo os três campos de perfil da
entidade. Dúvida **destaca, não trava**: a revisão marca o átomo, mostra o motivo
e o confirmar continua liberado. Sessão em que nenhuma menção é ambígua não
chama o agente 2 e não paga nada.

**A jornada não passa pela transcrição.** Parar de falar leva à tela de
processamento, e dela a revisão abre sozinha quando a proposta fica pronta. O
texto literal é porta de serviço: mora em `/sessao/:id/transcricao` e se alcança
pelo botão "transcrição" na lista de sessões (seção 11). Ler quinze minutos de
transcrição no meio do caminho é o atrito que mata o ritual — a transcrição é
insumo do extrator, não coisa que eu leio todo dia.

**E o grafo passou a comparar significado, não só letra** (seções 4.10 e 8.4).
`:Atomo` e `:Entidade` carregam um vetor de 1536 dimensões, dois índices
vetoriais os indexam, e a resolução de identidade ganhou **duas camadas de
candidato que enxergam sentido**: uma que compara o átomo com o perfil escrito
de uma entidade, e outra em que os átomos vizinhos votam em quem eles já são.
As duas cobrem buracos opostos — a primeira pega quem tem perfil e nenhum átomo,
a segunda pega quem tem átomos e nenhum perfil — e nenhuma delas substitui a
grafia: são **aditivas**, com teto e piso, e uma sessão sem ambiguidade continua
não pagando nada. A camada dos vizinhos herda atribuição passada, e o que a torna
aceitável é que a revisão mostra **quais** átomos elegeram cada sugestão.

**O caminho automático aguenta o Gateway dizer "devagar"** (seções 4.2.1 e 5.3).
O free tier limita por conta, não por modelo — medido em 02/09, com o mesmo
limite derrubando os dois modelos de STT em disputa —, e uma sessão de 15 min são
30 blocos. STT e extração agora esperam a janela passar em vez de morrer nela, e
a desistência diz quando a causa foi pressa e não defeito. Na mesma medição,
trocar o STT por um modelo que escreve melhor foi **recusado**: o candidato não
tem canal de vocabulário nenhum, e nome próprio errado custa mais que prosa
torta neste sistema.

**E a correção que eu faço na revisão parou de se perder** (seções 4.11 e 4.12).
Até aqui, rejeitar um átomo, editar um texto ou trocar um tipo morria no clique
de confirmar — o servidor até contava os rejeitados, só para descartar o número
na resposta. Agora o confirmar apura, **depois** de gravar no grafo e fora do
caminho da resposta, o que a proposta dizia contra o que eu aprovei, e guarda o
resultado no R2. Nenhum gesto novo na revisão, nenhum node novo, nenhuma
migration: o grafo é o único lugar que essa captura não toca.

Acumulada, ela vira material: em `/calibracao` eu vejo o que corrigi, peço ao
`calibracao-1` um rascunho de regra, edito, e aprovo. **A regra aprovada entra
no prompt da próxima extração sem deploy** — e sem regra nenhuma o prompt sai
byte a byte igual ao de antes desta fatia, o que faz dela um no-op até o meu
primeiro toque. Verificado por medição, não por confiança: 21 correções reais em
5 sessões, e um terço delas mostrou que o maior erro do pipeline não é o
extrator, é o STT ouvindo nome próprio errado (§14).

**E os sete agentes ganharam rosto** (seção 4.13). `/agentes` desenha o fluxo
inteiro — STT, extração, resolução, calibração, perfil, duplicatas, embedding, e
o único nó humano no meio deles —, e clicar numa caixa abre o prompt e o modelo
daquele agente, editáveis, valendo na próxima execução e **sem deploy**. O
mecanismo é o da 4.6 generalizado: texto no R2, snapshot imutável por hash,
sufixo no `prompt_version`. Sem override nenhum, todo agente sai byte a byte
igual ao de antes desta fatia, e é `tests/agentes.test.ts` quem cobra isso — mais
a varredura que impede um agente novo de nascer fora do painel.

**E a extração deixou de ser um evento no fim: virou um processo** (seções 4.1,
4.6 e 6). A transcrição já era por bloco de 30 s desde a slice 1, mas tudo o que
vem depois dela esperava eu parar de falar — uma chamada de raciocínio com a
transcrição inteira, mais a resolução, mais os embeddings. Era isso que fazia a
espera entre parar e revisar durar um a dois minutos, contra os "poucos
segundos" que a visão §3 promete. Agora, **a cada quatro blocos transcritos uma
janela de 2 min fecha durante a própria gravação**: extrai, resolve, e soma os
átomos ao acumulado em `parcial.json`. Quando eu paro, sobra a janela do fim.

A janela vê o que as anteriores propuseram e **estende** um átomo em vez de
duplicá-lo — inclusive o `ROTINA`, que é no máximo um por sessão. É esse
mecanismo, e não uma passada de costura no fim, que segura o volume da lista.
`extracao-6` é a mesma `INSTRUCOES_BASE` da 4.7, byte a byte, mais um bloco
injetado; e numa sessão que cabe numa janela só — arquivo importado, gravação
curta — o bloco some e o prompt sai idêntico ao de antes desta fatia.

O que ainda não existe: busca, tela Perguntar, `:Foco`, as 2-4 perguntas do
ritual, as relações entre átomos (`:ATUALIZA`, `:CONTRADIZ`, `:CONFIRMA`) e a
deduplicação de **átomo** — dizer a mesma coisa em duas sessões ainda cria dois.
A 4.6 está construída inteira — captura, tela, regras e o `calibracao-1`. O que
falta é **uso**: nenhuma regra foi aprovada ainda, e enquanto não for, o
`extracao-6` continua saindo byte a byte igual ao de antes dela.
Tudo slice 5, e tudo dependente de material acumulado: uma pergunta boa precisa
saber de quem se está falando, que é o que a slice 4 entrega, e achar o que já foi
dito sem varrer o grafo inteiro, que é o que a 4.5 entrega.

---

## 1. Topologia

```
┌─ navegador ─────────────┐   ┌─ Vercel ────────────┐   ┌─ serviços ───────────┐
│ MediaRecorder           │   │ middleware (auth)   │   │ Cloudflare R2        │
│ IndexedDB (blocos)      │   │ App Router /api/*   │   │  áudio + JSON        │
│ fila de upload          │   │ waitUntil (STT)     │   │ Neo4j Aura (HTTP)    │
│ React (9 telas)         │   │                     │   │  :Sessao + conteúdo  │
└──────────┬──────────────┘   └──────────┬──────────┘   │ Vercel AI Gateway    │
           │                             │              │  → os sete agentes   │
           │  PUT presigned (áudio)      │              └──────────────────────┘
           └─────────────────────────────┴──────────────▶ R2
```

Três planos de dado, cada um com uma responsabilidade única:

| Onde | O que guarda | Por quê |
|---|---|---|
| IndexedDB (navegador) | bloco de áudio até o PUT confirmar | fechar a aba no meio da gravação não pode perder fala |
| Cloudflare R2 | áudio, manifest, transcrição de bloco, transcrição final, proposta parcial e final | blob e texto grande não pertencem ao grafo |
| Neo4j Aura | `:Sessao` com estado e **chaves** do R2; `:Atomo` e `:Entidade` a partir do confirmar | o grafo é para relação e afirmação, não para blob nem para texto corrido |

O áudio **nunca** atravessa uma function da Vercel (regra inviolável 1): o
navegador pede uma URL presigned e faz `PUT` direto no bucket.

## 2. Mapa dos módulos

```
src/lib/          servidor — exceto os módulos puros marcados (client), que não
                  leem credencial nem rede e por isso o navegador pode importar
  env.ts          leitura de variável de ambiente, falha cedo se faltar
  rede.ts         retry de conexão: o que dá para repetir sem duplicar efeito
  limite.ts       o rate limit do Gateway: reconhecer e esperar passar
  neo4j.ts        HTTP Query API (nunca driver Bolt)
  fusao.ts        fundir, renomear, recusar — a escrita de higiene no grafo
  duplicatas.ts   quem parece ser a mesma coisa: string + o modelo, só propõem
  sessoes.ts      repositório de :Sessao (criar, buscar, atualizar com guarda)
  r2.ts           S3 SigV4 via aws4fetch: get/put/head, presign, PUT condicional
  chaves.ts       layout do R2 num lugar só + validação de id (barra path traversal)
  manifest.ts     verdade sobre quais blocos existem; read-modify-write por etag
  estados.ts      máquina de estados da sessão e as predicadas de leitura
  modelos.ts      porta única de modelo: todo LLM sai pelo Vercel AI Gateway,
                  e o diagnóstico de resposta vazia que os três agentes usam
  embedding.ts    a porta do vetor: texto → embedding, e a string canônica da
                  entidade mais o hash dela. Não fala com o Neo4j
  stt.ts          transcrição — pede o modelo a modelos.ts
  vocabulario.ts  nomes próprios → keyterms do STT
  transcricao.ts  offsets absolutos, prefixo contíguo, concatenação — e o
                  caminho de volta, do segundo para o bloco que o contém  (client)
  texto.ts        normalização, nome_normalizado e lista de pronomes       (client)
  extracao.ts     átomos a partir de uma janela: prompt, JSON estrito, procedência
                  — e o bloco que diz de que minutos ela é e o que já foi proposto
  janela.ts       a unidade de extração: fatiar o manifest, reivindicar a janela,
                  somar o que ela produziu ao acumulado. NÃO fala com modelo
  offsets.ts      trecho do modelo → segundo do áudio (modelo não dá timestamp)
  resolucao.ts    agente 2: de quem eu estava falando — atribui menção a menção,
                  com as quatro camadas de candidato, o teto e os pisos
  perfil.ts       os três campos de perfil: ler, gravar, e o agente 3 que rascunha
  entidades.ts    catálogo do grafo + a visão agregada da revisão; e o vetor da
                  entidade: refresh por hash e as duas consultas de vizinhança
  correcoes.ts    o diff entre o que a proposta dizia e o que eu aprovei:
                  apuração, chaves e a fusão no índice — puro, sem rede
  calibracao.ts   onde as correções vivem (correcoes.json por sessão e o índice
                  acumulado, por etag) e o agente 4, que rascunha regra e não
                  escreve nada
  regras.ts       as regras aprovadas: o hash que vira sufixo de prompt_version,
                  a leitura tolerante e o snapshot imutável — e o hashDeTexto
                  que o override também usa
  overrides.ts    o prompt e o modelo que eu editei na tela: leitura tolerante,
                  snapshot imutável por hash, e o carimbo. Não sabe quais
                  agentes existem — recebe o id e a base de quem chama
  agentes.ts      o registro dos sete e o desenho do fluxo. Fica ACIMA dos
                  agentes: importa os cinco prompts, e nenhum deles o importa
  referencias.ts  lê os dois formatos de proposta (antes e depois da 4)  (client)
  catalogo.ts     busca de entidade no navegador: trecho, acento, alias (client)
  tipografia.ts   qual tela é ritual e qual é gestão — a regra da fonte  (client)
  atomos.ts       escreve :Atomo, :Entidade e :PERFILA — só o confirmar chama;
                  e embute o átomo depois de gravá-lo, nunca antes
  pipeline.ts     transcrever bloco / avançar janelas / finalizar sessão
                  (o orquestrador)
  auth.ts         magic link HMAC, cookie httpOnly
  backoff.ts      backoff exponencial com jitter                          (client)
  audio.ts        formatos aceitos na importação, limites de arquivo       (client)
  onda.ts         a matemática da onda do botão de gravar — nível, envelope (client)
  rotas.ts        validação de parâmetro e o 502 de infraestrutura, compartilhados
                  pelas rotas
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
                  Calibracao (o que eu já corrigi, com o áudio à mão),
                  Agentes (o fluxo desenhado, e o prompt e o modelo de cada um),
                  SeletorEntidade (a barra pesquisável de entidade, nos dois
                    lugares da revisão),
                  Leitura (a transcrição literal — porta de serviço),
                  Sessoes (lista de sessões — e a cor que diz o que falta
                    revisar), Entidades (higiene do grafo)
src/app/api/      29 rotas em seis famílias — sessão, entidade, calibração,
                  agentes, átomos e as 2 de auth (seção 10)
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
                                      waitUntil: transcrever ─────▶ STT
                                                                    chunk_NNN.json
                                          e, na sequência,
                                        avancarJanelas: a cada 4
                                        blocos transcritos, extrai
                                        + resolve a janela ───────▶ Gateway
                                                                    parcial.json
  apaga do IndexedDB                  (só depois do PUT confirmado)
parar ──▶ /sessao/:id            (Processando: não mostra a transcrição)
  espera a fila esvaziar
  POST /finalizar ──────────────────▶ status = finalizando, responde na hora
                                      waitUntil: espera pendentes,
                                      concatena offsets ──────────▶ transcricao.json
                                      status = transcrito
                                      waitUntil: fecha a janela do
                                      fim e monta a proposta ─────▶ extracao.json
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

### 4.1 Paralela, não no fim — e desde a 4.8 isso vale para a extração também

Cada bloco é transcrito assim que sobe, disparado por `waitUntil` na rota
`/pronto` — o cliente não espera pelo STT, ele volta a gravar. Quando a gravação
de 15 minutos para, só falta o último bloco. É isso que faz o sistema parecer
rápido (aceite 5).

**Isso resolvia metade do problema.** A transcrição acompanhava a fala desde a
slice 1, mas tudo o que vem depois dela — a extração sobre a transcrição
inteira, a resolução, os embeddings — esperava eu parar. Numa sessão de 15 min
era uma chamada de raciocínio com ~15 mil caracteres de entrada, e ela sozinha
respondia por quase toda a espera entre parar de falar e revisar.

Na mesma rota `/pronto`, encadeado no mesmo `waitUntil`, roda agora
`avancarJanelas`: a cada `JANELA_BLOCOS` (4) blocos transcritos, uma janela de
2 minutos é extraída e resolvida, e os átomos dela vão para `parcial.json`
(§4.6). Quando eu paro, `/finalizar` fecha a janela do fim — no máximo 3 blocos
— e monta a proposta a partir do acumulado.

Três consequências que valem estar escritas:

- **A chamada mais cara deixou de acontecer logo depois de 30 chamadas de STT**,
  que era exatamente o pior momento para o rate limit da conta (§5.3). Agora ela
  é oito chamadas pequenas espalhadas pelos 15 minutos, e durante a gravação
  esperar o limite passar é de graça — não há prazo a estourar.
- **A resposta da extração parou de poder truncar.** Nenhuma janela chega perto
  de `maxOutputTokens: 8000`; era limite conhecido do §14 e saiu de lá.
- **O caminho de uma janela só continua existindo, e é o mesmo código.** Arquivo
  importado (um bloco), gravação de menos de dois minutos, e o fallback de
  quando alguma janela não fecha: todos passam por uma janela que se declara a
  sessão inteira, com o prompt saindo byte a byte igual ao de antes da 4.8.

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
"uma chave, um lugar para ver custo" a cada agente novo que entra.

**Hoje passam por aqui sete consumidores**, cada um com sua função em
`modelos.ts` e sua variável de ambiente (§12), e todos os sete com caixa no
painel de `/agentes` (§4.13):

| Função | Agente | Padrão |
|---|---|---|
| `modeloStt()` | STT | `xai/grok-stt` |
| `modeloExtracao()` | `extracao-6` | `zai/glm-5.3-flash` |
| `modeloResolucao()` | `resolucao-2` | o da extração |
| `modeloPerfil()` | `perfil-1` | o da extração |
| `modeloCalibracao()` | `calibracao-1` | o da extração |
| `modeloDuplicatas()` | `duplicatas-1` | `zai/glm-5.3-flash` |
| `modeloEmbedding()` | embedding | `openai/text-embedding-3-small` |

A deduplicação de **entidade** chegou na slice 3 e é o `duplicatas-1`. O que
continua não existindo é a deduplicação de **átomo** (slice 5): dizer a mesma
coisa em duas sessões ainda cria dois. A porta por onde ela vai passar é esta, e
`tests/agentes.test.ts` é a guarda que impede um agente oitavo de nascer por
fora dela.

### 4.2.1 Por que o STT é o `xai/grok-stt`, e não um melhor de texto

Medido em 2026-08-31, com o **mesmo bloco real** de 30 s para todos, pelo
Gateway. A pergunta não é quem transcreve melhor: é quem devolve **tempo**.

| Modelo | Tempo | Texto | Custo/30 s |
|---|---|---|---|
| `xai/grok-stt` | **palavra** — 64 segmentos de 1 palavra (`1.802–2.002 "Vamos"`) | pior dos cinco | $0,0008 |
| `openai/whisper-1` | frase — 4 segmentos de ~8 s | bom | $0,0029 |
| `google/gemini-3.5-transcribe` | **nenhum** | melhor dos cinco | $0,0014 |
| `openai/gpt-4o-transcribe` | **nenhum** | bom | $0,0015 |
| `openai/gpt-4o-mini-transcribe` | **nenhum** | bom | $0,0008 |

`deepgram/*`, `assemblyai/*`, `elevenlabs/*`, `groq/whisper-*`,
`mistral/voxtral-*`, `fal/wizper`, `revai/*` e `azure/whisper`: `Model not
found`. Não estão neste Gateway — e é de **Deepgram** que vem o nome `keyterm`
usado em `stt.ts`, o que explica a opção estar lá.

**Sem tempo não há procedência**, que a visão §4 lista como necessidade: sem
ele todo átomo nasce com `inicios_s`, `fins_s` e `ancoras` vazios, o player da
revisão some de todos os itens e "escuto antes de aprovar" deixa de existir.
Isso elimina os três modelos sem timestamp por melhor que seja o texto deles.

> **A tabela tinha uma sexta coluna, "Rate limit", que dizia `—` para o
> `xai/grok-stt` e eliminava o `whisper-1`. Ela saiu porque é falsa** — ver
> "O rate limit é da conta", abaixo. O limite não escolhe modelo.

O custo declarado: no bloco medido o grok escreveu "Vamos testar se **a
secretária** está funcionando" onde os outros três ouviram "testar se **isso
aqui tá** funcionando". O bloco é um teste de microfone de 24/08, e as sessões
reais transcritas por ele produziram extração boa — mas transcrição estranha
numa sessão de verdade tem aqui a primeira suspeita.

#### Abrir mão do timestamp para ganhar texto: medido e recusado (2026-09-02)

A pergunta voltou, e desta vez com a proposta certa: **trocar procedência por
qualidade de transcrição**, indo para o `google/gemini-3.5-transcribe`. A
medição usou um bloco real de sessão importada (`mtkwtbpa…`) em vez do teste de
microfone, e o resultado inverteu a decisão pelo motivo oposto ao esperado.

O Gemini de fato escreve melhor. No mesmo bloco:

| | `grok-stt` | `gemini-3.5-transcribe` |
|---|---|---|
| "eu me apliquei hoje" | "eu me **apoiou**" — erra nas duas rodadas | **acerta** |
| o nome "Bearing Founders" | "**Bejewel** Founders" sem lista; certo **com** lista | **acerta sozinho**, nas duas ocorrências |
| "Phronesis" | **acerta** | "**fronesis**" |
| "na Adapta" | erra ("na data") | erra ("na data") |

**Mas ele não tem por onde receber o vocabulário.** Testados cinco nomes de
opção — `keyterm`, `phrases`, `speechContexts`, `vocabulary` e `prompt` —, os
cinco devolvem saída **byte a byte idêntica** à chamada sem opção nenhuma, e o
AI SDK não emite um `warning` sequer. Não é nome errado: é canal inexistente,
com falha silenciosa. `providerOptions` vira decoração e ninguém fica sabendo.

Isso mata a troca. Num sistema em que o nome próprio é a chave da entidade e o
insumo do agente 2, um modelo que escreve melhor a prosa e pior o nome está
piorando exatamente o que importa — e "fronesis" é o nome do próprio projeto.
A lista tem efeito medido e grande (§4.4); um provedor surdo a ela custa mais
do que ganha. Somado a `segments: 0` e `providerMetadata` sem palavras
(reconfirmado nesta medição), o Gemini perde nos dois eixos que decidem.

**Fica registrado para ninguém repetir o teste daqui a três meses:** a troca já
foi tentada duas vezes — em 31/08, revertida no mesmo dia por falta de
timestamp; em 02/09, recusada por falta de canal de vocabulário. A âncora por
bloco de 30 s resolveria o primeiro motivo (a gravação já é fatiada, e
`localizarNoAudio` já toca por bloco), **mas não resolve o segundo** — por isso
não foi construída: não há hoje, neste Gateway, um modelo pelo qual gastá-la.

#### O rate limit é da conta, não do modelo (2026-09-02)

Medido na mesma sessão de trabalho, e é o achado que não é sobre o Gemini:

```
GatewayRateLimitError: Free tier requests on this model are rate-limited.
```

Ele apareceu depois de cinco chamadas seguidas de transcrição no Gemini e, na
mesma janela, **derrubou também o `xai/grok-stt`** — que a tabela acima listava
como sem limite. Trocar de modelo não escapa dele. Uma espera de ~75 s
destravou o que três tentativas seguidas do próprio AI SDK não destravaram.

Isso é um risco vivo do caminho de hoje, não uma nota de rodapé: uma sessão
gravada de 15 min são 30 blocos. O tratamento está em `limite.ts` (§5.3).

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
comentário) é lido e mandado como `keyterm`, respeitando o teto da API: 100
termos, 50 caracteres cada, sem repetir a mesma palavra em outra caixa. Termo
longo demais é descartado inteiro, nunca truncado pela metade. Na slice 1 a
lista é escrita à mão; a partir da slice 3 é gerada das entidades do grafo.

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
exatamente o desenho que §4.12 e §4.13 **recusam** para `regras()` e
`overrides.ts`. A assimetria é deliberada e o critério é o que a demora custa:
"salvei uma regra e ela não valeu" é uma promessa quebrada sem ninguém ver;
"o nome que entrou agora só entra nos keyterms daqui a cinco minutos" custa uma
grafia numa sessão, e o ritual é de uma vez por dia.

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

**Repetido em 2026-09-02 contra um bloco de sessão real**, e o efeito é maior do
que a medição de agosto sugeria — lá a lista trocava uma grafia plausível por
outra; aqui ela tira um nome do ruído puro:

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

### 4.5 Concatenação

Cada `chunk_NNN.json` traz offsets relativos ao próprio início. O offset absoluto
é `relativo + 30 × i` (`DURACAO_CHUNK_S`). `concatenar()` ordena por `i`, soma os
offsets, junta o texto e registra o mapa `{ i, texto, offset_s }`.

Enquanto processa, a tela mostra só o **prefixo contíguo** dos blocos prontos
(`prefixoContiguo`): se o bloco 2 ainda está no STT, o 3 não aparece — texto
parcial nunca é lido fora de ordem.

**As duas funções servem à janela desde a 4.8**, e não foi coincidência: uma
janela é `concatenar` sobre um subconjunto de blocos, o que devolve uma
`Transcricao` com offsets já absolutos — nada na âncora nem no player precisa
saber que ela é um pedaço. E `janelasDe` fatia o mesmo prefixo contíguo pela
mesma razão de sempre: com um buraco no meio, a janela leria fala fora de ordem.

### 4.6 Extração de átomos, janela a janela

**Dispara sozinha**, e desde a slice 4.8 já durante a gravação: a cada quatro
blocos transcritos, `avancarJanelas` fecha uma janela de 2 minutos no mesmo
`waitUntil` que transcreveu o bloco. Ninguém aperta nada entre parar de falar e
ter a proposta (aceite 1 da slice 2) — e agora isso custa segundos, porque o que
falta quando eu paro é uma janela de no máximo 90 s de fala. Quem lê a proposta
é a revisão (§4.7), e é o confirmar dela que a leva ao grafo.

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
desliga o caminho incremental e devolve o sistema ao de antes da fatia — é o
botão de pânico, e existe para ser usado sem deploy de emergência.

**O prompt base não mudou um byte.** `INSTRUCOES_BASE` e `FORMATO` são os
mesmos da 4.7 — cinco versões de calibração produziram o que está lá, e
reescrevê-lo por causa de janela seria arriscar o que está bom. O que entra é um
bloco injetado no **mesmo ponto** em que a regra aprovada entra (§4.12), pelo
mesmo `inserirAntesDoFormato`: depois de tudo o que instrui, antes do envelope.
Ele carrega quatro coisas:

| O que | Por quê |
|---|---|
| "dos minutos 4 a 6", e que a fala continua depois | o modelo precisa saber que está lendo trecho, não sessão — senão ele conclui em cima de uma frase cortada |
| o orçamento, em proporção | a base pede 10 a 20 por 15 min; uma janela de 2 min pede de 1 a 3. Calculado (`orcamentoDaJanela`), não escrito à mão |
| a lista numerada do que já foi proposto | é o que o `ref` do `estende` endereça |
| a chave `estende` no JSON | a operação que impede a lista de virar trinta átomos |

**`blocoDaJanela` devolve string vazia quando a janela é a sessão inteira e o
acumulado está vazio.** Não é detalhe: é o que faz o arquivo importado, a
gravação de menos de dois minutos e o fallback de passe único continuarem
recebendo exatamente o prompt de antes desta fatia.

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

#### O que o prompt manda fazer (`extracao-6`)

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
a ser o do nó: o grafo vence, aqui como na resolução (4.8). Entidade
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

### 4.8 Identidade por contexto (agente 2, `resolucao-2`)

**"Raffa" e "Rapha" são o mesmo som.** O STT escreve uma grafia só para os dois,
e ter os dois nomes no vocabulário não ajuda — só torna arbitrário qual sai. A
grafia na transcrição carrega **zero** sinal sobre quem é.

Isso mata qualquer solução baseada em nome, e é o que separa esta slice da 3. Lá
o problema era duas grafias para a mesma coisa, e `nome_normalizado` resolvia
(8.2). Aqui é o contrário — **uma grafia para duas coisas** — e a chave não pode
resolver, por construção. Só o contexto resolve, e o contexto são os três campos
de perfil da entidade (8.3).

```
janela ──────▶ agente 1: extracao-6   devolve o nome cru: "Rafa"
                      │
                      ▼
                agente 2: resolucao-2  vê os átomos + as entidades com perfil
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

#### Uma vez por janela, sobre as menções daquela janela (slice 4.8)

O agente 2 continua rodando **dentro** da extração, e por isso ele também virou
por janela: as menções que nascem numa janela são decididas quando ela fecha, e
nunca reabertas. Duas consequências opostas, e as duas são deliberadas:

- **ele não perde o que veio antes.** `montarPrompt` recebe os átomos já
  propostos num bloco de contexto próprio — "não decida sobre eles" —, antes dos
  átomos desta janela. Uma "Rafa" do minuto 8 é julgada sabendo da "Raffa" do
  minuto 2;
- **ele não vê o que ainda vai vir.** É a mesma limitação da extração, e o
  conserto é o mesmo: eu, na revisão.

`PROMPT_VERSION_RESOLUCAO` **não** subiu com isso, e a razão é o contrário da
que fez a extração subir: o texto do prompt é o mesmo, o bloco de contexto some
quando está vazio, e o que um `prompt_version` precisa resolver é um texto
(§4.13). O que mudou foi o recorte da sessão que ele enxerga — está aqui e no
§14, e não num número.

O custo é até uma chamada de resolução por janela em vez de uma por sessão. A
trava que a torna condicional continua valendo, agora por janela: janela sem
menção ambígua não chama o agente e não paga nada.

#### Só chama o modelo quando há o que decidir

Uma passada determinística e de graça monta os candidatos de cada menção,
reusando `proximidade` de `duplicatas.ts` — que pega o homófono de brinde, porque
"Rafa" fica a uma ou duas letras de "Raffa" e de "Rapha".

| Situação da menção | O que acontece |
|---|---|
| a união tem **um** candidato, e ele é exato | resolve ali, `certo: true`, de graça |
| a união está vazia | entidade nova, `certo: true`, de graça |
| qualquer outra coisa | vai ao agente |

**A conta é sobre a união deduplicada das quatro camadas** (§4.10), não sobre a
camada de string sozinha — foi o que mudou na 4.5, quando as duas camadas
semânticas entraram. O caso comum de uma sessão sem ambiguidade é a grafia casar
com um nó **e** os vizinhos votarem no mesmo nó: união de tamanho 1, decisão de
graça, agente 2 não chamado. `decidir()` (`resolucao.ts:265`) diz o mesmo com
todas as letras no próprio cabeçalho.

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
| o agente julgou outras menções e não esta | `certo: false`, com o motivo dizendo isso |
| respondeu uma chave fora dos candidatos **daquela** menção | idem, e o motivo **nomeia a chave que veio** — a resposta é descartada, mas a frase não afirma silêncio onde houve resposta |
| respondeu, e **nenhum** julgamento veio | todas as pendentes voltam `certo: false` dizendo que ele respondeu sem julgar, e `[resolucao]` no log leva o `diagnostico()` e uma amostra da resposta crua |
| o agente falhou ou veio sem JSON | todas as pendentes voltam `certo: false`, com `[resolucao]` no log — e o mesmo `diagnostico()` da extração junto, porque o modo de falha é o mesmo |

As três frases são diferentes de propósito (4.8.1): a do meio existia como "o
agente não respondeu por esta menção" nos três casos, e era ela que eu lia para
decidir se o agente estava funcionando. A terceira linha é o instrumento que
faltava — sem ela, uma resposta que o parser não entende sai paga e muda para
"ninguém respondeu". `parsearResposta` também passou a aceitar **array solto**,
como `isolarJson` na extração: `[{"n":1,…}]` era lido do primeiro `{` ao último
`}` e virava um objeto sem `referencias`, ou seja, uma janela inteira decidida
sem segunda opinião e sem uma linha de log.

Falha do agente **não derruba a extração**, que já foi paga: a proposta abre com
as dúvidas destacadas e eu escolho na mão. E o fallback é sempre o casamento
exato quando existe, ou entidade nova quando não — **nunca o parecido**. Duas
entidades a mais eu conserto em `/entidades`; fundir duas pessoas por um palpite
não tem desfazer. A evidência que vai junto do fallback é a do **primeiro
candidato que tem alguma**, e não a do exato: a camada `exato` nunca traz
`porque`, então o `??` de antes apagava a evidência dos vizinhos justamente no
caso em que eu preciso dela para decidir.

**`NOVA` que colide com um nó existente também é dúvida.** Quando o agente
responde `NOVA` e a grafia citada já é o `nome_normalizado` de alguém, o
confirmar **não** cria um segundo nó — a constraint da migration 002 não deixa,
`agregarCandidatas` remapeia e o átomo cai no nó que existe. Ou seja, o agente
diz "é outra pessoa" e o sistema faz o oposto. A causa é legítima e fica; o que
mudou é o sinal: `certo: false`, com o motivo nomeando o conflito, que é o que
me manda renomear uma das duas.

**Duas menções iguais dentro do mesmo átomo viram uma pergunta só.** Elas têm a
mesma lista de candidatos por construção — as camadas de string olham o citado,
as semânticas são calculadas por átomo —, então numerá-las duas vezes pagava a
mesma pergunta duas vezes e ainda admitia duas respostas diferentes para a mesma
coisa. A resposta única vale para as duas posições, cada uma guardando a grafia
dela. **Entre átomos elas continuam duas**: é o ponto inteiro da slice 4.

A conferência da chave do Gateway (`garantirGateway()`) acontece **antes de
embutir**, e não só no ramo com pendentes: embutir o texto do átomo já é tráfego
de modelo. Catálogo vazio continua não exigindo chave nenhuma — por ali nada sai
pelo Gateway.

### 4.9 O perfil, e o agente 3 (`perfil-1`)

Os três campos (`contexto`, `pode_ajudar_com`, `fizemos_juntos`) são texto livre,
editáveis à mão em `/entidades`, com teto de 300 caracteres cada — teto que não é
estética: os campos entram no prompt do agente 2, e sem ele o custo daquela
chamada cresceria junto com o grafo.

**Quem aponta o que é perfil é o agente 2**, que já está olhando átomo e entidade
juntos — mais uma razão para o `extracao-6` não mudar. A marca vira
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

### 4.10 O vetor, e as duas camadas semânticas (slice 4.5)

Até aqui **toda semelhança deste sistema era grafia**: `nome_normalizado` na
slice 3, `proximidade()` na 4. Letra não alcança dois átomos que dizem a mesma
coisa com palavras diferentes, nem uma pessoa cujo nome eu falo de um jeito que o
grafo não escreveu. O vetor é a primeira comparação daqui que não passa por
letra.

**O que isto não é.** Não é economia de token: o gasto dominante continua sendo
o `extracao-6`, que manda a fala inteira ao modelo — hoje repartida em janelas
(§4.6), o que não muda o total —, e embedding não corta um token dele. O que ele compra é a **seleção de candidato**, que na slice 5 vira a única
forma possível de deduplicar átomo — cinco sessões por semana a 15 átomos dão
~3.900 átomos por ano, ou ~7,6 milhões de pares, que não é caro: é impossível.

```
src/lib/embedding.ts   texto → vetor. Fala com o Gateway, não com o Neo4j
src/lib/entidades.ts   vetor → candidatos. Fala com o Neo4j, e junta as pontas
src/lib/resolucao.ts   candidatos → decisão. Não fala com nenhum dos dois
```

Essa divisão é a mesma que já existe entre `duplicatas.ts` (string pura,
testável sem rede) e quem a usa, e é o que deixa a **regra de união** — que é
onde os erros de desenho moram — testável sem banco e sem chave.

#### O que vira vetor, e o que fica de fora

| Nó | Fonte do vetor |
|---|---|
| `:Atomo` | **só `a.texto`** |
| `:Entidade` | uma string canônica: `nome`, `tipo`, `aliases` e os três campos de perfil, com campo vazio **omitido** |

Nada de tipo, entidade ou sessão no átomo: as três já são estrutura no grafo, e a
divisão é essa — **o corte estrutural é do grafo, o semântico é do vetor.** Enfiar
o tipo no texto embutido faria dois APRENDIZADO parecerem próximos por serem
APRENDIZADO, que é exatamente o sinal que o grafo já dá de graça e melhor.

Na entidade, o nó inteiro **não** entra. `id`, `nome_normalizado` e `chaves` são
duplicação ou ruído; e `sessoes`/`atomos` são contagens que mudam a cada confirmar
sem que o significado da entidade mude — entrariam no hash e forçariam reembutir o
grafo inteiro toda sessão, de graça. Campo de perfil vazio é omitido e não posto
em branco: string vazia no meio do texto é ruído com posição.

**Os átomos da entidade ficam de fora, e isso é decisão, não esquecimento.** Com
átomos na fonte, um átomo atribuído errado viraria evidência para a próxima
atribuição — dissolvido num vetor que ninguém audita e do qual não dá para
tirá-lo depois. É a mesma realimentação que a slice 4 fechou ao decidir que o
agente 3 nunca escreve (4.9). A diferença entre aquela e a da camada 3b abaixo é
**visibilidade**, e é ela que decide o que entra.

#### As quatro camadas de candidato

`candidatosDe()` tem quatro camadas **aditivas**, nunca substitutivas — nenhuma
camada anterior mudou de comportamento:

| Camada | Sinal | Pega o caso |
|---|---|---|
| 1. exato por chave | `nome_normalizado`, alias inclusive | grafia conhecida |
| 2. string (`proximidade`) | Levenshtein e palavra em comum | homófono: "Rafa" × "Raffa" × "Rapha" |
| 3a. perfil parecido | átomo × `entidade_embedding` | entidade **com perfil e sem átomo** — o Rapha no dia seguinte ao passo zero |
| 3b. vizinhos votam | átomo × `atomo_embedding`, voto por `:SOBRE`/`:MENCIONA` | entidade **com átomos e sem perfil** — todo o grafo de hoje |

As duas semânticas cobrem buracos **opostos**, e é por isso que as duas ficam.
Uma entidade recém-criada, sem perfil e sem átomo, continua invisível para ambas
— só a string a acha, e é por isso que criar um nome à mão pede escrever o perfil
no mesmo gesto.

**A 3b devolve o porquê.** Ela consulta os vizinhos do átomo novo e conta votos
por entidade, devolvendo junto os **ids, as datas e os trechos** dos átomos que
elegeram cada candidato. A revisão mostra isso ao lado da dúvida: *"parece com o
que você disse em 12/ago: «…»"*. Isso não é enfeite. Esta camada herda atribuição
passada — um erro de atribuição pode sugerir o próximo —, e a única coisa que a
torna aceitável é ser **um voto entre `k`, com o átomo na tela**: visível e
corrigível. Sem o `porque`, esta camada não entraria.

#### Teto e piso são obrigatórios

`TOP_K = 3` sobre a **união** das quatro camadas, e piso de score por camada.
Sem os dois, todo átomo ganha candidato, `decidir()` cai sempre em `julgar`, o
agente 2 é chamado em toda sessão e o critério 5 da slice 4 morre — aquele que
diz que sessão sem ambiguidade não paga nada. **Uma camada semântica sem piso é
uma camada que sempre acha alguém.**

O que faz aquele critério sobreviver é a **deduplicação da união**: o caso comum
de uma sessão sem ambiguidade é a grafia casar com um nó e os vizinhos votarem
**no mesmo nó**. União de tamanho 1, decisão de graça, agente 2 não chamado. Uma
sessão só passa a custar quando o vetor traz alguém que a string não tinha
trazido — que é exatamente o buraco que ele existe para tapar.

Os pisos de 3a e 3b se calibram **separado**, e o mesmo número não significa a
mesma coisa nas duas: 3a é assimétrica (texto de átomo contra string curta de
perfil), 3b é simétrica (átomo contra átomo). O ponto de partida é medido, não
escolhido — com `openai/text-embedding-3-small`, o par de teste da slice
(dois APRENDIZADO sobre relacionamento, de sessões diferentes, sem uma palavra
rara em comum) dá 0,594 entre si contra 0,19–0,29 de assunto não relacionado.

```
PISO_VIZINHOS = 0.45   (cosseno)   simétrica
PISO_PERFIL   = 0.34   (cosseno)   assimétrica, pontua sistematicamente menos
ALCANCE       = { perfis: 5, vizinhos: 8 }
```

Os pisos vivem em espaço de **cosseno**, e não no do banco:
`db.index.vector.queryNodes` com cosseno devolve `(1 + cosseno) / 2`, e as
consultas de `entidades.ts` desfazem essa normalização antes de comparar. A razão
é poder conferir o piso à mão — `cosineSimilarity` do pacote `ai` fala cosseno, e
um número que só existe dentro do banco é um número que ninguém audita.

#### `resolucao-2`

`PROMPT_VERSION_RESOLUCAO` subiu para `resolucao-2`, e o texto do prompt quase
não mudou. **A versão acompanha a entrada, não só a redação:** o conjunto de
candidatos que o agente recebe é outro, e isso é saída diferente (regra 7). O
prompt passou a dizer, ao lado de cada candidato, **por que ele está na lista** —
e quando o motivo é "átomos passados parecidos", os trechos vão junto, porque
evidência de uso é o sinal mais forte que existe quando o perfil está vazio.

#### Nada no caminho do embedding impede uma gravação

É a regra de precedência da slice inteira. O confirmar grava o átomo **e só
então** o embute; se o Gateway falhar, o átomo fica no grafo sem vetor, com um
`[atomos]` no log, e `POST /api/atomos/embutir` o alcança depois. Vetor é
derivável do texto a qualquer momento — refazer 4.000 deles é uma passada de
`embedMany` que custa menos de um centavo. Gravação não é derivável de nada.

A mesma regra vale na leitura: se o índice ainda não existe, se o Gateway está
fora, ou se nada passa do piso, `candidatosSemanticos` engole a falha, registra o
motivo e devolve lista vazia — e a resolução se comporta exatamente como na
slice 4. É também o que permite este código ir ao ar antes de a migration 006
rodar.

### 4.11 A correção que a revisão produz (slice 4.6)

A correção mais cara do sistema se perdia de graça. Rejeitar um átomo, editar um
texto, trocar um tipo: tudo isso já acontecia na revisão, e nada sobrevivia ao
clique de confirmar — o servidor chegava a calcular quantos átomos foram
rejeitados só para descartar o número na resposta HTTP. Esta metade da 4.6 não
pede nenhum gesto novo na tela; ela só para de jogar fora o que a revisão já
produz.

**O grafo é o único lugar que ela não toca.** `POST /confirmar` grava exatamente
o mesmo Cypher de antes. Só depois de responder, dentro de `waitUntil`, o
servidor compara a proposta com o que foi aprovado, produz os registros de
`Correcao` e os grava **só no R2**. Falhar ali nunca desfaz nem atrasa o que já
foi confirmado.

#### O diff mora no servidor; o que viaja do cliente é só o gesto

Os dois lados de toda correção de átomo já estão no servidor: `extracao.json`
guarda a proposta indexada por índice, e o corpo do confirmar traz o valor final.
Computar o diff na tela faria duas implementações divergirem, com a da tela
vencendo calada — o mesmo argumento que pôs `referencias.ts` num módulo só.

Três coisas, porém, são **gesto e não valor**, e só o navegador testemunha:

| Não derivável | Vem de |
|---|---|
| entidade recusada de propósito × não usada por acaso | as candidatas desmarcadas que de fato não viraram nó |
| o par original→final de um renome | o POST manda só o final |
| campo que eu toquei × canonização (a grafia do grafo vencendo) | as chaves de `edicoes[indice]` — a chave existir **é** o gesto |

Daí o campo **opcional** `gestos` no corpo do confirmar
(`{ atomos, entidades_recusadas, renomes, faltantes }`). Ele não carrega valor
nenhum. Corpo sem ele continua confirmando: o servidor infere pelo valor e marca
`tocado: false`. Retrocompatível de propósito — nenhum 400 novo nasceu aqui.

**Duas travas contra correção-fantasma de canonização**, nesta ordem: (1) a
comparação é por nome normalizado, então caixa e acento nunca viram correção;
(2) chave diferente sem o campo em `gestos` é provável travessia de alias —
registrada mesmo assim, mas marcada como inferida. E as entidades que aparecem
em `gestos.renomes` ou entre as recusadas **saem da conta** antes de computar
`sujeito` e `menciona`: um renome no rodapé já muda todo átomo que cita aquela
entidade, e uma edição minha não pode virar dez correções.

#### O que uma correção guarda, e de quem é a culpa

`Correcao` (`tipos.ts`) tem `antes`, `depois`, o texto proposto, as âncoras do
átomo (é delas que sai o `▶ mm:ss` da tela de calibração, mais abaixo nesta
seção), a procedência **do átomo da proposta** — nunca do corpo, regra 7 —,
`tocado` e `incorporada_em` (`null` = em aberto).

A chave **não** é sempre `${atomo_id}|${tipo}`. Três tipos não têm átomo, e com
um id fixo por tipo os três colapsariam num registro só, uma correção nova
apagando a anterior em silêncio:

```
átomo     rejeitado, texto, tipo, sujeito, mencao_*  -> `${atomo_id}|${tipo}`
entidade  entidade_recusada|renomeada|tipo           -> `${sessao_id}|${tipo}|${chave}`
faltou                                               -> `${sessao_id}|faltou|${chave40}`
```

`mencao_adicionada` e `mencao_removida` são dois tipos e não um: com um só,
acrescentar e tirar menção no mesmo átomo colapsariam num registro, e o segundo
apagaria o primeiro.

Cada correção sai etiquetada com o agente que a produziu:

| Tipo | Agente | Por quê |
|---|---|---|
| `rejeitado`, `texto`, `tipo`, `faltou` | `extracao` | é o `extracao-6` produzindo o que não presta |
| `entidade_recusada` | `extracao` | listou como entidade o que não é pessoa, projeto nem objetivo |
| `entidade_tipo` | `extracao` | errou o palpite de tipo na lista `entidades` |
| `sujeito`, `mencao_removida` | `resolucao` ou `extracao` | **por átomo**: `sobre.conhecida` decide |
| `mencao_adicionada` | `extracao` | menção que o extrator não listou; não há referência original para a resolução ter errado |
| `entidade_renomeada` | `grafo` | higiene de grafia — salvo quando o nome apagado era pronome, e aí é `extracao` furando a seção "NOME DE ENTIDADE É NOME" |

O sinal de `sujeito`/`mencao_*` é por átomo e não por sessão: `resolucao.ts` roda
a camada determinística para toda menção, e `prompt_version_resolucao` só marca
se alguma foi ao modelo — então uma sessão sem ambiguidade nenhuma (comum com o
grafo pequeno) pode ter batido no nó errado por acaso. `conhecida: true` é a
resolução decidindo entre nós que existem; `conhecida: false` é candidata nova,
mais perto de "o extrator escreveu algo que não bate com nada".

**Captura os três agentes, calibra um de cada vez.** `resolucao` e `grafo`
acumulam etiquetados, sem consumidor, até a fatia que os calibrar.

#### Por que R2, e por que dois objetos

O grafo é o que eu vivi; correção é o que o pipeline errou. Um `:Atomo` dizendo
"o modelo escreveu FATO onde era OPINIAO" apareceria numa busca por "o que eu
aprendi" e apodreceria a coisa que o sistema existe para fazer. Some-se a regra
2, e não valia uma migration.

`sessoes/<id>/correcoes.json` é o registro permanente daquela revisão — uma
fotografia do momento da confirmação, gravada com `If-None-Match: *`, e escrita
mesmo quando não houve correção nenhuma: o objeto vazio é o que distingue
"revisei e não corrigi nada" de "o `waitUntil` morreu antes de apurar". Separado
de `extracao.json` porque `forcar` sobrescreve a proposta sem backup, e correção
guardada junto morreria na primeira recalibração — quando ela mais vale.

`calibracao/indice.json` é a mesa de trabalho: o acumulado, com teto de 500.
Existe porque `r2.ts` não tem `LIST` — sem ele, uma correção seria alcançável só
por quem já soubesse o id da sessão. Guarda as correções inteiras (o corpus é
esparso por construção) e a escrita é read-modify-write por etag, no mesmo laço
de espera de `atualizarManifest` (§6.1), com o conteúdo recalculado **dentro** de
cada tentativa. Estourado o teto, a eviction come as **fechadas** antes das
**abertas**: fechada já cumpriu o papel e o registro por sessão cobre auditoria;
aberta perdida daqui é inatingível para sempre.

#### A tela: o material mandou no desenho

`/calibracao` é gestão — `tipografia.ts` a serve com Inter sem ninguém marcar
nada, porque `RITUAL` é allowlist —, e vive na gaveta da `Gestao`, sempre, e não
só quando há o que calibrar: gaveta é mapa, e porta que aparece e some é porta
que se procura no lugar errado.

**O desenho dela saiu da primeira rodada real, não de palpite.** Medido em
2026-09-04, com 5 sessões e 21 correções: **metade são correções de `texto`, com
`antes` e `depois` de 200 a 660 caracteres.** Isso a tira da categoria "lista de
rótulos curtos" — o que ela precisa resolver é ler dois parágrafos e enxergar
onde diferem. Daí a única regra de apresentação que não é CSS: par que somado
cabe em 90 caracteres vai **em linha**, com a seta; acima disso vai
**empilhado**, um bloco sob o outro, cada um etiquetado ("o que veio" / "o que
eu deixei"). Sem diff colorido: cor que aponta o que mudou é a tela afirmando
uma leitura que eu não pedi.

Cada correção com âncora ganha `▶ mm:ss` (`localizarNoAudio`, o mesmo da
revisão), e a proposta da sessão só é buscada **quando eu clico** — uma ida à
rede por sessão, guardada, não uma por correção ao abrir. Correção com
`tocado: false` mostra "inferida": ela veio da trava 2, não de um gesto meu, e a
tela tem que dizer isso ou eu a leio como coisa que fiz.

No rodapé, atrás de um botão, os `descartados` da extração agrupados por motivo
— item que o modelo devolveu e a validação recusou. A revisão já os carregava e
nunca os renderizou. É o outro lado da correção: ali eu digo o que ficou torto,
aqui o código diz o que nem passou.

#### Antes e depois, sem inventar métrica

`extrairSessao({forcar:true})` copia para `extracao-anterior.json` a proposta que
substituiu — **só a última**, não um histórico. A cópia acontece **depois** do
PUT da proposta nova, e a ordem é deliberada: o que eu pedi foi a re-extração, e
perder a cópia custa a comparação daquela sessão enquanto perder a proposta
custaria a chamada de modelo inteira. Falhar ali só escreve no log.

`GET /extracao` devolve `anterior` como **cabeçalho** (`{atomos, prompt_version,
modelo, criado_em}`); a lista de átomos antigos só vem com `?anterior=1`, porque
mandá-la sempre dobraria o payload da tela mais apertada do sistema por um caso
raro. Na revisão, **quando a versão do prompt mudou**, uma linha discreta no fim
da lista oferece "ver a anterior", e ela renderiza a lista antiga somente
leitura — sem checkbox e sem editor, porque o que eu confirmo é a proposta
corrente. Re-extração com a mesma versão não mostra linha nenhuma: comparar duas
saídas do mesmo prompt é ruído na tela que tem 60 s.

Sem diff colorido, sem "melhorou/piorou", sem placar. É a única defesa contra
regressão silenciosa que esta fatia pode oferecer, e ela é olho no olho.

#### Quando roda, e o que se perde se não rodar

Dentro do `waitUntil`, depois da resposta, num `try/catch` que nunca derruba o
confirmar. O que destrava o `router.push("/")` da revisão é a resposta HTTP;
pagar idas ao R2 nos 60 s da revisão por material de meta seria pagar no lugar
errado. `waitUntil` morto perde as correções daquela sessão, sem recuperação —
e nada do diário se perde junto, porque os átomos já estão no grafo quando isto
começa.

### 4.12 O prompt aprende: as regras e o `calibracao-1` (slice 4.6)

O prompt de extração passou a ter **duas fontes** nesta fatia: `INSTRUCOES_BASE`,
no git, e as regras aprovadas, no R2. Na 4.7 entrou a **terceira, e é a que
vence a base**: o prompt que eu editei no painel, em
`config/prompt-extracao-<hash>.json` (§4.13). Quem monta a chamada pede o texto
em vigor a `efetivo("extracao", { prompt: BASE, … })` e as regras a `regras()` —
esta seção descreve a segunda fonte, e o §4.13 descreve a terceira. O custo está
declarado no §14: ler o prompt efetivo exige os três lugares, e `git revert`
sozinho não reverte mais o prompt inteiro.

#### A montagem, e o no-op

```
montarPrompt(texto, regras, base = INSTRUCOES_BASE, janela?)
    = inserirAntesDoFormato(comRegras(base, regras), blocoDaJanela(janela)) + texto
    = base, com blocoDeRegras(regras) e depois blocoDaJanela(janela)
      inseridos antes do cabeçalho FORMATO
```

O ponto de inserção é onde uma regra entra: depois de tudo o que instrui, antes
do que descreve o envelope de saída. Regra enfiada depois do `FORMATO` seria
lida como parte do exemplo de JSON. Enquanto o prompt eram duas constantes, esse
ponto era a emenda entre elas; desde a 4.7 é um cabeçalho procurado no texto
(`lastIndexOf` do cabeçalho `FORMATO`, em `inserirAntesDoFormato`), porque o
`base` pode ser um prompt que eu escrevi. O resultado é idêntico quando o `base`
é o do git, que é o caso sem override.

**São dois blocos injetados no mesmo ponto desde a 4.8**, e a ordem entre eles é
esta: a regra primeiro, porque ela vale sobre tudo e sobre toda sessão; a janela
depois, porque ela é sobre esta chamada e mais nenhuma (§4.6).

**`blocoDeRegras([]) === ""`, e isso não é detalhe:** sem regra aprovada o
prompt sai **byte a byte igual** ao de antes desta fatia — verificado contra o
arquivo anterior, 4620 caracteres nos dois. A slice inteira é um no-op até a
minha primeira aprovação, e portanto incapaz de piorar nada enquanto eu não
mandar. `tests/regras.test.ts` trava a junção exata das duas metades.

`versaoDoPrompt` substitui o `PROMPT_VERSION` fixo: `extracao-6` sem regra,
`extracao-6+a3f91c7d` com. **O hash sai das regras usadas na chamada, não do
arquivo** — se o R2 falhar, entram zero regras e a versão é a base. A
procedência é verdadeira nos dois caminhos, que é o ponto: carimbar `+a3f91c7d`
numa extração que rodou sem regra seria mentira gravada no grafo para sempre.

E o hash resolve para um texto: cada aprovação grava
`calibracao/regras-<hash>.json`, imutável, e o índice aponta qual é a corrente.
Sem isso, um átomo de três meses atrás carregaria uma versão de prompt que não
está versionada em lugar nenhum.

#### `regras()`: tolerante, com teto, e sem cache

Copia o molde de `vocabulario()` — leitura que **nunca propaga erro**, porque
R2 fora do ar não pode impedir uma sessão de ser extraída. A falha degrada para
o comportamento bom (o prompt base), não para nenhum. `MAX_REGRAS = 12` corta no
servidor, e o teto **é a curadoria**: prompt sem limite é exatamente como esta
fatia estragaria a extração que já presta.

**Sem cache, e aqui o código diverge da spec**, que previa um invalidado na
escrita. Numa função serverless o cache é por instância: a que aprovou invalida
o dela, e a vizinha, que cacheou a lista vazia, continuaria extraindo sem a
regra — "aprovar → vale na próxima extração" seria falso de um jeito que
ninguém vê. `regras()` é chamada **uma vez por sessão**; duas idas ao R2 por
sessão é o preço de a promessa ser verdadeira.

#### O `calibracao-1`, quarto agente

`PROMPT_VERSION_CALIBRACAO = "calibracao-1"`, parser tolerante próprio,
`temperature: 0`, `modeloCalibracao()` (`CALIBRACAO_MODEL`, padrão o da
extração). **Não escreve nada**: propõe e para, como o agente 3. A razão é a
mesma, e maior — perfil rascunhado errado contamina a resolução; regra
rascunhada errada contamina toda extração futura.

Ele lê só as correções **em aberto e do agente `extracao`** (`paraCalibrar`).
`resolucao` e `grafo` seguem capturadas e etiquetadas: alimentar o agente da
extração com elas só produziria regra de extração para erro que não é dela.

**As amarras valem no parser, não só no prompt** — amarra que vive apenas no
texto é amarra que o modelo ignora num dia ruim:

| Amarra | Por quê |
|---|---|
| no máximo 2 regras por rascunho | mais que isso não é rascunho, é reescrita do prompt |
| toda regra cita os `Correcao.id` que a motivam | sem procedência, "endereçada" não quer dizer nada |
| id citado tem de estar no material | id inventado fecharia uma correção que a regra nunca leu |
| **nunca a partir de uma correção só** | um caso não é padrão, e generalizar um caso piora o extrator em todos os outros |
| seção inventada não vira `substitui` | iria ao prompt como "isto substitui a seção X" apontando para nada |

Há uma quinta, e ela veio da medição de 2026-09-04: **conserto de grafia de nome
próprio não vira regra**. Um terço das correções reais era o STT tendo ouvido
errado, e nenhuma instrução faz o extrator adivinhar um nome que nunca chegou
até ele. A amarra é uma linha do prompt; a saída de verdade é o agente de
pré-resolução do §14, que fica para quando o fluxo de resolução for refinado.

#### Aprovar: três escritas, um ciclo só

`POST /api/calibracao/regras` recebe a **lista inteira** que deve valer, não um
delta: apagar é submeter sem ela, editar é submeter o texto novo com o mesmo
`id`, e lista vazia revoga tudo e volta ao prompt base. "Sobreviveu à minha
edição" é o `id` ainda estar na lista — daí ele ser atribuído no rascunho e
nunca editável, enquanto `texto` é o único campo que a tela deixa mexer e `cita`
é do agente.

`aprovarRegras` grava o snapshot, aponta `regras_correntes` para ele e marca
`incorporada_em` nas correções citadas — **as três no mesmo read-modify-write**.
`incorporada_em` só é autoritativo no índice, e duas aprovações quase
simultâneas só não se destroem se o conteúdo for recalculado dentro de cada
tentativa do retry. A cópia de cada `Correcao` em `sessoes/<id>/correcoes.json`
não é atualizada: ela é a fotografia do momento da confirmação, não o estado.

Regra que eu corto antes de aprovar deixa as correções que a motivavam **em
aberto**, e elas voltam no próximo rascunho — é o que faz "descartar" ser
diferente de "endereçar".

#### A sugestão: a cada 3 semanas, nunca um número

`sugerirCalibracao` é pura e binária. Sem correção em aberto **nunca** sugere,
não importa o tempo passado. Havendo, a contagem parte de `visitado_em` — a
última vez que `/calibracao` carregou de fato — ou, se eu nunca visitei, da
correção em aberto mais antiga; passados 21 dias, acende.

A `Gestao` consulta `GET /api/calibracao/sugestao`, que é **puro**, ao abrir a
gaveta. Quem reseta o relógio é a carga real da tela: se a consulta marcasse
visita, a sugestão morreria no primeiro toque na engrenagem, sem eu ter olhado
nada. E ela aparece **só na gaveta**, nunca no ícone em `/` — a tela de gravar é
"um botão, um timer, um jeito de parar", e um sinal ali seria cobrança na única
tela que não pode cobrar. Abrir a tela apaga a sugestão por mais três semanas,
aprovando regra ou não: olhar já conta.

### 4.13 O painel dos agentes (slice 4.7)

Sete pontos deste sistema falam com o Gateway. Até esta fatia, saber o que cada
um fazia exigia abrir cinco arquivos de `src/lib/`, e mudar qualquer coisa exigia
um deploy. `/agentes` é onde eles passam a ter rosto: o fluxo desenhado, e cada
caixa abrindo o prompt e o modelo que a comandam.

| Agente | Módulo | Quando | Modelo | Envelope que o parser exige |
|---|---|---|---|---|
| STT (sem prompt) | `stt.ts` | automático, por bloco | `STT_MODEL` | — |
| `extracao-6` | `extracao.ts` | automático, por janela de 2 min | `EXTRACAO_MODEL` | `atomos`, `entidades` |
| `resolucao-2` | `resolucao.ts` | condicional: por janela, só com menção ambígua | `RESOLUCAO_MODEL` | `referencias`, `perfil` |
| `calibracao-1` | `calibracao.ts` | sob demanda, em `/calibracao` | `CALIBRACAO_MODEL` | `regras`, `cita` |
| `perfil-1` | `perfil.ts` | sob demanda, em `/entidades` | `PERFIL_MODEL` | `texto` |
| `duplicatas-1` | `duplicatas.ts` | sob demanda, em `/entidades` | `DUPLICATAS_MODEL` | `mesma`, `explicacao` |
| embedding (sem prompt) | `embedding.ts` | automático, depois de gravar | `EMBEDDING_MODEL` | — |

#### O mecanismo é o da 4.6, generalizado

Nada novo foi inventado: as regras aprovadas já viviam no R2 e já valiam sem
deploy, com snapshot imutável por hash e sufixo no `prompt_version`. `overrides.ts`
é `regras.ts` aberto para os sete, e o cabeçalho de lá continua sendo a
explicação de por que R2 (serverless não tem disco gravável nem compartilhado),
por que snapshot imutável (o carimbo tem de resolver para um texto), e **por que
sem cache** (cache por instância faria "salvei, vale na próxima" ser falso de um
jeito que ninguém vê).

```
config/agentes.json                  { overrides: { <agente>: { prompt_hash, modelo, atualizado_em } } }
config/prompt-<agente>-<hash>.json   { agente, hash, texto, anterior, criada_em } — imutável
```

**Nunca propaga erro na leitura.** R2 fora do ar não impede sessão nenhuma de ser
transcrita ou extraída: sem override, o agente sai byte a byte igual ao de antes
desta fatia. A falha degrada para o comportamento bom, não para nenhum — e é o
mesmo motivo que faz a slice inteira ser um **no-op** até o meu primeiro toque.

O custo está declarado: **uma leitura do índice por chamada de agente.** Uma por
sessão na extração, uma na resolução, e **trinta numa sessão gravada de 15 min no
STT**, uma por bloco. É o preço que `regras()` já paga, e é o preço de a promessa
ser verdadeira em vez de quase.

#### A procedência de um prompt editado

`prompt_version` carrega de onde o texto veio, e o prefixo diz por qual chave o
hash resolve:

| Carimbo | Quem produziu | Resolve em |
|---|---|---|
| `extracao-6` | a base do git, sem regra aprovada | o próprio git |
| `extracao-6+a3f91c7d` | a base do git, com regra aprovada | `calibracao/regras-<hash>.json` |
| `extracao-6+p1b2c3d4` | prompt editado no painel | `config/prompt-extracao-<hash>.json` |
| `extracao-6+p1b2c3d4+a3f91c7d` | prompt editado **e** regra aprovada | os dois objetos, nesta ordem |

Sem o `p`, ler um carimbo antigo viraria adivinhação: um hash só não teria como
resolver dois objetos diferentes. O hash sai do **conteúdo**, então salvar o
mesmo texto duas vezes não cria versão nova, e desfazer uma edição devolvendo o
texto original devolve o carimbo original.

**E o hash volta `null` quando o texto não foi usado.** Ponteiro que não resolve
objeto — índice apontando para um prompt que sumiu — cai na base **e** carimba a
base. Carimbar uma versão que não rodou é procedência falsa, que é pior que
procedência nenhuma.

#### Onde a regra aprovada entra num prompt editado

O bloco `AJUSTES QUE EU PEDI` continua entrando **antes do cabeçalho `FORMATO`**:
depois de tudo o que instrui, antes do que descreve o envelope de saída. Enquanto
o prompt eram duas constantes, esse ponto era a emenda entre elas; agora é um
cabeçalho procurado no texto (`comRegras`). Se eu renomear o cabeçalho ao editar,
as regras vão para o fim, antes da transcrição — pior lugar, e ainda assim o
comportamento certo: regra aprovada não pode sumir porque um cabeçalho mudou de
nome.

#### As duas travas, e as duas são no servidor

**O envelope.** Eu posso reescrever o prompt inteiro, inclusive o `FORMATO` — mas
não posso salvar um que deixe de pedir o JSON que o parser sabe ler. `POST
/api/agentes/:id` recusa com 400 dizendo qual chave falta. Sem isso o erro só
apareceria na próxima sessão, na hora de extrair, e derrubaria todas as
seguintes. É substring e não JSON de verdade, de propósito: o que se checa é se o
prompt continua **pedindo** o formato, e isso é pergunta sobre o texto.

**O embedding não tem campo de modelo.** Os dois índices vetoriais declaram 1536
dimensões na migration 006 (§8.4); trocar por um modelo de outra dimensão pede
`DROP` e migration nova, que é decisão aprovada e não toque de tela. A caixa
mostra o modelo e o motivo, em vez de um campo que aceitaria e quebraria.

Duas mais, menores, e as duas evitam que o painel minta: id de modelo continua
passando por `validarIdDeModelo` (regra 8 — string `provedor/modelo`, nunca
objeto de provedor), e **salvar o texto igual ao da base revoga o override**, em
vez de guardar uma "edição" byte a byte idêntica ao git que faria o painel dizer
"editado" e o átomo sair carimbado com `+p`.

#### O desenho, e por que ele em vez de uma lista

Sete linhas numa tabela não dizem que a resolução roda **dentro** da extração,
que a regra que eu aprovo volta para o prompt do extrator, nem que existe
exatamente **um** nó humano no meio de tudo — e é esse nó que a regra 5 protege.
A lista descreve; o desenho explica. Por isso o nó da revisão é terracota e é o
único que não é agente nem dado.

O fluxo é **dado** (`NOS` e `ARESTAS`, em `agentes.ts`), e não marcação no
componente: sistema que muda tem de quebrar um teste, não só ficar feio numa
tela. `tests/agentes.test.ts` cobra que toda aresta ligue nós que existem, que
todo agente tenha caixa, que nenhum nó fique solto no desenho, e que o nó humano
continue sendo um só.

A grade é **vertical**, quatro colunas, e rola na horizontal quando não couber.
Este app vive no celular: um canvas que se arrasta e se dá zoom é confortável no
monitor e inútil no telefone, e diagrama espremido não é diagrama responsivo, é
diagrama ilegível. **Nenhuma dependência entrou** — as caixas são uma grade CSS
posicionada pelo `linha`/`coluna` do registro, e as setas são um `<svg>` por
cima, medido do DOM com `ResizeObserver`. Mesma escolha do `SeletorEntidade`, que
foi escrito à mão em vez de trazer um combobox de biblioteca.

**Quatro colunas, e não três, por causa de um invariante do roteador.** Uma
aresta de ida é um cotovelo — desce, atravessa na altura do meio entre as duas
linhas, desce —, então **aresta que pula uma linha atravessa a caixa que está
entre elas**. O `grafo` tem três filhos (`duplicatas`, `perfil`, `embedding`) e
eles têm de caber na mesma linha; a quarta coluna é por onde a calibração desce
sem disputar espaço com eles. `tests/agentes.test.ts` cobra os dois lados: aresta
de ida liga linhas vizinhas, e realimentação sempre sobe. Foi esse teste que
pegou o desenho de três colunas, em que `grafo → perfil` cortava a caixa do
`duplicatas`.

A realimentação é a exceção, e por isso tem traço próprio: curva pontilhada
terracota, saindo pela lateral e subindo **por fora** da grade — é o que o
`padding` horizontal do palco reserva. São as três voltas que fecham o sistema
(a regra que volta ao extrator, o perfil e o vetor que voltam ao resolvedor) mais
a proposta de fusão, e elas são justamente o que uma lista de sete linhas não
conta.

#### A varredura, que é o teste que mais vale

`tests/agentes.test.ts` percorre `src/` e falha quando um arquivo chama
`generateText`, `transcribe`, `embed` ou `embedMany` sem pertencer a um agente do
registro. É o mesmo desenho de `tests/gateway.test.ts`, e existe pelo mesmo tipo
de razão: sem ele, um agente novo nasceria **funcionando e invisível** — rodando
em toda sessão, cobrando, e sem caixa no painel nem prompt que eu pudesse ler. Se
ele te barrou, o conserto é registrar o agente em `agentes.ts`.

#### O que esta fatia não faz

Não guarda histórico de edição: `config/agentes.json` tem o que vale agora, e os
snapshots por hash guardam os textos, mas não há linha do tempo nem "desfazer" de
mais de um passo. Não mede nada — não há latência, custo nem contagem de chamada
por agente, porque `CLAUDE.md` proíbe métrica automática de qualidade e porque
custo e latência já têm lugar: o painel do próprio Gateway. E não deixa criar
agente: os sete são os que o código tem, e um oitavo nasce escrevendo código.

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
| `[janela] sessão <id> janela <n> (blocos a-b): +N átomo(s)…` | `avancarJanelas` | uma janela fechou — é o `console.log` que mostra a extração acontecendo durante a gravação |
| `[janela] sessão <id> janela <n> falhou:` | `avancarJanelas` | a janela não fechou; ela fica `falhou` no `parcial.json` e é retentada na passada seguinte |
| `[janela] sessão <id>: sem orçamento para a janela <n>` | `avancarJanelas` | o prazo do `finalizar` acabou antes de a janela do fim rodar |
| `[janela] sessão <id>: janela(s) N não fecharam…` | `propostaDaSessao` | a proposta caiu no passe único sobre a sessão inteira — o fallback da 4.8 |
| `[extracao] sessão <id> falhou:` | `extrairSessao` | o modelo estourou, ou a resposta não era JSON válido |
| `[extracao] sessão <id>: sem transcricao.json…` | `extrairSessao` | pediram extração de uma sessão sem transcrição gravada |
| `[finalizar] sessão <id> falhou:` | rota `/finalizar` | `finalizarSessao` estourou uma exceção |
| `[extrair] sessão <id> falhou:` | rota `/extrair` | a re-extração manual morreu — é o log do botão "reextrair" da lista |
| `[calibracao] sessão <id>: …` | `capturarCorrecoes` | as correções daquela revisão foram (ou não foram) registradas |
| `[atomos] N átomo(s) gravados sem vetor;` | `gravarAtomos` | o confirmar gravou e o embedding falhou — `POST /api/atomos/embutir` alcança depois (§4.10) |
| `[overrides] <id>: o hash <h> não resolve texto nenhum, usando a base` | `resolver` | um prompt editado sumiu do R2; o agente cai na base **e** carimba a base (§4.13) |
| `[overrides] não consegui ler o prompt <agente>+<hash>:` | `promptPorHash` | o mesmo, um nível abaixo — o R2 recusou a leitura |

Os três últimos não são falha de sessão: a sessão segue, e o que se perde é
material de calibração, um vetor ou um prompt editado. Estão aqui porque esta é
a tabela que responde "onde aparece o motivo", e um log que ninguém sabe que
existe não é diferente de log nenhum.

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

Quem chama dentro de um prazo passa o seu (`ate`): `finalizarSessao` tem 150 s
para os blocos que faltam, e a janela do fim tem os 120 s de
`ORCAMENTO_JANELAS_MS`. Uma espera que não caiba nesse orçamento é pior que não
esperar — o `waitUntil` morre antes de a chamada voltar, e a falha fica sem nem
o log. **Onde não há prazo não se passa nada**, e desde a 4.8 esse caso é o que
mais importa: as janelas que fecham durante a gravação vão sem `ate`, porque ali
esperar o limite passar é de graça — eu ainda estou falando.

Os dois pontos que falam com modelo no caminho automático estão cobertos:
`stt.ts` e `extracao.ts`. A extração era a mais exposta das duas justamente por
rodar logo depois dos 30 blocos de STT, que é quando o limite está mais perto de
estourar; **a slice 4.8 desfez essa concentração** — são oito chamadas menores
espalhadas pela gravação, e sete delas sem prazo nenhum para esperar.

Perfil, duplicatas e embedding **não** estão cobertos: saem de um clique meu, e
ali a falha aparece na tela em vez de matar uma sessão em `waitUntil`. **A
resolução também não está**, e essa é a que incomoda: ela roda dentro da
extração, no caminho automático, desde a slice 4 — o que este documento dizia
("chamada sob demanda") descrevia o `perfil-1`, não o `resolucao-2`. Um limite
ativo faz o agente 2 falhar em vez de esperar, e a degradação já é a certa: as
menções voltam como dúvida e a revisão me deixa escolher (§4.8). Passar
`comEsperaDeLimite` para lá é conserto de uma linha, e não foi feito nesta fatia
para não misturar duas mudanças no mesmo lugar.

Quando a espera não basta, a linha de desistência diz isso com todas as letras —
"a causa foi rate limit do AI Gateway… chamar /finalizar de novo daqui a alguns
minutos costuma resolver" —, porque a alternativa é procurar defeito no código
onde só havia pressa. O áudio fica intacto no R2 e o retry é o mesmo de sempre.

## 6. Idempotência

Regra inviolável 4: todo passo é chaveado por `sessao_id` (+ `chunk_index`).
Eram três travas na slice 1 — o bloco, a proposta e o manifest; a tabela cresceu
com cada fatia, e hoje são estas:

| Trava | Onde | Efeito |
|---|---|---|
| `chunk_NNN.json` existir | `pipeline.transcreverBloco` | não rechama o STT nem sobrescreve resultado pronto |
| janela `pronta` no `parcial.json` | `janela.reivindicar` | janela fechada não é reextraída nem repaga, por mais vezes que `/pronto` chame |
| lease `em_curso` com prazo (`LEASE_MS`, 120 s) | `janela.reivindicar` | dois `waitUntil` não extraem a mesma janela; worker morto libera a janela em vez de travá-la |
| `If-Match` + laço de retry no `parcial.json` | `janela.atualizarParcial` | duas janelas concorrentes se somam em vez de se sobrescrever |
| o `id` do átomo é carimbado **na escrita**, não na extração | `janela.aplicarJanela` | duas janelas nunca produzem o mesmo `<sessao_id>-<índice>` — que é o que faz o `MERGE` do confirmar ser idempotente |
| `extracao.json` existir | `pipeline.extrairSessao` | não rechama o modelo nem sobrescreve proposta que eu já posso ter revisado |
| `If-None-Match: *` no PUT da proposta | `pipeline.extrairSessao` | dois workers na mesma sessão geram uma proposta só: quem chega em segundo usa a do primeiro |
| entrada no manifest por `i` | `manifest.registrarChunk` | reenviar o mesmo bloco não duplica nem reabre bloco transcrito |
| `id` do átomo = `<sessao_id>-<índice>` | `atomos.gravarAtomos` (`MERGE`) | confirmar duas vezes não duplica átomo |
| `nome_normalizado` único (constraint) | `atomos.gravarEntidades` (`MERGE`) | duas menções à mesma pessoa viram um nó, mesmo em corrida |
| `campo` **dentro** do `MERGE` de `:PERFILA` | `atomos.gravarAtomos` | reconfirmar não dobra a aresta de perfil: a identidade dela é (átomo, campo, entidade) |
| o rascunho de perfil não escreve | `perfil.rascunhar` | pedir o rascunho dez vezes não muda o grafo; só `POST /api/entidades/perfil` grava |
| status na cláusula `WHERE` | `sessoes.atualizarSessao` | transição já feita não volta atrás; confirmar duas vezes não reprocessa |
| `embedding IS NULL` ou modelo diferente | `atomos.embutirAtomos` e `atomosSemVetor` | reconfirmar não reembute o que já tem vetor; rodar o retrofill duas vezes não gasta duas vezes |
| `embedding_fonte` bater | `entidades.garantirEmbeddings` | entidade em dia não é reembutida — e por isso não há gancho a esquecer em nenhuma das cinco rotas de entidade |
| `CREATE VECTOR INDEX … IF NOT EXISTS` | migration 006 | reaplicar a migration é no-op |
| `If-None-Match: *` em `correcoes.json` | `calibracao.capturarCorrecoes` | reenviar o confirmar não sobrescreve o registro permanente da revisão |
| `If-Match` + laço de retry no índice | `calibracao.atualizarIndice` | duas capturas concorrentes se somam; quem perde a corrida relê e reaplica |
| `Correcao.id` condicional ao tipo | `correcoes.apurarCorrecoes` | correção de átomo, de entidade e "faltou" nunca colidem entre si |
| id que já está no índice não é reaberto | `correcoes.juntarNoIndice` | reapurar não devolve `incorporada_em` para `null` |
| `regras-<hash>.json` imutável, com `If-None-Match` | `regras.gravarVersao` | reaprovar a mesma composição não cria versão nova: o hash sai do conteúdo |
| o rascunho de regra não escreve | `calibracao.rascunharRegras` | pedir dez rascunhos não muda prompt nenhum; só `POST /api/calibracao/regras` grava |

A trava de `extracao.json` vale para **os dois agentes**: proposta pronta não
rechama nem a extração nem a resolução, e `forcar` refaz as duas. Calibrar o
`resolucao-2` custa, sim, uma extração junto — o que a arquitetura de dois
agentes barateia é o contrário: mexer no `resolucao-2` não mexe no `extracao-6`.

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
- **Middleware** é a porta única: no corpo dele só `/entrar` e `/api/auth/*`
  passam sem cookie. Requisição a `/api/*` sem cookie recebe 401; navegação vai
  para `/entrar`. Antes do corpo há o `matcher`, e ele decide onde o middleware
  **nem roda**: `_next/static`, `_next/image`, `favicon.ico`,
  `manifest.webmanifest` e `icone.svg`. Os dois últimos são exigência do PWA — o
  navegador busca o manifest e o ícone sem cookie de app —, e por isso são
  decisão e não descuido; os três primeiros são estático de build. A resposta
  completa de "o que responde sem cookie" é a soma dos dois lugares.
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

Quatro módulos escrevem em nó de conteúdo, e a divisão importa:

| Módulo | Escreve | Quem chama |
|---|---|---|
| `atomos.ts` | `:Atomo`, `:Entidade` e `:PERFILA` | **só o confirmar** — nenhum átomo entra antes da revisão (regra 5) |
| `fusao.ts` | `:Entidade` — funde, renomeia, troca tipo, cria | só as rotas de `/entidades`, com um toque meu em cada uma |
| `perfil.ts` | `:Entidade` — os três campos de perfil (8.3) | só `POST /api/entidades/perfil`, com um toque meu |
| `entidades.ts` | `:Entidade` — `embedding`, `embedding_modelo` e `embedding_fonte` (8.4) | `POST /api/entidades/embutir`; o módulo que lê o catálogo é o mesmo que põe o vetor em dia |

`entidades.ts` está na lista porque escrever vetor é escrever no grafo, mesmo
que o que ele escreva seja derivável do texto a qualquer momento. Ele é a
exceção da regra de cima e a confirma: é o único dos quatro que grava sem um
toque meu, e é o único cujo dado se refaz sozinho na passada seguinte.

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
aresta `:FUNDIDA_EM`; as **três** arestas que apontam para entidade — `:SOBRE`,
`:MENCIONA` e `:PERFILA` — migram por `MERGE`, uma consulta por tipo: Neo4j não
aceita tipo de relação vindo de parâmetro, e repetir a linha é bem menos frágil
que uma subquery com `UNION`.

`:PERFILA` migra **fora do laço** das outras duas, e é a única que precisa
disso: ela carrega `campo` (migration 005), então o `MERGE` do destino tem de
casar o par (átomo, campo), que é a identidade da aresta. Generalizar o laço
para propriedade custaria mais que repetir a consulta uma vez.

O ponto do desenho: **como o perdedor mantém o `nome_normalizado`, a grafia
morta nunca renasce como nó novo.** Dita outra vez, ela casa com o alias e a
leitura segue até o vencedor. A fusão é o mecanismo de alias, não um efeito
colateral dele — e é o que faz ela valer para amanhã, não só arrumar o ontem.

Quem atravessa o alias:

| Onde | Por quê |
|---|---|
| `buscarConhecidas` / `resolver` | "Exx Med" numa sessão nova volta como conhecida, com o nome do vencedor |
| `gravarAtomos` (`:SOBRE`, `:MENCIONA` e `:PERFILA`) | proposta montada antes da fusão penduraria átomo em nó morto — a trava é no servidor, não na tela |
| `fundir` (as mesmas três) | a fusão leva junto tudo que apontava para a perdedora; o que ficasse para trás não daria erro, daria silêncio |
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

**`status` ausente conta como ativa, e a ausência é o caso normal — não o
legado.** `Specs/slice-3.md` põe a escolha em duas opções ("ou a migration
preenche com `'ativa'`, ou o código trata ausência como ativa") e decide pela
segunda, por ser mais barata e por sobreviver a nó criado por código antigo. A
implementação seguiu: `gravarEntidades` (`atomos.ts`), que é o caminho por onde
quase toda entidade nasce, grava `id`, `nome`, `nome_normalizado` e `criado_em`
e **não** grava `status`; quem grava `status: 'ativa'` é só a semeadura manual
de `/entidades/criar`. As três leituras de entidade usam
`coalesce(e.status, 'ativa') <> 'fundida'`, e a defesa está toda ali.

Duas consequências que só se descobrem lendo o código, e por isso ficam
escritas aqui:

- **o índice `entidade_status` da 004 não é usado.** `coalesce()` sobre a
  propriedade impede o planejador de usá-lo, e propriedade nula não entra em
  índice de faixa. Ele existe, está `ONLINE` e não serve a nenhuma das três
  consultas. Não custa nada com dezenas de nós; é candidato a `DROP` numa
  migration futura, não a conserto agora;
- **`WHERE e.status = 'ativa'` não é consulta válida neste grafo.** Quem ler só
  a migration vai escrevê-la e não achar quase nada. A forma certa, em Cypher
  novo, é sempre o `coalesce`.

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
slackline com o Raffa" é `sobre: "eu"` pelas regras de tipo do `extracao-6`, e a
informação de perfil é do Raffa. A segunda é que Neo4j não guarda array de mapa
como propriedade — foi isso que forçou as listas paralelas da 003. Aresta com
propriedade ele guarda bem, e fica consultável: "todo átomo que diz o que o Rapha
sabe fazer".

**Idempotente por construção**: o `campo` vai **dentro** do `MERGE`, então o par
(átomo, campo, entidade) é a identidade da aresta e reconfirmar não a dobra
(regra 4). Fora do `MERGE`, um `SET` depois criaria uma aresta nova a cada
confirmação. Como `:SOBRE` e `:MENCIONA`, ela **atravessa alias na escrita** e
**migra na fusão** (8.2): proposta montada antes de uma fusão penduraria a marca
num nó morto, e uma fusão posterior a deixaria lá.

A travessia sozinha não bastaria, e a assimetria é o motivo: `atomosMarcados`
vai do **alias para o vencedor**, nunca ao contrário. Marca esquecida no nó
perdido sumiria do perfil do vencedor sem erro e sem aviso — e fusão não tem
desfazer.

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

### 8.4 O vetor no grafo (migration 006)

```
(:Atomo    { …, embedding: [1536 floats], embedding_modelo })
(:Entidade { …, embedding: [1536 floats], embedding_modelo, embedding_fonte })

CREATE VECTOR INDEX atomo_embedding    FOR (a:Atomo)    ON (a.embedding)
CREATE VECTOR INDEX entidade_embedding FOR (e:Entidade) ON (e.embedding)
  vector.dimensions: 1536, vector.similarity_function: 'cosine'
```

Diferente da 003 e da 005, esta migration **tem statement de verdade** — índice
se declara. Propriedade continua não se declarando no Aura Free, então os três
campos são contrato escrito, não statement.

**O tier Free aceita índice vetorial**, verificado contra a instância real
(`0adada47`, Neo4j 5.27-aura) em 2026-09-02: `CREATE` aceito, `ONLINE` em menos
de 500 ms, `db.index.vector.queryNodes` devolvendo vizinhos com score. A doc
negava só "Vector Optimization" (configuração ≥ 4 GB), que é outra coisa. **E a
cota do Free não é medida em bytes**: o teto publicado é de 200 mil nós e 400 mil
arestas, e embedding é propriedade em nó que já existe — não cria nó nem aresta.
Com 4.000 átomos o grafo vai a ~4.050 nós, 2% do teto.

O resto da configuração fica no **padrão medido** (`quantization.type: SCALAR`,
`hnsw.m: 16`, `ef_construction: 100`, `default_search_expansion_factor: 1.5`).
Explicitar qualquer um desses seria fixar número que não foi calibrado contra
nada — e é o `SCALAR` do padrão que mantém o vetor **do índice** em torno de
6 MB para 4.000 átomos, contra os ~48 MB das propriedades.

**A dimensão é a única coisa aqui que amarra.** Trocar para um modelo de outra
dimensão exige `DROP` e recriar os dois índices, por migration nova;
`embedding.ts` estoura na porta quando a dimensão não bate, para o erro aparecer
antes do banco e dizendo o que fazer.

#### Os três campos, e por que cada um existe

| Campo | Onde | Para quê |
|---|---|---|
| `embedding` | átomo e entidade | o vetor |
| `embedding_modelo` | átomo e entidade | vetores de **dois modelos no mesmo índice não dão erro: dão vizinhança errada**. Sem o campo não há como saber quais nós voltam para a fila quando `EMBEDDING_MODEL` mudar |
| `embedding_fonte` | **só** entidade | hash da string canônica. É o que torna o refresh idempotente **e dispensa gancho** nas cinco rotas que mexem em entidade |

O átomo não tem `embedding_fonte`, e não é esquecimento: texto de átomo
confirmado não muda — deleção é soft (regra 6) e o `MERGE` é por
`<sessao_id>-<índice>`. Lá `embedding IS NULL` é a trava que basta.

O `embedding_fonte` é o que faz `/perfil`, `/renomear`, `/fundir`, `/tipo` e
`/criar` não precisarem lembrar de invalidar nada: a string canônica muda, o hash
muda, e a próxima passada de `garantirEmbeddings()` reembute. O desenho oposto —
um gancho em cada rota — é um lugar a mais onde alguém esquece, e vetor velho não
dá erro.

**Sem migração de dado**: nenhum vetor é calculado pela migration. Quem preenche
são `POST /api/atomos/embutir` e `POST /api/entidades/embutir`, e é isso que faz
o retrofill custar uma chamada de rota em vez de uma reextração.

Contrato completo depois da 006:

```
(:Atomo    { id, texto, tipo, inicios_s, fins_s, ancoras, valido_em, status,
             prompt_version, modelo, criado_em,
             embedding, embedding_modelo })                              (006)
(:Entidade { id, nome, nome_normalizado, criado_em, status,
             contexto, pode_ajudar_com, fizemos_juntos,
             embedding, embedding_modelo, embedding_fonte })             (006)
```

## 9. Layout do R2

```
sessoes/<id>/manifest.json      { sessao_id, chunks: [{i, bytes, subido_em, transcrito, ext?}], finalizado }
sessoes/<id>/chunk_000.webm     áudio do bloco gravado no navegador
sessoes/<id>/chunk_000.opus     áudio importado — a extensão é a do arquivo de origem
sessoes/<id>/chunk_000.json     transcrição do bloco, offsets relativos, modelo, granularidade
sessoes/<id>/transcricao.json   final, offsets absolutos
sessoes/<id>/parcial.json       a proposta enquanto cresce: { janelas: [{n, de, ate, estado, em, procedência}], atomos, entidades, descartados }
sessoes/<id>/extracao.json      proposta: átomos ancorados, referências resolvidas (com o `porque` da camada 3b), marcas de perfil, entidades agregadas, procedência dos dois agentes
sessoes/<id>/extracao-anterior.json  a proposta que o `forcar` substituiu — só a última, para eu comparar
sessoes/<id>/correcoes.json     o que eu corrigi naquela revisão — fotografia do momento da confirmação, escrita uma vez só
calibracao/indice.json          a mesa de trabalho: as correções acumuladas de todas as sessões, teto de 500
calibracao/regras-<hash>.json   uma composição de regras aprovada — imutável para sempre
config/agentes.json             o que eu editei de cada agente: hash do prompt e modelo (slice 4.7)
config/prompt-<agente>-<hash>.json  um prompt editado — imutável para sempre; é o que o sufixo `+p<hash>` resolve
_smoke/                         objetos temporários do `pnpm smoke`, apagados no fim
```

`calibracao/` e `config/` ficam **fora** do prefixo `sessoes/` de propósito: nem
o índice de correções nem a configuração dos agentes são de sessão nenhuma. E são
dois prefixos e não um porque são duas coisas: `calibracao/` é material que o
sistema acumulou sozinho, `config/` é o que eu escrevi.

**`parcial.json` e `extracao.json` são dois objetos e não um** porque têm donos
diferentes no tempo. O parcial é escrito por vários `waitUntil` concorrentes, com
read-modify-write por etag; a proposta é escrita uma vez, com `If-None-Match`, e
essa escrita única **é** a trava de idempotência da extração (§6). Um objeto só
não poderia ser as duas coisas. O parcial fica no R2 depois de a proposta existir
— é onde o motivo de uma janela que falhou continua legível.

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
| `GET /api/sessoes` | a lista de sessões, da mais recente para a mais antiga | teto de 50; **esconde sessão sem bloco** que não esteja `gravando` — ver abaixo |
| `POST /api/sessoes/:id/chunks/:i/url` | presigned PUT de 5 min | corpo `{ext?}`; 415 fora da lista; o áudio não passa por aqui |
| `POST /api/sessoes/:id/chunks/:i/pronto` | HEAD + manifest + `waitUntil(STT → janelas)` | corpo `{ext?, duracao_s?}` |
| `POST /api/sessoes/:id/finalizar` | `finalizando`, responde na hora, fecha **e extrai** em `waitUntil` | `ja_finalizada` a partir de `em_revisao`; antes disso, é o retry da extração |
| `GET /api/sessoes/:id` | estado + transcrição (parcial enquanto processa) | polling de 2 s; `completa` é sobre a transcrição, não sobre a sessão |
| `POST /api/sessoes/:id/extrair` | dispara extração **e resolução** de uma sessão já transcrita | retry do `waitUntil` perdido; `{"forcar":true}` refaz as duas e sobrescreve |
| `GET /api/sessoes/:id/extracao` | a proposta + o mapa de blocos, para a revisão | o mapa é o que traduz offset em bloco; a referência traz o `porque` da camada 3b desde a slice 4.5; `anterior` vem como cabeçalho, e a lista antiga só com `?anterior=1` |
| `GET /api/sessoes/:id/chunks/:i/audio` | presigned GET do bloco, para o player | 404 se a chave não existe, para o `<audio>` não falhar calado |
| `POST /api/sessoes/:id/confirmar` | grava os aprovados no grafo, com `:PERFILA`, e apura as correções em `waitUntil` | `ja_confirmada` na segunda; procedência relida do R2, não do corpo; `gestos` é **opcional** e corpo sem ele confirma igual |
| `GET /api/calibracao` | o índice de correções **e as regras em vigor**, para a tela de calibração | marca `visitado_em` em `waitUntil` — best-effort, e só se o índice já existe |
| `GET /api/calibracao/sugestao` | `{ sugerir: boolean }` | **puro, nunca escreve**; a gaveta o consulta ao abrir |
| `POST /api/calibracao/rascunho` | o `calibracao-1` propõe até duas regras | **não escreve nada**; é `POST` porque gasta chamada de modelo |
| `POST /api/calibracao/regras` | a lista inteira que passa a valer, e o que ela fecha | o **único** lugar que escreve regra; lista vazia revoga tudo |
| `GET /api/entidades` | o que está no grafo, com átomos, sessões, aliases e perfil | só leitura; nó fundido vira alias do vencedor; alimenta também o seletor da revisão |
| `POST /api/entidades/duplicatas` | propõe pares que parecem a mesma coisa | **não escreve nada**; é `POST` porque gasta chamada de modelo |
| `POST /api/entidades/fundir` | `{vencedora, perdedora}` — migra arestas, marca alias | idempotente pela guarda de `status` |
| `POST /api/entidades/distintas` | `{a, b}` — a recusa que impede a pergunta de voltar | |
| `POST /api/entidades/renomear` | `{chave, nome}` — grafia velha vira alias | recusa pronome, como o confirmar |
| `POST /api/entidades/tipo` | `{chave, tipo}` — troca o label | o tipo só era editável enquanto a entidade era nova |
| `POST /api/entidades/criar` | `{nome, tipo}` — semeia um nome antes de falá-lo | cria nó órfão de propósito |
| `POST /api/entidades/perfil` | `{chave, campo, texto}` — grava um dos três campos | o único lugar que escreve perfil; corta no teto de 300 no servidor |
| `POST /api/entidades/perfil/rascunho` | `{chave, campo}` — o agente 3 propõe | **não escreve nada**; é `POST` porque gasta chamada de modelo |
| `POST /api/atomos/embutir` | dá vetor aos átomos que ainda não têm, em lote | retrofill e retry; 200 por chamada, `continua: true` enquanto sobrar; não toca no texto nem reextrai |
| `POST /api/entidades/embutir` | põe em dia o vetor das entidades, comparando `embedding_fonte` | não editar nada devolve `embutidas: 0` |
| `GET /api/agentes` | os sete com o que está em vigor, mais o desenho do fluxo | **de graça**: nenhuma chamada de modelo, nenhuma ida ao grafo; a base do git viaja junto, para a tela dizer "editado" sem segunda ida à rede |
| `POST /api/agentes/:id` | `{prompt?, modelo?}` — o que passa a valer | o **único** lugar que escreve configuração de agente; `null` revoga o campo e volta à base; recusa prompt que quebre o envelope e id de modelo fora do formato |
| `POST /api/auth/link` | pede o magic link | resposta idêntica com ou sem acerto no e-mail |
| `GET /api/auth/entrar?token=` | troca o link pelo cookie | |

Todas com `runtime = "nodejs"`. `GET /api/sessoes`, `POST /api/sessoes`,
`GET /api/sessoes/:id/extracao` e `GET /api/entidades` respondem **502** quando
Neo4j ou R2 não atendem, com a causa legível no corpo (seção 5.2).

**As duas configurações que mudam comportamento, por extenso.** Nenhuma delas é
detalhe de deploy: o teto de execução é o que decide se um `waitUntil` termina, e
`force-dynamic` é o que impede o App Router de servir estado de sessão em cache.

| `maxDuration` | Rotas |
|---|---|
| 300 s | `/chunks/:i/pronto`, `/finalizar`, `/extrair` — as três que chamam modelo dentro de `waitUntil` |
| 60 s | `/confirmar`, `/atomos/embutir`, `/entidades/embutir`, `/entidades/duplicatas`, `/entidades/fundir`, `/entidades/perfil/rascunho`, `/calibracao/rascunho` |
| padrão | todo o resto |

O 60 s do `/confirmar` é o que mais importa: a apuração de correções roda no
`waitUntil` dele, **depois** da resposta, e é dentro desse teto que ela termina
ou não (§4.11).

`dynamic = "force-dynamic"` em seis rotas, todas de leitura de estado:
`GET /api/sessoes`, `GET /api/sessoes/:id`, `GET /api/sessoes/:id/extracao`,
`GET /api/entidades`, `GET /api/calibracao` e `GET /api/calibracao/sugestao`.

**`GET /api/sessoes` esconde uma categoria de nó, e isso não é bug.** O filtro é
`chunks_total > 0 || status === "gravando"`: uma sessão criada e largada antes de
o primeiro bloco subir não é áudio nenhum e não aparece na lista. O `:Sessao`
continua no Neo4j para sempre — deleção é soft (regra 6) e nada apaga sessão —,
então existe uma categoria de nó órfão que a única tela que lista sessões não
mostra. Custo hoje: nenhum. Custo no dia em que eu contar sessões por Cypher: o
número não vai bater com a tela.

## 11. Telas

| Rota | Componente | O que mostra |
|---|---|---|
| `/` | `Gravacao` + `BotaoGravar` + `Gestao` | o círculo "Como foi seu dia?" e uma engrenagem discreta no canto — **nada mais**; gravando: ondas laterais, selo de REC, timer e um ponto de "salvo" |
| `/sessao/:id` | `Processando` | o corredor: um verbo do passo atual, sem transcrição; empurra a sessão que está parada e abre a revisão sozinho |
| `/sessao/:id/revisar` | `Revisao` | a proposta: aprovar, editar, escutar cada trecho, resolver a dúvida de quem é, confirmar |
| `/sessao/:id/transcricao` | `Leitura` | o texto literal, em pedaços enquanto transcreve — porta de serviço |
| `/sessoes` | `Sessoes` | lista de sessões: abrir, ler a transcrição, forçar re-extração — e a cor que diz o que já foi revisado |
| `/entidades` | `Entidades` | o que está no grafo; fundir duplicata, renomear, escrever o perfil |
| `/calibracao` | `Calibracao` | as regras em vigor (editáveis) e o que eu já corrigi, com o selo do agente, o `antes → depois` e o áudio à mão |
| `/agentes` | `Agentes` | o fluxo desenhado — os sete agentes, os dados entre eles e o único nó humano; clicar numa caixa abre o prompt e o modelo daquele agente |
| `/entrar` | página de login | pede o e-mail permitido |

**Clicar na sessão leva sempre para onde ainda há o que fazer.** Proposta
esperando abre na revisão; sessão `confirmada` abre no texto literal, que é o
que sobrou dela; **todo o resto vai para o corredor**, e é ele quem chama
`/finalizar` na sessão parada. `transcrito` levava ao texto literal e o corredor
não a empurrava — uma sessão que transcreveu e nunca extraiu (`waitUntil`
perdido, extração que morreu) ficava sem caminho nenhum até a revisão, com o
texto no R2 e nenhuma proposta. Ler a transcrição continua a um toque, no botão
ao lado, que é onde essa porta de serviço deve estar.

O corredor empurra `gravando`, `transcrito` e `erro` — os três estados que
ficariam parados para sempre —, e não toca em `finalizando`, `transcrevendo` nem
`extraindo`, que já estão andando por conta própria. A chamada é idempotente
(regra 4: proposta que existe não rechama o modelo) e acontece uma vez por
visita.

**Em `/` a porta de serviço inteira é uma engrenagem no meio da borda
esquerda** — sessões, entidades, agentes, calibração e subir um áudio, num menu
lateral (`Gestao`).
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

#### O PWA, que é instalabilidade e tela cheia — e mais nada

`CLAUDE.md` decide PWA como stack, e o que existe é o mínimo que faz o app
**instalar** e abrir sem barra de navegador:

| Peça | Onde | O que dá |
|---|---|---|
| `public/manifest.webmanifest` | `display: standalone`, `start_url: "/"`, `theme_color: #0d0d0d`, ícone `/icone.svg` | o "adicionar à tela de início", e o app abrindo sem barra |
| `metadata.manifest` | `layout.tsx` | é o que põe o `<link rel="manifest">` no HTML |
| `viewport.viewportFit: "cover"` | `layout.tsx` | a tela chega até a borda no iPhone, por baixo do notch |
| `matcher` do middleware | `src/middleware.ts` | manifest e ícone respondem sem cookie, senão o navegador não os busca (§7) |

**Não há service worker, não há cache offline e não há instalação promovida.**
Gravar sem rede não funciona: o `getUserMedia` até abre, mas o bloco não sobe e
`Processando` não fecha a sessão. O que protege a fala nesse caso é o IndexedDB
(§3.2), que segura o bloco até a rede voltar — proteção da fila, não do app.
Quem lê "PWA" em `CLAUDE.md` e espera funcionar no avião vai encontrar menos do
que espera, e é por isso que está escrito aqui.

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
| `--raio` | `14px` | o canto de cartão, campo e chip |
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
| gestão | **Inter** | `/sessao/:id/transcricao`, `/sessoes`, `/entidades`, `/calibracao`, `/agentes`, `/entrar` |

Ritual é o que eu faço todo dia — falar, esperar processar, revisar. Gestão é
manutenção, e a transcrição literal está com ela de propósito: é porta de
serviço, não parte do ritual.

**`RITUAL` é allowlist, e é por isso que a tabela cresce sozinha do lado da
gestão.** `/calibracao` e `/agentes` nasceram nas fatias 4.6 e 4.7 e caíram em
Inter sem ninguém marcar nada, que é o comportamento certo: manutenção é
gestão, e uma tela nova que fosse ritual é que teria de ser declarada.

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
AI_GATEWAY_API_KEY        única chave de modelo — STT, extração, resolução, perfil, deduplicação, embedding, calibração
STT_MODEL                 opcional; padrão xai/grok-stt
EXTRACAO_MODEL            opcional; padrão zai/glm-5.3-flash
DUPLICATAS_MODEL          opcional; padrão zai/glm-5.3-flash
RESOLUCAO_MODEL           opcional; padrão igual ao da extração
PERFIL_MODEL              opcional; padrão igual ao da extração
CALIBRACAO_MODEL          opcional; padrão igual ao da extração
EMBEDDING_MODEL           opcional; padrão openai/text-embedding-3-small — TEM que ser de 1536 dimensões
AUTH_SECRET, ALLOWED_EMAIL
```

`env.ts` usa getters: a variável só é exigida quando alguém de fato precisa dela,
e a falta vira erro claro em vez de `undefined` silencioso.

**`next.config.mjs` decide se o vocabulário chega à produção**, e por isso não é
arquivo de configuração qualquer:

```js
outputFileTracingIncludes: {
  "/api/sessoes/[id]/chunks/[i]/pronto": ["./config/vocabulario.txt"],
  "/api/sessoes/[id]/finalizar": ["./config/vocabulario.txt"],
},
```

`vocabulario.ts` lê o arquivo do bundle em runtime
(`readFile(join(process.cwd(), "config", "vocabulario.txt"))`). Sem a entrada
correspondente, o arquivo **não viaja** na função da Vercel e `doArquivo()` cai
no `catch` que devolve lista vazia: sem erro, sem log, sem nada na tela. É o
segundo caminho para o modo de falha que §4.4 e §14 descrevem como o pior deste
sistema — o vocabulário sumir sem avisar —, e ele não tem nada a ver com trocar
`STT_MODEL`.

A lista está correta hoje porque `transcrever()` só é alcançada por essas duas
rotas (`/chunks/:i/pronto` direto, `/finalizar` via `finalizarSessao`). **Uma
terceira rota que chame o STT perde o arquivo em silêncio**, e não há teste que
cubra isso.

**Desde a slice 4.7, `/agentes` fica por cima destas variáveis** (§4.13): o modelo
escolhido no painel vence a variável de ambiente, que por sua vez vence o padrão.
A validação é a mesma nos três caminhos — `validarIdDeModelo`, string
`provedor/modelo`, pelo Gateway. `EMBEDDING_MODEL` é a exceção e continua sendo
só variável: a dimensão está declarada na migration 006.

Não há chave de provedor (`OPENAI_API_KEY`, `XAI_API_KEY`, `STT_API_KEY`,
`LLM_API_KEY`…) — seção 4.2. `tests/gateway.test.ts` também confere isso no
`.env.example`, para o arquivo não voltar a oferecer o que a arquitetura proíbe.

## 13. Verificação

- `pnpm test` — **47 arquivos, 723 testes**, sem credencial e sem rede. A lista
  abaixo comenta os que valem uma explicação; a cobertura inteira se lê em
  `tests/`. Os que não têm bullet próprio cobrem a lógica pura da slice 1
  (chaves, manifest, estados, offsets, vocabulário, backoff, retry de rede,
  migrate) e, das fatias seguintes, a escrita no grafo e as telas:
  `atomos`, `confirmar`, `entidades`, `entidades-grafo`, `revisao`,
  `calibracao-tela`, `catalogo`, `texto`, `transcricao`, `modelos`, `extracao`
  (o parser, o envelope e a normalização de tipo — **não** a qualidade da
  extração, que é o bullet mais abaixo) e `pipeline-extracao`.
- `tests/janela.test.ts` — as três invariantes da slice 4.8 que não aparecem em
  tela nenhuma: que o `id` do átomo nunca se repete entre janelas (id repetido só
  apareceria no confirmar, sobrescrevendo átomo no grafo), que o lease impede
  dois `waitUntil` de pagarem a mesma janela — e devolve a janela quando o worker
  morre —, e que um `estende` com `ref` inválida vira descarte em vez de escrita
  no átomo errado. Mais o fatiamento: buraco no meio segura a janela, arquivo
  importado é uma janela só, `fechando` não inventa janela vazia.
- `tests/pipeline-janela.test.ts` — o gatilho: quatro blocos fecham a janela sem
  ninguém pedir, a janela seguinte recebe o que a anterior propôs, janela pronta
  não é reextraída, janela que falha deixa rastro e **não** deixa a seguinte
  passar na frente, e o fallback — janela que não fecha cai no passe único e a
  sessão não morre.
- `tests/audio.test.ts` — resolução de formato, incluindo o `.opus` do WhatsApp
  que chega com `File.type` vazio, e os limites de tamanho e duração.
- `tests/agentes.test.ts` — a **varredura** (todo `generateText`/`transcribe`/
  `embed` de `src/` pertence a um agente do registro), o **no-op** (sem override,
  todo prompt sai byte a byte igual ao de antes da 4.7), o carimbo com os dois
  sufixos, o guarda-corpo do envelope e a integridade do desenho do fluxo.
- `tests/importacao.test.ts` — `transcreverBloco` busca o áudio na extensão que o
  manifest registrou, e continua caindo em `.webm` quando o campo não existe.
- `tests/embedding.test.ts` — a string canônica da entidade e o hash dela: o que
  entra, o que é omitido, e o que faz uma entidade sair de dia. Sem rede: a
  qualidade da vizinhança em si eu avalio à mão, olhando a lista.
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
- `tests/regras.test.ts` — o teste que mais importa da 4.6: **sem regra
  aprovada, as duas metades do prompt se emendam sem nada entre elas**, e a
  versão sai sem sufixo (critério 4). Também as amarras do `calibracao-1`
  reaplicadas no parser, e a sugestão dos 21 dias (critérios 7, 8 e 9).
- `tests/processando.test.ts` — quando o corredor empurra a sessão parada, que é
  a única decisão dele que não é cosmética: empurrar demais paga uma chamada de
  modelo à toa, empurrar de menos deixa a sessão sem caminho até a revisão.
- `tests/correcoes.test.ts` — a apuração inteira, pura: que rejeitar, editar e
  trocar o sujeito viram correção (critério 1); que dois renomes na mesma sessão
  não colapsam num id só (critério 2); e que canonização **não** produz correção
  nenhuma (critério 3), que é o teste que impede o corpus de nascer envenenado.
- `tests/gestos.test.ts` — a fronteira do que o cliente manda: a chave existir é
  o gesto, e caixa e acento não são renome.
- `tests/calibracao.test.ts` — o `If-Match` com laço de retry: duas capturas
  concorrentes se somam em vez de a segunda apagar a primeira.
- `tests/confirmar-correcoes.test.ts` — a fiação, incluindo o critério 10: falhar
  ao registrar não muda a resposta do confirmar.
- **Ler o índice cru depois de confirmar uma sessão de verdade.** É a verificação
  que nenhum teste substitui, porque o que se confere é se as correções que
  aparecem lá são as que eu de fato fiz. `calibracao/indice.json` se abre no
  object browser do bucket no painel da Cloudflare; `sessoes/<id>/correcoes.json`
  guarda a mesma coisa recortada por sessão. Índice ausente depois de uma
  confirmação com correção significa `waitUntil` perdido — o log traz
  `[calibracao] sessão <id>`.
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

- **O prompt de cinco agentes passou a ter duas fontes.** O git tem a base; o R2
  tem o que eu editei em `/agentes` (§4.13). É o mesmo custo que a 4.6 já tinha
  declarado para as regras, agora multiplicado: `git revert` sozinho não reverte
  mais o prompt inteiro, e ler o prompt efetivo exige os dois lugares. O
  `prompt_version` e os snapshots imutáveis impedem a procedência de mentir, e
  `voltar ao original` é um toque — mas quem olhar só o repositório vai ver a
  metade do texto.
- **O painel não guarda histórico de edição.** `config/agentes.json` tem o que
  vale agora; os snapshots por hash guardam os textos, e não a ordem em que eu os
  escrevi. Não há linha do tempo nem desfazer de mais de um passo — o `anterior`
  do snapshot dá para andar para trás lendo, e nada na tela faz isso.
- **Trocar `STT_MODEL` pelo painel pode calar o vocabulário sem avisar.** O canal
  de nomes próprios existe só em alguns provedores (§4.4), e a tela agora deixa eu
  escolher um que não o tem. Ela avisa quando isso acontece — é o que
  `provedorAceitaVocabulario` faz na caixa do STT —, mas não impede: qual modelo
  transcreve melhor é medição minha, não regra de código.
- **`db.index.vector.queryNodes` está deprecado a partir do Neo4j 2026.04**, em
  favor da cláusula `SEARCH`. A instância é 5.27 e o procedimento funciona; quando
  a Aura subir, é uma linha a trocar em `entidades.ts`.
- **A camada 3b herda atribuição passada.** Ela sugere por semelhança com átomos
  que já são de alguém, então um erro de atribuição pode sugerir o próximo.
  Mitigado pelo `porque` na tela — um voto entre `k`, com o átomo à mão —, não
  eliminado.
- **Entidade nova, sem perfil e sem átomo, é invisível às duas camadas
  semânticas.** Só a string a acha. É estado transitório por construção — criar um
  nome pede escrever o perfil junto —, mas nada no código obriga.
- **Os pisos de 3a e 3b são ponto de partida, não calibração.** Saíram de uma
  medição de um par contra três textos não relacionados, em 2026-09-02. Quem os
  ajusta sou eu, olhando a revisão, sessão real por sessão real: piso alto demais
  faz a camada calar, baixo demais faz o agente 2 ser chamado à toa.
- **1536 floats por átomo são ~12 KB** de propriedade; 4.000 átomos, ~48 MB. Não
  há cota em bytes no Free contra a qual comparar isso, e o vetor do índice,
  quantizado em `SCALAR`, fica em torno de 6 MB. Se um dia apertar, o botão é a
  dimensão do vetor.
- **O retry cobre link instável, não link caído.** Três tentativas resolvem a
  conexão fria que falha e abre na seguinte, que é o caso medido. Rede fora de
  verdade só faz a rota levar ~33 s para dizer 502 em vez de 10 s.
- **O botão de gravar foi verificado por compilação e teste, não por olho.**
  `tests/onda.test.ts` cobre a matemática da onda, e `tsc` mais `next build`
  passam; ninguém abriu a tela e olhou o halo respirar. Não há navegador
  automatizado no projeto, e o `middleware` exige cookie para chegar em `/`.
- **Entrega do magic link**: não há provedor de e-mail configurado. O link sai no
  log do servidor e, fora de produção, no corpo da resposta. Único ponto a
  mexer: a função `entregar` em `src/app/api/auth/link/route.ts`.
- **`finalizarSessao` espera no máximo 150 s** pelos blocos pendentes; passando
  disso a sessão vai para `erro` com a lista do que faltou. O áudio fica intacto
  e o retry é manual. Eram 45 s até 02/09 — menos que uma janela de rate limit
  (§5.3), então o laço estourava o prazo sem nunca ter chance de passar. O preço
  do prazo maior é real: bloco que falha por motivo definitivo agora leva 150 s
  para ser declarado perdido.
- **O rate limit do Gateway é da conta e não some com troca de modelo** (§4.2.1,
  medido em 02/09). `limite.ts` espera 20 s e 60 s antes de desistir, o que cobre
  a janela medida (~75 s) — não cobre um limite que dure minutos. Aí a sessão vai
  para `erro` dizendo que foi rate limit, e o conserto é chamar `/finalizar` de
  novo mais tarde. **Uma sessão gravada de 15 min são 30 blocos e nunca foi
  transcrita inteira sob limite** — o que se mediu foram chamadas soltas. A
  slice 4.8 mexeu nos dois sentidos: são ~8 chamadas de extração a mais na
  conta, mas espalhadas pelos 15 minutos e sem prazo para esperar, em vez de uma
  rajada no fim. Também não medido.
- **Resolução, perfil, duplicatas e embedding não esperam o rate limit.** Só STT
  e extração chamam `comEsperaDeLimite` (§5.3). Para perfil, duplicatas e
  embedding é deliberado: saem de um clique meu e falham na minha frente. **Para
  a resolução não é** — ela roda no caminho automático, dentro da extração de
  cada janela, e um limite ativo a faz falhar em vez de esperar. A degradação é
  a certa (as menções voltam como dúvida, nunca como atribuição errada), mas é
  degradação. Conserto de uma linha, não feito ainda.
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
- **Fundir não é atômico.** São cinco consultas pela Query API, sem transação
  entre elas. Cair no meio deixa as arestas migradas e o perdedor sem alias — um
  nó de zero átomos aparecendo na lista. **Refazer a fusão cura**: a segunda
  passada não acha aresta para migrar e marca o alias.
- **Não há como desfazer um confirmar.** `confirmada` não tem transição de saída
  e nada apaga átomo (regra 6). Corrigir depois de confirmar depende de edição
  no grafo, que não existe nesta slice.
- **Forçar a extração de uma sessão confirmada quebra a procedência dela.** A
  tela não oferece o botão — `podeReextrair` (`Sessoes.tsx`) recusa `confirmada`,
  e diz por quê —, mas a rota aceita: `POST /api/sessoes/:id/extrair` com
  `{"forcar":true}` re-extrai, gasta a chamada de modelo e **sobrescreve o
  `extracao.json`** contra o qual aqueles átomos foram confirmados. O grafo fica
  intacto (o status não muda, porque `marcarEmRevisao` tem guarda), e o que se
  perde é a conferência: §4.7 promete que `id`, offsets, âncoras,
  `prompt_version` e `modelo` se releem daquele objeto, e ele passa a descrever
  uma extração que nunca foi confirmada. A proposta real vai para
  `extracao-anterior.json` e some na segunda vez. A trava está na tela e não no
  servidor, que é o desenho que §4.7 recusa em todos os outros pontos — fica
  como limite conhecido, e não como decisão boa.
- **A extração roda no mesmo `waitUntil` da transcrição.** Em dev isso é o mesmo
  processo: fechar a janela do servidor no meio mata o job e a sessão fica em
  `extraindo`. O retry é chamar `/finalizar` de novo. Desde a 4.8 vale também
  para as janelas, com a diferença de que uma janela morta assim fica `em_curso`
  no `parcial.json` até o lease vencer (120 s) — depois disso qualquer passada a
  reivindica de novo.
- **O caminho de "já conhecida" funciona, medido.** As duas primeiras entidades
  nasceram às 13:28:17 e a sessão seguinte só começou às 13:28:37: a extração
  dela encontrou as duas já lá e o segundo confirmar reaproveitou os nós em vez
  de criar novos.
- **`zai/glm-5.3-flash` é modelo de raciocínio.** Ele chegou a gastar 1720 tokens
  pensando para 122 de texto, daí `maxOutputTokens: 8000` e a segunda tentativa
  automática. Trocar é `EXTRACAO_MODEL`, sem tocar em código.
- **O alvo de 10 a 20 átomos por 15 min ainda é aposta.** O prompt está em
  `extracao-6` e as sessões julgadas até agora são curtas; a primeira sessão longa
  confirma ou derruba o número. Desde a 4.8 ele é pedido **em proporção**, janela
  a janela (`orcamentoDaJanela`), o que troca uma aposta por outra: oito janelas
  pedindo de 1 a 3 dão de 8 a 24, e é o `estende` que tem de puxar o número para
  baixo. Mais um motivo para a primeira sessão longa ser a medição que importa.
- **A janela do fim tem 120 s (`ORCAMENTO_JANELAS_MS`) para fechar**, dentro do
  `maxDuration` de 300 s de `/finalizar`, dos quais até 150 s podem ter ido nos
  blocos pendentes. Estourado o orçamento, a proposta cai no passe único — que
  então roda com pouco tempo sobrando. É o caso ruim de um caso já raro (as
  janelas anteriores já fecharam durante a gravação), e o retry continua sendo
  chamar `/finalizar` de novo.
- **O `estende` é a única coisa que segura o volume da lista, e ele é uma
  instrução de prompt** (slice 4.8). Sem passada de costura no fim, a janela que
  ignorar "não repita, estenda" produz um segundo átomo sobre o mesmo assunto —
  ou um segundo `ROTINA` —, e a revisão abre com mais itens do que devia, que é a
  condição de morte da visão §8. O código impede a corrupção (`ref` inválida vira
  descarte) mas não a duplicação; quem vê é a revisão. **Ainda não foi medido
  contra uma sessão real de 15 min.**
- **O bloco da janela não é editável em `/agentes`.** O painel edita o prompt de
  um agente, que para a extração é `BASE` (§4.13); o bloco que `blocoDaJanela`
  injeta é montado em código, com o orçamento calculado e a lista do acumulado
  dentro. Então metade do que o extrator lê hoje se ajusta sem deploy e a outra
  metade não — e a metade que não é justamente a que carrega a instrução do
  `estende`, que é a que mais provavelmente vai precisar de ajuste. Torná-lo
  editável é decidir como um prompt com partes calculadas entra num campo de
  texto, e isso é fatia, não linha.
- **A janela não sabe o que ainda vai ser dito.** Se eu digo "ela" no minuto 2 e
  só nomeio a Marina no minuto 10, a janela 1 não tinha como resolver, e o átomo
  dela nasce com o pronome — `precisa_nome` trava o confirmar até eu nomear. O
  painel de entidades da revisão conserta isso **num gesto**, reapontando todos os
  átomos (`nomeFinal()`, §4.7), e por isso não foi construída uma operação de
  renome na janela: seria antecipar máquina para o que a tela já resolve. Vale
  igual para o agente 2, que decide sobre a sessão até aquela janela (§4.8).
- **A extração agora custa oito chamadas por sessão em vez de uma.** O total de
  tokens de entrada é parecido — a fala é a mesma —, mas o prompt base viaja em
  cada janela, e a lista do acumulado cresce a cada uma. É o preço declarado da
  fatia, e a contrapartida é a espera depois de parar de falar.
- **Uma janela extraída duas vezes é possível, e é o lado barato do erro.** O
  lease de 120 s expira, e um `waitUntil` lento pode ver a própria janela
  reivindicada por outro. Duas extrações custam uma chamada; uma janela travada
  para sempre custaria a sessão. O que **não** acontece é átomo duplicado: quem
  perde a corrida do `If-Match` relê e reaplica.
- **Não haverá medida automática da qualidade da extração.** A avaliação é à mão,
  na tela de revisão; sem gabarito rotulado nem percentual de recall, regressão de
  prompt não aparece em teste — só na revisão seguinte.
- **O `keyterm` vale só para o provedor de hoje, e agora se sabe o custo disso.**
  Medido em 31/08 e de novo em 02/09: funciona no `xai/grok-stt` (§4.4). O nome
  da opção é um mapa por provedor em `modelos.ts`, com **silêncio como padrão**
  para provedor desconhecido — trocar `STT_MODEL` por um provedor fora do mapa
  faz o vocabulário não ser mandado, e não derruba a transcrição. No
  `google/gemini-3.5-transcribe` foi medido que **nenhum** dos cinco nomes de
  opção testados chega ao modelo, e sem `warning` nenhum: a falha é silenciosa
  dos dois lados. Trocar de STT sem medir isso primeiro perde a metade A da
  slice 3 sem que nada apareça na tela.
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
- **A resolução ainda não julgou um homófono de verdade.** O grafo já tem nomes
  próprios reais — as 5 sessões confirmadas de 04/09 puseram lá "Behring
  Founders", "Adapta" e "Giampaolo Lepore" —, mas nomes próprios não são a mesma
  coisa que nomes **em disputa**: enquanto nada no grafo soar como outra coisa,
  o `resolucao-2` decide de graça pela união de tamanho 1 e o modelo não é
  chamado. O caso concreto de que eu sei a resposta — a sessão com o Rapha e o
  Raffa — depende dos dois estarem **cadastrados antes da primeira menção**. Que
  nomes estão lá hoje se vê em `/entidades`, não neste arquivo.
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
  frequência, o que se ajusta é o `resolucao-2`.
- **O perfil realimenta a resolução, e isso é o risco declarado da slice.** O
  agente 2 lê o perfil para desambiguar; um perfil errado contamina toda
  atribuição futura, e átomo atribuído por engano vira evidência daquele mesmo
  perfil. As travas são o agente 3 nunca escrever, o proposto aparecer ao lado do
  atual e nunca por cima, e a escrita passar só por `POST /api/entidades/perfil`.
  Nenhuma delas impede eu mesmo aprovar um rascunho ruim depressa.
- **Sessão travada em `extraindo` não tem retry automático.** O corredor a deixa
  em paz de propósito: uma extração pode estar de fato correndo, e empurrar de
  novo pagaria uma segunda chamada de modelo pela mesma sessão. Se o `waitUntil`
  daquela extração morreu, a sessão fica girando "lendo o que você disse…" e a
  saída é o **reextrair** da lista. `transcrito` e `erro`, esses, o corredor
  empurra sozinho.
- **Para revogar uma regra aprovada, o caminho é submeter a lista sem ela** em
  `/calibracao` — não apagar o snapshot, que é imutável de propósito: é por ele
  que um átomo carimbado resolve o texto que o produziu. O custo de o prompt ter
  mais de uma fonte está no primeiro item desta seção, que conta os sete
  agentes.
- **Regra nova pode piorar o que já presta, e nenhum teste automático vê.**
  Consequência direta de não haver medida automática de qualidade — e não vai
  haver. As defesas são o teto de 12 regras, o `extracao-anterior` lado a lado,
  as amarras do `calibracao-1` e o índice fechado por `incorporada_em`: nenhuma
  delas é métrica, todas dependem do meu julgamento na revisão seguinte.
- **As primeiras regras nascerão de um punhado de correções.** Risco de
  generalizar demais um caso só; mitigado por nunca propor regra a partir de uma
  correção isolada, não eliminado.
- **A sugestão é sob demanda de olhar, não de agir.** Correção pode continuar em
  aberto indefinidamente se eu abrir `/calibracao`, ver e não pedir rascunho
  nenhum. É decisão minha, e ignorar é sempre saída válida.
- **O registro de correções é best-effort.** Ele roda no `waitUntil`, depois da
  resposta; `waitUntil` morto perde as correções daquela sessão, sem recuperação
  e sem aviso na tela. Custo assumido: o diário já está no grafo quando isso
  roda, então o que se perde é material de calibração, não fala.
- **Ruído de canonização quando `gestos` não chega.** Um corpo montado à mão, ou
  um cliente antigo, faz a apuração inferir só pelo valor: travessia de alias
  vira correção marcada como inferida (`tocado: false`). As duas travas de §4.11
  mitigam, não eliminam — e por isso `tocado` existe.
- **Um terço das correções capturadas é erro de STT, e sai etiquetado como erro
  de agente.** Medido em 2026-09-04, nas 5 primeiras sessões confirmadas: de 21
  correções, 5 eram conserto de grafia de nome próprio ("Beijing"→"Behring
  Founders", "Jean"→"Giampaolo Lepore", "Dapta"→"Adapta") e outras 2 misturavam
  grafia com edição de conteúdo. O extrator não errou nada nessas — ele copiou
  fielmente o que a transcrição dizia —, mas elas saem como `extracao` (correção
  de texto) ou `grafo` (renome), porque nenhum sinal no material distingue "o
  modelo escreveu errado" de "o microfone ouviu errado". O risco concreto é o
  `calibracao-1` ver quatro casos do mesmo padrão e propor, para o `extracao-6`,
  uma regra que conserta algo que nunca chegou até ele.
  **A saída decidida não é etiqueta nem regra de prompt**: é um agente de
  pré-resolução de entidades, rodando antes da resolução, que busca as entidades
  de menor distância no embedding e usa um modelo barato para decidir, átomo a
  átomo, qual nome citado deve ser substituído pelo do grafo. Fica para quando o
  fluxo de resolução for refinado — não é trabalho da 4.6. Até lá, o que segura
  é a amarra do `calibracao-1` e o descarte no rascunho. O paliativo que já
  funciona sozinho é o vocabulário (§4.4): os três nomes agora estão no grafo, e
  a próxima sessão já sai com eles nos keyterms.
- **A etiqueta de agente de `sujeito` e `mencao_removida` usa `sobre.conhecida`
  do átomo**, e não a referência de cada menção. É o sinal que a spec fixou, e é
  grosseiro: um átomo sobre "eu" cuja menção era candidata nova sai etiquetado
  `resolucao`. Não custa nada hoje, porque esta fatia só consome as correções de
  `extracao`; custará no dia em que o `resolucao-2` for calibrado a partir deste
  recorte. `mencao_adicionada` ficou de fora dessa regra: acrescentar uma menção
  que o extrator não listou é falha de extração por definição — não existe
  referência original para a resolução ter errado.
- **Correções de `resolucao` e `grafo` acumulam sem consumidor** até uma fatia
  futura as calibrar. Elas ocupam vaga no teto de 500 do índice como qualquer
  outra.
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
