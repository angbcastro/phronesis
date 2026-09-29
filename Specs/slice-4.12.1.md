# Slice 4.12.1 — A fila da ficha anda

**Objetivo:** consertar a primeira rodada de verdade do enriquecimento em lote, que
falhou de dois jeitos em 23/09 — o "eu" estourou o teto de saída, e a fila parou
calada depois de quatro entidades — e dar à fila um ritmo próprio, semanal, que não
depende de eu lembrar de apertar o botão.

**Pronto quando:**

1. As dez entidades que ficaram em `na fila` desde 23/09 terminam sem eu tocar em
   nada além de abrir `/entidades`.
2. `{ chave: "eu" }` escreve a ficha do "eu" sem falhar.
3. Uma corrente que quebra deixa uma linha `[fila]` no log **com o status HTTP** do
   elo que não respondeu.
4. Toda segunda-feira as entidades canônicas que ganharam átomo desde a última ficha
   se reescrevem sozinhas, com a aba fechada.

## Por que agora

Porque a 4.12 rodou pela primeira vez sobre o grafo em 23/09, às 14:00 UTC, com 14
entidades marcadas, e o que o grafo de produção guardou é isto:

| entidade | estado | átomos |
|---|---|---|
| eu | **falhou** 14:01:36 — "resposta sem JSON reconhecível: {"resumo":"É o próprio dono do diário…" | 128 |
| Isinha, meu pai, Adapta | pronta, 14:01:58 → 14:02:51 | 13 / 5 / 4 |
| Phronesis, Franciele Sena, Alícia Castro, Augusto Castro, Débora Kosiniuk, Caio Brega, Nicole Borsato, Gabriel Valete, Thays, TriGo | **na fila desde 14:00:05**, e ainda lá 11 horas depois | 3–11 |

E a tela, aberta, relia `/api/entidades` a cada 4 s às 22:00 (log da Vercel) —
porque ela sonda enquanto houver `na fila`, e a fila não ia sair de lá nunca.

### Causa 1 — o raciocínio come o teto de saída

Reproduzida em 23/09 com o mesmo prompt, o mesmo modelo
(`deepseek/deepseek-v4.1-flash`, padrão do enriquecimento por herdar o da extração)
e os mesmos 128 átomos do "eu" — 14.128 tokens de entrada:

| teto (`maxOutputTokens`) | `finishReason` | raciocínio | texto |
|---|---|---|---|
| 4000 (o do código) | `length` | 3998 | 2 |
| 24000 | `stop` | 7392 | 400 |
| sem teto (outra chamada, só para medir o padrão) | `stop` | — | 8806 tokens de saída sem corte |

O código repete com o dobro (`FATOR_DE_FOLGA`, 8000) quando a primeira estoura, e a
segunda tentativa ficou a ~200 tokens de fechar: em produção ela cortou o JSON no
meio do `resumo`, que é exatamente a amostra que a linha do "eu" mostra.
`MAX_TOKENS_SAIDA = 4000` é o número de agentes que leem **uma janela**; este lê **a
vida inteira** de uma entidade, e o raciocínio cresce com o que ele lê. É o mesmo
modo de falha que a 4.8 documentou na extração (`modelos.ts`, `faltouOrcamento`).

O Gateway declara para este modelo **1.048.576 tokens de contexto e 32.768 de
saída** (`GET /v1/models`, 23/09).

### Causa 2 — o encadeamento morreu calado

Depois de gravar Adapta (14:02:51), **nenhum elo reivindicou a próxima**: Phronesis
ainda tem o carimbo de 14:00:05 que o `enfileirar` escreveu, e reivindicar o
teria trocado. O ponto da quebra está provado; **o motivo não**, porque os logs da
Vercel daquela hora já tinham expirado quando fui ler (retenção curta do plano).

O que o código garante é que qualquer motivo fica invisível e permanente:

- `encadear()` (`src/app/api/entidades/enriquecer/route.ts`) só loga **exceção de
  rede**. Um 401, 500 ou 504 do elo seguinte é uma resposta, não uma exceção — passa
  como sucesso, e a corrente acaba sem uma linha no log;
- nada retoma sozinho: o §14 declara "o conserto é apertar o botão de novo";
- a tela sonda para sempre, sem perceber que nada anda.

A corrente do confronto (mesmo mecanismo) já fez seis elos seguidos em 13/09, então
"a Vercel corta a corrente depois de N saltos" não é a explicação provável — mas
também não está descartada, e esta fatia não depende de saber qual foi.

### O que esta fatia não é

A ficha do "eu" que sai com o teto consertado **não serve** ao "eu": com teto
folgado ela devolveu 1391 caracteres a partir de ~49 mil, com `fizemos_juntos`
vazio por natureza. Isso é a `Specs/slice-10.md`. Aqui o "eu" só tem de parar de
falhar — e a ficha curta dele continua servindo ao vetor e à listagem até a 10
subir.

## As decisões

Perguntadas em 23/09.

| Decisão | Escolhido | O que foi recusado, e por quê |
|---|---|---|
| **Teto de saída** | **nenhum** — "não é necessário colocar um teto para as chamadas em termos de tokens" | "Subir o teto" (16k, 32k) só empurra a mesma falha para quando a entidade crescer. O teto que sobra é o do próprio modelo |
| **Fila parada** | **a tela retoma sozinha** | "Aviso + botão retomar" é atrito para um conserto que é sempre o mesmo e é idempotente. "Várias entidades por invocação, sem corrente" diminui saltos mas mexe mais na rota — a retomada cobre a quebra, seja qual for a causa |
| **Ritmo** | **semanal, todas as canônicas com átomo novo** | A 4.12 recusou disparo automático ("o resumo mudaria sem eu ter pedido"). **Esta decisão reabre aquela**, por pedido meu: a ficha só vale se estiver em dia, e o botão virou esquecimento. Continua valendo o desfazer de um toque, e só as `canonico = true` entram — as que eu já declarei minhas |

## 1. Sem teto de saída

Em `escreverFicha` (`src/lib/enriquecimento.ts`):

- a chamada deixa de mandar `maxOutputTokens`;
- somem `MAX_TOKENS_SAIDA`, `FATOR_DE_FOLGA` e a segunda tentativa;
- `faltouOrcamento(r)` sem teto quer dizer que o modelo bateu **o teto dele**. Vira
  `EnriquecimentoError` com `diagnostico(r)` no motivo — sem repetir, porque com
  `temperature: 0` repetir é pagar duas vezes pela mesma falha;
- `veioDoPensamento` e `textoDaResposta` continuam como estão.

`PROMPT_VERSION_ENRIQUECIMENTO` **não muda**: o prompt é o mesmo, o que mudou é o
orçamento.

O comentário de cabeçalho de `MAX_TOKENS_SAIDA` vira o registro da medição acima,
no lugar onde o número estava — quem procurar o teto encontra o porquê de não
haver um.

## 2. O encadeamento diz quando quebra

`encadear()` passa a olhar a resposta: fora de 2xx, loga

```
[fila] o elo seguinte respondeu <status>: <até 200 caracteres do corpo> — a fila para aqui
```

e segue sem lançar (quem chama está num `waitUntil`, e não há o que fazer com a
exceção além do log). A exceção de rede continua logada como hoje.

É o que faltou em 23/09: com isto, a próxima quebra diz se foi o middleware (401),
a função (500) ou a borda (504).

## 3. A tela retoma sozinha

Em `src/components/Entidades.tsx`, no laço que já relê a cada `INTERVALO_FILA_MS`:

- **A fila está parada** quando há entidade `na_fila` e **nenhuma** `rodando` com
  `enriquecimento_em` mais novo que `LEASE_MS` — em **duas leituras seguidas**. Uma
  leitura só não basta: entre gravar uma ficha e reivindicar a próxima há um
  instante sem `rodando` nenhuma, e ele não é quebra.
- Parada, a tela faz `POST /api/entidades/enriquecer { elo: true }` uma vez, e não
  repete antes de 30 s.
- `rodando` com carimbo mais velho que `LEASE_MS` também conta como parada: a
  reivindicação já a devolve à fila (`reivindicarProxima`).
- Um `console.info` na tela diz que retomou; o servidor loga
  `[fila] retomada pela tela`.

`LEASE_MS` sai de `enriquecimento.ts`, que é server-only; a tela recebe o número
por constante compartilhada em `tipos.ts` ou o repete com comentário apontando a
origem — decidir na implementação, o que não pode é os dois divergirem calados.
`enriquecimento_em` já chega à tela (`listarEntidades`, `entidades.ts`).

**O custo da corrida, declarado:** se a corrente estiver viva e lenta por um
motivo que não deixa ninguém em `rodando`, a retomada abre uma segunda corrente.
Isso é o caso que o §14 já aceita — duas invocações disputando a reivindicação —, e
o preço é uma ficha escrita duas vezes a partir dos mesmos átomos.

## 4. A batida semanal

Nova rota `src/app/api/cron/enriquecimento/route.ts`, nova entrada em
`vercel.json`:

```json
{ "path": "/api/cron/enriquecimento", "schedule": "0 7 * * 1" }
```

Segunda-feira, 07:00 UTC — depois do confronto (05:00) e do diário (06:00), para
não disputar o Gateway com eles.

**Quem entra:** `canonico = true`, não fundida, e pelo menos uma destas:

- `enriquecimento_estado` ≠ `'pronta'` (nunca rodou, ou falhou);
- a contagem de átomos ativos por `:SOBRE|:MENCIONA` ≠ `enriquecimento_atomos` —
  cobre átomo novo, rejeitado e movido por fusão;
- existe átomo ativo com `criado_em > enriquecimento_em`.

Sem migration: são propriedades da 009 (`canonico`), da 010 (`enriquecimento_*`) e
do átomo desde a 002.

**Como anda:** a batida não tem cookie, então a corrente de cookie não serve. A rota
faz o que `cron/confronto` já faz — processa em laço, dentro da mesma função, com
orçamento de 270 s (`reivindicarProxima` + `rodarElo` + `passadaDeVetores`) — e,
se o orçamento acabar com fila sobrando, **chama a si mesma** com
`Authorization: Bearer $CRON_SECRET` e `?continuacao=1`. A continuação não
enfileira de novo; só processa.

**Nenhuma porta nova:** é a mesma credencial, no mesmo prefixo `/api/cron/`, que o
middleware já aceita (§7). O segredo sai de `env.ts` no servidor e vai num header de
requisição servidor → servidor.

**O Hobby e a terceira entrada de cron:** conferir no deploy. Se o plano recusar, o
build falha antes de subir, e o que muda é esta seção (dobrar a semanal dentro do
`cron/diario`, checando o dia da semana).

## 5. Verificação

- `pnpm test`: `tests/enriquecimento.test.ts` troca o caso do retry pelo de
  `length` sem teto virando erro com diagnóstico; caso novo para a seleção da
  batida (quem entra e quem não entra, pelas três regras).
- `pnpm dev`, contra o banco de desenvolvimento: `{ chave: "eu" }` fecha.
- Forçar um 500 no elo (temporário, não commitado): o log diz o status, e a tela
  retoma em ~8 s.
- `curl -H "Authorization: Bearer $CRON_SECRET" /api/cron/enriquecimento` em dev
  enfileira só as canônicas com átomo novo, e o log mostra a continuação quando
  passa do orçamento.
- Em produção, depois do deploy: abrir `/entidades` e ver as dez de 23/09 saírem da
  fila sozinhas.

## Fora de escopo

- **O retrato do "eu"** — `Specs/slice-10.md`.
- **O confronto tem a mesma doença.** Em 23/09 ele tinha 10 átomos `falhou` e 10
  presos em `rodando` desde as 05:10, todos com "resposta sem JSON reconhecível: "
  e amostra **vazia** — o texto não veio, que é a assinatura do raciocínio comendo
  o teto. Registrado aqui como achado; o conserto é outra fatia, e a decisão de
  teto desta não se estende a ele sem eu pedir.
- Notificação fora do app (a 4.12 recusou; continua recusado).

## O que muda de arquivo

| arquivo | o quê |
|---|---|
| `src/lib/enriquecimento.ts` | sem teto; `length` vira erro; a seleção da batida (`enfileirarCanonicasComNovidade` ou nome equivalente) |
| `src/app/api/entidades/enriquecer/route.ts` | `encadear()` confere `resp.ok`; log da retomada |
| `src/app/api/cron/enriquecimento/route.ts` | **novo** — a batida semanal |
| `vercel.json` | a terceira entrada de cron |
| `src/components/Entidades.tsx` | a retomada |
| `tests/enriquecimento.test.ts` | os casos acima |
| `ARCHITECTURE.md` | §4.2 (o enriquecimento roda sem teto, e por quê), §4.12 (fila, retomada, batida), §7 (a batida que chama a si mesma), §12 (cron), §14 (limites abaixo; o §14 atual diz "o conserto é apertar o botão de novo" — deixa de ser verdade) |

## Ordem de execução

1. Sem teto + teste. Ponto de retorno: o "eu" fecha em dev.
2. `encadear()` que loga.
3. A retomada da tela.
4. A batida semanal + `vercel.json` + teste.
5. `ARCHITECTURE.md`, no mesmo commit de cada passo que mexe no que ele descreve.

## Limites que esta fatia cria (para o §14)

- **A quebra de 23/09 continua sem causa conhecida.** O que a fatia garante é que a
  próxima diz o status, e que a fila se retoma — não que ela não quebre.
- **A retomada só existe com a aba aberta, ou na segunda-feira.** Uma corrente que
  cai na terça com a aba fechada espera até eu abrir `/entidades` ou até a batida.
- **Sem teto, o custo de uma rodada é o que o modelo decidir pensar.** Para o "eu"
  hoje, ~8 mil tokens de saída; cresce com ele. O preço é de centavos por rodada no
  preço de 23/09, e é o que a `Specs/slice-10.md` reorganiza.
- **O teto que sobra é o do modelo** (32.768 de saída para o padrão). Trocar
  `ENRIQUECIMENTO_MODEL` troca esse número junto.
