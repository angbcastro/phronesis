# Slice 3 — Higiene do grafo

**Objetivo:** o grafo passa a cuidar do próprio nome. As entidades que já estão
nele alimentam o vocabulário do STT, e as que entraram duas vezes com grafias
diferentes viram uma só, com a minha confirmação.

**Pronto quando:** eu falo um nome próprio que já está no grafo e ele sai
grafado certo na transcrição; e quando eu abro a tela de entidades, vejo que
"Exxmed" e "Exx Med" são a mesma coisa, fundo as duas num toque, e a sessão
seguinte que citar qualquer uma das grafias cai no nó certo.

## Por que estas duas coisas são uma slice só

Elas se alimentam. Nome que o STT grafa certo não vira variante para deduplicar
depois; entidade deduplicada devolve uma lista de nomes limpa para o STT. É um
laço, e cortar pela metade deixa qualquer uma das duas girando em falso.

As duas atacam formas de morte declaradas na visão §8 — "grafo apodrecido" e
"transcrição ruim" — e nenhuma delas depende de histórico acumulado, ao
contrário das perguntas do ritual e das relações entre átomos.

## Fora de escopo

- **As 2-4 perguntas do ritual** e **`:ATUALIZA` / `:CONTRADIZ` / `:CONFIRMA`
  entre átomos.** Continuam esperando material. Com duas sessões no banco, tanto
  a pergunta quanto a contradição saem genéricas, e pergunta genérica é forma de
  morte.
- **Busca, tela Perguntar, `:Foco`, visualização de grafo.** A tela de entidades
  desta slice é uma lista de manutenção, não uma interface de exploração — o
  grafo é consequência, não interface (visão §5.5).
- **Deduplicação de átomo.** Dizer a mesma coisa em duas sessões cria dois
  átomos. É outro problema, precisa de mais material, e a semântica de "mesmo
  átomo" é bem mais escorregadia que a de "mesma entidade".
- **Desfazer uma fusão.** Fundir move arestas; desfazer exige saber quais eram
  de quem. Fora desta slice — o que a protege é a fusão nunca ser automática.
- **Dividir uma entidade** que sempre foi duas coisas.

## Como a qualidade é avaliada

Como na slice 2: à mão, por mim, sem gabarito rotulado, sem fixture, sem
percentual. Mas aqui há uma diferença que vale declarar — **a mecânica é
verificável de verdade**, ao contrário da qualidade de extração. Uma fusão ou
move as arestas ou não move; o alias ou resolve ou não resolve; o vocabulário ou
chega ao modelo ou não chega. Isso se confere por Cypher e por uma transcrição.

O que continua sendo julgamento meu é a **qualidade da proposta**: se o que ele
oferece para fundir são de fato a mesma coisa. Se ele propõe bobagem, o que se
ajusta é o prompt.

---

## Critério zero: o vocabulário chega ao modelo?

**Antes de qualquer código desta slice.** `stt.ts` monta hoje:

```ts
providerOptions: { [provedorDe(modelo)]: { keyterm: termos } }
```

A chave do mapa segue o provedor, mas **o nome da opção não**. `keyterm` é
vocabulário de xAI/Deepgram; com o padrão em `google/gemini-3.5-transcribe` o
que sai é `{ google: { keyterm: [...] } }`. Ou o provedor ignora em silêncio — e
o vocabulário nunca teve efeito nenhum — ou recusa a opção desconhecida e
derruba a transcrição.

Gerar a lista do grafo não vale nada se ela não chega ao modelo. Então a slice
começa por medir isso: `pnpm smoke` já tem a sonda, e o teste real é uma frase
com um nome próprio dentro e fora da lista.

**A correção que a slice assume:** o nome e o formato da opção viram um mapa por
provedor, ao lado do endereçamento em `src/lib/modelos.ts`. Provedor que não
estiver no mapa **não recebe opção nenhuma** — silêncio é o padrão seguro, e
mandar uma opção que o provedor não conhece é como se derruba transcrição.

Se o provedor novo não tiver nada equivalente, a metade A muda de forma: em vez
de injetar antes, corrigir depois — casar a transcrição contra a lista de
entidades e trocar a grafia. É decisão a tomar com a medida na mão, não antes.

---

## Metade A — vocabulário gerado das entidades

Hoje `src/lib/vocabulario.ts` lê `config/vocabulario.txt`, corta em 100 termos de
até 50 caracteres e guarda em cache de processo, para sempre.

### O que muda

**União, não substituição.** O arquivo continua e vence as primeiras vagas: ele
tem coisa que não é entidade (`Phronesis`) e nome de cliente que eu ainda não
falei uma vez sequer — e entidade só existe depois que eu falo. O grafo completa
o resto. O arquivo deixa de ser a lista e vira o override manual.

**Quem ganha as 100 vagas.** Por número de sessões em que a entidade aparece —
`buscarConhecidas` já calcula `count(DISTINCT s)`. O nome que eu falo toda
semana é o que o STT mais precisa acertar. Desempate determinístico por nome,
para a lista não dançar entre duas chamadas.

**O que não entra:** `eu`, os pronomes de `texto.ts`, e nome que seja palavra
comum do português. Keyterm de palavra comum enviesa o STT em vez de ajudar —
uma entidade chamada "Casa" faria o modelo ouvir "casa" em todo lugar.

**Cache com TTL, não eterno.** A lista muda a cada confirmar, e o cache atual
vive o processo inteiro. Sem cache seria uma consulta ao Neo4j por bloco de 30 s.
A slice declara a defasagem aceita: um nome confirmado agora leva alguns minutos
para chegar ao STT, e isso é irrelevante — ele já foi falado.

**Falha de Neo4j não derruba transcrição.** A instância Aura Free pausa sozinha,
e o sintoma é `ENOTFOUND`. Sem grafo, cai no arquivo e segue em frente. O
vocabulário é otimização; o caminho do áudio nunca pode depender dele.

---

## Metade B — deduplicação semântica de entidade

Hoje o casamento é exato por `nome_normalizado` (`normalizarNome`, em
`texto.ts`). "Exxmed" e "Exx Med" normalizam para chaves diferentes e viram dois
nós. A constraint única impede duplicata da *mesma* grafia, não de grafias
parecidas.

### A tela: `/entidades`

Uma lista do que está no grafo: nome, tipo, em quantas sessões apareceu. É
também, de graça, a resposta para "o que foi que entrou lá dentro" — que hoje só
se responde rodando Cypher por fora.

Não é painel novo na revisão, por dois motivos: a revisão só enxerga as
entidades da sessão atual, e o orçamento dela é 60 s — "revisão longa" é forma
de morte (visão §8). Manutenção de grafo é trabalho de outro momento, e é
trabalho que eu faço quando quiser, ou nunca.

### Quem propõe, quem decide

Duas camadas propõem. **Eu decido, sempre.**

1. **Determinística, de graça.** Similaridade sobre a chave normalizada — colar
   os espaços já resolve "exxmed"/"exx med". Roda sobre a lista inteira sem
   custo nenhum.
2. **O modelo julga a lista curta**, pelo Gateway (regra 8), com os textos dos
   átomos de cada lado como contexto: "Isinha" e "Isabela" aparecem nos mesmos
   assuntos, com os mesmos verbos? Sai com `prompt_version` e `modelo`, como
   todo o resto.

**Nunca fusão automática.** "Marina" e "Mariana" são distância 1 e são duas
pessoas. Fundir duas pessoas diferentes é irreversível num sistema que não
desfaz, e o custo do erro é assimétrico: deixar duas passando é grafo um pouco
sujo, fundir errado é grafo mentindo.

**A camada 2 só roda quando eu peço.** Um botão "procurar duplicatas", não uma
chamada a cada vez que a tela abre — senão a manutenção vira uma conta mensal
por uma pergunta que quase sempre tem a mesma resposta.

**Recusar tem que grudar.** Se eu disse que Marina e Mariana são pessoas
diferentes, ele não pode perguntar de novo toda vez. A recusa vira aresta:
`(:Entidade)-[:DISTINTA_DE]->(:Entidade)`, e o passo de proposta filtra os pares
já marcados. Ignorar é saída válida (visão §5.3), mas ignorar a mesma pergunta
doze vezes não é.

### Fundir é criar alias, não apagar

Deleção é soft (regra 6), e aqui isso cai bem melhor do que como concessão:

- o nó perdedor **fica**, com `status = 'fundida'` e uma aresta `:FUNDIDA_EM`
  para o vencedor;
- as arestas `:SOBRE` e `:MENCIONA` migram do perdedor para o vencedor, por
  `MERGE` — átomo que citava as duas grafias não fica com aresta dobrada;
- como o perdedor mantém o `nome_normalizado`, que é constraint única, **a
  grafia morta nunca renasce como nó novo**. Dita outra vez numa sessão futura,
  ela acha o alias e segue até o vencedor.

Ou seja: a fusão é o mecanismo de alias, de graça. Não é um efeito colateral, é
o desenho.

**Quem vence é escolha minha**, na tela. O padrão oferecido é o de mais sessões;
o nome do vencedor é o que vira exibição e vira keyterm.

### O que passa a atravessar o alias

| Onde | O que muda |
|---|---|
| `buscarConhecidas` (`entidades.ts`) | segue `:FUNDIDA_EM` e devolve o vencedor — id, nome e labels dele |
| `resolver` | uma candidata que casa com um alias volta como **conhecida**, com o nome do vencedor |
| `gravarAtomos` (`atomos.ts`) | ao ligar `:SOBRE`/`:MENCIONA`, atravessa o alias — a aresta nunca aponta para um nó fundido |
| vocabulário (metade A) | nó com `status = 'fundida'` não entra na lista |

A trava do `gravarAtomos` não é redundante com a da tela: a regra não pode
depender da UI ter sido usada — é a mesma razão pela qual o confirmar já recusa
pronome no servidor.

### Renomear entra junto

É a mesma tela e o mesmo caminho de escrita, e fecha um limite conhecido: "meu
pai" e "minha mãe" viraram nó com esse nome, e renomear uma entidade que já está
no grafo criaria um segundo nó — que é exatamente o que a máquina de alias
resolve. Renomear é fundir consigo mesma sob outro nome: o nó ganha o nome novo,
e a grafia velha fica como alias apontando para ele.

## Neo4j — migration 004

Proposta e aprovada por mim antes de rodar (`CLAUDE.md`).

```
(:Entidade { id, nome, nome_normalizado, criado_em, status })
    status ∈ 'ativa' | 'fundida'        // ausente = 'ativa', para os nós de hoje

(:Entidade)-[:FUNDIDA_EM]->(:Entidade)  // do alias para o vencedor
(:Entidade)-[:DISTINTA_DE]->(:Entidade) // recusa minha; não perguntar de novo
```

Índice em `:Entidade(status)`. Tipo de relação não se declara em Neo4j — os dois
ficam em comentário no topo, como a 002 já faz com `:GEROU` e `:SOBRE`.

As duas entidades que já estão no grafo não têm `status`. Ou a migration as
preenche com `'ativa'`, ou o código trata ausência como ativa — decidir na
implementação; a segunda é mais barata e sobrevive a nó criado por código
antigo.

## Rotas

| Rota | Faz |
|---|---|
| `GET /api/entidades` | a lista do grafo: nome, tipo, sessões, status |
| `POST /api/entidades/duplicatas` | roda as duas camadas e devolve os pares candidatos; **não escreve nada** |
| `POST /api/entidades/fundir` | `{ vencedora, perdedora }` — migra arestas, marca alias |
| `POST /api/entidades/distintas` | `{ a, b }` — grava a recusa |
| `POST /api/entidades/renomear` | `{ id, nome }` — nome novo, grafia velha vira alias |

Todas com `runtime = "nodejs"`, como o resto.

## Idempotência

| Trava | Onde |
|---|---|
| `nome_normalizado` único | continua sendo a trava contra duplicata da mesma grafia |
| `status = 'fundida'` na cláusula `WHERE` | fundir duas vezes não refaz nada; nó já fundido não é oferecido de novo |
| `MERGE` na migração de aresta | átomo que citava as duas grafias fica com uma aresta, não duas |
| `:DISTINTA_DE` | a recusa não volta a ser proposta |

## Critérios de aceite

1. O vocabulário que chega ao STT contém nomes que **nunca foram escritos à
   mão** — eles vieram das entidades do grafo.
2. Com o Neo4j fora do ar, a transcrição continua funcionando, com a lista do
   arquivo. Vocabulário é otimização, não dependência.
3. `/entidades` mostra o que está no grafo. Eu reconheço a lista.
4. Pedir duplicatas devolve pares plausíveis, e nenhuma fusão acontece sem eu
   confirmar.
5. Fundir "Exx Med" em "Exxmed" deixa **um** nó ativo, e todos os átomos dos
   dois lados apontam para ele. `MATCH (a:Atomo)-[:SOBRE]->(e:Entidade)` não
   devolve nó fundido nenhum.
6. A sessão seguinte que disser "Exx Med" resolve para "Exxmed" na revisão,
   marcada como conhecida — a grafia morta não cria nó novo.
7. Recusar um par uma vez faz ele não ser proposto de novo.
8. Renomear "meu pai" para o nome dele mantém os átomos, e "meu pai" dito outra
   vez cai no mesmo nó.
9. Fundir duas vezes não duplica nem quebra: nada muda na segunda.
10. Nenhum átomo é apagado, e nenhuma entidade é apagada — fundida é `status`,
    não `DELETE` (regra 6).

## Depois desta slice

Com o grafo limpo e os nomes certos, a slice 4 abre o que depende de material
acumulado: as perguntas do ritual e as relações entre átomos — `:ATUALIZA`,
`:CONTRADIZ`, `:CONFIRMA`. E aí a tela Perguntar, que é a terceira das três que
importam e a única que ainda não existe.
