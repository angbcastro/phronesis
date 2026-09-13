# Slice 6 — Chat: interface conversacional sobre o grafo

**Objetivo:** poder fazer uma pergunta em texto livre sobre o que já registrei —
por pessoa, por período, por como uma opinião mudou — e receber uma resposta que
consultou o grafo de verdade, numa tela de chat com memória de conversa e
histórico persistente entre visitas. É a fatia 6 que `ARCHITECTURE.md` lista como
pendente desde a slice 2, e que a entrevista de 13/09 (registrada em
`Specs/slice-5.md` e `PROXIMA-SESSAO.md`) já tinha decidido ser chat de verdade,
não a tela minimalista que `Specs/visao.md` §6 ainda descreve.

**Pronto quando:** abro o Phronesis e toco a bolha de chat minimizada na tela
inicial; ela expande com animação para o centro enquanto o círculo de gravação
minimiza para o topo — os dois ficam periféricos e semitransparentes quando não
estão em foco. Escrevo uma pergunta real, do tipo "como eu estava me sentindo
depois que terminei com a Isinha?"; o agente encadeia as buscas necessárias (até
um teto de 8), mostrando o progresso a cada passo; a resposta final cita os
átomos usados atrás de um botão (i), que mostra o rastro completo — cada busca
feita e o que ela trouxe. Fecho o app, abro de novo, toco a bolha de novo: a
conversa continua exatamente de onde parei, dentro de uma lista de conversas que
mora no próprio painel do chat.

## Por que agora

Este é o pedido que a entrevista de 13/09 desviou para construir a slice 5
primeiro — "Confrontar" entregou o material (as quatro relações entre átomos ao
longo do tempo) que esta fatia consome. Aquela entrevista já tinha resolvido a
tensão de produto mais importante — é chat de verdade — mas parou antes de
decidir qualquer coisa técnica. Esta sessão é a segunda parte da mesma
entrevista: como a pergunta em texto vira busca no grafo, onde a conversa
persiste, e como a tela convive com a tela de gravar.

**A slice 5 ainda não foi aprovada nem medida** — a migration 011 não rodou e
nenhuma relação `ATUALIZA`/`CONTRADIZ`/`CONFIRMA`/`COMPLEMENTA` existe no grafo
ainda. Decisão desta entrevista: seguir mesmo assim (ver a decisão "Sequência com
a slice 5").

## As decisões

Perguntadas na entrevista de alinhamento, antes de qualquer linha de código.

| Decisão | Escolhido | O que foi recusado, e por quê |
|---|---|---|
| **Sequência com a slice 5** | Assumir que o schema da migration 011 é definitivo; aprovar e medir a slice 5 roda em paralelo, sem bloquear esta spec | Pausar até a slice 5 fechar foi recusado — repetiria o motivo que já pausou o chat uma vez, sem necessidade: o schema já está fixo, só falta dado real, e isso não impede especificar. Desenhar a fatia pra degradar bem sem nenhuma relação de confronto também foi recusado — "como minha opinião mudou" é capacidade central, não condicional |
| **Modelo de conversa** | Múltiplas conversas, tipo ChatGPT/Claude, com lista dentro do próprio painel | Uma conversa única e contínua foi recusada — a referência explícita do pedido era "como ChatGPT/Claude". Uma rota própria de listagem (tipo `/conversas`) também foi recusada — a integração escolhida bota tudo dentro do painel que nasce da bolha |
| **Arquitetura de retrieval** | Agente com ferramentas (tool-calling) — o modelo decide quais buscas fazer e pode encadear várias antes de responder | Um pipeline fixo (busca vetorial pura, ou um passo de extração estruturada seguido de uma busca determinística) foi proposto primeiro e recusado depois de exemplo real: perguntas como "como eu estava depois que terminei com a Isinha" e "depois da viagem pra Serra da Canastra" exigem achar a data de um evento numa busca pra só depois filtrar por ela na seguinte — nenhum pipeline de passo fixo cobre isso sem virar, na prática, um agente disfarçado |
| **Ferramentas do agente** | Duas, compostas: `buscar_atomos({texto?, entidade?, tipo?: lista, desde?, ate?})` e `historico_do_atomo({atomo_id})` | Quatro ferramentas separadas de dimensão única (semântica, entidade, período, confronto) foram desenhadas primeiro e recusadas — uma pergunta composta ("o que fiz/aprendi/conquistei", três tipos ao mesmo tempo) exigiria encadear e cruzar manualmente o que um parâmetro de lista resolve numa chamada só. Uma terceira ferramenta pra comparar duas entidades diretamente também foi recusada — nenhum exemplo real pediu isso |
| **Fatia C** | Independente — o chat não espera o campo de tópico que a fatia C promete | Fazer a fatia 6 esperar a fatia C foi recusado — nenhuma das duas tem precedência declarada, e perguntas sobre aprendizado já funcionam sobre o que existe hoje em `APRENDIZADO` |
| **Persistência da conversa** | Nó `:Conversa` novo (migration 012), sem elo com o grafo de conhecimento, mais as mensagens inteiras no R2 | Guardar tudo só no R2, com um manifesto/índice em JSON e nenhum nó novo no Neo4j, foi considerado e recusado — listar conversas viraria ler-e-regravar um arquivo em vez de uma query, e o padrão de `:Sessao` (nó leve + conteúdo pesado no R2) já resolve exatamente este problema |
| **Teto de chamadas encadeadas** | 8 | 4 foi recusado — corta pergunta composta real (o caso Isinha já são 2 chamadas só pra achar a data, sobrando pouco orçamento pro resto) antes da resposta. 16 foi recusado — o pior caso de latência cresce sem necessidade real vista nos exemplos |
| **Escrita no grafo** | Nunca — só leitura, nem por ferramenta | Uma ferramenta de escrita com confirmação (ex.: arquivar átomo direto do chat) foi considerada e recusada — é a leitura mais direta da regra 5 do `CLAUDE.md`, e espalhar o lugar onde escrita acontece pra mais uma tela não tinha pedido real por trás |
| **Procedência no botão (i)** | O rastro completo — cada chamada de ferramenta, os parâmetros usados, e o que ela retornou | Uma lista plana só dos átomos usados (o padrão que a revisão já usa) foi recusada — com até 8 chamadas possíveis, saber *por que* um átomo específico apareceu importa mais aqui do que numa extração de uma janela só |
| **Progresso durante a espera** | Status visível a cada passo do agente | Um carregando genérico até a resposta final foi recusado — a espera de uma pergunta composta é real (múltiplas chamadas encadeadas) e fica opaca demais sem nenhum sinal do que está acontecendo |
| **Onde a tela mora** | Bolha minimizada na tela inicial (periférica, semitransparente), expande com animação pro centro; o círculo de gravação minimiza e vai pro topo, mesmo tratamento visual. Some inteira durante gravação ativa | Uma rota própria e de destaque (`/chat`, ao lado de Gravar/Revisar na navegação) foi a primeira ideia levada à entrevista, substituída assim que ficou claro que a integração era com a própria tela de gravar. Manter a bolha visível durante a gravação também foi recusado — nem a `Gestao` (a única porta de saída que já existe hoje) tem esse privilégio, e a tela de gravar é onde este projeto historicamente corta, não adiciona (ver o comentário sobre o chip de recuperação removido em `Gravacao.tsx`) |
| **Toque no círculo minimizado (chat aberto)** | Primeiro restaura o círculo ao centro e fecha o chat; um segundo toque começa a gravar | Um toque só, que já começa a gravar e fecha o chat junto, foi considerado — é o gesto mais parecido com o "um botão, um toque" que já rege a tela — e recusado: o risco de começar uma gravação sem querer, só tentando fechar o chat, pesou mais que a economia de um toque |
| **Título da conversa** | Gerado por modelo, numa chamada barata sobre a primeira troca — agente novo em `/agentes` | Título por truncamento da primeira mensagem foi recusado — sai sem sentido quando a pergunta é longa ou vaga, e o próprio produto citado como referência (ChatGPT/Claude) gera título por modelo |
| **Apagar conversa** | Duas ações distintas: **apagar** (some de vez — nó e R2) e **arquivar** (congela — sem mensagem nova, some da lista principal, mas continua legível numa lista de arquivadas) | Só soft-delete (mesmo padrão de `:Sessao`, nunca apagar de verdade) foi a primeira proposta e foi recusada — o pedido explícito foi ter as duas opções, não só uma |
| **Arquivar e busca entre conversas** | Uma conversa nunca busca dentro de outra — arquivar só congela aquela conversa específica | Conversas virarem fonte de busca adicional pro agente (uma terceira ferramenta, com embedding nas mensagens) foi considerado e recusado — nasceu de uma ambiguidade de linguagem ("sem ser consultada para respostas"), não de um pedido real; cada conversa só enxerga o grafo |

## 1. Schema — migration 012

`db/migrations/012_chat.cypher`, **proposta — aprovar antes de rodar**, mesma
regra da 005/007/010/011 (Aura Free não sustenta constraint de existência).

Um nó novo, sem elo com o grafo de conhecimento (não é `:Entidade` nem
`:Atomo` — é metadado de aplicação):

```
(:Conversa {
  id,
  titulo,
  criado_em,
  atualizada_em,
  arquivada_em,        // null = ativa; preenchido = congelada
  mensagens_key         // chave do objeto de mensagens no R2
})
```

Apagar (`apagar de verdade`) remove o nó inteiro e o objeto no R2. Arquivar só
escreve `arquivada_em`.

## 2. O agente `chat` e as duas ferramentas

`src/lib/chat.ts`, agente novo — próximo no registro de `src/lib/agentes.ts` e em
`AGENTE_IDS` (`src/lib/tipos.ts`).

- **quando:** sob demanda, a cada mensagem enviada — não é periódico como o
  confronto;
- **modelo:** `CHAT_MODEL`, padrão igual ao da extração, mesmo padrão dos outros
  agentes;
- **teto:** 8 chamadas de ferramenta encadeadas antes da síntese final.

**Ferramenta 1 — `buscar_atomos`:**

```
buscar_atomos({
  texto?: string,       // dispara busca vetorial sobre atomo_embedding (migration 006)
  entidade?: string,    // resolve por nome/alias, reaproveitando a resolução já existente (entidades.ts)
  tipo?: TipoAtomo[],   // lista, não valor único — combina com OR
  desde?: string,       // ISO date
  ate?: string,         // ISO date
})
```

Todos os parâmetros são opcionais e combináveis. Sem `texto`, é um `MATCH`
filtrado por tipo/entidade/período, ordenado por `valido_em` desc, com teto de
retorno. Com `texto`, o vector search entra e os demais filtros se somam como
condição.

**Ferramenta 2 — `historico_do_atomo`:**

```
historico_do_atomo({ atomo_id: string })
```

Anda `[:ATUALIZA|CONTRADIZ|CONFIRMA|COMPLEMENTA*1..N]` nas duas direções a
partir do átomo dado, devolvendo a cadeia inteira ordenada por `valido_em` — não
só o vizinho direto, porque uma opinião pode ter mudado em mais de um degrau
(reaproveita a modelagem de relação que `src/lib/confronto.ts` já escreve).

As duas ferramentas são só-leitura. A resposta final é uma síntese depois que o
agente decide parar de buscar, no tom que `Specs/visao.md` §7 já define
("bibliotecário atento, não um coach"), citando os átomos usados.

## 3. Persistência: `:Conversa` e as mensagens no R2

Mesma separação que áudio/transcrição já seguem — metadado leve no Neo4j,
conteúdo pesado no R2:

```
conversas/<conversa_id>/mensagens.json
```

Cada mensagem carrega papel (eu/agente), texto, `criado_em`, e — só nas do
agente — o rastro completo de ferramentas usadas (nome, parâmetros, o que
retornou), que alimenta o botão (i).

Listar conversas é uma query Cypher sobre `:Conversa` por `atualizada_em desc`,
filtrando `arquivada_em IS NULL` na lista principal; arquivadas aparecem num
separador dentro do mesmo painel.

Título: uma chamada de modelo sobre a primeira troca, gravada em `titulo` assim
que sai — agente novo `titulo-chat`, modelo `CHAT_TITULO_MODEL`, padrão igual ao
`CHAT_MODEL`.

## 4. A tela: a bolha, o painel, a lista

`src/components/Gravacao.tsx` ganha um elemento novo, só no estado `parado` —
mesma condição que já decide se a `Gestao` aparece hoje:

- **parado:** círculo (idle) + `Gestao` + bolha de chat, minimizada, periférica,
  semitransparente;
- **bolha tocada:** expande com animação pro centro; o círculo de gravação
  minimiza e vai pro topo, mesmo tratamento visual (pequeno, transparente,
  periférico);
- **círculo minimizado tocado, chat aberto:** primeiro restaura o círculo ao
  centro e fecha o chat — não grava ainda; um segundo toque no círculo (agora
  central) começa a gravar, do jeito de sempre;
- **gravando:** a bolha some inteira, mesma regra que já esconde a `Gestao`
  hoje — só círculo, timer, ponto de salvo, parar.

Dentro do painel expandido (`src/components/Chat.tsx`, novo):

- lista de conversas (ativas por padrão, arquivadas num separador/toggle), cada
  uma com o título gerado por modelo;
- botão de nova conversa;
- a conversa aberta: mensagens, campo de texto, um jeito de parar a geração em
  andamento (mesmo espírito do "um jeito de parar" que já rege a tela de
  gravar);
- enquanto o agente encadeia chamadas: status visível a cada passo (ex.:
  "buscando por período...");
- por resposta do agente: botão (i) que abre o rastro completo;
- por conversa: ação de arquivar e ação de apagar.

`Gestao.tsx` **não** ganha link novo — ao contrário da slice 5, o chat não é uma
rota separada.

## 5. Verificação

`pnpm test` e `pnpm typecheck` verdes — cobrindo o loop do agente e as duas
ferramentas (Neo4j mockado), o CRUD de `:Conversa`, e o componente.

Depois, o que só olho vê: abrir o chat de verdade, fazer as perguntas reais que
apareceram nesta entrevista (o caso Isinha, a viagem pra Serra da Canastra, "mudei
de opinião sobre a forma de aprender com IA", "meus objetivos do mês"), e julgar
se a resposta usa o grafo direito e se o rastro do (i) faz sentido. Sem gabarito,
sem fixture, mesma régua do resto da extração (`CLAUDE.md`).

## Fora de escopo

- **Me testar/quizzar sobre o que aprendi** (fatia C) — fora de escopo desta
  fatia;
- **Comparar duas entidades diretamente** com uma ferramenta própria — nenhum
  exemplo real pediu isso; se aparecer, o agente tenta na mão com duas chamadas
  de `buscar_atomos`;
- **Conversas como fonte de busca umas das outras** — nunca; cada conversa só
  enxerga o grafo;
- **Uma rota própria de chat** (`/chat`, `/conversas`) — tudo mora na bolha e no
  painel da tela inicial;
- **Resumir ou podar conversa longa** para caber no contexto do modelo — se
  virar problema real, é fatia própria;
- **Segunda passada de baixa confiança** nas relações de confronto que
  `historico_do_atomo` percorre — não é desta fatia, é da 5;
- **Editar mensagem enviada, ou regenerar resposta** — não pedido, não
  construído.

## O que muda de arquivo

```
db/migrations/012_*.cypher          novo — :Conversa
src/lib/tipos.ts                    AGENTE_IDS += chat, titulo-chat; tipos de Conversa, Mensagem, ferramentas
src/lib/chat.ts                     novo — o agente, as duas ferramentas, o loop com teto de 8
src/lib/conversas.ts                novo — CRUD de :Conversa, leitura/escrita de mensagens no R2, arquivar, apagar
src/lib/modelos.ts                  modeloChat/CHAT_MODEL; modeloTituloChat/CHAT_TITULO_MODEL
src/lib/agentes.ts                  registra chat e titulo-chat
src/components/Gravacao.tsx         a bolha entra no estado parado; some junto com a Gestao ao gravar
src/components/Chat.tsx             novo — o painel: lista, mensagens, input, status por passo, (i)
src/app/api/chat/...                novo — enviar mensagem, listar conversas, arquivar, apagar
package.json                        dependência de streaming do lado do cliente (a decidir na implementação)
tests/chat.test.ts                  novo
ARCHITECTURE.md, CLAUDE.md, Specs/visao.md   só quando esta fatia for construída — fora desta spec
```

## Ordem de execução

| # | Passo |
|---|---|
| 1 | esta spec |
| 2 | a migration 012, proposta — aprovada por mim antes de rodar |
| 3 | o agente puro: as duas ferramentas, o loop de chamadas, sem tela e sem gravar conversa |
| 4 | persistência: `:Conversa`, mensagens no R2, título por modelo |
| 5 | a tela: bolha, painel, lista, status por passo, (i) com rastro |
| 6 | `ARCHITECTURE.md`, `CLAUDE.md` e `Specs/visao.md` (§6 e §10 reescritos) |

## Limites que esta fatia cria (para o §14)

- **A fatia assume que a slice 5 vai funcionar bem.** Se `PISO_CONFRONTO` ficar
  errado ou a migration 011 não for aprovada a tempo, `historico_do_atomo`
  sistematicamente volta vazio, e perguntas de "como mudei de opinião" ficam sem
  resposta real — sem ser um bug desta fatia;
- **O custo cresce com o teto de 8 chamadas por pergunta** — uma pergunta
  composta paga até 8 idas ao Gateway antes da síntese final, mais a síntese em
  si;
- **`CHAT_MODEL` precisa suportar tool-calling multi-passo bem pelo Gateway** —
  não medido ainda; se o modelo padrão (o mesmo da extração) não for bom nisso,
  pode exigir modelo próprio;
- **Título por modelo é mais uma chamada por conversa nova** — barata, mas
  soma;
- **Sem resumir ou podar histórico**: uma conversa muito longa entra inteira no
  prompt a cada mensagem nova; se isso virar problema de custo ou de teto de
  contexto, é ajuste futuro, não coberto aqui.
