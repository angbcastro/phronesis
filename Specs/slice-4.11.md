# Slice 4.11 — A entidade se apresenta, e o agente 2 mede a própria dúvida

**Objetivo:** que toda entidade carregue um `resumo` e uma lista de `aliases` como
**propriedade**, que seja isso o que os dois agentes leem por padrão, e que o
agente de resolução deixe de decidir no escuro — ele devolve uma **confiança**, e
quando ela cai abaixo do limiar uma **segunda passada** olha o perfil inteiro dos
candidatos daquela menção.

**Pronto quando:** eu gravo uma sessão que cita gente conhecida e vejo, na mesma
sessão:

- o dossiê do extrator mostrando `nome — resumo`, com os aliases como lista e a
  marca de canônico, e nenhum `contexto` solto;
- `[desempate] sessão <id>: N menção(ões) abaixo do limiar` no log, e a atribuição
  final vindo da segunda passada;
- "jean" casando exato com Giampaolo Lepore **sem existir nó de alias** no grafo —
  `MATCH (e:Entidade {nome_normalizado:'jean'}) RETURN e` devolve vazio, e
  `MATCH (e:Entidade {nome_normalizado:'giampaolo lepore'}) RETURN e.aliases`
  devolve a grafia;
- `/entidades` deixando eu editar `resumo` e `aliases` à mão e marcar uma entidade
  como canônica, em qualquer um dos quatro tipos.

## Por que agora

**Porque a 4.9 entregou o dossiê e o alias automático, e as duas coisas estão
apertadas no formato errado.**

O dossiê que o extrator vê (`blocoDasCandidatas`, `src/lib/extracao.ts:312`)
mostra nome, tipo, aliases **concatenados numa string** e o campo `contexto`
isolado — um dos três, escolhido em código, sem que ninguém tenha decidido que é
o que mais identifica alguém. O agente 2 (`descrever`, `src/lib/resolucao.ts:448`)
vê outra coisa: os **três** campos inteiros, de **todas** as entidades do
catálogo, em toda chamada. São duas apresentações diferentes da mesma entidade,
para dois agentes que leem o mesmo trecho — e nenhuma das duas é a apresentação
que eu escreveria se me perguntassem "como você descreve essa pessoa para alguém
que precisa distingui-la de outra parecida?".

É esse consumo do agente 2 que sustenta o `TETO_PERFIL = 300`
(`src/lib/tipos.ts:169`), e o teto é o que impede a ficha de uma pessoa de ser
tão longa quanto ela merece. O teto não é o problema: o problema é **o que entra
em prompt a cada resolução**. Enquanto for o perfil inteiro de todo mundo, o teto
tem que existir.

**E o alias virou nó.** `registrarGrafia` (`src/lib/fusao.ts:428`) cria um
`:Entidade` com `status = 'fundida'` para cada grafia que eu confirmo. Funciona —
é o que faz "jean" casar exato na sessão seguinte, de graça, pelo índice único de
`nome_normalizado`. Mas o efeito colateral é que o grafo passa a ter **duas
espécies de nó fundido com a mesma forma**: a grafia que o STT errou (nó sem
label de tipo, criado sozinho) e o perdedor de uma fusão que eu mandei fazer (nó
com label de tipo, arestas migradas). Nenhuma consulta as distingue, `/entidades`
mostra as duas como "histórico do nome", e a lista de aliases não é editável — eu
não consigo acrescentar uma grafia que sei que o STT vai errar antes de ele
errar.

**O terceiro motivo é o que a entrevista trouxe:** o agente 2 hoje responde
`certo: true | false`, e `false` é a única coisa que a tela sabe pintar. Não
existe "resolvi com folga" nem "resolvi raspando" — e não existe caminho nenhum
para ele **pedir mais informação**. Ou ele decide com o que recebeu, ou ele
marca dúvida e me empurra a decisão.

**O que não está quebrado, e esta fatia não toca:** o dossiê do GraphRAG em si
(as camadas de `recuperacao.ts`), o RAG por bloco, o `estende` da janela, a guarda
do `"eu"`, a extração e seu prompt-base, o `:PERFILA`, a fusão de duas entidades
reais, o vocabulário do STT.

## As decisões

Todas perguntadas em 08/09, em sete rodadas, antes de uma linha desta spec
existir. Nenhuma se infere do código.

| Decisão | Escolhido | O que foi recusado, e por quê |
|---|---|---|
| **O que os agentes leem por padrão** | **`resumo` + `aliases`, nos dois** | "Resumo no agente 1, perfil inteiro no agente 2" mantinha o `fizemos_juntos` — o sinal mais forte que o sistema tem — na frente de quem decide. Recusado porque manteria o teto de 300 de pé para sempre, e porque a mesma entidade continuaria com duas caras. Uma apresentação só, nos dois lugares |
| **O perfil inteiro, então, some?** | **não: ele volta na segunda passada** | O perfil não sai do sistema, sai do **caminho comum**. Ele é o que a segunda passada carrega, e só para os candidatos daquela menção — que é onde ele sempre valeu a pena |
| **Como o agente 2 pede mais informação** | **segunda passada, disparada pela confiança** | "Ferramenta de verdade (tool use)" era mais fiel a "ele decide": consulta uma entidade, lê, decide se quer outra. Recusado pelo relógio — ele roda dentro da extração de cada janela, e a 4.8 existe para cortar espera; um laço de rodadas imprevisíveis é exatamente o que ela tirou. "Heurística decide antes, uma chamada só" foi recusada por tirar a decisão do agente e devolvê-la ao código |
| **Quantos limiares** | **um** | Dois limiares (um para consultar, outro para duvidar) separavam "preciso de mais informação" de "nem com tudo eu resolvo". Recusado: são duas réguas para calibrar à mão, para sempre. Com um só, o que a segunda passada devolver vale como final, e dúvida na tela só quando ela **marcar** dúvida |
| **Quem faz a segunda passada** | **agente próprio, prompt próprio** | "Mesmo agente, entrada mais rica" custaria um prompt a menos para calibrar — o critério que a 4.8 usou para recusar a passada de costura. Recusado aqui porque o papel é outro: ele já sabe que a primeira leitura não resolveu, ele olha **uma** menção, e ele tem o perfil inteiro na mão. Instruir isso dentro do prompt geral seria escrever um agente dentro do outro |
| **Teto do `resumo`** | **500 caracteres** | Sem teto, o custo de todo prompt passa a depender do tamanho de cada ficha, e uma entidade muito falada empurra as outras para fora do contexto. 500 é o número escolhido — 300 era pouco para um retrato, e o teto novo cobra de um campo só o que antes se cobrava de três |
| **Teto dos três campos** | **some** | Eles saíram do caminho comum: agora só entram na segunda passada, para poucos candidatos. O motivo declarado na migration 005 deixou de valer, e o teto com ele |
| **O que o `resumo` é** | **retrato de identidade** | "Retrato completo em 500 caracteres" serviria também como ficha de leitura minha. Recusado: se o que distingue duas pessoas parecidas não couber, a segunda passada vira a regra em vez da exceção — e aí o resumo não economizou nada, só atrasou |
| **Aliases** | **propriedade array; os nós de grafia morrem** | "Manter os nós e só editar na tela" custava zero migration e mantinha o casamento exato caindo no índice único. Recusado porque manteria duas espécies de nó fundido com a mesma forma para sempre. "Array **junto** com os nós" foi recusado por criar duas fontes de verdade para a mesma pergunta |
| **Casamento exato sem o índice** | **em memória** | `listarEntidades()` já traz o catálogo inteiro e `acharPorChave` já procura em memória, sobre `chaves` — a estrutura que esta fatia precisa **já existe**, e só muda de onde ela é preenchida. Índice full-text sobre `aliases` foi recusado por gastar cota de índice do Aura Free sem resolver nada que já não esteja resolvido |
| **O que a migration faz com o passado** | **só as grafias viram array** | "Tudo vira array, `FUNDIDA_EM` some" deixaria o grafo com um mecanismo só. Recusado: fusão de duas entidades reais é o **registro de uma decisão minha**, e apagá-la perderia quando e o quê. Grafia de STT não é decisão, é conserto |
| **Nome canônico** | **preferência, não obrigação** | Exigir Nome + Sobrenome para marcar canônico amarraria as duas coisas e faria a flag significar "ficha completa". Recusado: eu posso querer marcar como canônica alguém cujo sobrenome eu genuinamente não sei |
| **O nome no texto do átomo** | **corrige só o que o STT errou** | Escrever sempre o canônico completo daria procedência máxima — o átomo se sustentaria sozinho sem o grafo. Recusado porque a voz do diário é o produto: "almocei com Giampaolo Lepore" não é uma frase minha. E porque a diferença entre o que eu falei e o que o grafo sabe é justamente o que alimenta `aliases` com o erro que o STT costuma cometer |
| **Onde a flag canônico pesa** | **nas duas etapas, dita no prompt** | "Só no desempate, sem entrar em prompt" seria determinístico e auditável. Recusado: o modelo nunca saberia que uma ficha é a oficial, e é ele quem lê o dossiê |
| **Entidade nova** | **marcada só quando a confiança for baixa** | "Marcada sempre, antes de confirmar" garantiria que nenhuma entidade nasce sem eu ter visto. Recusado pelo custo em tempo de revisão — o alvo de 60 s não sobrevive a um toque por entidade nova em toda sessão |
| **Vocabulário do STT** | **continua à mão** | Alimentar `config/vocabulario.txt` com os nomes canônicos atacaria o erro na origem. Fica fora: mantém a fatia estreita, e é uma decisão que merece a própria medição |

## 1. Migration 009 — o schema

`db/migrations/009_resumo_aliases_canonico.cypher`, **proposta; aprovar antes de
rodar** (CLAUDE.md).

Ao contrário da 003, 005, 007 e 008, esta **tem statements**: ela converte dado.

Três campos novos em `:Entidade`, os três valendo para os quatro tipos:

```
(:Entidade { …, resumo, aliases, canonico })

resumo    texto livre, teto de 500 (TETO_RESUMO), nasce vazio
aliases   lista de strings — as grafias como elas foram faladas/escritas
canonico  booleano, marcado à mão; ausente conta como false
```

A migração de dado, em dois statements, e o discriminador é **o label**:

- o nó de grafia que `registrarGrafia` e `renomear` criam nasce só com
  `:Entidade` (`CREATE (alias:Entidade { … })`, `fusao.ts:475`);
- toda entidade real ganha o label do tipo no `ON CREATE`
  (`n:${tipo}`, `atomos.ts:70`), e continua com ele depois de perder uma fusão.

**Contar átomos não serve como discriminador**, e é o erro que esta seção existe
para não deixar acontecer: `fundir()` migra `:SOBRE`, `:MENCIONA` e `:PERFILA`
para o vencedor, então o perdedor de uma fusão real também fica com zero átomo.

Statement 1 — as grafias viram itens de `aliases` do vencedor **terminal** da
cadeia (a 4.8.1 permite cadeia de fusão), com deduplicação em Cypher puro.
Statement 2 — os nós convertidos são apagados.

Fora da migração: nó fundido **com** label de tipo fica exatamente como está,
com sua aresta `:FUNDIDA_EM`.

## 2. `aliases` deixa de ser nó

`src/lib/entidades.ts`, `src/lib/fusao.ts`, e a rota de confirmar.

`EntidadeDoGrafo` não muda de forma — `aliases: string[]` e `chaves: string[]` já
existem. Muda **de onde eles vêm** em `listarEntidades()`:

```
aliases  = coalesce(e.aliases, []) ∪ collect(alias.nome)     // propriedade ∪ nós de fusão real
chaves   = [e.nome_normalizado] ∪ normalizar(aliases) ∪ chaves_alias
```

`acharPorChave` não muda uma linha: ela já varre `chaves` em memória. **É esse o
casamento exato**, e ele passa a atravessar a propriedade sem uma consulta a
mais.

`registrarGrafia` deixa de criar nó e passa a fazer `SET v.aliases = …` com
deduplicação. As quatro recusas dela continuam de pé, com uma reescrita:

1. grafia vazia, pronome, ou igual à chave do nó — inalterada;
2. o nó alvo não existe, ou ele mesmo é um fundido — inalterada;
3. a grafia já existe como nó **ativo** — inalterada: seria fundir duas entidades
   reais sozinho, e fusão nunca é automática;
4. a grafia já é alias de **outro** nó — agora se verifica contra a união das duas
   fontes, e a resposta continua sendo recusar.

Ela deixa de ser uma exceção dentro de `fusao.ts`: escrever num array não é
fundir nada, e o docstring do módulo (`fusao.ts:34`) muda junto.

**Idempotência (regra 4):** a dedupe faz a segunda confirmação da mesma sessão ser
no-op, como a checagem prévia fazia antes.

**Dois efeitos que hoje são de graça e precisam continuar sendo:**

- `fonteDaEntidade` inclui aliases → o hash muda → `passadaDeVetores` reembute a
  entidade sozinha. Continua valendo, com os aliases vindo da propriedade;
- `nomesParaVocabulario` exclui fundidos → "Jean" não é ensinado ao STT. **Isto
  deixa de ser automático**: sem o nó, não há `status = 'fundida'` para filtrar.
  A consulta passa a ler só `e.nome`, e os aliases nunca entram — explícito onde
  antes era consequência.

## 3. O `resumo`, e o que cada agente lê

**O dossiê do extrator** (`blocoDasCandidatas`, `extracao.ts:312`) passa a mostrar,
por candidato: a chave, o nome, o tipo, a marca de canônico, os aliases **como
lista** e o `resumo`. O `contexto` sai. O resto do bloco — a explicação de que o
STT erra nome próprio, o formato `{"citado","chave"}`, a regra de só trocar o nome
próprio, a trava de tipo — fica **byte a byte igual**: foi calibrado e funciona.

`PROMPT_VERSION` da extração sobe para **`extracao-9`**. A entrada mudou; é o
precedente do `resolucao-2` na 4.5 e do `extracao-6` na 4.8.

**O catálogo do agente 2** (`descrever`, `resolucao.ts:448`) passa a mostrar chave,
nome, tipo, nº de sessões, marca de canônico, aliases e `resumo`. Os três campos
de perfil saem daqui — e é essa linha que tira o teto deles.

`PROMPT_VERSION_RESOLUCAO` sobe para **`resolucao-5`**.

**`TETO_PERFIL` some** de `tipos.ts`, de `gravarCampo` e do prompt do agente 3.
`TETO_RESUMO = 500` nasce no lugar, cortado no servidor pela mesma razão que o
outro era: regra que só vale na tela não é regra.

**Resumo vazio não é buraco, e não ganha fallback.** Entidade sem resumo entra no
prompt com nome, tipo e aliases, e mais nada. O agente devolve confiança baixa, a
confiança baixa dispara a segunda passada, e a segunda passada carrega o perfil
inteiro — que é **exatamente** a informação que o agente 2 lê hoje. Entre esta
fatia e a 4.12 a segunda passada vai ser a regra, e isso é **comportamento
esperado, não defeito**: a frequência cai sozinha conforme os resumos forem
escritos.

## 4. A confiança, e a segunda passada

**No prompt do agente 2**, `certo: true|false` vira `confianca`, de 0 a 1, com a
instrução dizendo o que o número significa em palavras — 1 é "o átomo casa com o
perfil de um deles e de nenhum outro", 0,5 é "nada no átomo distingue os
candidatos". `motivo` continua exatamente como está.

**O limiar** nasce como constante em `resolucao.ts` e é editável em `/agentes`.
`OverrideDeAgente` (`tipos.ts:677`) ganha `limiar?: number | null` — terceiro
campo ao lado de `prompt_hash` e `modelo`, com a mesma regra: ausente = a base do
git.

**O agente novo** — `desempate`, `PROMPT_VERSION_DESEMPATE = "desempate-1"`, em
`src/lib/desempate.ts`. Entra em `AGENTE_IDS` (`tipos.ts:648`) e no registro de
`agentes.ts`, sem o que `tests/agentes.test.ts` falha — e é para falhar mesmo:
agente que nasce fora do painel roda cobrando e invisível.

- **quando:** `condicional` — só quando alguma menção fica abaixo do limiar;
- **entrada:** uma menção por vez, com o átomo, o `motivo` da primeira passada, e
  o **perfil inteiro** (os três campos, sem teto) só dos candidatos daquela
  menção;
- **saída:** a chave escolhida (ou `NOVA`), `duvida: true|false` e `motivo`;
- **modelo:** `DESEMPATE_MODEL`, padrão igual ao da resolução;
- **rate limit:** `comEsperaDeLimite`, com o mesmo `ate` da janela — é a linha que
  a 4.9 já corrigiu na resolução, e vale igual aqui.

O que ele devolve **é final**. Dúvida na tela só quando ele marcar `duvida: true`
— e aí a revisão pinta o "acho que é X — confirma?" que já existe
(`Revisao.tsx:868`), sem uma linha nova de UI.

**Log:** `[desempate] sessão <id>: N menção(ões) abaixo do limiar` quando dispara,
e nada quando não dispara — o silêncio é a informação de que a primeira passada
bastou.

**Entidade nova** entra pelo mesmo caminho: `NOVA` com confiança abaixo do limiar
vai ao desempate como qualquer outra, e se ele confirmar `NOVA` com `duvida: true`
a revisão marca. Com confiança alta, nasce calada — como hoje.

## 5. `canonico`

Marcado à mão em `/entidades`, um toque, reversível, sem consequência retroativa.

- **no dossiê do extrator e no catálogo do agente 2:** uma palavra na linha do
  candidato dizendo que aquela é a ficha oficial daquela pessoa;
- **em `/entidades`:** marca visual na linha e ordenação na frente;
- **no desempate determinístico:** quando dois candidatos empatam, o canônico
  vence — em código, antes de qualquer chamada.

Nome canônico é **preferência**: `:Pessoa` sem sobrenome funciona igual, e
`/entidades` mostra que falta. Nada bloqueia, nada trava, e nenhuma gravação é
recusada por isso.

## 6. `/entidades`

`src/components/Entidades.tsx` e as rotas sob `/api/entidades`:

- campo `resumo`, editável, com o contador de 500;
- `aliases` editáveis — acrescentar e remover grafia à mão, em qualquer tipo. É o
  que permite ensinar uma grafia **antes** de o STT errar pela primeira vez;
- alternador de `canonico`;
- os três campos de perfil perdem o contador de 300.

Toda escrita dispara `passadaDeVetores` em `waitUntil`, no padrão que as rotas de
entidade já seguem.

## 7. Verificação

`pnpm test` verde em cada passo, e depois **uma sessão real** — que é a única
medida de qualidade que este sistema aceita.

No log, durante a gravação:

| O que aparece | O que quer dizer |
|---|---|
| `[desempate] sessão <id>: N menção(ões) abaixo do limiar` | o caminho novo está vivo |
| nenhuma linha `[desempate]`, com resumos vazios | o limiar está baixo demais, ou a confiança está vindo inflada — é o primeiro número a calibrar |
| `[desempate]` em **toda** menção depois dos resumos escritos | o limiar está alto demais, ou o resumo não está identificando |
| `[grafias] sessão <id>: N grafia(s) viraram alias` | o caminho novo do alias gravou, agora sem nó |

E no grafo, depois de confirmar uma sessão que corrigiu uma grafia:

```cypher
MATCH (e:Entidade {nome_normalizado:'jean'}) RETURN e            // vazio
MATCH (e:Entidade {nome_normalizado:'giampaolo lepore'})
RETURN e.aliases, e.resumo, e.canonico
```

**Três coisas que só olho vê:**

- **o texto do átomo continua soando como eu?** A instrução manda trocar o nome
  próprio e mais nada, e ela não mudou nesta fatia. Se a frase começar a soar como
  o modelo, o culpado é o dossiê novo competindo com o `COM AS MINHAS PALAVRAS` —
  e o conserto é o prompt;
- **a confiança tem alguma relação com estar certo?** Menção que voltou 0,9 e
  estava errada é o sinal de que o número não vale como régua, e aí a fatia
  entregou um limiar decorativo. É a pergunta que decide se o desenho serve;
- **a segunda passada muda de ideia?** Se ela concordar com a primeira em 100% dos
  casos, ela está pagando uma chamada para não fazer nada — e o perfil inteiro não
  é o que faltava.

## Fora de escopo

- **O enriquecimento em lote** — é a 4.12, e entra logo em seguida. Aqui o
  `resumo` nasce e fica vazio até eu escrever à mão ou até a 4.12 rodar;
- **O agente 3 (`perfil-1`)** continua exatamente como é, só sem o corte em 300.
  O que acontece com ele fica para depois da 4.12 rodar;
- **O vocabulário do STT** continua à mão, em `config/vocabulario.txt`;
- **Fusão de duas entidades reais** não muda em nada;
- **Trava de unicidade por pessoa** — a flag é sinal e desempate, e não impede
  nada de nascer.

## O que muda de arquivo

```
db/migrations/009_*.cypher   novo — resumo, aliases, canonico + a conversão
src/lib/tipos.ts             TETO_RESUMO; TETO_PERFIL sai; AGENTE_IDS += desempate;
                             OverrideDeAgente.limiar
src/lib/entidades.ts         listarEntidades (aliases das duas fontes);
                             nomesParaVocabulario (filtro explícito)
src/lib/fusao.ts             registrarGrafia escreve propriedade; docstring do módulo
src/lib/extracao.ts          blocoDasCandidatas; extracao-9
src/lib/resolucao.ts         descrever; confianca; limiar; chama o desempate; resolucao-5
src/lib/desempate.ts         novo — o agente da segunda passada
src/lib/perfil.ts            sem TETO_PERFIL
src/lib/modelos.ts           modeloDesempate / DESEMPATE_MODEL
src/lib/agentes.ts           registra o desempate
src/lib/overrides.ts         o limiar como terceiro campo
src/app/api/entidades/*      resumo, aliases, canonico
src/components/Entidades.tsx os três controles novos
src/components/Agentes.tsx   o campo de limiar
tests/*                      migração de alias, casamento exato, limiar, desempate,
                             e a varredura de agentes.test.ts
ARCHITECTURE.md              §4.6, §4.8, §4.9, §4.14, §8.2, §8.3, §10, §11, §14
CLAUDE.md                    contrato de :Entidade; DESEMPATE_MODEL
PROXIMA-SESSAO.md            seção 6
```

Uma migration com statements — a primeira desde a 006 —, um agente novo, nenhuma
tela nova.

## Ordem de execução

Sete passos, cada um verde no `pnpm test` antes do seguinte, e cada um um commit.

| # | Passo |
|---|---|
| 1 | esta spec |
| 2 | a migration 009, proposta — **aprovada por mim antes de rodar** |
| 3 | `aliases` como propriedade: `entidades.ts`, `fusao.ts`, `nomesParaVocabulario`, os testes |
| 4 | `resumo` e `canonico` no schema, em `/entidades` e nas rotas — ainda sem entrar em prompt nenhum |
| 5 | o dossiê e o catálogo passam a ler resumo/aliases/canônico; `extracao-9` e `resolucao-5`; `TETO_PERFIL` sai |
| 6 | a `confianca`, o limiar em `/agentes`, e o agente `desempate` |
| 7 | `ARCHITECTURE.md`, `CLAUDE.md` e `PROXIMA-SESSAO.md` |

**Do 3 ao 4 o sistema não muda de comportamento** — os campos existem e ninguém
os lê. É o ponto de retorno barato: se o passo 5 piorar a lista, o suspeito é o
que os agentes leem, e não o que o grafo guarda.

**O passo 2 antes do 3 é obrigatório**, e não por organização: o passo 3 lê
`e.aliases` de nós onde a propriedade ainda não existe. `coalesce` cobre, mas o
grafo estaria dizendo duas verdades ao mesmo tempo.

## Limites que esta fatia cria (para o §14)

- **Entre a 4.11 e a 4.12 quase toda menção passa pela segunda passada**, porque
  os resumos nascem vazios. São ~2 chamadas de modelo por janela em vez de 1,
  espalhadas pelos 15 minutos. É o preço declarado de separar as fatias, e ele
  acaba sozinho.
- **A confiança é auto-relatada.** O modelo diz o quanto confia; ninguém verifica.
  Um modelo que devolva 0,9 para tudo torna o limiar decorativo, e o sinal disso é
  a linha `[desempate]` sumir do log. Não há calibração automática — quem olha sou
  eu.
- **O casamento exato passa a depender do catálogo caber na memória** de uma
  função. Hoje são poucas entidades e a consulta já carregava tudo; o dia em que
  isso doer, a saída é um índice full-text sobre `aliases` — recusado agora por
  cota do Aura Free, e escrito aqui para quando a pergunta voltar.
- **A migration 009 apaga nós.** É a primeira migration deste projeto que apaga
  alguma coisa. O que ela apaga não tem átomo, não tem perfil e não tem label de
  tipo — mas um `DISTINTA_DE` que aponte para um nó de grafia vai junto no
  `DETACH DELETE`, e essa recusa minha se perde.
- **Alias não distingue mais "grafia que o STT errou" de "nome antigo depois de um
  renome"**: as duas viram item do mesmo array. `renomear` já produzia as duas com
  a mesma forma; agora elas ficam indistinguíveis também na leitura.
- **O `resumo` corta em 500 no servidor.** Texto colado maior que isso perde o fim
  sem aviso, como o perfil fazia em 300.
