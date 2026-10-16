# Interface, onda 4 — a gestão

**Objetivo:** que as telas de gestão — sessões, a ficha de entidade, o radial
do confronto, o editor de agente e a emenda da calibração — achem o que eu
procuro sem eu lembrar a data, não percam o que eu escrevi, e não façam o
irreversível num toque só.

Quinta peça de `Specs/interface.md` (a avaliação). Quatro decisões saíram de
uma rodada de entrevista em 15/10/2026; as outras foram tomadas sem perguntar,
**a pedido** — "não me pergunte mais nada antes de implementar" —, seguindo o
que as rodadas anteriores mostraram: ver tudo vence o compacto, o irreversível
pede dois toques, e visual assentado fica. Cada uma diz o que foi escolhido e o
que foi recusado, e as tomadas sem pergunta estão marcadas.

**Ponto de retorno:** a tag `ui-antes-da-onda-4`.

**Pronto quando:**

1. Abro `/sessoes` e cada linha começa pelo que eu disse — a frase do primeiro
   item —, com a data, a duração, o status e quantos itens na linha de baixo;
   a sessão em revisão diz quantos esperam revisão. Rolo até o fim e as
   seguintes chegam sozinhas: a 51ª sessão aparece.
2. Na ficha, escrevo no resumo, toco fora, e ele grava — "salvo" ao lado do
   rótulo. Sem botão de salvar em campo nenhum, nem no nome.
3. Com a rede cortada, escrevo e tento fechar: o ← vira "descartar 1?", e só o
   segundo toque fecha e perde o texto.
4. "desfazer" numa ficha não apaga o rascunho de outra.
5. Um par de duplicatas abre a mesma comparação da fusão à mão, com o aviso de
   que não tem desfazer.
6. O radial a 390 px tem letra de 12 px, e cada nó e cada sigla têm alvo de
   dedo.
7. No editor de agente, o que eu mudei aparece contra o git, seção por seção;
   fechar com edição não salva pede dois toques; "voltar ao original" também.
8. Na calibração, "descartar" a emenda pede dois toques.

## As decisões

### Perguntadas

| # | Pergunta | Escolhido | Recusado |
|---|---|---|---|
| 1 | O que a linha da sessão mostra | **a frase do primeiro item e quantos itens** — em revisão, quantos esperam revisão —, **sem as entidades**, e **a data como detalhe**, na linha de baixo | itens e as 3 entidades mais citadas; como está |
| 2 | Passadas as 50 sessões | **rolar e carregar sozinho** | um "carregar mais"; todas, sempre |
| 3 | Como a ficha salva | **sozinha, ao sair do campo** — nome, resumo e os três campos | um salvar só no pé; salvar por campo, como hoje |
| 4 | Fechar com texto não salvo | **segura no fechar**: "descartar N?" em dois toques | guardar calado e marcar a linha; salvar ao fechar |

### Tomadas sem perguntar

| # | Ponto | Escolhido | Recusado | Por quê |
|---|---|---|---|---|
| 5 | Sessão sem item nenhum ainda | a data sobe para a linha de cima | uma linha vazia; a transcrição | sem frase, a data é o que a identifica; ler a transcrição de cada sessão da lista custaria uma ida ao R2 por linha |
| 6 | Qual é o "primeiro item" | o de menor `inicios_s[0]` — o primeiro que eu disse —, e sem âncora por último, na ordem do id | o primeiro extraído | "a primeira frase" é sobre a fala, e não sobre a ordem em que o extrator trabalhou |
| 7 | O par de duplicatas | **abre a comparação da fusão à mão**, dentro da ficha, com o aviso e o "manter esta" de cada lado | dois toques no "manter X"; como está | o par é o mesmo ato irreversível que a fusão à mão, e só a comparação mostra qual ficha se perde |
| 8 | O radial a 390 px | **por dentro**: letra de ~12 px na tela, alvo invisível de ~44 px em cada nó e sigla, o anel de foco visível, e a data das quadrantes de cima e de baixo para fora do nó | a lista antes do radial; teto por quadrante com "+N" | o maior radial de hoje tem 8 relações e no máximo 6 num quadrante: o problema é o tamanho, não o amontoado. Teto resolveria um problema que não existe e esconderia relação |
| 9 | A diferença contra o git no editor | **por seção, empilhada e sem cor**, como a emenda da calibração: só as seções que diferem, "no git" em cima e "agora" embaixo | linha a linha com − e +; nenhuma | é o desenho que o sistema já usa para "o que muda no prompt", e o prompt já é endereçado por seção |
| 10 | Fechar o editor com edição não salva | **segura no fechar**, como a ficha (decisão 4) | perder calado, como hoje | o mesmo engano, o mesmo gesto |
| 11 | "voltar ao original" e "descartar" a emenda | **dois toques** | um toque | os dois jogam fora trabalho — meu ou de uma chamada de modelo — que não volta |
| 12 | O tipo na linha de `/entidades` | na linha de meta, antes da contagem: "pessoa · 12 átomos · 5 sessões" | um selo; a cor | é texto que já existe na ficha e no seletor |
| 13 | "usar este texto" (a proposta do agente 3) | **grava na hora** | esperar o campo perder o foco | é uma escolha explícita, e com o salvar automático o campo nem chegou a ter foco |

## 1. Sessões

### 1.1 A linha

```
acordei cedo e fui direto pro escritório, e a Marina já…
hoje, 21:03 · 6 min · confirmada · 8 itens

a conversa com o Rafa sobre o contrato saiu melhor do que…
ontem, 22:40 · 4 min · em revisão · 5 para revisar

12/10, 07:15
2 min · transcrito
```

- **A frase** é o texto do primeiro item (decisão 6), cortado em duas linhas
  pelo CSS (`line-clamp`), e é ela o link que abre a sessão.
- **A contagem**: confirmada, os átomos ativos que ela gerou ("8 itens"); em
  revisão, os átomos da proposta ("5 para revisar"). Os pedidos do "o que
  faltou" ainda não confirmados não entram.
- **De onde vem**: confirmada, do grafo, na mesma consulta da lista. Em revisão,
  do `extracao.json` de cada uma — uma leitura do R2 por sessão em revisão, que
  são poucas. As outras não têm item.
- O resto da linha — transcrição, reextrair, apagar, a cor de revisada — fica
  como está.

### 1.2 A rolagem que carrega sozinha

- `GET /api/sessoes` vira página: `?antes=<iniciada_em>` traz as 50 anteriores
  a esse instante (`LIMITE_LISTA_SESSOES`). A resposta ganha `mais` (há mais
  antigas) e `cursor` (o `iniciada_em` da última lida), e a primeira página
  ganha `total`, para o cabeçalho.
- **O cursor e o `mais` são da leitura crua**, antes do filtro da sessão sem
  bloco: senão uma página filtrada pela metade pareceria o fim.
- Um sentinela no fim da lista, com `IntersectionObserver` e 400 px de folga,
  pede a próxima página quando aparece. Carregando, "carregando…"; falhando,
  "não deu para carregar as seguintes — tentar de novo", porque o sentinela que
  já está na tela não dispara de novo sozinho.
- O cabeçalho diz o total ("51 sessões"), e não mais "as 50 mais recentes".
- A releitura de durante um reextrair relê a primeira página e **funde por id**
  com o que já está na tela: as páginas antigas não somem.

## 2. A ficha

### 2.1 Salvar ao sair do campo (decisão 3)

- Nome, resumo e os três campos de perfil gravam no `blur`, quando o valor
  difere do grafo. Saem os cinco botões "salvar" e o modo "renomear": o nome é
  um campo, no topo, ao lado do tipo. Enter no nome também grava.
- Ao lado do rótulo de cada campo, o estado: "salvando…", "salvo" por 2 s, ou
  "não salvou — motivo" no `--erro`. O rascunho fica no campo até gravar.
- O nome vazio ou pronome é recusado na tela, sem ir ao servidor, e fica como
  rascunho com o motivo.
- **Renomear troca a chave da entidade** (`nome_normalizado`): a ficha passa a
  apontar para a chave nova, senão ela se esvaziaria na releitura.
- Tipo, canônica e grafias continuam gravando no toque, como já faziam.

### 2.2 Segura no fechar (decisão 4)

- O ←, o `Esc` e o véu passam por um pedido de fechar: tira o foco do campo
  (o que grava o que estava nele), espera o que está gravando terminar, e só
  então fecha.
- **Se sobrou rascunho** — o que falhou, o nome recusado —, o ← vira
  "descartar N?" no `--erro`, e o segundo toque (no ←, no `Esc` ou no véu)
  descarta os rascunhos desta entidade e fecha. Desarma em 4 s ou ao perder o
  foco.

### 2.3 Os rascunhos são da entidade

`desfazer`, `enriquecer` e a mudança do retrato limpavam **todos** os
rascunhos da tela. Passam a limpar só os da entidade em questão, e só no
sucesso.

### 2.4 O par de duplicatas (decisão 7)

O par mostra "comparar" e "são diferentes". "comparar" abre a ficha da primeira
com a fusão já na comparação — as duas lado a lado, o aviso "Isto não tem
desfazer" e o "manter esta" de cada lado. Fundida, o par sai da lista como
hoje.

### 2.5 O tipo na linha (decisão 12)

"pessoa · 12 átomos · 5 sessões · sem resumo".

## 3. O radial (decisão 8)

O SVG continua com o mesmo desenho e a mesma geometria; mudam os tamanhos, que
são de unidade de `viewBox` — 410 de lado, que a 390 px vira ~0,87:

| Elemento | Hoje | Passa a |
|---|---|---|
| a data do vizinho | 9,5 | 14 (≈ 12 px) |
| a sigla da relação | 11 | 13 |
| o rótulo do centro | 10 | 12 |
| o nó do vizinho | raio 12 | raio 14 |
| o círculo da sigla | raio 11 | raio 13 |
| o alvo de toque | o próprio desenho | um círculo invisível de raio 24 em volta de cada nó e sigla |

- **A data das quadrantes de cima e de baixo vai para fora do nó**, acima ou
  abaixo, centrada: ao lado, com 14 de letra, ela encostaria no vizinho seguinte
  do leque.
- **As siglas alternam a distância** do centro (52 % e 64 % do caminho) quando o
  quadrante tem três ou mais: no raio de hoje, duas siglas vizinhas se tocavam.
- **O anel de foco**: o alvo invisível ganha contorno no acento quando o grupo
  tem foco de teclado — era só o traço engrossando, fraco demais.

## 4. O editor de agente

- **A diferença contra o git** (decisão 9). Abaixo do prompt, quando o texto da
  caixa difere da base: "o que difere do git — N seções", e cada seção que
  difere empilhada, "no git" e "agora", sem cor. Seção que só existe de um lado
  diz isso. O que vem antes do primeiro cabeçalho conta como "início". Compara
  com o que está **na caixa**, não com o salvo: serve enquanto eu edito.
- O recorte por seção vai para um módulo puro, `src/lib/secoes.ts`, que o
  navegador pode importar; `redacao.ts` passa a importar dele o cabeçalho e o
  `fatiar`, e a regra continua num lugar só.
- **Segura no fechar** (decisão 10): o ×, o `Esc` e o véu, com prompt, modelo
  ou limiar mexidos e não salvos, armam "descartar?" em dois toques.
- **"voltar ao original" em dois toques** (decisão 11): "voltar ao original?"
  no `--erro`, e desarma em 4 s ou ao perder o foco.

## 5. A calibração

"descartar" a emenda escrita vira "descartar?" no `--erro` no primeiro toque
(decisão 11). O "descartar" de um padrão da pauta fica de um toque: o texto
dele está na tela, e pedir os padrões de novo o refaz.

## 6. Verificação

`pnpm typecheck`, `pnpm test` e `pnpm build` a cada commit. Testes novos para o
que é puro:

- **a página de sessões** — o cursor e o `mais` da leitura crua, e o primeiro
  item da proposta pela regra da decisão 6;
- **a linha da sessão** — frase em cima, ou a data quando não há; a contagem
  por status;
- **o rascunho da entidade** — limpar os rascunhos de uma chave não toca os das
  outras;
- **a diferença por seção** — só as que diferem, as que existem de um lado só,
  e o início antes do primeiro cabeçalho.

E no aparelho (`PROXIMOS-TESTES.md`): a 51ª sessão aparecendo ao rolar; o salvar
ao sair do campo e o "descartar N?" com a rede cortada; a comparação vinda do
par; o radial a 390 px; a diferença no editor.

## O que muda de arquivo

| Arquivo | O quê |
|---|---|
| `src/lib/sessoes.ts` | `paginaDeSessoes`: a página com cursor, a frase e a contagem das confirmadas; `primeiroItem` da proposta |
| `src/app/api/sessoes/route.ts` | `?antes`, `mais`, `cursor`, `total`; a frase e a contagem das em revisão |
| `src/components/Sessoes.tsx` | a linha nova e a rolagem que carrega sozinha |
| `src/components/Entidades.tsx` | salvar ao sair do campo, o nome como campo, segurar no fechar, os rascunhos por entidade, o par pela comparação, o tipo na linha |
| `src/components/Confronto.tsx` | os tamanhos, os alvos, a data para fora, as siglas alternadas |
| `src/lib/secoes.ts` (novo) | o cabeçalho, `fatiar` e `diferencaPorSecao` — puro |
| `src/lib/redacao.ts` | importa de `secoes.ts` |
| `src/components/Agentes.tsx` | a diferença, segurar no fechar, o voltar ao original de dois toques |
| `src/components/Calibracao.tsx` | o descartar da emenda de dois toques |
| `src/app/globals.css` | o que cada peça pede |
| `ARCHITECTURE.md` §2, `arquitetura/` §10, §11, §14 | o mapa e os capítulos |

## Ordem de execução

Um commit por peça, cada um com o seu pedaço de documento:

1. sessões: a linha e a rolagem;
2. a ficha: salvar ao sair, segurar no fechar, rascunhos por entidade, o tipo na
   linha;
3. o par de duplicatas pela comparação;
4. o radial;
5. o editor de agente e a emenda da calibração;
6. o fechamento: o "Como ficou", aqui e na avaliação, e o `PROXIMOS-TESTES.md`.

## Fora de escopo

- **As entidades na linha da sessão**, recusadas na decisão 1.
- **Busca de sessão** por texto ou por entidade.
- **A frase de sessão que ainda não tem item**, que pediria ler a transcrição.
- **Rascunho que sobrevive a recarregar a página.**

## Limites que esta fatia cria (para o §14)

- **Re-extrair uma sessão além das primeiras 50 não atualiza a linha
  sozinha**: a releitura é da primeira página. Recarregar atualiza.
- **Fechar a aba com um campo da ficha em foco** perde o que estava nele: o
  `blur` não chega a gravar.

## Como ficou
