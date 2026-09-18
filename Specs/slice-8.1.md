# Slice 8.1 — As quatro emendas

**Objetivo:** tirar o atrito de todo dia e consertar um dado que está sendo gravado
errado agora. Três emendas de uso e uma de procedência, sem fatia vertical no meio.

**O número diz a ordem.** Ela sai **durante** a `Specs/slice-8.md`, não depois: a 8
abre medindo e a medição depende de eu gravar sessões reais, e são justamente essas
três primeiras emendas que fazem eu gravar sem me irritar.

**Pronto quando**, as quatro no telefone:

1. Eu marco uma entidade como canônica e continuo exatamente onde estava na lista.
2. Eu abro o chat, toco no campo, o teclado sobe e eu **vejo o que estou
   escrevendo**.
3. Eu abro o chat e ele está vazio, pronto para uma pergunta nova — e a conversa de
   ontem continua a um toque, na lista.
4. Eu confirmo uma revisão em que corrigi o sujeito de um átomo, e a correção gravada
   diz o nome de um agente que **de fato rodou** naquela sessão, com a versão do
   prompt dele.

## Por que agora

As três primeiras são o atrito que eu sinto toda vez que uso, e nenhuma delas é
fatia: são um refetch demais, uma linha de viewport que nunca foi escrita e um `if`.
A quarta não é atrito — é dano: **toda confirmação grava mais uma correção com o
carimbo errado**, e ela é a comida do agente que reescreve prompts. Deixar para a
8.7, no fim da fila, seria deixar alguns meses de material torto se acumularem.

## As decisões

Perguntadas na entrevista de 17/09.

## 1. A estrela que tira você do lugar

**O sintoma:** toco em "☆ canônica" e a página pula para o topo.

**A causa não é scroll.** Não existe `scrollTo`, `scrollIntoView` nem `scrollTop` em
lugar nenhum de `/entidades` — o grep sobre `src/` devolve só o `overscroll-behavior`
da ficha e o `scrollIntoView` do chat. O que acontece é `alternarCanonico`
(`Entidades.tsx:568-583`) terminar em `void carregar()`, que refaz
`GET /api/entidades?perfil=1` — o grafo inteiro, sem paginação — e trocar o array
por objetos novos, redesenhando o `<main>` inteiro mais a ficha. Junto disso, o botão
fica `disabled` durante a requisição, o navegador solta o foco para `<body>` e ninguém
o devolve.

**O conserto:** a tela remenda só aquela entidade no estado local e devolve o foco ao
botão. A rota já entrega o necessário — ela responde `{ ok: true, canonico }`, e o
valor novo é o que a tela mandou.

**O que garante que a linha não pula de lugar:** a ordenação do cliente (`peneirar`,
`Entidades.tsx:193-204`) ordena por quantidade de átomos e nome, e por relevância
quando há busca. **`canonico` não entra em nenhum dos dois critérios** — a linha fica
onde está. O servidor ordena por `canonico DESC`, mas o cliente descarta essa ordem.

**As outras oito ações da tela usam o mesmo padrão** — fundir, tipo, criar, renomear,
perfil, resumo, aliases, enriquecer, desfazer. **Elas ficam.** A decisão foi começar
pela estrela e ver, no uso, quais incomodam de verdade: refatorar as nove de uma vez
é mexer em muito mais do que o que me irritou, e o `CLAUDE.md` manda perguntar antes.
Se a segunda incomodar, o caminho já está aberto.

**Teste:** nenhum. É comportamento de componente, e o que importa aqui é a tela no
telefone.

**`ARCHITECTURE.md`:** não. Nenhum fluxo, contrato, tipo ou fronteira muda — é
refatoração interna de componente, que a regra do `CLAUDE.md` dispensa.

## 2. O chat debaixo do teclado

**O sintoma:** abro o chat no celular, toco no campo, e o teclado cobre a caixa de
escrever.

**A causa:** `.chat.aberto` é `position: fixed` com `top: 8.5rem` e `bottom: max(0.75rem,
env(safe-area-inset-bottom))` (`globals.css:2017-2023`), e a `<form className="escrever">`
fica ancorada no fundo dessa caixa. `visualViewport` **não aparece em nenhum lugar de
`src/`**, e `layout.tsx:24-29` declara `width`, `initialScale` e `viewportFit`, mas
não `interactiveWidget` — então o padrão do Chrome Android vale, e `100dvh` continua
medindo o viewport de **layout**, que o teclado não encolhe.

**O mecanismo fica em aberto, de propósito, e eu escolho com o código na mão.** São
dois candidatos, e o critério de corte é declarado aqui:

- **`interactiveWidget: "resizes-content"` no `layout.tsx`** — uma linha. Conserta o
  chat e, de brinde, os campos de texto da tela de revisão. **O risco é fora do
  chat:** a tela de gravação dimensiona `.palco`, o halo e o destino da bola em
  unidades de altura de tela (`globals.css:2283-2286`), e o `.veu` e as três gavetas
  usam `100dvh`.
- **Escutar `visualViewport` só dentro do chat** — cirúrgico, nada fora dele muda.
  Custo: mais código a manter em sincronia com o CSS, que é uma dívida que o projeto
  já tem em três lugares (`DURACAO_CAIXA`, `DURACAO_FICHA_MS`, os `220ms` repetidos).

**O critério:** vence o que consertar o chat no Android **sem mexer no comportamento
da tela de gravação**. Se a linha de configuração passar nesse teste, ela ganha, por
ser menos código e por consertar a revisão junto. Qual foi e por quê fica registrado
no `ARCHITECTURE.md`.

**Teste:** nenhum automático — teclado virtual não se testa em `vitest`. A verificação
é abrir o chat no telefone.

**`ARCHITECTURE.md`:** **sim, se vencer a linha de configuração**, porque ela muda o
comportamento de todas as telas quando o teclado abre. Se vencer o caminho cirúrgico,
não.

## 3. O chat abre conversa nova

**O sintoma:** abro o chat para perguntar uma coisa e caio no meio da conversa de
ontem.

**A causa é uma decisão declarada**, e esta emenda a reverte. `Chat.tsx:176-181` tem
um `useRef` chamado `primeiraAbertura` com este comentário: *"Nasce `true` para a
primeira abertura escolher a conversa mais recente, e só ela: depois disso, qual
conversa está aberta é decisão minha."* O efeito de `Chat.tsx:216-242` carrega
`separarConversas(...).ativas[0]` — a conversa ativa tocada mais recentemente.

E a decisão nem se cumpre como escrita: **a ref é por montagem do componente.** O
`<Chat>` é desmontado ao gravar (`Gravacao.tsx:186-198`) e ao navegar para qualquer
outra tela, então toda volta à `/` reseta a ref e reabre a última — o "só a primeira
vez" virou "toda vez".

**O conserto:** abrir o chat é sempre começar do zero. A ref sai, o efeito para de
carregar a mais recente, e a lista continua a um toque no ícone que já existe. O
comentário é reescrito para registrar a reversão e o motivo — documento que mente com
autoridade é pior que documento nenhum, e um comentário que descreve a decisão
anterior é exatamente isso.

**Não cria conversa órfã.** `nova()` (`Chat.tsx:352-359`) só limpa o estado local; o
nó `:Conversa` nasce no `POST /api/chat` quando a primeira pergunta é enviada
(`api/conversas/route.ts:15-17` declara que não há `POST`). Abrir o chat e fechar sem
perguntar não grava nada.

**Teste:** nenhum. É um efeito de componente.

**`ARCHITECTURE.md`:** sim — a seção do chat descreve qual conversa abre, e isso muda.

## 4. A correção passa a dizer de quem é o erro

**O defeito:** `doAtomo` (`correcoes.ts:212-224`) copia `prompt_version` e `modelo` do
átomo da proposta, e esses são **sempre os da extração** (`extracao.ts:868-869`). Mas
`agenteDaReferencia` (`correcoes.ts:158`) etiqueta as correções de `sujeito` e
`mencao_removida` como `agente: "resolucao"` quando a entidade era conhecida. A
etiqueta diz um agente, o carimbo diz outro — e é justamente o agente que a slice 7
acabou de ligar ao laço de aprendizado.

Os campos certos existem na proposta (`Extracao.prompt_version_resolucao`,
`modelo_resolucao`, `tipos.ts:497-498`) e não são copiados.

**E a correção não é só trocar o campo**, porque o próprio `tipos.ts:495` avisa: a
resolução determinística roda para **toda** menção, e `prompt_version_resolucao` só é
preenchido se alguma teve que ir ao modelo — *"registrar uma versão que não rodou
seria mentira"*. O docstring de `agenteDaReferencia` (`correcoes.ts:143-158`) já
levanta essa dúvida há três fatias.

**A regra nova, decidida na entrevista:**

- Sessão em que **algum** modelo de resolução rodou → correção de sujeito/menção fica
  como `resolucao`, carregando `prompt_version_resolucao` e `modelo_resolucao`.
- Sessão em que **nenhum** rodou → a correção passa a ser da **extração**, com a
  versão dela. Quem escreveu o nome foi o agente 1; o agente 2 não foi chamado. O
  `calibracao-2` deixa de receber material sobre um prompt que não participou.

**A precisão é por sessão, e isso é escolha, não descuido.** Saber se *aquela menção*
foi ao modelo exigiria um campo novo gravado em toda proposta, e a emenda deixaria de
ser emenda. Numa sessão mista — duas menções ao modelo e oito determinísticas — as
correções das oito ainda vão para a resolução. **Erra para o lado de dar material
demais ao agente 2**, que é o lado seguro: o agente existe para decidir isso.

**O desempate continua carimbado como resolução.** A proposta não guarda versão da
segunda passada, e criar o campo é outra emenda. Fica declarado nos limites.

**As correções já gravadas ficam como estão.** Recalcular não é confiável — a proposta
original de uma sessão re-extraída pode já não existir, porque `forcar` sobrescreve
`extracao.json` guardando só uma anterior. Elas envelhecem e a poda do índice
(`podarIndice`, teto de 500) come as mais velhas. Por um tempo o agente aprende com
carimbo torto, e isso é sabido.

**Teste:** `apurarCorrecoes` é função pura e já tem andaime — casos novos para os dois
ramos (sessão com e sem chamada de resolução).

**`ARCHITECTURE.md` no mesmo commit:** a seção da calibração e o que a `Correcao`
carrega.

## O escopo

### Entra

As quatro emendas acima, e nada mais.

### Não entra

- **As outras oito ações de `/entidades`.** Ficam para quando o uso disser quais
  incomodam.
- **Campo por menção dizendo se ela foi ao modelo.** É o que daria precisão exata na
  emenda 4, e é o que a tiraria do tamanho de emenda.
- **Versão própria do desempate na proposta.**
- **Recálculo ou descarte das correções antigas.**
- **Migration.** Nenhuma das quatro toca o grafo.

## Limites que esta fatia cria

- **A atribuição da correção passa a estar certa por sessão e torta por menção.** Numa
  sessão mista, correção de menção resolvida sem modelo ainda alimenta o agente 2. É
  melhor do que hoje, e não é exato.
- **Correção de menção decidida no desempate continua creditada à resolução**, então o
  prompt do desempate segue sem receber nada — que era o buraco que a slice 7 abriu e
  não fechou.
- **A tela de entidades fica meio a meio**: uma ação remenda o estado local, oito
  refazem o grafo inteiro. Inconsistência declarada, com data de validade — o uso diz
  se e quando as outras vêm.
- **Reverter a decisão da conversa mais recente pode me morder** no dia em que eu
  fechar o chat sem querer no meio de uma conversa longa. A defesa é a lista, a um
  toque, e ela já existe.
