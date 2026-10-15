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
  /extracao/eventos + status a 750 ms ▶ acompanha a proposta
  1º átomo ──▶ /sessao/:id/revisar    (replace: o corredor não volta)
```

### 3.0 O caminho curto: arquivo importado

Nota de voz do WhatsApp, gravador do celular, áudio antigo no disco. **O arquivo
é fatiado em blocos de 30 s no navegador — os mesmos da gravação — e sobe um
`chunk_NNN.wav` por bloco.**

```
navegador                             Vercel                       R2 / Gateway
─────────                             ──────                       ────────────
<input type=file>
  formatoDeArquivo(nome, mime)        (audio.ts — recusa antes de qualquer rede)
  duração pelo <audio>                (NaN em container sem cabeçalho: passa)
  fatiarArquivo(arquivo)              (fatiador.ts — decodifica a 16 kHz,
                                       renderiza cada 30 s, encoda WAV;
                                       null se o navegador não decodifica)
POST /api/sessoes ──────────────────▶ CREATE (:Sessao{gravando}) ─▶ Neo4j
loop por bloco, 2 de cada vez:
  POST /chunks/:i/url  {ext:"wav"} ─▶ presigned PUT, 5 min
  PUT ────────────────────────────────────────────────────────────▶ chunk_NNN.wav
  POST /chunks/:i/pronto {ext:"wav"} ▶ HEAD, manifest += bloco com ext
                                      waitUntil: transcrever ─────▶ STT
                                          e, na sequência,
                                        candidatas + avancarJanelas
sessionStorage duracao:<id>
▶ /sessao/:id   (daqui em diante é o mesmo caminho da gravação: `Processando`
                 chama /finalizar com a duração, acompanha a proposta e abre a
                 revisão sozinho)
```

**Por que fatiar.** Com **um bloco só**, `janelasDe` devolveria uma janela que
*é* a sessão inteira e `blocoDaJanela` devolveria string vazia: a extração por
janela ficaria **inerte** no caminho importado — o que deve ser nove chamadas de
2 min viraria uma chamada de 17 min —, e o RAG por bloco junto, porque
`candidatas_NNN.json` é chaveado por bloco.

Fatiar só o texto da transcrição custaria menos — uma chamada de STT em vez de
trinta e cinco — e foi **recusado**: manteria dois conceitos de bloco no sistema
para sempre, áudio e lógico, e cada fatia futura teria de lembrar da diferença.

**Trinta segundos, e não dois minutos**, porque com 30 s **nada rio abaixo
muda**: `offsetDoBloco` continua `30 × i`, `janelasDe` continua contando blocos,
`chaveChunkCandidatas`, `localizarNoAudio`, `concatenar`, `prefixoContiguo` e os
dois players continuam como estão. Dois minutos dariam nove chamadas de STT em
vez de trinta e cinco, ao custo de generalizar as duas primeiras.

**WAV 16 kHz mono, PCM 16-bit.** `wav` já estava em `FORMATOS` (`audio.ts`), então
`extensaoAceita` e `chaveChunkAudio` aceitam sem uma linha nova, e o cabeçalho de
44 bytes se escreve à mão. WebCodecs mais uma biblioteca de muxing daria ~3 MB
em vez de ~34 MB numa sessão de 17 min, ao custo de dependência nova e suporte
irregular no Safari — e isto é um PWA de celular. O preço está no §14.

**O `null` do fatiador é o que garante que nada piora.** `decodeAudioData` que
falha, ou render que estoura no meio, devolve `null`, e a importação sobe o
arquivo inteiro em `i = 0` com a extensão de origem — o caminho de sempre,
inteiro. É o mesmo cuidado que `duracaoDoArquivo` já tem ao devolver `NaN`. A
diferença **não aparece na tela**: só no log (§14).

**Dois blocos por vez.** Trinta e cinco `/pronto` em sequência disparariam trinta
e cinco chamadas de STT em cerca de um minuto, onde a gravação espalha as mesmas
trinta e cinco por dezessete minutos reais — a rajada que a extração por janela
evita, chegando pela porta dos fundos. `BLOCOS_SIMULTANEOS = 2` limita a frente,
e `comEsperaDeLimite` (§5.3) absorve o resto. O manifest aguenta a concorrência
(§6.1) e a ordem de chegada não importa: a janela só fecha sobre prefixo
contíguo.

**Sem IndexedDB.** A fila local (3.2) existe para não perder fala quando a aba
fecha no meio da gravação. Um arquivo importado já está no disco de quem o
escolheu: se o PUT falhar, `Importacao` tenta 3 vezes com o mesmo backoff e
depois pede o arquivo de novo.

**A duração não vem por bloco.** `/pronto` grava `duracao_s` na sessão a cada
chamada, e mandar `30` em cada bloco deixaria a sessão de 17 min registrada como
30 s. O caminho fatiado **não manda o campo**, e vale `chunks.length *
DURACAO_CHUNK_S` — a conta da gravação, correta para blocos de 30 s. Quem manda a
duração real é o `/finalizar`, uma vez só, com o valor do `sessionStorage`. O
campo continua existindo em `/pronto` e é usado pelo caminho de fallback, onde o
bloco de fato tem duração arbitrária.

### 3.1 Por que o recorder é recriado

`MediaRecorder` com `timeslice` **não serve**: só o primeiro blob carrega o
header WebM; os seguintes não são decodificáveis sozinhos e o STT rejeita.

O `MediaStream` é aberto uma vez em `iniciar()` e nunca é tocado. A cada 30 s o
recorder é parado (`onstop` emite o bloco) e um novo é criado sobre o mesmo
stream. Cada bloco sai completo e decodificável; a lacuna é de milissegundos.

Formato: `audio/webm;codecs=opus`, mono, 24 kbps — ~120 kB por bloco de 30 s,
~4 MB numa sessão de 20 min (aceite 8).

**O gravador avisa quando o microfone para de ouvir** (`aoMicrofone`): a faixa
termina (aparelho desconectado, permissão revogada), o sistema a silencia
(`mute` — uma ligação tomando o microfone; `unmute` avisa a volta), ou o
`MediaRecorder` erra. Antes o erro ia só para o console e a faixa terminando não
era ouvida: fala perdida sem aviso. A gravação **não para sozinha** — o que já
foi gravado está nos blocos, e quem guarda é o "parar"; a tela de gravar diz
isso na linha do "salvo" (§11). Parar de propósito também termina a faixa, e
por isso nada é avisado depois do `parar()`.

### 3.2 Durabilidade da fila

`fila.ts` sobe até três blocos por vez (`FRENTES`), na ordem em que foram falados:

1. `enfileirar` grava no IndexedDB **antes** de qualquer rede;
2. pede a presigned, faz o `PUT`, chama `/pronto`;
3. só então `removerChunk`.

Falha em qualquer ponto → backoff exponencial com jitter (`backoff.ts`, base 1 s,
teto 30 s) e o bloco continua no depósito. `window.addEventListener("online")`
acorda a fila. Rede caindo por um minuto atrasa a subida e não perde bloco
(aceite 4). A fila marca `offline` quando um envio falha sem rede, e a tela de
gravar o mostra: "sem rede — guardando no aparelho" (§11).

Antes de finalizar, `Processando` chama `aguardarFilaVazia()` — nenhuma sessão é
fechada com bloco ainda por subir.

