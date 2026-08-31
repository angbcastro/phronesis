# Checkpoint — 2026-08-31 (sessão 7)

Documento de trabalho, não de arquitetura. **A slice 4 está construída e
commitada (`42612c8`), e ainda não foi exercitada contra um caso real.**
Apagar quando a slice 5 começar.

Contexto permanente está em `CLAUDE.md` (regras), `ARCHITECTURE.md` (como o
sistema funciona hoje) e `Specs/slice-4.md` (o que a slice 4 tem que ser). Este
arquivo só diz o que fazer a seguir.

---

## 0. O que está pronto

Os cinco passos da ordem de construção da spec, mais o que apareceu no caminho.

| Passo | Onde |
|---|---|
| três campos de perfil + UI | `src/lib/perfil.ts`, `/entidades` |
| agente 2, resolução por menção | `src/lib/resolucao.ts` (`resolucao-1`) |
| seletor pesquisável | `src/components/Revisao.tsx` |
| `:PERFILA` gravado no confirmar | `src/lib/atomos.ts` |
| agente 3, rascunho de perfil | `src/lib/perfil.ts` (`perfil-1`) |

390 testes, typecheck limpo. `ARCHITECTURE.md` acompanha: §4.8 e §4.9 novas,
§8.3 nova, §4.6 reescrita.

**A migration 005 vai proposta e não foi rodada.** Zero statements, como a 003 —
aplicá-la é um no-op e o código já funciona sem ela. Ela existe porque
`db/migrations/` é a definição canônica do schema.

**`resolucao-1` e `perfil-1` nunca rodaram de verdade.** Enquanto isso for
verdade, editar esses prompts não precisa subir o número: não há saída anterior
de que distinguir. A partir da primeira sessão que os exercitar, sobe.

---

## 1. O passo zero está pela metade — e do jeito que está, não funciona

O grafo hoje:

```
Isinha             6 átomo(s)  2 sessão(ões)   sem perfil
eu                 7 átomo(s)  2 sessão(ões)   sem perfil
Raffael do Vale    0 átomo(s)  0 sessão(ões)   sem perfil   ← semeado, nunca falado
```

Falta o Rapha, faltam os perfis — e tem um problema pior, que eu medi rodando a
camada de string de verdade contra o nome que está lá:

```
"Rafa"   x "Raffael do Vale" → NADA (vira entidade nova)
"Raffa"  x "Raffael do Vale" → NADA
"Rapha"  x "Raffael do Vale" → NADA
"Raffael" x "Raffael do Vale" → 0.8, compartilham "raffael"
```

**O nome semeado tem que ser a forma que eu falo, não a forma do documento.**
`proximidade()` casa palavra inteira ou distância de até 2 letras; "Rafa" e
"Raffael" não são nem uma coisa nem outra. Então, hoje, dizer "Rafa" numa sessão
não encontra o `Raffael do Vale`: não há candidato, o agente 2 **não é chamado**,
e nasce uma entidade nova solta.

E aí vem o risco de verdade: com os dois semeados por nome completo, uma sessão
que fale dos dois como "Rafa" cria **um nó só**, com os átomos dos dois
misturados — que é exatamente o que esta slice não sabe desfazer.

As formas curtas, entre si, casam bem:

```
"Rafa" x "Raffa" → 0.8    "Rafa" x "Rapha" → 0.6    "Raffa" x "Rapha" → 0.6
```

**O conserto:** o nome de exibição precisa conter, como palavra, o que eu falo.
`Raffa` funciona. `Raffa do Vale` funciona (compartilha a palavra "raffa").
`Raffael do Vale` não funciona. Renomear em `/entidades` resolve — e a grafia
velha fica como alias, sem perder nada.

---

## 2. Estado das sessões

| id | estado | o que fazer |
|---|---|---|
| `mthu6r1y5h104f1w2x68` | **em_revisao** | 526 s, a mais longa até hoje e a primeira pelo caminho novo — proposta esperando julgamento |
| `mth9xtoo5t35000z0t2v` | confirmada | 4 átomos no grafo |
| `mtgo3kaf5s5n3p3p521b` | confirmada | 4 átomos (Isinha, "eu") |
| `mtgn3zf72s023o3r281k` | em_revisao | proposta antiga, formato pré-slice-4 — abre, mas reextrair devolve o formato novo |
| `mtgle3st3m6f510w6j3i` | em_revisao | idem, de uma âncora só |
| `mtgeskkd…`, `mtgeoq7a…` | transcrito | nunca extraídas — trazem entidade nova, que é o que dá material |
| `mt7yxsg7…`, `mt7dlh0q…` | transcrito | teste de microfone, sem valor de conteúdo |

Totais no grafo: 8 átomos, 3 entidades, **0 arestas `:PERFILA`**.

Reextrair é pelo botão na lista de **áudios**, ou:

```js
await fetch('/api/sessoes/<id>/extrair', {
  method: 'POST', headers: {'Content-Type':'application/json'},
  body: JSON.stringify({ forcar: true }),
}).then(r => r.json())
```

`forcar` refaz extração **e** resolução — as duas estão sob a mesma trava.

---

## 3. O que a sessão 7 descobriu

**A sessão de 526 s caiu na falha do modelo de raciocínio** e se recuperou
sozinha na segunda tentativa. O log dizia só "Vieram 0 caractere(s)", que não
distingue duas causas com consertos opostos. Agora `diagnostico()` (em
`modelos.ts`, usado pelos três agentes) põe `finishReason`, tokens e o tamanho
do texto e do pensamento no log das duas tentativas:

| O que aparece | O que houve | Conserto |
|---|---|---|
| `finishReason=length`, `raciocinio` no teto | o pensamento comeu o orçamento | subir o teto de saída, ou trocar de modelo pela env |
| `finishReason=stop`, saída sobrando, `pensamento` grande, `texto=0` | o JSON foi para a parte de raciocínio | ler `reasoningText` quando o texto vier vazio |

A segunda linha é a que dói: nela a repetição automática **mascara** o problema e
ele volta na sessão seguinte. Vale olhar o log na próxima ocorrência antes de
mexer em qualquer número.

**Transcrição longa começou a morder.** 526 s é quase o triplo das anteriores, e
foi a primeira a estourar. O limite já estava listado como hipótese; agora é
observação.

---

## 4. Decisões tomadas — não relitigar

| Decisão | Por quê |
|---|---|
| Dois agentes, e o `extracao-5` não muda | cinco versões de calibração produziram algo que presta; a desambiguação não é problema dele |
| A atribuição é por menção, não por sessão | dois "Rafa" na mesma sessão podem ser duas pessoas |
| Sessão sem ambiguidade não chama o agente 2 | e por isso não paga nada — critério 5 da spec |
| Dúvida destaca, não trava | o pior caso é uma atribuição trocada, que eu conserto; o pronome trava porque o pior caso lá é um nó chamado "ela" |
| O fallback nunca é o nome parecido | duas entidades a mais é grafo sujo; fundir duas pessoas não tem desfazer |
| O agente 3 nunca escreve | o perfil é o que o agente 2 lê para desambiguar; erro ali se realimenta |
| A marca de perfil é aresta, não propriedade | ela precisa dizer de **quem** é a informação |
| `contexto` é largo | quem a pessoa é para mim **e** qualquer outro contexto relevante sobre ela |
| Qualidade de resolução se avalia à mão, na revisão | sem gabarito, sem fixture, sem percentual |

---

## 5. O que vai morder

- **Sessão sem ambiguidade nenhuma não marca perfil.** Quem aponta `:PERFILA` é o
  agente 2, e ele só é chamado quando alguma menção precisa de julgamento. Com o
  grafo como está, "o Rapha sabe produzir evento" não vira aresta, e o agente 3
  não tem de onde rascunhar. É consequência do critério 5, está registrada em
  `ARCHITECTURE.md` §14, e a saída — se incomodar — é chamar o agente também
  quando houver átomo com cara de perfil.
- **O agente 2 só vê os candidatos da menção, não o grafo inteiro.** Apelido sem
  letra em comum com o nome do nó nunca chega ao prompt. É o §1 acima, em forma
  geral.
- **`pnpm build` com o dev server de pé quebra o `.next`.** Os dois compartilham
  o diretório.
- **`waitUntil` em dev roda no mesmo processo.** Fechar a janela do servidor no
  meio mata o job; a sessão fica em `extraindo` e o retry é `/finalizar` de novo.
- **Instância Aura Free pausa sozinha** — o sintoma é `ENOTFOUND`, não timeout.
- **`config/vocabulario.txt` ainda tem três nomes.** O que o grafo conhece entra
  sozinho, mas nome que nunca foi falado só entra por ali.
- **Não há como separar um nó que conflacionou duas pessoas.** É a razão de o
  passo zero existir.

---

## 6. Próximos passos, em ordem

1. **Consertar e completar o passo zero**, que é pré-requisito de todo o resto:
   renomear `Raffael do Vale` para a forma que eu falo (`Raffa`, ou `Raffa do
   Vale`), criar o `Rapha`, e **escrever o perfil dos dois** — principalmente
   `fizemos juntos`, que é o desambiguador mais forte. Sem perfil, o agente 2
   é chamado e não tem com o que decidir.
2. **Julgar a proposta da `mthu6r1y5h104f1w2x68`**, que está esperando. É a
   primeira sessão pelo caminho novo. Se nenhum átomo aparecer destacado, é
   porque nenhuma menção foi ambígua e o agente 2 não foi chamado — o que é o
   esperado com o grafo como está.
3. **Gravar a sessão do teste**: falar do Raffa e do Rapha na mesma sessão, com
   contexto que os separe ("call para fechar o evento" / "slackline no parque").
   É o critério 2 da spec, e o único caso de que eu sei a resposta. Se os dois
   átomos caem em nós diferentes, a resolução presta; se caem no mesmo, o que se
   ajusta é o `resolucao-1`.
4. **Aprovar a migration 005** — no-op, mas fecha a regra.
5. **Reextrair as sessões antigas** (`mtgn3zf7`, `mtgle3st`) com o formato novo,
   e extrair as que nunca foram (`mtgeskkd`, `mtgeoq7a`) — trazem entidade nova,
   que é material para a busca de duplicatas e para o perfil.
6. **Encher o `config/vocabulario.txt`** com os nomes próprios que eu falo.
7. **Bancada de comparação de modelos** (pedida e adiada três vezes): rodar o
   fluxo de extração de uma mesma transcrição em até três modelos ao mesmo tempo.
   Desenho discutido: pasta e namespace próprios (`src/laboratorio/`,
   `/laboratorio`), regra de mão única — o laboratório importa do principal, o
   principal nunca importa do laboratório, com um teste travando a direção. Nada
   de escrita no grafo nem nas chaves de sessão do R2.

---

## 7. Fora de escopo (slice 5)

As 2-4 perguntas do ritual, `:ATUALIZA`/`:CONTRADIZ`/`:CONFIRMA` entre átomos,
busca, tela Perguntar, `:Foco`, visualização de grafo e deduplicação de **átomo**
(a de entidade ficou na slice 3). Todos dependem de material acumulado — e uma
pergunta boa precisa saber de quem se está falando, que é o que a slice 4
entrega.

Também fora, e sem previsão:

- **Desfazer uma fusão.** Migrar as arestas de volta exigiria saber quais eram de
  quem, e isso não é gravado. O que protege é a fusão nunca ser automática.
- **Separar um nó que já conflacionou duas pessoas.** A máquina junta, não
  divide. É por isso que o passo zero vem antes de falar.
- **Editar a marca de perfil na revisão.** Ela aparece e some com o átomo, mas
  não dá para trocar o campo. Se o agente errar muito, ajusta-se o `resolucao-1`.
