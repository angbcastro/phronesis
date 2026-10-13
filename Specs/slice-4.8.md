# Slice 4.8 — A extração acompanha a fala

**Objetivo:** tirar a extração do fim da sessão. A cada quatro blocos
transcritos — 2 minutos de fala — uma janela é extraída e resolvida **durante a
própria gravação**, e os átomos dela se somam a um acumulado no R2. Quando eu
paro de falar, sobra a janela do fim.

**Pronto quando:** eu gravo três minutos, e antes de parar já existe
`parcial.json` no bucket com átomos dentro e a janela 0 marcada `pronta`; eu
paro, e a revisão abre em segundos em vez de um a dois minutos; a lista que ela
mostra tem o volume de sempre, com **um** átomo `ROTINA`, e um assunto que eu
toquei no minuto 2 e retomei no minuto 9 aparece como um átomo com dois trechos.
E um arquivo importado continua saindo exatamente como saía.

## Por que agora

**Porque é o pior número do sistema, e ele contradiz a visão.** `Specs/visao.md`
§3 promete "paro; em poucos segundos a transcrição está pronta". A transcrição
está — ela é por bloco de 30 s desde a slice 1. O que não estava era todo o
resto: uma chamada de raciocínio com a transcrição inteira (~15 mil caracteres
numa sessão de 15 min), mais a resolução, mais os embeddings, tudo depois do
`/finalizar`.

**E porque a mesma mudança resolve dois limites conhecidos**, sem ter sido
desenhada para eles (`ARCHITECTURE.md` §14, antes desta fatia):

- a resposta da extração podia truncar numa sessão longa — nenhuma janela chega
  perto de `maxOutputTokens: 8000`;
- a chamada mais cara acontecia logo depois de 30 chamadas de STT, que é
  exatamente quando o rate limit da conta está mais perto de estourar (§5.3).
  Agora são oito chamadas menores espalhadas pela gravação, e sete delas sem
  prazo nenhum para esperar.

**O que isto não é:** não é streaming de tela. Nada aparece durante a gravação —
a visão §6 é explícita sobre não pôr cobrança ali —, e a revisão continua
abrindo só quando a proposta está inteira. O que muda é quanto tempo isso leva.

## As três decisões

Foram perguntadas antes de a fatia começar, porque as três são de produto e
nenhuma se infere do código.

| Decisão | Escolhido | O que foi recusado, e por quê |
|---|---|---|
| **Tamanho da janela** | **4 blocos, 2 min** | 1 bloco (o pedido literal) dava 30 chamadas de extração além das 30 de STT, com ~75 palavras por janela quase sempre cortando frase no meio. 2 min é fala suficiente para um átomo nascer inteiro, e deixa no máximo 3 blocos para o fim |
| **Escopo do que é incremental** | **tudo**: extração, resolução e candidatas de entidade | deixar a resolução no fim custaria 10-15 s de espera que a fatia existe para cortar |
| **Costura final** | **nenhuma** | um oitavo agente costurando a lista custaria mais um prompt para calibrar à mão para sempre, e ~10 s acrescentados justamente à espera que se está cortando. O `estende` faz o trabalho **antes** de o erro existir |

## 1. A janela

Uma janela é uma corrida contígua de `JANELA_BLOCOS = 4` blocos **do prefixo
transcrito**. `concatenar` monta o texto dela com os offsets já absolutos, então
nada na âncora nem no player precisa saber que ela é um pedaço.

```
janela 0 = blocos 0..3      janela 1 = blocos 4..7      …
```

Buraco no meio segura a janela: com os blocos 0,1,2,4,5 transcritos e o 3 ainda
no STT, a janela 0 não fecha. É a mesma regra do prefixo contíguo da transcrição
parcial — fechar com o 4 no lugar do 3 seria montar o texto na ordem errada.

**A janela do fim é a única que pode ser curta.** Ela é acrescentada só quando o
`/finalizar` pede (`fechando: true`), e é por ela que passam, numa janela só:

- o **arquivo importado**, que é um bloco de 15 min;
- a **gravação curta**, de menos de dois minutos;
- o **fallback**, quando alguma janela não fechou.

Nesses três casos a janela se declara a sessão inteira, o bloco de janela some
do prompt, e a chamada sai byte a byte igual à de antes desta fatia.

`JANELA_BLOCOS = 0` desliga o caminho incremental inteiro e devolve o sistema ao
de antes. É o botão de pânico, e existe para ser usado sem deploy de emergência.

## 2. Onde o acumulado vive (R2)

```
sessoes/<id>/parcial.json
  { sessao_id,
    janelas: [{ n, de, ate, estado, em, prompt_version, modelo, …resolucao }],
    atomos, entidades, descartados, atualizado_em }
```

Escrito por read-modify-write condicional por etag, como o manifest — vários
`waitUntil` chegam ao mesmo tempo. **Dois objetos e não um**, e a razão é o dono
no tempo: o parcial é escrito muitas vezes, por muitos; `extracao.json` é escrito
uma vez, com `If-None-Match`, e essa escrita única **é** a trava de idempotência
da extração. Um objeto só não poderia ser as duas coisas.

`estado ∈ em_curso | pronta | falhou`. O `em` é o carimbo do *lease*.

## 3. O prompt: um bloco injetado, e a base intacta

**`INSTRUCOES_BASE` e `FORMATO` não mudaram um byte.** Cinco versões de
calibração produziram o `extracao-5`; reescrevê-lo por causa de janela seria
arriscar o que está bom. O bloco novo entra no **mesmo ponto** em que a regra
aprovada entra (`inserirAntesDoFormato`), depois dela:

```
INSTRUCOES_BASE → blocoDeRegras(regras) → blocoDaJanela(janela) → FORMATO → texto
```

O bloco carrega os limites da janela ("dos minutos 4 a 6", e que a fala continua
depois), o orçamento em proporção (`orcamentoDaJanela`: 10-20 por 15 min vira
1-3 em 2 min), a lista numerada do que já foi proposto, e a chave `estende`.

`blocoDaJanela` devolve `""` quando a janela é a sessão inteira e o acumulado
está vazio — é o que faz os três casos da seção 1 continuarem intactos.

**`PROMPT_VERSION` sobe para `extracao-6`** mesmo com o texto da base igual: a
**entrada** mudou, e o precedente é o `resolucao-2` da slice 4.5. Um carimbo tem
de ser verdadeiro por omissão, nunca otimista.

**`PROMPT_VERSION_RESOLUCAO` não sobe.** O prompt do agente 2 é o mesmo, o bloco
de contexto some quando está vazio, e o que um `prompt_version` precisa resolver
é um texto. O que mudou nele — o recorte da sessão que ele enxerga — está no
`ARCHITECTURE.md` §4.8 e no §14, e não num número.

## 4. `estende`: o que substitui a costura

A janela devolve, além de `atomos`, uma lista `estende` de
`{ ref, texto, trechos }` — "o átomo 3 continua neste trecho". `aplicarJanela`
engorda o átomo referido: texto novo, trechos somados, `id` e posição
inalterados.

Duas coisas que ele deliberadamente **não** faz:

- **não mexe em `sobre` nem em `menciona`** — é o que mantém a resolução
  estritamente incremental, sem reabrir átomo já atribuído. Trocar sujeito é
  gesto meu, na revisão;
- **não apaga átomo.** `ref` fora da faixa vira `Descarte` com o motivo, checado
  nas duas pontas: no parser, contra a contagem que o prompt mostrou; em
  `aplicarJanela`, contra a lista que está sendo gravada.

## 5. Idempotência e concorrência

| Trava | Onde | Efeito |
|---|---|---|
| janela `pronta` | `janela.reivindicar` | janela fechada não é reextraída nem repaga |
| lease `em_curso`, 120 s | `janela.reivindicar` | dois `waitUntil` não pagam a mesma janela; worker morto libera |
| `If-Match` no parcial | `janela.atualizarParcial` | janelas concorrentes se somam em vez de se sobrescrever |
| `id` carimbado **na escrita** | `janela.aplicarJanela` | duas janelas nunca produzem o mesmo `<sessao_id>-<índice>` |

`avancarJanelas` processa **em ordem e para na primeira janela que não
conseguir** — a janela `n` precisa do acumulado da `n-1` no prompt. Pular
quebraria essa corrente em silêncio.

Carimbo de tempo corrompido reivindica em vez de travar: janela extraída duas
vezes custa uma chamada, janela travada custa a sessão.

## 6. Falha

Janela que falha fica `falhou` no parcial, com o motivo, e é retentada na
passada seguinte — sem esperar o lease. No `/finalizar` as que sobraram são
retentadas dentro de `ORCAMENTO_JANELAS_MS` (120 s); se ainda assim alguma não
fechar, a proposta **cai no passe único** sobre a sessão inteira, que é o
caminho de antes desta fatia, com o mesmo prompt e o mesmo parser.

A sessão nunca morre por causa de uma janela. No pior caso ela custa o que
custava antes.

`forcar: true` zera o parcial e refaz as janelas do zero — calibrar tem de
exercitar o caminho que roda de verdade, não um paralelo.

## Fora de escopo

- **Renomear na janela.** Se eu digo "ela" no minuto 2 e o nome só no minuto 10,
  a janela 1 não tinha como saber. O painel de entidades da revisão conserta isso
  num gesto, reapontando todos os átomos. Construir uma operação de renome na
  janela seria antecipar máquina para o que a tela já resolve.
- **Costura final** — recusada acima.
- **Mostrar os átomos chegando.** Nem na tela de gravar (visão §6) nem na de
  processamento: com a espera em segundos, ela mal aparece.
- **`comEsperaDeLimite` na resolução.** Faltava antes desta fatia e continua
  faltando; é conserto de uma linha e não entrou para não misturar duas mudanças
  no mesmo lugar. Está no §14.

## O que muda de arquivo

```
src/lib/janela.ts        novo — fatiar, reivindicar, somar. NÃO fala com modelo
src/lib/extracao.ts      blocoDaJanela, estende, extrairJanela; extrair vira
                         uma janela que cobre a sessão inteira
src/lib/resolucao.ts     jaPropostos como contexto, sem virar menção a resolver
src/lib/pipeline.ts      avancarJanelas; extrairSessao monta a partir do parcial
src/lib/chaves.ts        chaveParcial
src/lib/tipos.ts         JANELA_BLOCOS, Janela, EstadoJanela, Parcial, Extensao
src/lib/agentes.ts       o gatilho dos dois agentes mudou de texto
.../chunks/[i]/pronto    encadeia avancarJanelas no waitUntil que já existia
tests/janela.test.ts             novo
tests/pipeline-janela.test.ts    novo
```

Nenhuma tela. Nenhuma rota nova. Nenhuma migration — o grafo é o único lugar que
esta fatia não toca.

## Como ficou

O que o `ARCHITECTURE.md` contava desta fatia — datas, medições, o que era
antes —, movido quase literal quando ele passou a descrever só o presente
(`Specs/documentacao.md`).

### Do cabeçalho do `ARCHITECTURE.md`

**E a extração deixou de ser um evento no fim: virou um processo** (seções 4.1,
4.6 e 6). A transcrição já era por bloco de 30 s desde a slice 1, mas tudo o que
vem depois dela esperava eu parar de falar — uma chamada de raciocínio com a
transcrição inteira, mais a resolução, mais os embeddings. Era isso que fazia a
espera entre parar e revisar durar um a dois minutos, contra os "poucos
segundos" que a visão §3 promete. Agora, **a cada quatro blocos transcritos uma
janela de 2 min fecha durante a própria gravação**: extrai, resolve, e soma os
átomos ao acumulado em `parcial.json`. Quando eu paro, sobra a janela do fim.

A janela vê o que as anteriores propuseram e **estende** um átomo em vez de
duplicá-lo — inclusive o `ROTINA`, que é no máximo um por sessão. É esse
mecanismo, e não uma passada de costura no fim, que segura o volume da lista.
`extracao-9` é a `INSTRUCOES_BASE` da 4.7 mais o que a migration 007
acrescentou, e dois blocos injetados — o da janela e, desde a 4.9, o do dossiê;
e numa sessão que cabe numa janela só — arquivo importado, gravação curta — o
bloco some e o prompt sai idêntico ao de antes desta fatia.

### Do §14 (limites conhecidos)

- **A extração roda no mesmo `waitUntil` da transcrição.** Em dev isso é o mesmo
  processo: fechar a janela do servidor no meio mata o job e a sessão fica em
  `extraindo`. O retry é chamar `/finalizar` de novo. Desde a 4.8 vale também
  para as janelas, com a diferença de que uma janela morta assim fica `em_curso`
  no `parcial.json` até o lease vencer (120 s) — depois disso qualquer passada a
  reivindica de novo.

- **O alvo de 10 a 20 átomos por 15 min ainda é aposta.** O prompt está em
  `extracao-9` e as sessões julgadas até agora são curtas; a primeira sessão longa
  confirma ou derruba o número. Desde a 4.8 ele é pedido **em proporção**, janela
  a janela (`orcamentoDaJanela`), o que troca uma aposta por outra: oito janelas
  pedindo de 1 a 3 dão de 8 a 24, e é o `estende` que tem de puxar o número para
  baixo. Mais um motivo para a primeira sessão longa ser a medição que importa.

- **O `estende` é a única coisa que segura o volume da lista, e ele é uma
  instrução de prompt** (slice 4.8). Sem passada de costura no fim, a janela que
  ignorar "não repita, estenda" produz um segundo átomo sobre o mesmo assunto —
  ou um segundo `ROTINA` —, e a revisão abre com mais itens do que devia, que é a
  condição de morte da visão §8. O código impede a corrupção (`ref` inválida vira
  descarte) mas não a duplicação; quem vê é a revisão. **Ainda não foi medido
  contra uma sessão real de 15 min.**

- **A extração agora custa oito chamadas por sessão em vez de uma.** O total de
  tokens de entrada é parecido — a fala é a mesma —, mas o prompt base viaja em
  cada janela, e a lista do acumulado cresce a cada uma. É o preço declarado da
  fatia, e a contrapartida é a espera depois de parar de falar.

### Do §4.1–4.7 (o pipeline)

**Isso resolvia metade do problema.** A transcrição acompanhava a fala desde a
slice 1, mas tudo o que vem depois dela — a extração sobre a transcrição
inteira, a resolução, os embeddings — esperava eu parar. Numa sessão de 15 min
era uma chamada de raciocínio com ~15 mil caracteres de entrada, e ela sozinha
respondia por quase toda a espera entre parar de falar e revisar.

Três consequências que valem estar escritas:

- **A chamada mais cara deixou de acontecer logo depois de 30 chamadas de STT**,
  que era exatamente o pior momento para o rate limit da conta (§5.3). Agora ela
  é oito chamadas pequenas espalhadas pelos 15 minutos, e durante a gravação
  esperar o limite passar é de graça — não há prazo a estourar.
- **A resposta da extração continua podendo truncar, e truncou.** Esta linha
  já disse o contrário — "nenhuma janela chega perto de `maxOutputTokens:
  8000`" —, e a primeira janela real extraída depois da 4.8 desmentiu:
  `finishReason=length` com 5210 tokens de entrada e os 8000 de saída gastos
  **pensando**, sem um byte de JSON (sessão `mtqoeoqh3e3724514q1f`). A premissa
  errada era tratar o teto como teto de JSON: ele cobre **raciocínio e texto
  juntos**, e o volume do pensamento não encolhe com a entrada do jeito que o
  JSON encolhe. Encolher a janela não protege nada; o que protege está no §4.6.
- **O caminho de uma janela só continua existindo, e é o mesmo código.** Arquivo
  importado que o navegador não fatiou, e gravação de menos de dois minutos:
  passam por uma janela que se declara a sessão inteira, com o prompt saindo byte
  a byte igual ao de antes da 4.8. **O terceiro caso saiu na slice 8**: janela que
  não fecha já não cai no passe único — a sessão vai para `erro` e espera eu
  mandar re-extrair (§4.18).

**As duas funções servem à janela desde a 4.8**, e não foi coincidência: uma
janela é `concatenar` sobre um subconjunto de blocos, o que devolve uma
`Transcricao` com offsets já absolutos — nada na âncora nem no player precisa
saber que ela é um pedaço. E `janelasDe` fatia o mesmo prefixo contíguo pela
mesma razão de sempre: com um buraco no meio, a janela leria fala fora de ordem.

**Dispara sozinha**, e desde a slice 4.8 já durante a gravação: a cada quatro
blocos transcritos, `avancarJanelas` fecha uma janela de 2 minutos no mesmo
`waitUntil` que transcreveu o bloco. Ninguém aperta nada entre parar de falar e
ter a proposta (aceite 1 da slice 2) — e agora isso custa segundos, porque o que
falta quando eu paro é uma janela de no máximo 90 s de fala. Quem lê a proposta
é a revisão (§4.7), e é o confirmar dela que a leva ao grafo.

**O prompt base não mudou um byte.** `INSTRUCOES_BASE` e `FORMATO` são os
mesmos da 4.7 — cinco versões de calibração produziram o que está lá, e
reescrevê-lo por causa de janela seria arriscar o que está bom. O que entra é um
bloco injetado no **mesmo ponto** em que a regra aprovada entra (§4.12), pelo
mesmo `inserirAntesDoFormato`: depois de tudo o que instrui, antes do envelope.
Ele carrega quatro coisas:

**`blocoDaJanela` devolve string vazia quando a janela é a sessão inteira e o
acumulado está vazio.** Não é detalhe: é o que faz o arquivo importado e a
gravação de menos de dois minutos continuarem recebendo exatamente o prompt de
antes desta fatia. (O terceiro caso era o fallback de passe único, que a slice 8
removeu — §4.18.)
