# Slice 5 — Confrontar: relações entre átomos ao longo do tempo

**Objetivo:** que o grafo passe a registrar, sozinho, quando um átomo atualiza,
contradiz, confirma ou complementa um átomo mais antigo sobre o mesmo assunto —
o pilar "Confrontar" que `Specs/visao.md` sempre descreveu, e que `ARCHITECTURE.md`
listava como não existente desde a slice 2.

**Pronto quando:** eu abro `/confronto`, aperto "rodar agora", fecho a aba, e ao
voltar a lista de recentes mostra átomos com `ATUALIZA`/`CONTRADIZ`/`CONFIRMA`/
`COMPLEMENTA` gravados contra átomos mais antigos — e quando o cron diário faz o
mesmo sozinho, sem eu tocar em nada.

## Por que agora

**Porque o pedido original desta rodada era outro: a camada de chat.** A
entrevista de alinhamento (perguntas como "como minhas opiniões mudaram nos
últimos dois anos") esbarrou de imediato numa dependência que nunca foi
resolvida: responder isso bem pede comparar átomos ao longo do tempo, e as
relações que fariam isso — `:ATUALIZA`, `:CONTRADIZ`, `:CONFIRMA` — nunca saíram
do papel. `ARCHITECTURE.md` já as citava como ausentes desde a slice 2, e
`Specs/slice-4.md` e `Specs/slice-4.5.md` já as citavam como "slice 5, e
dependente de material acumulado" — material que a slice 4 (identidade) e a 4.5
(vetor) entregaram, sem que a peça em si fosse construída.

**A decisão da entrevista foi pivotar**: construir esta fatia agora, como
pré-requisito próprio, e retomar o chat depois — numa sessão futura, com esta
fatia já construída e medida em uso real (mesma posição em que a 4.11 e a 4.12
estão hoje).

**O que não está quebrado, e esta fatia não toca:** a extração, a resolução, o
enriquecimento, a deduplicação de entidade, o dossiê de RAG que o extrator usa
(`recuperacao.ts`). Nenhum deles lê ou escreve as relações desta fatia.

**Decisões já tomadas para quando o chat (fatia 6) chegar**, registradas aqui
para não se perderem entre sessões: a tela será um chat de verdade, com memória
de conversa e histórico persistente entre visitas; a procedência não aparece por
padrão na resposta, mas sempre disponível via um botão (i) que mostra os átomos
recuperados. Nenhuma das duas é código desta fatia.

## As decisões

Perguntadas na entrevista de alinhamento, antes de qualquer linha de código.

| Decisão | Escolhido | O que foi recusado, e por quê |
|---|---|---|
| **Sequência** | pivotar agora, fatia própria antes do chat | Continuar desenhando o chat com a dependência documentada como pré-requisito foi recusado — a ordem de construção real já é relações primeiro, então desenhar a tela antes seria trabalho que talvez precisasse refazer |
| **Tipos de átomo no escopo** | **todos**, sem restrição | Restringir a `OPINIAO`/`DECISAO` (ou incluindo `APRENDIZADO`) foi considerado e recusado — uma lista fixa excluiria de antemão um caso que faria sentido; o agente decide caso a caso |
| **Um quarto tipo de relação** | **`COMPLEMENTA`** | Só os três do contrato original (`ATUALIZA`/`CONTRADIZ`/`CONFIRMA`) deixavam sem nome o caso mais comum entre dois átomos sobre o mesmo assunto: informação nova e compatível que não muda nem repete a anterior |
| **Cobertura temporal** | retroativa e incremental **pelo mesmo caminho** | Um modo "só o que é novo" separado de um "varre tudo" foi recusado — todo átomo com `confronto_estado` ausente ou `'falhou'` é candidato à mesma fila, e rodá-la repetidas vezes cobre os dois casos sem duplicar lógica |
| **Gatilho** | periódico (cron próprio) **e** sob demanda — nunca em tempo real | Rodar na confirmação de um átomo foi recusado — comparar contra o grafo inteiro é trabalho de fundo, não parte do caminho crítico da gravação (regra 5 do `CLAUDE.md` não abre exceção para conteúdo de sessão) |
| **Gravação** | o agente escreve sozinho, com desfazer | Tela de aprovação por relação proposta foi recusada — mesmo padrão do agente 4 (enriquecimento, slice 4.12): eu escolho quando rodar, leio o resultado depois em `/confronto`, e o desfazer está a um toque |
| **Granularidade do desfazer** | **por átomo**, uma geração | Desfazer por execução inteira (a rodada toda de uma vez) foi recusado — por átomo dá controle fino sem exigir uma tela de navegação de execuções passadas |
| **Direção da aresta** | sempre do mais novo para o mais antigo | Aresta bidirecional ou bicondicional foi descartada sem chegar a ser uma opção real — "o novo confronta o velho" é a única leitura que faz sentido com o eixo do tempo |

## 1. Schema — migration 011

`db/migrations/011_confronto.cypher`, **proposta; aprovar antes de rodar** — sem
statement executável, mesmo padrão da 005, 007 e 010 (Aura Free não sustenta
constraint de existência, e a cota de índice já está no limite conhecido, §14).

Quatro relações novas entre átomos:

```
(:Atomo mais_novo)-[:ATUALIZA|:CONTRADIZ|:CONFIRMA|:COMPLEMENTA {
  execucao, motivo, confianca, criado_em, modelo, prompt_version
}]->(:Atomo mais_antigo)
```

E três propriedades novas em `:Atomo`:

```
confronto_estado     'rodando' | 'processado' | 'falhou' — ausente = nunca tentado
confronto_em         ISO 8601
confronto_execucao   id da última rodada — auditoria, não trava de desfazer (§3 da migration)
confronto_motivo     o erro, quando falhou
```

**Por que o desfazer não precisa casar `execucao`:** ao contrário da ficha da
entidade (que sobrescreve um campo e por isso guarda um `_anterior`), uma
relação é uma aresta que só existe se for escrita. `gravarRelacoes` apaga todas
as relações de saída do átomo antes de escrever as novas, toda vez que roda —
então nunca há mais de uma geração viva ao mesmo tempo, e o desfazer apaga o que
existe agora porque "o que existe agora" já é a última geração. Isso também
cobre de graça uma rodada que morreu entre gravar e marcar `processado`: a
tentativa seguinte substitui, nunca duplica.

## 2. O agente `confronto`

`src/lib/confronto.ts`, agente novo — décimo no registro de `src/lib/agentes.ts`
e em `AGENTE_IDS` (`src/lib/tipos.ts`).

- **quando:** `periodico` (valor novo em `QuandoRoda` — nenhum dos três
  anteriores descrevia "cron próprio e também sob demanda");
- **modelo:** `CONFRONTO_MODEL`, padrão igual ao da extração;
- **candidatos:** `db.index.vector.queryNodes('atomo_embedding', …)` a partir do
  vetor do átomo sendo processado, restrito a `valido_em` estritamente anterior,
  acima de `PISO_CONFRONTO` (0.45, ponto de partida — o mesmo de `PISO_VIZINHOS`
  em `resolucao.ts`, mas uma constante própria, independente, porque aqui o
  texto inteiro do candidato entra no prompt e um piso frouxo custa tokens, não
  só ruído);
- **sem candidato acima do piso, não vai ao modelo** — mesmo espírito
  custo-consciente de `decidir()` em `resolucao.ts`;
- **saída, por candidato:**

```json
{"relacoes":[{"n":1,"tipo":"ATUALIZA","confianca":0.8,"motivo":"…"}]}
```

Só os candidatos com relação diferente de `NENHUMA` aparecem na lista — lista
vazia é resposta legítima e comum, e o átomo sai `processado` mesmo assim.

## 3. A fila, e como ela anda sem janela aberta

Mesmo mecanismo já usado pela fila de enriquecimento e pela transcrição por
blocos: **estado idempotente mais `waitUntil`**.

- `reivindicarProximoAtomo`: um átomo por vez, do `valido_em` mais antigo para o
  mais novo — processar nessa ordem evita avaliar um átomo recente antes de um
  antigo do qual ele dependeria. Mesmo *lease* de retomada de
  `reivindicarProxima` (enriquecimento): `rodando` com carimbo vencido volta a
  ser reivindicável;
- **duas portas, o mesmo elo por dentro:**
  - `GET /api/cron/confronto` — a batida diária (`vercel.json`, horário próprio,
    separado do `cron/diario`), processa em loop até a fila esvaziar ou o
    orçamento de tempo acabar;
  - `POST /api/confronto/rodar` — sob demanda, sem distinção entre "começar" e
    "elo seguinte" como em `enriquecer` (não há passo de escolher o que entra):
    todo POST reivindica um átomo e se auto-encadeia em `waitUntil`, com o
    cookie repassado;
- fila vazia, o encadeamento para. Fechar a aba não interrompe nada — o estado
  está no átomo, não no navegador;
- `POST /api/confronto/desfazer` — `{ atomo_id }`, apaga as relações de saída
  daquele átomo e limpa o estado; o átomo reentra puro na próxima varredura.

## 4. `/confronto`

`src/components/Confronto.tsx`, página de manutenção mínima — mesmo espírito de
`/agentes`/`/entidades`, e não uma tela de navegação de relações:

- botão **"rodar agora"**;
- **quantos átomos ainda esperam**, enquanto a fila anda — a tela relê sozinha
  a cada 4 s, mesma decisão de `/entidades`;
- **lista dos últimos átomos tocados**, `processado` ou `falhou`, com as
  relações que ganharam (ou o motivo do erro) e um botão de **desfazer** por
  linha.

Sem navegação por relação individual, sem filtro, sem busca — fica para quando
o chat precisar mostrar isso como procedência (fora de escopo, abaixo).

## 5. Verificação

`pnpm test` e `pnpm typecheck` verdes — `tests/confronto.test.ts` (o parser, a
gravação, o desfazer, a fila) e `tests/agentes.test.ts` (o décimo agente, a
sexta coluna do fluxo).

Depois, o que só olho vê: gravar (ou já ter gravado) sessões reais com opiniões
ou decisões que mudaram de ideia entre si, rodar `/confronto`, e ler as relações
que saíram.

| O que aparece | O que quer dizer |
|---|---|
| `ATUALIZA`/`CONTRADIZ` entre dois átomos que eu sei que se relacionam | o agente está lendo a afirmação, não só o assunto |
| `COMPLEMENTA` em dois átomos que não têm nada a ver, só por citarem a mesma pessoa/projeto | o piso ou o prompt estão frouxos demais — ajustar `PISO_CONFRONTO` ou a instrução, nunca o teste |
| fila nunca esvazia, ou muitos `falhou` | ver o motivo na linha — Gateway fora do ar é o caso mais provável, dado `comEsperaDeLimite` sem prazo |

Qualidade do julgamento se avalia à mão, sessão real por sessão real — sem
gabarito, sem fixture, sem percentual de recall, como o resto da extração
(`CLAUDE.md`).

## Fora de escopo

- **A camada de chat** (fatia 6) — esta fatia entrega o material que ela vai
  consumir, não a tela;
- **Tela de navegação de relações por átomo** — a lista de recentes em
  `/confronto` é o suficiente por agora;
- **Deduplicação de átomo** — continua não existindo. Múltiplas sessões dizendo
  a mesma coisa continuam sendo nós diferentes, só que agora possivelmente
  ligados por `:CONFIRMA`;
- **Segunda passada para relação de baixa confiança** (nos moldes do
  `desempate-1`) — `confianca` fica gravada na relação para uso futuro, mas não
  dispara reprocessamento nesta fatia;
- **Retroatividade automática no deploy** — a fatia entrega o mecanismo; varrer
  o histórico inteiro é rodar a fila (cron ou botão) até ela esvaziar, não algo
  que a migration ou o build disparam sozinhos.

## O que muda de arquivo

```
db/migrations/011_*.cypher          novo — relações e estado de confronto
src/lib/tipos.ts                    AGENTE_IDS += confronto; QuandoRoda += periodico;
                                     os tipos de relação, estado e candidato
src/lib/confronto.ts                novo — o agente, os candidatos, a fila, o desfazer
src/lib/modelos.ts                  modeloConfronto / CONFRONTO_MODEL
src/lib/agentes.ts                  registra o confronto; fluxo ganha a sexta coluna
src/app/globals.css                 grid do fluxo: cinco → seis colunas
.../api/confronto                   novo — GET (estado da tela)
.../api/confronto/rodar             novo — POST (sob demanda, fila autoencadeada)
.../api/confronto/desfazer          novo — POST (desfaz por átomo)
.../api/cron/confronto              novo — GET (a batida diária)
src/components/Confronto.tsx        novo — a tela
src/components/Gestao.tsx           link novo na gaveta
src/components/Agentes.tsx          selo "periódico"
vercel.json                         segundo cron
tests/confronto.test.ts             novo
ARCHITECTURE.md                     §2, §4 (nova subseção), §8, §10, §11, §12, §14
CLAUDE.md                           schema (:COMPLEMENTA), CONFRONTO_MODEL
PROXIMA-SESSAO.md                   registra o pivô e o estado de saída
```

Uma migration, um agente, quatro rotas, uma tela nova.

## Ordem de execução

| # | Passo |
|---|---|
| 1 | esta spec |
| 2 | a migration 011, proposta — **aprovada por mim antes de rodar** |
| 3 | o agente puro: candidatos, prompt, parser — sem fila e sem gravar |
| 4 | a gravação (delete-then-insert) e o desfazer |
| 5 | a fila: reivindicação, os dois gatilhos (cron e sob demanda), `/confronto` |
| 6 | `ARCHITECTURE.md`, `CLAUDE.md` e `PROXIMA-SESSAO.md` |

## Limites que esta fatia cria (para o §14)

- **A relação nasce sem revisão prévia**, mesma reabertura consciente que o
  enriquecimento já fez para a ficha da entidade (§4.9/4.12): a defesa é eu
  escolher quando rodar, ler o resultado em `/confronto`, e o desfazer a um
  toque — nunca átomo entrando sem confirmação (regra 5 continua inteira).
- **`PISO_CONFRONTO` é um palpite inicial**, não uma medição — vai precisar do
  mesmo ajuste à mão que os pisos da resolução já pedem, sessão real por sessão
  real.
- **O custo cresce com o volume de átomos**: cada um pendente paga uma busca
  vetorial e, havendo candidato, uma chamada de modelo. Sem teto de quantos
  processar por rodada além do orçamento de tempo da função.
- **Retroatividade é lenta por construção**: um grafo com anos de átomos leva
  várias rodadas (cron diário, ou vários toques em "rodar agora") para
  terminar de cobrir o histórico — não há um modo de varredura em lote maior.
- **Um átomo cujo `valido_em` está ausente nunca é candidato de ninguém** —
  ele ainda pode *ser* processado (busca candidatos normalmente), só não entra
  na lista de candidatos de outro átomo, porque comparação de data com string
  vazia nunca é "anterior".
