# Slice 4.10 — O arquivo importado entra pela mesma porta

**Objetivo:** que o áudio importado percorra **exatamente** o caminho do áudio
gravado — fatiado em blocos de 30 s, um `chunk_NNN` por bloco —, e que uma
resposta cortada do modelo deixe de custar a sessão inteira.

**Pronto quando:** eu importo de novo o áudio de 17 min e o log mostra
`[janela] sessão <id> janela 0 (blocos 0-3)`, nove janelas fechando, nenhuma
linha `não fecharam`, e a proposta chegando à revisão sem passar pelo passe
único. E quando uma resposta cortada aparece no log como
`resposta cortada, N átomo(s) recuperado(s)` em vez de virar janela perdida.

## Por que agora

**Porque a primeira extração real de uma sessão longa foi medida, e ela custou
quatro chamadas de modelo para entregar uma.** Em 07/09 a sessão
`mtqoeoqh3e3724514q1f` (1044 s) foi rodada de ponta a ponta e terminou em
`em_revisao` com 9 átomos bons, 6 min 46 s depois. As três primeiras chamadas
foram jogadas fora:

| # | chamada | teto | raciocínio | texto | resultado |
|---|---|---|---|---|---|
| 1 | janela 0 | 8000 | **8000** (100%) | 0 char | sem JSON |
| 2 | janela 0 | 16000 | 12782 (80%) | 11351 char | JSON cortado na linha 107 |
| 3 | passe único | 8000 | 7152 (89%) | 2881 char | JSON cortado |
| 4 | passe único | 16000 | — | — | **passou** |

Três coisas saíram dessa medição, e as três são desta fatia.

**A janela não existe no caminho importado.** `Importacao.tsx` sobe o arquivo
inteiro em `i = 0` — "Não fatiamos", diz o docstring dele, e era decisão
consciente quando foi escrito. Com um bloco só, `janelasDe` devolve uma janela
que **é** a sessão inteira, e `blocoDaJanela` devolve string vazia
(`unica && jaPropostos.length === 0`). A slice 4.8 é **inerte** aqui: o que era
para ser nove chamadas de 2 min é uma chamada de 17 min. E a 4.9 junto:
`candidatas_NNN.json` é chaveado por bloco, então o RAG roda **uma vez para 17
minutos** em vez de a cada 30 s.

**O fallback repete a chamada que acabou de falhar.** Sessão de um bloco tem
janela == sessão, então o "passe único" de `propostaDaSessao` é praticamente a
mesma chamada (entrada 5210 contra 4780). As chamadas 3 e 4 da tabela são a
repetição das 1 e 2 — duas chamadas gastas, sob um rate limit de free tier que
foi *a* restrição medida no dia, para chegar ao mesmo lugar.

**Truncou, perdeu tudo.** A chamada 2 devolveu 11351 caracteres: ~107 linhas,
cerca de dez objetos de átomo **completos** e um pela metade. `isolarJson` faz
`lastIndexOf("}")`, o `JSON.parse` estoura, e `parsearResposta` descarta os dez.
Fechar o array no último elemento completo teria salvado quase a sessão e
economizado as chamadas 3 e 4.

**O que não está quebrado, e esta fatia não toca:** o STT (17 min inteiros,
timestamps por palavra), a ancoragem (51 trechos, 50 `exata`, de 4 s a 1023 s),
a guarda do `"eu"` da 4.8.1, o `porque` do RAG da 4.5, o `HISTORIA` da migration
007, a procedência (`extracao-8` / `resolucao-4`) e a minha voz no texto do
átomo. Os 840 testes passam — **o que falhou está inteiro fora do que o suite
alcança**, e é por isso que precisou de uma sessão real para aparecer.

**Mais um pedido, que não vem do diagnóstico:** um botão em `/sessões` para
apagar sessão. Entra aqui porque a fatia vai gerar sessões de teste com 35
objetos cada, e limpar à mão no console do R2 não é caminho.

## As decisões

Perguntadas antes de a fatia começar, porque nenhuma se infere do código.

| Decisão | Escolhido | O que foi recusado, e por quê |
|---|---|---|
| **Como consertar a janela** | **fatiar o áudio importado** | "Blocos virtuais na transcrição" — manter 1 objeto de áudio e fatiar só o texto — custaria bem menos: 1 chamada de STT em vez de 35, zero costura, nenhum código novo no cliente. Recusado porque manteria **dois conceitos de bloco** no sistema para sempre, áudio e lógico, e cada fatia futura teria de lembrar da diferença. O bug desta fatia **é** o preço de dois caminhos que divergem em silêncio; consertá-lo criando uma terceira divergência é trocar de dívida |
| **Tamanho do bloco** | **30 s, igual à gravação** | 2 min daria 9 chamadas de STT em vez de 35 e um nono das costuras, mas exigiria generalizar `offsetDoBloco` (hoje `30 × i`) e `janelasDe` (hoje conta blocos, não segundos). Com 30 s **nada rio abaixo muda** — e "nada rio abaixo muda" é o argumento inteiro desta decisão |
| **Formato do bloco fatiado** | **WAV 16 kHz mono** | `wav` já está em `FORMATOS` (`src/lib/audio.ts`) com mime `audio/wav`: `extensaoAceita` e `chaveChunkAudio` aceitam sem uma linha nova, e o cabeçalho de 44 bytes se escreve à mão. WebCodecs + biblioteca de muxing daria ~3 MB em vez de ~34 MB, ao custo de dependência nova e de suporte irregular no Safari — e isto é um PWA de celular |
| **Arquivo que o navegador não decodifica** | **cai no caminho de hoje** | Recusar o arquivo seria regressão: hoje ele importa. `fatiarArquivo` devolve `null` e a importação sobe o arquivo inteiro em `i = 0`, como sempre fez. É o mesmo cuidado que `duracaoDoArquivo` já tem ao devolver `NaN` |
| **O botão de apagar** | **a sessão inteira** | "Só o áudio" era mais conservador e reclamaria o espaço do R2 do mesmo jeito. Recusado: o que incomoda é sessão de teste acumulando na lista, não byte no bucket |
| **O grafo no apagar** | **fica intacto** | Regra 6 proíbe `DELETE` em átomo, e `DETACH DELETE` no `:Sessao` levaria junto o `GEROU` e orfanaria os átomos de uma sessão confirmada. O nó fica, marcado com `descartada_em`; a procedência passa a apontar para arquivos que não existem mais — **consequência aceita, não descuido** |
| **O teto de saída** | **não muda** | Com janela de 2 min e salvamento, o estouro deve deixar de acontecer. Mexer no teto **e** no salvamento na mesma fatia esconderia qual dos dois funcionou |

## 1. O salvamento do JSON cortado

`src/lib/extracao.ts`. É o passo mais barato e o de maior retorno: não mexe em
prompt, não mexe em modelo, e é função pura.

**A função nova**, ao lado de `isolarJson`:

```ts
/** O maior prefixo válido de um JSON cortado no meio, ou null. */
export function fecharJsonTruncado(bruto: string): string | null
```

Varre o texto com uma máquina de estados mínima — dentro/fora de string,
escape, profundidade de `{}` e `[]` — guardando o índice logo depois de **cada
elemento completo do array**. Corta no último e fecha com `]` e `}`. Devolve
`null` se nenhum elemento chegou a fechar.

Ela existe separada de `isolarJson` de propósito: `isolarJson` responde "onde
começa e termina o JSON nesta resposta", e a resposta dela para um texto cortado
está **certa** — o problema é que não há fim. Misturar as duas perguntas faria
`isolarJson` mentir sobre respostas íntegras.

**Onde entra:** no `catch` do `JSON.parse` de `parsearResposta`, que hoje só
lança. Tenta o estrito; falhando, tenta o salvamento sobre a string já sem cerca.
`RespostaExtrator` ganha `truncada?: boolean`.

**A mudança de comportamento que importa:** hoje a segunda tentativa que trunca
lança `ExtracaoError` e a janela morre. Passa a **usar o que foi salvo**. E entre
primeira e segunda tentativa fica a melhor das duas pelo número de átomos
recuperados — na medição, a chamada 2 trazia ~10 átomos e foi descartada em favor
de uma terceira que trouxe menos.

**O que sobe junto:**

- log próprio: `[extracao] sessão <id>: resposta cortada, N átomo(s) recuperado(s)`;
- `Extracao` ganha `truncada?: boolean`, e a revisão mostra o aviso. Eu julgo a
  lista à mão, e "esta proposta veio de uma resposta cortada" muda o julgamento —
  sem o aviso, uma lista curta parece decisão do modelo e não acidente de teto.

**Testes** (`tests/extracao.test.ts`, puros, sem rede): cortado no meio de uma
string; no meio de um objeto; logo depois de uma vírgula; com cerca ```` ```json ````
aberta e nunca fechada; com chave `}` dentro de uma string do texto do átomo (o
caso que uma implementação ingênua erra); sem nenhum elemento completo → `null`;
e um JSON íntegro passando pelo caminho estrito **sem tocar** no salvamento.

## 2. O botão de apagar em `/sessões`

**`src/lib/r2.ts`.** O módulo não tem `DELETE` nem `LIST` hoje:

```ts
export async function remover(key: string): Promise<void>
```

`DELETE` assinado por `cliente().fetch`, com `comRetry(..., { leitura: true })` —
`DELETE` é idempotente, então repetir depois de a requisição sair é seguro, que é
exatamente o que `leitura` autoriza. 204 e 404 são sucesso.

**`src/lib/chaves.ts`.** Sem `LIST`, as chaves se enumeram:

```ts
export function chavesDaSessao(m: Manifest): string[]
```

As fixas — `manifest`, `transcricao`, `parcial`, `extracao`,
`extracao-anterior`, `correcoes` — mais, para cada chunk do manifest,
`chaveChunkAudio(id, i, extensaoDoChunk(m, i))`, `chaveChunkTranscricao(id, i)` e
`chaveChunkCandidatas(id, i)`. Mora aqui porque "um lugar só monta chave".

**`src/lib/sessoes.ts`.** `descartarSessao(id)` grava `descartada_em`;
`todasSessoes` ganha `WHERE s.descartada_em IS NULL`.

**`src/app/api/sessoes/[id]/route.ts`** — handler `DELETE` no arquivo que já tem
o `GET`:

1. **guarda:** 409 se `!terminouDeProcessar(status)`. Apagar no meio do pipeline
   correria com um `waitUntil` vivo, que voltaria a gravar o que acabou de sumir;
2. carrega o manifest, enumera, apaga tudo — **o manifest por último**. Apagá-lo
   primeiro perderia a lista de chunks e deixaria 35 objetos inalcançáveis, já
   que não há `LIST` para reencontrá-los;
3. `descartarSessao(id)`.

**`src/components/Sessoes.tsx`** — terceiro botão, reusando o padrão de dois
toques que o `reextrair` já tem (`armado === s.id ? "apagar?" : "apagar"`), e
tirando a linha da lista no sucesso. O padrão existe porque "um toque acidental
numa lista custaria esse trabalho" — aqui custaria a sessão.

**Migration 008.** `descartada_em` é propriedade nova em `:Sessao`. Não pede
constraint nem índice, mas `db/migrations/` é a definição canônica do schema e o
`CLAUDE.md` proíbe inferir propriedade a partir do código. **Proposta, e aprovada
antes de rodar.**

## 3. O fatiamento da importação

**`src/client/fatiador.ts`, novo.** Espelha `src/client/gravador.ts` e reusa o
`DURACAO_CHUNK_MS = 30_000` dele.

```ts
export async function fatiarArquivo(arquivo: File): Promise<Blob[] | null>
```

1. `decodeAudioData` sobre o `ArrayBuffer` do arquivo;
2. para cada janela de 30 s, renderizar **aquele trecho** num
   `OfflineAudioContext(1, 30 * 16000, 16000)`. Reamostra por bloco e nunca
   segura um segundo buffer do tamanho do arquivo: 17 min a 48 kHz float32 são
   ~200 MB, a 16 kHz são ~67 MB, e isto roda no celular;
3. encodar cada bloco como WAV PCM 16-bit mono — cabeçalho de 44 bytes escrito à
   mão, sem dependência nova e sem WebCodecs;
4. **`null` se `decodeAudioData` falhar.**

O `null` é a parte que importa. Formato que o navegador não decodifica cai no
caminho de hoje, que continua existindo inteiro. **Esta mudança não pode deixar a
importação pior do que ela já é** — no pior caso ela fica igual.

**`src/components/Importacao.tsx`** — o laço passa a ser por bloco: `url` → PUT →
`pronto` com `ext: "wav"`, reusando o `TENTATIVAS_PUT` que já está lá. O rótulo
vira "subindo bloco 3 de 35…", porque 35 PUTs demoram o suficiente para o
silêncio virar dúvida.

**E para de mandar `duracao_s` no `/pronto`.** Este é o detalhe que a leitura da
rota revelou e que morde em silêncio: `/pronto` grava `duracao_s` na sessão **a
cada chamada**, e o corpo `{ duracao_s }` existe porque "arquivo importado é um
bloco só, de duração arbitrária". Fatiado, ele deixa de ser: mandar `30` em cada
bloco deixaria a sessão de 17 min registrada como 30 s. Sem o campo, vale
`manifest.chunks.length * DURACAO_CHUNK_S` — a conta da gravação, correta para
blocos de 30 s. O campo continua existindo para o caminho de fallback.

**O risco desta fatia, e é o único que ela cria:** trinta e cinco `/pronto` em
sequência disparam trinta e cinco chamadas de STT em ~1 minuto. A gravação
espalha as mesmas 35 por 17 minutos reais. É exatamente a rajada que a slice 4.8
existe para evitar, chegando pela porta dos fundos.

**Mitigação:** limitar a concorrência dos `/pronto` a 2 e deixar
`comEsperaDeLimite` absorver o resto. **Não é previsão que resolve isto — é a
medição da seção 4.** Se 35 blocos não passarem sob o free tier, a saída
registrada é o bloco de 2 min: 9 chamadas, ao custo de generalizar
`offsetDoBloco` e `janelasDe`.

**O que não muda, e é o ganho inteiro da decisão de 30 s:** `offsetDoBloco`
(`30 × i`), `localizarNoAudio`, `chaveChunkCandidatas`, o player da revisão e da
calibração, `concatenar` e `prefixoContiguo`. A importação vira o caminho da
gravação, e nada precisa saber disso.

## 4. Verificação

**Automática:** `pnpm test`. O `fatiador` é de navegador e não entra; o que entra
é `fecharJsonTruncado` e `chavesDaSessao`, os dois puros.

**À mão, e é o que decide a fatia.** Existem **duas sessões com o mesmo áudio de
17 min**: `mtqoeoqh3e3724514q1f`, em `em_revisao` com a proposta de 9 átomos, e
`mtqpzopm5123432v291d`, em `erro`. Guardar a primeira como o "antes" e importar o
áudio de novo para o "depois" — comparação lado a lado do mesmo áudio, que é a
única medida de qualidade que este sistema aceita.

No `logs/dev-<data>.log`:

| O que aparece | O que quer dizer |
|---|---|
| `[janela] sessão <id> janela 0 (blocos 0-3)` | o caminho novo está vivo na importação — **é o critério da fatia** |
| nove linhas `[janela]`, nenhuma `não fecharam` | o fallback deixou de ser exercitado |
| `dossiê de K entidade(s)` | a 4.9 passou a rodar por bloco, e não uma vez por sessão |
| `resposta cortada, N átomo(s) recuperado(s)` | o salvamento pegou |
| `[limite] stt` em rajada | a mitigação de concorrência não bastou — é o limite declarado no §3 |

E três coisas que só olho vê:

- **o volume subiu para a faixa?** Nove átomos para 17 min está no piso dos 10 a
  20 por 15 min. Nove janelas pedindo de 1 a 3 devem dar mais — e se derem
  **demais**, o `estende` é que não pegou;
- **o átomo 0 se quebrou?** Hoje é uma `HISTORIA` só, com 18 trechos de 4 s a
  500 s, misturando a viagem, a cachoeira, o poema, o morcego no para-brisa e o
  vinho. É o modo de falhar que o §14 já previu para `HISTORIA` — "engolir o dia
  inteiro". Se continuar inteiro com janela de 2 min, o conserto é regra em
  `/calibracao`, não código;
- **um assunto retomado virou um átomo com dois trechos, ou dois átomos?** É o
  `estende`, e ele **nunca foi exercitado de verdade**: nenhuma janela chegou a
  fechar até hoje.

## Fora de escopo

- **Mexer no teto ou no raciocínio.** `MAX_TOKENS_SAIDA`, `FATOR_DE_FOLGA` e a
  decisão de não calar o raciocínio (§4.4) ficam como estão. Se o estouro
  sobreviver à janela de 2 min, aí é medição nova, com um culpado só.
- **`INSTRUCOES_BASE`.** Não muda um byte, pelo mesmo motivo da 4.8: cinco
  versões de calibração produziram o que está lá.
- **Um `extracao-9`.** O prompt não muda; o que muda é o tamanho da entrada. Pelo
  precedente do `resolucao-2` na 4.5, o que um `prompt_version` resolve é um
  texto — e o texto é o mesmo.
- **Nomear a `ela`.** A pessoa central da sessão chegou anônima
  (`precisa_nome: true`, 8 ocorrências) porque o nome dela não é dito no áudio.
  Nenhuma máquina resolve isso; é gesto meu em `/entidades`.
- **Realimentar o vocabulário do STT bloco a bloco.** Continua sendo outra fatia,
  como a 4.9 já declarou — e agora a importação também teria o que ganhar com
  ela.
- **Apagar as correções da sessão descartada** de `calibracao/indice.json`. São
  material de calibração, não dado de sessão. Vai para o §14.

## O que muda de arquivo

```
Specs/slice-4.10.md        este arquivo
src/lib/extracao.ts        fecharJsonTruncado; o catch de parsearResposta;
                           a escolha entre primeira e segunda tentativa; o log
src/lib/tipos.ts           truncada? em RespostaExtrator e em Extracao
src/components/Revisao.tsx aviso de proposta cortada
src/lib/r2.ts              remover
src/lib/chaves.ts          chavesDaSessao
src/lib/sessoes.ts         descartarSessao; filtro em todasSessoes
.../api/sessoes/[id]       handler DELETE
src/components/Sessoes.tsx botão de dois toques
db/migrations/008_*.cypher descartada_em — aprovar antes de rodar
src/client/fatiador.ts     novo — decodificar, fatiar, WAV
src/components/Importacao.tsx  laço por bloco; rótulo; fallback; sem duracao_s
.../chunks/[i]/pronto      só o comentário do duracao_s, que deixou de valer
tests/extracao.test.ts     fecharJsonTruncado
tests/chaves.test.ts       chavesDaSessao
tests/estados.test.ts      a guarda do DELETE
ARCHITECTURE.md            §3, §4.5, §4.6, §5, §9, §10, §14
PROXIMA-SESSAO.md          seção 2
```

Uma migration, uma rota nova (verbo novo em rota que já existe), nenhuma tela
nova.

## Ordem de execução

Seis passos, cada um verde no `pnpm test` antes do seguinte, e cada um um commit.

| # | Passo |
|---|---|
| 1 | esta spec |
| 2 | `fecharJsonTruncado` puro, com os testes — sem ligar no `parsearResposta` |
| 3 | ligar no `parsearResposta`, a escolha entre tentativas, o log e o aviso na revisão |
| 4 | o botão de apagar: `remover`, `chavesDaSessao`, `descartarSessao`, o `DELETE`, o botão, a migration 008 |
| 5 | `fatiador.ts` puro-ish, e a `Importacao` passando a usá-lo com fallback |
| 6 | `ARCHITECTURE.md` e `PROXIMA-SESSAO.md` |

**Depois do 3 o sistema já é melhor sem ter mudado de forma**: nenhuma resposta
cortada custa mais uma janela, e o caminho da importação continua o de sempre. É
o ponto de retorno barato — do 5 em diante, o que estranhar na lista é do
tamanho da janela, não do parser.

**O passo 4 antes do 5 é de propósito**, e não por importância: o passo 5 vai
gerar sessão de teste com 35 objetos cada, e sem o botão a limpeza é no console
do R2, um objeto por vez.

## Limites que esta fatia cria (para o §14)

- **A importação passa a custar 35 chamadas de STT em vez de 1**, concentradas em
  ~1 minuto em vez de espalhadas por 17. É o preço declarado de ter um caminho
  só, e é o número a olhar na primeira importação real.
- **Trinta e cinco costuras na transcrição** onde antes havia zero. Arquivo
  inteiro não corta palavra no meio; blocos de 30 s cortam em 35 lugares. A
  gravação sempre pagou isso; a importação passa a pagar, e **em troca** ganha a
  janela e o RAG por bloco.
- **Os bytes subidos crescem ~10×** — WAV 16 kHz mono, ~960 KB por bloco, ~34 MB
  numa sessão de 17 min, contra ~3 MB do opus original. Sai caro no 4G.
- **Navegador que não decodifica o formato volta ao bloco único**, com a janela
  inerte de novo — e **em silêncio**: nada na tela distingue uma importação
  fatiada de uma que caiu no fallback. O log é o único lugar onde a diferença
  aparece.
- **Sessão descartada deixa átomo apontando para o vazio.** O nó `:Sessao` e os
  átomos continuam no grafo (regra 6), e `audio_key` e `transcricao_key` passam a
  apontar para objetos que não existem mais.
- **As correções de uma sessão descartada continuam em `calibracao/indice.json`**
  — deliberado: é material de calibração, e apagá-lo seria desaprender.
- **Proposta salva de resposta cortada pode estar incompleta**, e não há como
  saber o que faltava: o modelo foi interrompido, não perguntado. O aviso na
  revisão é a única defesa, e quem julga sou eu.
