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
