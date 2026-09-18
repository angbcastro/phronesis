# Slice 8 — O sistema se cronometra, e encolhe o que mede

**Objetivo:** que o tempo entre o toque em parar e a tela de revisão abrir encolha —
e que ele deixe de ser impressão e passe a ser um número gravado, sessão por sessão,
para sempre.

**Pronto quando:** eu gravo uma sessão real, a revisão abre, e o objeto de medida
daquela sessão me diz onde o tempo foi, passo a passo, com as falhas e o custo. E o
uso me diz que melhorou. **Quem fecha a fatia sou eu** — a medida existe para dizer
*onde* mexer, não para declarar que ficou bom.

## Por que agora

`PROXIMA-SESSAO.md` §2.2 já escreve o problema inteiro: *"É o número desta fatia, e
ele não existe ainda. Hoje a previsão é 'de um a dois minutos para segundos', e
previsão não é medição."* E a suspeita já está lá: se continuar em dezenas de
segundos, o culpado não é a extração — é a resolução da janela do fim (embedding,
duas consultas vetoriais e a chamada do agente 2), que roda inteira depois do stop.

A única sessão longa real que se olhou (`mtqoeoqh3e3724514q1f`, 1044 s) custou
**quatro chamadas de modelo para entregar uma**, e foi ela que gerou a 4.10 — mas o
que se mediu ali foi token e `finishReason`, não relógio. Desde então nada foi
cronometrado. O sistema saiu do `localhost`, roda no telefone, e o telefone é onde eu
espero olhando a tela.

## As decisões

Perguntadas na entrevista de 17/09, antes de qualquer linha de código.

### 1. A fatia abre medindo, e a medida fica

Não é andaime. O registro permanece para dizer, daqui a três fatias, se algo
regrediu.

**Por que não o log da Vercel:** ele expira. **Por que não Neo4j:** a cota de índice
do Aura Free já está no teto pelos dois índices vetoriais da 006 (§14, repetido nas
migrations `011` e `012`), e série temporal quer índice por data. **Por que R2 com
índice:** `src/lib/r2.ts` não tem `LIST` — é exatamente por isso que
`calibracao/indice.json` existe, e o mesmo molde serve aqui.

Três objetos, e o que impede de inchar é a forma, não a disciplina:

- `sessoes/<id>/medidas.json` — o detalhe daquela sessão. Tamanho máximo conhecido.
  Morre com a sessão: `chavesDaSessao` já varre o prefixo.
- `medidas/indice.json` — uma linha por sessão, com os números de manchete. Podado
  por teto, como `podarIndice` já faz com as correções.
- `medidas/<AAAA-MM>.json` — o resumo do mês (n, mediana, pior caso, por passo),
  escrito pela batida diária que já existe, **antes** da poda. O detalhe de março
  some; a linha de março fica para sempre. Doze objetos por ano.

**O que entra no registro:** tempo por passo, falha (o que quebrou e por quê) e custo
(chamadas por agente, e tokens quando o Gateway devolve). **O que não entra:** campo
sem pergunta atrás. Cada número gravado responde a uma pergunta que eu de fato faço —
"onde foi o tempo", "isso piorou desde a emenda", "quantas janelas ficaram para
trás". Log de depuração genérico é o que apodrece.

**Texto livre de erro fica no objeto da sessão**, que é limitado e some com ela; o
índice guarda código e contagem. É onde esse tipo de registro sempre incha.

**Sem tela nesta fatia.** Quando eu quiser olhar, eu peço. Se a leitura virar hábito,
a tela vira item da pauta (8.4).

**Apagar a sessão não apaga a linha do índice** — como a correção já sobrevive ao
átomo, de propósito (§9). A série não ganha buraco quando eu apago uma sessão de
teste, e sessão de teste que foi mal não some para melhorar a média sozinha.

### 2. O número é do toque em parar até a revisão abrir

Inclui subir o último bloco, transcrever, extrair, resolver, e a tela virar. Inclui a
rede, que não está sob controle do código e varia com o sinal — e inclui **de
propósito**: é o tempo que eu espero olhando o telefone, não o tempo que o servidor
gosta de contar. Os passos internos ficam no detalhe, para dizer onde mexer.

Isso obriga o cliente a marcar três instantes que o servidor não tem como saber: o
`parar()`, a fila vazia e a revisão montada.

### 3. O limite que justificava cautela era da conta gratuita

O `ARCHITECTURE.md` registra o 429 de 02/09 como limite do sistema — *"uma espera de
~75 s destravou o que três tentativas seguidas não destravaram"* — e observa que o
limite era da conta, não do modelo. **Aquilo era o free tier.** Desde a compra de
créditos não reapareceu.

O documento ganha essa nota, e a consequência é de projeto: **paralelismo deixa de
ser risco e vira escolha.**

### 4. Paraleliza tudo que é independente

Sem teto artificial — num sistema de um usuário, requisição à toa não é custo.

- `candidatasDaJanela` percorre os 4 blocos em `for`+`await`, cada um com GET no R2 e
  possível `embedMany` mais duas consultas vetoriais. Os blocos não dependem uns dos
  outros e nada no código exige ordem.
- A fila do cliente sobe um bloco por vez. Irrelevante durante a fala, onde chega um
  bloco a cada 30 s; no instante do stop é o último bloco esperando a fila drenar.

**O que continua serial:** a cadeia de janelas. A janela `n` recebe o acumulado da
`n-1`, e isso **é** a 4.8 — mexer ali muda a qualidade da extração, não só o tempo.
Fica fora desta fatia.

### 5. O penhasco vira erro

Hoje, se **qualquer** janela não estiver `pronta` na finalização, `propostaDaSessao`
descarta tudo que a 4.8 acumulou e roda `extrair()` sobre a sessão inteira num passe
só — em silêncio, sem nada na tela que distinga. É o caminho de 1–2 min que a 4.8
existe para eliminar, e ele dispara sempre que um lease de 120 s ainda está segurado
por um `waitUntil` anterior no instante em que `/finalizar` roda.

Janela presa é defeito, não condição normal. A sessão passa a ir para `erro` com o
motivo, e eu mando re-extrair. **Nunca mais pago um passe único de 17 minutos sem
saber.**

### 6. Primeiro o que elimina trabalho, depois o que paraleliza

- **O STT do último bloco pode ser pago duas vezes.** `transcreverBloco` só checa se
  `chunk_NNN.json` existe — não há lease. O `waitUntil` de `/chunks/:i/pronto` e o
  laço de espera de `finalizarSessao` podem atacar o mesmo bloco ao mesmo tempo,
  porque `/finalizar` chega segundos depois do último `/pronto`. Ganha lease,
  espelhando `reivindicarJanela`.
- **`listarEntidades()` roda duas vezes por finalização** — uma por janela e outra em
  `propostaDaSessao`. Cypher com quatro `OPTIONAL MATCH` e vários
  `collect(DISTINCT …)`, sem cache.
- **`configAgentes()` ganha cache por invocação.** Hoje é um GET no R2 a cada chamada
  de agente, e no desempate, que roda em `Promise.all`, são N GETs simultâneos do
  mesmo objeto. O comentário em `overrides.ts` diz que não há cache porque cache por
  instância faria "salvei, vale na próxima" ser mentira — **e continua valendo**:
  cache por invocação não fura isso, porque a próxima invocação lê de novo. A decisão
  declarada não é revogada; é lida com mais precisão, e o comentário passa a dizer
  isso.
- **Os ~3,5 s de polling puro** entre "acabou" e "abriu": 1 s no laço de espera dos
  blocos, 0,5 s na fila do cliente e 2 s no poll da tela de processamento. As três
  constantes apertam.

### 7. A escada de espera passa a depender do erro

`comEsperaDeLimite` espera 20 s e 60 s e trata **toda** falha igual. Foi calibrada
contra o 429 do free tier. Passa a distinguir: só o 429 leva a escada longa; qualquer
outra falha transitória tenta de novo em segundos. Hoje uma falha de rede boba custa
20 s parados no meio da finalização.

### 8. Vale para gravação e para importação

Os dois caminhos compartilham o pipeline depois do bloco subir, então a maioria dos
consertos vale para ambos de graça. A medida cobra o número nos dois.

## O escopo

### Entra

- O registro de medida: três objetos no R2, o resumo mensal na batida diária, a rota
  pequena que recebe as marcas do cliente, e a instrumentação nos pontos que já
  existem no pipeline.
- Os seis consertos: lease do bloco, `listarEntidades()` uma vez, cache por
  invocação, polling apertado, paralelismo do RAG e da fila, escada por tipo de erro.
- O penhasco virando `erro` com motivo.
- A nota no `ARCHITECTURE.md` de que o 429 de 02/09 era free tier.

### A ordem, que não é detalhe

**A medida vai primeiro, sozinha, e com uma sessão real gravada antes de qualquer
conserto.** Se instrumento e conserto subirem juntos, não se sabe o que melhorou — e
a fatia inteira existe para saber.

### Não entra

- **A revisão abrindo antes de terminar.** É a 8.2, e ela só existe se o número desta
  continuar ruim depois dos consertos.
- **Tela de medidas.** O objeto é lido sob demanda.
- **A saída bruta do modelo.** Nenhum `putJson` do projeto grava resposta crua hoje, e
  continua assim — está fora do recorte inteiro das 8.n.
- **A serialidade das janelas**, que é a 4.8.
- **Migration.** Nada nesta fatia toca o grafo.

## Limites que esta fatia cria

- **O número inclui a rede**, então duas sessões não são estritamente comparáveis. É
  o preço de medir o que eu sinto em vez do que é estável. O detalhe por passo é o
  que separa "a rede estava ruim" de "a resolução ficou lenta".
- **A medida é mais um objeto por sessão a manter em dia.** Se um passo novo entrar no
  pipeline e ninguém instrumentar, o registro passa a mentir por omissão — a mesma
  doença do documento desatualizado, agora em JSON.
- **O laço read-modify-write por etag passa a estar copiado quatro vezes** (manifest,
  janela, calibração e medidas), a menos que o helper seja extraído nesta fatia. A
  dívida já está declarada no docstring de `janela.ts`.
- **O penhasco virando erro troca uma proposta ruim por nenhuma proposta.** Uma sessão
  que hoje entregaria nove átomos por passe único passa a parar e pedir re-extração.
  É a troca que eu quis: prefiro saber.

## As 8.n

Esta fatia é a primeira de oito, recortadas da mesma lista de melhorias (17/09).

| # | Nome |
|---|---|
| 8 | O sistema se cronometra, e encolhe o que mede |
| 8.1 | As emendas — canônica, chat com teclado, chat abrindo a última conversa, e a procedência errada da `Correcao` |
| 8.2 | A revisão abre antes de terminar |
| 8.3 | O confronto mostra o outro lado |
| 8.4 | A pauta — feedbacks com estado, dentro do app |
| 8.5 | A página dos agentes |
| 8.6 | O movimento ganha sistema |
| 8.7 | A calibração ganha procedência — transcrição e prompt exato |

A **8.1 sai no intervalo desta**, porque não depende de nada e é o atrito diário que
faz eu não gravar a sessão que esta fatia precisa.
