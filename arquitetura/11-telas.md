## 11. Telas

| Rota | Componente | O que mostra |
|---|---|---|
| `/` | `Gravacao` + `BotaoGravar` + `Gestao` + `Chat` | o círculo "Como foi seu dia?", uma engrenagem discreta na borda esquerda e a barra do chat no rodapé, centralizada — **nada mais**; gravando: ondas laterais, selo de REC, timer e um ponto de "salvo", e nem a engrenagem nem a barra |
| `/sessao/:id` | `Processando` | o corredor, e desde a 8.2 uma **ponte curta**: um verbo do passo atual, sem transcrição; empurra a sessão que está parada e sai para a revisão no primeiro átomo que existir |
| `/sessao/:id/revisar` | `Revisao` | a proposta: aprovar, corrigir o texto no próprio lugar, escutar cada trecho, resolver a dúvida de quem é, abrir as fontes de uma sugestão no `ⓘ`, confirmar — e, desde a 8.2, **crescer** enquanto o fim é extraído, com o confirmar travado e uma linha no rodapé até fechar |
| `/sessao/:id/transcricao` | `Leitura` | o texto literal, em pedaços enquanto transcreve — porta de serviço |
| `/sessoes` | `Sessoes` | lista de sessões: abrir, ler a transcrição, forçar re-extração, **apagar** — e a cor que diz o que já foi revisado |
| `/entidades` | `Entidades` | o que está no grafo, buscável por nome e por grafia, filtrável por tipo e por "sem resumo", em ordem de mais falada. Cada linha é um nome e uma linha de meta; tocá-la abre a **ficha** num painel de tela cheia — tipo, renomear, canônica, resumo, grafias, os três campos de perfil, o enriquecer/desfazer e **fundir com…**, que funde duas entidades quaisquer à mão. **A ficha do "eu" é o retrato** (slice 10, `RetratoDoEu`): no lugar dos três campos e do enriquecer, o Agora com o "até", uma seção por dimensão com o (i) das fontes, reescrever/desfazer, e a lista de dimensões para editar, com a proposta do agente ao lado. O lote é modo: "enriquecer" acende os checkboxes e uma barra grudada no topo. Enquanto houver fila, relê a cada 4 s e retoma a corrente quando a vê parada (§4.9) |
| `/calibracao` | `Calibracao` | as regras em vigor (editáveis) e o que eu já corrigi, com o selo do agente, o `antes → depois` e o áudio à mão |
| `/agentes` | `Agentes` | **o que entra**: a espinha do áudio ao grafo — STT, extração (com resolução e desempate rodando dentro dela), a revisão e o leque dos sete que partem do grafo gravado. Clicar num agente abre o prompt, o modelo e (na resolução e no confronto) o limiar |
| `/agentes/consulta` | `Agentes` | **o que sai**: pergunta, chat, resposta, título, conversa. Mesma gaveta de edição; nada nesta tela escreve no grafo |
| `/confronto` | `Confronto` | quantos átomos esperam a varredura, o botão "rodar agora", a busca, os últimos átomos tocados com o desfazer por linha (slice 5) — e o radial de um átomo, onde eu corrijo relação por relação (slice 5.2, §4.15.3) |
| `/entrar` | página de login | pede o e-mail permitido |

**Clicar na sessão leva sempre para onde ainda há o que fazer.** Proposta
esperando abre na revisão; sessão `confirmada` abre no texto literal, que é o
que sobrou dela; **todo o resto vai para o corredor**, e é ele quem chama
`/finalizar` na sessão parada. `transcrito` levava ao texto literal e o corredor
não a empurrava — uma sessão que transcreveu e nunca extraiu (`waitUntil`
perdido, extração que morreu) ficava sem caminho nenhum até a revisão, com o
texto no R2 e nenhuma proposta. Ler a transcrição continua a um toque, no botão
ao lado, que é onde essa porta de serviço deve estar.

O corredor empurra `gravando`, `transcrito` e `erro` — os três estados que
ficariam parados para sempre —, e não toca em `finalizando`, `transcrevendo` nem
`extraindo`, que já estão andando por conta própria. A chamada é idempotente
(regra 4: proposta que existe não rechama o modelo) e acontece uma vez por
visita.

**E ele tem teto desde 18/09.** O laço não tinha nenhum, e a tela só sabia falar
em falha quando o **status** dizia `erro` — mas sessão cuja função morreu no
`maxDuration` nunca chega a `erro`: ela fica em `extraindo` no grafo (§5.3), e a
tela ficava em "lendo o que você disse…" indefinidamente. É o que faz uma trava
parecer lentidão. Passados `TETO_DA_ESPERA_MS` (6 min) o corredor para de
perguntar e diz o que aconteceu, apontando o reextrair da lista. O relógio é o da
**visita**: abrir a sessão de novo recomeça a contagem, que é o que se quer ao
voltar para conferir.

**Em `/` a porta de serviço inteira é uma engrenagem no meio da borda
esquerda** — sessões, entidades, agentes, calibração e subir um áudio, num menu
lateral (`Gestao`).
Ela fica na altura do círculo, na margem, e **não** no canto superior esquerdo:
aquele canto é da `Marca`, a volta ao início. Um segundo significado ali faria o
canto querer dizer duas coisas conforme a tela. Eram
três controles soltos na tela — o link de importar logo abaixo do círculo e as
duas portas no rodapé —, e três coisas para ler antes de falar. Virar um
**aproxima** a tela do "um botão, um timer, um jeito de parar — idealmente nada
mais" da visão §6, em vez de afastá-la: o que sobra no caminho do olho é o
círculo.

A gaveta entra pela esquerda em 220 ms na mesma curva das ondas, fecha no véu, no
`Esc` e ao navegar, e o foco entra nela ao abrir e volta para a engrenagem ao
fechar. **Clicar em "subir um áudio" não a fecha**, de propósito: o botão vira
"subindo o áudio…" e a recusa de formato aparece logo abaixo — os dois precisam
ficar visíveis onde eu cliquei. Ela some sozinha quando o upload termina e a rota
troca. A engrenagem só existe com a gravação parada, como os três links que ela
substituiu: navegar para fora no meio de uma gravação a mataria.

`Gestao.tsx` **não** ganhou um item de chat, e é deliberado: ao contrário da
slice 5, o chat não é uma rota. Ele mora na própria tela inicial.

#### A barra do chat, e o círculo que minimiza (slice 6)

Uma rota própria e de destaque — `/chat`, ao lado de Gravar/Revisar — foi a
primeira ideia levada à entrevista, e caiu assim que ficou claro que a
integração era com a tela de gravar. O que existe é uma barra:

| estado da tela | o que aparece |
|---|---|
| **parado** | círculo ao centro + engrenagem + a barra do chat, discreta, centralizada no rodapé, com `...` de convite |
| **chat aberto** | o painel toma o centro; o círculo encolhe, sobe para o topo e fica semitransparente — periférico, como a barra era |
| **gravando** | só círculo, timer, ponto de salvo e "parar". A barra **some inteira**, como a engrenagem |

**Era uma bolha de balão no canto de baixo à direita.** Ela caiu no primeiro uso
de verdade: um ícone de balão periférico lê como símbolo de suporte, não como
lugar de perguntar. A barra **não** aceita texto — tocar nela abre o painel e o
foco vai para o campo de dentro. Um `<input>` no estado fechado que não
recebesse o que eu digitasse mentiria, então o que está ali é um botão com cara
de campo.

A barra e o painel são o **mesmo elemento** — uma `<section class="chat">` que
cresce —, pela mesma razão que o `BotaoGravar` é o mesmo nó do DOM parado e
gravando: sem isso não há o que transicionar, só um corte.

##### As duas animações, e por que a primeira versão não era uma

Até o primeiro uso isso era só o que o documento dizia. Na prática o componente
voltava cedo com uma árvore diferente, e o que existia era um `@keyframes` de
entrada — **sem simétrico nenhum na saída**. Fechar era um corte, e a bola
minimizando era um pulo. Duas causas, as duas mecânicas:

- **a caixa** tinha a animação em `@keyframes`, que não tem volta, e a transição
  de opacidade do círculo morava **dentro** da regra `.tela.com-chat` — some
  junto com a classe, e o retorno é instantâneo por construção;
- **a bola** mudava `--circulo` de `min(72vw, 264px)` para `84px` e virava
  `justify-content` de `center` para `flex-start`. Propriedade personalizada não
  registrada **não interpola**, e `justify-content`, `gap` e `padding` não
  interpolam nunca.

O que existe agora, e vale nos dois sentidos porque mora nas regras **base**:

- **a caixa** transiciona geometria — os quatro `inset`, `max-width`, o raio e a
  opacidade. É por isso que a barra fechada declara um `top` numérico
  (`calc(100dvh - recuo - 44px)`) em vez de `auto`, que não interpolaria; e é por
  isso que fundo, borda e opacidade vivem na `.chat` e não nos filhos. Barra e
  painel ficam os dois `position: absolute; inset: 0`, para que nenhum deles
  estique a caixa durante a troca;
- **a bola** se move por `transform: translateY(calc(3.75rem - 50dvh))
  scale(0.32)`. O `0,32` é fator e não comprimento, porque o CSS não divide
  comprimento por comprimento: ele encolhe o que `--circulo-tamanho` disser, e
  com os 220px de hoje a bola parada fica em ~70px. O `50dvh` é exato e não
  estimado, porque a `.tela` é `min-height: 100dvh` com padding vertical
  simétrico, `justify-content: center`, e o `.palco` é o único filho em fluxo.
  Quem chega mais perto do painel não é a bola parada, é o auge da respiração:
  220px × 1,2 × 0,32 dá raio de ~42px, e a borda de baixo para em ~6,4rem, acima
  do `top: 8.5rem` do painel — que é o que faz os dois conviverem sem um cobrir o
  outro. É o único lugar do sistema onde subir `--respiracao-max` ou
  `--circulo-tamanho` tem consequência de layout. O `.palco` fica em `z-index: 6` **sempre**:
  indo e voltando a bola atravessa a faixa do painel (`z-index: 5`), e um
  `z-index` que sumisse com a classe esconderia metade do caminho de volta.

Dois efeitos colaterais do "sem corte" que são decisão, não descuido: o rótulo
"Como foi seu dia?" sai por `color: transparent` (a cor interpola; `font-size: 0`
era mais um corte) e continua no DOM como nome acessível do botão; e o `.brilho`
**continua respirando** minimizado — desligar a animação cortava a escala dela no
meio, e a 32% de tamanho a respiração não se vê. Do lado do React, o painel
sobrevive ao fechar por `DURACAO_CAIXA` (384 ms, o mesmo número da transição),
`inert` enquanto sai; sem isso a caixa encolheria vazia — mas só neste caminho,
pela razão que a seção seguinte explica.

##### A View Transition, e por que a de CSS continua aí

A transição acima é correta e simétrica, e ainda assim não era fluida. A caixa ia
do rodapé ao centro interpolando seis propriedades de **layout** — os quatro
`inset`, o `max-width` e o raio —, recalculadas a cada quadro, com uma lista
rolável dentro; e a bola e a caixa começavam juntas por coincidência de número
(320 ms cada), não por construção.

**Os números abaixo são 384 ms e 216 ms — 20% mais devagar que os 320 ms e
180 ms da primeira versão, a meu pedido.** O fator é o mesmo nos dois caminhos
da troca de modo (View Transition e o fallback de CSS) e em `DURACAO_CAIXA`:
os três precisam continuar lendo como um gesto só.

Onde o navegador tem a **View Transitions API**, a troca de `chatAberto` passa por
`src/client/transicao.ts`: o navegador fotografa o antes e o depois e morfa os
dois elementos nomeados — `circulo` no `.palco`, `caixa-chat` no `.chat` — do
ponto inicial ao de destino, no compositor, com uma linha do tempo só. Os dois
caminhos coexistem de propósito: **a View Transition não inventa estado nenhum**,
ela interpola até o que o CSS já declara, então `.tela.com-chat .palco` e
`.chat.aberto` continuam sendo os destinos, e a transição de geometria continua
sendo o percurso de quem não tem a API.

Quatro coisas que custam caro quando esquecidas, e que estão escritas no código:

- **`flushSync`** dentro do callback de `startViewTransition`. A foto do "depois"
  é tirada quando o callback termina; com o batch normal do React o DOM ainda não
  mudou nessa hora, as duas fotos saem iguais, nada anima, e a tela pula para o
  estado novo depois — um corte pior que o que havia antes;
- **`prefers-reduced-motion` é decidido em JS**, e não no CSS. Quem pediu menos
  movimento não entra na View Transition: volta ao caminho antigo inteiro, onde o
  `@media` do `globals.css` já resolve com `1ms`;
- **o `z-index: 6` do `.palco` não vem junto na foto.** No overlay da transição a
  ordem é a ordem do DOM, e a bola passaria por trás do painel na metade do
  caminho — o mesmo defeito que o `z-index` na regra base já tinha resolvido no
  caminho de CSS. Daí `::view-transition-group(circulo) { z-index: 2 }`;
- **a cauda de `DURACAO_CAIXA` sai do caminho.** Com View Transition a foto do
  antes já mostra o painel inteiro durante a volta toda; segurar o painel montado
  por mais 384 ms o põe dentro da foto do **depois**, por cima da barra. O efeito
  de `Chat.tsx` pula a cauda quando `usaTransicao()` é verdade — e a chamada mora
  dentro do efeito, porque no servidor não há `document` e ler isso na
  renderização divergiria da hidratação.

Dois ajustes que são de olho, não de cálculo: as fotos da caixa levam
`object-fit: cover` (sem isso os `...` da barra são esticados até o tamanho do
painel e viram um borrão), e a foto velha sai em 216 ms em vez de 384 ms, para o
meio da viagem não ficar turvo com os dois conteúdos sobrepostos.

**Manter a barra visível durante a gravação foi recusado.** Nem a `Gestao`, a
única porta de saída que já existia, tem esse privilégio — e a tela de gravar é
onde este projeto historicamente corta, não adiciona (ver o comentário sobre o
chip de recuperação removido em `Gravacao.tsx`).

**Com o chat aberto, o primeiro toque no círculo não grava.** Ele restaura o
círculo ao centro e fecha o chat; só o segundo toque começa a gravar. Um toque
só — fechar e já gravar — foi considerado, por ser o gesto mais parecido com o
"um botão, um toque" que rege esta tela, e recusado: começar uma gravação sem
querer, só tentando sair do chat, custa mais que um toque. O `Esc` segue a mesma
lógica em outra dimensão — com o agente respondendo ele **para a geração**, e só
fecha o painel quando não há nada em curso.

Dentro do painel: a lista de conversas (ativas, com as arquivadas atrás de um
separador que conta quantas são), o botão de nova conversa, a conversa aberta
com as mensagens, o campo de texto, e o "parar" no lugar do enviar enquanto o
agente trabalha.

**Abrir a barra é sempre começar do zero** — conversa nova, campo vazio, foco no
campo. **A slice 6 decidia o contrário** (abrir a conversa ativa mais recente na
primeira abertura de cada visita, para "toco de novo e continuo de onde parei"
ser verdade) e a **8.1 reverteu**: no uso deu o oposto, porque eu abro o chat
para perguntar uma coisa nova e caía no meio da conversa de ontem, com uma saída
a mais para dar antes de escrever. A decisão antiga nem se cumpria como
escrita — ela morava numa `useRef` por montagem do componente, e o `<Chat>` é
desmontado ao gravar e ao navegar, então "só na primeira abertura" virava "toda
vez". O que defende a conversa longa fechada sem querer é a lista, a um toque no
ícone do cabeçalho. Abrir e fechar sem perguntar não grava nada: o nó
`:Conversa` nasce no `POST /api/chat`, com a primeira pergunta.

**O teclado virtual encolhe a caixa do chat por baixo, e só ela** (8.1).
`.chat.aberto` é `position: fixed`, e fixed se posiciona contra o viewport de
**layout**, que o teclado do Android não encolhe — a caixa de escrever ficava
debaixo do teclado e eu digitava sem ver. `Chat.tsx` escuta `visualViewport` e
escreve `--teclado` **no nó da caixa**, e o `bottom` de `.chat.aberto` o soma ao
recuo seguro. A alternativa era `interactiveWidget: "resizes-content"` no
`layout.tsx`: uma linha, e consertaria os campos da revisão de brinde. Perdeu no
critério que a spec da 8.1 fixou — consertar o chat **sem mexer na tela de
gravar** —, porque o chat mora justamente nela: a bola minimizada é posicionada
por `translateY(calc(3.75rem - 50dvh))` e o halo, o véu e as gavetas medem em
`dvh`, e encolher o viewport de layout mexeria em todos eles no instante em que
o teclado sobe, com a bola visível. O preço do caminho cirúrgico é a dívida que
o projeto já tem em três lugares: mais um número que o JS e o CSS têm de manter
em sincronia.

O progresso aparece como uma linha por passo concluído ("buscou 'término' ·
sobre Isinha — 4 trechos"), e não como um carregando genérico: a espera de uma
pergunta composta é real, e fica opaca demais sem sinal nenhum. Cada resposta do
agente tem um **(i)** que abre o rastro completo — cada chamada, os parâmetros e
os átomos que voltaram, com tipo, data, entidades e similaridade.

#### O PWA, que é instalabilidade e tela cheia — e mais nada

`CLAUDE.md` decide PWA como stack, e o que existe é o mínimo que faz o app
**instalar** e abrir sem barra de navegador:

| Peça | Onde | O que dá |
|---|---|---|
| `public/manifest.webmanifest` | `display: standalone`, `start_url: "/"`, `theme_color: #0d0d0d`, ícone `/icone.svg` | o "adicionar à tela de início", e o app abrindo sem barra |
| `metadata.manifest` | `layout.tsx` | é o que põe o `<link rel="manifest">` no HTML |
| `viewport.viewportFit: "cover"` | `layout.tsx` | a tela chega até a borda no iPhone, por baixo do notch |
| `matcher` do middleware | `src/middleware.ts` | manifest e ícone respondem sem cookie, senão o navegador não os busca (§7) |

**Não há service worker, não há cache offline e não há instalação promovida.**
Gravar sem rede não funciona: o `getUserMedia` até abre, mas o bloco não sobe e
`Processando` não fecha a sessão. O que protege a fala nesse caso é o IndexedDB
(§3.2), que segura o bloco até a rede voltar — proteção da fila, não do app.
Quem lê "PWA" em `CLAUDE.md` e espera funcionar no avião vai encontrar menos do
que espera, e é por isso que está escrito aqui.

Em toda tela dessa tabela menos `/` e `/entrar`, `Marca` fica fixa no canto
superior esquerdo e leva a `/`. É **só o ponto terracota** — o nome do projeto
não informa nada a quem já está dentro dele. O ponto tem 16 px, mas o link tem
40 px: alvo de toque menor que isso não se acerta num celular, e este é um app
de celular.

### 11.1 O botão de gravar

`BotaoGravar` é **um nó do DOM só**, parado e gravando. Antes eram duas árvores
diferentes — a de gravar trocava a tela inteira pelo timer — e por isso não
havia o que transicionar entre elas, só um corte. Agora o círculo permanece e o
que muda é o que o cerca: parado, as portas de serviço;
gravando, o timer, o "salvo" e o "parar".

O palco é um grid de uma célula com tudo empilhado (`.palco > * { grid-area: 1/1 }`):

- **o halo** (`.brilho`) é um disco da cor de acento atrás do botão, do mesmo
  tamanho: parado ele some por baixo, e ao respirar (escala 1 → 1,2 e raio
  24 px → 42 px, ciclo inteiro de ~7 s em `ease-in-out alternate`) aparece só a
  borda. O círculo cresce como peça só, com o texto parado no meio. O
  `background` dele não é decoração: sombra externa recorta a própria
  border-box, e sem fundo o anel entre o botão e a borda do halo ficava sem
  sombra **e** sem fundo — um anel preto pulsando em volta do círculo;
- **o círculo** é o botão, 220 px (`min(var(--circulo-guarda), var(--circulo-tamanho))`,
  a guarda de 72vw só para não estourar aparelho estreito), da cor de acento,
  texto branco de 18 px/500;
- **as ondas** são **três de cada lado**, num `<canvas>` absoluto. O bloco que o contém vira a própria
  célula do grid, ou seja a faixa vertical do círculo — é o que põe o eixo da
  onda no centro dele sem número mágico. Some e aparece por opacidade em 400 ms
  com `cubic-bezier(.16,1,.3,1)`;
- **o selo de REC** fica dentro do círculo, abaixo da pergunta, mas **fora** do
  `<button>`: o botão fica `disabled` durante a gravação e levaria o selo junto
  para fora do alcance de um leitor de tela. Entra deslizando 8 px, no mesmo
  tempo e na mesma curva das ondas.

#### A zona morta, e por que `--respiracao-min` não desce abaixo de 1

O disco tem **exatamente** o tamanho do botão e mora **atrás** dele. Isso quer
dizer que a escala do disco não é o que se vê: o que se vê é a largura do anel
que sobra para fora do botão, e ela só existe acima de `scale(1)`. Abaixo disso
o disco está inteiro escondido, e a animação continua rodando sem pintar nada.

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

**O `72vw` continua sendo guarda, e não tamanho.** Num aparelho de 320 px é ele
quem impede o círculo de encostar nas bordas; lá o alvo de 220 px não é
alcançado e o círculo simplesmente fica menor.

#### Os controles

Nada disso é literal no CSS. O topo de `globals.css` tem um bloco `---- os
controles do tema ----` com oito propriedades, e a respiração inteira, o halo e
a cor do sistema saem dele:

| Controle | Padrão | O que faz |
|---|---|---|
| `--acento` | `#d65a31` | a cor do sistema inteiro |
| `--halo-intensidade` | `0.55` | 0 = sem halo, 1 = acento opaco |
| `--halo-raio-min` / `--halo-raio-max` | `24px` / `42px` | o desfoque da sombra nas duas pontas |
| `--respiracao-min` / `--respiracao-max` | `1` / `1.2` | a escala do disco |
| `--respiracao-rpm` | `8.6` | ciclos inteiros por minuto (8,6 ≈ 7 s) |
| `--circulo-tamanho` / `--circulo-guarda` | `220px` / `72vw` | o alvo, e o teto em aparelho estreito |

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

**Canvas, e não SVG animado**, porque a onda segue o microfone a 60 quadros por
segundo e reconstruir um path do DOM nessa cadência engasga no celular — que é
onde este botão vive. O `AnalyserNode` sai do `MediaStream` que o `Gravador`
agora expõe em `faixa`, e **não se liga ao destino**: ligar devolveria o próprio
microfone pelo alto-falante, que é microfonia na cara de quem está falando. Sem
Web Audio disponível, `nivelSimulado()` mantém a onda viva com duas senoides de
períodos incomensuráveis.

O laço de `requestAnimationFrame` **só existe enquanto grava**; parado, o halo
respira em CSS puro e nada fica de pé. O `AudioContext` é fechado ao parar —
um contexto vivo segura hardware de áudio e conta como microfone em uso.

A matemática mora em `src/lib/onda.ts`, fora do componente: é a única parte
desenhável que dá para testar sem canvas, sem microfone e sem navegador
(`tests/onda.test.ts`). O nível é RMS e não pico — pico pula com qualquer
estalo —, passa por média móvel exponencial, e a amplitude fica entre 15 px e
25 px. `envelope()` zera nas duas pontas: encostada no círculo a linha seria
cortada por ele, e na ponta precisa sumir em vez de ser decepada.

`CAMADAS` são as três linhas: amplitude e opacidade decrescentes — uma
principal com duas acompanhando, não três iguais disputando a faixa. Os ciclos
(3,55 · 4,25 · 3) foram **escolhidos por busca**, não a olho: em razão simples
as três se realinhariam a cada poucos segundos e o conjunto piscaria como uma
onda só, grossa. A razão mais próxima de um racional curto fica a 0,083 dele, e
o teste "os ciclos não estão em razão simples" é o que impede alguém de mexer
nesses números sem perceber.

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

### 11.2 Tokens de cor

Um lugar só, no topo de `src/app/globals.css`, e ele tem três camadas: o bloco
de **controles** (o que se mexe), os tokens de superfície (o que quase nunca se
mexe) e os **derivados** (o que não se mexe). Nada de cor literal em regra de
componente — quem precisa de uma variação usa `color-mix()` sobre o token.

Os controles estão tabelados em §11.1, junto com a respiração que a maior parte
deles governa. Aqui ficam os tokens de superfície e os dois derivados:

| Token | Valor | Onde |
|---|---|---|
| `--fundo` | `#0d0d0d` | fundo da tela |
| `--fundo-alto` | `#1a1a1c` | cartão, campo, chip |
| `--texto` / `--texto-fraco` | `#ececec` / `#8a8a8f` | texto e texto secundário |
| `--linha` | `#2a2a2e` | borda |
| `--sobre-acento` | `#ffffff` | texto **sobre** o acento — a única superfície que não usa `--texto` |
| `--status` | `#ffffff` a 0,7 | texto de status e ícone |
| `--rec` | `#ff4d3d` | o ponto vermelho do selo de REC |
| `--raio` | `14px` | o canto de cartão, campo e chip |
| `--ok` | `#6aa84f` | o ponto de "salvo" |
| `--glow` | *derivado* de `--acento` + `--halo-intensidade` | o halo do botão de gravar |
| `--circulo` | *derivado* de `--circulo-tamanho` + `--circulo-guarda` | diâmetro do botão de gravar |

`--acento` governa ~45 regras, todas por `var()` ou `color-mix()`. O único lugar
do CSS onde a cor estava escrita uma segunda vez era `--glow`
(`rgba(214, 90, 49, .55)` é o mesmo `#d65a31` em decimal), e trocar o acento
deixava o halo para trás — daí ele ter virado derivado.

`--fundo` e `--acento` mudaram de `#0f0f10` e `#d8613c` para os valores acima
quando o botão foi redesenhado; a diferença é pequena, e manter dois terracotas
quase iguais no mesmo sistema seria pior que trocar o antigo.

#### O tema fora do CSS

Três arquivos carregam cor que **nenhuma custom property alcança**, porque são
estáticos de build lidos pelo sistema operacional, não pelo navegador. Trocar o
tema pede passar neles à mão:

| Arquivo | O quê |
|---|---|
| `public/icone.svg` | `fill="#d65a31"` (o círculo) e `#0d0d0d` (o fundo) — o ícone do PWA |
| `src/app/layout.tsx` | `themeColor: "#0d0d0d"` na `metadata` — a barra do navegador |
| `public/manifest.webmanifest` | `background_color` e `theme_color`, os dois `#0d0d0d` |

São quatro linhas, e estão aqui para que a próxima troca de cor não deixe o
ícone do PWA em terracota com o resto do sistema em outra cor.

#### A única cor literal em regra de componente

`.selo-rec` tem `background: rgba(0, 0, 0, 0.18)`. Não é o `--fundo`: é sombra
sobre a cor que estiver embaixo, e embaixo dela está o acento, qualquer que ele
seja. Derivá-la de um token mudaria o resultado em vez de preservá-lo, então ela
fica — e fica anotada, para não parecer descuido.

**Phronesis é escuro, e só.** O bloco `prefers-color-scheme: light` saiu: um
segundo tema é uma segunda tela para manter certa a cada mudança, e o botão de
gravar foi desenhado sobre `#0d0d0d` — halo terracota sobre papel é outro
efeito, não o mesmo mais claro. `:root` declara `color-scheme: dark`, sem o que
o navegador desenharia os controles nativos (input, select, checkbox, barra de
rolagem) no tema claro do sistema em cima do fundo escuro.

### 11.3 Tipografia

Duas fontes, uma por natureza de tela:

| | Fonte | Telas |
|---|---|---|
| ritual | **Nunito** | `/`, `/sessao/:id`, `/sessao/:id/revisar` |
| gestão | **Inter** | `/sessao/:id/transcricao`, `/sessoes`, `/entidades`, `/calibracao`, `/agentes`, `/agentes/consulta`, `/entrar` |

Ritual é o que eu faço todo dia — falar, esperar processar, revisar. Gestão é
manutenção, e a transcrição literal está com ela de propósito: é porta de
serviço, não parte do ritual.

**`RITUAL` é allowlist, e é por isso que a tabela cresce sozinha do lado da
gestão.** `/calibracao` e `/agentes` nasceram nas fatias 4.6 e 4.7 e caíram em
Inter sem ninguém marcar nada, que é o comportamento certo: manutenção é
gestão, e uma tela nova que fosse ritual é que teria de ser declarada.

**A regra é por rota, não por classe CSS** (`src/lib/tipografia.ts`,
`ehRitual`). Não é preferência: `Processando` e a `Revisao` ainda carregando
renderizam `<main className="leitura">`, a mesma classe da tela de transcrição.
Pendurar a fonte na classe daria Nunito à transcrição **e** trocaria a fonte da
revisão no meio do carregamento. A rota não tem essa colisão, e tela nova nasce
com a fonte certa sem ninguém lembrar de marcá-la. Mesma forma de `mostraMarca`,
e fixada igual, por `tests/tipografia.test.ts` — o `$` dos padrões é o que impede
`/sessao/x/transcricao` de casar com o do corredor.

`Tipografia` (client) põe a classe `.ritual` ou `.gestao` em volta de
`{children}` no layout raiz. `usePathname()` resolve no SSR, então a classe já
vem no HTML e não há troca de fonte no primeiro quadro.

As duas fontes vêm de `next/font/google` no layout raiz, como variáveis CSS
(`--fonte-ritual`, `--fonte-gestao`). Elas são **baixadas na build e servidas do
próprio domínio**: nenhuma requisição a terceiros em tempo de execução, nada a
acrescentar na fronteira de segurança, e nenhum salto de layout. O stack do
sistema, que era a fonte do `body`, virou `--sistema` e é o fallback das duas.

`/entidades` é a única janela para dentro do grafo — até ela existir, saber o
que tinha lá dentro exigia rodar Cypher por fora. Procurar duplicatas e rascunhar
um perfil são botões, não coisas que acontecem ao abrir: a camada de string é de
graça, a que julga e a que escreve são chamadas de modelo, e manutenção que cobra
sozinha vira cobrança.
Ela não é painel da revisão de propósito — a revisão só vê as entidades da
sessão atual, e o orçamento dela é 60 s (visão §8).

#### A linha, a ficha e a fusão à mão

Cada linha carregava **nove controles**: a caixa do lote, o nome, a estrela de
canônica, uma meta de até seis fatos, o `select` de tipo, renomear, canônica e
ficha — num `flex` sem `wrap`. A ficha abria como acordeão dentro da própria
linha, empurrando a lista para baixo. Num aparelho de 390 px, que é onde este app
vive, nada disso se lê nem se acerta com o dedo. O que existe agora:

| Peça | Como é | Por quê |
|---|---|---|
| **a linha** | um nome (com a estrela) e uma linha de meta — átomos, sessões, "sem resumo" e o selo da fila. A linha inteira é o botão | um alvo só, grande, e nenhuma decisão a tomar antes de tocar |
| **a ficha** | painel `position: fixed` entrando pela **direita**, tela cheia no celular (`min(100vw, 34rem)`), fechando no `←`, no véu e no `Esc` | é o detalhe do que eu acabei de tocar, não navegação — mesma razão e mesmo lado do `.editor-agente` |
| **o topo** | busca, filtro de tipo e "sem resumo" | a lista vem inteira do grafo, e sem busca achar uma entidade é rolar |
| **o lote** | "enriquecer" é um **modo**: só nele existem checkboxes, e a barra de "selecionar todas" fica `sticky` | os checkboxes eram permanentes, e uma coluna deles em toda linha cobra uma decisão que eu quase nunca tomo |
| **fundir** | `fundir com…` dentro da ficha: escolher, comparar lado a lado, escolher quem sobrevive | a rota sempre aceitou qualquer par; era a tela que só sabia propor o que a distância de string tinha aproximado |

**A busca é a de `src/lib/catalogo.ts`, e não uma segunda.** `peneirar()` chama
`montarCatalogo` + `buscar` e depois reencontra o objeto inteiro por
`nome_normalizado` — o catálogo carrega só o subconjunto que a revisão usa.
Escrever um `filter` por nome aqui criaria uma segunda regra de busca para
divergir da primeira, e perderia o que aquela tem de específico: ela acha por
trecho no meio da palavra e **atravessa alias**, que é o que faz digitar a grafia
antiga cair na vencedora da fusão.

**Sem termo a ordem é a de mais falada** (átomos decrescente, desempate pelo
nome), e não a que a rota devolve — `canonico DESC, sessoes DESC, nome` é boa
para desempate de agente e ruim para o olho. **Com termo, quem manda é a
relevância** de `porRelevancia` (prefixo antes de trecho no meio): reordenar por
volume ali jogaria o casamento quase exato para o meio da lista.

**A barra do lote gruda em `top: calc(3.25rem + env(safe-area-inset-top))`, e não
em `0`.** A `.marca` é `fixed` em `0.6rem` com 40 px de altura; uma barra
encostada no topo passaria por baixo dela e esconderia o caminho de volta atrás
do controle do lote. E "selecionar todas" marca **o que está na lista agora**, não
o grafo inteiro: com um filtro ligado, marcar o que não está à vista é surpresa,
e o que sai daí é uma conta de modelo.

**A fusão à mão custa três passos de propósito.** Fundir não tem desfazer
(`src/lib/fusao.ts`), então a tela escolhe com quem, compara as duas lado a lado
— nome, tipo, átomos, sessões, perfil e resumo — e só então pergunta quem
sobrevive. A comparação diz em texto as duas coisas que não se adivinham da tela:
que isto é irreversível, e que **o resumo e o perfil da perdedora não são
copiados** — só as arestas `:SOBRE`, `:MENCIONA` e `:PERFILA` migram. Sem isso eu
escolho o vencedor errado e perco a ficha boa sem saber que perdi. Depois de
fundir, o painel **reaponta para a vencedora**: a perdedora sai da listagem no
mesmo instante (`status='fundida'`), e uma ficha aberta num nó que sumiu mentiria
até eu fechá-la.

**A ficha do "eu" é outro painel dentro do mesmo** (slice 10). Tipo, nome,
canônica, resumo, grafias e fundir continuam lá, porque são do nó; os três campos
de perfil e o "enriquecer esta" dão lugar a `RetratoDoEu`, que lê
`/api/entidades/retrato` sozinho e relê quando o selo da rodada muda:

| Peça | Como é | Por quê |
|---|---|---|
| **o Agora** | primeiro, com "até set/2026" ao lado do título | depois de três meses sem gravar, o Agora é de três meses atrás — sem a data ele pareceria presente |
| **as seções** | uma por dimensão, na ordem aprovada; parágrafos do texto como vieram. Dimensão nova diz "aparece na próxima rodada"; seção vazia, "sem material nesta rodada". Seção de dimensão que saiu da lista **não aparece** | a lista aprovada é a forma do retrato, e o `eu.json` pode estar uma rodada atrás dela |
| **o (i)** | um botão por seção que abre os trechos das `fontes` — tipo, data, texto —, lidos do grafo pelo id; o que foi rejeitado ou arquivado depois aparece **riscado** | o (i) diz o que sustentou a seção quando ela foi escrita, e sumir com o átomo reescreveria essa história. Citação por frase foi recusada: pesa a leitura |
| **reescrever / desfazer** | a rodada inteira, e um desfazer que troca os dois lados | uma rodada é uma coisa só |
| **as dimensões** | nome e `o_que_entra` editáveis, ↑ ↓ ×, "+ dimensão", "salvar dimensões"; "pedir nova proposta" traz a sugestão **ao lado**, com aceitar e descartar | o agente propõe, eu aprovo — e nada muda sem eu aceitar. Sem "juntar": é editar uma e tirar a outra |

**A ficha é a terceira gaveta desta forma** — `.gaveta` (gestão, pela esquerda),
`.editor-agente` (agentes, pela direita) e `.ficha`. As três repetem a mesma
geometria, a mesma curva de 220 ms, o mesmo `env(safe-area-inset-*)` e o mesmo
`.veu` (esse já é compartilhado). **Consolidá-las numa `.gaveta-lateral` é dívida
conhecida**, e não foi feita aqui porque mexeria em `Gestao.tsx` e em
`Agentes.tsx`, fora do escopo desta mudança.

O painel fica **montado sempre**, com a classe `.aberta` ligando e desligando, e
o React segura o conteúdo por `DURACAO_FICHA_MS` (220 ms, o mesmo número da
transição) depois de fechar. Desmontar junto com a classe esvaziaria a caixa no
meio do caminho de volta — é o mesmo erro que o `.chat` cometeu e consertou.

**A volta ao início é a marca, no canto superior esquerdo.** `Marca` mora no
layout raiz — nenhuma tela nova nasce sem caminho de volta — e é ela que decide
onde não aparecer: em `/`, que já *é* o início e é a tela de gravar, onde nada
crônico entra (visão §6), e em `/entrar`, que é anterior à sessão. `mostraMarca()`
é a regra, e `tests/marca.test.ts` a fixa. Ela é `position: fixed`: numa revisão
longa ou numa lista grande de entidades, um "voltar" de rodapé só existe depois
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

O que ficou no lugar é `jaRevisada(s)` em `Sessoes`: a linha de uma sessão
`confirmada` sai em `--ok`, o mesmo verde do ponto de "salvo" da gravação, e o
resto da lista fica no branco de `--texto`. Não há classe para "falta revisar" —
uma marca em cada linha não marca nada —, e a legenda vai no cabeçalho, senão a
cor é adivinhação. `confirmada` é o único estado terminal da máquina (seção 5), o
que faz o verde querer dizer exatamente uma coisa; `tests/sessoes-lista.test.ts`
fixa isso, porque pintar de verde uma sessão que ainda tem trabalho é pior que
não pintar nada.

O nome da porta acompanhou: "áudios" virou **"sessões"**, que é como a coisa se
chama no resto do sistema (`:Sessao`, `/sessoes`, `sessao_id`). Áudio é o
arquivo; sessão é o que eu abro ali.

