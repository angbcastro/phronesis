# Slice 1 — Gravar, subir, transcrever

**Objetivo:** gravar áudio no navegador, os pedaços chegam no R2 enquanto a gravação acontece, a transcrição fica pronta quase junto com o fim da gravação, e eu leio o texto na tela.

**Pronto quando:** eu gravo 15 minutos falando, fecho a aba no meio, reabro, retomo, finalizo, e leio a transcrição inteira sem ter perdido nada.

## Fora de escopo

Nada de átomos, entidades, extração, perguntas, revisão, busca ou grafo. No Neo4j existe **um único label nesta slice: `:Sessao`**. Não criar `:Atomo` nem `:Entidade` ainda, nem "deixar preparado".

## Fluxo

1. Home: botão grande, "Como foi seu dia?". Um toque começa a gravar.
2. Durante: timer e um ponto discreto de "salvo". Nada mais na tela — sem waveform, sem contador de blocos, sem barra de progresso. A mecânica de upload é invisível.
3. Parar → tela de processamento com a transcrição aparecendo em pedaços conforme fica pronta.
4. Fim: transcrição completa em tela. Só isso — sem ação seguinte nesta slice.

## Detalhe crítico da captura

`MediaRecorder` com `timeslice` **não serve aqui**: só o primeiro blob carrega o header WebM, os seguintes não são decodificáveis sozinhos e o STT rejeita. 

Fazer assim: um único `MediaStream` (`getUserMedia`), aberto do começo ao fim. A cada 30 s, `stop()` e `new MediaRecorder(stream)` — o recorder é recriado, o stream nunca é tocado. Cada bloco sai completo e decodificável. A lacuna é de milissegundos e imperceptível na fala.

Formato: `audio/webm;codecs=opus`, mono, 24 kbps.

## Vocabulário do STT

Metade do que eu falo são nomes próprios que o Whisper não conhece: clientes, colegas, produtos. "Rodozanco" vira "rodo zanco", "Exxmed" vira "ex med". Transcrição que eu preciso corrigir é transcrição que mata o sistema.

Manter `config/vocabulario.txt` com nomes de pessoas, empresas e projetos, injetado como prompt inicial em cada chamada de STT. Nesta slice a lista é escrita à mão; a partir da slice 3 ela passa a ser gerada das entidades do grafo.

## Estados da sessão

```
gravando → finalizando → transcrevendo → transcrito
                ↓                ↓
            abandonada         erro       (STT falhou; áudio intacto, retry manual)
        (sem chunk novo há > 10 min)
```

## Layout no R2

```
sessoes/<id>/manifest.json          { chunks: [{i, bytes, subido_em, transcrito}], finalizado }
sessoes/<id>/chunk_000.webm
sessoes/<id>/chunk_000.json         transcrição do bloco, offsets relativos
sessoes/<id>/transcricao.json       final, offsets absolutos
```

## Rotas

| Rota | Faz |
|---|---|
| `POST /api/sessoes` | cria `:Sessao {status:'gravando'}`, devolve `id` |
| `POST /api/sessoes/:id/chunks/:i/url` | devolve presigned PUT para o R2 |
| `POST /api/sessoes/:id/chunks/:i/pronto` | atualiza manifest e dispara transcrição do bloco via `waitUntil` |
| `POST /api/sessoes/:id/finalizar` | status → `finalizando`, espera blocos pendentes, concatena, status → `transcrito` |
| `GET /api/sessoes/:id` | estado + transcrição parcial (front faz polling de 2 s) |
| `GET /api/sessoes/abertas` | sessões não finalizadas, para o chip de recuperação |

O áudio **nunca** passa pela function: o cliente faz PUT direto no R2 com a presigned URL.

## Transcrição paralela

Cada bloco é transcrito assim que sobe, não no fim. Quando eu paro uma gravação de 15 minutos, só falta o último bloco — a transcrição completa aparece em poucos segundos. É isso que faz o sistema parecer rápido.

Concatenação: os offsets de cada bloco são somados a `30 × i` para virarem absolutos.

## Recuperação

`chunk_i` só é apagado do IndexedDB depois que o PUT confirma. Ao abrir o app, `GET /api/sessoes/abertas` alimenta o chip da home: *"sessão de 12 min não finalizada — retomar, processar ou descartar"*. Retomar continua a numeração dos blocos na mesma sessão.

O chip é dispensável e não volta a insistir. Nenhuma tela desta slice mostra contagem de dias, sequência, lembrete ou qualquer sinal de dia pulado.

## Neo4j nesta slice

```
(:Sessao { id, iniciada_em, duracao_s, status, audio_key,
           transcricao_key, chunks_total })
```

O manifest vive no R2. O texto da transcrição vive no R2. No grafo só a chave.

`:Sessao` é infraestrutura, não conteúdo: gravar o nó sem confirmação não conflita com a regra de que nada entra no grafo sem eu aprovar — essa regra vale para átomos e entidades, a partir da slice 3.

Bucket privado, sem acesso público. Presigned URLs com validade de 5 minutos, emitidas uma por bloco.

## Critérios de aceite

1. Gravação de 15 min sobe 30 blocos; nenhum bloco falta no manifest.
2. Matar a aba no minuto 7 e reabrir: chip de recuperação aparece com a duração certa.
3. Retomar sessão recuperada continua a numeração dos blocos, sem sobrescrever.
4. PUT falhando (rede off por 1 min) faz retry com backoff e não perde o bloco.
5. Ao finalizar, a transcrição completa aparece em menos de 10 s numa sessão de 15 min.
6. Offsets absolutos batem: clicar num trecho no minuto 9 toca o áudio no minuto 9.
7. Nenhuma requisição de áudio passa por rota da Vercel (conferir no Network).
8. Uma sessão de 20 min gera no máximo ~4 MB no R2.
9. Chamar `finalizar` duas vezes, ou subir o mesmo bloco duas vezes, não duplica nada nem reprocessa em cima do resultado pronto.
10. Numa sessão real de diário, todo nome próprio do `vocabulario.txt` sai grafado certo, e eu leio a transcrição inteira sem vontade de corrigir nada.

## Depois desta slice

Gravar (ou importar) sessões reais de diário. A slice 2 extrai átomos delas, e a qualidade da extração eu avalio à mão, na tela de revisão.

## Como ficou

O que o `ARCHITECTURE.md` contava desta fatia — datas, medições, o que era
antes —, movido quase literal quando ele passou a descrever só o presente
(`Specs/documentacao.md`).

### Do §14 (limites conhecidos)

- **Não foi conferido se o `xai/grok-stt` aceita Ogg/Opus, M4A, MP3 e WAV.** A
  lista de importação promete os cinco; até agora ele só recebeu `audio/webm`.
  Se recusar algum, a saída seria converter, e conversão de áudio não cabe em
  function serverless — a alternativa real é estreitar a lista. Descobre-se no
  primeiro arquivo de cada tipo.

### Do §4.1–4.7 (o pipeline)

**Todo tráfego de LLM deste sistema sai pelo Vercel AI Gateway** — STT hoje,
extração e deduplicação a partir da slice 2, e o que vier depois. Uma chave
(`AI_GATEWAY_API_KEY`), um lugar para ver custo e latência, e trocar de provedor
é mudar uma variável de ambiente, sem tocar em código. É a regra inviolável 8.

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
