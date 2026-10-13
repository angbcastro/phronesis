# Documentação — o ARCHITECTURE.md volta a ser um mapa

**Objetivo:** que o `ARCHITECTURE.md` descreva **como o sistema funciona hoje**,
completo e sem se contradizer, num tamanho que se lê. A crônica de como ele
chegou aqui não se perde: vai para a spec da fatia que a produziu.

**Pronto quando:**

1. O `ARCHITECTURE.md` tem ≤ 50 KB e é um mapa: estado das fatias, topologia,
   módulos, fronteira de segurança, índice dos capítulos e manutenção.
2. Cada capítulo de `arquitetura/` tem ≤ 120 KB, está no presente e não traz
   data, ID de sessão nem andamento.
3. Toda referência `§x.y` de `src/`, `tests/`, `db/` e `Specs/` continua
   apontando para um cabeçalho que existe.
4. `tests/arquitetura.test.ts` roda no `pnpm test` e está verde.
5. Eu leio o mapa inteiro e um capítulo e reconheço o sistema.

## Por que agora

O arquivo passou de 500 KB (~7.800 linhas, ~130k tokens). Cada fatia acrescentou
descrição, motivo, crônica (datas, IDs de sessão, "antes era assim") e andamento
("não verificada", "falta medir"), e nunca tirou nada. Ele não cabe numa
leitura, então a leitura obrigatória do `CLAUDE.md` não tem como ser cumprida.
E já se contradiz: o chat aparece com "duas" e "quatro" ferramentas no mesmo
cabeçalho. O §14 sozinho tem 64 KB, e o §4 tem 211 KB sob o título
"Transcrição", que não diz mais o que tem dentro.

## As decisões

Tomadas por entrevista em 30/09 e 12/10.

- **A crônica vai para a spec da fatia**, numa seção **"Como ficou"** no fim de
  cada `Specs/slice-N.md`, movida quase literal. *Recusado:* apagar a crônica
  (é o único registro do porquê de várias escolhas) e um `HISTORICO.md` único
  (viraria o mesmo diário em outro lugar).
- **Mapa + capítulos.** O `ARCHITECTURE.md` vira o mapa, e as seções grandes
  viram arquivos em `arquitetura/`, **com a numeração §x.y preservada**.
  *Recusado:* renumerar, porque há centenas de referências `§` no código.
- **O andamento vai para o `PROXIMOS-TESTES.md`**, que já existe para isso. O
  mapa diz só se cada fatia está no ar. *Recusado:* uma tabela de verificação no
  mapa, que poria o mesmo andamento em dois lugares.
- **Um teste de inventário** cobra que nada do sistema fique sem texto, como o
  `tests/gateway.test.ts` cobra a porta única.

## Para onde vai cada tipo de informação

| O que é | Exemplo | Destino |
|---|---|---|
| Descrição do que existe | fluxo, contrato, chave do R2 | fica no capítulo, no presente |
| Motivo vivo | por que é assim, o que foi recusado | fica, curto |
| Crônica | datas, IDs de sessão, "até a 4.x era", "subiu de A para B", prompts antigos | "Como ficou" da spec da fatia |
| Andamento | "construída, não verificada", "falta medir" | `PROXIMOS-TESTES.md`, na seção da fatia, se ainda não estiver lá |
| Limite aberto | o que o sistema não faz ou faz mal hoje | §14, agrupado pelo § que ele limita |
| Limite resolvido | "resolvido na 8.1" | "Como ficou" da fatia que resolveu |
| Contradição | "duas" vs "quatro" ferramentas | resolvida pelo código e listada no commit |

## A forma final

```
ARCHITECTURE.md            o mapa (≤ 50 KB)
  - estado: fatia | no ar, e o link para PROXIMOS-TESTES.md
  - §1 topologia, §2 mapa dos módulos, §7 fronteira de segurança
  - índice: número, arquivo, o que cobre
  - manutenção (curta, apontando para o CLAUDE.md)
arquitetura/
  03-audio.md               §3
  04-pipeline.md            §4.1–4.7
  04.08-identidade.md       §4.8, 4.8.1, 4.10, 4.14
  04.09-ficha-e-retrato.md  §4.9, 4.20
  04.11-calibracao.md       §4.11–4.13
  04.15-confronto.md        §4.15
  04.16-chat.md             §4.16
  04.17-desempenho.md       §4.17–4.19
  05-estados.md  06-idempotencia.md  08-grafo.md  09-r2.md  10-rotas.md
  11-telas.md    12-ambiente.md      13-verificacao.md        14-limites.md
```

Os cabeçalhos `##`, `###` e `####` ficam idênticos dentro dos capítulos. O
`## 4.` ganha um título que diga o que cobre, mas o número continua o mesmo.

## Regras de escrita

Valem para todo capítulo. As cinco primeiras entram no `CLAUDE.md` no passo 5.

1. **Presente do indicativo.** O texto descreve o que existe.
2. **O motivo fica, curto:** por que é assim e o que foi recusado.
3. **A crônica sai** para o "Como ficou" da fatia.
4. **O andamento sai** para o `PROXIMOS-TESTES.md`.
5. **Limite resolvido sai** do §14 para o "Como ficou".
6. **Contradição se resolve pelo código.** Quando o código contradiz o
   documento, o errado é o documento. Cada correção é listada no corpo do commit.
7. **O §8 se organiza por label e aresta.** A migration aparece como a origem de
   cada propriedade.
8. **O §13 encolhe** para o que não se descobre lendo `tests/`.

## Ordem de execução

Cada passo é um commit. Nenhum `push` acontece sem eu pedir.

0. **Terreno.** Árvore limpa e tag `antes-da-documentacao`.
1. **Esta spec.**
2. **O teste de inventário, em `describe.skip`.** `tests/arquitetura.test.ts`,
   no molde das varreduras de `tests/gateway.test.ts`. Ele lê o mapa e os
   capítulos e cobra:
   - todo arquivo de `src/lib`, `src/client` e `src/components` citado no §2;
   - toda `route.ts` de `src/app/api` citada no §10;
   - todo `id` de `AGENTES` citado;
   - toda `process.env.X` citada no §12, exceto `NODE_ENV`;
   - toda migration de `db/migrations/` citada no §8;
   - todo `§x.y` citado no código e nas specs existindo como cabeçalho;
   - os limites de tamanho;
   - nenhuma data nem ID de sessão no mapa e nos capítulos.
3. **A divisão mecânica, sem mudar uma palavra.** Concatenar mapa e capítulos
   reproduz o arquivo antigo, fora as linhas do índice.
4. **A limpeza, um capítulo por commit:** mapa → §14 → §8 → os sete do §4 → §5,
   §6, §9, §10, §11, §12, §13, §3. Em cada capítulo:
   - aplicar as regras de escrita;
   - levar a crônica para o "Como ficou" da fatia no mesmo commit (a fatia vem
     do marcador `(slice N)` ou de `git log -S`);
   - levar o andamento para o `PROXIMOS-TESTES.md`;
   - ler os módulos do capítulo e completar o que o código faz e o texto não
     diz;
   - fechar os itens do inventário daquele capítulo.
5. **A regra muda junto.**
   - `CLAUDE.md`: a leitura obrigatória vira "o mapa + o capítulo que a tarefa
     toca"; entram as regras 1–5, o "Como ficou" ao fechar uma slice e o teste
     como guarda.
   - A manutenção do mapa repete a regra, curta.
   - O teste entra no `pnpm test`, verde.

## Verificação

- **Passo 3:** a concatenação dos capítulos é igual ao arquivo antigo.
- **Passo 4, por capítulo:** toda linha removida aparece como adicionada em
  `Specs/` ou em `PROXIMOS-TESTES.md`, ou está na lista de contradições do
  commit. A conferência é um script sobre `git diff`.
- **Passo 5:** `pnpm test` e `pnpm typecheck` verdes.
- **À mão:** eu leio o mapa e um capítulo.

## Fora de escopo

- Mudar código para casar com o documento. Se o código parecer errado, isso vira
  item listado, não conserto.
- Reescrever as specs antigas além de acrescentar o "Como ficou".
- Gerar documentação a partir do código.

## Como ficou

O que o `ARCHITECTURE.md` contava desta fatia — datas, medições, o que era
antes —, movido quase literal quando ele passou a descrever só o presente
(`Specs/documentacao.md`).

### Do cabeçalho do `ARCHITECTURE.md`

*A linha de estado do cabeçalho, como estava antes de virar tabela.*

**Estado: slice 2 fechada e validada; slices 3 (higiene do grafo), 4
(identidade por contexto), 4.5 (o grafo ganha vetor), 4.6 (o prompt aprende
com a revisão), 4.7 (o painel dos agentes), 4.8 (a extração acompanha a fala),
4.8.1 (as seis emendas), 4.9 (o extrator conhece o grafo), 4.10 (o arquivo
importado entra pela mesma porta), 4.11 (a entidade se apresenta, e o agente 2
mede a própria dúvida), 4.12 (a ficha se escreve sozinha), 5 (confrontar:
relações entre átomos ao longo do tempo), 5.1 (o confronto calibrado pela
primeira revisão à mão), 6 (o chat: perguntar ao grafo em texto livre), 7 (o
laço de retroalimentação deixa de ser da extração), 8.1 (as quatro emendas), 8
(o sistema se cronometra, e encolhe o que mede) e 8.2 (a revisão abre antes de a
proposta fechar) construídas.**

*O que ainda não existia, como o cabeçalho dizia.*

O que ainda não existe: `:Foco`, as 2-4 perguntas do ritual, me testar sobre o
que aprendi (a fatia C), e a deduplicação de **átomo** — dizer a mesma coisa em
duas sessões ainda cria dois, só que agora possivelmente ligadas por `:CONFIRMA`
(§4.15).

### Do §13 (verificação)

*Os bullets por arquivo de teste que o §13 tinha antes de encolher (regra 8): o que cada teste guarda se lê no próprio arquivo.*

- `pnpm test` — **56 arquivos, 1115 testes**, sem credencial e sem rede. A lista
  abaixo comenta os que valem uma explicação; a cobertura inteira se lê em
  `tests/`. Os que não têm bullet próprio cobrem a lógica pura da slice 1
  (chaves, manifest, estados, offsets, vocabulário, backoff, retry de rede,
  migrate) e, das fatias seguintes, a escrita no grafo e as telas:
  `atomos`, `confirmar`, `entidades`, `entidades-grafo`, `entidades-tela`
  (o que a lista mostra e em que ordem, e que a própria entidade nunca aparece
  entre as candidatas a fundir com ela mesma), `revisao`,
  `calibracao-tela`, `catalogo`, `texto`, `transcricao`, `modelos`, `extracao`
  (o parser, o envelope e a normalização de tipo — **não** a qualidade da
  extração, que é o bullet mais abaixo) e `pipeline-extracao`.
- `tests/janela.test.ts` — as três invariantes da slice 4.8 que não aparecem em
  tela nenhuma: que o `id` do átomo nunca se repete entre janelas (id repetido só
  apareceria no confirmar, sobrescrevendo átomo no grafo), que o lease impede
  dois `waitUntil` de pagarem a mesma janela — e devolve a janela quando o worker
  morre —, e que um `estende` com `ref` inválida vira descarte em vez de escrita
  no átomo errado. Mais o fatiamento: buraco no meio segura a janela, arquivo
  importado é uma janela só, `fechando` não inventa janela vazia.
- `tests/pipeline-janela.test.ts` — o gatilho: quatro blocos fecham a janela sem
  ninguém pedir, a janela seguinte recebe o que a anterior propôs, janela pronta
  não é reextraída, janela que falha deixa rastro e **não** deixa a seguinte
  passar na frente, e o penhasco — janela que não fecha manda a sessão para `erro`
  em vez de cair no passe único (slice 8, §4.18). Mais o dossiê da 4.9: a janela
  recebe o nó que o bloco cita, as candidatas ficam gravadas e as chaves vistas
  ficam no parcial. E a segunda chance da 8.2: falhou uma vez e passou na segunda
  abre a revisão, falhou as duas ainda vai para `erro`, janela já pronta não é
  refeita na segunda passada, e — o ponto mais fácil de errar — **as duas
  tentativas dividem o mesmo `ate`**, contado do começo da função, porque dar um
  prazo novo à segunda passaria do `maxDuration` de 300 s.
- `tests/recuperacao.test.ts` — o RAG por bloco (4.14) sem rede nenhuma: que
  "giam" alcança "Giampaolo Lepore" pela camada `prefixo`, que grafo vazio devolve
  dossiê vazio (e aí a extração sai como na 4.8), que o arquivo do bloco é a
  trava, e que a camada semântica caída fica **marcada** em vez de cacheada como
  completa. A qualidade da lista eu avalio à mão, na revisão.
- `tests/audio.test.ts` — resolução de formato, incluindo o `.opus` do WhatsApp
  que chega com `File.type` vazio, e os limites de tamanho e duração.
- `tests/agentes.test.ts` — a **varredura** (todo `generateText`/`transcribe`/
  `embed` de `src/` pertence a um agente do registro), o **no-op** (sem override,
  todo prompt sai byte a byte igual ao de antes da 4.7), o carimbo com os dois
  sufixos, o guarda-corpo do envelope e a integridade das duas telas do fluxo —
  inclusive que os agentes da consulta não apareçam no caminho de gravar.
- `tests/importacao.test.ts` — `transcreverBloco` busca o áudio na extensão que o
  manifest registrou, e continua caindo em `.webm` quando o campo não existe.
- **O `fatiador` não entra em `pnpm test`**, e não vai entrar: ele é
  `AudioContext` e `decodeAudioData` puros, e simulá-los testaria o simulador. O
  que a 4.10 tem de testável sem navegador é `fecharJsonTruncado` — inclusive o
  caso que uma implementação ingênua erra, uma chave `}` dentro do texto do
  átomo — e `chavesDaSessao`, incluindo o manifest por último. **O que o fatiador
  faz se verifica na importação real**, pelo log: `[janela] sessão <id> janela 0
  (blocos 0-3)` é o critério da fatia.
- `tests/auth.test.ts` — as duas credenciais da porta única: o limiar em que a
  janela de 90 dias desliza, e o header do cron. O teste do **prefixo** do
  segredo certo existe para ninguém trocar a comparação de tempo constante por um
  `startsWith` algum dia.
- `tests/backup.test.ts` — a chave que gira pelo dia do mês (é a sobrescrita que
  poda a janela, sem nenhum LIST) e a forma do dump. O Cypher que tira o
  `embedding` **não** é testado: ele mora numa constante e só o banco responde
  por ele; o que o teste guarda é a intenção, no lugar onde ela se lê.
- `tests/stt.test.ts` — a distinção que o §5.4 declara: bloco sem fala volta
  vazio, e qualquer outro erro continua subindo como `SttError`. Mocka só o
  `experimental_transcribe`; o `NoTranscriptGeneratedError` é a classe de verdade
  do SDK, senão o teste mediria o dublê e não o contrato que ele existe para
  segurar. Afrouxar o segundo caso transformaria modelo inexistente e áudio
  corrompido em sessão silenciosamente sem texto.
- `tests/embedding.test.ts` — a string canônica da entidade e o hash dela: o que
  entra, o que é omitido, e o que faz uma entidade sair de dia. Sem rede: a
  qualidade da vizinhança em si eu avalio à mão, olhando a lista.
- `tests/gateway.test.ts` — guarda da porta única de modelo (seção 4.2): varre
  `src/` e `scripts/` atrás de import de pacote de provedor, endpoint de
  provedor escrito à mão e leitura de chave de provedor, e confere as
  dependências e o `.env.example`. Roda junto com `pnpm test`.
- `pnpm typecheck` — `tsc --noEmit`.

- **Validar Cypher sem escrever nada:** prefixar a consulta com `EXPLAIN` faz o
  Aura planejar sem executar, o que pega erro de sintaxe e de schema contra o
  banco real. Foi assim que as escritas da slice 3 foram conferidas antes de
  existir dado para exercitá-las.

- Qualidade de extração (slice 2) não tem teste automático: a avaliação é à mão,
  na tela de revisão, sessão real por sessão real. Ver `Specs/slice-2.md`.
- `tests/fusao.test.ts` — que fundir não apaga nó, que a grafia velha vira alias
  e que fundir duas vezes não refaz nada.
- `tests/duplicatas.test.ts` — o viés da camada de string: pega "Exxmed"/"Exx
  Med" e não trata "Ana"/"Ane" como duplicata.
- `tests/vocabulario-grafo.test.ts` — a união arquivo + grafo, e que grafo fora
  do ar não derruba transcrição.
- `tests/vocabulario-entrega.test.ts` — provedor sem mecanismo conhecido não
  recebe opção nenhuma.
- `tests/resolucao.test.ts` — **quando** o agente 2 é chamado (sessão sem
  ambiguidade não paga nada) e o que acontece quando ele não responde direito:
  resposta ruim vira dúvida, nunca atribuição errada em silêncio.
- `tests/referencias.test.ts` — proposta do formato antigo ainda abre na revisão
  (critério 10 da slice 4).
- `tests/perfil.test.ts` — que o agente 3 **não escreve**, e que o corte de 300
  no servidor **saiu** com a 4.11: o "no máximo 300 caracteres" continua no texto
  do prompt, como instrução de concisão, e não como teto.
- `tests/desempate.test.ts` — o que a segunda passada vê e a primeira não via (os
  três campos de perfil, sem teto, dos candidatos daquela menção), e o que ela faz
  quando o modelo não coopera: `duvida` ausente conta como dúvida, e falha devolve
  `null` em vez de estourar. A qualidade da decisão eu avalio à mão.
- `tests/enriquecer-rota.test.ts` — a corrente da fila (4.12.1): o elo seguinte
  que responde 500 ou 401 deixa a linha `[fila]` com o status, o cookie é
  repassado, a exceção de rede não derruba a rota, e fila vazia não encadeia.
  A retomada da tela é um elo comum, marcado no log.
- `tests/cron-enriquecimento.test.ts` — a batida semanal (4.12.1): a batida
  enfileira e a continuação não; a fila anda até esvaziar; o orçamento no fim
  chama a própria rota com `Bearer $CRON_SECRET`, e o status de uma continuação
  recusada vai ao log; o grafo caído para a corrente em vez de virar laço. A
  seleção — quem entra pelas três regras e quem não é regravado — está em
  `tests/enriquecimento.test.ts`.
- `tests/entidades-tela.test.ts` também guarda `filaParada()` (4.12.1): `na_fila`
  sem `rodando` fresca é parada, `rodando` mais velha que o lease não segura a
  fila, e sem nada esperando não há o que retomar.
- `tests/enriquecimento.test.ts` — o que impede uma resposta ruim de virar ficha,
  que é o que a 4.12 tem de mais caro: o parser recusa os quatro campos vazios e
  corta o `resumo` em 500; a entidade sem átomo não chega ao modelo; a gravação
  guarda os quatro `_anterior` **antes** de escrever, em cláusulas `SET`
  separadas; e o desfazer é uma troca que lê os dois lados antes de escrever
  qualquer um. Do lado da fila: a reivindicação é condicional, `rodando` velho
  volta a ser reivindicável (a retomada mora na mesma consulta), e uma entidade
  que falha vira `falhou` com o motivo sem derrubar as seguintes.
  **A qualidade do texto nenhum teste alcança** — se o resumo distingue ou só
  descreve, quem diz sou eu, lendo duas fichas parecidas lado a lado.
- `tests/fusao.test.ts` — que grafia deixou de ser nó (009): `registrarGrafia` e
  `renomear` escrevem em `aliases`, ninguém cria `:Entidade`, e as recusas que o
  índice único fazia de graça passaram a ser leitura explícita.
- `tests/entidades-grafo.test.ts` — que `chaves` atravessa a propriedade, que o
  casamento exato encontra "jean" sem nó nenhum, e que o vocabulário do STT lê só
  `e.nome`. **O Cypher em si nenhum teste valida** — `query` está mockado, e quem
  recusa é o banco: a 4.11 escreveu `coalesce(e.aliases, []) + collect(...)`
  direto no RETURN de `garantirEmbeddings`, passou em 922 testes e só apareceu
  contra o Aura (somar chave de agrupamento a agregação na mesma expressão é
  ilegal). O conserto foi um `WITH` próprio, e a linha que o fixa está lá.
- Qualidade da resolução (slice 4) também não tem teste automático, e pelo mesmo
  motivo. A diferença é que agora existe um caso concreto de que eu sei a
  resposta: a sessão que fala do Rapha e do Raffa.
- `tests/padroes.test.ts` — era `regras.test.ts` até a slice 7. As duas metades
  do prompt se emendam sem nada entre elas e a versão sai sem sufixo; as amarras
  do `calibracao-2` reaplicadas no parser; a sugestão dos 21 dias, agora **por
  agente** — abrir a tela de um não adia a do outro, e correção de `grafo`
  sozinha nunca acende nada.
- `tests/redacao.test.ts` — o teste que mais importa da 7: **seção que ninguém
  citou volta byte a byte**, comparada fatia a fatia contra o original. É a
  promessa inteira da fatia, e ela é verificável porque o redator devolve
  emendas em vez do prompt inteiro. Junto, as seis amarras: `apagar` não existe,
  a seção do envelope é intocável, seção inventada cai, `criar` entra antes do
  envelope e não depois dele, e o teto de duas seções por rodada.
- `tests/processando.test.ts` — quando o corredor empurra a sessão parada, que é
  a única decisão dele que não é cosmética: empurrar demais paga uma chamada de
  modelo à toa, empurrar de menos deixa a sessão sem caminho até a revisão. E,
  desde 18/09, o teto da espera: os 300 s de `maxDuration` cabem inteiros dentro
  dele, porque chamar de travado cedo demais custa uma re-extração à toa. E o
  predicado da ponte (8.2): **um átomo basta** para sair para a revisão — errar
  para mais abriria a revisão vazia, errar para menos manteria a tela morta que a
  fatia existe para acabar.
- `tests/proposta-viva.test.ts` — a proposta antes de fechar (8.2), sem rede e
  sem relógio de verdade. De `propostaAtual`: `null` só quando não há átomo
  nenhum (é o que mantém a ponte de pé), o acumulado virando proposta com
  `trechos_totais`/`trechos_faltando`, a janela `falhou` contando como faltando,
  o mapa de blocos vindo do parcial (sem ele o player some da revisão que cresce)
  e a extração fechada vencendo o parcial. De `acompanharProposta`: que **parcial
  sem mudança não vira evento** — é o carimbo segurando o custo —, que o catálogo
  é lido uma vez por conexão mesmo com várias remontagens, que a proposta fechada
  é o último evento, que sessão em `erro` fecha o fluxo mas **não** esconde uma
  proposta que já existe, que abortado não lê nada, e que o teto fecha sem evento
  extra em vez de deixar o laço preso.
- `tests/extracao-rota.test.ts` — o contrato que a revisão lê, e o que mudou nele:
  o 404 agora significa **zero átomos**, não "ainda não fechou"; `crescendo` e as
  contagens viajam; a proposta anterior vem como cabeçalho e a lista antiga só é
  paga com `?anterior=1`; e infraestrutura fora do ar é 502 com causa legível.
- `tests/limite.test.ts` — as três escadas e o que **não** é escada. O corte por
  prazo não é transitório nem limite de taxa, e é essa linha que impede o
  conserto de virar três chamadas de 90 s onde havia uma; que orçamento
  insuficiente não vira chamada nenhuma; e que cada tentativa ganha o seu relógio,
  sem o da anterior cortá-la.
- `tests/correcoes.test.ts` — a apuração inteira, pura: que rejeitar, editar e
  trocar o sujeito viram correção (critério 1); que dois renomes na mesma sessão
  não colapsam num id só (critério 2); e que canonização **não** produz correção
  nenhuma (critério 3), que é o teste que impede o corpus de nascer envenenado.
  Desde a 5.2, também a correção de relação: o `antes` é sempre o do agente, a
  segunda edição substitui a em aberto, e voltar ao valor do agente a tira.
- `tests/confronto.test.ts` — o que impede uma resposta ruim de virar relação
  (número fora da lista, tipo inventado, camada inválida virando sutil, o teto de
  sete, `COMPLEMENTA` forte abaixo do limiar descendo para sutil) e o que a 5.2
  trouxe: **a direção decidida pelo código** quando o candidato é mais novo que
  o alvo, o `dono` na gravação e no desfazer, a recusa e a aresta congelada fora
  dos candidatos, a falha por alvo, e a minha edição congelando e guardando o
  original só na primeira vez.
- `tests/chat.test.ts` — o que erraria **calado** na slice 6, que é quase tudo o
  que ela tem: o período comparando data com data (sem `left(valido_em, 10)` um
  `<= '2026-08-31'` exclui o próprio dia 31), o átomo sem data saindo de qualquer
  pergunta com período, e a entidade inexistente voltando com **aviso e nomes
  parecidos** em vez de lista vazia — a diferença entre "essa pessoa não está no
  diário" e "você escreveu o nome de outro jeito". Do loop: que o teto conta
  chamada de ferramenta e não passo do modelo, e que parar no teto **sem texto**
  dispara a síntese com `toolChoice: "none"` — sem isso, a pergunta que gastou as
  oito buscas é justamente a que volta vazia. Das ferramentas: que elas nunca
  propagam erro, porque ferramenta que estoura derruba o loop e ferramenta que
  devolve "não consegui" deixa o modelo tentar outro caminho. Da conversa: que
  apagar tira o objeto do R2 **antes** do nó, que o `atualizada_em` sobe depois
  da escrita e nunca antes, e que um conflito de etag relê e reaplica em vez de
  apagar o que a outra aba escreveu. Da tela: o NDJSON partido no meio de uma
  linha, que é a única coisa daquele componente que erraria em silêncio.
  **A qualidade da resposta nenhum teste alcança** — se o agente escolheu as
  buscas certas e se o rastro do (i) faz sentido, quem diz sou eu, pergunta real
  por pergunta real.
- `tests/gestos.test.ts` — a fronteira do que o cliente manda: a chave existir é
  o gesto, e caixa e acento não são renome.
- `tests/calibracao.test.ts` — o `If-Match` com laço de retry: duas capturas
  concorrentes se somam em vez de a segunda apagar a primeira.
- `tests/confirmar-correcoes.test.ts` — a fiação, incluindo o critério 10: falhar
  ao registrar não muda a resposta do confirmar.
