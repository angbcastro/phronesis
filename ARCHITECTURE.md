# Arquitetura

Como o Phronesis está construído hoje. Descreve o **sistema que existe**, não o
que está planejado — para o produto ver `Specs/visao.md`, para as regras
invioláveis `CLAUDE.md`, para o escopo da fatia atual `Specs/slice-1.md`.

> **Este arquivo acompanha o código.** Toda mudança que altere fluxo, contrato,
> layout de dado, dependência externa ou fronteira de segurança atualiza este
> arquivo no mesmo commit. Ver "Manutenção deste arquivo" no fim.

**Estado: slice 1 no ar — gravar (ou importar), subir, transcrever.** Nenhum
código escreve no grafo nada além de `:Sessao`: não existem revisão, confirmação,
busca nem grafo de conteúdo. O **schema** da slice 2 está aplicado e vazio
(migration 002, seção 8).

Da slice 2 já existe a **primeira peça: extração de átomos e casamento de
offsets** (seção 4.6) — módulos testados que **ainda não estão ligados a nada**.
Nenhuma rota, nenhum gatilho, nenhum estado novo de sessão.

---

## 1. Topologia

```
┌─ navegador ─────────────┐   ┌─ Vercel ────────────┐   ┌─ serviços ───────────┐
│ MediaRecorder           │   │ middleware (auth)   │   │ Cloudflare R2        │
│ IndexedDB (blocos)      │   │ App Router /api/*   │   │  áudio + JSON        │
│ fila de upload          │   │ waitUntil (STT)     │   │ Neo4j Aura (HTTP)    │
│ React (3 telas)         │   │                     │   │  só :Sessao          │
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
| Neo4j Aura | nó `:Sessao` com estado e **chaves** do R2 | o grafo é para relação, não para conteúdo |

O áudio **nunca** atravessa uma function da Vercel (regra inviolável 1): o
navegador pede uma URL presigned e faz `PUT` direto no bucket.

## 2. Mapa dos módulos

```
src/lib/          servidor — exceto os módulos puros marcados (client), que não
                  leem credencial nem rede e por isso o navegador pode importar
  env.ts          leitura de variável de ambiente, falha cedo se faltar
  neo4j.ts        HTTP Query API (nunca driver Bolt)
  sessoes.ts      repositório de :Sessao (criar, buscar, atualizar com guarda)
  r2.ts           S3 SigV4 via aws4fetch: get/put/head, presign, PUT condicional
  chaves.ts       layout do R2 num lugar só + validação de id (barra path traversal)
  manifest.ts     verdade sobre quais blocos existem; read-modify-write por etag
  estados.ts      máquina de estados da sessão e regra de abandono
  modelos.ts      porta única de modelo: todo LLM sai pelo Vercel AI Gateway
  stt.ts          transcrição — pede o modelo a modelos.ts
  vocabulario.ts  nomes próprios → keyterms do STT
  transcricao.ts  offsets absolutos, prefixo contíguo, concatenação
  extracao.ts     átomos a partir da transcrição: prompt, JSON estrito, procedência
  offsets.ts      trecho do modelo → segundo do áudio (modelo não dá timestamp)
  pipeline.ts     transcrever bloco / finalizar sessão (o orquestrador)
  auth.ts         magic link HMAC, cookie httpOnly
  backoff.ts      backoff exponencial com jitter                          (client)
  audio.ts        formatos aceitos na importação, limites de arquivo       (client)
  rotas.ts        validação de parâmetro compartilhada pelas rotas
  tipos.ts        contratos do domínio + constantes (DURACAO_CHUNK_S = 30)

src/client/       navegador
  gravador.ts     MediaRecorder recriado a cada 30 s sobre um stream fixo
  deposito.ts     IndexedDB: blocos pendentes + sessão em andamento
  fila.ts         upload serial com retry, observável pela UI

src/components/   Gravacao (gravar), Importacao (subir arquivo),
                  ChipRecuperacao (retomar), Leitura (ler)
src/app/api/      as 6 rotas da slice + 2 de auth
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
parar ──▶ /sessao/:id
  espera a fila esvaziar
  POST /finalizar ──────────────────▶ status = finalizando, responde na hora
                                      waitUntil: espera pendentes,
                                      concatena offsets ──────────▶ transcricao.json
                                      status = transcrito
  GET /api/sessoes/:id a cada 2 s ──▶ texto parcial → texto completo
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
▶ /sessao/:id   (daqui em diante é o mesmo caminho da gravação: a `Leitura`
                 chama /finalizar com a duração e faz o polling de 2 s)
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

Antes de finalizar, `Leitura` chama `aguardarFilaVazia()` — nenhuma sessão é
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

### 4.4 Vocabulário

Metade do que se fala são nomes próprios que o modelo não conhece: "Rodozanco"
vira "rodo zanco". `config/vocabulario.txt` (uma entrada por linha, `#` é
comentário) é lido, cacheado em memória e mandado como `keyterm`, respeitando o
teto da API: 100 termos, 50 caracteres cada, sem repetir a mesma palavra em
outra caixa. Termo longo demais é descartado inteiro, nunca truncado pela
metade. Na slice 1 a lista é escrita à mão; a partir da slice 3 é gerada das
entidades do grafo.

### 4.5 Concatenação

Cada `chunk_NNN.json` traz offsets relativos ao próprio início. O offset absoluto
é `relativo + 30 × i` (`DURACAO_CHUNK_S`). `concatenar()` ordena por `i`, soma os
offsets, junta o texto e registra o mapa `{ i, texto, offset_s }`.

Enquanto processa, a tela mostra só o **prefixo contíguo** dos blocos prontos
(`prefixoContiguo`): se o bloco 2 ainda está no STT, o 3 não aparece — texto
parcial nunca é lido fora de ordem.

### 4.6 Extração de átomos

Primeira peça da slice 2. **Existe como módulo e não está ligada a nada:** ninguém
chama `extrair()` — falta o gatilho no pipeline, os estados novos da sessão, a
proposta gravada no R2, a resolução de entidade, a revisão e o confirmar. O que
existe é a lógica, testada.

`extracao.ts` faz três coisas e mais nada: monta o prompt, valida a resposta item
por item e carimba a procedência. Sai pelo Gateway como o STT, por
`modeloExtracao()`. Devolve uma `Extracao` — a proposta, que pertence ao R2 e não
ao grafo (regra 5). Cada átomo leva `id` determinístico (`<sessao_id>-<índice>`,
que é o que fará o `MERGE` do confirmar ser idempotente), `prompt_version` e
`modelo` (regra 7).

Item malformado não derruba a extração inteira: vai para `descartados` com o
motivo. Lista de descarte crescendo é sinal de prompt piorando — e é o único
sinal automático que existe, já que a qualidade é avaliada à mão na revisão.

**Os offsets não saem do modelo.** `offsets.ts` casa o `trecho` que o modelo
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

`ancora: "nenhuma"` é deliberado e **diverge do critério 3 da spec**, que pede
offset em todo átomo. Trecho que não existe na transcrição é quase sempre
afirmação que o modelo inventou, e dar a ela um offset plausível seria a mesma
procedência falsa que a regra dos timestamps existe para impedir. A revisão
mostra o átomo sem player, e ele é o primeiro a ser olhado com desconfiança.

Na granularidade `segmento` (4.3) o offset é o da frase inteira: o casamento
devolve a entrada de `palavras[]` de onde o token veio, com a precisão que o
provedor deu — nem mais, nem menos.

## 5. Estados da sessão

```
gravando → finalizando → transcrevendo → transcrito
     ↓            ↓              ↓
abandonada       erro          erro        (áudio intacto, retry manual)
```

`estados.ts` guarda as transições permitidas e `foiAbandonada()` (sem bloco novo
há mais de 10 min, `ABANDONO_MIN`). `sessoesAbertas()` devolve `gravando`,
`abandonada` e `erro` — é o que alimenta o chip de recuperação.

A guarda real da idempotência está no Cypher: `atualizarSessao(id, mudança,
sePartirDe)` só grava se o status atual estiver na lista, então um segundo
`finalizar` não rebaixa uma sessão já `transcrito`.

### 5.1 Onde o motivo de uma falha aparece

`erro` é um estado sem explicação: a tela só sabe dizer "a transcrição falhou" e
o grafo guarda o status, não a causa — `:Sessao` não tem propriedade de erro, e
acrescentar uma é mudança de schema. **O motivo existe só no log do servidor**,
com prefixo:

| Linha | Quem escreve | Quando |
|---|---|---|
| `[stt] sessão <id> bloco <i> falhou:` | rota `/chunks/:i/pronto` | o bloco falhou ao ser transcrito na subida |
| `[pipeline] sessão <id> bloco <i> não transcreveu:` | laço de espera em `finalizarSessao` | a retentativa da finalização falhou |
| `[pipeline] sessão <id>: desistiu após 45s…` | `finalizarSessao` | o prazo estourou; lista os blocos que faltaram |
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
| entrada no manifest por `i` | `manifest.registrarChunk` | reenviar o mesmo bloco não duplica nem reabre bloco transcrito |
| status na cláusula `WHERE` | `sessoes.atualizarSessao` | transição já feita não volta atrás |

`finalizar` numa sessão `transcrito` devolve `{ ja_finalizada: true }` e lê o
resultado gravado, sem reprocessar (aceite 9).

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

### 6.2 Retomada

`proximoIndice(manifest)` é `max(i) + 1`. Retomar uma sessão recuperada continua
a numeração dos blocos na mesma sessão, sem sobrescrever nada (aceite 3). O chip
que oferece a retomada é dispensável, guarda os ids dispensados em
`localStorage` e não volta a insistir — nenhuma tela desta slice mostra contagem
de dias, sequência ou lembrete.

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

## 8. Neo4j

Acesso pela **HTTP Query API**, nunca pelo driver Bolt: serverless não sustenta
pool de conexões. `NEO4J_QUERY_URL` é o endpoint completo
(`https://<id>.databases.neo4j.io/db/<banco>/query/v2`). O `<banco>` **não é
necessariamente `neo4j`**: nesta instância Aura ele é o próprio id da instância,
o valor de `NEO4J_DATABASE` no arquivo de credenciais. Errar esse segmento dá
`Database does not exist` no `pnpm migrate`. `query()` traduz o par
`fields`/`values` da resposta em objetos e transforma `errors[0]` em
`Neo4jError`.

O único label que o código escreve hoje:

```
(:Sessao { id, iniciada_em, duracao_s, status, audio_key,
           transcricao_key, chunks_total })
```

`:Sessao` é infraestrutura de gravação, não conteúdo: gravar o nó sem
confirmação não conflita com a regra 5 (nada entra no grafo sem aprovação) —
essa regra vale para átomo e entidade.

### 8.1 Schema da slice 2, aplicado e vazio

A migration `002_atomo_entidade.cypher` já rodou: `:Atomo` e `:Entidade` têm
constraint e índice no Aura, e **nenhum nó**. Nada nesta slice os escreve; quem
vai escrever é o confirmar da revisão (`Specs/slice-2.md`).

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

## 9. Layout do R2

```
sessoes/<id>/manifest.json      { sessao_id, chunks: [{i, bytes, subido_em, transcrito, ext?}], finalizado }
sessoes/<id>/chunk_000.webm     áudio do bloco gravado no navegador
sessoes/<id>/chunk_000.opus     áudio importado — a extensão é a do arquivo de origem
sessoes/<id>/chunk_000.json     transcrição do bloco, offsets relativos, modelo, granularidade
sessoes/<id>/transcricao.json   final, offsets absolutos
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
| `POST /api/sessoes/:id/finalizar` | `finalizando`, responde na hora, fecha em `waitUntil` | `ja_finalizada` na segunda chamada |
| `GET /api/sessoes/:id` | estado + transcrição (parcial enquanto processa) | polling de 2 s, `force-dynamic` |
| `GET /api/sessoes/abertas` | sessões não finalizadas com pelo menos um bloco | alimenta o chip |
| `POST /api/auth/link` | pede o magic link | resposta idêntica com ou sem acerto no e-mail |
| `GET /api/auth/entrar?token=` | troca o link pelo cookie | |

Todas com `runtime = "nodejs"`.

## 11. Telas

| Rota | Componente | O que mostra |
|---|---|---|
| `/` | `Gravacao` + `Importacao` + `ChipRecuperacao` | botão "Como foi seu dia?", link "ou subir um áudio que já gravei"; gravando: timer e um ponto de "salvo" — nada mais |
| `/sessao/:id` | `Leitura` | processamento com texto aparecendo em pedaços, depois a transcrição inteira |
| `/entrar` | página de login | pede o e-mail permitido |

`Leitura` é quem dispara `finalizar`, uma vez só (`useRef`), depois de garantir a
fila vazia — e faz o polling de 2 s até `completa`.

## 12. Ambiente

```
NEO4J_QUERY_URL, NEO4J_USER, NEO4J_PASSWORD
R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
AI_GATEWAY_API_KEY        única chave de modelo — STT, extração, deduplicação
STT_MODEL                 opcional; padrão xai/grok-stt
EXTRACAO_MODEL            opcional; padrão zai/glm-5.3-flash
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

## 14. Limites conhecidos

- **Entrega do magic link**: não há provedor de e-mail configurado. O link sai no
  log do servidor e, fora de produção, no corpo da resposta. Único ponto a
  mexer: a função `entregar` em `src/app/api/auth/link/route.ts`.
- **`finalizarSessao` espera no máximo 45 s** pelos blocos pendentes; passando
  disso a sessão vai para `erro` com a lista do que faltou. O áudio fica intacto
  e o retry é manual.
- **`config/vocabulario.txt`** ainda tem só os três nomes de exemplo.
- **A importação aceita `opus`, `ogg`, `m4a`, `mp3`, `wav` e `webm`** — a lista
  está em `audio.ts`. `.mp4` ficou de fora de propósito: quase sempre é vídeo, e
  o pipeline manda os bytes crus para o STT. Teto de 25 MB e 30 min.
- **Não foi conferido se o `xai/grok-stt` aceita Ogg/Opus, M4A, MP3 e WAV.** Até
  agora ele só recebeu `audio/webm`. Se recusar algum, a saída seria converter, e
  conversão de áudio não cabe em function serverless — a alternativa real é
  estreitar a lista. Descobre-se no primeiro arquivo de cada tipo.
- **Sessão importada não se distingue de gravada no grafo.** `:Sessao` não tem
  `origem`; quem sabe é o `ext` no manifest, no R2. Acrescentar o campo é
  migration nova, e nada hoje lê essa distinção.
- **A extração não está ligada.** `extracao.ts` e `offsets.ts` existem e são
  testados, mas nada os chama. Ligar é: gatilho no `finalizarSessao`, estados
  `extraindo`/`em_revisao`/`confirmada`, `extracao.json` no R2, resolução de
  entidade, tela de revisão e confirmar.
- **`zai/glm-5.3-flash` nunca foi chamado de verdade.** O id passa na validação
  de formato, mas se o Gateway não o conhecer a extração falha na primeira
  chamada real — o conserto é `EXTRACAO_MODEL`, sem tocar em código.
- **Transcrição longa pode truncar a resposta da extração.** Não há corte em
  pedaços nem limite de saída declarado; JSON truncado vira `ExtracaoError` na
  primeira sessão em que acontecer.
- **Não haverá medida automática da qualidade da extração.** A avaliação é à mão,
  na tela de revisão; sem gabarito rotulado nem percentual de recall, regressão de
  prompt não aparece em teste — só na revisão seguinte.
- A troca do Whisper direto pelo AI Gateway **ainda não foi validada contra o
  serviço** — falta rodar `pnpm smoke` com `.env.local` preenchido. A porta e a
  guarda estão de pé e testadas; o que não foi conferido de verdade é se
  `xai/grok-stt` aceita webm/opus, devolve timestamp por palavra e respeita
  `keyterm`.
- **Extração e deduplicação não existem** (slice 2 e 3). `modelos.ts` é a porta
  por onde vão passar e `tests/gateway.test.ts` impede que passem por fora, mas
  nenhuma linha delas foi escrita — construir adiantado o que a slice atual não
  usa é proibido.
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
