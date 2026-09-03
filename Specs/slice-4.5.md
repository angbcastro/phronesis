# Slice 4.5 — O grafo ganha vetor

**Objetivo:** átomo e entidade passam a carregar um vetor, e a resolução de
identidade ganha uma camada de candidato que enxerga **significado**, não
grafia. É a primeira vez que este sistema compara duas coisas sem passar por
letra.

**Pronto quando:** estes dois átomos, de sessões diferentes e sem uma palavra
rara em comum, saem como vizinhos um do outro numa consulta ao índice —

```
mtgo3kaf…-0  "…o relacionamento com a Isinha era construído em grande parte sobre
              a minha necessidade de me sentir útil… essa base era muito insegurança…"
mth9xtoo…-3  "…começar o relacionamento tentando ter certeza dele com base nos
              problemas que eu tinha não era uma base sólida…"
```

— e uma menção cuja entidade nenhuma camada de string alcança chega à revisão
com o candidato certo preenchido e com o **porquê** visível na tela.

Se aquele par não sair vizinho, a camada não presta, e o que se ajusta é a fonte
do texto embutido. Julgamento meu, à mão, como toda avaliação de qualidade aqui.

## Por que agora — e o que isto não é

**Não é economia de token.** O gasto dominante é o `extracao-5`, que manda a
transcrição inteira e catálogo nenhum. Embedding não corta um token dele.

**É que a deduplicação de átomo não tem outro mecanismo.** Cinco sessões por
semana a 15 átomos dão ~3.900 átomos por ano, ou ~7,6 milhões de pares. Não é
caro: é impossível. Seleção de candidato por vetor é a única que existe, e a
slice 5 vai precisar dela pronta.

**E não há urgência de dado.** O vetor é derivável do texto a qualquer momento, e
refazer 4.000 deles é uma passada de `embedMany` que custa menos de um centavo.
Nenhuma porta se fecha por adiar — o que esta slice compra é conveniência e
aprendizado, e vale dizer isso em voz alta para não inventar urgência depois.

**O escopo é o vetor, os índices e UM consumidor.** Sem busca, sem tela de
exploração, sem deduplicação de átomo. Tudo isso é slice 5, e depende de
material acumulado que ainda não existe.

## O que já foi medido

Contra a instância real (`0adada47`, Neo4j 5.27-aura), em 2026-09-02:

| Fato | Como |
|---|---|
| O tier Free **deixa criar índice vetorial** | `CREATE VECTOR INDEX` de 1536 dimensões e cosseno aceito; `ONLINE` em menos de 500 ms; `db.index.vector.queryNodes` devolveu três vizinhos com score 1 / 0,998 / 0,500. Sondagem em label e índice próprios, desfeita: 12 índices antes, 12 depois |
| A cota do Free **não é medida em bytes** | O teto publicado é 200 mil nós e 400 mil arestas. Embedding é propriedade em nó que já existe — não cria nó nem aresta. Com 4.000 átomos o grafo vai a ~4.050 nós, 2% do teto |
| Lista de float como parâmetro funciona | é o caminho já usado por `inicios_s`/`fins_s` (migration 003) |
| `embed`, `embedMany` e `cosineSimilarity` existem no `ai@7.0.77` | zero dependência nova, zero chave nova |
| A configuração padrão do índice | `quantization.type: SCALAR`, `hnsw.m: 16`, `ef_construction: 100`, `default_search_expansion_factor: 1.5` |

**O que ainda não está medido, e é o primeiro passo da construção:** que o
Gateway sirva um id de modelo de embedding concreto. O que foi verificado é a
**porta** — que `embed`/`embedMany` aceitam id em string e por isso saem pelo
Gateway (regra 8) —, não o catálogo. Antes de escrever `embedding.ts`, uma
chamada de uma frase confirma o id e a dimensão que ele devolve.

## O que vira vetor

### Átomo: só `a.texto`

Nada de tipo, de entidade ou de sessão. As três já são estrutura no grafo, e a
divisão é essa: **o corte estrutural é do grafo, o semântico é do vetor.**
Enfiar o tipo no texto embutido faria dois APRENDIZADO parecerem próximos por
serem APRENDIZADO, que é exatamente o sinal que o grafo já dá de graça e melhor.

### Entidade: uma string canônica

`nome`, `tipo`, `aliases` e os três campos de perfil, montados numa string
canônica, com campo vazio **omitido** (e não presente e em branco — string vazia
no meio do texto é ruído com posição).

O nó inteiro **não** entra. `id`, `nome_normalizado` e `chaves` são duplicação ou
ruído. E `sessoes` e `atomos` são contagens que mudam a cada confirmar sem que o
significado da entidade mude — entrariam no hash e forçariam reembutir o grafo
inteiro toda sessão, de graça.

### Os átomos da entidade ficam de fora

Isto é decisão, não esquecimento. Com átomos na fonte do vetor da entidade, um
átomo atribuído errado vira evidência para a próxima atribuição — dissolvido num
vetor que ninguém audita e do qual não dá para tirá-lo depois.

É a mesma realimentação que a slice 4 fechou ao decidir que **o agente 3 nunca
escreve**. A diferença entre as duas realimentações e a da camada 3b abaixo é
visibilidade, e é ela que decide o que entra.

## O grafo depois desta slice

```
(:Atomo    { …, embedding: [1536 floats], embedding_modelo })
(:Entidade { …, embedding: [1536 floats], embedding_modelo, embedding_fonte })
```

`embedding_fonte` é o hash da string canônica. É o que torna o refresh idempotente
e dispensa gancho nas cinco rotas que mexem em entidade: hash bate, está em dia;
não bate, reembute. O átomo não precisa dele — texto de átomo confirmado não muda
(deleção é soft, regra 6).

`embedding_modelo` é **acréscimo ao plano aprovado**, e o motivo é um modo de
falha silencioso: vetores de dois modelos diferentes no mesmo índice não dão
erro, dão vizinhança errada. Sem o campo não há como saber quais nós precisam
voltar para a fila quando `EMBEDDING_MODEL` mudar. Se o modelo novo tiver
dimensão diferente, o índice também precisa ser derrubado e recriado — por
migration, como tudo.

## As três camadas de candidato

`candidatosDe()` (`src/lib/resolucao.ts`) passa a ter três camadas **aditivas**,
nunca substitutivas. Nenhuma camada existente muda de comportamento:

| Camada | Sinal | Pega o caso |
|---|---|---|
| 1. exato por chave | inalterada | grafia conhecida, alias inclusive |
| 2. string (`proximidade`) | inalterada | homófono: "Rafa" × "Raffa" × "Rapha" |
| 3a. perfil parecido | átomo × `entidade_embedding` | entidade **com perfil e sem átomo** — o Rapha no dia seguinte ao passo zero |
| 3b. vizinhos votam | átomo × `atomo_embedding`, voto por `:SOBRE`/`:MENCIONA` | entidade **com átomos e sem perfil** — todo o grafo de hoje |

As duas camadas semânticas cobrem buracos **opostos**, e é por isso que as duas
ficam. Uma entidade recém-criada sem perfil e sem átomo continua invisível para
ambas — só a string a acha, e é por isso que o passo zero manda escrever o perfil
no mesmo gesto de criar.

### A 3b devolve o porquê

A 3b consulta os vizinhos do átomo novo e conta votos por entidade, devolvendo
junto os **ids dos átomos que elegeram cada candidato**. É o que a torna
auditável: a revisão pode dizer *"sugeri o Raffa porque isto se parece com o que
você disse em 12/ago"*, com o trecho à mão.

O loop de realimentação existe aqui também — a 3b herda atribuição passada. A
diferença que a faz aceitável é ser **um voto entre `k`, com o id na tela**:
visível e corrigível, que é exatamente o que faltava para aceitá-lo. Sem o
`porque`, esta camada não entra.

### Teto e piso são obrigatórios

`TOP_K = 3` sobre a **união** das quatro camadas, e piso de score por camada.

Sem os dois, todo átomo ganha candidato, `decidir()` cai sempre em `julgar`, o
agente 2 é chamado em toda sessão e o **critério 5 da slice 4 morre** — aquele
que diz que sessão sem ambiguidade não paga nada. Uma camada semântica sem piso
é uma camada que sempre acha alguém.

Os pisos de 3a e 3b se calibram **separado**, e o mesmo número não significa a
mesma coisa nas duas: 3a é assimétrica (texto de átomo contra string de perfil),
3b é simétrica (átomo contra átomo). Igualá-los seria coincidência, não
economia.

### `resolucao-2`

`PROMPT_VERSION_RESOLUCAO` sobe para `resolucao-2`. O conjunto de candidatos que
o agente 2 recebe muda, e isso é saída diferente (regra 7). O texto do prompt
pode nem mudar — a versão acompanha a **entrada**, não só a redação.

## Neo4j — migration 006

Proposta e aprovada antes de rodar (`CLAUDE.md`). Diferente da 003 e da 005, esta
**tem statements de verdade** — índice se declara:

```cypher
CREATE VECTOR INDEX atomo_embedding IF NOT EXISTS
FOR (a:Atomo) ON (a.embedding)
OPTIONS { indexConfig: { `vector.dimensions`: 1536,
                         `vector.similarity_function`: 'cosine' } };

CREATE VECTOR INDEX entidade_embedding IF NOT EXISTS
FOR (e:Entidade) ON (e.embedding)
OPTIONS { indexConfig: { `vector.dimensions`: 1536,
                         `vector.similarity_function`: 'cosine' } };
```

`IF NOT EXISTS` mantém a migration reaplicável, como todas (`scripts/migrate.ts`
não tem tabela de controle). O resto da configuração fica no padrão medido acima
— explicitar `hnsw.m` e `ef_construction` seria fixar número que não foi
calibrado contra nada.

**A dimensão é a única coisa aqui que amarra:** trocar para um modelo de outra
dimensão exige `DROP` e recriar, por migration nova.

## Módulos

| Onde | O quê |
|---|---|
| `src/lib/embedding.ts` (novo) | a porta: `embutir(texto)`, `embutirVarios(textos[])`, a montagem da string canônica da entidade e o hash dela. Nenhum Cypher aqui |
| `src/lib/modelos.ts` | ganha `modeloEmbedding()`, no formato das outras — string `provedor/modelo`, `EMBEDDING_MODEL` troca sem tocar em código |
| `src/lib/resolucao.ts` | `candidatosDe()` ganha 3a e 3b; `Candidatos` ganha os campos novos e o `porque` |
| `src/lib/atomos.ts` | o confirmar embute os átomos que grava |
| `src/lib/entidades.ts` | `garantirEmbeddings()`: compara hash, reembute o que saiu de dia |

`embedding.ts` não fala com o Neo4j e `resolucao.ts` não chama o Gateway para
embutir: a mesma separação que já existe entre `duplicatas.ts` (string pura,
testável sem rede) e quem a usa.

## Rotas

| Rota | Faz |
|---|---|
| `POST /api/atomos/embutir` | embute os átomos que ainda não têm vetor, em lote por `embedMany`. É o retrofill dos que já estão no grafo, e o retry de qualquer falha |
| `POST /api/entidades/embutir` | mesma coisa para entidades, comparando `embedding_fonte` |
| `GET /api/sessoes/:id/extracao` | inalterada no contrato; a proposta passa a trazer o `porque` dentro das alternativas |

Nada de rota de busca. O consumidor desta slice é a resolução, que roda dentro do
`waitUntil` da extração como já rodava.

## Ambiente

```
EMBEDDING_MODEL   opcional; um id de embedding servido pelo Gateway, 1536 dimensões
```

Pelo `src/lib/modelos.ts`, string `provedor/modelo`, pelo Gateway (regra 8).
`tests/gateway.test.ts` continua sendo a guarda, e não se afrouxa para isto.

## Idempotência

| Trava | Onde |
|---|---|
| `embedding_fonte` bate | entidade em dia não é reembutida — e por isso não há gancho a esquecer em nenhuma das rotas de entidade |
| `embedding IS NULL` | `POST /api/atomos/embutir` só pega quem falta; rodar duas vezes não gasta duas vezes |
| `MERGE` do átomo por `<sessao_id>-<índice>` | inalterado; confirmar duas vezes não duplica nem o átomo nem o vetor |
| `CREATE … IF NOT EXISTS` | migration reaplicável |
| embutir falhou | o átomo entra no grafo **sem** vetor, e a rota de retrofill o alcança depois. Vetor é derivável; nunca é motivo para derrubar um confirmar |

Essa última linha é a regra de precedência desta slice inteira: **nada no
caminho do embedding pode impedir uma gravação de acontecer.**

## Ordem de construção

Cada passo deixa o sistema funcionando, e os dois primeiros não são teclado:

| # | O quê | Por quê aqui |
|---|---|---|
| 0 | **Passo zero** em `/entidades`: renomear `Raffael do Vale` → `Raffa`, criar o `Rapha`, escrever o perfil dos dois | Irreversível se pulado — conflacionar dois nós não tem desfazer. É o que liga a camada 3a |
| 1 | Esvaziar ou descartar a fila de revisão, cronometrando uma | A fila acumulando é o modo de morte da visão §8, e o "menos de 60 s" segue sem medição |
| 2 | Confirmar o id de embedding contra o Gateway | Uma chamada de uma frase. Decide a dimensão da migration |
| 3 | `modeloEmbedding()` + `embedding.ts` + migration 006 | A porta e a estrutura, sem consumidor |
| 4 | Embutir no confirmar + `POST /api/atomos/embutir`; rodar nos 17 átomos de hoje | Primeiro material real |
| 5 | **Olhar a vizinhança à mão** — o par do "Pronto quando" | Melhor descobrir que não presta antes de a resolução depender disso |
| 6 | `garantirEmbeddings()` das entidades | Só vale alguma coisa depois do passo 0 |
| 7 | As três camadas em `candidatosDe`, `resolucao-2`, o `porque` na revisão | O consumidor, por último |

**Parar depois do 5 já entrega o vetor e a verificação.** Do 6 em diante é a
resolução passando a usá-lo.

## Critérios de aceite

1. `pnpm migrate` cria os dois índices vetoriais, e rodar de novo é no-op.
2. Os átomos que já estão no grafo ganham vetor por uma chamada de rota, sem
   reextração e sem tocar no texto deles.
3. O par de APRENDIZADO do "Pronto quando" sai como vizinho um do outro, à
   frente de átomos de assunto não relacionado. Julgamento meu, olhando a lista.
4. Uma entidade com perfil escrito e **zero** átomo aparece como candidata de um
   átomo que fale do assunto dela (camada 3a).
5. Uma entidade com átomos e **sem** perfil aparece como candidata pelos vizinhos
   (3b), e a revisão mostra **quais** átomos a elegeram.
6. Sessão em que nenhuma menção é ambígua **continua não chamando** o agente 2 —
   o critério 5 da slice 4 sobrevive ao teto e aos pisos.
7. Confirmar uma sessão duas vezes não duplica átomo nem reembute o que já tem
   vetor.
8. Editar o perfil de uma entidade faz o vetor dela sair de dia, e a rota de
   embutir o refaz; não editar não reembute nada.
9. Falha do Gateway no meio de um confirmar **não impede** o átomo de ser gravado.
10. `tests/gateway.test.ts` passa sem ser afrouxado: nenhum pacote de provedor,
    nenhuma chave nova, id de modelo em string.

## Fora de escopo

- **Deduplicação de átomo.** É o que esta slice torna possível, e é slice 5.
- **Busca, tela Perguntar, `:Foco`, visualização de grafo.**
- **Reranking, ou qualquer segundo modelo no caminho do candidato.** O agente 2
  já é o juiz; um reranker seria um juiz antes do juiz.
- **Embutir transcrição, sessão ou trecho.** Só átomo e entidade.
- **Vetor como critério de fusão automática de entidade.** A fusão continua
  passando por mim (slice 3), e semelhança semântica é evidência ruim para uma
  operação que não tem desfazer.

## Limites conhecidos que esta slice herda ou cria

- **`db.index.vector.queryNodes` está deprecado a partir do Neo4j 2026.04**, em
  favor da cláusula `SEARCH`. A instância é 5.27 e o procedimento funciona;
  quando a Aura subir, é uma linha a trocar.
- **1536 floats por átomo são ~12 KB** de propriedade; 4.000 átomos, ~48 MB. Não
  há cota em bytes no Free contra a qual comparar isso, e o vetor do índice,
  quantizado em `SCALAR`, fica em torno de 6 MB. Se um dia apertar, o botão é a
  dimensão do vetor.
- **A camada 3b herda atribuição passada.** Mitigado pelo `porque` na tela, não
  eliminado. Um erro de atribuição continua podendo sugerir o próximo.
- **Entidade nova, sem perfil e sem átomo, é invisível às duas camadas
  semânticas.** É estado transitório por construção — o passo zero manda escrever
  o perfil junto de criar — mas nada no código obriga.

## Depois desta slice

A slice 5 abre o que sempre dependeu de material acumulado: as 2-4 perguntas do
ritual, as relações entre átomos (`:ATUALIZA`, `:CONTRADIZ`, `:CONFIRMA`) e a
deduplicação de átomo. As três precisam encontrar o que já foi dito sem varrer o
grafo inteiro, e é isso que o vetor entrega.
