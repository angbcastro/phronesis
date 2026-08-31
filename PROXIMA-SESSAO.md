# Checkpoint — 2026-08-31 (sessão 4)

Documento de trabalho, não de arquitetura. **A slice 2 está construída de ponta a
ponta e nunca foi validada até o fim: o grafo tem zero átomos.** Apagar quando a
slice 2 estiver validada.

Contexto permanente está em `CLAUDE.md` (regras), `ARCHITECTURE.md` (como o
sistema funciona hoje) e `Specs/slice-2.md` (o que a slice 2 tem que ser). Este
arquivo só diz o que fazer a seguir.

---

## 0. O buraco: nada nunca foi confirmado

```
MATCH (a:Atomo) RETURN count(a)   →   0
MATCH (e:Entidade) RETURN count(e) →  0
```

Todo o caminho existe — extração, âncoras, resolução de entidade, tela de
revisão, player, confirmar — e **o confirmar nunca rodou contra o Neo4j de
verdade**. Ele tem 12 testes com o banco mockado, o que garante a forma do Cypher
e nada sobre o comportamento do Aura.

**É o primeiro teste da próxima sessão**, e ele descobre de uma vez:

- se o `MERGE` com label literal por tipo funciona no Aura Free (`atomos.ts`
  roda uma consulta por tipo porque Neo4j não aceita label por parâmetro);
- se a constraint de `nome_normalizado` único se comporta como esperado;
- se as listas paralelas `inicios_s`/`fins_s`/`ancoras` gravam como float;
- se confirmar duas vezes de fato não duplica.

Depois de confirmar uma sessão, conferir à mão:

```cypher
MATCH (s:Sessao)-[:GEROU]->(a:Atomo)-[:SOBRE]->(e:Entidade)
RETURN a.tipo, a.texto, e.nome, a.inicios_s, a.prompt_version
```

**Atenção: não há como desfazer um confirmar.** `confirmada` não tem transição de
saída e nada apaga átomo (regra 6). Confirme primeiro a sessão de teste curta
(`mtgle3st3m6f510w6j3i`, 44 s), não a longa.

---

## 1. Estado das sessões

| id | estado | o que fazer |
|---|---|---|
| `mtgo3kaf5s5n3p3p521b` | **erro** | falhou na extração *antes* do conserto; reextrair pela lista de áudios |
| `mtgn3zf72s023o3r281k` | em_revisao | proposta do `extracao-3`, com "ela" como entidade; reextrair para ver o `extracao-5` |
| `mtgle3st3m6f510w6j3i` | em_revisao | proposta antiga (`extracao-2`, uma âncora só); boa candidata para o primeiro confirmar |
| `mtgeskkd…`, `mtgeoq7a…` | transcrito | nunca extraídas — a extração automática ainda não existia |
| `mt7yxsg7…`, `mt7dlh0q…` | transcrito | teste de microfone, sem valor de conteúdo |

Reextrair é pelo link **áudios** no rodapé da home, ou:

```js
await fetch('/api/sessoes/<id>/extrair', {
  method: 'POST', headers: {'Content-Type':'application/json'},
  body: JSON.stringify({ forcar: true }),
}).then(r => r.json())
```

---

## 2. O que foi construído nesta sessão

Oito commits, de `d79c54a` a `00d798a`. `pnpm test` 248/248, `pnpm typecheck`
limpo, working tree limpo.

| | |
|---|---|
| Extração | job pelo Gateway, JSON estrito, `prompt_version` e `modelo` em todo átomo |
| Offsets | o modelo devolve o trecho, o código acha o segundo; 1..n âncoras por átomo |
| Entidades | casamento por `nome_normalizado`, só leitura; pronome pede nome na revisão |
| Pipeline | a extração dispara sozinha no fim da transcrição; proposta em `extracao.json` |
| Revisão | `/sessao/:id/revisar` — aprovar, editar, escutar cada trecho, confirmar |
| Confirmar | única porta de escrita no grafo; procedência relida do R2, não do corpo |
| Lista de áudios | `/sessoes` — todos os áudios, com re-extração forçada |

**Migration 003 escrita e nunca rodada.** Ela tem **zero statements**: nada do que
mudou (tipos `DECISAO`/`ROTINA`, âncoras em lista) é declarável no Aura Free.
Rodar `pnpm migrate` com ela é no-op. Ela existe porque `db/migrations/` é a
definição canônica do schema.

---

## 3. O prompt está em `extracao-5`

Mora em `src/lib/extracao.ts`, na constante `INSTRUCOES`. Cinco versões em um dia,
e cada mudança sobe o número — é o que vai gravado em todo átomo.

O que a calibração produziu, e que não se deve desfazer sem motivo:

- 10 a 20 átomos numa sessão de 15 min; o `extracao-1` fazia ~150 e matava a
  revisão de 60 s;
- trivialidade do dia colapsa num átomo `ROTINA`;
- `texto` é frase limpa com as palavras de quem falou, `trechos` são literais;
- `SENTIMENTO`, `APRENDIZADO` e `ROTINA` são sempre `sobre: "eu"`;
- nome de entidade é nome — procurar na transcrição inteira antes de devolver
  pronome;
- não comentar a transcrição; lista vazia é resposta legítima.

**`zai/glm-5.3-flash` é modelo de raciocínio** e chegou a gastar 1720 tokens
pensando para 122 de texto. Daí o `maxOutputTokens: 8000`, a segunda tentativa
automática e a resposta crua na mensagem de erro. Se voltar a falhar, o log
`[extracao]` agora diz o que veio.

---

## 4. Decisões tomadas — não relitigar

| Decisão | Por quê |
|---|---|
| Qualidade da extração é avaliada à mão, na revisão | não existe gabarito rotulado, fixture nem percentual de recall — não inventar nenhum dos três |
| `"eu"` é uma `:Pessoa` como qualquer outra | decidido explicitamente |
| Átomo sem âncora aparece sem player, não é descartado | diverge do critério 3 da spec, de propósito: offset plausível é procedência falsa |
| Um átomo junta o mesmo assunto dito em momentos distintos | daí as âncoras múltiplas |
| Renomear entidade só vale para entidade nova | o grafo vence sobre o extrator |
| A correção de nome acontece na lista de entidades, não átomo por átomo | um toque conserta todos os átomos que apontam para ela |

---

## 5. O que vai morder

- **`pnpm build` com o dev server de pé quebra o `.next`.** Os dois compartilham
  o diretório. Aconteceu uma vez e derrubou o app.
- **`waitUntil` em dev roda no mesmo processo.** Fechar a janela do servidor no
  meio da extração mata o job; a sessão fica em `extraindo` e o retry é
  `/finalizar` de novo, ou o botão da lista de áudios.
- **Instância Aura Free pausa sozinha** e o hostname deixa de resolver em DNS —
  o sintoma é `ENOTFOUND`, não timeout. Despausar no console resolve.
- **Nome descritivo não é pronome.** "meu pai" e "minha mãe" viraram entidades com
  esse nome. É defensável, mas se o nome próprio aparecer em outra sessão o grafo
  terá as duas. **Decisão em aberto:** fazer descritivo pedir nome também?
- **`config/vocabulario.txt` ainda tem três nomes.** "rafa" saiu em minúscula por
  isso. Nome que não está lá sai grafado errado, e encher depois não conserta o
  que já foi transcrito.

---

## 6. Próximos passos, em ordem

1. **Confirmar uma sessão de verdade** — seção 0. Fecha a slice 2.
2. **Reextrair as sessões em `erro` e `em_revisao`** com o `extracao-5` e julgar a
   saída na revisão. É a única medida de qualidade que existe.
3. **Encher o `config/vocabulario.txt`** com os nomes próprios que você fala.
4. **Revisar `ARCHITECTURE.md` inteiro** — ao fechar uma slice, o `CLAUDE.md` pede
   isso. O cabeçalho declara qual slice está no ar.
5. **Bancada de comparação de modelos** (pedida e adiada nesta sessão): rodar o
   **fluxo de extração** de uma mesma transcrição em até três modelos ao mesmo
   tempo, comparar e escolher. Só extração, não STT. O desenho discutido foi uma
   pasta e um namespace de rota próprios (`src/laboratorio/`, `/laboratorio`), com
   regra de mão única — o laboratório importa do principal, o principal nunca
   importa do laboratório, com um teste travando a direção. Nada de escrita no
   grafo nem nas chaves de sessão do R2. O `pnpm-workspace.yaml` **não** declara
   `packages:`, então separar em pacote exigiria mover `src/` para `apps/web/` —
   mexer no projeto inteiro para isolar a bancada dele.

---

## 7. Fora de escopo (slice 3)

As 2-4 perguntas do ritual, `:ATUALIZA`/`:CONTRADIZ`/`:CONFIRMA` entre átomos,
busca, tela Perguntar, `:Foco`, visualização de grafo, deduplicação semântica e
vocabulário gerado das entidades. **Não existem e não devem ser construídos
agora.**
