# Slice 2 — Extrair, revisar, gravar no grafo

**Objetivo:** a sessão termina de transcrever, o sistema me devolve uma lista do que entendeu, eu confirmo em menos de um minuto e aquilo vira nó no Neo4j.

**Pronto quando:** numa sessão real de diário, eu abro a revisão, escuto dois ou três trechos, aprovo quase tudo sem editar, e o que entrou no grafo eu reconheço como o que eu falei.

## Fora de escopo

- **As 2-4 perguntas** do ritual. Pergunta boa depende de histórico — contradizer algo de julho, notar o que falta. Com 3 sessões no banco toda pergunta sai genérica, e pergunta genérica é uma das formas de morte listadas na visão. Slice 3.
- **`:ATUALIZA` / `:CONTRADIZ` / `:CONFIRMA` entre átomos.** É o trabalho "confrontar", o mais valioso do sistema e o que mais precisa de material acumulado. A migration 002 pode declarar os tipos; nada nesta slice os escreve.
- **Deduplicação semântica de entidade.** Aqui só casamento por nome normalizado. Merge de "Exxmed" com "Exx Med" é slice 3.
- Busca, tela Perguntar, `:Foco`, visualização de grafo.
- **Vocabulário gerado das entidades** continua à mão em `config/vocabulario.txt`.

## Como a qualidade da extração é avaliada

À mão, na tela de revisão, sessão real de diário por sessão real de diário. Eu leio o que saiu, escuto os trechos de que duvido e decido. Não há gabarito rotulado à mão, arquivo de fixture nem percentual de recall.

O sinal está na própria revisão: se eu rejeito ou edito muita coisa, o prompt não está bom. Aprovar quase tudo sem editar é o que "a extração presta" quer dizer aqui.

O custo, declarado: não existe número para comparar antes e depois de mexer no prompt — regressão só aparece se eu notar na revisão seguinte.

## Fluxo

1. Transcrição fica pronta (fim da slice 1) → a extração dispara sozinha, em `waitUntil`. Eu não aperto nada.
2. Tela de revisão: a lista do que ele entendeu. Cada item mostra tipo, texto, sobre quem, quem mais foi mencionado, e um botão de escutar o trecho.
3. Aprovar tudo é um toque. Discordar de um item são dois: rejeitar, ou editar o texto/tipo/sujeito.
4. Confirmar grava. Antes disso o grafo não tem nada além da `:Sessao` que a slice 1 já criava.

## Estados

```
transcrito → extraindo → em_revisao → confirmada
                  ↓
                erro          (extração falhou; transcrição intacta, retry manual)
```

`transcrito` deixa de ser terminal. `estaConcluida` passa a ser `confirmada`, e `em_revisao` entra em `sessoesAbertas()` — sessão extraída e não confirmada é exatamente o que o chip da home deve oferecer. Ignorar continua sendo saída válida: nada cobra a revisão pendente.

## Extração

Um job pelo Gateway (regra 8), saída JSON estrita, entrada = `transcricao.json` inteira. Modelo por `src/lib/modelos.ts`, como o STT.

Cada átomo carrega:

| Campo | Vem de |
|---|---|
| `texto` | a afirmação atômica, na minha voz, não parafraseada pelo modelo |
| `tipo` | FATO / OPINIAO / SENTIMENTO / APRENDIZADO / CONQUISTA |
| `sobre` | sujeito principal — exatamente 1 |
| `menciona` | 0..n entidades |
| `inicio_s`, `fim_s` | **offsets absolutos**, casados com as palavras da transcrição |
| `prompt_version`, `modelo` | procedência (regra 7) |

`inicio_s`/`fim_s` não saem do LLM: o modelo devolve o trecho, e o casamento com as palavras da transcrição acontece em código. Timestamp inventado por modelo é procedência falsa — pior que procedência nenhuma.

Na `granularidade: "segmento"` (ver `ARCHITECTURE.md` 4.3) a precisão do átomo é a da frase. O átomo registra qual foi, e a tela não promete mais do que tem.

## Entidades: resolução, não deduplicação

"Rodozanco" na segunda sessão tem que achar o nó da primeira. Casamento por nome normalizado (minúsculas, sem acento, sem pontuação) contra as `:Entidade` existentes. A revisão mostra qual entidade é conhecida e qual seria nova — criar entidade é decisão minha, na mesma tela, sem passo extra.

Tipo da entidade (`:Pessoa` / `:Projeto` / `:Objetivo`) é proposto pelo extrator e editável na revisão.

## Áudio na revisão

Rota nova que devolve presigned GET do bloco, e um `<audio>` com `currentTime` no offset do átomo. Fecha o critério 6 da slice 1 — que hoje está aberto: os offsets batem, mas não existe player para clicar neles. É o que faz a revisão ser confiável: eu escuto antes de aprovar.

O áudio continua sem passar por function (regra 1): a rota assina, o navegador busca no R2.

## R2

```
sessoes/<id>/extracao.json    proposta: átomos, entidades candidatas, prompt_version, modelo
```

Proposta vive no R2, não no grafo (regra 2 e regra 5). Confirmar lê daí e escreve no Neo4j.

## Neo4j — migration 002

```
(:Atomo { id, texto, tipo, inicio_s, fim_s, criado_em, valido_em,
          status, prompt_version, modelo })
(:Pessoa|:Projeto|:Objetivo) + :Entidade { id, nome, nome_normalizado, criado_em }

(:Sessao)-[:GEROU]->(:Atomo)
(:Atomo)-[:SOBRE]->(:Entidade)
(:Atomo)-[:MENCIONA]->(:Entidade)
```

Constraint de `id` único em `:Atomo` e `:Entidade`; constraint de `nome_normalizado` único em `:Entidade` — é ela que garante que a resolução não crie duplicata em corrida. **Proposta e aprovada antes de rodar.**

## Rotas

| Rota | Faz |
|---|---|
| `POST /api/sessoes/:id/extrair` | dispara a extração; idempotente pela existência de `extracao.json` |
| `GET /api/sessoes/:id/extracao` | a proposta, para a tela de revisão |
| `POST /api/sessoes/:id/confirmar` | recebe aprovados/editados/rejeitados e grava no grafo |
| `GET /api/sessoes/:id/chunks/:i/audio` | presigned GET do bloco, para o player |

## Idempotência

| Trava | Onde |
|---|---|
| `extracao.json` existir | não rechama o LLM nem sobrescreve proposta já revisada |
| `id` do átomo = `<sessao_id>-<índice>` | `MERGE` — retry do confirmar não duplica átomo (regra 4) |
| `nome_normalizado` único | duas menções à mesma pessoa na mesma sessão viram um nó |
| status na cláusula `WHERE` | confirmar duas vezes não reprocessa |

Átomo rejeitado **não é gravado**. `status = 'rejeitado'` (regra 6) é para o que já está no grafo e eu quero tirar depois — não para o que nunca entrou.

## Critérios de aceite

1. Terminar uma sessão dispara a extração sozinha; eu não aperto nada entre parar de falar e ver a lista.
2. Numa sessão real de diário, eu leio a lista e aprovo quase tudo sem editar: o que está lá é o que eu falei, e o que eu falei de relevante está lá. Julgamento meu, na tela — se a saída estiver ruim, o que se ajusta é o prompt.
3. Todo átomo tem `inicio_s`/`fim_s` que caem dentro da sessão e batem com o que eu escuto ao clicar.
4. Clicar em escutar toca o áudio no trecho certo (fecha o critério 6 da slice 1).
5. Aprovar tudo é um toque. A revisão de uma sessão de 15 min leva menos de 60 s.
6. Antes de confirmar, `MATCH (a:Atomo)` devolve nada para aquela sessão. Depois, devolve exatamente os aprovados.
7. Confirmar duas vezes não duplica átomo nem entidade.
8. A mesma pessoa citada em duas sessões diferentes é o mesmo nó.
9. Todo átomo gravado tem `prompt_version` e `modelo` (regra 7).
10. Rejeitar um átomo não deixa rastro no grafo; editar o texto grava o texto editado, não o original.

## Depois desta slice

Com átomos acumulados de verdade, a slice 3 abre as duas coisas que dependem de histórico: as perguntas do ritual e as relações entre átomos — `:ATUALIZA`, `:CONTRADIZ`, `:CONFIRMA`. E o vocabulário do STT passa a ser gerado das entidades do grafo.

## Como ficou

O que o `ARCHITECTURE.md` contava desta fatia — datas, medições, o que era
antes —, movido quase literal quando ele passou a descrever só o presente
(`Specs/documentacao.md`).

### Do cabeçalho do `ARCHITECTURE.md`

Gravar (ou importar), subir, transcrever, extrair, revisar, confirmar. A
extração acontece **durante** a gravação, janela a janela, e quando eu paro
sobra só a janela do fim; a proposta vai para `extracao.json` e a sessão para
`em_revisao` (seções 4.6 e 5); o confirmar da revisão grava `:Atomo` e
`:Entidade` no Neo4j (seções 4.7 e 8). Sessões reais já foram confirmadas e os
átomos conferidos no banco, com âncoras, `prompt_version` e `modelo`.

**A jornada não passa pela transcrição.** Parar de falar leva à tela de
processamento, e dela a revisão abre sozinha quando a proposta fica pronta. O
texto literal é porta de serviço: mora em `/sessao/:id/transcricao` e se alcança
pelo botão "transcrição" na lista de sessões (seção 11). Ler quinze minutos de
transcrição no meio do caminho é o atrito que mata o ritual — a transcrição é
insumo do extrator, não coisa que eu leio todo dia.

### Do §14 (limites conhecidos)

*Fora de fatia, no mesmo período (31/08): o botão de gravar.*

- **O botão de gravar foi verificado por compilação e teste, não por olho.**
  `tests/onda.test.ts` cobre a matemática da onda, e `tsc` mais `next build`
  passam; ninguém abriu a tela e olhou o halo respirar. Não há navegador
  automatizado no projeto, e o `middleware` exige cookie para chegar em `/`.

- **O "menos de 60 s" da revisão continua sem medição.** A tela já foi usada em
  sessões reais e o caminho inteiro fecha, mas ninguém cronometrou uma revisão de
  sessão de 15 min. Ela ficou **mais densa** na 4.8.1 — a dúvida passou a ser de
  cada referência e a procedência passou a aparecer sempre —, e a densidade foi
  desfeita depois: a linha de dúvida encolheu para uma pergunta e as fontes
  foram para trás de um ícone (§4.7). **As duas mudanças foram feitas a olho, sem
  cronômetro dos dois lados**, e é exatamente por isso que a medição continua
  valendo a pena: hoje não dá para dizer se a tela ficou mais rápida ou só mais
  curta.

- **Não há como desfazer um confirmar.** `confirmada` não tem transição de saída
  e nada apaga átomo (regra 6). Corrigir depois de confirmar depende de edição
  no grafo, que não existe nesta slice.

- **O caminho de "já conhecida" funciona, medido.** As duas primeiras entidades
  nasceram às 13:28:17 e a sessão seguinte só começou às 13:28:37: a extração
  dela encontrou as duas já lá e o segundo confirmar reaproveitou os nós em vez
  de criar novos.

### Do §8 (Neo4j)

### 8.1 Schema da slice 2, aplicado e em uso

A migration `002_atomo_entidade.cypher` já rodou: `:Atomo` e `:Entidade` têm
constraint e índice no Aura, e o grafo já recebeu conteúdo de sessões reais —
átomos com as duas listas de offsets, `ancoras`, `status`, `prompt_version` e
`modelo`, ligados por `:GEROU`, `:SOBRE` e `:MENCIONA`. O `MERGE` com label
literal por tipo, a constraint de `nome_normalizado` e as listas paralelas como
float foram conferidos contra o Aura, não só contra o banco mockado. Quem escreve neles é o confirmar da revisão, por
`atomos.ts`; `entidades.ts` só lê, por `nome_normalizado`.

### Do §4.1–4.7 (o pipeline)

*Fora de fatia, no mesmo período (31/08): a medição dos modelos de STT.*

Medido em 2026-08-31, com o **mesmo bloco real** de 30 s para todos, pelo
Gateway. A pergunta não é quem transcreve melhor: é quem devolve **tempo**.

| Modelo | Tempo | Texto | Custo/30 s |
|---|---|---|---|
| `xai/grok-stt` | **palavra** — 64 segmentos de 1 palavra (`1.802–2.002 "Vamos"`) | pior dos cinco | $0,0008 |
| `openai/whisper-1` | frase — 4 segmentos de ~8 s | bom | $0,0029 |
| `google/gemini-3.5-transcribe` | **nenhum** | melhor dos cinco | $0,0014 |
| `openai/gpt-4o-transcribe` | **nenhum** | bom | $0,0015 |
| `openai/gpt-4o-mini-transcribe` | **nenhum** | bom | $0,0008 |

`deepgram/*`, `assemblyai/*`, `elevenlabs/*`, `groq/whisper-*`,
`mistral/voxtral-*`, `fal/wizper`, `revai/*` e `azure/whisper`: `Model not
found`. Não estão neste Gateway — e é de **Deepgram** que vem o nome `keyterm`
usado em `stt.ts`, o que explica a opção estar lá.

**Sem tempo não há procedência**, que a visão §4 lista como necessidade: sem
ele todo átomo nasce com `inicios_s`, `fins_s` e `ancoras` vazios, o player da
revisão some de todos os itens e "escuto antes de aprovar" deixa de existir.
Isso elimina os três modelos sem timestamp por melhor que seja o texto deles.

> **A tabela tinha uma sexta coluna, "Rate limit", que dizia `—` para o
> `xai/grok-stt` e eliminava o `whisper-1`. Ela saiu porque é falsa** — ver
> "O rate limit é da conta", abaixo. O limite não escolhe modelo.

O custo declarado: no bloco medido o grok escreveu "Vamos testar se **a
secretária** está funcionando" onde os outros três ouviram "testar se **isso
aqui tá** funcionando". O bloco é um teste de microfone de 24/08, e as sessões
reais transcritas por ele produziram extração boa — mas transcrição estranha
numa sessão de verdade tem aqui a primeira suspeita.

O prompt também ganhou uma proibição explícita de **comentar a transcrição**. O
modelo devolveu um átomo dizendo que o texto era confuso e circular; falar
desorganizado é o esperado num diário falado, e lista vazia é a resposta certa
quando não há o que extrair.

A primeira versão pedia "uma afirmação por item" e só descartava hesitação. Numa
sessão real de 45 s isso rendeu 9 átomos — "acordei", "pedalei", "nadei", "fui
sauna" —, o que extrapolado dá ~150 numa sessão de 15 min. Duas condições de
morte de `Specs/visao.md` §8 de uma vez: revisão que passa de um minuto, e
rotina repetida todo dia apodrecendo o grafo. O prompt **manda selecionar**, não
picar:

**A lista de entidades vem da tela, não da proposta.** Era o contrário, e por
isso renomear o sujeito de um átomo devolvia 400: o servidor exigia que ele
estivesse entre as entidades da extração, e a lista não tinha como crescer. Agora
o corpo manda `entidades: [{ nome, tipo }]` com os nomes finais, e o cliente
acrescenta qualquer sujeito que eu tenha escrito à mão. Duas guardas no servidor,
porque a regra não pode depender da UI: nome que caia na lista de pronomes é
recusado com 400, e `tipo` é validado contra `TIPOS_ENTIDADE`.

### Do §11 (telas)

*Fora de fatia, no mesmo período (31/08): o círculo vira o centro da tela.*

`BotaoGravar` é **um nó do DOM só**, parado e gravando. Antes eram duas árvores
diferentes — a de gravar trocava a tela inteira pelo timer — e por isso não
havia o que transicionar entre elas, só um corte. Agora o círculo permanece e o
que muda é o que o cerca: parado, as portas de serviço;
gravando, o timer, o "salvo" e o "parar".

Foi o defeito que a respiração teve entre os commits `659073e` e este. O pedido
de então era 30% menos área no fundo e 30% mais no topo; a conversão por área
(√0,7 e √1,3, porque área cresce com o quadrado da escala) deu `scale(0,837) →
scale(1,181)` e estava certa na aritmética. Só que ela foi aplicada à área do
**disco**, e o que a pessoa vê é a área do **anel**. Resultado medido na régua
do próprio keyframe: **47% de cada meia-volta acontecia com o disco invisível**,
e a `ease-in-out` — que espalha a fase lenta pelo intervalo inteiro — gastava
justamente a parte devagar lá dentro, atravessando depressa a faixa visível. O
`box-shadow` (24 px → 42 px) saiu de fase junto: metade do crescimento do glow
já tinha acontecido quando o disco assomava. Não respirava, piscava.

O conserto é o piso: `--respiracao-min: 1` põe o fundo do ciclo exatamente onde
o anel tem largura zero, e o ciclo inteiro passa a ser faixa visível. A amplitude
que era invisível virou amplitude de verdade, `1 → 1,2`, e o ciclo alongou para
~7 s para caber nela sem pressa. **O botão encolheu junto**, de 264 px para
220 px: no auge a respiração chega a 264 px, que é o tamanho que o círculo tinha
parado antes — o gesto ocupa o mesmo espaço de tela, e é o círculo em repouso que
ficou menor.

`--glow` e `--circulo` deixaram de ser valores e viraram derivados: o primeiro é
`color-mix()` de `--acento` com `--halo-intensidade`, o segundo é o `min()` dos
dois últimos. O glow era o **único** ponto do CSS onde o terracota estava escrito
duas vezes (`rgba(214, 90, 49, .55)`), e com ele derivado trocar `--acento` leva
o halo junto.

A duração sai do rpm por `calc(30s / var(--respiracao-rpm))` — 30 s e não 60 s
porque `alternate` faz um ciclo inteiro valer duas durações. A folga vertical do
`.palco`, que era `1.5rem` escolhido à mão para a amplitude de então, virou
`max(1.5rem, calc(var(--circulo) * (var(--respiracao-max) - 1) / 2))`: subir a
amplitude deixou de poder decepar o halo no overflow.

**Limite resolvido de graça:** as ondas nascem na borda do círculo e correm até a
borda da tela (`percurso = largura / 2 - raio`), e o círculo de 264 px havia
encurtado a corrida delas para ~43 px num celular de 390 px. Com 220 px o percurso
volta a ~65 px. O `raio` é medido em tempo de execução
(`circulo.current.offsetWidth / 2`), então `onda.ts` nunca precisou saber de nada
disso.

`prefers-reduced-motion` para o halo no estado médio e tira o deslize do selo.
A onda continua, porque ali ela não é enfeite: é o retorno de que o microfone
está ouvindo. **"Estado médio" passou a custar uma linha a mais.** Enquanto a
amplitude era de 3,6%, `animation: none` bastava: sem animação o disco fica na
escala natural, que é 1. Com o piso da respiração agora em 1 e o teto em 1,2,
escala natural é o fundo do ciclo — o ponto onde o halo não existe —, e a regra
prometia um estado médio que entregava halo nenhum. Ela passa a calcular a média
dos dois extremos, na escala e no raio da sombra, a partir dos mesmos controles.

**O timer deixou de ser o herói.** Ele era `clamp(3rem, 16vw, 5rem)` porque era
o centro da tela; com o círculo nesse posto, ficou em 1,5 rem, tabular, no tom
de texto fraco. Continua na tela porque é informação real — quanto tempo eu já
falei.

`--acento` governa ~45 regras, todas por `var()` ou `color-mix()`. O único lugar
do CSS onde a cor estava escrita uma segunda vez era `--glow`
(`rgba(214, 90, 49, .55)` é o mesmo `#d65a31` em decimal), e trocar o acento
deixava o halo para trás — daí ele ter virado derivado.

`--fundo` e `--acento` mudaram de `#0f0f10` e `#d8613c` para os valores acima
quando o botão foi redesenhado; a diferença é pequena, e manter dois terracotas
quase iguais no mesmo sistema seria pior que trocar o antigo.

**Phronesis é escuro, e só.** O bloco `prefers-color-scheme: light` saiu: um
segundo tema é uma segunda tela para manter certa a cada mudança, e o botão de
gravar foi desenhado sobre `#0d0d0d` — halo terracota sobre papel é outro
efeito, não o mesmo mais claro. `:root` declara `color-scheme: dark`, sem o que
o navegador desenharia os controles nativos (input, select, checkbox, barra de
rolagem) no tema claro do sistema em cima do fundo escuro.

*Fora de fatia, no mesmo período (31/08–01/09): a jornada sem transcrição, a marca e o fim do chip.*

de rolar a tela inteira. Os "voltar → `/`" que ficavam no fim de `Sessoes`,
`Entidades`, `Processando` e da falha da `Revisao` saíram, por duplicarem a
marca. Ficaram os dois que não são ela: o "voltar" da `Leitura`, que vai para
`/sessoes` (de onde se chega), e o "depois" no rodapé da `Revisao`, que é adiar
a revisão, não navegar.

`Processando` é quem dispara `finalizar`, uma vez só (`useRef`), depois de
garantir a fila vazia; faz o polling de 2 s e, ao ver `em_revisao`, troca a URL
por `/sessao/:id/revisar` com `replace` — voltar de um corredor já atravessado
não faz sentido, o botão de voltar tem que sair da sessão.

**A transcrição saiu da jornada.** Ela era a tela que a gravação abria, com o
texto inteiro e um link para revisar; agora é `/sessao/:id/transcricao`, sem
finalizar nada e sem redirecionar, alcançável pelo botão "transcrição" na lista
de sessões, ao lado de "reextrair". Serve para conferir o literal — um nome que o
STT grafou errado, um trecho que ele comeu. `destino()` em `Sessoes` manda cada
linha para onde ainda há o que fazer: revisão se há proposta esperando,
transcrição se o texto já está inteiro, processamento no resto.

**A home não avisa nada, e a lista avisa pela cor.** Havia um `ChipRecuperacao`
na tela de gravar que aparecia sempre que existia sessão aberta e, num dos seus
dois estados, cobrava: "sessão de 12 min esperando revisão". Cobrança na tela
onde eu passo o tempo é a forma de morte da visão §6, e o chip era o único
elemento crônico que restava ali. Ele saiu inteiro.

O nome da porta acompanhou: "áudios" virou **"sessões"**, que é como a coisa se
chama no resto do sistema (`:Sessao`, `/sessoes`, `sessao_id`). Áudio é o
arquivo; sessão é o que eu abro ali.
