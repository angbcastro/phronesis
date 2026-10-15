# Interface, onda 3 — o ritual

**Objetivo:** que as três telas do ritual — gravar, o corredor e a revisão — e
o chat digam o que está acontecendo sem pedir pontaria nem adivinhação, e que a
revisão comece pelo que eu sei que está errado: as entidades.

Quarta peça de `Specs/interface.md` (a avaliação). Saiu de uma entrevista de
quatro rodadas em 15/10/2026, e cada decisão abaixo diz o que eu escolhi e o que
foi recusado.

**Pronto quando:**

1. Abro uma revisão e as entidades estão **no topo**. Troco "Marina" (conhecida)
   pela Marina Souza, e todos os itens que citavam a primeira passam a citar a
   segunda — sem abrir item nenhum.
2. Um item com "sobre ela" mostra **no próprio cartão** "quem é 'ela'?" com o
   seletor; escolho a Marina ali, e o campo some de todos os itens que citavam
   "ela", e a linha de cima também se resolve.
3. O botão de confirmar travado diz **por quê** no próprio texto, e o rodapé não
   muda de altura.
4. Toco no ▶ de um item: ele diz "…", vira ■, toca de 2 s antes até o fim do que
   eu disse naquele item, e para sozinho. Tocar no ■ para. Sem rede, o lugar do
   botão diz que falhou.
5. Gravando, com a rede cortada, a linha abaixo do timer diz "sem rede —
   guardando no aparelho"; tirando o microfone, diz "o microfone parou" em
   vermelho.
6. O corredor fica no centro, onde o círculo estava; numa falha, "tentar de
   novo" ali mesmo funciona.
7. No chat, o (i) abre pelos trechos, cada um com data e ▶; o técnico fica
   dobrado em "como procurei".

**Depende de** nada que não esteja commitado: as ondas 1 e 2, e as decisões 4 e
5, já entraram.

## As decisões

### A revisão

| # | Pergunta | Escolhido | Recusado |
|---|---|---|---|
| 1 | Como aparece o tipo do item | rótulo minúsculo, com acento — "opinião" | ponto de cor por tipo; o enum cru |
| 2 | Como fica o item desmarcado | **como está**: o cartão a 40 % | riscado; recolhido em uma linha; selo "fora" |
| 3 | Onde tocar para desmarcar | **o checkbox, com o desenho como está** — "o checkbox está bacana como está" —, e só uma área de toque invisível de ~44 px em volta | a faixa esquerda do cartão; deslizar o cartão |
| 4 | O que o ▶ toca | **o trecho, com um pouco antes**: 2 s antes do início até o fim, e ■ para parar | só o trecho; do trecho até o fim do bloco |
| 5 | Pronome que trava | **resolver dentro do item**, e **as entidades no topo da revisão**, não no rodapé — "isso me permite ver e já alterar em massa as entidades que eu já souber que estão erradas" | a marca no item com o rodapé levando até lá |
| 6 | A forma das entidades no topo | **a lista inteira, como hoje** | compacta, com as conhecidas numa linha; um bloco que dobra |
| 7 | Alterar em massa vale para as conhecidas | **sim**: trocar uma conhecida por quem ela é de verdade re-aponta todas as menções da sessão | só as novas |
| 8 | Como o confirmar travado diz por quê | **o próprio botão diz** | uma linha acima dele; como está |

### Gravar e o corredor

| # | Pergunta | Escolhido | Recusado |
|---|---|---|---|
| 9 | Rede caída e microfone parado | **a linha do "salvo" diz** — "sem rede — guardando no aparelho", no cinza; "o microfone parou", no vermelho | só o microfone; nada |
| 10 | O corredor | **centrado, e "tentar de novo" ali** | só o tentar de novo; como está |

### O chat

| # | Pergunta | Escolhido | Recusado |
|---|---|---|---|
| 11 | Onde mora a origem da resposta | **▶ nos trechos do (i)**, que abre pelos trechos; o técnico dobrado em "como procurei" | os trechos citados sob a resposta (pede contrato novo no prompt); como está |
| 12 | A barra fechada a 45 % | **como está** — discreta é pedido meu | ~65 % |
| 13 | Apagar conversa | **dois toques**, como o resto do sistema | a janela nativa do navegador |
| 14 | A rolagem enquanto a resposta chega | **fica parada se eu subi, com um "↓ resposta nova"** | só acompanha quem está no fim; sempre ao fim |

O markdown não foi perguntado: o prompt do chat já pede prosa — "sem
marcadores, sem títulos, sem tabela" —, e a resposta continua texto corrido.

## 1. A revisão

### 1.1 As entidades no topo

A seção `entidades` sai do fim da tela e vai para **logo abaixo do cabeçalho**,
antes do primeiro item, com o mesmo conteúdo: checkbox, nome, tipo e a linha de
meta. Ela é o primeiro passo da revisão — o lugar de consertar de uma vez o que
eu já sei que está errado —, e o resto da lista vem depois.

- **Ordem estável.** Hoje a lista é reordenada com o pronome primeiro
  (`ordenadas`), e numa revisão que cresce isso mexia as linhas debaixo do dedo.
  No topo, a ordem é a de chegada; o pronome se destaca pela borda no acento,
  como já se destaca, e se resolve no item (1.2).
- **A lista cresce enquanto o fim é extraído**, e agora cresce **acima** dos
  itens. O Chrome mantém a tela parada nesse caso (*scroll anchoring*, ligado
  por padrão); o Safari não faz isso. Limite declarado (§14).
- **A conhecida também se troca** (decisão 7). Hoje ela é um nome parado — "o
  grafo vence". Passa a ter o mesmo `SeletorEntidade` das novas, sem o seletor
  de tipo: escolher outra entidade do grafo, ou criar uma, é o mesmo `renome`
  que já existe para as novas, e `nomeFinal` leva a troca a todos os itens.
  - **O nó do grafo não é renomeado**: só esta sessão para de citá-lo.
  - **Não nasce alias falso**: `registrarGrafia` já recusa grafia que é
    entidade própria, e "Marina" é o nome de outro nó.
  - **Vira correção da resolução.** Em `apurarCorrecoes` (`correcoes.ts`), o
    renome cuja origem era conhecida passa a ter `agente: "resolucao"` — e não
    `"grafo"`, que é higiene de grafia —, como já acontece com a troca de
    sujeito item a item. O tipo da correção continua `entidade_renomeada`.
    O servidor já sabe quais eram conhecidas (`proposta.entidades`): nenhum
    campo novo no corpo do confirmar.

### 1.2 O pronome dentro do item

Um item cujo `sobre` ou `menciona` é uma entidade pendente — pronome, marcada,
sem nome ainda (`pendentes`) — ganha uma linha no próprio cartão, abaixo da
meta:

```
quem é "ela"? [ seletor                ▾ ]
```

O seletor é o mesmo da linha de cima, ligado à **mesma** entidade
(`editarEntidade`): escolher num lugar resolve em todos. O mesmo pronome em três
itens são três campos em sincronia, porque o nome vale para todos os que a
citam. Resolvido, a linha some dos cartões e a meta passa a mostrar o nome.

### 1.3 O botão diz o motivo

O confirmar travado troca o próprio texto pelo motivo, nesta ordem:

| Estado | Texto |
|---|---|
| gravando | `guardando…` |
| um pedido "o que faltou" em curso | `procurando o que faltou…` |
| a proposta ainda crescendo | `esperando o fim · faltam 2 de 6 trechos`, ou `esperando o fim…` sem a conta |
| pronome sem nome | `diga quem é "ela" antes` — `quem são "ela", "ele"` com dois |
| destravado | `confirmar 8 itens` |

Saem as linhas "faltam X de Y trechos" e "diga quem é…" do rodapé. Ficam a falha
(`.aviso.erro`) e o "os últimos trechos não chegaram", que não são trava: são
explicação de um problema. O rodapé ganha `env(safe-area-inset-bottom)`.

### 1.4 O tipo, o checkbox e o ▶

- **O tipo** sai por um `ROTULO_TIPO_ATOMO` em `tipos.ts`, ao lado do
  `ROTULO_TIPO_ENTIDADE` que já existe — "fato", "opinião", "sentimento",
  "aprendizado", "conquista", "decisão", "história", "rotina". Vale no cartão, no
  seletor do editor, na proposta anterior, e fora da revisão onde o tipo aparece
  cru: calibração, confronto, retrato e o (i) do chat. O valor gravado continua
  o enum: só a tela muda.
- **O checkbox** fica com o desenho de hoje. Ele passa a morar dentro de um
  `<label>` com respiro negativo — o mesmo tamanho na tela, ~44 px de toque —,
  e o `aria-label` dele não muda.
- **O ▶** é um tocador novo, compartilhado (1.5).

### 1.5 O tocador — `src/client/tocador.ts`

Hoje há três cópias de "pedir a URL do bloco e tocar" (revisão, calibração e,
com esta onda, o chat). Vira um gancho só, `useTocador`, que a tela chama com o
que quer ouvir — a sessão, o início, o fim, e os blocos, quando a tela já os tem.

| Estado do botão | Mostra |
|---|---|
| parado | `▶ 03:12` |
| carregando a URL | `… 03:12` |
| tocando | `■ 03:10–03:19`, e tocar de novo para |
| falhou | `sem áudio`, no lugar do botão, até o próximo toque |

- **Do início menos 2 s até o fim do trecho** (decisão 4). A margem não entra no
  bloco anterior: ela para no começo do bloco do trecho.
- **O trecho que atravessa a borda de um bloco de 30 s continua no seguinte**:
  o tocador pede a URL do próximo bloco e segue, com o vão de uma requisição
  entre os dois.
- Um tocador por tela: tocar outro ▶ para o anterior.
- **Sem fim, toca até o fim do bloco.** É o caso da calibração, cuja correção
  guarda só `inicios_s`, e de átomo antigo sem `fins_s`.
- A URL continua presigned, de 5 min, uma por toque (regra 1): o áudio nunca
  passa por function.

## 2. Gravar

- **A linha do "salvo" diz o que há** (decisão 9). A mesma linha abaixo do
  timer, em ordem de gravidade:

  | Estado | Linha |
  |---|---|
  | microfone parou | `● o microfone parou — toque em parar para guardar o que já foi` (vermelho) |
  | sem rede | `○ sem rede — guardando no aparelho` (cinza) |
  | salvando | `○ salvando` |
  | salvo | `● salvo` (verde) |

- **"Sem rede" já é medido** (`fila.offline`) e nunca foi mostrado.
- **"O microfone parou" é novo.** O `Gravador` passa a avisar quando a faixa de
  áudio termina (`ended` do `MediaStreamTrack` — aparelho desconectado,
  permissão revogada, uma ligação tomando o microfone) e quando o
  `MediaRecorder` erra. Hoje o segundo só ia para o console, e o primeiro não
  era ouvido. A gravação não para sozinha: o que já foi gravado está nos blocos,
  e o "parar" é quem guarda.
- **O foco vai para o "parar" quando a gravação começa.** O círculo fica
  `disabled`, e o foco caía no `<body>`.

## 3. O corredor

- **Centrado** (decisão 10): o `Processando` passa de `.leitura` para uma coluna
  centrada como a `.tela`, com o verbo onde o círculo estava. O título continua
  no DOM para o leitor de tela, e o que se vê é o verbo.
- **"Tentar de novo"** na falha e no teto: chama o mesmo `/finalizar` —
  idempotente (regra 4), tocar duas vezes não duplica nada —, recomeça o relógio
  da visita e volta a acompanhar. A lista de sessões continua como segunda
  saída.

## 4. O chat

- **O (i) abre pelos trechos** (decisão 11): todos os átomos que as chamadas
  trouxeram, sem repetir, na ordem em que vieram, cada um com o tipo, a data e um
  ▶ pelo tocador da seção 1.5. O rastro de hoje — ferramenta, parâmetros, recorte,
  piso, similaridade, fichas, retrato, Cypher — fica inteiro, dobrado sob
  "como procurei ▸".
- **O ▶ precisa do segundo do áudio no rastro.** `AtomoAchado` (`tipos.ts`)
  ganha `inicio_s` e `fim_s` opcionais, da primeira âncora do átomo, e as
  consultas do chat que montam `LinhaDeAtomo` passam a devolver
  `a.inicios_s[0]` e `a.fins_s[0]`. **O que o modelo lê não muda**: o texto da
  ferramenta sai de `linhaDeAtomo`, que não os imprime. A sessão vem do id do
  átomo (`<sessao_id>-<índice>`), e os blocos de `GET
  /api/sessoes/:id/extracao`, uma ida por sessão. Mensagem gravada antes desta
  onda não tem o segundo, e o trecho dela aparece sem ▶.
- **Apagar conversa em dois toques** (decisão 13): "apagar" vira "apagar?" em
  `--erro`, desarma ao perder o foco ou em 4 s, e o segundo toque apaga. Sai o
  `confirm()`.
- **A rolagem respeita quem está relendo** (decisão 14). Se eu estou a menos de
  ~80 px do fim, a lista segue a resposta chegando, como hoje. Se eu subi, ela
  fica parada, e aparece "↓ resposta nova" no pé da conversa; tocar desce e o
  aviso some. O teclado subindo continua rolando ao fim, como hoje: ali eu
  estou escrevendo, não relendo.

## 5. Verificação

`pnpm typecheck`, `pnpm test` e `pnpm build` a cada commit. Testes novos para o
que é puro:

- **o motivo do botão** — uma função `motivoDaTrava` exportada da revisão, com
  a ordem da tabela 1.3;
- **o intervalo do tocador** — `intervaloDeEscuta(blocos, inicio, fim)`, o
  recorte em blocos, com a margem de 2 s, a borda do bloco anterior e a
  travessia para o seguinte;
- **a correção do renome de conhecida** — `apurarCorrecoes` com um renome cuja
  origem estava em `proposta.entidades` como conhecida dá `agente: "resolucao"`;
- **os trechos do (i)** — `trechosDoRastro(passos)`, sem repetir, na ordem;
- **o rótulo do tipo** — `ROTULO_TIPO_ATOMO` cobre os oito, e nenhum tem
  sublinhado.

E no aparelho, contra o banco de desenvolvimento (`PROXIMOS-TESTES.md`):

- as entidades no topo, numa revisão que ainda cresce;
- o pronome resolvido no item;
- o ▶ atravessando um bloco;
- o microfone tirado no meio da fala;
- o "tentar de novo" do corredor;
- o (i) com ▶.

## O que muda de arquivo

| Arquivo | O quê |
|---|---|
| `src/components/Revisao.tsx` | entidades no topo, ordem estável, conhecida trocável, pronome no item, motivo no botão, rótulo do tipo, o `<label>` do checkbox, o tocador |
| `src/client/tocador.ts` (novo) | `useTocador` e `intervaloDeEscuta` |
| `src/lib/tipos.ts` | `ROTULO_TIPO_ATOMO`; `inicio_s`/`fim_s` em `AtomoAchado` |
| `src/lib/correcoes.ts` | renome de conhecida → `agente: "resolucao"` |
| `src/lib/chat.ts` | as consultas devolvem a primeira âncora |
| `src/components/Chat.tsx` | o (i) pelos trechos, apagar em dois toques, a rolagem |
| `src/client/gravador.ts` | o aviso de microfone parado |
| `src/components/Gravacao.tsx` | a linha do "salvo" com os quatro estados, o foco no "parar" |
| `src/components/Processando.tsx` | centrado, e o tentar de novo |
| `src/components/Calibracao.tsx`, `Confronto.tsx`, `RetratoDoEu.tsx` | o rótulo do tipo; a calibração no tocador |
| `src/app/globals.css` | o que cada peça acima pede |
| `ARCHITECTURE.md` §2, `arquitetura/` §3, §4.7, §4.11, §4.16, §11, §14 | o mapa e os capítulos que isto toca |

## Ordem de execução

Um commit por peça, cada um com o seu pedaço de documento:

1. o rótulo do tipo, em todas as telas;
2. o tocador, primeiro na revisão e na calibração;
3. a revisão: entidades no topo, ordem estável, conhecida trocável e a correção
   da resolução;
4. o pronome no item e o motivo no botão;
5. gravar: a linha do "salvo" e o foco;
6. o corredor;
7. o chat: o (i) pelos trechos com ▶, apagar em dois toques, a rolagem.

Ponto de retorno antes do primeiro: a tag `ui-antes-da-onda-3`.

## Fora de escopo

- **Rolar até o item com pronome a partir do botão travado.** Ele está
  `disabled`, e o texto dele já diz o nome.
- **O desmarcado e a barra do chat.** Ficam como estão, por decisão.
- **Os trechos citados sob a resposta**, que pediriam contrato novo no prompt.
- **A onda 4** (a gestão).

## Limites que esta fatia cria (para o §14)

- **A lista de entidades cresce acima dos itens**, e no Safari a tela não fica
  parada quando isso acontece (lá não há *scroll anchoring*).
- **Um trecho que atravessa a borda de um bloco tem um vão** entre os dois
  blocos: a requisição da URL do segundo.
- **Mensagem de chat anterior a esta onda não tem ▶ no (i)**: o segundo do
  áudio não estava no rastro gravado.

## Como ficou
