# Checkpoint — 2026-09-02 (sessão 9)

Documento de trabalho, não de arquitetura. **A slice 4.5 está planejada,
aprovada e verificada nos dois pontos que podiam derrubá-la — e continua com
zero linha escrita.** Apagar quando a slice 5 começar.

Contexto permanente está em `CLAUDE.md` (regras), `ARCHITECTURE.md` (como o
sistema funciona hoje) e `Specs/slice-4.md` (o que a slice 4 tem que ser). Este
arquivo só diz o que fazer a seguir.

---

## 0. O que esta sessão fez

**Commitado (`548346f`): o retry de conexão.** Os três `500` da revisão não eram
defeito do sistema — `UND_ERR_CONNECT_TIMEOUT` do R2 e do Aura, link instável,
pedido que nunca chegou a sair. `src/lib/rede.ts` decide o retry por essa
pergunta só, e por isso ele vale igual para escrita (regra 4). De quebra: as três
buscas de `/extracao` foram para `Promise.all` — em série a tela custava a soma
de três idas à rede —, e `/api/sessoes` e `/extracao` agora devolvem 502 por
`erroDeInfra` em vez de 500 com stack de undici. 444 testes, typecheck limpo,
`pnpm smoke` de pé contra Neo4j, R2 e Gateway reais. `ARCHITECTURE.md` §5.2 nova,
mais mapa de módulos, §10 e §13.

**Medido, sem uma linha de código — os dois passos que podiam invalidar a 4.5:**

- **Item 2 da ordem de execução, feito.** O tier Free deixa criar índice
  vetorial: `CREATE` aceito, `ONLINE` em menos de 500 ms, `queryNodes`
  devolvendo vizinho com score. Detalhe e configuração padrão na seção 3.
- **A cota do Aura Free, conferida** — e o medo era da métrica errada. O teto é
  em nós e arestas, não em bytes, e embedding não cria nem um nem outro. Seção 6.

**Da sessão 8 (`07b6768`), para quem chega agora:** os três controles da home
viraram a engrenagem da `Gestao` com gaveta lateral; duas fontes por natureza de
tela (Nunito no ritual, Inter na gestão, regra por rota em
`src/lib/tipografia.ts`); o círculo cresceu 20%.

**O que mudou no grafo, e não foi por mão de agente:** uma sessão nova de
2026-09-02 (338 s) foi gravada e confirmada, com 6 átomos — daí as 19 sessões e
os 17 átomos abaixo. **A fila de revisão não andou:** as 7 que esperavam
continuam esperando, e o "8" da sessão 8 era erro de contagem — a tabela sempre
listou 7. A sondagem do índice vetorial rodou em label e índice próprios e foi
desfeita: 12 índices antes, 12 depois, nada tocou `:Atomo` nem `:Entidade`. As
contagens abaixo são o que o banco devolveu em 2026-09-02.

---

## 1. O passo zero continua pela metade — e agora bloqueia mais coisa

O grafo hoje: **5 entidades, 17 átomos, 0 arestas `:PERFILA`.** Nenhuma das cinco
tem perfil — `contexto`, `pode_ajudar_com` e `fizemos_juntos` sequer existem como
propriedade no banco.

```
eu                   :Pessoa   sem perfil
Isinha               :Pessoa   sem perfil
Max Peters           :Pessoa   sem perfil
Giampaolo Lepore     :Pessoa   sem perfil
Raffael do Vale      :Pessoa   sem perfil   ← semeado, nunca falado
```

Falta o Rapha, faltam os perfis, e o nome semeado **não casa com a forma que eu
falo** — medido rodando a camada de string de verdade:

```
"Rafa"    x "Raffael do Vale" → NADA (vira entidade nova)
"Raffa"   x "Raffael do Vale" → NADA
"Rapha"   x "Raffael do Vale" → NADA
"Raffael" x "Raffael do Vale" → 0.8, compartilham "raffael"
```

`proximidade()` casa palavra inteira ou distância de até 2 letras; "Rafa" e
"Raffael" não são nem uma coisa nem outra. Então dizer "Rafa" numa sessão não
encontra o nó: não há candidato, o agente 2 **não é chamado**, e nasce entidade
nova solta. Pior — com os dois semeados por nome completo, uma sessão que fale dos
dois como "Rafa" cria **um nó só, com os átomos dos dois misturados**, que é
exatamente o que não tem desfazer.

As formas curtas casam bem entre si: `"Rafa" x "Raffa" → 0.8`,
`"Rafa" x "Rapha" → 0.6`, `"Raffa" x "Rapha" → 0.6`.

**O conserto:** renomear para a forma falada (`Raffa` ou `Raffa do Vale` — as duas
funcionam), criar o `Rapha`, e escrever o perfil dos dois. Renomear deixa a grafia
velha como alias, sem perder nada.

**O que mudou desde a sessão 7:** isto deixou de bloquear só a slice 4. A camada
3a da slice 4.5 (candidato por perfil parecido) também nasce inerte sem perfil
escrito — ver seção 3.

---

## 2. Estado das sessões

**19 sessões. 4 confirmadas, 7 esperando revisão, 4 presas em `gravando`, 4
transcritas e nunca extraídas.**

| id | estado | o que fazer |
|---|---|---|
| `mtk2taal094p1g405c57` | **confirmada** | 338 s, 6 átomos — 02/09, a mais recente |
| `mtj6hfwa28604i492e6t` | em_revisao | 7 s, de 01/09 21:27 |
| `mtiwiaoz3p6527440d45` | em_revisao | |
| `mtiwgick3s09470t322n` | em_revisao | |
| `mtiwef9u554000456b5f` | **confirmada** | 3 átomos — a mais recente pelo caminho da slice 4 |
| `mthx4rq14b2k1n6x6i5i` | em_revisao | |
| `mthu6r1y5h104f1w2x68` | em_revisao | **526 s, a mais longa até hoje**, esperando desde a sessão 7 |
| `mth9xtoo5t35000z0t2v` | confirmada | 4 átomos |
| `mtgo3kaf5s5n3p3p521b` | confirmada | 4 átomos |
| `mtgn3zf72s023o3r281k` | em_revisao | proposta pré-slice-4; reextrair devolve o formato novo |
| `mtgle3st3m6f510w6j3i` | em_revisao | idem, de uma âncora só |
| `mtgeskkd…`, `mtgeoq7a…` | transcrito | nunca extraídas — trazem entidade nova, que é material |
| `mt7yxsg7…`, `mt7dlh0q…` | transcrito | teste de microfone, sem valor |
| `mtj5q4xa…`, `mthx7i1v…`, `mthx2i8p…`, `mthwntzj…` | **gravando** | gravações interrompidas; `/finalizar` as leva adiante |

**Isto é um sinal, não uma lista.** Sete sessões esperando revisão é a fila
acumulando — e ela não encolheu de 01/09 para 02/09, enquanto uma sessão nova
entrou e saiu confirmada no mesmo dia. É exatamente a forma da acumulação:
o material novo passa na frente, e o velho fica — `Specs/visao.md` §8 diz, com todas as letras, que revisão que vira
tarefa acumula, e acumulada é abandono. Antes de construir a slice 4.5, vale
esvaziar ou descartar essa fila e sentir quanto tempo uma revisão realmente leva.
O "menos de 60 s" continua sem medição.

As quatro em `gravando` são gravações que a aba interrompeu. É comportamento
conhecido (`ARCHITECTURE.md` §5): a sessão fica em `gravando` até `/finalizar`
levá-la adiante, e o áudio já subido está intacto no R2.

Reextrair é pelo botão na lista de áudios, ou:

```js
await fetch('/api/sessoes/<id>/extrair', {
  method: 'POST', headers: {'Content-Type':'application/json'},
  body: JSON.stringify({ forcar: true }),
}).then(r => r.json())
```

`forcar` refaz extração **e** resolução — as duas estão sob a mesma trava.

---

## 3. Slice 4.5 — o grafo ganha vetor

Plano completo e aprovado. O escopo é o vetor, os índices e **um** consumidor: a
camada semântica de candidato na resolução. Sem busca, sem tela, sem dedup de
átomo (slice 5).

### Por que, e por que não

**Não é economia de token.** O gasto dominante é o `extracao-5`, que manda a
transcrição inteira e nenhum catálogo — embedding não corta um token dele.

**É que dedup de átomo não tem outro mecanismo.** Cinco sessões por semana a 15
átomos dão ~3.900 átomos/ano, ou ~7,6 milhões de pares. Não é caro, é impossível.
Embedding é a única seleção de candidato que existe.

**E não há urgência de dado:** o vetor é derivável do texto a qualquer momento, e
refazer 4.000 deles é uma passada de `embedMany` que custa menos de um centavo.
Nenhuma porta se fecha por adiar. Isto se faz por conveniência e por aprendizado.

### O que já foi verificado

| Fato | Como |
|---|---|
| O Gateway suporta embedding pela porta única | `embed`/`embedMany` existem no `ai@7.0.77` e aceitam id em string. Zero dependência nova, zero chave nova, `tests/gateway.test.ts` passa sem afrouxar |
| A instância é Neo4j 5.27-aura | `CALL dbms.components()` |
| Os procedimentos vetoriais existem | `SHOW PROCEDURES` devolve `db.index.vector.queryNodes` |
| Lista de float como parâmetro funciona | é o caminho já usado por `inicios_s`/`fins_s` |
| **O Free deixa criar índice vetorial** | verificado em 2026-09-02 contra `0adada47`: `CREATE VECTOR INDEX` de 1536 dimensões e cosseno foi aceito, ficou `ONLINE` em menos de 500 ms, e `queryNodes` devolveu vizinho com score (1 / 0,998 / 0,500) sobre três nós de sondagem. Label e índice próprios, removidos no fim — 12 índices antes, 12 depois. A doc negava só "Vector Optimization" (config ≥4 GB), e é mesmo outra coisa |
| A configuração padrão do índice | `quantization.type: SCALAR`, `hnsw.m: 16`, `ef_construction: 100`, `default_search_expansion_factor: 1.5`. É o que a migration 006 herda se não disser nada — e o `SCALAR` quantiza o vetor **do índice**, o que alivia o último item da seção 6 |

### O que vira vetor

**Átomo: só `a.texto`.** Nada de tipo, entidade ou sessão — as três já são
estrutura no grafo, e o corte estrutural é do grafo, o semântico é do vetor.

**Entidade: `nome + tipo + aliases + os três campos de perfil`**, montados numa
string canônica com campo vazio omitido. O nó inteiro **não** entra: `id`,
`nome_normalizado` e `chaves` são duplicação ou ruído, e `sessoes`/`atomos` são
contagens que mudam a cada confirmar sem mudar o significado — entrariam no hash e
forçariam reembutir o grafo inteiro toda sessão, de graça.

**Os átomos da entidade ficam de fora**, e isso é decisão, não esquecimento: com
átomos na fonte, um átomo atribuído errado vira evidência para a próxima
atribuição, dissolvido num vetor que ninguém audita. É a mesma realimentação que a
slice 4 fechou ao decidir que o agente 3 nunca escreve.

```
(:Atomo   { …, embedding: [1536 floats] })
(:Entidade{ …, embedding: [1536 floats], embedding_fonte: "<hash da string>" })
```

`embedding_fonte` é o que torna o refresh idempotente e dispensa gancho nas cinco
rotas de entidade: hash bate, está em dia; não bate, reembute.

### As três camadas de candidato

`candidatosDe()` fica com três camadas **aditivas**, nunca substitutivas:

| Camada | Sinal | Pega o caso |
|---|---|---|
| 1. exato por chave | inalterada | grafia conhecida, inclusive alias |
| 2. string (`proximidade`) | inalterada | homófono: "Rafa" × "Raffa" × "Rapha" |
| 3a. perfil parecido | átomo × `entidade_embedding` | entidade **com perfil e sem átomo** — o Rapha depois do passo zero |
| 3b. vizinhos votam | átomo × `atomo_embedding`, voto por `:SOBRE`/`:MENCIONA` | entidade **com átomos e sem perfil** — todo o grafo de hoje |

As duas semânticas cobrem buracos opostos, e é por isso que ambas ficam.

A 3b consulta os vizinhos do átomo novo e conta votos por entidade, devolvendo o
`porque` — os ids dos átomos que elegeram o candidato. É o que a torna auditável:
a revisão pode dizer *"sugeri o Raffa porque isto parece com o que você disse em
12/ago"*, com link para o trecho. O loop de realimentação existe aqui também, mas
como **um voto entre `k`, com o id na tela** — visível e corrigível, que é
exatamente o que faltava para aceitá-lo.

**Teto e piso são obrigatórios:** `TOP_K = 3` sobre a união, e piso por camada.
Sem eles todo átomo ganha candidato, o agente 2 é chamado sempre, e o critério 5
da slice 4 morre. Os pisos de 3a e 3b se calibram **separado** — 3a é assimétrica
(átomo contra perfil), 3b é simétrica (átomo contra átomo), e o mesmo número não
significa a mesma coisa nas duas.

`PROMPT_VERSION_RESOLUCAO` sobe para `resolucao-2`: o conjunto de candidatos muda,
e isso é saída diferente.

### O par que já está no grafo e serve de teste

Dois APRENDIZADO, de sessões diferentes, sem uma palavra rara em comum:

```
mtgo3kaf…-0  "…o relacionamento com a Isinha era construído em grande parte sobre a
              minha necessidade de me sentir útil… essa base era muito insegurança…"
mth9xtoo…-3  "…começar o relacionamento tentando ter certeza dele com base nos
              problemas que eu tinha não era uma base sólida…"
```

Nenhuma camada de string acha esse par. **Se eles não saírem como vizinhos um do
outro, a camada não presta** — e o que se ajusta é a fonte do texto embutido.

---

## 4. Ordem de execução

| # | O quê | Por que nesta posição |
|---|---|---|
| 0 | **Passo zero** em `/entidades`: renomear `Raffael do Vale` → `Raffa`, criar o `Rapha`, escrever o perfil dos dois | Irreversível se pulado — conflacionar dois nós não tem desfazer. É o único item que perde dado, e é o que liga a camada 3a |
| 1 | Esvaziar (ou descartar) a fila de 8 revisões, cronometrando uma | A fila acumulando é o modo de morte da visão §8, e o "menos de 60 s" segue sem medição |
| 2 | ~~`CREATE VECTOR INDEX` contra o dev~~ **feito em 2026-09-02** | Era o único passo que podia invalidar uma escolha do plano, e não invalidou: o índice cria, fica `ONLINE` e responde. Nada de `.env.development.local` neste projeto — "o dev" é a instância única, e a sondagem foi feita em label próprio e desfeita |
| 3 | `Specs/slice-4.5.md` | Uma slice por vez pede o escopo escrito antes |
| 4 | `modelos.ts` + `src/lib/embedding.ts` + migration 006 | A porta e a estrutura, sem consumidor |
| 5 | Embutir no confirmar + `POST /api/atomos/embutir`; rodar nos 11 átomos | Primeiro material real |
| 6 | **Olhar a vizinhança à mão** — o par acima | Melhor descobrir que não presta antes de a resolução depender disso |
| 7 | `garantirEmbeddings` das entidades | Só vale alguma coisa depois do passo 0 |
| 8 | As três camadas em `candidatosDe`, `resolucao-2`, motivo na revisão | O consumidor, por último |
| 9 | Aprovar a migration 005 | No-op, mas fecha a regra. Continua sem rodar desde a sessão 7 |

---

## 5. Decisões tomadas — não relitigar

| Decisão | Por quê |
|---|---|
| Dois agentes, e o `extracao-5` não muda | cinco versões de calibração produziram algo que presta |
| A atribuição é por menção, não por sessão | dois "Rafa" na mesma sessão podem ser duas pessoas |
| Sessão sem ambiguidade não chama o agente 2 | e por isso não paga nada — critério 5 da spec |
| Dúvida destaca, não trava | o pior caso é atribuição trocada, que eu conserto; o pronome trava porque lá o pior caso é um nó chamado "ela" |
| O fallback nunca é o nome parecido | duas entidades a mais é grafo sujo; fundir duas pessoas não tem desfazer |
| O agente 3 nunca escreve | o perfil é o que o agente 2 lê; erro ali se realimenta |
| A marca de perfil é aresta, não propriedade | ela precisa dizer de **quem** é a informação |
| `contexto` é largo | quem a pessoa é para mim **e** qualquer outro contexto relevante |
| Qualidade se avalia à mão, na revisão | sem gabarito, sem fixture, sem percentual |
| **Átomo de entidade não entra na fonte do embedding dela** | seria a mesma realimentação do agente 3, e invisível |
| **A camada 3b entra mesmo herdando atribuição passada** | porque o `porque` a torna auditável na tela |
| **A engrenagem não fica no canto superior esquerdo** | aquele canto é da `Marca`; um segundo significado ali o faria querer dizer duas coisas conforme a tela |

---

## 6. O que vai morder

- **A fila de revisão.** Oito sessões esperando. É o item novo e o mais perigoso,
  porque é o modo de morte que a visão descreve por nome.
- **Sessão sem ambiguidade não marca perfil.** Quem aponta `:PERFILA` é o agente 2,
  e ele só é chamado quando alguma menção precisa de julgamento. Com o grafo como
  está, "o Rapha sabe produzir evento" não vira aresta — daí as 0 arestas hoje.
- **O agente 2 só vê os candidatos da menção, não o grafo inteiro.** É o limite que
  a slice 4.5 ataca, e a razão dela existir agora.
- **Entidade recém-criada, sem perfil e sem átomo, não é achada por nenhuma camada
  semântica** — só por string. É o estado do `Rapha` no minuto seguinte ao passo
  zero, e a razão de escrever o perfil junto de criar.
- **Transcrição longa começou a morder.** A sessão de 526 s foi a primeira a
  estourar, e caiu na falha do modelo de raciocínio, recuperando-se na segunda
  tentativa. `diagnostico()` agora põe `finishReason`, tokens e tamanhos no log das
  duas tentativas: `finishReason=length` com raciocínio no teto é orçamento comido
  pelo pensamento; `finishReason=stop` com texto zero e pensamento grande é o JSON
  ter ido para a parte de raciocínio. A segunda dói mais, porque a repetição
  automática a mascara.
- **`pnpm build` com o dev server de pé quebra o `.next`.** Compartilham diretório.
- **`waitUntil` em dev roda no mesmo processo.** Fechar a janela do servidor no
  meio mata o job; a sessão fica em `extraindo` e o retry é `/finalizar` de novo.
- **Instância Aura Free pausa sozinha** — o sintoma é `ENOTFOUND`, não timeout.
- **`config/vocabulario.txt` ainda tem três nomes.** O que o grafo conhece entra
  sozinho; nome nunca falado só entra por ali.
- **Não há como separar um nó que conflacionou duas pessoas.** É a razão de o passo
  zero vir antes de falar.
- **`db.index.vector.queryNodes` está deprecado a partir do Neo4j 2026.04**, em
  favor da cláusula `SEARCH`. A instância é 5.27 e funciona; quando a Aura subir,
  é uma linha a trocar.
- ~~**Cota de armazenamento do Aura Free**~~ — **conferido em 2026-09-02, e o
  medo era da métrica errada.** O teto do Free é **200 mil nós e 400 mil arestas**,
  não bytes; a Neo4j não publica cota em GB para esse tier. E embedding não cria
  nó nem aresta — é propriedade em nó que já existe. O grafo tem 41 nós e 41
  arestas hoje; com 4.000 átomos vai a ~4.050 nós, 2% do teto. Os ~12 KB por átomo
  (~48 MB no total) não têm contra o que ser comparados, e o vetor do índice é
  menor ainda: com a quantização `SCALAR` do padrão, ~6 MB para os 4.000. **O
  banco não sabe se dizer**: `apoc.monitor.store`/`apoc.monitor.kernel` não estão
  registrados e `dbms.queryJmx` volta vazio — a Aura bloqueia as duas. Quem mostra
  o uso é o console, em nós e arestas. Se um dia apertar, o botão continua sendo a
  dimensão do vetor.

---

## 7. Fora de escopo (slice 5)

As 2-4 perguntas do ritual, `:ATUALIZA`/`:CONTRADIZ`/`:CONFIRMA` entre átomos,
busca, tela Perguntar, `:Foco`, visualização de grafo e deduplicação de **átomo**
(a de entidade ficou na slice 3). Todos dependem de material acumulado — e a slice
4.5 existe justamente para que a dedup de átomo tenha por onde começar quando a
hora chegar.

Também fora, e sem previsão:

- **Desfazer uma fusão.** Migrar as arestas de volta exigiria saber quais eram de
  quem, e isso não é gravado. O que protege é a fusão nunca ser automática.
- **Separar um nó que já conflacionou duas pessoas.** A máquina junta, não divide.
- **Editar a marca de perfil na revisão.** Ela aparece e some com o átomo, mas não
  dá para trocar o campo.
- **Bancada de comparação de modelos** (pedida e adiada quatro vezes): rodar a
  mesma transcrição em até três modelos ao mesmo tempo. Desenho discutido: pasta e
  namespace próprios (`src/laboratorio/`, `/laboratorio`), regra de mão única — o
  laboratório importa do principal, nunca o contrário, com um teste travando a
  direção. Nada de escrita no grafo nem nas chaves de sessão do R2.
