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
