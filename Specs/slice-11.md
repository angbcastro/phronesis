# Slice 11 — O que faltou, a pedido

**Objetivo:** que a revisão saiba consertar o que o extrator deixou de fora sem
jogar fora o que eu já revisei. Eu aponto em poucas palavras o que faltou, e o
sistema relê a transcrição sobre aquilo e me devolve o átomo — pelo mesmo
processo de sempre: extração, identidade, âncora no áudio.

**Pronto quando:**

1. Numa revisão fechada, toco no **+** no fim da lista, escrevo "a conversa com a
   Marina sobre o contrato", e em menos de dois minutos um ou mais átomos aparecem
   no fim da lista — aprovados, com player e com a linha "a pedido: «a conversa
   com a Marina sobre o contrato»".
2. Edito o átomo pedido como qualquer outro: texto no lugar, tipo, sujeito e
   menções no editor.
3. Confirmo, e ele está no grafo com `prompt_version` e `modelo`, ligado às
   entidades certas, e entra no confronto como os outros.
4. Em `/calibracao`, o `extracao` ganha uma correção `faltou` com o texto do
   átomo pedido que eu confirmei.
5. Peço algo que eu não falei, e volta "não achei isso na transcrição" — nenhum
   átomo inventado.

**Depende de** nada que não esteja no ar.

## Por que agora

Quando o extrator deixa algo de fora, hoje a única saída é o `forcar` da lista de
sessões: refaz a proposta inteira, e o que eu já editei na revisão morre junto.
O conserto custa mais que a falta, e na prática a falta fica.

E a metade do conserto já existe. A slice 4.6 desenhou o gesto "faltou um": o
corpo do confirmar aceita `gestos.faltantes`, e `apurarCorrecoes` o transforma em
correção `faltou` do `extracao`, ancorada pela transcrição. O servidor sabe tudo
isso — mas o botão nunca foi feito, e `montarGestos` manda `faltantes` vazio
desde então. Esta fatia dá ao gesto o botão, e ao botão o átomo.

**O que não está quebrado, e esta fatia não toca:** a extração por janela, a
revisão que cresce, a resolução de identidade, a máquina de estados, o grafo.

## As decisões

Perguntadas em 13/10.

| Decisão | Escolhido | O que foi recusado, e por quê |
|---|---|---|
| **O que eu descrevo já está, em parte, num átomo** | **cria um novo assim mesmo** | "Avisar e não criar" me obriga a escrever o detalhe que faltava. "Engordar o átomo existente" (`estende`) muda um átomo que eu talvez já tenha lido — e se eu já tiver editado o texto dele, a minha edição vence e a extensão some calada |
| **Como os átomos pedidos entram na lista** | **aprovados, no fim, com a linha "a pedido: «…»", e editáveis como qualquer átomo** — texto, tipo, sujeito e menções | "Aprovados sem marca": um minuto depois eu já não sei qual veio do pedido. "Desmarcados": um toque a mais por átomo que eu mesmo pedi |
| **Calibração** | **cada átomo pedido que eu confirmo vira `faltou` do `extracao`, com o texto final dele** | "Sempre, com a descrição": pedido de coisa que eu nem falei também acusaria o extrator. "Não alimentar": o gesto da 4.6 continuaria sem botão |
| **O agente** | **o mesmo `extracao`, com o foco apontado** | Um agente `pedido` próprio seria mais um prompt para calibrar à mão, para o mesmo trabalho — e as correções `faltou` são material justamente do `extracao` |
| **Onde o pedido mora** | **um objeto próprio no R2, `pedidos.json`** | Acrescentar em `extracao.json` é menos código, mas quebra a escrita única que é a trava de idempotência da extração e mistura o que o agente propôs sozinho com o que eu pedi — e é contra o primeiro que a calibração compara |
| **Quando o "+" existe** | **só com a proposta fechada** | Durante o `crescendo`, o que falta pode chegar na janela seguinte; e os ids das janelas são carimbados contra o fim da lista, onde o átomo pedido estaria |

## 1. Onde mora — `sessoes/<id>/pedidos.json`

O §9 da arquitetura (`arquitetura/09-r2.md`) explica por que `parcial.json` e `extracao.json` são dois objetos: donos
diferentes no tempo. O parcial é escrito por vários `waitUntil` concorrentes, por
etag; a proposta é escrita uma vez, com `If-None-Match`, e **essa escrita única é
a trava de idempotência da extração**. O pedido é um terceiro dono — eu, depois
de a proposta fechar —, e ganha o seu objeto, escrito pelo laço de `etag.ts`
(`atualizarJson`).

```
sessoes/<id>/pedidos.json   { sessao_id,
                              pedidos: [{ id, texto, estado, em, motivo?, indices,
                                          prompt_version, modelo,
                                          prompt_version_resolucao, modelo_resolucao,
                                          candidatas }],
                              atomos, entidades, descartados, atualizado_em }
```

| Campo | O que é |
|---|---|
| `pedidos[].id` | o hash do texto normalizado — a chave da idempotência (§5) |
| `pedidos[].estado` | `em_curso` \| `pronto` \| `falhou`, com `em` e, na falha, `motivo` — a mesma mecânica de lease de `EstadoJanela` |
| `pedidos[].indices` | os índices dos átomos que aquele pedido produziu; vazio = não achou nada |
| `pedidos[].candidatas` | as chaves do dossiê que o pedido viu — procedência, como na janela |
| `atomos` | os átomos pedidos, já ancorados e resolvidos, cada um com `pedido: <id>` |
| `entidades` | as candidatas que os átomos pedidos citam, já agregadas (§2) |

`extracao.json` continua sendo exatamente o que o extrator propôs sozinho, e não
muda um byte depois de escrito.

## 2. A leitura junta os dois

Uma função pura, `juntarPedidos(extracao, pedidos)`, num módulo novo,
`src/lib/pedidos.ts` — que, como `janela.ts`, **não fala com modelo nenhum**: a
chamada continua morando em `extracao.ts`.

- **Átomos:** os da proposta e depois os pedidos, na ordem dos índices.
- **Candidatas:** unidas por `nome_normalizado`, somando `ocorrencias`. As do
  pedido são agregadas **na hora do pedido** (`agregarCandidatas`, com o catálogo
  que a chamada já leu), para que juntar não precise ir ao Neo4j.
- **Cabeçalho** (`prompt_version`, `modelo`, `truncada`, `criado_em`): o da
  proposta. Cada átomo já carrega a própria procedência (regra 7).

Quem junta: `fechadaDe`, em `pipeline.ts` — e por ela `propostaAtual`, o
`GET /extracao` e o fluxo de eventos, sem mudar contrato nenhum —, e o confirmar
(§6). Uma leitura a mais no R2 por abertura de revisão fechada.

## 3. Os ids — carimbados na escrita, como na janela

O id continua `<sessao_id>-<n>`, e o `n` é carimbado **no mutador que grava**,
contra `extracao.atomos.length + pedidos.atomos.length` daquele instante — o
precedente é `aplicarJanela`. Dois pedidos concorrentes não colidem, o `MERGE`
do confirmar continua idempotente (regra 4), e as edições da tela, chaveadas por
`indice`, continuam valendo quando a lista cresce.

## 4. A chamada — o mesmo agente, com o foco apontado

`extrairJanela` ganha a opção `pedido` (o texto que eu escrevi). Com ela:

- **A transcrição é a inteira** (`transcricao.json`), e não uma janela: o que
  faltou pode estar em qualquer minuto, e dito em dois.
- **O dossiê é o da sessão inteira:** a união das `candidatas_NNN.json` de todos
  os blocos com o que a sessão já atribuiu — `candidatasDaJanela` sobre todos os
  índices, `entidadesJaAtribuidas` sobre a proposta juntada, `dossieDaJanela`.
  Tropeço na busca vira dossiê vazio, como na janela.
- **No lugar de `blocoDaJanela` entra `blocoDoPedido`**, injetado por
  `inserirAntesDoFormato`: `INSTRUCOES_BASE → blocoDasCandidatas → blocoDoPedido →
  FORMATO → texto`. O que ele diz:

```
O QUE FALTOU
A revisão desta sessão já está aberta, e eu disse que ficou faltando isto:
«<o que eu escrevi>»
Leia a transcrição inteira e devolva somente o átomo — ou os átomos — sobre isso,
com todas as regras acima. Não importa se algum átomo que já existe diz parte
disso: é exatamente isto que eu pedi. Se a transcrição não fala disso, devolva
{"atomos":[],"entidades":[]} — não invente o que eu não disse.
```

- **Sem `estende`, e sem a lista do que já foi proposto no prompt** — a decisão 1
  é criar assim mesmo. `jaPropostos` continua indo **só para a resolução**, onde é
  o prior do agente 2: quem eu já citei nesta sessão.
- **Pedido ausente → `""`**, e o prompt sai byte a byte igual ao de hoje. É a
  disciplina de todo bloco injetado neste prompt, e um teste a cobra.
- O resto é o de sempre: `efetivo("extracao", …)` (o prompt editado e as
  emendas valem aqui também), carimbo `extracao-9+p<hash>`, teto e
  escalonamento, `fecharJsonTruncado`, `comEsperaDeLimite`, resolução e
  desempate, `ancorar` contra as palavras da transcrição inteira.
  `tests/agentes.test.ts` e `tests/gateway.test.ts` passam sem exceção nova.

## 5. A rota — `POST /api/sessoes/:id/pedidos`

Corpo `{ texto }`. **Síncrona**, `maxDuration = 300`, prazo `PRAZO_DA_FUNCAO_MS`
contado do começo da função; a medida segue o padrão do `/extrair`
(`comInvocacao` + `comMedicao`).

| Guarda | Resposta |
|---|---|
| sessão não existe | 404 |
| sessão fora de `em_revisao` | 409 — inclusive `confirmada` |
| `extracao.json` não existe (proposta ainda crescendo) | 409 |
| texto vazio, ou acima de 500 caracteres | 400 |

**Idempotência:** o `id` do pedido é o hash do texto normalizado. O mesmo pedido
de novo devolve o resultado já gravado, sem chamar modelo; um pedido `em_curso`
com lease fresco (`LEASE_MS`) não é refeito — a mecânica de `reivindicar` da
janela. Pedido `falhou` é refeito.

**O resultado é gravado antes da resposta.** Se a resposta se perder — tela
bloqueada no meio da espera —, o átomo não se perde: reabrir a revisão o traz,
porque o `GET /extracao` já junta os pedidos.

Responde `{ pedido: { id, texto, atomos }, proposta }`, com `proposta` no formato
do `GET /extracao`, já juntada.

## 6. O confirmar

Lê `extracao.json` e `pedidos.json`, junta pela mesma `juntarPedidos`, e acha o
átomo aprovado pelo índice na lista juntada. **A procedência do átomo pedido vem
do R2, como a de qualquer outro** — `id`, offsets, âncoras, `prompt_version`,
`modelo`, o `citado` que vira alias —, e nunca do corpo (§4.7).

`capturarCorrecoes` recebe a proposta **sem** os pedidos: é contra o que o
extrator propôs sozinho que a correção se apura. Desmarcar um átomo pedido não é
`rejeitado` do extrator, e editá-lo não é `texto` do extrator — o que o pedido
ensina ao extrator chega pelo `faltou` (§7).

## 7. A tela

Na `Revisao`, um **+** no fim da lista de átomos — e só quando `crescendo` for
falso.

- **Tocar** abre, no mesmo lugar, um campo ("o que faltou?") e um botão. Fechado
  por padrão: o caso comum — aprovar tudo — não muda, e ignorar o "+" não custa
  nada.
- **Enquanto roda:** "procurando na transcrição…", e o "+" e o **confirmar
  travados** — a mesma regra do `crescendo` (§4.19): não gravar metade. A trava
  vai na guarda de `confirmar()`, e não só no `disabled`.
- **Achou:** a proposta da resposta entra por `mesclarProposta` — a lista só
  cresce, e o que eu já editei sobrevive porque tudo é chaveado por índice. Os
  átomos pedidos entram **aprovados**, no fim, com a linha "a pedido: «…»" logo
  abaixo do resumo. É procedência, não indicador de novidade, e é a única linha
  que a fatia acrescenta. O editor é o de todo átomo.
- **Não achou:** "não achei isso na transcrição", e o texto fica no campo.
- **Falhou:** a mensagem do servidor, e o texto fica no campo para tentar de novo.
- **Confirmar:** `montarGestos` passa a receber `faltantes` — o texto final
  (`textoDe`) de cada átomo pedido **aprovado**. Pedido sem resultado ou com todos
  os átomos desmarcados não manda nada (decisão 3). O resto do caminho —
  `normalizarGestos`, `apurarCorrecoes`, a âncora pela transcrição, a chave
  `${sessao_id}|faltou|…` — já existe e não muda.

Como o pedido é texto meu e o átomo é a resposta, a tela mostra os dois: eu
escrevi uma coisa, e o átomo pode ter achado outra.

## 8. As bordas

- **Re-extrair (`forcar`) zera `pedidos.json`**, junto com o parcial
  (`extrairSessao`). A proposta nova renumera tudo, e um átomo pedido colidiria
  com ela. Re-extrair é recomeçar.
- **Apagar a sessão apaga o pedido:** `chavesDaSessao` passa de sete para **oito**
  chaves fixas, com `pedidos.json` antes do manifest.
- **A máquina de estados não muda.** Pedir não é estado: a sessão fica em
  `em_revisao` o tempo todo.
- **Nenhuma migration.** `pedido` fica no R2 e não vai ao grafo — no grafo, o
  átomo pedido é um átomo como os outros.

## 9. Verificação

- `pnpm test`, com `tests/pedidos.test.ts` novo:
  - `juntarPedidos`: índices seguem depois da proposta, candidatas unidas por
    chave com `ocorrencias` somadas, proposta sem pedido sai igual;
  - o mutador renumera contra a lista do instante — dois pedidos aplicados sobre
    o mesmo retrato não repetem id;
  - `montarPrompt` sem pedido é **byte a byte** o de hoje; com pedido, o bloco
    entra antes do `FORMATO` e depois do dossiê;
  - `montarGestos`: `faltantes` só dos átomos pedidos aprovados, com o texto final;
  - o confirmar acha a procedência do átomo pedido no R2, e não no corpo;
  - `chavesDaSessao` traz `pedidos.json`, e o manifest continua por último.
- `tests/agentes.test.ts`, `tests/gateway.test.ts` e `tests/arquitetura.test.ts`
  passam: nenhum agente novo, a rota e o módulo com texto no mapa e no §10.
- Em dev, contra o banco de desenvolvimento: uma sessão real em revisão, um pedido
  do que foi dito (o átomo chega com player), um do que não foi (volta vazio), o
  mesmo pedido de novo (volta na hora), fechar a aba no meio de um pedido e
  reabrir (o átomo está lá), confirmar, e ver a correção `faltou` em `/calibracao`.
- **Se o átomo pedido presta, quem julga sou eu**, na revisão — sem gabarito, sem
  fixture (`CLAUDE.md`). Quando estiver ruim, o que se ajusta é o bloco.

## Fora de escopo

- Pedir durante o `crescendo`.
- Pedir que um átomo existente seja engordado (`estende` a pedido).
- Pedir depois de confirmada — o átomo nasceria sem revisão em volta.
- Guardar a origem "a pedido" no grafo.
- Histórico de pedidos fora da sessão, ou pedido que atravessa sessões.

## O que muda de arquivo

| arquivo | o quê |
|---|---|
| `src/lib/pedidos.ts` | **novo** — `juntarPedidos`, o mutador que carimba os ids, a reivindicação do pedido, carregar e gravar `pedidos.json`, e a orquestração da rota (transcrição, dossiê, chamada, agregação) |
| `src/lib/extracao.ts` | `blocoDoPedido`; a opção `pedido` em `extrairJanela` e o lugar dele em `montarPrompt` |
| `src/lib/pipeline.ts` | `fechadaDe` junta os pedidos; o `forcar` zera `pedidos.json` |
| `src/lib/chaves.ts` | `chavePedidos`; oito chaves fixas em `chavesDaSessao` |
| `src/lib/tipos.ts` | `Pedidos`, `EstadoPedido`, `AtomoProposto.pedido?` |
| `src/app/api/sessoes/[id]/pedidos/route.ts` | **novo** — a rota |
| `src/app/api/sessoes/[id]/confirmar/route.ts` | junta antes de achar pelo índice; `capturarCorrecoes` com a proposta pura |
| `src/components/Revisao.tsx` | o "+", o campo, as travas, a linha "a pedido", `faltantes` no `montarGestos` |
| `tests/pedidos.test.ts` | **novo** |
| `ARCHITECTURE.md` | a linha 11 do estado, "O sistema numa página", `pedidos.ts` no mapa dos módulos |
| `arquitetura/` | §4.6 (o bloco do pedido), §4.7 (o "+"), §4.11 (o `faltou` ganha botão), §6 (a trava do pedido), §9 (`pedidos.json`, oito fixas), §10 (a rota), §11 (a tela), §14 (os limites abaixo) |
| `PROXIMOS-TESTES.md` | a verificação em dev |

## Ordem de execução

1. `pedidos.ts`, os tipos e a chave, com o teste da junção e da renumeração.
2. `blocoDoPedido` e a opção em `extrairJanela`. Ponto de retorno: o prompt sem
   pedido idêntico byte a byte, no teste.
3. A rota. Ponto de retorno: em dev, um pedido numa sessão `em_revisao` grava
   `pedidos.json`, e o `GET /extracao` devolve o átomo no fim da lista. **Se a
   chamada sobre a sessão inteira passar de 200 s numa sessão de 15 min, paro e
   volto a você** — o prazo da rota é 280 s, e o rate limit come o resto.
4. O confirmar.
5. A tela.
6. O `forcar` e `chavesDaSessao`.
7. A documentação acompanhando cada passo, no mesmo commit.

## Limites que esta fatia cria (para o §14)

- **O átomo pedido é indistinguível no grafo.** A origem mora em `pedidos.json`,
  que some com a sessão. Quem quiser saber, daqui a um ano, que um átomo veio de
  um pedido, não tem onde perguntar.
- **Re-extrair perde os pedidos** (§8). O texto que eu escrevi também.
- **O mesmo texto pedido duas vezes devolve o mesmo resultado** — é a
  idempotência. Para pedir de novo, outra redação.
- **A chamada lê a sessão inteira:** numa sessão longa ela custa o que custava o
  passe único (50–100 s com o modelo de hoje), com a tela esperando e o confirmar
  travado.
- **Pedir o que eu não falei volta vazio por instrução, e instrução é tentativa.**
  A defesa final é a revisão: átomo cujo trecho não está na transcrição já aparece
  "sem áudio".
- **O "a pedido" não sobrevive a eu reescrever o átomo inteiro** — continua
  marcado como pedido mesmo se eu o transformar em outra coisa. É procedência do
  nascimento, não do conteúdo.

## Como ficou

Construída em 13/10/2026, com `pnpm test` verde. **Não verificada contra
modelo**: nenhum pedido rodou ainda, nem em dev — o ponto de retorno da ordem 3
(a chamada sobre a sessão inteira passando de 200 s numa sessão de 15 min) está
em aberto, e é o primeiro item da fatia no `PROXIMOS-TESTES.md`. Não foi para o
ar: o commit não foi empurrado.

O que saiu diferente do que está escrito acima, e por quê:

- **`AtomoProposto.pedido` é `{ id, texto }`, e não só o id.** A revisão
  reaberta precisa mostrar "a pedido: «…»", e a spec não muda o contrato do
  `GET /extracao`. Com o texto no átomo, a linha se desenha sem um campo novo na
  resposta; o custo é o texto repetido em cada átomo do mesmo pedido, que tem no
  máximo 500 caracteres.
- **O lease do pedido é próprio, `LEASE_PEDIDO_MS` = 300 s, e não o `LEASE_MS`
  da janela.** A spec pede "a mecânica de `reivindicar` da janela", e é a mesma
  mecânica — mas com 120 s um segundo toque no mesmo pedido, enquanto a primeira
  chamada ainda trabalha sobre a sessão inteira, pagaria uma segunda. 300 s é o
  `maxDuration` da rota: passado ele, quem reivindicou está morto.
- **`gestosDoExtrator`, que a spec não previa.** O §6 manda apurar contra a
  proposta sem os pedidos, e para átomo isso basta. Mas recusa e renome de
  entidade chegam pelos gestos sem passar pela proposta: recusar uma candidata
  que só um pedido trouxe viraria `entidade_recusada` do extrator. O confirmar
  filtra os gestos para as candidatas e os índices de `extracao.json`, e os
  `faltantes` passam inteiros.
- **Um passo medido novo, `pedido`** (`PASSOS_MEDIDOS`), aberto por
  `comMedicao` na rota, sem `fecha`: o pedido soma ao detalhe da sessão e não
  reescreve a linha do índice.
- **O mesmo pedido em curso responde 409** ("este pedido já está sendo
  procurado"). A spec dizia que ele não se refaz, e não o que responder.
- **O `forcar` no meio de um pedido o derruba** em vez de gravar: `aplicarPedido`
  só grava pedido ainda `em_curso`, e o zerado não está. Foi para o §14.
- Os mocks de `tests/confirmar.test.ts` e `tests/confirmar-correcoes.test.ts`
  devolviam a proposta para **qualquer** chave do R2; com o confirmar lendo também
  `pedidos.json`, passaram a devolvê-la só para `extracao.json`.
- O `gatilho` do `extracao` no painel de agentes (`agentes.ts`) passou a dizer
  que ele também roda no "+" da revisão fechada.
