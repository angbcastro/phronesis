# Slice 8.2 — A revisão abre antes de a proposta fechar

**Objetivo:** que eu pare de olhar tela de processamento. A revisão abre com o que as
janelas já produziram durante a fala e continua crescendo enquanto o fim é extraído —
eu já estou lendo e editando enquanto o sistema termina.

**Pronto quando:** eu paro de falar, a revisão abre em segundos com os átomos da
maior parte da sessão, os últimos chegam sozinhos na minha frente, e o confirmar
libera quando o último trecho fecha.

**Esta fatia é condicional.** A `Specs/slice-8.md` declara que ela *"só existe se o
número desta continuar ruim"*. A 8 corta o tempo de relógio; esta cobre o que sobrar
de espera. Se a medição da 8 mostrar que a revisão já abre em poucos segundos, esta
spec fica na gaveta — e foi escrita antes por isso mesmo: para a decisão ser olhar o
número, não parar para planejar.

## Por que agora

Depois da 8, o que sobra de espera é o trabalho que só pode acontecer depois que eu
paro: o STT do último bloco, a janela final, a resolução de identidade dela. Isso tem
piso. O resto da sessão — que é a maior parte — **já está extraído** quando eu paro,
porque a 4.8 extrai durante a fala.

Hoje esse material fica parado esperando o fim para ser mostrado. A proposta acumulada
vive em `sessoes/<id>/parcial.json` e é uma proposta de verdade: cada janela grava seus
átomos com a entidade já resolvida e a procedência completa. E os ids dos átomos são
carimbados **na escrita**, não na extração — átomo que já apareceu não muda de número
quando chega mais. A fatia existe porque esse material já está pronto e escondido.

## As decisões

Perguntadas na entrevista de 17/09.

### 1. A revisão de verdade abre, e cresce debaixo da mão

Não é uma prévia em modo leitura: é a tela de revisão, com edição, marcação e tudo.
Ela abre com o que existe e recebe o resto.

Foi a opção mais ambiciosa das três, e a escolha foi consciente: mostrar os átomos só
para ler mataria a sensação de tela morta sem me devolver tempo nenhum. O que devolve
tempo é eu já estar trabalhando.

**O que torna isso viável e não seria óbvio:** o id do átomo é estável desde que ele é
gravado. A lista cresce por baixo; nada se renumera, nada troca de lugar.

### 2. A tela de processamento vira uma ponte curta

Ela não some — fica para o caso em que ainda não há nada para mostrar: sessão curta
demais, primeira janela ainda rodando. **Assim que o primeiro átomo existe, ela sai
sozinha** e dá lugar à revisão.

Numa sessão longa isso quer dizer que ela mal aparece: ao parar, várias janelas já
fecharam. Numa sessão de dois minutos ela continua sendo a ponte que sempre foi.

### 3. Confirmar espera a proposta fechar

Eu leio e edito o que já chegou, mas o botão de confirmar só libera quando a última
janela fecha.

Confirmar em duas levas foi recusado: partiria a sessão em duas confirmações, e tudo
que é chaveado por `sessao_id` teria de aguentar isso — a captura de correções, os
embeddings, o confronto, a idempotência inteira. Confirmar e descartar o que chegasse
depois foi recusado por pior ainda: eu perderia átomos do fim da fala sem reparar.

**A regra 5 não está em jogo** — nada é gravado no grafo antes da confirmação, com ou
sem esta fatia. O que está em jogo é não gravar **metade**.

### 4. O servidor empurra

A tela não fica perguntando: um fluxo aberto avisa no instante em que uma janela
fecha. O padrão já existe no projeto — `/api/chat` transmite.

É mais imediato do que repetir a busca a cada poucos segundos, e é coerente com o que
a fatia é: a tela existe para eu ver o átomo aparecer, não para eu esperar o próximo
intervalo de consulta.

### 5. Janela que falha é tentada de novo, só ela

Falha de uma janela não derruba a revisão aberta nem joga fora o que veio: o sistema
tenta **aquela janela** outra vez, sozinho, e o que eu já editei continua na tela.

**Se a segunda tentativa também falhar, a sessão vai para `erro`**, como a decisão 5
da slice 8 manda — janela presa é defeito, não condição normal. A coerência entre as
duas fatias é deliberada: o retry é a chance a mais que a revisão aberta permite dar,
não uma revogação da regra.

### 6. As edições continuam vivendo só na memória da página

Não ganham rede. Se o telefone bloquear, o navegador descartar a aba ou eu trocar de
app e voltar, o que eu editei se perde — **e isso já é verdade hoje**, sem aviso
nenhum. Esta fatia não conserta e não piora por si: o que ela faz é aumentar o tempo
de exposição, porque a tela fica aberta por mais tempo.

Foi perguntado e foi escolhido assim, sabendo do risco. Fica declarado nos limites, e
é o primeiro candidato a emenda se me morder.

### 7. Uma linha discreta no rodapé

O confirmar travado precisa dizer por quê. A tela ganha uma linha perto do botão —
"faltam 2 de 9 trechos" — que some quando a proposta fecha.

Nada de barra de progresso e nada de marca de "novo" em cada átomo que chega. Esta é
a tela mais apertada do sistema e ela foi **enxugada de propósito** fora de fatia: o
texto do átomo edita no lugar, a dúvida virou uma frase, a procedência foi para trás
de um `ⓘ`. Encher de indicador agora desfaria isso.

## O que muda no sistema

- **A rota da proposta aprende a servir o parcial.** Hoje `GET /api/sessoes/:id/extracao`
  devolve 404 enquanto `extracao.json` não existe — *"sessão em 'extraindo': ainda não
  há proposta de extração"*. Ela passa a servir o acumulado de `parcial.json` quando a
  proposta final ainda não fechou, dizendo na resposta que ainda está crescendo.
- **Uma rota que transmite**, consumida pela revisão e pela tela de processamento — é
  o mesmo sinal que faz a ponte sair e os átomos chegarem.
- **A tela de revisão deixa de buscar uma vez e parar.** Ela passa a receber, a fundir
  o que chega com o que eu já editei, e a destravar o confirmar no fim.
- **A máquina de estados não ganha estado novo.** `em_revisao` continua significando
  "a proposta fechou"; o que muda é que a tela de revisão não espera mais por ele para
  abrir.

## O escopo

### Entra

As sete decisões acima, a mudança de contrato da rota da proposta, a rota que
transmite, e o retry de janela única.

### Não entra

- **Confirmar em duas levas.**
- **Guardar as edições fora da memória.**
- **Qualquer indicador além da linha do rodapé.**
- **Mexer na serialidade das janelas** — continua sendo a 4.8, como na 8.
- **Migration.** Nada aqui toca o grafo.

## Limites que esta fatia cria

- **A tela fica aberta muito mais tempo, e as edições continuam sem rede.** Bloqueio
  de tela ou descarte da aba no meio de uma revisão longa perde o trabalho, sem aviso.
  É o limite mais afiado desta fatia, foi aceito de olhos abertos, e é o primeiro
  candidato a emenda.
- **Se a segunda tentativa da janela falhar, a sessão vai para `erro` com a revisão
  aberta** — e junto com ela vão as edições em memória. É a consequência direta de
  combinar a decisão 5 com a 6, e as duas foram escolhidas sabendo disso.
- **A revisão passa a poder mostrar uma proposta que ainda vai mudar.** Eu posso ler o
  conjunto, formar uma impressão, e ela mudar quando o fim chegar. A linha do rodapé é
  a única defesa contra isso, e ela é discreta de propósito.
- **Mais um caminho que pode ficar pendurado.** Fluxo aberto que o servidor esquece de
  fechar deixa a tela esperando para sempre um átomo que não vem — e como o confirmar
  fica travado até fechar, a tela trava junto. Precisa de um teto de tempo, e o teto é
  o que decide se a fatia é usável.

## Como ficou

O que o `ARCHITECTURE.md` contava desta fatia — datas, medições, o que era
antes —, movido quase literal quando ele passou a descrever só o presente
(`Specs/documentacao.md`).

### Do cabeçalho do `ARCHITECTURE.md`

**A 8.2 era condicional, e a condição se cumpriu.** A `Specs/slice-8.md` declarou
que ela só existiria "se o número desta continuar ruim"; as sessões reais
gravadas desde 18/09 mostraram 119–301 s de espera e uma sessão presa por dois
dias, então a fatia subiu (§4.19). O que ela muda é o instante em que a revisão
abre: não mais quando a proposta fecha, e sim quando o **primeiro átomo** existe.
No mesmo deploy, o teto de saída da extração subiu de 8000 para 16.000 tokens
(§4.6) — decisão tomada contra a evidência já registrada de que subir o número
não resolve sozinho, e com o escalonamento preservado por cima dele.

### Do §14 (limites conhecidos)

*Fora de fatia, no mesmo período (20/09): o modelo da extração.*

- **O modelo da extração pensa muito, e deixamos — e o padrão trocou sem
  remedir** (20/09). `zai/glm-5.3-flash`, padrão até então, chegou a gastar 1720
  tokens pensando para 122 de texto, e na janela 0 da sessão
  `mtqoeoqh3e3724514q1f` gastou os 8000 inteiros sem escrever um byte de JSON.
  As defesas do §4.6 seguram a janela pelo teto, não pela mordaça: calar o
  raciocínio é possível e medido (§4.4), e foi recusado porque cobraria a conta
  na qualidade da extração. **O limite conhecido que sobra é o custo**: janela
  que estoura paga duas chamadas em vez de uma, e não há medida de quantas
  estouram — a sessão real é que diz. O padrão agora é
  `deepseek/deepseek-v4.1-flash`, por decisão minha e sem sonda nova: **quanto
  ele pensa, se estoura o teto e como se sai na qualidade da lista são três
  coisas ainda não medidas**, e a primeira sessão real é que diz. Trocar de
  volta, ou para outro, continua sendo `EXTRACAO_MODEL`, sem tocar em código — e
  vale notar que `zai/glm-5.3-flash` nem aparecia na lista de modelos conhecidos
  do `@ai-sdk/gateway` instalado (4.0.62), que conhece `zai/glm-5.3`; o id novo
  não foi conferido contra essa lista, e a string sai pelo Gateway de todo jeito.

*Fora de fatia, depois dela (30/09): o prazo das janelas.*

- **As janelas do fim têm até 280 s (`PRAZO_DA_FUNCAO_MS`) contados do começo
  da função**, sob o `maxDuration` de 300 s — o máximo do plano Hobby. Eram 120 s
  fixos (`ORCAMENTO_JANELAS_MS`) até 30/09, e com o `deepseek/deepseek-v4.1-flash`
  cabia uma janela neles, às vezes nenhuma: uma janela custa 60–100 s (extração
  ~50 s, resolução 15–30 s), e das 19 sessões medidas no R2 saíram 22 falhas
  `janela_presa`. Não era "o caso ruim de um caso raro": a extração não alcança a
  fala durante a gravação, e o `/finalizar` herda uma ou duas janelas quase
  sempre. O re-extrair (`forcar`, que refaz tudo do zero) nunca fechava uma
  sessão de três janelas nos 120 s. Estourado o prazo, a sessão continua indo
  para `erro`, e o retry continua sendo `/finalizar` ou `/extrair`. **O que ainda
  limita é o relógio**: `TETO_CHAMADA_MS` corta cada chamada em 180 s (eram 90 s
  até 30/09), e três janelas lentas ainda podem não caber em 280 s.

- **As edições da revisão continuam vivendo só na memória da página, e agora a
  página fica aberta muito mais tempo** (8.2, decisão 6). Bloqueio de tela,
  descarte da aba pelo sistema ou trocar de app e voltar perde o que eu editei —
  e isso **já era verdade** antes desta fatia, sem aviso nenhum. O que a 8.2 faz
  é aumentar o tempo de exposição, porque a revisão abre antes e espera o fim ali
  dentro. Foi perguntado e escolhido assim, sabendo do risco; é o limite mais
  afiado da fatia e o primeiro candidato a emenda se me morder.

- **A revisão passa a poder mostrar uma proposta que ainda vai mudar** (8.2). Eu
  posso ler o conjunto, formar uma impressão, e ela mudar quando o fim chegar. A
  linha do rodapé é a única defesa contra isso, e ela é discreta de propósito —
  encher a tela mais apertada do sistema de indicador desfaria o enxugamento que
  ela recebeu fora de fatia.

- **O teto de saída da extração subiu para 16.000 contra a evidência do próprio
  código** (20/09, §4.6). O raciocínio registrado — "o modelo enche o que houver"
  — continua valendo, e o que sustenta a decisão é outra coisa: cada estouro
  refaz a janela inteira, não só a chamada. Se a `mu4um3ot3t5k4g1u1p1j` e as
  próximas continuarem falhando com 16.000, o número não é o problema, e o
  candidato seguinte é trocar o modelo de extração — não subir de novo.

### Do §4.1–4.7 (o pipeline)

*Fora de fatia, no mesmo período (20/09): a troca do modelo da extração.*

#### O modelo raciocina, e o raciocínio come a saída

`zai/glm-5.3-flash`, o padrão da extração até 20/09, é modelo de raciocínio.
Numa sessão de 4 mil caracteres ele gastou **1720 tokens raciocinando para 122
de texto** — e quando o raciocínio consome o orçamento inteiro a resposta chega
sem JSON nenhum. Foi assim que a sessão `mtgo3kaf5` falhou, de forma
intermitente: a mesma transcrição às vezes passava.

**A troca do padrão para `deepseek/deepseek-v4.1-flash` não move nada desta
seção.** O que as defesas abaixo olham é o `finishReason` da resposta e a razão
entre pensamento e texto, nunca o nome do modelo: num modelo que pensa pouco
elas simplesmente não disparam. O que a troca abre é uma pergunta sem resposta
medida — quanto este pensa —, e quem responde é a sessão real, pelo diagnóstico
que já sai no log.

| `finishReason=length`, `raciocinio` no teto | o raciocínio comeu o orçamento e a resposta foi cortada no meio dele | na extração, `faltouOrcamento()` → segunda tentativa com o dobro de teto. A resolução não repete desde 30/09: o teto dela (100 mil) já passa do `max_out` do modelo |

**Mesmo assim ele subiu de novo em 20/09, de 8000 para 16.000, por decisão
minha e sabendo disso.** O que mudou foi a evidência de produção: a sessão
`mu4um3ot3t5k4g1u1p1j` ficou dois dias presa, retentada e falhando igual a cada
vez, e o conserto do prazo por chamada (§5.3) tinha limitado o pior caso a 90 s
por chamada **sem reduzir o tempo total** — porque quando uma chamada estoura o
teto, a **janela inteira** é refeita do zero (extração, resolução e desempate),
não só a chamada que estourou. O mecanismo não mudou: `FATOR_DE_FOLGA` continua
2, e a segunda tentativa passa a ir com 32.000 quando `finishReason` for
`length`. O que subiu foi o piso debaixo dele.
