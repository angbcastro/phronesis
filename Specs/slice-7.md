# Slice 7 — O laço de retroalimentação deixa de ser da extração

**Objetivo:** que a correção que eu faço em **qualquer** agente vire ajuste no
prompt **daquele** agente, sem deploy, pelo mesmo caminho que a extração já usa
desde a 4.6 — e que o ajuste seja uma **emenda**, não uma reescrita.

**Pronto quando:** eu abro `/calibracao`, vejo as correções agrupadas por agente,
escolho um, peço os padrões, confirmo um deles, peço a redação, leio o que mudou
seção por seção, aprovo — e o próximo átomo daquele agente sai carimbado
`<agente>-N+p<hash>`, com o prompt novo em vigor e sem nenhum deploy no meio.

## Por que agora

O sistema tem um laço fechado só. A 4.6 construiu o mecanismo inteiro — captura,
acúmulo, generalização, entrega, snapshot imutável, hash no carimbo — e o cabeou
a um agente: `paraCalibrar` filtra `agente === "extracao"`, `regras_correntes` é
um ponteiro só, e `regras()` tem um consumidor só. Os outros **dez** agentes com
prompt mudam por duas vias, e nenhuma é aprendizado: eu reescrevo o prompt à mão
no painel, ou um commit sobe (`chat-1`→`chat-2`, `PISO_BUSCA` 0,30→0,45).

E o material já está lá: `resolucao` e `grafo` acumulam correções etiquetadas
**sem consumidor** desde a 4.6, o que `ARCHITECTURE.md` §14 declara há três
fatias.

## As decisões

Perguntadas na entrevista de 14/09, antes de qualquer linha de código.

### A regra deixa de ser apêndice permanente e vira a pauta de uma emenda

A pergunta foi se o canal de aprendizado continuava sendo regra imperativa, e a
resposta foi mais forte: **as correções devem alimentar um sistema que avalia o
prompt inteiro do agente e decide a melhor forma de ele passar a considerar o que
eu quero.** Não um apêndice colado antes do `FORMATO` — o corpo do prompt.

O canal de entrega disso **já existe e não precisa ser inventado**:
`gravarOverride` (slice 4.7) grava prompt inteiro em
`config/prompt-<agente>-<hash>.json`, imutável, carimbado `+p<hash>`, com
`envelopeFaltando` recusando um prompt que pare de pedir o JSON que o parser lê.
O que falta é **quem escreve a proposta**.

Consequência aceita: `regras.ts` sai do caminho de montagem. As fontes do prompt
caem de três para duas (a base do git e o prompt aprovado), o que derruba o custo
que §14 declara desde a 4.6 — "ler o prompt efetivo exige os três lugares".
`versaoDeRegras` e `hashDeTexto` **ficam**: um átomo de três meses atrás carimbado
`extracao-9+a3f91c7d` tem de continuar resolvendo para o texto que o produziu.

### Dois passos, e eu confirmo entre eles

O redator **não pode** sair reescrevendo. A exigência da entrevista foi
explícita: alterações incrementais, conforme padrões identificados previamente e
que eu confirmo antes — o fluxo das regras, preservado na forma.

```
correções em aberto do agente X
        │
        ▼  calibracao-2   (paramétrico por agente)
   ≤2 PADRÕES, citando os Correcao.id       ← eu confirmo, edito ou descarto
        │
        ▼  redacao-1
   EDIÇÕES POR SEÇÃO do prompt de X         ← eu aprovo lendo o que mudou
        │
        ▼  gravarOverride(X, { prompt })
   prompt novo em vigor, carimbo +p<hash>, correções fechadas
```

São **dois agentes e não um**, com `prompt_version` própria cada um, pela mesma
razão que separou `resolucao-5` de `desempate-1`: calibram separado, e um erro de
redação se conserta sem tocar em quem enxerga padrão.

### A conservação é estrutural, não um pedido no prompt

O redator devolve **`edicoes`, nunca o texto inteiro**. Ele não consegue tocar o
que não nomeou, porque o que ele não nomeia nunca sai do servidor. Amarra que
vive só no texto do prompt é amarra que o modelo ignora num dia ruim — e o que
esta protege é a coisa que produz todo o resto.

Seis amarras, todas no parser de `redacao.ts`:

| Amarra | Por quê |
|---|---|
| no máximo **2 seções** por rodada | mais que isso não é emenda, é reescrita |
| só `reescrever`, `acrescentar`, `criar` — **não existe `apagar`** | apagar seção é decisão minha, no editor de `/agentes` |
| toda edição aponta um padrão confirmado, e todo padrão cita ≥2 `Correcao.id` | herdada da 4.6: um caso não é padrão, é um caso |
| seção nomeada tem de existir no prompt corrente (salvo `criar`) | seção inventada iria ao prompt apontando para nada |
| seção não citada volta **byte a byte** | por construção — ela nunca sai do servidor |
| `envelopeFaltando` sobre o texto resultante → 400 | já existe desde a 4.7, e continua sendo a última porta |

**Nove dos dez prompts já têm cabeçalho de seção.** `duplicatas` não tem: ganha
cabeçalhos no git e vira `duplicatas-2`. Sem cabeçalho não há seção, e sem seção
a única operação possível seria "reescrever tudo" — exatamente o que esta fatia
existe para não permitir.

### O relógio da sugestão passa a ser por agente

Hoje `visitado_em` é um só e `sugerirCalibracao` conta **todas** as correções em
aberto, mas `rascunharRegras` só lê as de `extracao` e recusa com menos de duas.
Uma sessão que só produza correção de `resolucao` acende "tem o que olhar" e leva
a uma tela que não consegue rascunhar nada. Com o laço aberto para todos, isso
deixa de ser inconsistência e passa a ser erro: o relógio é por agente, e a
gaveta acende quando **algum** agente tem o que olhar.

## O escopo

### Entra

1. **`Correcao.agente` passa a ser `AgenteId | "grafo"`.** `AGENTES_CORRECAO`
   sai. `"extracao"` e `"resolucao"` já são `AgenteId`, então o que está gravado
   no R2 hoje migra sozinho — nenhuma conversão, nenhuma perda.
2. **`Regra` vira `Padrao`**, com `agente`, `confirmado_em` e `aplicado_em`.
   Mesma forma (`id` atribuído no rascunho e imutável — é ele que torna
   "sobreviveu à minha edição" bem definido; `texto` editável; `cita` do agente e
   imutável), destino diferente. Vive no índice para sobreviver a eu fechar a aba
   entre os dois passos. `regras_correntes` sai do índice: o ponteiro do prompt
   em vigor já mora em `config/agentes.json`.
3. **`calibracao-2`**, paramétrico por agente.
4. **`redacao-1`**, agente novo, com caixa no painel e `REDACAO_MODEL`.
5. **`aplicarEdicoes`**, pura, e as seis amarras.
6. **`/calibracao` por agente**, com o passo da redação mostrando o que mudou
   seção por seção.
7. **`duplicatas-2`**, com cabeçalhos.

### A dobra que não pode ser esquecida

Tirar `regras()` do caminho de montagem **muda o prompt da extração em silêncio**
se houver regra em vigor no R2 hoje. Então a primeira rodada de `extracao` recebe
cada regra em vigor como **padrão já confirmado**, para ela ser incorporada ao
corpo do prompt em vez de sumir no primeiro deploy. É o único ponto desta fatia
em que algo muda sem eu aprovar.

### Não entra

- **Nenhuma captura nova.** Os pontos onde o gesto já existe mas nada é gravado
  (`perfil`, `enriquecimento`, `duplicatas`, `desempate`) são a 7.1; os gestos
  que nem existem (`confronto` por relação, `chat`, renomear conversa) são a 7.2.
  Esta fatia abre o **consumo**; sem ela, capturar não teria para onde ir.
- **Nenhuma métrica de qualidade.** O sinal de convergência — há quantas sessões
  eu não corrijo nada de um agente — é contagem dos meus gestos, não nota de
  modelo, e mesmo assim fica para a 7.2.
- **Modelo e limiar continuam sendo meus**, no painel. O redator escreve texto de
  prompt e mais nada.

## Limites que esta fatia cria

- **Uma emenda aprovada depressa pode piorar um prompt calibrado em nove
  versões, e nenhum teste automático vê.** É a mesma consequência que a 4.6 já
  declarou para a regra, agora sobre o corpo do prompt. As defesas são as seis
  amarras, o `anterior` do snapshot (um passo de desfazer no painel) e o meu olho
  na revisão seguinte. Nenhuma delas é medida.
- **O prompt efetivo deixa de ser legível só pelo git**, e isso não é novo — a
  4.7 já abriu essa porta. O que muda é a frequência com que ela é usada.

## Como ficou

O que o `ARCHITECTURE.md` contava desta fatia — datas, medições, o que era
antes —, movido quase literal quando ele passou a descrever só o presente
(`Specs/documentacao.md`).

### Do cabeçalho do `ARCHITECTURE.md`

**A 7 é a fatia que muda o que "calibrar" quer dizer.** Até ela o sistema tinha
**um** laço fechado — correção na revisão → `calibracao/indice.json` →
`calibracao-1` → regra aprovada → apêndice no prompt de extração — e ele valia
para um agente só; os outros dez com prompt mudavam por deploy ou por eu
reescrever o texto no painel. A 7 abre o laço para todos e troca o mecanismo: a
regra deixa de ser apêndice permanente e vira **a pauta de uma emenda**. O
`calibracao-2` diz que padrão as minhas correções de um agente revelam, eu
confirmo, e o `redacao-1` escreve a mudança **seção por seção** no corpo do
prompt daquele agente (§4.12). As fontes do prompt caíram de três para duas.

*Fora de fatia, no mesmo período (12/09): o deploy.*

**E o sistema saiu do `localhost`.** Ele roda na Vercel, no plano Hobby, com o
grafo de produção na instância Aura que sempre teve as sessões reais e um segundo
banco só para o `pnpm dev` (§12.1). Push em `master` vai a produção direto, e a
migration roda no build — a aprovação passou a ser o ato de mandar buildar
(`CLAUDE.md`). A porta de entrada é o magic link entregue pelo Resend, o cookie de
90 dias agora **desliza** em vez de vencer, e o app se instala na tela inicial do
Android (§7, §2). Uma batida diária grava o dump do grafo no R2 e impede a
instância Free de ser pausada por 72 h de silêncio (§9, §10).

O que o deploy destrava não é conforto: é a **medição**. A 4.11 e a 4.12 esperam
uma sessão real, e o telefone é onde eu falo.

Até a slice 7 esse laço era **da extração e só dela**, e o que ele produzia era
um apêndice colado antes do `FORMATO`. Ver §4.12 para o que mudou e por quê.

A 4.6 está construída inteira, e a **7 a refez**: captura para todo agente, a
pauta, a emenda e os dois passos que eu confirmo. O que falta é **uso** —
nenhuma emenda foi aprovada ainda, e enquanto não for, todo prompt continua
saindo byte a byte igual ao do git.

### Do §14 (limites conhecidos)

*Fora de fatia, no mesmo período (14/09): a colisão de `.quando`.*

- **`.quando` era uma classe global com dois significados** — o selo do painel
  de agentes (0,6 rem, caixa baixa, borda pílula) e o nome da sessão e da
  entidade. `.lista-sessoes .quando` tinha especificidade maior mas não
  redeclarava nenhuma das três propriedades, então todo nome próprio de
  `/sessoes` e `/entidades` saía a 0,6 rem dentro de uma pílula. **Resolvido**:
  a regra do selo passou a ser `.agentes .quando, .editor-agente .quando`, e
  `.voltar` — que era global com `margin-top: 2rem` e ia vazar para o `←` da
  ficha — virou `.leitura .voltar, .revisao .voltar` na mesma passada. O limite
  que fica é o de fundo: `globals.css` é uma folha global sem escopo por
  componente, as duas colisões achadas foram achadas **lendo**, e nada impede a
  próxima além de escopar por hábito. Um teste não pega isto: o que mede
  cascata é o navegador.

*Fora de fatia, no mesmo período (12/09): o bloco vazio.*

- **Bloco vazio por defeito do provedor é indistinguível de silêncio** (§5.4).
  Desde 09/09 um bloco sem transcrição vira bloco vazio em vez de derrubar a
  sessão, e um tropeço do STT que devolva nada passaria por pausa. O único sinal
  é a linha `[pipeline] … STT não ouviu fala` no log, uma por bloco vazio; não
  há checagem de energia do áudio antes de aceitar o vazio, e não vai haver
  enquanto o log bastar.

*Fora de fatia, no mesmo período (12/09): o deploy.*

- **Gravação com a tela apagada continua não medida.** O `wakeLock` mantém a tela
  acesa enquanto grava, e com isso a aba nunca vai a segundo plano — a pergunta
  de se o Chrome no Android estrangula o `setTimeout` de 30 s do gravador
  (§3.1) fica **sem resposta**, não respondida. Página capturando mídia costuma
  ser isenta; ninguém verificou aqui. Sistema que recuse a trava por bateria
  baixa grava do mesmo jeito, e nesse dia a pergunta volta.

- **Uma emenda aprovada depressa pode piorar um prompt calibrado em nove
  versões, e nenhum teste automático vê.** É a mesma consequência que a 4.6
  declarava para a regra, agora sobre o corpo do prompt, e portanto maior: o
  apêndice se revogava tirando uma linha da lista, a emenda só se desfaz pelo
  `anterior` do snapshot. Consequência direta de não haver medida automática de
  qualidade — e não vai haver. As defesas são as seis amarras do `redacao-1`
  (§4.12), o teto de duas seções por rodada, o `extracao-anterior` lado a lado e
  o índice fechado por `incorporada_em`. Nenhuma é métrica; todas dependem do meu
  julgamento na revisão seguinte.

- **`grafo` continua sem consumidor, e agora por um motivo.** `resolucao` ganhou o
  dele na slice 7, quando `paraCalibrar` passou a receber o agente; `grafo` não é
  agente, não tem prompt e não há o que emendar com ele. Ele aparece na porta de
  `/calibracao` sem botão, e ocupa vaga no teto de 500 do índice como qualquer
  outra correção. Quem conserta grafia é o vocabulário do STT — slice 7.2.

### Do §4.1–4.7 (o pipeline)

**Eram três blocos até a slice 7**, e o primeiro era o das regras aprovadas. Ele
saiu porque a correção deixou de virar apêndice e passou a virar emenda no corpo
do prompt (§4.12): o que a 4.6 colava a cada chamada agora está escrito dentro do
texto que `efetivo("extracao", …)` devolve.

### Do §4.11–4.13 (calibração e o painel)

O prompt de extração teve **três fontes** entre a 4.6 e a 7: `INSTRUCOES_BASE`
no git, as regras aprovadas no R2, e o prompt que eu editei no painel (§4.13).
Ler o prompt efetivo exigia os três lugares, e `git revert` sozinho não revertia
mais o prompt inteiro — custo declarado no §14 por três fatias.

**Agora são duas, e o laço vale para todos os agentes.** É a mesma frase, e as
duas metades vieram da mesma decisão: o que a correção produz deixou de ser um
apêndice colado antes do `FORMATO` e passou a ser uma **emenda no corpo** do
prompt daquele agente — entregue pelo canal que a 4.7 já tinha aberto
(`overrides.ts`), com snapshot imutável e `+p<hash>` no carimbo.

#### Por que o mecanismo mudou

A 4.6 cabeou um mecanismo genérico a um agente só. `paraCalibrar` filtrava
`agente === "extracao"`; `regras_correntes` era um ponteiro só; `regras()` tinha
um consumidor só. `resolucao` e `grafo` acumulavam correções **etiquetadas e sem
consumidor** desde então, e os outros nove agentes não emitiam nada.

O pedido que abriu a 7 foi mais forte que "generalizar as regras": que as
correções alimentassem algo que **avalia o prompt inteiro do agente** e decide a
melhor forma de ele passar a considerar o que eu quero. Um apêndice não faz
isso. Metade das correções reais é reescrita de texto de 200 a 660 caracteres —
isso é voz, e uma linha imperativa no fim do prompt não ensina voz.

E o pedido veio com a amarra que define a fatia: **o redator tem de ser
conservador**. Nada de reescrever tudo; alterações incrementais, conforme
padrões identificados antes e que eu confirmo.

O `Padrao` é a `Regra` da 4.6 com outro destino. A forma é idêntica, e de
propósito: `id` atribuído no rascunho e nunca editável — é ele que torna
"sobreviveu à minha edição" bem definido —, `texto` o único campo que a tela
deixa mexer, `cita` do agente e imutável porque é a procedência. O que mudou é o
fim: a regra virava apêndice para sempre; o padrão vira pauta, é incorporado ao
corpo do prompt, e se aposenta com `aplicado_em` preenchido.

**Padrão que eu corto antes de redigir deixa as correções que o motivavam em
aberto**, e elas voltam na próxima rodada. É o que faz "descartar" ser diferente
de "endereçar" — a mesma promessa da 4.6, no gesto novo.

A seção do envelope é achada **pelo conteúdo, não pelo nome**: eu posso ter
renomeado o cabeçalho ao editar o prompt no painel, e o que define a seção é ela
pedir o JSON. `lastIndexOf` pelo mesmo motivo que a 4.6 usava
`lastIndexOf(CABECALHO_FORMATO)` — quando uma chave aparece no corpo **e** no
envelope, é a última ocorrência que é o envelope.

**`criar` entra antes da seção do envelope**, e não no fim do texto. Foi o
primeiro defeito desta fatia, achado ao escrevê-la: o `FORMATO` costuma ser a
última seção, e uma seção nova depois dele seria lida como parte do exemplo de
JSON — exatamente a armadilha que `inserirAntesDoFormato` evitava desde a 4.6.

**Nove dos dez prompts já tinham cabeçalho de seção** antes desta fatia.
`duplicatas` não tinha: ganhou cabeçalhos no git e virou `duplicatas-2`. Sem
cabeçalho não há seção, e sem seção a única operação possível seria "reescrever
tudo" — o que a fatia existe para não permitir.

Tirar `regras()` do caminho de montagem mudaria o prompt da extração **em
silêncio** se houvesse regra em vigor no R2: o apêndice simplesmente deixaria de
ser colado, e a primeira sessão depois do deploy sairia extraída por um prompt do
qual eu nunca tirei nada.

`regras.ts` ficou só de leitura. `versaoDeRegras` e `hashDeTexto` continuam de
pé, e não são legado inútil: um átomo carimbado `extracao-9+a3f91c7d` em setembro
precisa resolver para o texto que o produziu, para sempre, e snapshot imutável só
cumpre a promessa se alguém ainda souber lê-lo.

#### O objeto no R2 é mais velho que o tipo, e vai ser sempre

`IndiceCalibracao` ganhou `padroes` nesta fatia e perdeu `regras_correntes`. O
objeto gravado na 4.6 não sabe disso, e ler `o?.valor` cru entregava um índice
com `padroes: undefined` que estourava no primeiro `.filter` de quem o
recebesse — `GET /api/calibracao` devolveria 500 para quem já tivesse corrigido
qualquer coisa, e continuaria devolvendo, porque `marcarVisita` e
`confirmarPadroes` quebram na mesma linha.

#### O relógio da sugestão, agora por agente

`visitado_em` era uma string só. Com o laço aberto para todos isso virou erro:
abrir a tela de um agente adiava por três semanas a sugestão de **todos** os
outros, e o material deles ficava parado sem nada acender. Agora é um mapa por
`AgenteId`, e `sugerirCalibracao` conta só as correções daquele agente.

Isso conserta de quebra um defeito que a 4.6 tinha e ninguém tinha visto: a
sugestão contava **todas** as correções em aberto, mas `rascunharRegras` só lia
as de `extracao` e recusava com menos de duas. Uma sessão que só produzisse
correção de `resolucao` acendia "tem o que olhar" e levava a uma tela que não
conseguia rascunhar nada.

Não entra mais por injeção, e é a mudança da slice 7: o que a calibração produz é
uma **emenda ao texto** deste mesmo objeto (§4.12), gravada por `gravarOverride`
como qualquer edição minha. Prompt editado no painel e prompt emendado pela
calibração são a mesma coisa para o sistema — mesmo snapshot, mesmo `+p<hash>`,
mesma última porta em `envelopeFaltando`.

Uma consequência boa e uma ruim. A boa: o prompt efetivo voltou a ser **um texto
num lugar só**, que se lê inteiro no painel. A ruim: eu e o `redacao-1` escrevemos

### Do §5 (estados da sessão)

*Fora de fatia, no mesmo período (09–12/09): o bloco mudo.*

Até 09/09 isso derrubava a **sessão inteira**. O erro é determinístico: o laço de
`finalizarSessao` insistia no mesmo bloco mudo pelos 150 s de `ESPERA_MAX_MS`,
sempre com a mesma resposta, e depois mandava tudo para `erro`. Medido na sessão
`mtu336r50a5i4j3k2o1g`: 9 blocos, 7 com fala, os blocos 4 e 8 com RMS de 0,004
contra 0,11 dos outros. Quatro minutos e meio de diário perdidos por duas pausas
minhas — e o diagnóstico custou baixar os WAV do R2 e medir, porque o log dizia
"não transcreveu" para silêncio e para defeito com as mesmas palavras.

**O que se perde:** um tropeço do provedor que devolva nada tem exatamente a
mesma cara que silêncio, e agora vira bloco vazio em silêncio em vez de erro
barulhento. A troca foi feita de olho aberto — o outro lado dela era perder a
sessão inteira toda vez que eu faço uma pausa —, e o sinal é a linha
`[pipeline] … STT não ouviu fala — bloco vazio`, que sai em todo bloco vazio.
Transcrição com um buraco se confere ali, contra o áudio, que está intacto no R2.

### Do §11 (telas)

*Fora de fatia, no mesmo período (12/09): o PWA.*

`CLAUDE.md` decide PWA como stack, e o que existe é o mínimo que faz o app
**instalar** e abrir sem barra de navegador:

| Peça | Onde | O que dá |
|---|---|---|
| `public/manifest.webmanifest` | `display: standalone`, `start_url: "/"`, `theme_color: #0d0d0d`, ícone `/icone.svg` | o "adicionar à tela de início", e o app abrindo sem barra |
| `metadata.manifest` | `layout.tsx` | é o que põe o `<link rel="manifest">` no HTML |
| `viewport.viewportFit: "cover"` | `layout.tsx` | a tela chega até a borda no iPhone, por baixo do notch |
| `matcher` do middleware | `src/middleware.ts` | manifest e ícone respondem sem cookie, senão o navegador não os busca (§7) |

**Não há service worker, não há cache offline e não há instalação promovida.**
Gravar sem rede não funciona: o `getUserMedia` até abre, mas o bloco não sobe e
`Processando` não fecha a sessão. O que protege a fala nesse caso é o IndexedDB
(§3.2), que segura o bloco até a rede voltar — proteção da fila, não do app.
Quem lê "PWA" em `CLAUDE.md` e espera funcionar no avião vai encontrar menos do
que espera, e é por isso que está escrito aqui.

*Fora de fatia, no mesmo período (14/09): a ficha sai da linha.*

Cada linha carregava **nove controles**: a caixa do lote, o nome, a estrela de
canônica, uma meta de até seis fatos, o `select` de tipo, renomear, canônica e
ficha — num `flex` sem `wrap`. A ficha abria como acordeão dentro da própria
linha, empurrando a lista para baixo. Num aparelho de 390 px, que é onde este app
vive, nada disso se lê nem se acerta com o dedo. O que existe agora:
