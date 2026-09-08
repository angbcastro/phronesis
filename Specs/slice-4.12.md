# Slice 4.12 — O enriquecimento em lote: a ficha se escreve sozinha

**Objetivo:** que eu marque entidades em `/entidades`, aperte um botão, feche a
aba, e volte para encontrar as fichas escritas — `resumo` e os três campos de
perfil construídos a partir de **todos** os átomos que falam daquela entidade,
sem teto e sem eu aprovar campo por campo.

**Pronto quando:** eu seleciono todas as entidades do grafo, aperto enriquecer,
fecho o navegador, e ao voltar em `/entidades` cada linha mostra `pronta` com um
`resumo` que identifica a entidade — e a que falhou mostra o motivo na própria
linha. E quando a sessão seguinte roda com a segunda passada da 4.11 **calada** na
maioria das menções, porque agora o resumo basta.

## Por que agora

**Porque a 4.11 criou o campo e deixou ele vazio, de propósito.** O `resumo` é o
que os dois agentes leem por padrão desde a fatia anterior, e enquanto ele estiver
em branco toda menção cai na segunda passada. O sistema funciona — a segunda
passada carrega o perfil inteiro, que é exatamente o que o agente 2 lia antes da
4.11 — mas paga uma chamada de modelo a mais por janela para chegar onde já
chegava. Esta fatia é o que faz a 4.11 valer o que ela prometeu.

**E porque o agente 3 nunca foi suficiente para preencher isso.** `perfil-1`
(`src/lib/perfil.ts`) é sob demanda, um campo por vez, e lê **no máximo 20 átomos,
só os marcados por `:PERFILA`** (`TETO_ATOMOS`, `perfil.ts:38`). A marca vem do
agente 2, que só a põe quando o átomo "de fato acrescenta algo duradouro" — e
lista vazia é resposta legítima e comum, diz o próprio prompt. O resultado é que a
maior parte do que o diário sabe de uma pessoa **nunca chega ao perfil dela**: os
átomos que a mencionam de passagem, as histórias em que ela aparece, o trabalho
que apareceu num `FATO` sem virar marca de perfil.

O passo zero das entidades, aberto desde 02/09 e ainda aberto, é o mesmo problema
por outro lado: cinco entidades no grafo sem nenhum dos três campos escritos, e a
camada 3a da resolução nascendo inerte por falta de texto para comparar. Nenhuma
fatia até aqui deu um caminho para sair disso que não fosse eu sentar e escrever à
mão, campo por campo, entidade por entidade.

**O que não está quebrado, e esta fatia não toca:** a extração, a resolução, o
desempate da 4.11, o `:PERFILA` e quem o marca, a fusão, o dossiê do GraphRAG, e a
edição à mão de qualquer campo em `/entidades`.

## As decisões

Perguntadas em 08/09, nas mesmas sete rodadas da 4.11. Duas delas reabrem
decisões de arquitetura escritas, e as duas estão marcadas.

| Decisão | Escolhido | O que foi recusado, e por quê |
|---|---|---|
| **O lote escreve sozinho?** | **sim — e isso reabre o §4.9** | "Propõe, e eu aceito em lote numa tela" mantinha a regra que o `ARCHITECTURE.md` §4.9 declara: nada entra sem o meu toque, porque perfil errado contamina toda atribuição futura e o erro se realimenta. Recusado porque a tela de aprovação em lote é o próprio atrito que faz o passo zero estar aberto desde 02/09 — e porque **a seleção mais o botão já são o meu toque** |
| **A regra 5 do `CLAUDE.md`** | **fica intocada** | Ela fala de átomo e da tela de revisão, e continua valendo inteira: nenhum átomo entra no grafo sem eu confirmar. O que muda é o perfil, e o que muda é o **§4.9**, reescrito dizendo que o perfil trocou de regime e por quê. Emendar a regra 5 foi recusado por alargar a regra mais forte do projeto para acomodar um caso que ela não cobria |
| **O que acontece com o que eu escrevi à mão** | **sobrescreve, com desfazer de um toque** | "Preserva o escrito à mão" era a regra que o agente 3 já segue ("PRESERVE o que já estava escrito"). Recusado porque uma frase minha desatualizada ficaria na ficha para sempre. "Sobrescreve sem volta" foi recusado por um motivo estreito e real: existe coisa que só eu sei, que nenhum átomo registra, e que o lote nunca vai reescrever — o desfazer é o que substitui a tela de aprovação |
| **Quantas gerações o desfazer guarda** | **uma — a imediatamente anterior** | Histórico com data e origem seria informação de verdade num diário de anos. Recusado por custar nós ou propriedades novas e uma tela para ler isso, e por cobrir um caso que ainda não aconteceu. Uma geração cobre o caso real: rodei, olhei, não gostei, voltei |
| **Quais átomos entram** | **todos, sempre, sem teto** | "Incremental — o resumo atual + os átomos novos" tinha custo constante por rodada, independente do tamanho do grafo, e é o desenho que o agente 3 já usa. Recusado porque um erro escrito numa rodada se perpetuaria nas seguintes: a ficha carregaria para sempre o que uma rodada ruim escreveu. Relendo tudo, **reordenar prioridade é só rodar de novo** |
| **`SOBRE` + `MENCIONA`, e não `:PERFILA`** | **sim** | `:PERFILA` é o filtro que o agente 2 aplica em tempo de extração, com o critério dele. O lote não precisa desse filtro: ele lê tudo e decide o que importa com todos os átomos na frente, que é uma decisão melhor informada que a de quem viu um átomo por vez |
| **O que o `resumo` é** | **retrato de identidade** | Decidido na 4.11 e repetido aqui porque é **aqui** que vira instrução de prompt: quem é e o que a distingue de outra parecida. "Retrato completo" foi recusado porque, se o que distingue não couber nos 500, a segunda passada volta a ser a regra |
| **O disparo** | **checkbox por linha + selecionar todas** | "Automático depois do confirmar, nas entidades tocadas" manteria a ficha sempre em dia sem eu lembrar de nada. Recusado: o custo de modelo cresceria por sessão, e o resumo mudaria sem eu ter pedido. Com checkbox eu escolho quando pagar e sobre quem — mesmo padrão do "procurar duplicatas" |
| **Onde roda** | **assíncrono, sem janela aberta** | Não havia opção preferida: o pedido foi "assíncrono, sem eu manter nada rodando nem nenhuma janela aberta", e a arquitetura ficou comigo. O navegador disparando uma por uma foi recusado por isso — fechar a aba interromperia |
| **Como eu sei que terminou** | **estado por linha em `/entidades`** | Notificação do PWA seria o único aviso que me alcança fora do app, e seria o primeiro uso de push neste sistema. Recusado por agora: a informação mora onde a ação foi disparada, e nenhum canal novo nasce nesta fatia |
| **Entidade grande demais para caber** | **sem tratamento** | Dividir em partes e fundir as parciais escalaria até onde eu falar. Recusado como trabalho adiantado: não é um problema que este grafo tem. Se acontecer, a entidade falha, o motivo aparece na linha dela, e a fatia que consertar isso decide como |

## 1. Schema — migration 010

`db/migrations/010_enriquecimento.cypher`, **proposta; aprovar antes de rodar**.

Campos novos em `:Entidade`, todos ausentes contando como vazio na leitura:

```
resumo_anterior          o que o lote sobrescreveu — uma geração
contexto_anterior        idem
pode_ajudar_com_anterior idem
fizemos_juntos_anterior  idem

enriquecimento_estado    'na_fila' | 'rodando' | 'pronta' | 'falhou'
enriquecimento_motivo    o erro, quando falhou
enriquecimento_em        ISO 8601 — quando o estado mudou
enriquecimento_atomos    quantos átomos entraram na última rodada
```

Sem statement de declaração, como a 005 e a 007: propriedade de valor livre não se
declara no Aura Free. **Sem migração de dado** — nenhuma ficha existente é tocada,
e entidade sem `enriquecimento_estado` simplesmente nunca foi enriquecida.

Sem índice: a fila é varrida sobre o catálogo que `listarEntidades()` já carrega
inteiro, e o Aura Free tem cota de índice.

**Os quatro campos `_anterior` são o desfazer**, e são a razão de esta fatia ter
migration própria em vez de caber na 009: eles existem porque o lote escreve
sozinho, e o desfazer é o que substitui a tela de aprovação que foi recusada.

## 2. O agente 4 — `enriquecimento-1`

`src/lib/enriquecimento.ts`, agente novo, entra em `AGENTE_IDS` e no registro de
`agentes.ts` — sem isso `tests/agentes.test.ts` falha, e é para falhar.

- **quando:** `sob_demanda`;
- **modelo:** `ENRIQUECIMENTO_MODEL`, padrão igual ao da extração;
- **entrada:** o nome, o tipo, os aliases, e **todos** os átomos ativos ligados por
  `:SOBRE` ou `:MENCIONA`, do mais novo para o mais velho, com tipo e `valido_em`.
  Nem `:PERFILA`, nem teto de 20;
- **saída:** os quatro campos de uma vez —

```json
{"resumo":"…","contexto":"…","pode_ajudar_com":"…","fizemos_juntos":"…"}
```

Uma chamada por entidade, e não uma por campo: os quatro saem da mesma leitura, e
quatro chamadas leriam os mesmos átomos quatro vezes.

**O prompt**, nos termos que a entrevista fixou:

- `resumo` é **retrato de identidade** — quem é para o dono do diário e, antes de
  tudo, **o que a distingue de outra entidade parecida**. A primeira frase é
  sempre o que distingue; o que sobrar dos 500 leva o resto;
- os três campos mantêm o que `COMO_USAR` (`perfil.ts:135`) já diz de cada um —
  aquele texto foi escrito com cuidado e não muda;
- só afirmar o que os átomos sustentam. Não deduzir, não completar com o que
  "costuma ser". É a regra que mais importa aqui, porque **ninguém revisa antes de
  gravar**;
- terceira pessoa, direto, sem floreio;
- `resumo` no máximo 500 (`TETO_RESUMO`); os três campos **sem teto**, desde a
  4.11.

**Entidade sem átomo nenhum** não vai ao modelo: escreve `pronta` com os campos
inalterados e `enriquecimento_atomos: 0`. Pagar uma chamada para não ter o que
dizer é desperdício, e sobrescrever a ficha com o vazio seria perda.

## 3. A fila, e como ela anda sem janela aberta

O mecanismo já existe neste sistema e não é novo: **estado idempotente mais
`waitUntil`**, que é como a transcrição por blocos anda desde a slice 2 e como a
janela da 4.8 fecha durante a gravação.

- `POST /api/entidades/enriquecer` recebe as chaves marcadas, grava
  `enriquecimento_estado = 'na_fila'` em todas, **responde na hora**, e dispara o
  primeiro elo em `waitUntil`;
- cada elo: reivindica **uma** entidade `na_fila` (`na_fila` → `rodando` numa
  escrita condicional — é a trava de concorrência, mesma ideia de
  `reivindicarJanela`), roda o agente, grava os campos e os `_anterior`, marca
  `pronta` ou `falhou` com o motivo, e **se auto-encadeia** para a próxima;
- fila vazia, o encadeamento para.

Cada elo cabe folgado nos `maxDuration = 60` — uma chamada de modelo, duas
consultas. Fechar a aba não interrompe nada: o estado está no grafo, não no
navegador.

**Retomada:** entidade em `rodando` há mais que um limite (a função morreu no
meio) volta para `na_fila` na próxima varredura. É a mesma defesa que o manifest
de chunks já tem contra o bloco que ficou preso.

**Idempotência (regra 4):** a chave é a entidade. Reivindicar uma que já está
`rodando` não faz nada; rodar duas vezes a mesma entidade produz a mesma ficha a
partir dos mesmos átomos, e o `_anterior` da segunda rodada é o resultado da
primeira — que é o comportamento certo, e o custo declarado de "uma geração só".

**Rate limit:** `comEsperaDeLimite`, sem `ate` — não há ninguém esperando do outro
lado da tela, então a fila pode dormir o quanto o Gateway pedir.

## 4. `/entidades`

`src/components/Entidades.tsx`:

- **checkbox à esquerda de cada linha**, com "selecionar todas" no topo;
- **botão de enriquecer**, que mostra quantas foram marcadas antes de disparar;
- **estado por linha:** `na fila`, `enriquecendo`, `pronta` com a data e o número
  de átomos, ou `falhou` com o motivo. Nenhum aviso fora da tela;
- **desfazer** na linha de cada entidade cujo `_anterior` não está vazio — um
  toque, e os quatro campos voltam de uma vez.

O desfazer é de dois toques como o de apagar sessão? **Não**: ele restaura, não
destrói, e o pior caso de um toque acidental é outro toque.

## 5. Verificação

`pnpm test` verde em cada passo, e depois o que só olho vê.

Primeiro, **o lote sobre o grafo inteiro**: selecionar todas, disparar, fechar a
aba, voltar.

| O que aparece | O que quer dizer |
|---|---|
| todas em `pronta`, com contagem de átomos | a fila andou inteira sem janela aberta — é o critério da fatia |
| alguma parada em `rodando` | o encadeamento morreu e a retomada não pegou; o motivo está no log |
| `falhou` com o motivo na linha | é o caminho previsto, e a entidade seguinte não foi afetada |

Depois, **a medida que importa**: gravar uma sessão real e olhar o log da
resolução. `[desempate]` deve ficar **calado** na maioria das menções — é o número
que diz se o resumo está identificando. Se ele continuar disparando em tudo, o
resumo não está fazendo o trabalho, e o conserto é o prompt do agente 4.

**Três coisas que só olho vê:**

- **o resumo distingue, ou só descreve?** Ler o resumo de duas pessoas parecidas
  lado a lado: se os dois textos servissem para qualquer uma das duas, o prompt
  falhou no que ele tem de fazer;
- **o lote inventou alguma coisa?** É o risco que o §4.9 declarava e que esta
  fatia aceita: ninguém revisa antes de gravar. Uma afirmação na ficha que nenhum
  átomo sustenta é o defeito mais caro que este sistema pode ter, porque ela passa
  a decidir atribuição;
- **o que eu tinha escrito à mão fazia falta?** Se sim, o desfazer está a um
  toque — e é a resposta de que o "sobrescreve" precisa de um contrapeso maior que
  uma geração.

## Fora de escopo

- **O agente 3 (`perfil-1`)** continua existindo, sob demanda, por campo, sobre
  `:PERFILA`. O que acontece com ele — conviver, encolher ou sair — se decide
  **depois** desta fatia rodar e eu ver se ainda uso o botão;
- **Enriquecimento automático** depois do confirmar;
- **Histórico de versões** do perfil além de uma geração;
- **Dividir a entidade grande em partes** — declarado como limite, não resolvido;
- **Notificação fora do app**;
- **Tocar no `:PERFILA`**, em quem o marca, ou em como ele é gravado.

## O que muda de arquivo

```
db/migrations/010_*.cypher     novo — _anterior, estado da fila
src/lib/tipos.ts               AGENTE_IDS += enriquecimento; os tipos do estado
src/lib/enriquecimento.ts      novo — o agente 4 e a fila
src/lib/entidades.ts           listarEntidades traz estado e _anterior; reivindicar
src/lib/perfil.ts              gravarCampo grava o _anterior junto
src/lib/modelos.ts             modeloEnriquecimento / ENRIQUECIMENTO_MODEL
src/lib/agentes.ts             registra o enriquecimento
.../api/entidades/enriquecer   novo — POST (disparar) e o elo da fila
.../api/entidades/desfazer     novo — restaura os quatro campos
src/components/Entidades.tsx   checkboxes, botão, estado por linha, desfazer
tests/*                        a fila, a reivindicação, o parser, agentes.test.ts
ARCHITECTURE.md                §4.9 (reescrito), §8.3, §10, §11, §14
CLAUDE.md                      ENRIQUECIMENTO_MODEL
PROXIMA-SESSAO.md              seção 6
```

Uma migration, duas rotas novas, nenhuma tela nova.

## Ordem de execução

Seis passos, cada um verde no `pnpm test` antes do seguinte, e cada um um commit.

| # | Passo |
|---|---|
| 1 | esta spec |
| 2 | a migration 010, proposta — **aprovada por mim antes de rodar** |
| 3 | o agente 4 puro: a consulta dos átomos, o prompt, o parser — sem fila e sem gravar |
| 4 | a gravação com `_anterior`, e o desfazer (rota + botão) |
| 5 | a fila: reivindicação, encadeamento, retomada, e os controles em `/entidades` |
| 6 | `ARCHITECTURE.md` §4.9 reescrito, `CLAUDE.md` e `PROXIMA-SESSAO.md` |

**O passo 4 antes do 5 é de propósito:** o desfazer tem que existir antes de a
primeira ficha ser sobrescrita. Rodar o lote sem ele é a única forma de perder
texto meu neste desenho.

**Depois do 4 dá para enriquecer uma entidade por vez, à mão**, e já vale alguma
coisa: é o ponto de retorno barato. O passo 5 é o que dispensa a janela aberta.

## Limites que esta fatia cria (para o §14)

- **O perfil passa a ser escrito sem revisão prévia.** É a reabertura consciente
  do que o §4.9 declarava: perfil errado contamina toda atribuição futura e o erro
  se realimenta. A defesa deixou de ser "nada entra sem o meu toque campo a campo"
  e passou a ser: eu escolho quem entra na fila, eu leio a ficha depois, e o
  desfazer está a um toque. **A regra 5 do `CLAUDE.md` continua valendo inteira** —
  ela fala de átomo, e nenhum átomo entra no grafo por este caminho.
- **Uma geração de desfazer.** Rodar o lote duas vezes seguidas na mesma entidade
  perde o texto original — o `_anterior` da segunda rodada é o resultado da
  primeira. É o preço declarado de não guardar histórico.
- **Entidade muito falada pode não caber na janela do modelo**, e nesse dia ela
  falha e não escreve nada. Sem tratamento, por escolha: não é um problema que
  este grafo tem hoje. O sinal é `falhou` na linha dela.
- **O custo do lote cresce com o quadrado do uso:** mais átomos por entidade, e
  mais entidades. Selecionar todas num grafo grande é uma conta que ninguém mede
  antes de disparar — a tela diz quantas foram marcadas, não quanto vai custar.
- **A fila é varrida sobre o catálogo inteiro em memória**, mesmo limite que a
  4.11 já declara para o casamento exato, e pelo mesmo motivo.
- **Um elo que morre entre gravar a ficha e marcar `pronta`** deixa a entidade em
  `rodando` até a retomada; a ficha já está escrita, e a próxima rodada a
  reescreve a partir dos mesmos átomos. Não há perda, só trabalho repetido.
