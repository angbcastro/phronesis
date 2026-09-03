# Slice 4.6 — O prompt aprende com a revisão

**Objetivo:** toda correção que eu faço na revisão — rejeitar um átomo, editar texto ou tipo,
trocar o sujeito, renomear ou recusar uma entidade, apontar o que faltou — passa a ser registrada,
sem custar um toque a mais do que já custa hoje. Acumulada, ela é o material que eu, sob demanda,
transformo em regra nova para o prompt de extração — nunca sozinha, nunca automática, só com a
minha aprovação antes de valer.

**Pronto quando:** eu confirmo uma sessão em que rejeitei um átomo e troquei o tipo de outro; abro
`/calibracao` e vejo as duas correções, separadas por agente, com o trecho e o áudio à mão; peço um
rascunho, `calibracao-1` propõe uma regra citando as duas; eu aprovo; e a **próxima** sessão que eu
gravar sai extraída com essa regra em vigor — sem eu tocar em `extracao.ts`, sem deploy.

Se a regra proposta não fizer sentido, eu edito o texto ou descarto. Quem julga sou eu, como toda
avaliação de qualidade neste sistema.

## Por que agora — e o que isto não é

**Não é gabarito, nem métrica de qualidade.** A proibição de `CLAUDE.md` continua valendo aqui:
nenhuma nota, nenhum percentual, nenhum "melhorou/piorou" automático. O que esta fatia acrescenta é
memória do que eu já corrigi — o julgamento continua sendo só meu, sessão real por sessão real.

**É que hoje a correção mais cara do sistema se perde de graça.** Rejeitar um átomo, editar um
texto, trocar um tipo: tudo isso já acontece na revisão, e nada sobrevive ao clique de confirmar. O
servidor até calcula quantos átomos foram rejeitados (`confirmar/route.ts:192`) só para descartar o
número na resposta HTTP. Esta fatia não pede nenhum gesto novo na revisão — ela só para de jogar
fora o que a revisão já produz. A exceção é o botão "faltou um" (§6), pedido à parte e opt-in.

**O corpus começa em zero, e o desenho tem que valer assim.** O grafo hoje tem 0 `:Atomo`, 0
`:Entidade`, 5 `:Sessao` em `transcrito` — não há correção histórica para recuperar. Nada aqui é
estatístico, nada espera volume: uma correção lida com o áudio à mão já é sinal suficiente para
ajustar uma seção do prompt.

**O escopo é a extração.** Correções de atribuição (`resolucao-2`) e de higiene de entidade
(renome) são capturadas e etiquetadas, mas não alimentam agente nenhum nesta fatia — ficam
guardadas para quando eu quiser calibrar cada um dos outros dois, um de cada vez.

## O fluxo, do áudio ao grafo

O ponto central: **o grafo é o único lugar que esta fatia não toca.** Captura, acumulação, rascunho
e aprovação vivem inteiramente no R2, como um observador ao lado do fluxo de sempre.

1. Gravação/importação → transcrição. Sem mudança.
2. Transcrição → extração. `montarPrompt(texto, regras) = INSTRUCOES_BASE + blocoDeRegras(regras)
   + FORMATO + texto`. Sem regra aprovada, `blocoDeRegras([]) === ""` e a chamada ao modelo sai
   **byte a byte igual a hoje** — a feature é um no-op até a primeira aprovação. Só muda uma
   etiqueta: `versaoDoPrompt(regras)` substitui o `PROMPT_VERSION` fixo — `"extracao-5"` sem regra,
   `"extracao-5+a3f91c7d"` com.
3. Extração → resolução. Sem mudança nesta fatia — casamento determinístico sempre roda, o modelo
   só entra na dúvida.
4. → `extracao.json` no R2 → revisão. Sem mudança na leitura. Ao montar o envio, a tela também
   anota *quais campos eu toquei* (`gestos`, §1) — não um valor novo, o registro do gesto.
5. `POST /confirmar` → o grafo. **Esta etapa não muda em nada.** Mesmo Cypher, mesmo schema, nenhum
   node novo, nenhuma edge nova, nenhuma migration. O único detalhe: `prompt_version` (regra 7)
   pode carregar o sufixo do passo 2.
6. `POST /confirmar` → correção capturada. Só **depois** de gravar no grafo e responder à tela,
   dentro de `waitUntil`, o servidor compara o que a proposta dizia com o que foi aprovado +
   `gestos`, produz um registro de `Correcao` (§1), e grava — **só no R2**. Nunca toca o Neo4j,
   nunca bloqueia a revisão, e uma falha aqui nunca desfaz o que já foi confirmado.
7. Correções acumuladas → sugestão → rascunho. Passivo: havendo correção em aberto e tendo passado
   3 semanas desde a última vez que `/calibracao` foi aberta, uma linha discreta aparece na gaveta
   da `Gestao` (§5) — nunca um número, nunca em `/`. A ação continua minha: só quando abro
   `/calibracao` e peço um rascunho é que `calibracao-1` lê as correções em aberto e propõe até
   duas regras, cada uma citando o que a motiva.
8. Rascunho → aprovação. Edito o texto das regras que quiser manter, descarto o resto, aprovo. Isso
   grava um snapshot novo e imutável de regras e marca as correções citadas como tratadas.
9. A regra aprovada só passa a valer na **próxima** extração (passo 2). Nenhum átomo já gravado
   muda retroativamente; o grafo não é reescrito.

## 1. O que não é derivável, e viaja como gesto

O servidor já tem os dois lados de toda correção de átomo: `extracao.json` guarda a proposta,
indexada por índice (`confirmar/route.ts:84,92`), e o corpo do confirmar traz o valor final. O
diff é computado **no servidor** — duplicar no cliente faria as duas implementações divergirem, com
a da tela vencendo calada.

Três coisas, porém, são gesto e não valor — só o navegador é testemunha:

| Não derivável | Vem de |
|---|---|
| entidade recusada de propósito × não usada por acaso | `semEntidade` (`Revisao.tsx:218`) |
| o par original→final de um renome | `renomes` (`Revisao.tsx:219`) — o POST manda só o final |
| campo que eu toquei × `canonizar` (grafia do grafo vencendo) | as chaves de `edicoes[indice]` — a chave existir **é** o gesto |

O contrato de `POST /confirmar` ganha um campo opcional:

```ts
gestos?: {
  atomos: { indice: number; campos: ("texto"|"tipo"|"sobre"|"menciona")[] }[];
  entidades_recusadas: string[];
  renomes: { de: string; para: string }[];
  faltantes: { texto: string }[];   // §6
}
```

`gestos` não carrega valor nenhum, só o registro do toque. Corpo sem `gestos` continua confirmando
— o servidor infere pelo valor e marca `tocado: false`. Retrocompatível, sem 400 novo.

**Duas travas contra correção-fantasma de canonização**, nesta ordem: (1) nome final igual ao
proposto por normalização (`normalizarNome(antes) === normalizarNome(depois)`) nunca é correção —
mata caixa e acento de graça; (2) chave diferente sem o campo em `gestos` é provável travessia de
alias, registrada como **inferida** (`tocado: false`), com um sinal discreto na tela.

Um renome no rodapé já muda o `sobre`/`menciona` resolvido de todo átomo que cita aquela entidade;
as entidades presentes em `gestos.renomes` saem do conjunto avaliado pelas duas travas acima antes
de computar `sujeito`/`mencao_*`, para uma edição não virar duas correções.

## 2. O registro de uma correção

```ts
export interface Correcao {
  id: string;                     // ver "A chave", abaixo
  sessao_id: string;
  atomo_id: string | null;        // só para correção de átomo
  entidade_chave: string | null;  // só para entidade_recusada, entidade_renomeada, entidade_tipo
  agente: "extracao" | "resolucao" | "grafo";
  tipo: TipoCorrecao;              // rejeitado | texto | tipo | sujeito | mencao_* | entidade_* | faltou
  antes: string;                   // "" quando eu acrescentei
  depois: string;                  // "" quando rejeitei
  tipo_atomo: TipoAtomo | null;
  texto_proposto: string;
  inicios_s: number[];             // as âncoras, para o player
  prompt_version: string;          // do átomo da proposta, nunca do corpo (regra 7)
  modelo: string;
  tocado: boolean;
  em: string;
  incorporada_em: string | null;   // hash da versão de regras que a endereçou; null = em aberto
}
```

**A chave não é sempre `${atomo_id}|${tipo}`.** Três tipos não têm átomo (`entidade_recusada`,
`entidade_renomeada`, `faltou`); usar só `atomo_id` faria os três colapsarem para um id fixo por
tipo, e uma correção nova apagaria a anterior em silêncio — exatamente o oposto de "as correções se
acumulam". A chave é condicional:

```
atom-level   (rejeitado, texto, tipo, sujeito, mencao_*)            -> `${atomo_id}|${tipo}`
entity-level (entidade_recusada, entidade_renomeada, entidade_tipo) -> `${sessao_id}|${tipo}|${normalizarNome(entidade)}`
faltou                                                               -> `${sessao_id}|faltou|${normalizarNome(texto).slice(0,40)}`
```

### Etiqueta de agente

| Tipo | Agente | Por quê |
|---|---|---|
| `rejeitado`, `texto`, `tipo`, `faltou` | `extracao` | é o `extracao-5` produzindo o que não presta |
| `entidade_recusada` | `extracao` | o extrator listou como entidade o que não é pessoa/projeto/objetivo |
| `entidade_tipo` | `extracao` | o extrator errou o palpite de tipo na lista `entidades` |
| `sujeito`, `mencao_*` | `resolucao` ou `extracao` | por átomo — ver abaixo |
| `entidade_renomeada` | `grafo` | higiene de grafia, não é erro de agente |

`entidade_tipo` é derivável sem `gestos`: `canonizar` só sobrescreve `tipo` quando a entidade casa
com um nó existente; para `conhecida: false`, o tipo do corpo é exatamente o que eu escolhi.

Duas finuras: (1) renome cujo `antes` cai em `ehPronome` vira `extracao` — o extrator furou a seção
`NOME DE ENTIDADE É NOME` (`extracao.ts:113-116`), que é o que aquela correção calibra; (2)
`sujeito`/`mencao_*` corrigidos onde a referência original tinha `conhecida: false` vira
`extracao`, não `resolucao` — o sinal é **por átomo** (`original.sobre.conhecida`,
`tipos.ts:169-191`), não por sessão. `resolucao.ts` roda sua camada determinística para toda
menção; `prompt_version_resolucao` só marca se alguma teve que ir ao modelo, então uma sessão sem
ambiguidade nenhuma (comum com o grafo ainda pequeno) pode ter `conhecida: true` batendo, por
acaso, no nó errado — o caso "Raffa/Rapha" que a slice 4 existe para tratar. `conhecida: true` é
`resolucao.ts` decidindo entre nós conhecidos; `conhecida: false` é candidata nova, mais perto de
"o extrator escreveu algo que não bate com nada".

**Captura os três agentes, calibra um de cada vez** — o primeiro é a extração.

## 3. Onde vive, e como acumula (R2)

```
sessoes/<id>/correcoes.json           o registro permanente daquela revisão
sessoes/<id>/extracao-anterior.json   a proposta que o forcar sobrescreveu (§5)
calibracao/indice.json                a mesa de trabalho: o acumulado, teto de 500
calibracao/regras-<hash>.json         cada versão das regras aprovadas, imutável (§4)
```

**Por que R2 e não o grafo:** regra 2, e não vale uma migration para isto. Mais forte: o grafo é o
que eu vivi; correção é o que o pipeline errou. Um `:Atomo` dizendo "o modelo escreveu FATO onde
era OPINIAO" apareceria numa busca por "o que eu aprendi" e apodreceria a coisa que o sistema
existe para fazer.

**Por que separado de `extracao.json`:** `forcar` sobrescreve sem backup (`pipeline.ts:235`).
Correção junto da proposta morreria na primeira recalibração — quando ela mais vale.

**Por que existe um índice:** `r2.ts` não tem `LIST`. Ele guarda as correções inteiras (o corpus é
esparso por construção — visão §9) e resolve a tela com um GET. Estourado o teto, a eviction
remove **fechadas** (`incorporada_em !== null`, já cumpriram o papel — o registro permanente por
sessão cobre auditoria) antes de **abertas** (as únicas que ainda importam para `calibracao-1`;
perdê-las do índice as torna inatingíveis para sempre, sem `LIST`).

```ts
export interface IndiceCalibracao {
  correcoes: Correcao[];            // mais novas primeiro, teto de TETO_CORRECOES
  regras_correntes: string | null;  // hash da versão de regras em vigor; null = nenhuma aprovada
  visitado_em: string | null;       // última vez que /calibracao carregou de fato (§5)
  atualizado_em: string;
}

export const TETO_CORRECOES = 500;
```

**Idempotência (regra 4):** `correcoes.json` grava com `ifNoneMatch:"*"`, como `extracao.json`; o
índice é read-modify-write com `If-Match`, no laço de retry de `atualizarManifest`
(`manifest.ts:79-101`) — não uma imitação sem o laço de espera. `incorporada_em` só é autoritativo
no índice, e sua escrita faz parte do **mesmo** ciclo que atualiza `regras_correntes` — a cópia de
cada `Correcao` em `sessoes/<id>/correcoes.json` não é atualizada retroativamente, é uma fotografia
do momento da confirmação. Duas aprovações divergentes quase simultâneas só não se destroem se o
conteúdo novo for recalculado **dentro** de cada tentativa do retry — relê o corrente, soma o que
estou aprovando, recalcula o hash, tenta gravar com o etag que acabou de ler.

**Quando roda:** dentro de `waitUntil`, depois da resposta, `try/catch` que nunca derruba o
confirmar. O que destrava o `router.push("/")` é a resposta HTTP (visão §8); pagar idas ao R2 nos
60 s da revisão por material de meta seria pagar no lugar errado. `waitUntil` morto perde as
correções daquela sessão, sem recuperação — custo assumido.

## 4. O prompt efetivo, e a regra 7

`INSTRUCOES` se parte no ponto exato onde uma regra nova entraria — entre o fim de
`NÃO COMENTE A TRANSCRIÇÃO` e o cabeçalho `FORMATO`:

```ts
montarPrompt(texto, regras) = INSTRUCOES_BASE + blocoDeRegras(regras) + FORMATO + texto.trim()
```

`blocoDeRegras([]) === ""`: sem regra aprovada, byte a byte igual a hoje, e as 6 substrings que
`tests/extracao.test.ts` trava continuam passando sem tocar no teste.

```ts
versaoDoPrompt([])     === "extracao-5"
versaoDoPrompt(regras) === "extracao-5+a3f91c7d"   // hash das regras usadas nesta chamada
```

O hash sai das regras **usadas na chamada**, não do arquivo — se o R2 falhar, entram zero regras e
a versão é a base; a procedência é verdadeira nos dois caminhos. E o hash tem que resolver para um
texto: cada aprovação grava `calibracao/regras-<hash>.json`, imutável para sempre, e
`regras_correntes` aponta qual é a corrente. Sem isso, `extracao-5+a3f91c7d` carimbaria um átomo
com uma versão cujo texto não estaria versionado em lugar nenhum.

**Não cabia ser um arquivo em `config/`**, como `vocabulario.txt`: aquele é lido do bundle do
deploy, nunca escrito em runtime — Vercel serverless não tem filesystem gravável nem compartilhado
entre instâncias. R2 é a única opção que funciona para algo que a própria aplicação precisa gravar.

`regras()` copia o molde de `vocabulario.ts` — leitura tolerante, ausência devolve `[]` — com um
teto, `MAX_REGRAS = 12`, que é a curadoria: prompt sem limite é como esta fatia estragaria a
extração que já presta. Diferença que importa: `vocabulario()` tolera um cache de 5 min porque é
chamado a cada bloco de 30 s; `regras()` é chamado uma vez por sessão, e um cache parado faria
"aprovar → vale na próxima extração" ser falso por minutos numa instância quente. Por isso
`POST /api/calibracao/regras` invalida o cache ao fim de toda escrita bem-sucedida.

## 5. `calibracao-1`: rascunha, nunca escreve

Rota nova na gaveta da `Gestao`. É gestão — `tipografia.ts` a serve com Inter sem ninguém marcar
nada, porque `RITUAL` é allowlist.

| Rota | Faz |
|---|---|
| `GET /api/calibracao` | o índice + as regras correntes; marca `visitado_em = agora` como efeito colateral best-effort |
| `GET /api/calibracao/sugestao` | `{ sugerir: boolean }`, puro, nunca escreve |
| `POST /api/calibracao/rascunho` | `calibracao-1` propõe, a partir das correções **em aberto**. Não escreve nada |
| `POST /api/calibracao/regras` | o único que escreve regra, só com o meu toque, e marca `incorporada_em` |

`rascunho` nunca revê o que uma versão anterior já endereçou — cada rodada é um compilado das
edições **novas**, não uma releitura do que já virou regra. Regra que eu corto antes de aprovar
deixa as correções que a motivavam em aberto; elas voltam na próxima rodada.

Cada regra do rascunho é um objeto com identidade própria, não texto solto — é o que torna
"sobreviver à minha edição" bem definido:

```ts
interface RegraRascunhada {
  id: string;          // atribuído no rascunho, estável, nunca editável
  texto: string;        // o único campo que a tela deixa eu editar
  cita: string[];        // Correcao.id[], do calibracao-1, imutável na tela
  substitui?: string;   // qual seção existente, se for o caso
}
```

"Editável" é só `texto`; "apagável" é o bloco inteiro. "Sobreviveu" é: o `id` ainda está entre os
que eu submeto ao aprovar. `incorporada_em` recebe a união dos `cita` de toda regra sobrevivente.

Molde exato de `perfil/rascunho` + `perfil`: `POST`, não `GET`, porque gasta chamada de modelo; o
atual devolvido junto do proposto, nunca por cima. `src/lib/calibracao.ts` segue as invariantes dos
outros três prompts: `PROMPT_VERSION_CALIBRACAO = "calibracao-1"`, `INSTRUCOES`, parser tolerante
próprio, `temperature: 0`, `modeloCalibracao()` (`CALIBRACAO_MODEL`, padrão o da extração — regra
8).

**Quatro amarras contra o inchaço:** no máximo 2 regras por rascunho; toda regra cita os
`Correcao.id` que a motivam; regra que contradiz uma seção existente diz qual ela substitui; nunca
propor regra a partir de uma correção só.

A tela mostra, por correção: o selo do agente, `antes → depois`, o trecho, e `▶ mm:ss` quando há
âncora — reusando `localizarNoAudio` e buscando `GET /extracao` sob demanda. Mostra também o
arquivo de regras inteiro, editável e apagável, e os `descartados` da extração agrupados por
motivo — hoje carregados pela revisão e nunca renderizados.

### A sugestão de calibrar: a cada 3 semanas, nunca um número

```ts
export const INTERVALO_SUGESTAO_DIAS = 21; // 3 semanas

export function sugerirCalibracao(indice: IndiceCalibracao, agora: number = Date.now()): boolean {
  const abertas = indice.correcoes.filter((c) => c.incorporada_em === null);
  if (abertas.length === 0) return false; // nada para calibrar, nunca sugere

  const referencia = indice.visitado_em ?? maisAntiga(abertas).em;
  return diasEntre(referencia, agora) >= INTERVALO_SUGESTAO_DIAS;
}
```

A contagem parte de `visitado_em` — a última vez que `/calibracao` de fato carregou — ou, se eu
nunca visitei, da correção em aberto mais antiga. Sem correção em aberto, nunca sugere.

**Binário, não numérico**: a gaveta da `Gestao` mostra a linha ou não mostra — nunca "3 semanas e
12 correções", nunca no ícone da engrenagem em `/`. Abrir `/calibracao` reseta o relógio por mais 3
semanas, aprovando algo ou não — olhar já conta. `Gestao.tsx` consulta `GET /api/calibracao/sugestao`
(puro) ao abrir a gaveta; só a carga real de `/calibracao` reseta o relógio, para a sugestão ter
chance de valer os 21 dias inteiros.

## 6. O botão "faltou um", na revisão

Custo reconhecido e aceito: qualquer gesto de "faltou isto" custa toque numa tela que tem que
resolver em menos de um minuto (visão §8). O desenho paga o mínimo — um controle no rodapé, fora da
lista de átomos, fechado por padrão. O caso comum não muda: aprovar tudo continua um toque, e
ignorar não custa nada (visão §5.3).

O texto passa por `criarLocalizador` (`offsets.ts`) contra a transcrição: casando, a correção nasce
ancorada no áudio de graça; não casando, vale como texto. Viaja em `gestos.faltantes` — nenhuma
rota nova.

## Antes/depois, sem inventar métrica

`extrairSessao({forcar:true})` copia a proposta atual para `extracao-anterior.json` antes de
sobrescrever — guarda só a última tentativa. `GET /extracao` devolve `anterior` como cabeçalho
(`{atomos, prompt_version, criado_em}`); a lista completa vem com `?anterior=1`. Na revisão, quando
as versões diferem, uma linha discreta com `[ver a anterior]` renderiza a lista antiga somente
leitura, sem checkbox e sem editor.

Sem diff colorido, sem "melhorou/piorou", sem placar — é a única defesa contra regressão silenciosa
que esta fatia pode oferecer, e ela é olho no olho, não número.

## Ambiente

```
CALIBRACAO_MODEL   opcional; padrão igual ao da extração
```

Pelo `src/lib/modelos.ts`, string `provedor/modelo`, pelo Gateway (regra 8).
`tests/gateway.test.ts` continua sendo a guarda.

## Idempotência

| Trava | Onde |
|---|---|
| `ja_confirmada` | já barra o segundo confirmar; correção não é apurada duas vezes na mesma sessão |
| `correcoes.json` com `ifNoneMatch:"*"` | reenvio não sobrescreve o registro permanente |
| índice com `If-Match` + retry | fusão de correções concorrentes não se perde |
| `Correcao.id` condicional ao tipo | correção de átomo, de entidade e "faltou" nunca colidem entre si |
| `regras-<hash>.json` imutável | reaprovar a mesma composição de regras não cria versão nova |
| rascunho não escreve | só `POST .../regras` grava, e só com o meu toque |

## Ordem de construção

Cada passo deixa o sistema funcionando:

1. `tipos.ts` + `chaves.ts` — os tipos e as chaves novas, nada mais.
2. `apurarCorrecoes` pura, com teste completo, antes de qualquer rede.
3. `montarGestos` no cliente; o corpo do confirmar passa a mandar `gestos`.
4. Apuração e registro em `waitUntil` dentro de `confirmar/route.ts`; `juntarNoIndice`.
5. **Parar aqui e confirmar uma sessão real**, lendo `indice.json` cru — antes de escrever tela.
6. `GET /api/calibracao` + a tela `/calibracao`.
7. `extracao-anterior.json` no `forcar` + o toggle na revisão.
8. As regras, `calibracao-1`, e a sugestão de calibração.

**Parar depois do 5 já entrega a captura inteira.** Do 6 em diante é a leitura e o loop de
aprovação.

## Critérios de aceite

1. Rejeitar, editar texto/tipo ou trocar o sujeito de um átomo produz uma `Correcao` no índice,
   sem eu tocar em nada além do que já toco na revisão hoje.
2. Renomear duas entidades diferentes na mesma sessão (ou a mesma entidade em duas sessões)
   produz **duas** correções distintas no índice, nunca uma sobrescrevendo a outra.
3. Digitar uma grafia que casa com um nó existente (canonização) **não** produz correção nenhuma.
4. Sem regra aprovada, a extração de uma sessão nova é byte a byte igual à de antes desta fatia, e
   `PROMPT_VERSION` sai sem sufixo.
5. Aprovar uma regra em `/calibracao` grava um snapshot imutável, atualiza a versão corrente, e a
   **próxima** extração já sai com `prompt_version` sufixado — sem deploy.
6. As correções citadas pela regra aprovada saem do próximo rascunho; a correção deixada de fora
   continua aparecendo.
7. Um índice sem correção em aberto nunca sugere calibração, não importa o tempo passado.
8. Uma correção em aberto há mais de 3 semanas, sem visita a `/calibracao`, acende a sugestão na
   gaveta da `Gestao` — nunca no ícone da engrenagem em `/`, nunca como número.
9. Abrir `/calibracao` apaga a sugestão da gaveta por mais 3 semanas, aprovando regra ou não.
10. Falha ao gravar correção não impede nem atrasa a confirmação no grafo.
11. `pnpm test` passa sem edição nos testes que já existem.

## Fora de escopo

- **Calibrar `resolucao-2` ou a higiene de entidade.** Capturados e etiquetados; consumidos numa
  fatia futura, um agente de cada vez.
- **Qualquer métrica, gabarito ou percentual de qualidade.** Proibido por `CLAUDE.md`, e esta
  fatia não é a exceção.
- **Desfazer uma aprovação de regra.** `git revert` no commit do `INSTRUCOES_BASE` continua sendo
  o mecanismo para a base; para uma regra aprovada, o caminho é aprovar uma regra nova que a
  revogue, não apagar o snapshot.
- **Editar a citação de correções de uma regra rascunhada.** `cita` é do `calibracao-1`, imutável
  na tela — só `texto` é meu para editar.

## Limites conhecidos que esta fatia herda ou cria

- **Regra nova pode piorar o que já presta, e nenhum teste automático vê.** Consequência direta de
  não haver medida automática de qualidade. As defesas são o teto de 12 regras, o
  `extracao-anterior` lado a lado, as quatro amarras do `calibracao-1`, e o índice fechado por
  `incorporada_em` — nenhuma delas é métrica, todas dependem do meu julgamento na revisão seguinte.
- **O prompt passa a ter duas fontes** — `INSTRUCOES_BASE` no git, as regras no R2. O hash e os
  snapshots imutáveis impedem que a procedência minta, mas ler o prompt efetivo passa a exigir os
  dois lugares, e `git revert` sozinho não reverte mais o prompt inteiro.
- **As primeiras regras nascerão de um punhado de correções.** Risco de generalizar demais um caso
  só; mitigado por nunca propor regra a partir de uma correção isolada.
- **A sugestão é sob demanda de olhar, não de agir.** Correção pode continuar em aberto
  indefinidamente se eu abrir `/calibracao`, ver, e não pedir rascunho nenhum — é decisão minha, e
  "ignorar é sempre saída válida" (visão §5.3) vale também aqui.
- **Registro best-effort.** `waitUntil` morto perde as correções daquela sessão, sem recuperação —
  o grafo já recebeu os átomos antes disso rodar, então nada do diário se perde, só o material de
  calibração daquela sessão.
- **Ruído de canonização quando `gestos` não chega** (cliente antigo, corpo montado à mão) é
  mitigado pelas duas travas do §1, não eliminado.
- **Correções de `resolucao` e `grafo` acumulam sem consumidor** até uma fatia futura as calibrar.

## Depois desta fatia

Com o loop fechado para a extração, a próxima calibração possível é o `resolucao-2` — as
correções de `sujeito`/`mencao_*` já estão sendo capturadas e etiquetadas, só falta um
`calibracao-1` que leia esse recorte e proponha regra para o agente 2. A higiene de entidade
(`entidade_renomeada`) aponta para o mesmo padrão, se um dia a lista de renomes justificar.
