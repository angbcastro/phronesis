# Checkpoint — 2026-08-25 (sessão 3)

Documento de trabalho, não de arquitetura. **A slice 1 está validada; a slice 2
está travada em uma coisa só, e ela é sua, não do código.** Apagar quando a
slice 2 estiver validada.

Contexto permanente está em `CLAUDE.md` (regras), `ARCHITECTURE.md` (como o
sistema funciona hoje) e `Specs/slice-2.md` (o que a slice 2 tem que ser). Este
arquivo só diz o que fazer a seguir.

---

## 0. Bloqueio único: `fixtures/` não existe

**É a única coisa entre aqui e escrever a extração.** Nenhum comando resolve —
é gravar e rotular:

```
fixtures/<nome>/transcricao.json     saída real do STT, copiada do R2
fixtures/<nome>/atomos.json          rótulo à mão: o que eu espero que saia
```

Três sessões reais, de 10 a 20 min, de diário mesmo — não teste de microfone.
As duas que estão no banco (`mt7dl…` e `mt7yx…`) são de teste: "vamos testar se
a secretária está funcionando" não tem átomo nenhum para extrair.

Sem os rótulos, "a extração presta" não é frase verificável, o critério 2 da
slice 2 não existe e o prompt vira ajuste no escuro. `CLAUDE.md`: **os rótulos
não se alteram para o teste passar.**

**Antes de gravar**, encher `config/vocabulario.txt`. Hoje tem três nomes
(`Rodozanco`, `Exxmed`, `Phronesis`). O vocabulário entra em cada chamada de STT
como `keyterm`; nome que não estiver lá sai grafado errado na fixture, e fixture
errada envenena tudo o que vem depois. Encher depois não conserta o que já foi
transcrito.

---

## 1. O que já está de pé

| | |
|---|---|
| Slice 1 | validada ponta a ponta: gravou, subiu, transcreveu, li o texto |
| R2 | CORS aplicado; PUT por presigned URL funcionando do navegador |
| STT | `xai/grok-stt` pelo Gateway, aceita webm/opus, `keyterm` passa |
| Neo4j | migration 002 aplicada: `:Atomo` e `:Entidade` com constraint e índice, **zero nó** |
| Testes | `pnpm test` 91/91, `pnpm typecheck` limpo |
| Commits | `0b8c1e4` (slice 1) e `76880de` (spec + schema da slice 2) |

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

1. **`fixtures/`** — seção 0. É o pré-requisito de tudo o que vem abaixo.
2. **Extração** — job pelo Gateway, JSON estrito, `prompt_version` e `modelo`
   em todo átomo. Os offsets **não saem do LLM**: o modelo devolve o trecho, o
   casamento com as palavras da transcrição é em código.
3. **Resolução de entidade** — casar por nome normalizado com o que já existe.
   A constraint do banco é quem garante que não duplique em corrida.
4. **Tela de revisão + player** — aprovar tudo em um toque, discordar em dois,
   escutar o trecho antes de aprovar. Menos de 60 s numa sessão de 15 min.
5. **Confirmar** — só aqui o grafo recebe alguma coisa. Idempotente por
   `<sessao_id>-<índice>`. Rejeitado não é gravado.
6. **Medir contra as fixtures** — ≥ 80% de recall, ≤ 20% de ruído. Números de
   primeira medição; o que se ajusta depois é o prompt, não o rótulo.

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
