# Checkpoint — 2026-08-31 (sessões 5 e 6)

Documento de trabalho, não de arquitetura. **A slice 2 fechou e a slice 3 está
construída, faltando o uso.** Apagar quando a slice 4 começar.

Contexto permanente está em `CLAUDE.md` (regras), `ARCHITECTURE.md` (como o
sistema funciona hoje) e `Specs/slice-3.md` (o que a slice 3 tem que ser). Este
arquivo só diz o que fazer a seguir.

---

## -1. O que a sessão 6 descobriu sobre o STT

Uma troca de modelo pedida, testada e **revertida no mesmo dia**. Fica aqui para
ninguém repetir o teste daqui a três meses achando que é ideia nova.

`google/gemini-3.5-transcribe` transcreve melhor que o `xai/grok-stt` e custa
pouco — e **não devolve timestamp nenhum**. Sem tempo não há procedência: todo
átomo nasceria com `inicios_s`, `fins_s` e `ancoras` vazios, e o player da
revisão sumiria de todos os itens. A medição varreu 16 modelos do Gateway
(§4.2.1 do `ARCHITECTURE.md`); sobrou um só com tempo por palavra e sem rate
limit, e é o que já estava lá. Deepgram, AssemblyAI, ElevenLabs e Groq não estão
neste Gateway.

**O `keyterm` funciona** — isso era dúvida e virou medida. Mesmo bloco, mesma
chamada, só a lista mudando: sem lista sai "Porto Alegre", com `["Portalegre"]`
sai "Portalegre", e um termo irrelevante no controle não se injeta na saída.

Custo declarado: no bloco de teste o grok escreveu "a secretária está
funcionando" onde os outros ouviram "isso aqui tá funcionando". Era um teste de
microfone de 24/08, e as sessões reais dele produziram extração boa — mas
transcrição estranha numa sessão de verdade tem aqui a primeira suspeita, e não
há para onde correr dentro deste Gateway.

---

## 0. O buraco fechou

Duas sessões confirmadas, oito átomos no grafo, conferidos por Cypher:

```
:Sessao 8   :Atomo 8   :Entidade 2 (as duas também :Pessoa)
:GEROU 8    :SOBRE 8   :MENCIONA 5
zero átomo sem :SOBRE, zero átomo sem sessão
```

O que a passagem pelo banco de verdade provou, e que antes só tinha teste com
Neo4j mockado:

- o `MERGE` com label literal por tipo funciona no Aura Free — `:Entidade` sai
  com os dois labels (`Entidade` + `Pessoa`);
- `inicios_s`/`fins_s` gravam como lista de float, com a precisão que o STT
  devolve (`18.672`, `112.912`);
- todo átomo carrega `prompt_version: "extracao-5"`, `modelo:
  "zai/glm-5.3-flash"`, `status: "ativo"`, `criado_em` e `valido_em` (que é o
  `iniciada_em` da sessão, não a hora do confirmar — é o certo: a afirmação vale
  do dia em que foi falada).

Para reconferir a qualquer momento, no console do Aura:

```cypher
MATCH (s:Sessao)-[:GEROU]->(a:Atomo)-[:SOBRE]->(e:Entidade)
RETURN a.tipo, a.texto, e.nome, a.inicios_s, a.prompt_version, a.modelo
```

**Continua sem desfazer.** `confirmada` não tem transição de saída e nada apaga
átomo (regra 6).

---

## 1. Estado das sessões

| id | estado | o que fazer |
|---|---|---|
| `mtgo3kaf5s5n3p3p521b` | **confirmada** | 4 átomos no grafo (Isinha, "eu") |
| `mth9xtoo5t35000z0t2v` | **confirmada** | 4 átomos no grafo |
| `mtgn3zf72s023o3r281k` | em_revisao | proposta esperando — reextrair com `extracao-5` e julgar |
| `mtgle3st3m6f510w6j3i` | em_revisao | idem; proposta antiga, de uma âncora só |
| `mtgeskkd…`, `mtgeoq7a…` | transcrito | nunca extraídas — a extração automática ainda não existia |
| `mt7yxsg7…`, `mt7dlh0q…` | transcrito | teste de microfone, sem valor de conteúdo |

Reextrair é pelo botão na lista de **áudios** (link no rodapé da home), ou:

```js
await fetch('/api/sessoes/<id>/extrair', {
  method: 'POST', headers: {'Content-Type':'application/json'},
  body: JSON.stringify({ forcar: true }),
}).then(r => r.json())
```

---

## 2. O que mudou nesta sessão

**A transcrição saiu da jornada.** Era ela que a gravação abria, e dela saía um
link que eu tinha de clicar para revisar. Agora:

| Rota | Tela | Papel |
|---|---|---|
| `/sessao/:id` | `Processando` | o corredor: um verbo do passo atual, sem texto; ao ver `em_revisao` faz `replace` para a revisão |
| `/sessao/:id/revisar` | `Revisao` | inalterada |
| `/sessao/:id/transcricao` | `Leitura` | o texto literal, sem finalizar nada e sem redirecionar |

Na lista de áudios, cada sessão com transcrição pronta ganhou um botão
**transcrição** ao lado de **reextrair**. `destino()` manda a linha para onde
ainda há o que fazer: revisão se há proposta, transcrição se o texto está
inteiro, processamento no resto.

`Processando` é quem chama `/finalizar` agora — a garantia de fila vazia veio
junto, intacta. `Leitura` só lê.

## 2.1 O que a sessão 6 construiu (slice 3)

**Metade A — o vocabulário vem do grafo.** União com `config/vocabulario.txt`,
arquivo primeiro, ordenado por número de sessões, cache de 5 min. Grafo fora do
ar cai no arquivo em vez de derrubar a transcrição. `eu`, pronome e palavra
comum não viram keyterm — ensinar o STT a ouvir "casa" com mais força piora tudo
em troca de nada. O **nome da opção** virou mapa por provedor em `modelos.ts`:
provedor desconhecido não recebe opção nenhuma, que é o padrão seguro.

**Metade B — `/entidades`.** A primeira janela para dentro do grafo. Lista o que
entrou, e conserta: fundir duas grafias, renomear. "Procurar duplicatas" é um
botão, porque a camada de string é de graça e a que julga é chamada de modelo.

**A ideia que carrega a slice: fundir é criar alias.** O perdedor fica com
`status='fundida'` e `:FUNDIDA_EM`; as arestas migram; e como ele mantém o
`nome_normalizado`, a grafia morta nunca renasce — dita de novo, resolve até o
vencedor. Renomear é o mesmo mecanismo consigo mesma, o que fecha o limite do
"meu pai". Migration 004 aplicada (um índice; sem migração de dado, de
propósito).

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

**A slice 3 está construída** (`Specs/slice-3.md`). O que falta nela é uso: a
mecânica foi validada contra o Aura, mas o grafo não tem duplicata nenhuma para
o `duplicatas-1` julgar, então a qualidade da proposta é a única parte que
continua sem medida.

1. **Abrir `/entidades`** — link no rodapé da home, ao lado de "áudios". Hoje
   ela lista `Isinha` (6 átomos, 2 sessões) e `eu` (7 átomos, 2 sessões). É a
   primeira janela para dentro do grafo que este sistema tem.
2. **Reextrair as duas sessões em `em_revisao`** com o `extracao-5` e julgar a
   saída na revisão. É a única medida de qualidade que existe — e as sessões
   nunca extraídas (`mtgeskkd`, `mtgeoq7a`) trazem entidade nova, que é o que
   dá material para a busca de duplicatas ter o que fazer.
3. **Encher o `config/vocabulario.txt`** com os nomes próprios que você fala.
   Ele não deixa de existir na slice 3 — continua sendo o único jeito de
   ensinar um nome **antes** de falá-lo pela primeira vez, que é justamente
   quando o STT mais erra. O que o grafo já conhece entra sozinho.
4. **Bancada de comparação de modelos** (pedida e adiada duas vezes): rodar o
   **fluxo de extração** de uma mesma transcrição em até três modelos ao mesmo
   tempo, comparar e escolher. Só extração, não STT. O desenho discutido foi uma
   pasta e um namespace de rota próprios (`src/laboratorio/`, `/laboratorio`), com
   regra de mão única — o laboratório importa do principal, o principal nunca
   importa do laboratório, com um teste travando a direção. Nada de escrita no
   grafo nem nas chaves de sessão do R2. O `pnpm-workspace.yaml` **não** declara
   `packages:`, então separar em pacote exigiria mover `src/` para `apps/web/` —
   mexer no projeto inteiro para isolar a bancada dele.

---

## 7. Fora de escopo (slice 4)

As 2-4 perguntas do ritual, `:ATUALIZA`/`:CONTRADIZ`/`:CONFIRMA` entre átomos,
busca, tela Perguntar, `:Foco`, visualização de grafo e deduplicação de **átomo**
(a de entidade ficou pronta na slice 3). **Não existem e não devem ser
construídos agora** — todos dependem de material acumulado que ainda não existe.

Também fora: **desfazer uma fusão.** Migrar as arestas de volta exigiria saber
quais eram de quem, e isso não é gravado. O que protege é a fusão nunca ser
automática.
