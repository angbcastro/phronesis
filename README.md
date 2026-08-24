# Phronesis

Diário falado, single-user. Ver `Specs/visao.md` para o produto e `Specs/CLAUDE.md`
para as regras invioláveis.

**Estado: slice 1 — gravar, subir, transcrever.** Nada de átomos, entidades,
extração, perguntas, revisão, busca ou grafo. No Neo4j existe um único label:
`:Sessao`.

## Rodar

```bash
pnpm install
cp .env.example .env.local      # preencher
pnpm migrate                    # aplica db/migrations/*.cypher
pnpm dev
```

```bash
pnpm test        # vitest
pnpm typecheck   # tsc --noEmit
```

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
config/vocabulario.txt      nomes próprios injetados no prompt do STT
db/migrations/              definição canônica do schema
scripts/migrate.ts          aplica as migrations pela HTTP Query API
src/lib/                    neo4j, r2, manifest, transcrição, estados, stt, auth
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
- **`fixtures/`** ainda não existe: as 3 sessões reais rotuladas à mão são o
  próximo passo, e é o que a slice 2 vai usar.
