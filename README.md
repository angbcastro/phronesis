# Phronesis

Diário falado, single-user. Ver `Specs/visao.md` para o produto, `ARCHITECTURE.md`
para como o sistema funciona por dentro e `CLAUDE.md` para as regras
invioláveis.

**Estado: gravar (ou importar), subir, transcrever e extrair.** A extração dispara
sozinha no fim da transcrição e grava a proposta no R2. Falta a revisão e o
confirmar — nada de perguntas, busca ou grafo de conteúdo, e no Neo4j o único
label que o código escreve continua sendo `:Sessao`.

## Rodar

```bash
pnpm install
cp .env.example .env.local      # preencher — ver "Setup" abaixo
pnpm migrate                    # aplica db/migrations/*.cypher
pnpm smoke                      # confere credencial, assinatura e CORS
pnpm dev
```

No Windows, o atalho **Phronesis** na área de trabalho faz o dia a dia:
`scripts/dev.ps1` confere o `.env.local`, nunca sobe um segundo servidor (se a
porta 3000 já responde, só abre o navegador — o Next escolheria outra porta, e o
CORS do bucket, que libera só a 3000, barraria o upload sem a tela dizer nada),
sobe o `pnpm dev` e abre o navegador quando a porta atende. Fechar a janela derruba o servidor. Recriar o atalho:
`scripts/atalho.ps1`.

```bash
pnpm test        # vitest — lógica pura, não precisa de credencial
pnpm typecheck   # tsc --noEmit
```

## Setup dos serviços

`pnpm test` cobre a lógica sem tocar em rede. Para gravar de verdade e checar os
critérios de aceite, é preciso ter quatro coisas de pé. `pnpm smoke` diz qual
delas está faltando.

### 1. Neo4j AuraDB Free

Criar uma instância e guardar a senha na hora — ela não é mostrada de novo.
`NEO4J_QUERY_URL` é a URL da Query API, não a de Bolt:

```
https://<id>.databases.neo4j.io/db/<banco>/query/v2
```

`<id>` é o `AURA_INSTANCEID` e `<banco>` é o `NEO4J_DATABASE` do arquivo de
credenciais — que na instância Free **não é `neo4j`**, é o próprio id. Se o
`pnpm migrate` responder `Database does not exist`, é esse segmento.

Depois: `pnpm migrate`. Instância Free pausa sozinha depois de alguns dias sem
uso; se o smoke der timeout, é isso — despause no console.

### 2. Cloudflare R2

Bucket privado, sem acesso público. Um token de API S3-compatível com permissão
de leitura e escrita nesse bucket gera `R2_ACCESS_KEY_ID` e `R2_SECRET_ACCESS_KEY`.
`R2_ACCOUNT_ID` é o id da conta Cloudflare.

**CORS é obrigatório.** O navegador faz PUT direto no R2, então sem política de
CORS o preflight barra e nenhum bloco sobe — e a tela não mostra erro nenhum,
porque a mecânica de upload é invisível. Aplicar `config/r2-cors.json` no bucket
(Settings → CORS Policy). O arquivo já traz as duas origens que existem:

```json
{ "AllowedOrigins": ["https://phronesis-ang.vercel.app",
                     "https://phronesis-ashy.vercel.app",
                     "http://localhost:3000"] }
```

São **dois buckets e duas políticas**: o de produção leva as duas origens acima,
e o de desenvolvimento (`R2_BUCKET` do `.env.development.local`) leva só o
`localhost`. Deploy de preview ganha URL aleatória e não está em nenhuma das
duas — preview serve para ver tela, não para gravar.

### 3. Vercel AI Gateway

`AI_GATEWAY_API_KEY` é a **única chave de modelo** do sistema: todo tráfego de
LLM sai por ela — STT agora, extração e deduplicação a partir da slice 2. Um
lugar para ver custo e latência, e trocar de provedor sem tocar em código.

`STT_MODEL` e `EXTRACAO_MODEL` são opcionais e apontam para outro modelo
(padrões `xai/grok-stt` e `deepseek/deepseek-v4.1-flash`). Chave
de provedor não entra aqui: ver a regra inviolável 8 em `CLAUDE.md` e a seção 4.2
de `ARCHITECTURE.md`.

Antes da primeira gravação de verdade, encher `config/vocabulario.txt` com os
nomes próprios que você fala: clientes, colegas, produtos, projetos. É o que
decide o critério de aceite 10.

### 4. Auth

`AUTH_SECRET` com 32+ caracteres aleatórios (`openssl rand -base64 48`) e
`ALLOWED_EMAIL` com o único e-mail que entra. Sem provedor de e-mail configurado,
o magic link sai no log do `pnpm dev` e no corpo da resposta fora de produção.

### Testar num celular

`getUserMedia` exige contexto seguro. `localhost` conta; um IP de LAN não. Para
gravar do telefone, use um túnel HTTPS (`vercel dev --listen`, `cloudflared`,
`ngrok`) e acrescente esse domínio ao CORS do bucket.

## Conferindo os critérios de aceite

O que dá para verificar sem gravar 15 minutos:

| # | Como |
|---|---|
| 2 | Gravar 2 min, matar a aba, reabrir — o chip mostra a duração certa |
| 3 | Retomar pelo chip e conferir no R2 que os blocos continuam a numeração |
| 4 | DevTools → Network → Offline por 1 min; o ponto vira "salvando" e nada se perde |
| 7 | Network filtrado por `r2.cloudflarestorage.com`: todo áudio sai por ali, nenhum por `/api/` |
| 8 | `sessoes/<id>/` no R2: ~120 kB por bloco de 30 s |
| 9 | Chamar `/finalizar` duas vezes com o mesmo id — a segunda devolve `ja_finalizada` |

## Como o áudio anda

```
navegador                          Vercel                    R2 / STT
─────────                          ──────                    ────────
MediaRecorder recriado a cada 30 s
  └─ blob → IndexedDB
       └─ POST /chunks/:i/url  ──▶ presigned PUT (5 min)
       └─ PUT ─────────────────────────────────────────────▶ chunk_NNN.webm
       └─ POST /chunks/:i/pronto ─▶ manifest + waitUntil ───▶ STT → chunk_NNN.json
       └─ apaga do IndexedDB
  parar
       └─ POST /finalizar ───────▶ espera pendentes,
                                   concatena offsets ───────▶ transcricao.json
       └─ GET /sessoes/:id (2 s)
```

O áudio nunca passa por function da Vercel. O bloco só some do IndexedDB depois
que o PUT confirma.

### Por que o recorder é recriado

`MediaRecorder` com `timeslice` não serve: só o primeiro blob carrega o header
WebM e o STT rejeita os seguintes. O `MediaStream` é aberto uma vez e nunca
tocado; o recorder é parado e recriado a cada 30 s. Cada bloco sai completo e
decodificável, e a lacuna é de milissegundos.

### Idempotência

Todo passo é chaveado por `sessao_id` (+ `chunk_index`):

- `chunk_NNN.json` existindo é a trava do STT — não retranscreve o que está pronto.
- O manifest é escrito com `If-Match` por etag, com releitura em conflito.
- `finalizar` numa sessão `transcrito` devolve o resultado gravado sem reprocessar.

## Mapa

```
config/vocabulario.txt      nomes próprios mandados como keyterm ao STT
db/migrations/              definição canônica do schema
scripts/migrate.ts          aplica as migrations pela HTTP Query API
scripts/smoke.ts            confere as dependências externas
config/r2-cors.json         política de CORS do bucket
src/lib/                    neo4j, r2, manifest, transcrição, estados, modelos, stt, auth
src/client/                 gravador, fila de upload, depósito IndexedDB
src/app/api/                rotas da slice
src/components/             gravação, chip de recuperação, leitura
tests/                      vitest sobre a lógica pura
```

## Pendências conhecidas

- **Entrega do magic link.** Não há chave de provedor de e-mail em `CLAUDE.md`.
  Por ora o link sai no log do servidor (e no corpo da resposta fora de produção).
  Trocar a função `entregar` em `src/app/api/auth/link/route.ts` resolve.
- **`config/vocabulario.txt`** está com três nomes de exemplo. Encher à mão antes
  de gravar de verdade — é o que decide o critério de aceite 10.
- **Sessão real de diário.** As duas que estão no banco são teste de microfone. A
  extração da slice 2 é avaliada à mão, na tela de revisão, contra sessão de
  diário de verdade — não há gabarito rotulado nem percentual de recall.
