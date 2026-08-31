# Checkpoint — 2026-08-25 (sessão 3)

Documento de trabalho, não de arquitetura. **A slice 1 está validada e a slice 2
não tem bloqueio: o próximo passo é escrever a extração.** Apagar quando a
slice 2 estiver validada.

Contexto permanente está em `CLAUDE.md` (regras), `ARCHITECTURE.md` (como o
sistema funciona hoje) e `Specs/slice-2.md` (o que a slice 2 tem que ser). Este
arquivo só diz o que fazer a seguir.

---

## 0. Antes de gravar: encher `config/vocabulario.txt`

Hoje tem três nomes (`Rodozanco`, `Exxmed`, `Phronesis`). O vocabulário entra em
cada chamada de STT como `keyterm`; nome que não estiver lá sai grafado errado na
transcrição, e transcrição errada envenena a extração que vem depois. Encher
depois não conserta o que já foi transcrito.

A extração precisa de sessão de diário de verdade para ser avaliada. As duas que
estão no banco (`mt7dl…` e `mt7yx…`) são teste de microfone: "vamos testar se a
secretária está funcionando" não tem átomo nenhum para extrair. Gravar ou
importar dá no mesmo — nota de voz entra pela tela inicial, até 25 MB e 30 min.

A qualidade da extração é avaliada à mão, na tela de revisão: não há gabarito
rotulado nem percentual de recall. Ver `Specs/slice-2.md`.

---

## 1. O que já está de pé

| | |
|---|---|
| Slice 1 | validada ponta a ponta: gravou, subiu, transcreveu, li o texto |
| Extração | dispara sozinha no fim da transcrição, grava `extracao.json`, sessão vai a `em_revisao` |
| Importação | arquivo já gravado vira sessão de um bloco só — nunca testada com arquivo real |
| R2 | CORS aplicado; PUT por presigned URL funcionando do navegador |
| STT | `xai/grok-stt` pelo Gateway, aceita webm/opus, `keyterm` passa |
| Neo4j | migration 002 aplicada: `:Atomo` e `:Entidade` com constraint e índice, **zero nó** |
| Testes | `pnpm test` 114/114, `pnpm typecheck` limpo |
| Commits | `0b8c1e4` (slice 1), `76880de` (spec + schema da slice 2), `a38491b` (importação) |

---

## 2. Subir e conferir

Duplo clique no atalho **Phronesis** da área de trabalho. Ele confere o
`.env.local`, recusa subir um segundo servidor se a 3000 já responde, abre o
navegador quando a porta atende e escreve tudo em `logs/dev-<data>.log`.

```bash
pnpm smoke      # Neo4j, R2, presigned PUT, CORS, STT, auth
pnpm test       # vitest
pnpm migrate    # idempotente; reaplica 001 e 002 sem efeito
```

Login: `/entrar`. Em dev a própria página mostra o link "entrar agora (dev)".
Gravador exige `audio/webm;codecs=opus` — Chrome, Edge ou Firefox no desktop.

**Quando algo falhar, o motivo está no log**, com prefixo `[stt]`, `[pipeline]`
ou `[finalizar]` (tabela em `ARCHITECTURE.md` 5.1). A tela só sabe dizer "a
transcrição falhou" — `:Sessao` não guarda causa, e acrescentar propriedade de
erro é mudança de schema.

---

## 3. O trabalho da slice 2, em ordem

Critérios de aceite completos em `Specs/slice-2.md`.

1. ~~**Extração**~~ — feita. Job pelo Gateway, JSON estrito, `prompt_version` e
   `modelo` em todo átomo, offsets casados em código.
2. ~~**Resolução de entidade**~~ — feita. Casamento por nome normalizado, só
   leitura; a constraint do banco é quem impede duplicata em corrida.
3. ~~**Gatilho e proposta no R2**~~ — feito. `transcrito → extraindo →
   em_revisao`, `extracao.json` gravado com `If-None-Match`.
4. **Tela de revisão + player** — aprovar tudo em um toque, discordar em dois,
   escutar o trecho antes de aprovar. Menos de 60 s numa sessão de 15 min.
   Inclui a rota de presigned GET do bloco e pôr `em_revisao` no chip da home.
5. **Confirmar** — só aqui o grafo recebe alguma coisa. Idempotente por
   `<sessao_id>-<índice>`. Rejeitado não é gravado.
6. **Avaliar na revisão** — ler o que saiu de uma sessão real e decidir. Muita
   rejeição ou muita edição quer dizer prompt ruim; o que se mexe é o prompt.

A máquina de estados muda: `transcrito → extraindo → em_revisao → confirmada`.
`transcrito` deixa de ser terminal e `em_revisao` passa a aparecer no chip da
home.

---

## 4. Decisões já tomadas — não relitigar

| Decisão | Por quê |
|---|---|
| As 2-4 perguntas do ritual ficam para a slice 3 | dependem de histórico; com 3 sessões sairiam genéricas, e pergunta burra é uma das formas de morte da visão |
| `:ATUALIZA` / `:CONTRADIZ` / `:CONFIRMA` ficam para a slice 3 | mesmo motivo: não há o que contradizer ainda |
| Tocar o áudio no trecho **entra** na slice 2 | fecha o critério 6 da slice 1, que passou sem player, e é o que torna a revisão confiável |
| `nome_normalizado` único entre todas as entidades | trava contra duplicata em corrida; o custo é recusar projeto e pessoa homônimos |

---

## 5. O que vai morder

- **Granularidade `segmento`.** O `xai/grok-stt` não devolve `words`, devolve
  segmentos — mas de uma palavra cada (65 num bloco de 30 s). Na prática a
  precisão é por palavra e o campo subdeclara. O átomo tem que registrar o que
  recebeu, não o que gostaria de ter recebido.
- **`STT_MODEL=` vazio no `.env.local`.** `??` não pega string vazia; `||`
  pega. `modelos.ts` está certo, e o smoke já foi consertado — mas o próximo
  lugar que ler essa variável vai cair no mesmo buraco.
- **Aura Free não tem constraint de existência.** `prompt_version` e `modelo`
  obrigatórios (regra 7) são responsabilidade do código e dos testes.
- **`waitUntil` em dev** roda no mesmo processo: fechar a janela do servidor no
  meio da extração mata o job. A sessão fica em `extraindo` e precisa de retry.

---

## 6. Fora de escopo

Busca, tela Perguntar, `:Foco`, visualização de grafo, deduplicação semântica e
vocabulário gerado das entidades são slice 3 — **não existem e não devem ser
construídos agora**.
