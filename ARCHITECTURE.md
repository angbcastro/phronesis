# Arquitetura

Como o Phronesis está construído hoje. Descreve o **sistema que existe**, não o
que está planejado — para o produto ver `Specs/visao.md`, para as regras
invioláveis `CLAUDE.md`, para o escopo da fatia atual `Specs/slice-8.2.md`.

> **Este arquivo acompanha o código.** Toda mudança que altere fluxo, contrato,
> layout de dado, dependência externa ou fronteira de segurança atualiza este
> arquivo no mesmo commit. Ver "Manutenção deste arquivo" no fim.

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

**A slice 9 está aberta, e só o primeiro passo dela está no ar.** A fatia
(`Specs/slice-9.md`) é o miolo do chat — como a pergunta vira busca e como a busca
vira resposta —, e ela sobe em partes de propósito, pela disciplina que a slice 8
fixou: o que mede e o que conserta não sobem juntos. O que está feito é o **prompt
`chat-3`** (§4.16.2): a resposta responde antes de despejar, e busca paralela passou
a ser autorizada. O que **ainda não existe**: a busca dizer quanto cortou e por que
voltou vazia; o catálogo e o vetor lidos uma vez por pergunta; a terceira ferramenta
`buscar_entidades`; e o streaming do texto final, que é condicional e pode não
acontecer. Entre este passo e o próximo vai **uma pergunta real respondida e
julgada à mão** — e antes dela, a medição de `CHAT_MODEL`, que a fatia põe na frente
de todo o resto porque é a única que não custa deploy.

**A 8.2 era condicional, e a condição se cumpriu.** A `Specs/slice-8.md` declarou
que ela só existiria "se o número desta continuar ruim"; as sessões reais
gravadas desde 18/09 mostraram 119–301 s de espera e uma sessão presa por dois
dias, então a fatia subiu (§4.19). O que ela muda é o instante em que a revisão
abre: não mais quando a proposta fecha, e sim quando o **primeiro átomo** existe.
No mesmo deploy, o teto de saída da extração subiu de 8000 para 16.000 tokens
(§4.6) — decisão tomada contra a evidência já registrada de que subir o número
não resolve sozinho, e com o escalonamento preservado por cima dele.

**A slice 8 sobe em partes, e a ordem não é detalhe.** A primeira é só o
cronômetro (§4.17): três objetos no R2, as três marcas do cliente, a
instrumentação nos passos que já existem e o resumo mensal na batida diária.
Nenhum conserto de desempenho vai junto — se instrumento e conserto subissem no
mesmo deploy, não se saberia o que melhorou, e a fatia inteira existe para saber.
Depois vêm os seis consertos e o penhasco virando erro (§4.18). Entre as duas vai
**uma sessão real gravada**, com o `medidas.json` dela lido.

**A linha de base foi colhida em 2026-09-18, e ela não mediu uma espera: mediu
uma trava.** A sessão `mu73d88b0w4u6o5d440j` (203 s de fala, 7 blocos) ficou
presa em `extraindo` e nunca abriu a revisão. Tudo no pipeline foi rápido — fila
do cliente 2,7 s, STT 7,2 s somados, catálogo 88 ms, camada semântica 513 ms — e
**uma única chamada de extração gastou 300.116 ms sem devolver um token**,
morrendo no `headersTimeout` do undici, que é o mesmo `maxDuration` de 300 s da
rota. Isso refutou a suspeita que estava escrita: o custo não era a resolução da
janela do fim.

A consequência entrou **antes** dos seis consertos, e é a quarta classe de falha
do §5.3 — **prazo por chamada de modelo**, mais a medida que sobrevive à função
morta (§4.17) e o corredor com teto (§11). Sem ela os consertos pioravam este
caso exato: `ehTransitorio` passaria a repetir uma chamada pendurada, e no
caminho sem `ate` seriam três de 90 s num `waitUntil` que morre aos 300 s.

Quem fecha a fatia sou eu — a medida existe para dizer *onde* mexer, não para
declarar que ficou bom.

**A 7 é a fatia que muda o que "calibrar" quer dizer.** Até ela o sistema tinha
**um** laço fechado — correção na revisão → `calibracao/indice.json` →
`calibracao-1` → regra aprovada → apêndice no prompt de extração — e ele valia
para um agente só; os outros dez com prompt mudavam por deploy ou por eu
reescrever o texto no painel. A 7 abre o laço para todos e troca o mecanismo: a
regra deixa de ser apêndice permanente e vira **a pauta de uma emenda**. O
`calibracao-2` diz que padrão as minhas correções de um agente revelam, eu
confirmo, e o `redacao-1` escreve a mudança **seção por seção** no corpo do
prompt daquele agente (§4.12). As fontes do prompt caíram de três para duas.

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

**A 4.11 e a 4.12 estão em código e verdes nos testes, e NENHUMA das duas foi
medida numa sessão real.** A migration 009 foi aprovada e aplicada (duas grafias
viraram `aliases`, dois nós apagados); **a 010 está escrita como proposta e não
foi rodada** — ela é no-op (0 statements) e espera aprovação, como o `CLAUDE.md`
manda.

A 4.11 entregou: `resumo`, `aliases` como propriedade e `canonico` no schema
(§8.3.1); uma apresentação só da entidade, lida pelos dois agentes (§4.8);
`extracao-9` e `resolucao-5`; o `TETO_PERFIL` morto; e o `desempate-1`, a segunda
passada que roda quando a confiança fica abaixo do limiar (§4.8.1). Ela deixou o
`resumo` **vazio de propósito**, e com ele vazio quase toda menção caía na
segunda passada.

A 4.12 é o que preenche esse campo: o **agente 4** (`enriquecimento-1`) lê todos
os átomos ligados a uma entidade por `:SOBRE` ou `:MENCIONA` e escreve os quatro
campos da ficha de uma vez — e **grava sozinho**, numa fila assíncrona que anda
sem janela aberta (§4.9). É a reabertura declarada do regime do perfil: a defesa
deixou de ser um toque por campo e passou a ser a seleção, a leitura depois, e o
desfazer de uma geração (migration 010, §8.3.2). **A regra 5 continua intocada** —
ela fala de átomo, e nenhum átomo entra por esse caminho.

**A medida que fecha a 4.12 é uma sessão real depois do lote**: `[desempate]`
calado na maioria das menções quer dizer que o resumo está identificando; se ele
continuar disparando em tudo, o conserto é o prompt do agente 4 (§14).

A primeira sessão longa real **rodou de ponta a ponta e custou quatro chamadas
de modelo para entregar uma** (`mtqoeoqh3e3724514q1f`, 1044 s, 9 átomos em
6 min 46 s). Três coisas saíram dessa medição, e as três são a 4.10: a janela não
existia no caminho importado (o arquivo subia num bloco só, e com um bloco só a
4.8 é inerte); o fallback repetia a chamada que acabara de falhar; e uma resposta
cortada no meio da lista perdia os dez átomos que já estavam inteiros. Agora o
arquivo importado é fatiado em blocos de 30 s como a gravação (§3.0), a resposta
cortada é salva até o último átomo completo (§4.6), e `/sessões` ganhou um botão
para apagar sessão de teste (§10) — porque uma sessão de 17 min fatiada são 35
objetos no R2.
**A verificação que decide a fatia é à mão**: importar o mesmo áudio de 17 min de
novo e comparar com a proposta guardada, olhando o log. `PROXIMA-SESSAO.md` §2
continua sendo a lista do que falta gravar e olhar.
**A tela de revisão foi enxugada depois disso, fora de fatia** (§4.7): o texto do
átomo edita no próprio lugar, a linha de dúvida virou `acho que é X — confirma?`
e a procedência do GraphRAG saiu da vista padrão para um modal atrás do `ⓘ` ao
lado da entidade. Nenhum dado deixou de ser produzido ou gravado — o que mudou é
o que a tela mostra sem eu pedir.
Gravar (ou importar), subir, transcrever, extrair, revisar, confirmar. A
extração acontece **durante** a gravação, janela a janela, e quando eu paro
sobra só a janela do fim; a proposta vai para `extracao.json` e a sessão para
`em_revisao` (seções 4.6 e 5); o confirmar da revisão grava `:Atomo` e
`:Entidade` no Neo4j (seções 4.7 e 8). Sessões reais já foram confirmadas e os
átomos conferidos no banco, com âncoras, `prompt_version` e `modelo`.

**O grafo agora cuida do próprio nome** (seção 8.2). O vocabulário do STT é
gerado das entidades do grafo, em união com `config/vocabulario.txt`; e
`/entidades` é onde eu vejo o que entrou e conserto o que entrou torto —
fundindo duas grafias da mesma coisa, ou dando nome a quem ficou como "meu pai".
**Fundir não apaga: cria alias**, e é isso que faz a grafia morta resolver para
o vencedor na sessão seguinte em vez de renascer como nó novo. Desde a 4.11 são
dois mecanismos e não um: **grafia é propriedade** (`aliases`, editável à mão),
e `:FUNDIDA_EM` ficou significando só o que sempre quis dizer — fusão de duas
entidades reais, que é o registro de uma decisão minha.

**O sistema descobre de quem eu estou falando pelo contexto, e não pela grafia
do nome** (seções 4.8 e 8.3). "Raffa" e "Rapha" são o mesmo som: o STT escreve
uma grafia só para os dois, e a grafia carrega **zero** sinal sobre quem é. Por
isso são **dois agentes e não um** — o `extracao-9` extrai e propõe o nó, e o
`resolucao-5` valida cada menção. Desde a 4.11 os dois leem a **mesma**
apresentação da entidade: o `resumo`, as grafias e a marca de ficha oficial. E o
agente 2 devolve **confiança**, não mais um booleano — abaixo do limiar a menção
vai a uma segunda leitura, que tem a ficha inteira dos candidatos daquela menção
na mão (§4.8.1).
Dúvida **destaca, não trava**: a revisão marca o átomo, mostra o motivo
e o confirmar continua liberado. Sessão em que nenhuma menção tem candidato não
chama o agente 2 e não paga nada.

**A jornada não passa pela transcrição.** Parar de falar leva à tela de
processamento, e dela a revisão abre sozinha quando a proposta fica pronta. O
texto literal é porta de serviço: mora em `/sessao/:id/transcricao` e se alcança
pelo botão "transcrição" na lista de sessões (seção 11). Ler quinze minutos de
transcrição no meio do caminho é o atrito que mata o ritual — a transcrição é
insumo do extrator, não coisa que eu leio todo dia.

**E o grafo passou a comparar significado, não só letra** (seções 4.10 e 8.4).
`:Atomo` e `:Entidade` carregam um vetor de 1536 dimensões, dois índices
vetoriais os indexam, e a resolução de identidade ganhou **duas camadas de
candidato que enxergam sentido**: uma que compara o átomo com o perfil escrito
de uma entidade, e outra em que os átomos vizinhos votam em quem eles já são.
As duas cobrem buracos opostos — a primeira pega quem tem perfil e nenhum átomo,
a segunda pega quem tem átomos e nenhum perfil — e nenhuma delas substitui a
grafia: são **aditivas**, com teto e piso, e uma sessão sem ambiguidade continua
não pagando nada. A camada dos vizinhos herda atribuição passada, e o que a torna
aceitável é que a revisão mostra **quais** átomos elegeram cada sugestão.

**E a importação deixou de ser um caminho à parte** (seções 3.0, 4.5 e 4.6). O
arquivo subia inteiro em `i = 0` — decisão consciente enquanto não havia janela —
e o preço apareceu quando havia: com um bloco só, a extração por janela e o RAG
por bloco ficam **inertes** no caminho importado. Agora o navegador fatia o
arquivo em blocos de 30 s, os mesmos da gravação, e sobe um `chunk_NNN.wav` por
bloco; nada rio abaixo mudou, porque o bloco continua tendo 30 s. Navegador que
não decodifica o formato cai no caminho antigo, inteiro — esta mudança não pode
deixar a importação pior do que ela já era.

**E uma resposta cortada parou de custar a janela toda** (seção 4.6). Estourar o
teto no meio da lista jogava fora os átomos que já estavam completos:
`fecharJsonTruncado` corta no último que fechou e fecha o array, e entre as duas
tentativas fica a que trouxe mais átomos. A revisão avisa quando a proposta veio
de resposta cortada — sem o aviso, uma lista curta parece decisão do modelo em
vez de acidente de teto.

**O caminho automático aguenta o Gateway dizer "devagar"** (seções 4.2.1 e 5.3).
O free tier limita por conta, não por modelo — medido em 02/09, com o mesmo
limite derrubando os dois modelos de STT em disputa —, e uma sessão de 15 min são
30 blocos. STT e extração agora esperam a janela passar em vez de morrer nela, e
a desistência diz quando a causa foi pressa e não defeito. Na mesma medição,
trocar o STT por um modelo que escreve melhor foi **recusado**: o candidato não
tem canal de vocabulário nenhum, e nome próprio errado custa mais que prosa
torta neste sistema.

**E a correção que eu faço na revisão parou de se perder** (seções 4.11 e 4.12).
Até aqui, rejeitar um átomo, editar um texto ou trocar um tipo morria no clique
de confirmar — o servidor até contava os rejeitados, só para descartar o número
na resposta. Agora o confirmar apura, **depois** de gravar no grafo e fora do
caminho da resposta, o que a proposta dizia contra o que eu aprovei, e guarda o
resultado no R2. Nenhum gesto novo na revisão, nenhum node novo, nenhuma
migration: o grafo é o único lugar que essa captura não toca.

Acumulada, ela vira material: em `/calibracao` eu escolho um agente, peço ao
`calibracao-2` os padrões que as minhas correções dele revelam, confirmo os que
fazem sentido, e o `redacao-1` escreve a **emenda** — seção por seção, no corpo
do prompt daquele agente. **A emenda aprovada vale na próxima chamada sem
deploy**, e sem emenda nenhuma o prompt sai byte a byte igual ao do git, o que
faz da fatia um no-op até o meu primeiro toque. Verificado por medição, não por
confiança: 21 correções reais em 5 sessões, e um terço delas mostrou que o maior
erro do pipeline não é o extrator, é o STT ouvindo nome próprio errado (§14).

Até a slice 7 esse laço era **da extração e só dela**, e o que ele produzia era
um apêndice colado antes do `FORMATO`. Ver §4.12 para o que mudou e por quê.

**E os agentes ganharam rosto** (seção 4.13). `/agentes` desenha o fluxo em duas
telas — o que entra no grafo (STT, extração, resolução, a revisão e a higiene) e
o que sai dele (o chat) —, e clicar numa caixa abre o prompt e o modelo
daquele agente, editáveis, valendo na próxima execução e **sem deploy**. O
mecanismo é o da 4.6 generalizado: texto no R2, snapshot imutável por hash,
sufixo no `prompt_version`. Sem override nenhum, todo agente sai byte a byte
igual ao de antes desta fatia, e é `tests/agentes.test.ts` quem cobra isso — mais
a varredura que impede um agente novo de nascer fora do painel.

**E a extração deixou de ser um evento no fim: virou um processo** (seções 4.1,
4.6 e 6). A transcrição já era por bloco de 30 s desde a slice 1, mas tudo o que
vem depois dela esperava eu parar de falar — uma chamada de raciocínio com a
transcrição inteira, mais a resolução, mais os embeddings. Era isso que fazia a
espera entre parar e revisar durar um a dois minutos, contra os "poucos
segundos" que a visão §3 promete. Agora, **a cada quatro blocos transcritos uma
janela de 2 min fecha durante a própria gravação**: extrai, resolve, e soma os
átomos ao acumulado em `parcial.json`. Quando eu paro, sobra a janela do fim.

A janela vê o que as anteriores propuseram e **estende** um átomo em vez de
duplicá-lo — inclusive o `ROTINA`, que é no máximo um por sessão. É esse
mecanismo, e não uma passada de costura no fim, que segura o volume da lista.
`extracao-9` é a `INSTRUCOES_BASE` da 4.7 mais o que a migration 007
acrescentou, e dois blocos injetados — o da janela e, desde a 4.9, o do dossiê;
e numa sessão que cabe numa janela só — arquivo importado, gravação curta — o
bloco some e o prompt sai idêntico ao de antes desta fatia.

**E o extrator deixou de ignorar o grafo** (seções 4.6, 4.14 e 8.2). Era decisão
declarada até a 4.8 — "o prompt da extração não sabe que entidades existem, e é
de propósito" —, e a medição de 04/09 a derrubou: **um terço das 21 correções de
5 sessões reais era conserto de grafia de nome próprio que o STT errou**
("Jean"→"Giampaolo Lepore", "Dapta"→"Adapta"), e nenhuma das duas defesas
existentes alcançava o caso. Agora, a cada bloco transcrito, uma busca de cinco
camadas pergunta ao grafo quem aquele trecho parece citar, e a janela recebe o
**dossiê** das até 30 candidatas antes de extrair. O extrator responde
`{citado, chave}`: a grafia que a transcrição escreveu, e o nó que ele
reconheceu — e escreve o **nome gravado** dentro do texto do átomo, que é onde o
nome errado se fixava, inclusive dentro do vetor.

Três consequências, e as três são decisões: o agente 2 passou a **validar toda
menção** com candidato (o critério 5 da slice 4 morreu de propósito, e sessão
sem ambiguidade passou a pagar); a grafia que eu falei **vira alias do nó** no
confirmar, então "jean" resolve por casamento exato já na sessão seguinte; e a
primeira linha do §8.2 — "nada aqui é automático" — deixou de valer para o nó de
alias, que não é uma fusão porque nasce sem átomo e desfazê-lo é apagar duas
coisas.

**O diário passou a ter história e organização** (migration 007, seções 4.6 e
8.1). `:Atomo` ganhou o tipo `HISTORIA` — o episódio contado com o detalhe que
eu contei, e o único tipo em que o prompt manda **não** resumir, porque a
disciplina de volume que rege os outros sete espremeria uma noite inteira numa
linha. `:Entidade` ganhou o label `:Organizacao` — empresa, ONG, startup,
escola, cliente —, que até aqui nasciam `:Pessoa`, o padrão de quem o extrator
não classifica, ou `:Projeto`, quando ele via trabalho acontecendo. Os dois
prompts subiram junto: `extracao-9` e `resolucao-5`. **Nada é reclassificado
para trás**: a empresa que já está no grafo como `:Pessoa` continua `:Pessoa`
até eu trocar o tipo à mão em `/entidades`.

**E o grafo passou a responder** (seção 4.16). A fatia 6 é o chat que a decisão
de produto da slice 5 já tinha escolhido no lugar da tela Perguntar minimalista
de `Specs/visao.md` §6: uma barra discreta no rodapé da tela inicial que expande
para o centro, com memória de conversa e histórico entre visitas. Por dentro é um **agente com
ferramentas**, e não um pipeline: o modelo decide quais buscas fazer e encadeia
até oito antes de responder, porque "como eu estava depois que terminei com a
Isinha" exige achar a data numa busca para filtrar por ela na seguinte. São duas
ferramentas, as duas só-leitura — `buscar_atomos` (texto por vetor, entidade,
tipos, período, tudo combinável) e `historico_do_atomo` (a cadeia de relações da
slice 5, nas duas direções). A regra 5 fica intocada por decisão declarada:
**nem por ferramenta o chat escreve no grafo**.

O que ainda não existe: `:Foco`, as 2-4 perguntas do ritual, me testar sobre o
que aprendi (a fatia C), e a deduplicação de **átomo** — dizer a mesma coisa em
duas sessões ainda cria dois, só que agora possivelmente ligadas por `:CONFIRMA`
(§4.15).
A 4.6 está construída inteira, e a **7 a refez**: captura para todo agente, a
pauta, a emenda e os dois passos que eu confirmo. O que falta é **uso** —
nenhuma emenda foi aprovada ainda, e enquanto não for, todo prompt continua
saindo byte a byte igual ao do git.
A fatia 6 se apoiou em material que já estava pronto: saber de quem se está
falando, que a slice 4 entrega; achar o que já foi dito sem varrer o grafo
inteiro, que a 4.5 entrega; e comparar o mesmo assunto ao longo do tempo, que a
slice 5 entrega.

---

## 1. Topologia

```
┌─ navegador ─────────────┐   ┌─ Vercel ────────────┐   ┌─ serviços ───────────┐
│ MediaRecorder + wakeLock│   │ middleware (auth)   │   │ Cloudflare R2        │
│ IndexedDB (blocos)      │   │ App Router /api/*   │   │  áudio + JSON        │
│ fila de upload          │   │ waitUntil (STT)     │   │  + backup/ do grafo  │
│ React (11 telas)        │   │ 2 crons diários ────┼──▶│ Neo4j Aura (HTTP)    │
│ PWA instalado (sw.js)   │   │                     │   │  :Sessao + conteúdo  │
└──────────┬──────────────┘   └──────────┬──────────┘   │ Vercel AI Gateway    │
           │                             │              │  → os doze agentes   │
           │  PUT presigned (áudio)      │              │ Resend → magic link  │
           └─────────────────────────────┴──────────────▶ R2                   │
                                                        └──────────────────────┘
```

O cron diário (§10) é a única coisa que entra sem eu abrir o app. Duas coisas
saem de uma consulta só: o dump do grafo no R2, e manter a instância Aura Free
acordada — ela é pausada após 72 h de silêncio, e pausada o hostname nem resolve.
A terceira é R2 puro e não toca o grafo: fechar o resumo mensal das medidas
(§4.17), engolindo a própria falha para não custar as outras duas.

Três planos de dado, cada um com uma responsabilidade única:

| Onde | O que guarda | Por quê |
|---|---|---|
| IndexedDB (navegador) | bloco de áudio até o PUT confirmar | fechar a aba no meio da gravação não pode perder fala |
| Cloudflare R2 | áudio, manifest, transcrição de bloco, transcrição final, proposta parcial e final | blob e texto grande não pertencem ao grafo |
| Neo4j Aura | `:Sessao` com estado e **chaves** do R2; `:Atomo` e `:Entidade` a partir do confirmar | o grafo é para relação e afirmação, não para blob nem para texto corrido |

O áudio **nunca** atravessa uma function da Vercel (regra inviolável 1): o
navegador pede uma URL presigned e faz `PUT` direto no bucket.

## 2. Mapa dos módulos

```
src/lib/          servidor — exceto os módulos puros marcados (client), que não
                  leem credencial nem rede e por isso o navegador pode importar
  env.ts          leitura de variável de ambiente, falha cedo se faltar
  rede.ts         retry de conexão: o que dá para repetir sem duplicar efeito
  limite.ts       o rate limit do Gateway: reconhecer e esperar passar
  neo4j.ts        HTTP Query API (nunca driver Bolt)
  fusao.ts        fundir, renomear, recusar — a escrita de higiene no grafo
  duplicatas.ts   quem parece ser a mesma coisa: string + o modelo, só propõem
  sessoes.ts      repositório de :Sessao (criar, buscar, atualizar com guarda,
                  descartar)
  r2.ts           S3 SigV4 via aws4fetch: get/put/head/delete, presign, PUT
                  condicional — e nenhum LIST, nunca
  chaves.ts       layout do R2 num lugar só + validação de id (barra path
                  traversal) + as chaves de uma sessão inteira, para apagar
  etag.ts         o laço read-modify-write condicional por etag, num lugar só —
                  manifest, parcial, índice de calibração e medidas passam por ele
  manifest.ts     verdade sobre quais blocos existem; escreve por `etag.ts`
  estados.ts      máquina de estados da sessão e as predicadas de leitura
  modelos.ts      porta única de modelo: todo LLM sai pelo Vercel AI Gateway,
                  e o diagnóstico de resposta vazia que os três agentes usam
  embedding.ts    a porta do vetor: texto → embedding, e a string canônica da
                  entidade mais o hash dela. Não fala com o Neo4j
  stt.ts          transcrição — pede o modelo a modelos.ts
  vocabulario.ts  nomes próprios → keyterms do STT
  transcricao.ts  offsets absolutos, prefixo contíguo, concatenação — e o
                  caminho de volta, do segundo para o bloco que o contém  (client)
  texto.ts        normalização, nome_normalizado e lista de pronomes       (client)
  extracao.ts     átomos a partir de uma janela: prompt, JSON estrito, procedência
                  — e o bloco que diz de que minutos ela é e o que já foi proposto
  janela.ts       a unidade de extração: fatiar o manifest, reivindicar a janela,
                  somar o que ela produziu ao acumulado. NÃO fala com modelo
  offsets.ts      trecho do modelo → segundo do áudio (modelo não dá timestamp)
  recuperacao.ts  o RAG por bloco: quem o grafo acha que este trecho cita, em
                  cinco camadas — e o dossiê que a janela mostra ao extrator
  resolucao.ts    agente 2: de quem eu estava falando — atribui menção a menção,
                  com as cinco camadas de candidato, o teto, os pisos e o limiar
                  de confiança
  desempate.ts    a segunda passada: UMA menção abaixo do limiar, com a ficha
                  completa dos candidatos dela. Só lê e devolve
  perfil.ts       os três campos de perfil: ler, gravar, e o agente 3 que rascunha
  enriquecimento.ts o agente 4 e a fila: lê TODOS os átomos de uma entidade,
                  escreve a ficha inteira e GRAVA — mais a reivindicação, o
                  encadeamento e o desfazer de uma geração
  confronto.ts    o agente `confronto` (slice 5): candidatos por vetor entre
                  átomos, ATUALIZA/CONTRADIZ/CONFIRMA/COMPLEMENTA, e GRAVA —
                  mesmo padrão do enriquecimento, nunca em tempo real
  chat.ts         o agente `chat` (slice 6): as duas ferramentas só-leitura, o
                  loop com teto de 8 chamadas, e o rastro que o botão (i) abre.
                  Não sabe que conversa existe
  conversas.ts    :Conversa, as mensagens no R2, arquivar e apagar — e o agente
                  `titulo-chat`, a única chamada de modelo que mora aqui
  entidades.ts    catálogo do grafo, a apresentação que os dois agentes leem, a
                  visão agregada da revisão; e o vetor da entidade: refresh por
                  hash e as duas consultas de vizinhança
  medidas.ts      o relógio do sistema sobre si mesmo: o contexto que recolhe
                  passo, chamada e falha, os três objetos do R2 e o resumo do mês
  invocacao.ts    cache do tempo de UMA invocação — a mesma pergunta, uma ida
                  só; morre com o `waitUntil`, e por isso não é cache de instância
  correcoes.ts    o diff entre o que a proposta dizia e o que eu aprovei:
                  apuração, chaves e a fusão no índice — puro, sem rede
  calibracao.ts   onde as correções vivem (correcoes.json por sessão e o índice
                  acumulado, por etag) e o agente 4, que rascunha regra e não
                  escreve nada
  regras.ts       as regras aprovadas: o hash que vira sufixo de prompt_version,
                  a leitura tolerante e o snapshot imutável — e o hashDeTexto
                  que o override também usa
  overrides.ts    o prompt e o modelo que eu editei na tela: leitura tolerante,
                  snapshot imutável por hash, e o carimbo. Não sabe quais
                  agentes existem — recebe o id e a base de quem chama
  agentes.ts      o registro dos doze e o desenho do fluxo. Fica ACIMA dos
                  agentes: importa os prompts deles, e nenhum deles o importa
  referencias.ts  lê os dois formatos de proposta (antes e depois da 4)  (client)
  catalogo.ts     busca de entidade no navegador: trecho, acento, alias (client)
  tipografia.ts   qual tela é ritual e qual é gestão — a regra da fonte  (client)
  atomos.ts       escreve :Atomo, :Entidade e :PERFILA — só o confirmar chama;
                  e embute o átomo depois de gravá-lo, nunca antes
  pipeline.ts     transcrever bloco / avançar janelas / finalizar sessão
                  (o orquestrador) — e, desde a 8.2, a proposta enquanto ela
                  cresce (`propostaAtual`) mais o laço do fluxo que a transmite
                  (`acompanharProposta`), com relógio e sono injetáveis
  auth.ts         magic link HMAC, cookie httpOnly, a janela que desliza e a
                  credencial do cron — as duas que a porta única reconhece
  backup.ts       o dump do grafo para o R2: sem o vetor, e numa chave que gira
                  pelo dia do mês. Não sabe restaurar
  backoff.ts      backoff exponencial com jitter                          (client)
  audio.ts        formatos aceitos na importação, limites de arquivo       (client)
  onda.ts         a matemática da onda do botão de gravar — nível, envelope (client)
  rotas.ts        validação de parâmetro e o 502 de infraestrutura, compartilhados
                  pelas rotas
  tipos.ts        contratos do domínio + constantes (DURACAO_CHUNK_S = 30)

src/client/       navegador
  gravador.ts     MediaRecorder recriado a cada 30 s sobre um stream fixo;
                  expõe `faixa` (o MediaStream) para a onda do botão ouvir
  fatiador.ts     o arquivo importado em blocos de 30 s: decodifica, renderiza
                  a 16 kHz e encoda WAV. `null` quando não dá — e aí o caminho
                  antigo, do arquivo inteiro, continua valendo
  deposito.ts     IndexedDB: blocos pendentes + sessão em andamento
  fila.ts         upload serial com retry, observável pela UI
  medidas.ts      as três marcas que só o navegador sabe dar — parar, fila
                  vazia, revisão aberta. `sessionStorage` amarra as três
  transicao.ts    a troca de modo da tela de gravar dentro de uma View
                  Transition; `flushSync` e `prefers-reduced-motion` num lugar
                  só — ver §11
  ndjson.ts       o parser e o laço de leitura do fluxo NDJSON, um só para as
                  três telas que consomem um (chat, processando, revisão).
                  Nasceu dentro do `Chat.tsx`; a terceira cópia o tirou de lá
  espera.ts       até quando vale continuar olhando uma sessão que não fechou —
                  o teto de 360 s do corredor, que a revisão que cresce usa também

src/components/   Marca (o canto superior esquerdo — volta ao início),
                  Gravacao (a tela de gravar), BotaoGravar (o círculo, o halo,
                  as ondas laterais e o selo de REC), Gestao (a engrenagem e a
                  gaveta), Importacao (subir arquivo — item da gaveta),
                  Tipografia (a classe da fonte, conforme a rota),
                  Processando (fechar a sessão e esperar; ponte curta, sai no
                    primeiro átomo que existir),
                  Revisao (aprovar, editar, escutar, confirmar — e crescer
                    debaixo da mão enquanto o fim é extraído),
                  Calibracao (o que eu já corrigi, com o áudio à mão),
                  Agentes (o fluxo desenhado, e o prompt e o modelo de cada um),
                  SeletorEntidade (a barra pesquisável de entidade, nos dois
                    lugares da revisão),
                  Leitura (a transcrição literal — porta de serviço),
                  Sessoes (lista de sessões, o apagar de dois toques — e a cor
                    que diz o que falta revisar), Entidades (higiene do grafo: a
                    lista buscável, a ficha em painel e a fusão à mão),
                  Confronto (estado da varredura de relações, rodar e desfazer),
                  Chat (a barra, o painel, a lista de conversas, o progresso por
                    passo e o (i) com o rastro — nasce dentro da `Gravacao`),
                  ServiceWorker (registra `sw.js`; não desenha nada)
src/app/api/      46 rotas em dez famílias — sessão, entidade, calibração,
                  agentes, átomos, confronto, chat/conversas, medidas, as 2 de
                  auth e a do cron (seção 10)
src/middleware.ts porta única: sem credencial válida nada responde — cookie de
                  sessão, ou o header do cron sob /api/cron/
public/           manifest.webmanifest, icone.svg, os 4 PNG (192/512, cada um
                  também `maskable`) e sw.js — o mínimo que faz o Chrome no
                  Android oferecer a instalação. `sw.js` não cacheia nada
db/migrations/    definição canônica do schema
scripts/          migrate.ts (aplica migrations), smoke.ts (confere externos),
                  raciocinio.ts (mede como pedir ao modelo para pensar menos)
tests/            vitest sobre a lógica pura — nenhuma credencial, nenhuma rede
```

## 3. O caminho do áudio

```
navegador                             Vercel                       R2 / Gateway
─────────                             ──────                       ────────────
POST /api/sessoes ──────────────────▶ CREATE (:Sessao{gravando}) ─▶ Neo4j
getUserMedia (uma vez, nunca tocado)
loop a cada 30 s:
  stop() + new MediaRecorder(stream)
  blob ──▶ IndexedDB                  (persiste ANTES de qualquer rede)
  POST /chunks/:i/url ──────────────▶ presigned PUT, 5 min
  PUT ────────────────────────────────────────────────────────────▶ chunk_NNN.webm
  POST /chunks/:i/pronto ───────────▶ HEAD confere bytes
                                      manifest += bloco
                                      waitUntil: transcrever ─────▶ STT
                                                                    chunk_NNN.json
                                          e, na sequência,
                                        avancarJanelas: a cada 4
                                        blocos transcritos, extrai
                                        + resolve a janela ───────▶ Gateway
                                                                    parcial.json
  apaga do IndexedDB                  (só depois do PUT confirmado)
parar ──▶ /sessao/:id            (Processando: não mostra a transcrição)
  espera a fila esvaziar
  POST /finalizar ──────────────────▶ status = finalizando, responde na hora
                                      waitUntil: espera pendentes,
                                      concatena offsets ──────────▶ transcricao.json
                                      status = transcrito
                                      waitUntil: fecha a janela do
                                      fim e monta a proposta ─────▶ extracao.json
                                      status = em_revisao
  GET /api/sessoes/:id a cada 2 s ──▶ acompanha o status
  em_revisao ──▶ /sessao/:id/revisar   (replace: o corredor não volta)
```

### 3.0 O caminho curto: arquivo importado

Nota de voz do WhatsApp, gravador do celular, áudio antigo no disco. **Desde a
slice 4.10 o arquivo é fatiado em blocos de 30 s no navegador — os mesmos da
gravação — e sobe um `chunk_NNN.wav` por bloco.**

```
navegador                             Vercel                       R2 / Gateway
─────────                             ──────                       ────────────
<input type=file>
  formatoDeArquivo(nome, mime)        (audio.ts — recusa antes de qualquer rede)
  duração pelo <audio>                (NaN em container sem cabeçalho: passa)
  fatiarArquivo(arquivo)              (fatiador.ts — decodifica a 16 kHz,
                                       renderiza cada 30 s, encoda WAV;
                                       null se o navegador não decodifica)
POST /api/sessoes ──────────────────▶ CREATE (:Sessao{gravando}) ─▶ Neo4j
loop por bloco, 2 de cada vez:
  POST /chunks/:i/url  {ext:"wav"} ─▶ presigned PUT, 5 min
  PUT ────────────────────────────────────────────────────────────▶ chunk_NNN.wav
  POST /chunks/:i/pronto {ext:"wav"} ▶ HEAD, manifest += bloco com ext
                                      waitUntil: transcrever ─────▶ STT
                                          e, na sequência,
                                        candidatas + avancarJanelas
sessionStorage duracao:<id>
▶ /sessao/:id   (daqui em diante é o mesmo caminho da gravação: `Processando`
                 chama /finalizar com a duração, faz o polling de 2 s e abre a
                 revisão sozinho)
```

**Por que fatiar, se antes não fatiava.** Até a 4.9 o arquivo subia inteiro em
`i = 0`, e era decisão declarada: `offsetDoBloco(0)` é zero, os timestamps do STT
já saíam absolutos, e não havia emenda nenhuma na transcrição. O preço só
apareceu quando a janela passou a existir. Com **um bloco só**, `janelasDe`
devolve uma janela que *é* a sessão inteira e `blocoDaJanela` devolve string
vazia: a slice 4.8 fica **inerte** no caminho importado — o que era para ser nove
chamadas de 2 min vira uma chamada de 17 min —, e a 4.9 junto, porque
`candidatas_NNN.json` é chaveado por bloco e o RAG rodava uma vez para dezessete
minutos. Foi medido na sessão `mtqoeoqh3e3724514q1f` (§4.6).

Fatiar só o texto da transcrição custaria menos — uma chamada de STT em vez de
trinta e cinco — e foi **recusado**: manteria dois conceitos de bloco no sistema
para sempre, áudio e lógico, e cada fatia futura teria de lembrar da diferença.

**Trinta segundos, e não dois minutos**, porque com 30 s **nada rio abaixo
muda**: `offsetDoBloco` continua `30 × i`, `janelasDe` continua contando blocos,
`chaveChunkCandidatas`, `localizarNoAudio`, `concatenar`, `prefixoContiguo` e os
dois players continuam como estão. Dois minutos dariam nove chamadas de STT em
vez de trinta e cinco, ao custo de generalizar as duas primeiras.

**WAV 16 kHz mono, PCM 16-bit.** `wav` já estava em `FORMATOS` (`audio.ts`), então
`extensaoAceita` e `chaveChunkAudio` aceitam sem uma linha nova, e o cabeçalho de
44 bytes se escreve à mão. WebCodecs mais uma biblioteca de muxing daria ~3 MB
em vez de ~34 MB numa sessão de 17 min, ao custo de dependência nova e suporte
irregular no Safari — e isto é um PWA de celular. O preço está no §14.

**O `null` do fatiador é o que garante que nada piora.** `decodeAudioData` que
falha, ou render que estoura no meio, devolve `null`, e a importação sobe o
arquivo inteiro em `i = 0` com a extensão de origem — o caminho de sempre,
inteiro. É o mesmo cuidado que `duracaoDoArquivo` já tem ao devolver `NaN`. A
diferença **não aparece na tela**: só no log (§14).

**Dois blocos por vez.** Trinta e cinco `/pronto` em sequência disparariam trinta
e cinco chamadas de STT em cerca de um minuto, onde a gravação espalha as mesmas
trinta e cinco por dezessete minutos reais — a rajada que a 4.8 existe para
evitar, chegando pela porta dos fundos. `BLOCOS_SIMULTANEOS = 2` limita a frente,
e `comEsperaDeLimite` (§5.3) absorve o resto. O manifest aguenta a concorrência
(§6.1) e a ordem de chegada não importa: a janela só fecha sobre prefixo
contíguo.

**Sem IndexedDB.** A fila local (3.2) existe para não perder fala quando a aba
fecha no meio da gravação. Um arquivo importado já está no disco de quem o
escolheu: se o PUT falhar, `Importacao` tenta 3 vezes com o mesmo backoff e
depois pede o arquivo de novo.

**A duração não vem mais por bloco.** `/pronto` grava `duracao_s` na sessão a
cada chamada, e o campo existia porque "arquivo importado é um bloco só, de
duração arbitrária". Fatiado, ele deixa de ser: mandar `30` em cada bloco
deixaria a sessão de 17 min registrada como 30 s. O caminho fatiado **não manda o
campo**, e vale `chunks.length * DURACAO_CHUNK_S` — a conta da gravação, correta
para blocos de 30 s. Quem manda a duração real é o `/finalizar`, uma vez só, com
o valor do `sessionStorage`. O campo continua existindo em `/pronto` e é usado
pelo caminho de fallback, onde o bloco de fato tem duração arbitrária.

### 3.1 Por que o recorder é recriado

`MediaRecorder` com `timeslice` **não serve**: só o primeiro blob carrega o
header WebM; os seguintes não são decodificáveis sozinhos e o STT rejeita.

O `MediaStream` é aberto uma vez em `iniciar()` e nunca é tocado. A cada 30 s o
recorder é parado (`onstop` emite o bloco) e um novo é criado sobre o mesmo
stream. Cada bloco sai completo e decodificável; a lacuna é de milissegundos.

Formato: `audio/webm;codecs=opus`, mono, 24 kbps — ~120 kB por bloco de 30 s,
~4 MB numa sessão de 20 min (aceite 8).

### 3.2 Durabilidade da fila

`fila.ts` sobe um bloco por vez, na ordem em que foi falado:

1. `enfileirar` grava no IndexedDB **antes** de qualquer rede;
2. pede a presigned, faz o `PUT`, chama `/pronto`;
3. só então `removerChunk`.

Falha em qualquer ponto → backoff exponencial com jitter (`backoff.ts`, base 1 s,
teto 30 s) e o bloco continua no depósito. `window.addEventListener("online")`
acorda a fila. Rede caindo por um minuto atrasa a subida e não perde bloco
(aceite 4).

Antes de finalizar, `Processando` chama `aguardarFilaVazia()` — nenhuma sessão é
fechada com bloco ainda por subir.

## 4. Transcrição

### 4.1 Paralela, não no fim — e desde a 4.8 isso vale para a extração também

Cada bloco é transcrito assim que sobe, disparado por `waitUntil` na rota
`/pronto` — o cliente não espera pelo STT, ele volta a gravar. Quando a gravação
de 15 minutos para, só falta o último bloco. É isso que faz o sistema parecer
rápido (aceite 5).

**Isso resolvia metade do problema.** A transcrição acompanhava a fala desde a
slice 1, mas tudo o que vem depois dela — a extração sobre a transcrição
inteira, a resolução, os embeddings — esperava eu parar. Numa sessão de 15 min
era uma chamada de raciocínio com ~15 mil caracteres de entrada, e ela sozinha
respondia por quase toda a espera entre parar de falar e revisar.

Na mesma rota `/pronto`, encadeados no mesmo `waitUntil`, rodam agora
`recuperarCandidatas` — a busca que pergunta ao grafo quem aquele bloco cita
(§4.14) — e `avancarJanelas`: a cada `JANELA_BLOCOS` (4) blocos transcritos, uma
janela de 2 minutos é extraída e resolvida, e os átomos dela vão para
`parcial.json` (§4.6). Quando eu paro, `/finalizar` fecha a janela do fim — no
máximo 3 blocos — e monta a proposta a partir do acumulado.

Três consequências que valem estar escritas:

- **A chamada mais cara deixou de acontecer logo depois de 30 chamadas de STT**,
  que era exatamente o pior momento para o rate limit da conta (§5.3). Agora ela
  é oito chamadas pequenas espalhadas pelos 15 minutos, e durante a gravação
  esperar o limite passar é de graça — não há prazo a estourar.
- **A resposta da extração continua podendo truncar, e truncou.** Esta linha
  já disse o contrário — "nenhuma janela chega perto de `maxOutputTokens:
  8000`" —, e a primeira janela real extraída depois da 4.8 desmentiu:
  `finishReason=length` com 5210 tokens de entrada e os 8000 de saída gastos
  **pensando**, sem um byte de JSON (sessão `mtqoeoqh3e3724514q1f`). A premissa
  errada era tratar o teto como teto de JSON: ele cobre **raciocínio e texto
  juntos**, e o volume do pensamento não encolhe com a entrada do jeito que o
  JSON encolhe. Encolher a janela não protege nada; o que protege está no §4.6.
- **O caminho de uma janela só continua existindo, e é o mesmo código.** Arquivo
  importado que o navegador não fatiou, e gravação de menos de dois minutos:
  passam por uma janela que se declara a sessão inteira, com o prompt saindo byte
  a byte igual ao de antes da 4.8. **O terceiro caso saiu na slice 8**: janela que
  não fecha já não cai no passe único — a sessão vai para `erro` e espera eu
  mandar re-extrair (§4.18).

### 4.2 Porta única de modelo (Vercel AI Gateway)

**Todo tráfego de LLM deste sistema sai pelo Vercel AI Gateway** — STT hoje,
extração e deduplicação a partir da slice 2, e o que vier depois. Uma chave
(`AI_GATEWAY_API_KEY`), um lugar para ver custo e latência, e trocar de provedor
é mudar uma variável de ambiente, sem tocar em código. É a regra inviolável 8.

O mecanismo está no próprio SDK. `resolveLanguageModel` e
`resolveTranscriptionModel` mandam qualquer `model` em string para o provedor
global:

```
getGlobalProvider() → globalThis.AI_SDK_DEFAULT_PROVIDER ?? gateway
```

Como o projeto nunca define `AI_SDK_DEFAULT_PROVIDER`, **id em string sai pelo
Gateway** (`https://ai-gateway.vercel.sh/v4/ai`) — vale para transcrição, texto,
embedding, imagem e fala. O que fura a porta é importar um pacote de provedor
(`@ai-sdk/openai`, `openai`, `groq-sdk`…) e passar o **objeto** de modelo: aí o
SDK fala direto com o provedor e o Gateway nunca vê a chamada.

Daí a forma da regra, que é verificável em vez de aspiracional:

| | |
|---|---|
| Endereçamento | string `provedor/modelo`, sempre por `src/lib/modelos.ts` |
| Dependências | nenhum pacote de provedor no `package.json` |
| Endpoints | nenhum host de provedor escrito à mão |
| Chaves | só `AI_GATEWAY_API_KEY`; chave de provedor não existe aqui |

`src/lib/modelos.ts` é o único lugar que resolve id de modelo: valida o formato
(`STT_MODEL` mal escrito estoura antes de qualquer byte sair), extrai o provedor
para `providerOptions` e confere a chave do Gateway antes da chamada.
`modeloExtracao()` está ao lado de `modeloStt()`, no mesmo formato — id literal
não se espalha pelo código.

`tests/gateway.test.ts` varre `src/` e `scripts/` a cada `pnpm test` e falha se
algum dos quatro pontos da tabela for furado. É o que sustenta a promessa de
"uma chave, um lugar para ver custo" a cada agente novo que entra.

**Hoje passam por aqui dez consumidores**, cada um com sua função em
`modelos.ts` e sua variável de ambiente (§12), e todos os dez com caixa no
painel de `/agentes` (§4.13):

| Função | Agente | Padrão |
|---|---|---|
| `modeloStt()` | STT | `xai/grok-stt` |
| `modeloExtracao()` | `extracao-9` | `deepseek/deepseek-v4.1-flash` |
| `modeloResolucao()` | `resolucao-5` | o da extração |
| `modeloDesempate()` | `desempate-1` | o da resolução |
| `modeloPerfil()` | `perfil-1` | o da extração |
| `modeloEnriquecimento()` | `enriquecimento-1` | o da extração |
| `modeloCalibracao()` | `calibracao-2` | o da extração |
| `modeloRedacao()` | `redacao-1` | o da calibração |
| `modeloDuplicatas()` | `duplicatas-2` | `deepseek/deepseek-v4.1-flash` |
| `modeloEmbedding()` | embedding | `openai/text-embedding-3-small` |
| `modeloConfronto()` | `confronto-2` | o da extração |

A deduplicação de **entidade** chegou na slice 3 e é o `duplicatas-2`. O que
continua não existindo é a deduplicação de **átomo**, numa fatia futura ainda
sem número: dizer a mesma coisa em duas sessões ainda cria dois. A porta por
onde ela vai passar é esta, e
`tests/agentes.test.ts` é a guarda que impede um agente novo de nascer por
fora dela.

### 4.2.1 Por que o STT é o `xai/grok-stt`, e não um melhor de texto

Medido em 2026-08-31, com o **mesmo bloco real** de 30 s para todos, pelo
Gateway. A pergunta não é quem transcreve melhor: é quem devolve **tempo**.

| Modelo | Tempo | Texto | Custo/30 s |
|---|---|---|---|
| `xai/grok-stt` | **palavra** — 64 segmentos de 1 palavra (`1.802–2.002 "Vamos"`) | pior dos cinco | $0,0008 |
| `openai/whisper-1` | frase — 4 segmentos de ~8 s | bom | $0,0029 |
| `google/gemini-3.5-transcribe` | **nenhum** | melhor dos cinco | $0,0014 |
| `openai/gpt-4o-transcribe` | **nenhum** | bom | $0,0015 |
| `openai/gpt-4o-mini-transcribe` | **nenhum** | bom | $0,0008 |

`deepgram/*`, `assemblyai/*`, `elevenlabs/*`, `groq/whisper-*`,
`mistral/voxtral-*`, `fal/wizper`, `revai/*` e `azure/whisper`: `Model not
found`. Não estão neste Gateway — e é de **Deepgram** que vem o nome `keyterm`
usado em `stt.ts`, o que explica a opção estar lá.

**Sem tempo não há procedência**, que a visão §4 lista como necessidade: sem
ele todo átomo nasce com `inicios_s`, `fins_s` e `ancoras` vazios, o player da
revisão some de todos os itens e "escuto antes de aprovar" deixa de existir.
Isso elimina os três modelos sem timestamp por melhor que seja o texto deles.

> **A tabela tinha uma sexta coluna, "Rate limit", que dizia `—` para o
> `xai/grok-stt` e eliminava o `whisper-1`. Ela saiu porque é falsa** — ver
> "O rate limit é da conta", abaixo. O limite não escolhe modelo.

O custo declarado: no bloco medido o grok escreveu "Vamos testar se **a
secretária** está funcionando" onde os outros três ouviram "testar se **isso
aqui tá** funcionando". O bloco é um teste de microfone de 24/08, e as sessões
reais transcritas por ele produziram extração boa — mas transcrição estranha
numa sessão de verdade tem aqui a primeira suspeita.

#### Abrir mão do timestamp para ganhar texto: medido e recusado (2026-09-02)

A pergunta voltou, e desta vez com a proposta certa: **trocar procedência por
qualidade de transcrição**, indo para o `google/gemini-3.5-transcribe`. A
medição usou um bloco real de sessão importada (`mtkwtbpa…`) em vez do teste de
microfone, e o resultado inverteu a decisão pelo motivo oposto ao esperado.

O Gemini de fato escreve melhor. No mesmo bloco:

| | `grok-stt` | `gemini-3.5-transcribe` |
|---|---|---|
| "eu me apliquei hoje" | "eu me **apoiou**" — erra nas duas rodadas | **acerta** |
| o nome "Bearing Founders" | "**Bejewel** Founders" sem lista; certo **com** lista | **acerta sozinho**, nas duas ocorrências |
| "Phronesis" | **acerta** | "**fronesis**" |
| "na Adapta" | erra ("na data") | erra ("na data") |

**Mas ele não tem por onde receber o vocabulário.** Testados cinco nomes de
opção — `keyterm`, `phrases`, `speechContexts`, `vocabulary` e `prompt` —, os
cinco devolvem saída **byte a byte idêntica** à chamada sem opção nenhuma, e o
AI SDK não emite um `warning` sequer. Não é nome errado: é canal inexistente,
com falha silenciosa. `providerOptions` vira decoração e ninguém fica sabendo.

Isso mata a troca. Num sistema em que o nome próprio é a chave da entidade e o
insumo do agente 2, um modelo que escreve melhor a prosa e pior o nome está
piorando exatamente o que importa — e "fronesis" é o nome do próprio projeto.
A lista tem efeito medido e grande (§4.4); um provedor surdo a ela custa mais
do que ganha. Somado a `segments: 0` e `providerMetadata` sem palavras
(reconfirmado nesta medição), o Gemini perde nos dois eixos que decidem.

**Fica registrado para ninguém repetir o teste daqui a três meses:** a troca já
foi tentada duas vezes — em 31/08, revertida no mesmo dia por falta de
timestamp; em 02/09, recusada por falta de canal de vocabulário. A âncora por
bloco de 30 s resolveria o primeiro motivo (a gravação já é fatiada, e
`localizarNoAudio` já toca por bloco), **mas não resolve o segundo** — por isso
não foi construída: não há hoje, neste Gateway, um modelo pelo qual gastá-la.

#### O rate limit é da conta, não do modelo (2026-09-02)

Medido na mesma sessão de trabalho, e é o achado que não é sobre o Gemini:

```
GatewayRateLimitError: Free tier requests on this model are rate-limited.
```

Ele apareceu depois de cinco chamadas seguidas de transcrição no Gemini e, na
mesma janela, **derrubou também o `xai/grok-stt`** — que a tabela acima listava
como sem limite. Trocar de modelo não escapa dele. Uma espera de ~75 s
destravou o que três tentativas seguidas do próprio AI SDK não destravaram.

Isso é um risco vivo do caminho de hoje, não uma nota de rodapé: uma sessão
gravada de 15 min são 30 blocos. O tratamento está em `limite.ts` (§5.3).

### 4.3 Granularidade e procedência

O contrato de transcrição do SDK garante `segments` (início e fim por trecho).
Timestamps por palavra, quando existem, vêm em `providerMetadata` e variam por
provedor. `stt.ts` tenta `palavrasDoMetadata()` primeiro e cai para
`palavrasDosSegmentos()`, registrando no bloco qual dos dois foi:

```ts
granularidade: "palavra" | "segmento"
modelo: string      // qual modelo transcreveu de fato
```

A sessão inteira vale o elo mais fraco: um único bloco por segmento rebaixa
`granularidade` da transcrição toda. Procedência tem que dizer a verdade sobre a
própria precisão — o aceite 6 (clicar no minuto 9 e ouvir o minuto 9) degrada
para precisão de frase quando é só o que o provedor devolve.

**Bloco sem palavra nenhuma não vota** (09/09). O bloco mudo volta vazio (§5.4) e
não trouxe tempo de coisa alguma; deixá-lo entrar na conta faria uma pausa de
30 s rebaixar a sessão inteira para `segmento` e apagar o player por palavra de
átomos cujas âncoras são por palavra. `granularidadeDaSessao` olha só quem
trouxe palavra.

**Observado com `xai/grok-stt` (2026-08-24, primeira transcrição real):** o
provedor não expõe nada em `providerMetadata`, então o bloco é registrado como
`granularidade: "segmento"` — mas os `segments` que ele devolve têm **uma
palavra cada** (64 de 64 no bloco medido, ex.: `1.802–2.002 "Vamos"`). Na
prática a precisão é por palavra e o campo a subdeclara. Subdeclarar é o lado
seguro do erro, e nada foi mudado: reclassificar depende de decidir se
"um segmento de uma palavra" conta como timestamp por palavra, o que é escolha
de produto, não de implementação.

**Reconfirmado em 2026-08-31**, na medição de §4.2.1: mesmos 64 segmentos de uma
palavra, mesma ausência de `providerMetadata`. É exatamente esse comportamento —
`segments` densos o bastante para ancorar palavra por palavra — que faz este
modelo ser o único do Gateway que serve, e é sobre ele que as âncoras dos átomos
que já estão no grafo foram construídas.

### 4.4 Vocabulário

Metade do que se fala são nomes próprios que o modelo não conhece: "Rodozanco"
vira "rodo zanco". `config/vocabulario.txt` (uma entrada por linha, `#` é
comentário) é lido e mandado como `keyterm`, respeitando o teto da API: 100
termos, 50 caracteres cada, sem repetir a mesma palavra em outra caixa. Termo
longo demais é descartado inteiro, nunca truncado pela metade. Na slice 1 a
lista é escrita à mão; a partir da slice 3 é gerada das entidades do grafo.

**A união não vai inteira: `termoUtil` corta duas classes**, e o corte vale para
o que vem do arquivo e para o que vem do grafo. O ganho do vocabulário está em
nome próprio incomum, e cada vaga gasta com palavra que o modelo já escreve
certo é uma vaga a menos para o nome que ele erra:

| Corte | Por quê |
|---|---|
| pronome nunca vira keyterm (`ehPronome`) | é a mesma lista que a revisão e o confirmar usam; a entidade `eu`, que §4.6 descreve como caso real, é `:Pessoa` no grafo e **nunca** é mandada ao STT |
| palavra comum, quando a entidade tem **uma** palavra só (`COMUNS`, 26 delas) | ensinar o STT a ouvir "casa" com mais força piora a transcrição inteira em troca de nada. Só filtra termo de uma palavra: "meu pai" passa, "pai" sozinho não — e "Ana Paula" passa mesmo que "ana" fosse comum |

**A lista final é cacheada por 5 minutos** (`TTL_MS`), não indefinidamente, e o
cache é do resultado da união — arquivo ∪ grafo —, não do arquivo. Duas
consequências que valem estar escritas: um nome que eu confirmo agora leva até
5 min para chegar ao STT, e o cache é por instância serverless, que é
exatamente o desenho que §4.12 e §4.13 **recusam** para `regras()` e
`overrides.ts`. A assimetria é deliberada e o critério é o que a demora custa:
"salvei uma regra e ela não valeu" é uma promessa quebrada sem ninguém ver;
"o nome que entrou agora só entra nos keyterms daqui a cinco minutos" custa uma
grafia numa sessão, e o ritual é de uma vez por dia.

**A lista de fato muda a transcrição** — medido em 2026-08-31, mesmo bloco,
mesma chamada, só a lista variando:

| Lista | Saída |
|---|---|
| sem lista | "Acordei em **Porto Alegre** hoje" |
| `["Xhavier"]` (controle irrelevante) | "Acordei em **Porto Alegre** hoje" |
| `["Portalegre"]` | "Acordei em **Portalegre** hoje" |

A grafia segue a lista, e o controle mostra que um termo que não foi falado
**não** se injeta na saída. É o que sustenta a metade A da slice 3: gerar a
lista das entidades do grafo tem efeito real, não decorativo.

**Repetido em 2026-09-02 contra um bloco de sessão real**, e o efeito é maior do
que a medição de agosto sugeria — lá a lista trocava uma grafia plausível por
outra; aqui ela tira um nome do ruído puro:

| Lista | Saída |
|---|---|
| sem lista | "eu me apoiou hoje para a **Bejewel Founders**" |
| `["Adapta", "Bearing Founders", "Phronesis"]` | "eu me apoiou hoje para a **Bearing Founders**" |

Mesmo áudio, mesma chamada, 236 e 237 segmentos. Note o que a lista **não**
conserta: "eu me **apoiou**" continua errado nas duas, e "na **Adapta**"
continua saindo como "na data" mesmo com "Adapta" na lista. Ela ensina grafia
de nome próprio, não corrige gramática — e nem todo nome ela salva.

**E o canal existe só no provedor de hoje.** No `google/gemini-3.5-transcribe`,
cinco nomes de opção diferentes produzem saída byte a byte idêntica à chamada
sem opção nenhuma, sem um `warning` sequer (§4.2.1). É por isso que
`OPCAO_DE_VOCABULARIO` tem **silêncio como padrão** para provedor desconhecido:
o vocabulário some sem avisar, e um `STT_MODEL` trocado leva junto a metade A da
slice 3 sem que nada na tela mude.

#### Dá para calar o raciocínio deste modelo, e não calamos

A mesma mecânica de opção-por-provedor vale para pedir a um modelo que **pense
menos**, e a pergunta apareceu quando a janela 0 da sessão
`mtqoeoqh3e3724514q1f` gastou os 8000 tokens de saída inteiros raciocinando sem
escrever um byte de JSON (§4.6). `scripts/raciocinio.ts` foi escrito para
responder se dava, e respondeu que dá.

**A decisão é não usar.** O raciocínio não é o defeito — é o que a extração faz
de útil. Ler um diário falado e decidir o que vira átomo, de quem é, e o que
estende o que já foi dito é exatamente a tarefa em que pensar antes de escrever
paga. Cortá-lo consertaria o sintoma no lugar em que ele dói menos e cobraria a
conta na **qualidade da lista**, que é a única coisa deste sistema sem teste
automático e que se julga à mão, sessão por sessão. O estouro tem defesa
própria, e ela é o escalonamento de teto do §4.6.

A medição fica registrada porque a pergunta pode voltar — outro
`EXTRACAO_MODEL`, outro provedor, outro comportamento —, e porque saber que o
canal existe é diferente de usá-lo.

**A medição, de 07/09, contra `zai/glm-5.3-flash`** (que o Gateway resolveu para
`baseten`), mesmo prompt e mesmo teto de 8000 em todas:

| opção | raciocínio | texto | |
|---|---|---|---|
| sem opção | 117 | 613 char | **é assim que roda** |
| `reasoningEffort: "minimal"` | 0 | 613 char | funciona, e não usamos |
| `thinking: { type: "disabled" }` | 0 | 613 char | funciona, e não usamos |
| `reasoning_effort: "minimal"` | 117 | 613 char | ignorada em silêncio |
| `enable_thinking: false` | 162 | 613 char | ignorada em silêncio |

Duas funcionam de fato: zeram o raciocínio e devolvem o mesmo texto. As outras
duas não avisam que não pegaram — o que as denuncia é o número igual, ou maior,
ao da linha de base. É por isso que um nome desses nunca poderia ser escrito no
código sem medir, e é a mesma armadilha do vocabulário do STT.

Três nomes ficaram **sem medir** — `reasoningEffort: "none"`,
`reasoning: { enabled: false }` e `maxReasoningTokens: 512` —, porque o rate
limit da conta chegou no meio da sonda. `PROBE_SO=maxReasoningTokens` roda só
um, sem gastar o limite com a lista inteira.

A sonda pergunta sob duas chaves (`PROBE_PROVEDOR`) porque o Gateway resolveu
`zai/glm-5.3-flash` para `resolvedProvider: baseten`: não dá para saber de fora
se a opção viaja sob o provedor do id ou sob o que atendeu. Neste caso a do id
bastou.

**Esta medição é do modelo que era o padrão até 20/09.** Desde então o padrão da
extração é `deepseek/deepseek-v4.1-flash`, e a sonda **não** foi rodada contra
ele — nem precisa ser, enquanto a decisão for não calar o raciocínio de modelo
nenhum. Se um dia ela voltar a importar, `pnpm probe:raciocinio` já lê o padrão
novo; e a tabela acima continua valendo para o `zai`, que `EXTRACAO_MODEL` traz
de volta sem deploy.

### 4.5 Concatenação

Cada `chunk_NNN.json` traz offsets relativos ao próprio início. O offset absoluto
é `relativo + 30 × i` (`DURACAO_CHUNK_S`). `concatenar()` ordena por `i`, soma os
offsets, junta o texto e registra o mapa `{ i, texto, offset_s }`.

Enquanto processa, a tela mostra só o **prefixo contíguo** dos blocos prontos
(`prefixoContiguo`): se o bloco 2 ainda está no STT, o 3 não aparece — texto
parcial nunca é lido fora de ordem.

**As duas funções servem à janela desde a 4.8**, e não foi coincidência: uma
janela é `concatenar` sobre um subconjunto de blocos, o que devolve uma
`Transcricao` com offsets já absolutos — nada na âncora nem no player precisa
saber que ela é um pedaço. E `janelasDe` fatia o mesmo prefixo contíguo pela
mesma razão de sempre: com um buraco no meio, a janela leria fala fora de ordem.

**E desde a 4.10 a importação passa por aqui igual à gravação.** O arquivo
importado tinha zero emenda — era um bloco só, e `offsetDoBloco(0)` é zero.
Fatiado em 30 s, ele passa a ter as mesmas emendas da gravação: numa sessão de
17 min são **trinta e cinco lugares** onde uma palavra pode ser cortada ao meio,
onde antes não havia nenhum. É preço declarado (§14), e em troca a importação
ganha a janela e o RAG por bloco. **Nenhuma linha desta seção precisou mudar
para isso** — `30 × i` continua sendo a conta, porque o bloco continua tendo 30 s.

### 4.6 Extração de átomos, janela a janela

**Dispara sozinha**, e desde a slice 4.8 já durante a gravação: a cada quatro
blocos transcritos, `avancarJanelas` fecha uma janela de 2 minutos no mesmo
`waitUntil` que transcreveu o bloco. Ninguém aperta nada entre parar de falar e
ter a proposta (aceite 1 da slice 2) — e agora isso custa segundos, porque o que
falta quando eu paro é uma janela de no máximo 90 s de fala. Quem lê a proposta
é a revisão (§4.7), e é o confirmar dela que a leva ao grafo.

`extracao.ts` monta o prompt, valida a resposta item por item e carimba a
procedência. Sai pelo Gateway como o STT, por
`modeloExtracao()`. Devolve um `ResultadoDaJanela` — os átomos daquela fatia, já
ancorados e resolvidos. Cada átomo leva `id` determinístico
(`<sessao_id>-<índice>`, que é o que faz o `MERGE` do confirmar ser idempotente),
`prompt_version` e `modelo` (regra 7). Nada disso vai ao grafo (regra 5): o
acumulado vive em `parcial.json`, no R2.

#### A janela, e por que a extração não é a soma de oito extrações

Uma janela é uma corrida contígua de `JANELA_BLOCOS = 4` blocos **do prefixo
transcrito** — um buraco no meio segura a janela, pelo mesmo motivo que a
transcrição parcial só mostra o prefixo (§4.5). `concatenar` monta o texto dela,
com os offsets já absolutos, e é contra as palavras da própria janela que os
trechos são ancorados; o cursor de `offsets.ts` deixa de poder varrer a sessão
inteira atrás de um trecho, o que é ganho e não perda.

**4 blocos, e não 1.** O número é o meio-termo entre duas pressões opostas.
Menor, a janela corta frase no meio e multiplica a chamada de modelo, que é
justamente a rajada que o free tier recusa. Maior, sobra fala demais para a
janela do fim e a espera depois de parar volta a crescer. `JANELA_BLOCOS = 0`
desliga o caminho incremental e devolve o sistema ao de antes da fatia — é o
botão de pânico, e existe para ser usado sem deploy de emergência.

**O prompt base não mudou um byte.** `INSTRUCOES_BASE` e `FORMATO` são os
mesmos da 4.7 — cinco versões de calibração produziram o que está lá, e
reescrevê-lo por causa de janela seria arriscar o que está bom. O que entra é um
bloco injetado no **mesmo ponto** em que a regra aprovada entra (§4.12), pelo
mesmo `inserirAntesDoFormato`: depois de tudo o que instrui, antes do envelope.
Ele carrega quatro coisas:

| O que | Por quê |
|---|---|
| "dos minutos 4 a 6", e que a fala continua depois | o modelo precisa saber que está lendo trecho, não sessão — senão ele conclui em cima de uma frase cortada |
| o orçamento, em proporção | a base pede 10 a 20 por 15 min; uma janela de 2 min pede de 1 a 3. Calculado (`orcamentoDaJanela`), não escrito à mão |
| a lista numerada do que já foi proposto | é o que o `ref` do `estende` endereça |
| a chave `estende` no JSON | a operação que impede a lista de virar trinta átomos |

E desde a 4.9 há **um segundo bloco injetado**, no mesmo ponto e antes deste: o
dossiê das candidatas (§4.14). A ordem é `INSTRUCOES_BASE → blocoDasCandidatas →
blocoDaJanela → FORMATO → texto` — o dossiê primeiro, porque é material; a janela
depois, porque é sobre aquela chamada e mais nenhuma.

**Eram três blocos até a slice 7**, e o primeiro era o das regras aprovadas. Ele
saiu porque a correção deixou de virar apêndice e passou a virar emenda no corpo
do prompt (§4.12): o que a 4.6 colava a cada chamada agora está escrito dentro do
texto que `efetivo("extracao", …)` devolve.

**`blocoDaJanela` devolve string vazia quando a janela é a sessão inteira e o
acumulado está vazio.** Não é detalhe: é o que faz o arquivo importado e a
gravação de menos de dois minutos continuarem recebendo exatamente o prompt de
antes desta fatia. (O terceiro caso era o fallback de passe único, que a slice 8
removeu — §4.18.)

#### `estende`: o que substitui a passada de costura

A janela devolve, além de `atomos`, uma lista `estende` de
`{ ref, texto, trechos }`: "o átomo 3 continua neste trecho; aqui está a
afirmação reescrita e o pedaço novo". `aplicarJanela` engorda o átomo referido —
texto novo, trechos somados — sem mexer no `id` nem na posição.

**Uma passada de costura no fim foi considerada e recusada.** Ela consertaria
volume e ROTINA duplicada depois do fato, ao custo de um oitavo agente, mais um
prompt para calibrar à mão para sempre, e ~10 s acrescentados exatamente à
espera que esta fatia existe para cortar. O `estende` faz o mesmo trabalho
**antes de o erro existir**, e o preço é o inverso: se o modelo ignorar a
instrução, a revisão abre com mais itens do que devia. Isso é coisa que eu vejo
na primeira sessão real, e conserto no prompt sem deploy (§4.13).

Duas coisas que o `estende` deliberadamente **não** faz:

- **não mexe em `sobre` nem em `menciona`.** É o que mantém a resolução
  estritamente incremental: átomo já atribuído não é reaberto a cada janela.
  Trocar o sujeito de um átomo é gesto meu, na revisão;
- **não apaga átomo.** `ref` fora da faixa vira `Descarte` com o motivo, nas
  duas pontas — no parser, contra a contagem que o prompt mostrou, e em
  `aplicarJanela`, contra a lista que está sendo gravada. É o único caminho por
  onde uma resposta de modelo escreveria sobre um átomo que já existe.

Item malformado não derruba a extração inteira: vai para `descartados` com o
motivo. Lista de descarte crescendo é sinal de prompt piorando — e é o único
sinal automático que existe, já que a qualidade é avaliada à mão na revisão.

#### O modelo raciocina, e o raciocínio come a saída

`zai/glm-5.3-flash`, o padrão da extração até 20/09, é modelo de raciocínio.
Numa sessão de 4 mil caracteres ele gastou **1720 tokens raciocinando para 122
de texto** — e quando o raciocínio consome o orçamento inteiro a resposta chega
sem JSON nenhum. Foi assim que a sessão `mtgo3kaf5` falhou, de forma
intermitente: a mesma transcrição às vezes passava.

**A troca do padrão para `deepseek/deepseek-v4.1-flash` não move nada desta
seção.** O que as defesas abaixo olham é o `finishReason` da resposta e a razão
entre pensamento e texto, nunca o nome do modelo: num modelo que pensa pouco
elas simplesmente não disparam. O que a troca abre é uma pergunta sem resposta
medida — quanto este pensa —, e quem responde é a sessão real, pelo diagnóstico
que já sai no log.

**São duas causas diferentes com consertos diferentes**, e o `finishReason` é o
que as separa. Por duas fatias esta tabela existiu como prescrição escrita, e o
código repetia a mesma chamada nos dois casos:

| O que o diagnóstico mostra | O que aconteceu | Quem cuida |
|---|---|---|
| `finishReason=length`, `raciocinio` no teto | o raciocínio comeu o orçamento e a resposta foi cortada no meio dele | `faltouOrcamento()` → segunda tentativa com o dobro de teto |
| `finishReason=stop`, saída sobrando, `pensamento` grande e `texto=0` | o modelo escreveu a resposta na parte de raciocínio, não na de texto | `textoDaResposta()` → lê o `reasoningText` |

A distinção não é acadêmica. Com `temperature: 0`, repetir a mesma chamada
depois de um `length` é **determinístico**: mesmo prompt, mesmo teto, mesmo
estouro. A janela 0 da sessão `mtqoeoqh3e3724514q1f` gastou duas chamadas para
falhar exatamente igual duas vezes. E no caso `stop` a segunda tentativa
**mascarava** o problema acertando por sorte, e ele voltava na sessão seguinte.

As defesas de hoje, da que conserta para a que só conta o que houve:

| | |
|---|---|
| escalonamento do teto | cortado no pensamento, a segunda tentativa vai com `MAX_TOKENS_SAIDA * 2` em vez de repetir a mesma chamada. **É a defesa principal**, e custa uma chamada a mais nas janelas em que o modelo pensa muito |
| `fecharJsonTruncado(bruto)` | resposta cortada **depois** de começar a lista: corta no último átomo que fechou inteiro e fecha o array. Abaixo |
| `textoDaResposta(resposta)` | o JSON que foi parar no pensamento ainda é lido — **exceto** em `length`, onde o raciocínio está cortado no meio e `isolarJson` casaria um rascunho abandonado |
| a resposta crua no erro | os primeiros 400 caracteres vão na mensagem, e "resposta vazia" é dito com essas palavras |
| `diagnostico(resposta)` | `finishReason`, tokens de entrada/saída/raciocínio e o tamanho do texto e do pensamento, nas duas tentativas. Mora em `modelos.ts`: os três agentes têm o mesmo modo de falha |

#### Truncou, e não perde mais tudo (slice 4.10)

Estourar o teto **no meio da lista** era pior que estourá-lo no pensamento. A
chamada 2 da janela 0 da `mtqoeoqh3e3724514q1f` devolveu 11351 caracteres: cerca
de dez objetos de átomo completos e um pela metade. `isolarJson` faz
`lastIndexOf("}")`, o `JSON.parse` estoura, e `parsearResposta` descartava os
dez — mais duas chamadas de modelo, sob rate limit de free tier, para chegar ao
mesmo lugar.

`fecharJsonTruncado` varre o texto com uma máquina de estados mínima —
dentro/fora de string, escape, profundidade de `{}` e `[]` — guardando o índice
logo depois de **cada elemento completo do array de átomos**, corta no último e
fecha o que ficou aberto. Sem nenhum elemento completo devolve `null`, e aí o
erro é o de sempre: inventar `[]` transformaria um acidente de teto numa lista
vazia legítima. O array é achado pela chave `"atomos"` e não pelo primeiro `[`,
porque o envelope pode trazer `"entidades"` antes.

**Separada de `isolarJson` de propósito.** Aquela responde "onde começa e termina
o JSON nesta resposta", e para um texto cortado a resposta dela está certa — o
problema é que não há fim. Misturar as duas perguntas faria `isolarJson` mentir
sobre resposta íntegra. Ela só é chamada no `catch` do `JSON.parse`: resposta
inteira nunca passa por ali.

O que mudou de comportamento, e é o que importa:

- a **segunda** tentativa que trunca deixou de lançar e matar a janela: usa o que
  foi salvo;
- a **primeira** que trunca ainda dispara a segunda — o que veio pode estar
  faltando o fim da lista —, mas agora com rede: fica **a melhor das duas pelo
  número de átomos** (`melhorLeitura`), e no empate a íntegra. Na medição, a
  chamada com ~10 átomos foi descartada em favor de uma que trouxe menos;
- log próprio: `[extracao] sessão <id>: resposta cortada, N átomo(s)
  recuperado(s)`;
- `truncada` sobe da leitura ao `EstadoJanela`, dele ao `montarExtracao` — uma
  janela cortada basta — e da `Extracao` à revisão, que **avisa**. Eu julgo a
  lista à mão, e sem o aviso uma lista curta parece decisão do modelo em vez de
  acidente de teto.

**O teto não mudou junto**, e é de propósito: mexer no teto e no salvamento na
mesma fatia esconderia qual dos dois funcionou.

**Subir `MAX_TOKENS_SAIDA` não estava na lista, e o parágrafo original fica
registrado porque ele continua verdadeiro:** ele já tinha sido subido uma vez
depois da `mtgo3kaf5`, e a janela seguinte encheu os 8000 do mesmo jeito — o
modelo ocupa o que houver. O escalonamento é o que resolve, e não o orçamento.

**Mesmo assim ele subiu de novo em 20/09, de 8000 para 16.000, por decisão
minha e sabendo disso.** O que mudou foi a evidência de produção: a sessão
`mu4um3ot3t5k4g1u1p1j` ficou dois dias presa, retentada e falhando igual a cada
vez, e o conserto do prazo por chamada (§5.3) tinha limitado o pior caso a 90 s
por chamada **sem reduzir o tempo total** — porque quando uma chamada estoura o
teto, a **janela inteira** é refeita do zero (extração, resolução e desempate),
não só a chamada que estourou. O mecanismo não mudou: `FATOR_DE_FOLGA` continua
2, e a segunda tentativa passa a ir com 32.000 quando `finishReason` for
`length`. O que subiu foi o piso debaixo dele.

**Pedir ao modelo para pensar menos também não está na lista, e também é de
propósito** — ainda que se saiba exatamente como, e a medição esteja no §4.4. O
raciocínio é o que esta tarefa tem de mais útil; cortá-lo trocaria um estouro
raro, que já tem defesa, por uma perda de qualidade constante e sem teste que a
pegue. A troca escolhida é a outra: uma chamada a mais quando estoura.

As duas últimas defesas são as mais antigas e as que mais importam — sem a
resposta crua, "não é JSON válido" é indiagnosticável depois do fato, a mesma
lição que o STT já tinha ensinado uma vez (5.1).

O prompt também ganhou uma proibição explícita de **comentar a transcrição**. O
modelo devolveu um átomo dizendo que o texto era confuso e circular; falar
desorganizado é o esperado num diário falado, e lista vazia é a resposta certa
quando não há o que extrair.

#### O que o prompt manda fazer (`extracao-9`)

A primeira versão pedia "uma afirmação por item" e só descartava hesitação. Numa
sessão real de 45 s isso rendeu 9 átomos — "acordei", "pedalei", "nadei", "fui
sauna" —, o que extrapolado dá ~150 numa sessão de 15 min. Duas condições de
morte de `Specs/visao.md` §8 de uma vez: revisão que passa de um minuto, e
rotina repetida todo dia apodrecendo o grafo. O prompt **manda selecionar**, não
picar:

| Critério | Regra |
|---|---|
| Volume | 10 a 20 átomos numa sessão de 15 min; preferir o átomo maior ao recorte |
| O que entra | carga, conclusão, consequência, decisão, interação |
| Trivialidade | colapsa num único átomo `ROTINA` por sessão |
| Episódio | o que eu contei com detalhe vira **um** átomo `HISTORIA`, e ali o texto pode ser longo (007) |
| `texto` | frase limpa, com as palavras de quem falou — tira muleta, resolve pronome, não parafraseia nem interpreta |
| `trechos` | literais, 1..n, copiados da transcrição |
| Junção | o mesmo assunto dito em dois momentos é **um** átomo |
| `sobre` | `SENTIMENTO`, `APRENDIZADO`, `HISTORIA`, `ROTINA` → "eu"; `FATO`, `OPINIAO`, `CONQUISTA`, `DECISAO` → o assunto |
| Entidades | tipo proposto entre `PESSOA`, `ORGANIZACAO`, `PROJETO` e `OBJETIVO` (007) |

`"eu"` é uma `:Pessoa` como qualquer outra — decisão tomada, não acidente.

**`HISTORIA` é a única exceção à disciplina de volume, e ela precisa estar
escrita** (007). Todo o resto do prompt manda destilar — "prefira sempre o
átomo maior e mais organizado", "se você está produzindo um átomo por frase,
está errado" —, e sob essa regra uma noite inteira contada em detalhe vira uma
linha verdadeira que não devolve nada. A seção `A HISTÓRIA GUARDA O DETALHE`
autoriza o contrário: aqui não se resume, os detalhes ficam na ordem em que
foram contados, e `COM AS MINHAS PALAVRAS` continua valendo — guardar o detalhe
não é bordar em cima dele. Ela também demarca as duas fronteiras por onde o tipo
seria absorvido: o dia comum é `ROTINA`, e o fato solto sem episódio em volta é
`FATO`.

O sujeito da `HISTORIA` é `eu` como o dos outros três: **eu** vivi a história, e
quem a viveu comigo vai em `menciona` — que é, de propósito, onde a marca de
perfil `fizemos_juntos` cai (§8.3).

**Os offsets não saem do modelo.** `offsets.ts` casa cada `trecho` que o modelo
devolveu contra as `palavras[]` da transcrição e registra como conseguiu:

| Âncora | O que significa |
|---|---|
| `exata` | os tokens do trecho aparecem em sequência na transcrição |
| `aproximada` | uma janela do mesmo tamanho tem ao menos 60% deles — o modelo reescreveu de leve |
| `nenhuma` | o trecho não está lá; o átomo fica **sem** `inicio_s`/`fim_s` |

A comparação é por token normalizado (minúsculas, sem acento, sem pontuação),
com um cursor que avança a cada acerto. Sem o cursor, "eu acho que" casaria
sempre com a primeira ocorrência e a sessão inteira apontaria para o mesmo
segundo do áudio.

**Um átomo tem 1..n âncoras** (migration 003), porque ele junta o mesmo assunto
dito em momentos distintos e porque o átomo de `ROTINA` colapsa o dia. Com uma
âncora só, ele afirmaria mais do que dá para escutar — e "todo item aponta para
o segundo exato" é necessidade declarada na visão §4. Só o **primeiro** trecho de
cada átomo empurra o cursor (`localizar.semAvancar` cuida dos demais): deixar o
segundo trecho mover o cursor jogaria a busca do próximo átomo para o fim da
transcrição.

`ancora: "nenhuma"` é deliberado e **diverge do critério 3 da spec**, que pede
offset em todo átomo. Trecho que não existe na transcrição é quase sempre
afirmação que o modelo inventou, e dar a ela um offset plausível seria a mesma
procedência falsa que a regra dos timestamps existe para impedir. A revisão
mostra o átomo sem player, e ele é o primeiro a ser olhado com desconfiança.

Na granularidade `segmento` (4.3) o offset é o da frase inteira: o casamento
devolve a entrada de `palavras[]` de onde o token veio, com a precisão que o
provedor deu — nem mais, nem menos.

#### Resolução de entidade — o que este passo faz, e o que não faz

O extrator devolve, por menção, **o que a transcrição escreveu e o nó que ele
reconheceu**: `{"citado":"Jean","chave":"giampaolo lepore"}`. A chave é `null`
quando ele não reconhece nenhuma das candidatas do dossiê, e é sempre `null`
quando não há dossiê — aí ele devolve o nome cru como sempre devolveu, e
`parsearResposta` lê as duas formas.

**Até a 4.8 este parágrafo dizia o contrário**, e com todas as letras: o prompt
da extração não sabia que entidades existem no grafo, e era de propósito. A
inversão é a slice 4.9 e está no §4.14, com o argumento que a sustenta: o
problema **é** do extrator, porque quem escreve o texto do átomo é ele, e é no
texto que o nome errado se fixa — inclusive dentro do vetor, que sai só de
`a.texto` (§4.10). O que **não** mudou é o resto: `INSTRUCOES_BASE` e `FORMATO`
continuam byte a byte os da 4.7, e o dossiê entra por um bloco injetado.

Quem confronta com o grafo continua sendo o passo seguinte (4.8), que atribui
**cada menção** a um nó — não cada nome. A diferença é a slice 4 inteira: dois
átomos da mesma sessão dizendo "Rafa" podem ser duas pessoas. Desde a 4.9 ele
vê também a chave que o extrator apontou, como quinta camada de candidato, e
valida **toda** menção que tenha candidato.

`entidades.ts` ficou com as duas pontas disso:

| Função | Faz |
|---|---|
| `listarEntidades` | o catálogo: tudo que está no grafo, com tipo, sessões, grafias, `resumo`, `canonico` e os três campos de perfil. Uma consulta só, e é o mesmo objeto que a tela `/entidades` mostra |
| `acharPorChave` | casamento exato que **atravessa alias** de graça: `chaves` traz a grafia própria, as de `e.aliases` e as dos nós fundidos |
| `apresentarEntidade` | como a entidade aparece num prompt — **uma só, para os dois agentes** (§4.8) |
| `agregarCandidatas` | a visão agregada da revisão: uma linha por entidade, com quantas menções caíram nela |

**Só entidade recorrente deve virar nó, e quem filtra é quem revisa.** A
proposta traz "conhecida (3 sessões)" contra "nova, citada 1x"; desmarcada na
revisão, a entidade fica apenas dentro do texto do átomo. Não há regra
automática de recorrência: ela exigiria guardar candidata fora do grafo, e o
julgamento na revisão custa um toque.

Quando a entidade já existe, **o grafo vence**: a grafia gravada e o tipo dos
labels do nó. O extrator propor `:Pessoa` para o que já é `:Projeto` não muda
nada — trocar o tipo de uma entidade existente é edição em `/entidades` (8.2),
não efeito colateral de uma extração.

O tipo é proposto pelo extrator numa lista `entidades` à parte, entre os quatro
de `TIPOS_ENTIDADE` (`:Pessoa`, `:Projeto`, `:Objetivo` e, desde a 007,
`:Organizacao`), e cai em `:Pessoa` quando falta ou vem inválido — num diário
falado, quase sempre acerta. **`:Organizacao` existe porque esse padrão mentia
com frequência**: empresa, ONG, startup e cliente ou nasciam `:Pessoa`, por ser
o padrão, ou `:Projeto`, quando o extrator via trabalho acontecendo — e o que
corre dentro da empresa é que é o projeto. O label é ASCII (`Organizacao`, sem
cedilha) porque vai literal na consulta que grava; como ele é escrito na tela e
nos dois prompts mora em `ROTULO_TIPO_ENTIDADE` (`tipos.ts`).
A contagem de ocorrências sai das referências resolvidas, não dessa lista:
entidade que o modelo listou e nenhuma referência aponta não entra, seria nó
órfão.

**`"eu"` é uma `:Pessoa` como qualquer outra** — decisão tomada, não acidente.
Um átomo sobre quem fala aponta `sobre: "eu"`, e o confirmar cria o nó.

E é **só leitura**: quem cria nó é o confirmar, depois da revisão (regra 5). A
trava contra duplicata em corrida não é este código — é a constraint de
`nome_normalizado` único (8.1), que vale entre todas as entidades.

A normalização é a mesma que o casamento de offsets usa, e por isso mora sozinha
em `texto.ts`. Se as duas divergissem, um nome acharia o áudio certo e ainda
assim criaria um segundo nó no grafo.

#### Pronome não vira nó

Uma sessão inteira sobre alguém que eu nunca nomeio em voz alta não tem contexto
para o modelo resolver — foi o que aconteceu na primeira sessão longa, que
rendeu uma `:Pessoa` chamada **"ela"** com 10 ocorrências. O sistema precisa
saber **pedir**.

A detecção é uma lista fechada em `texto.ts` (`ehPronome`): "ela", "ele", "a
gente", "esse cara", "alguém"… **`eu` fica de fora de propósito** — é entidade
legítima por decisão. Candidata nova cujo nome cai na lista recebe
`precisa_nome`, e a revisão trava o confirmar até eu dar um nome. Entidade que
já está no grafo nunca pede: ela passou por uma revisão minha, e se o nome dela
é o que é, foi porque eu deixei.

A lista mora em `texto.ts` e não em `entidades.ts` porque os dois lados precisam
dela com a mesma regra: a revisão, no navegador, para saber quando ainda falta
nomear; o confirmar, no servidor, para recusar o que passar mesmo assim. Duas
listas divergiriam e a trava valeria só na tela.

O prompt também tenta: manda procurar o nome na transcrição inteira antes de
desistir, e proíbe inventar nome ou apelido. Mas o prompt é tentativa, não
garantia — a trava é o código.

**Pronome trava; dúvida de identidade não** (4.8). São coisas diferentes: um nó
chamado "ela" é grafo apodrecido garantido, enquanto uma atribuição trocada é um
erro que eu conserto depois. Travar a cada dúvida mataria os 60 s da revisão numa
sessão que fale muito de duas pessoas de nome parecido.

### 4.7 Revisão e confirmação

A tela mais difícil de acertar, pela própria visão (§6): tem de mostrar muita
coisa e ser resolvível em menos de um minuto. O desenho segue disso — **abre com
tudo aprovado**. Desmarcar é um toque, corrigir o texto também: tocar no
parágrafo do átomo o transforma em campo, no próprio lugar. Tipo, sujeito e
menções continuam atrás do botão **editar**.

O player é o que torna a revisão confiável: escuto antes de aprovar. Cada âncora
do átomo vira um botão `▶ mm:ss`; átomo sem âncora nenhuma mostra "sem áudio" em
destaque, porque trecho que não existe na transcrição costuma ser afirmação
inventada. `localizarNoAudio` traduz o segundo absoluto em "bloco N, segundo M"
pegando o último bloco que começa antes dele — funciona igual para gravação (um
bloco a cada 30 s) e para importação (um bloco só), sem caso especial.

**O painel de entidades é onde se corrige de uma vez.** Entidade nova tem nome e
tipo editáveis; renomear "ela" para "Marina" uma vez faz todos os átomos que
apontam para ela passarem a apontar para o nome novo. Escolher na barra uma
entidade que **já existe** re-aponta a candidata inteira para ela, e o tipo passa
a ser o do nó: o grafo vence, aqui como na resolução (4.8). Entidade
**conhecida** não tem barra de nome — renomear nó que já existe é trabalho de
`/entidades`, e re-apontar um átomo que caiu no nó errado se faz pelo `sobre`
dele, dentro do átomo.

Entidade com `precisa_nome` vai para o topo, destacada, e **o confirmar fica
desabilitado** enquanto sobrar pronome. Desmarcar deixa a entidade só no texto do
átomo. **Entidade que é sujeito de um átomo aprovado fica travada**: sem ela o
átomo ficaria sem `:SOBRE`, o que o contrato do schema não admite.

O editor de um átomo abre por um botão **editar** — que num átomo em dúvida
(4.8) se chama **escolher**. Menção igual ao sujeito não é exibida nem enviada.

**O texto do átomo edita no lugar, e por isso saiu do editor.** Ele é o campo que
eu mais mexo — o extrator escreve com as minhas palavras, mas erra pontuação e
uma palavra aqui e ali —, e era o único conteúdo do átomo que exigia abrir um
painel embaixo para tocar. Agora o `<p>` vira `<textarea>` no clique (ou no
Enter, porque ele é `role="button"` com `tabIndex`), com a mesma margem, fonte e
entrelinha do parágrafo, altura seguindo o conteúdo (`scrollHeight` no `ref` e a
cada tecla, `resize: none`), e fecha no `blur`. O `cursor: text` do CSS voltou a
dizer a verdade: até a 4.6 ele mentia, sinalizando um clique que não existia
mais. O editor de baixo ficou com o que **não** é texto corrido: tipo, sujeito,
menções e trechos — e a nota "aqui muda só este átomo" saiu junto, porque o
alcance de cada lugar está três parágrafos abaixo, e ela roubava linha da tela
mais apertada do sistema.

**A entidade se corrige em dois lugares, e a diferença entre eles é o alcance.**
Dentro do átomo, no bloco "entidades" do editor, eu troco o sujeito e as menções
**daquele** átomo. No painel do rodapé eu troco o nome de uma candidata e
**todos** os átomos que a citam seguem junto — a tradução acontece em
`nomeFinal()`, na hora de montar o payload, e nenhum átomo é reescrito. Os dois
usam a mesma barra: `SeletorEntidade`.

**A barra é uma lista pesquisável sobre o grafo inteiro.** Foco abre a lista;
apagar tudo mostra o grafo todo, mais falado primeiro; digitar filtra por
**trecho** — "nan" acha "Fernanda". Cada linha traz tipo e número de sessões, e
quando o casamento veio de um apelido ele aparece entre parênteses, senão a linha
apareceria sem motivo visível. As alternativas do agente de resolução vêm
primeiro. O filtro de tipo continua, agora valendo para todas as barras daquele
átomo.

Era um `<input list>` com `<datalist>`, escolhido na slice 4 por não custar
biblioteca. Ele não sustenta o que falta: casa só prefixo em vários navegadores,
não mostra tipo nem apelido, não atravessa alias, e no celular — que é onde este
app vive — degrada para uma tirinha de sugestão. O combobox é escrito à mão, com
os tokens de `globals.css`; nenhuma dependência entrou.

**O campo continua aceitando nome que não existe.** A lista é ajuda, não trava. O
que decide entre reusar um nó e criar outro é o **casamento exato** de
`catalogo.resolver` na montagem do payload: casou (por caixa, por acento ou por
alias), vai a grafia canônica do grafo e o tipo do nó; não casou, nasce entidade
nova com o que eu escrevi. A linha `+ criar "X"` existe só para eu ver de que
lado eu estou antes de confirmar.

O catálogo vem de `GET /api/entidades`, rota que já existia — **rota nova
nenhuma, migration nenhuma**. Se ela falhar, as barras voltam a ser texto livre,
que era o comportamento anterior; `tests/revisao.test.ts` fixa isso.

**O perfil não vem nesse payload** (4.8.1). A revisão baixa o grafo inteiro a
cada abertura (§14) e usa nome, chaves e tipo; os três campos de perfil são o
campo mais pesado da resposta e ninguém os lê ali. Quem quer os campos pede
`?perfil=1`, que é o que `/entidades` faz — a tela que os edita. `resumo` e
`canonico` (009) seguem o perfil, e pela mesma razão. O corte é campo
a campo e não `delete`, para que campo novo em `EntidadeDoGrafo` não vaze para o
contrato do catálogo sem alguém decidir.

**As menções são editáveis** — acrescentar e tirar, uma barra por menção.
Antes elas eram texto morto no item: menção errada só se consertava rejeitando o
átomo inteiro ou renomeando a entidade no rodapé, e as duas são grandes demais
para o erro. A lista viaja inteira nas edições do átomo, e não como delta: sem
isso não dá para distinguir "não mexi" de "apaguei todas".

**Átomo com atribuição incerta aparece marcado**, com a sugestão já preenchida no
seletor. O confirmar **não** trava: ver 4.8.

**A dúvida é de cada referência, e não só do sujeito.** O agente 2 decide por
menção (4.8) e devolve `certo`, `motivo`, `alternativas` e `porque` em cada uma;
até a 4.8.1 a tela lia tudo do `sobre`, e discordância sobre **menção** não
aparecia em lugar nenhum — o átomo passava aprovado, sem marca, com a menção
atribuída a quem o agente não teve certeza de ser. Agora a marca do átomo, o
bloco de dúvida e a barra de cada menção olham a lista de referências incertas:
`referenciasDoAtomo` devolve o sujeito e as menções na ordem da tela, e
`incertasDoAtomo` filtra. As duas são funções puras exportadas da `Revisao`, pelo
mesmo motivo que `montarCorpoDoConfirmar`: é lógica que quebra em silêncio, e
`tests/revisao.test.ts` a fixa sem render.

O formato é **um** parágrafo por átomo, com uma linha por referência incerta, e
não um bloco por referência. É a mitigação declarada do custo: esta é a tela mais
apertada do sistema, e o "menos de 60 s" segue sem medição (§14).

**A linha da dúvida virou uma pergunta, e só isso.** Ela dizia "de quem é?
escolhi X para 'Y' — motivo do agente · também podia ser Z, W": a decisão vinha
enterrada no meio da justificativa, e a justificativa é longa justamente nos
casos difíceis. Hoje ela diz `acho que é **X** — confirma?` (e `menção 2: acho
que é X — confirma?` para as menções, por `ondeEstaA`). O que saiu — `citado`,
`motivo` e `alternativas` — **não** deixou de existir no dado nem no payload: as
alternativas já estavam no topo da lista do seletor, que é onde elas servem para
alguma coisa, e o motivo é procedência, que passou a morar no modal de fontes,
abaixo. A tela pergunta; quem quiser o porquê, pede.

#### As fontes moram atrás de um ícone, e não na vista padrão

A procedência do GraphRAG — a frase da camada (`FRASE_DA_CAMADA`) e os trechos de
átomos passados que votaram — era uma lista `.porque` **sempre visível** embaixo
de cada átomo desde a 4.8.1. Numa proposta de nove átomos, com o dossiê da 4.9
resolvendo quase toda menção, isso é a maior parte do que a tela mostra, e nada
disso é decisão: é explicação de uma decisão que quase sempre está certa.

Ela saiu da vista padrão e virou **modal**. Cada nome na linha "sobre X · menciona
Y" ganha um `ⓘ` ao lado — `EntidadeRef` —, e só ganha quando aquela referência
tem evidência (`herdadasDoAtomo`, isto é, `porque` ou `camada`); as demais ficam
só o nome, sem ícone e sem espaço gasto. Clicar abre um diálogo centralizado com
o nome da entidade, a frase da camada e as citações. Diálogo e não gaveta lateral
porque o conteúdo é curto e é sobre **um** ponto da tela; `Escape` e o véu fecham,
como na gaveta de agentes (4.13).

**A trava de índice das menções vale para o ícone também**, e é por isso que
`mencoesEntradas` carrega o `ordem` original: filtrar a menção igual ao sujeito
desloca a posição na tela, e `herdadas` casa por índice pré-filtro. Ícone na
entidade errada é a mesma classe de erro que sugestão na linha errada — só que
mais silenciosa, porque o modal parece ter respondido.

**A condição da camada 3b continua satisfeita, e agora com uma condição a mais.**
O §4.10 declara que aquela camada só é aceitável porque o átomo que a elegeu está
na tela, corrigível. Ele está — a um toque, e marcado com um ícone que só aparece
quando há o que ver. O que a fatia troca é "sempre à vista" por "sempre
alcançável", e a troca é deliberada: uma tela que mostra tudo o tempo todo é uma
tela que não se resolve em 60 s, e o custo declarado é meu se eu deixar de clicar.

**A armadilha do índice, e ela é silenciosa.** As menções na tela são uma lista
por posição, e a referência casa com a posição **por índice**. Assim que eu
acrescento ou removo uma menção daquele átomo, o índice desloca e a sugestão
apareceria na linha errada — dizendo "escolhi Raffa" ao lado de outro nome. A
trava é a edição: enquanto `edicoes[indice].menciona` for `undefined` a lista é a
da proposta e o índice vale; a partir da primeira edição as menções saem da
conta e sobra a dúvida do **sujeito**, que é um valor só e não desloca. Perder a
sugestão é o preço, e é o certo — sugestão na linha errada é pior que sugestão
nenhuma. Está no teste, e não só no comentário.

**As marcas de perfil aparecem, e não são editáveis.** Quando o agente 2 aponta
que um átomo diz algo do perfil de alguém, a linha "vai para o perfil: Raffa ·
fizemos juntos" fica visível no item — desmarcar o átomo, ou desmarcar a
entidade, é o que tira a marca. Elas viajam no corpo do confirmar com o nome
**final**, como `sobre` e `menciona`, porque são conteúdo e a revisão pode ter
renomeado a entidade. O servidor recusa campo fora do schema e entidade fora da
lista aprovada.

#### O que o cliente pode mandar, e o que não pode

`POST /api/sessoes/:id/confirmar` recebe quais átomos foram aprovados e como
foram editados — texto, tipo, sujeito, menções. O corpo é montado por
`montarCorpoDoConfirmar`, função pura exportada da `Revisao` porque é a lógica
que quebra em silêncio: entidade citada que não entrar em `entidades` é
descartada pelo servidor **sem uma palavra**, e o erro só aparece no grafo dias
depois. Toda menção que eu acrescentei entra na lista junto; toda entidade que eu
desmarquei no rodapé sai dela, e sai também das menções — o alcance do checkbox é
o nó, não só o sujeito. **Procedência não vem no corpo.**
`id`, offsets, âncoras, `prompt_version` e `modelo` são relidos de
`extracao.json` pelo índice do átomo. Se viessem do navegador, seriam uma
afirmação dele, e átomo com procedência falsa é pior que átomo nenhum.

Entidade só é gravada se algum átomo aprovado de fato a usa: aprovar na tela e
depois rejeitar todos os átomos dela não pode deixar nó órfão.

**A lista de entidades vem da tela, não da proposta.** Era o contrário, e por
isso renomear o sujeito de um átomo devolvia 400: o servidor exigia que ele
estivesse entre as entidades da extração, e a lista não tinha como crescer. Agora
o corpo manda `entidades: [{ nome, tipo }]` com os nomes finais, e o cliente
acrescenta qualquer sujeito que eu tenha escrito à mão. Duas guardas no servidor,
porque a regra não pode depender da UI: nome que caia na lista de pronomes é
recusado com 400, e `tipo` é validado contra `TIPOS_ENTIDADE`.

### 4.8 Identidade por contexto (agente 2, `resolucao-5`)

**"Raffa" e "Rapha" são o mesmo som.** O STT escreve uma grafia só para os dois,
e ter os dois nomes no vocabulário não ajuda — só torna arbitrário qual sai. A
grafia na transcrição carrega **zero** sinal sobre quem é.

Isso mata qualquer solução baseada em nome, e é o que separa esta slice da 3. Lá
o problema era duas grafias para a mesma coisa, e `nome_normalizado` resolvia
(8.2). Aqui é o contrário — **uma grafia para duas coisas** — e a chave não pode
resolver, por construção. Só o contexto resolve, e desde a 4.11 esse contexto é
o **`resumo`** da entidade (8.3.1) — o retrato de identidade que eu escrevo, no
lugar dos três campos de perfil que ele lia antes.

```
janela ──────▶ agente 1: extracao-9   devolve {citado:"Rafa", chave}
                      │
                      ▼
                agente 2: resolucao-5  vê os átomos + as entidades com resumo
                      │                decide POR MENÇÃO: qual nó, ou nova
                      ▼                marca o que é informação de perfil
                revisão ──▶ confirmar ──▶ grafo
```

#### Uma apresentação só, para os dois agentes (4.11)

Até a 4.10 a mesma entidade tinha **duas caras**, para dois agentes que leem o
mesmo trecho: o dossiê do extrator mostrava nome, tipo, grafias concatenadas numa
string e o campo `contexto` isolado — um dos três, escolhido em código, sem que
ninguém tivesse decidido que era o que mais identifica alguém; e o catálogo do
agente 2 mostrava os **três** campos inteiros, de **todas** as entidades do
catálogo, em toda chamada.

`apresentarEntidade` (`entidades.ts`) é a apresentação única, e mora no módulo que
define o que uma entidade é para as outras camadas — duas cópias do mesmo texto
divergiriam no primeiro ajuste, que é o problema que a fatia resolveu:

```
- chave "giampaolo lepore" — Giampaolo Lepore (pessoa, 3 sessão(ões), ficha oficial)
    também escrito: Jean, Giam
    Sócio na Adapta. Mora em Floripa, faz slackline.
```

`sessão(ões)` é a única diferença entre os dois usos, e é do agente 2: quantas
vezes eu falei daquela entidade serve a quem decide a atribuição, não a quem só
precisa achar um nome. A marca de ficha oficial entra **dita no prompt**, e não só
no desempate determinístico: sem ela o modelo nunca saberia que uma ficha é a
oficial, e é ele quem lê o catálogo.

**Resumo vazio não ganha fallback** — a linha é "(sem resumo escrito)", e é a
resposta certa. Preencher com `contexto` esconderia o buraco em vez de mostrá-lo:
o agente devolve confiança baixa, e é isso que dispara a segunda passada com o
perfil inteiro. Entre a 4.11 e a 4.12 essa passada vai ser a regra, e é o preço
declarado (§14).

**É esta seção que matou o `TETO_PERFIL`.** O teto de 300 existia por causa deste
consumo, e a migration 005 o dizia com todas as letras: "os três campos de todas
as entidades entram no prompt do agente de resolução, e sem teto o custo daquela
chamada cresce com o tamanho do grafo". Os três campos saíram do caminho comum —
eles só aparecem na segunda passada, para os poucos candidatos de uma menção em
dúvida. O motivo do teto foi embora com eles.

Dois agentes e não um, com `prompt_version` própria cada um (regra 7): calibram
separado, e um erro de atribuição se conserta sem tocar na extração que está boa.
De quebra o agente 2 roda **sem re-extrair** — calibrar a resolução não custa uma
chamada de extração por tentativa.

#### A atribuição é por menção, não por sessão

`AtomoProposto.sobre` é uma `ReferenciaResolvida` e `.menciona` é uma lista
delas:

```ts
{ citado, entidade, conhecida, certo, alternativas, motivo, porque, camada? }
```

`citado` guarda o que o extrator escreveu; `entidade` é a quem foi atribuído.
Até a slice 3 todas as menções ao mesmo nome colapsavam numa candidata só,
válida para a sessão inteira — o que não tem como expressar que dois "Rafa" da
mesma sessão são duas pessoas. O painel de entidades da revisão continua
existindo, agora como **visão agregada** do que foi resolvido.

**Compatibilidade:** proposta gravada antes da slice 4 tem `sobre` como string.
`referencias.ts` lê os dois formatos — string vira referência com `certo: true`,
porque o que o extrator disse era tudo o que havia e destacar dúvida ali seria
inventar uma que ninguém teve. É o que impede a tela de quebrar numa sessão que
já estava esperando em `em_revisao`.

#### Uma vez por janela, sobre as menções daquela janela (slice 4.8)

O agente 2 continua rodando **dentro** da extração, e por isso ele também virou
por janela: as menções que nascem numa janela são decididas quando ela fecha, e
nunca reabertas. Duas consequências opostas, e as duas são deliberadas:

- **ele não perde o que veio antes.** `montarPrompt` recebe os átomos já
  propostos num bloco de contexto próprio — "não decida sobre eles" —, antes dos
  átomos desta janela. Uma "Rafa" do minuto 8 é julgada sabendo da "Raffa" do
  minuto 2;
- **ele não vê o que ainda vai vir.** É a mesma limitação da extração, e o
  conserto é o mesmo: eu, na revisão.

`PROMPT_VERSION_RESOLUCAO` **não** subiu com isso, e a razão é o contrário da
que fez a extração subir: o texto do prompt é o mesmo, o bloco de contexto some
quando está vazio, e o que um `prompt_version` precisa resolver é um texto
(§4.13). O que mudou foi o recorte da sessão que ele enxerga — está aqui e no
§14, e não num número.

O custo é até uma chamada de resolução por janela em vez de uma por sessão. A
trava que a torna condicional continua valendo, agora por janela: janela sem
menção ambígua não chama o agente e não paga nada.

#### Só chama o modelo quando há o que decidir

Uma passada determinística e de graça monta os candidatos de cada menção,
reusando `proximidade` de `duplicatas.ts` — que pega o homófono de brinde, porque
"Rafa" fica a uma ou duas letras de "Raffa" e de "Rapha".

| Situação da menção | O que acontece |
|---|---|
| a união tem **um** candidato, e ele é exato | resolve ali, `certo: true`, de graça |
| a união está vazia | entidade nova, `certo: true`, de graça |
| qualquer outra coisa | vai ao agente |

**A conta é sobre a união deduplicada das quatro camadas** (§4.10), não sobre a
camada de string sozinha — foi o que mudou na 4.5, quando as duas camadas
semânticas entraram. O caso comum de uma sessão sem ambiguidade é a grafia casar
com um nó **e** os vizinhos votarem no mesmo nó: união de tamanho 1, decisão de
graça, agente 2 não chamado. `decidir()` (`resolucao.ts:265`) diz o mesmo com
todas as letras no próprio cabeçalho.

A última linha cobre o caso traiçoeiro, e é por isso que ela não é "dois ou mais
candidatos": o STT escreve "Rapha" exatamente, o casamento de string acerta **por
sorte**, e como "Raffa" é parecido a menção vai ao agente mesmo assim. Sem ela o
sistema acertaria metade das vezes por acidente e erraria a outra metade em
silêncio. Um parecido sozinho também vai — decidir entre "é o Raffa" e "é alguém
novo chamado Rafa" é exatamente o julgamento desta slice.

**Se nenhuma menção precisar de julgamento, o agente não é chamado** e a sessão
não paga nada. `prompt_version_resolucao` e `modelo_resolucao` ficam `null` na
proposta: registrar uma versão que não rodou seria mentira na procedência.

Uma chamada só para a sessão inteira. O catálogo que vai no prompt é o das
entidades que **esta sessão pode citar** — as já resolvidas e os candidatos —, e
não o grafo inteiro: uma menção só resolve para um candidato dela, e mandar o
resto seria pagar por texto que não muda resposta nenhuma.

#### Dúvida destaca, não trava

Referência com `certo: false` — o sujeito **ou** qualquer menção — deixa o átomo
marcado na revisão, com a sugestão preenchida na barra daquela posição e o motivo
ao lado (§4.7). O confirmar continua liberado. Diferente do pronome, que trava:
ali o resultado seria um nó chamado "ela", grafo apodrecido garantido. Aqui o
pior caso é uma atribuição trocada, que eu conserto depois — e travar a cada
dúvida mataria os 60 s da revisão. "Ignorar é sempre uma saída válida"
(visão §5.3).

#### A regra de tipo é arbitrada pelo código, e não só pedida ao extrator

O `extracao-9` diz, sem exceção: **SENTIMENTO, APRENDIZADO, HISTORIA e ROTINA
são sempre de `eu`** (`HISTORIA` entrou na lista com a migration 007) —
sentimento é meu por definição mesmo quando foi outra pessoa que o provocou, e
quem provocou vai em `menciona`. A resolução não respeitava isso, e
não por descuido do agente: as camadas semânticas são calculadas **por átomo**
(4.10) e entregues a todas as menções dele sem filtro pelo citado, então `"eu"`
casa exato, a 3b traz de quem são os vizinhos, a união vira 2 e a menção vai ao
agente. Ele então pode responder outra pessoa — e um `SENTIMENTO` saía
`sobre: "Giampaolo Lepore"` com `certo: true`, sem marca nenhuma na tela.

A guarda é **validação, não atalho**: o agente continua vendo a menção, e o
código recusa o julgamento que tira o sujeito de `eu` nesses quatro tipos. É a
mesma forma de `validarMarcas` — deixar o agente opinar e recusar o que quebra o
contrato de quem veio antes. Deixar de perguntar seria a outra saída, e ela
contradiz a decisão de validar toda menção (4.9 do `Specs/`).

Duas fronteiras, e as duas são de propósito:

- **só o sujeito**, e só quando o extrator de fato escreveu `eu`. Se ele já
  violou o próprio contrato e pôs outra pessoa ali, quem arbitra é a revisão;
- **a recusa aparece** — `certo: false` com o motivo dizendo o que houve. Um
  agente querendo tirar um SENTIMENTO de `eu` costuma ser sinal de que o tipo do
  átomo está errado, e isso só se conserta se eu vir.

A frase equivalente dentro de `INSTRUCOES` — repetir a regra de tipo para o
agente não gastar a decisão à toa — **entrou no `resolucao-3`** (slice 4.9), que
era a fatia que já ia subir a versão do prompt de qualquer jeito. A regra passou
a ser dita nos dois prompts e imposta nas duas pontas do código; a migration 007
acrescentou `HISTORIA` aos três tipos, nos quatro lugares de uma vez, porque
`TIPOS_SEMPRE_EU` é a lista única que todos leem (§14).

#### Resposta ruim degrada para dúvida, nunca para atribuição errada

| O que aconteceu | O que o sistema faz |
|---|---|
| o agente julgou outras menções e não esta | `certo: false`, com o motivo dizendo isso |
| respondeu uma chave fora dos candidatos **daquela** menção | idem, e o motivo **nomeia a chave que veio** — a resposta é descartada, mas a frase não afirma silêncio onde houve resposta |
| respondeu, e **nenhum** julgamento veio | todas as pendentes voltam `certo: false` dizendo que ele respondeu sem julgar, e `[resolucao]` no log leva o `diagnostico()` e uma amostra da resposta crua |
| o agente falhou ou veio sem JSON | todas as pendentes voltam `certo: false`, com `[resolucao]` no log — e o mesmo `diagnostico()` da extração junto, porque o modo de falha é o mesmo |

As três frases são diferentes de propósito (4.8.1): a do meio existia como "o
agente não respondeu por esta menção" nos três casos, e era ela que eu lia para
decidir se o agente estava funcionando. A terceira linha é o instrumento que
faltava — sem ela, uma resposta que o parser não entende sai paga e muda para
"ninguém respondeu". `parsearResposta` também passou a aceitar **array solto**,
como `isolarJson` na extração: `[{"n":1,…}]` era lido do primeiro `{` ao último
`}` e virava um objeto sem `referencias`, ou seja, uma janela inteira decidida
sem segunda opinião e sem uma linha de log.

Falha do agente **não derruba a extração**, que já foi paga: a proposta abre com
as dúvidas destacadas e eu escolho na mão. E o fallback é sempre o casamento
exato quando existe, ou entidade nova quando não — **nunca o parecido**. Duas
entidades a mais eu conserto em `/entidades`; fundir duas pessoas por um palpite
não tem desfazer. A evidência que vai junto do fallback é a do **primeiro
candidato que tem alguma**, e não a do exato: a camada `exato` nunca traz
`porque`, então o `??` de antes apagava a evidência dos vizinhos justamente no
caso em que eu preciso dela para decidir.

**`NOVA` que colide com um nó existente também é dúvida.** Quando o agente
responde `NOVA` e a grafia citada já é o `nome_normalizado` de alguém, o
confirmar **não** cria um segundo nó — a constraint da migration 002 não deixa,
`agregarCandidatas` remapeia e o átomo cai no nó que existe. Ou seja, o agente
diz "é outra pessoa" e o sistema faz o oposto. A causa é legítima e fica; o que
mudou é o sinal: `certo: false`, com o motivo nomeando o conflito, que é o que
me manda renomear uma das duas.

**Duas menções iguais dentro do mesmo átomo viram uma pergunta só.** Elas têm a
mesma lista de candidatos por construção — as camadas de string olham o citado,
as semânticas são calculadas por átomo —, então numerá-las duas vezes pagava a
mesma pergunta duas vezes e ainda admitia duas respostas diferentes para a mesma
coisa. A resposta única vale para as duas posições, cada uma guardando a grafia
dela. **Entre átomos elas continuam duas**: é o ponto inteiro da slice 4.

A conferência da chave do Gateway (`garantirGateway()`) acontece **antes de
embutir**, e não só no ramo com pendentes: embutir o texto do átomo já é tráfego
de modelo. Catálogo vazio continua não exigindo chave nenhuma — por ali nada sai
pelo Gateway.

### 4.8.1 A confiança, e a segunda passada (`desempate-1`, slice 4.11)

Até a 4.10 o agente 2 respondia `certo: true | false`, e `false` era a única
coisa que a tela sabia pintar. **Não existia "resolvi com folga" nem "resolvi
raspando", e não existia caminho nenhum para ele pedir mais informação**: ou ele
decidia com o que recebeu, ou marcava dúvida e me empurrava a decisão.

Agora ele devolve `confianca`, de 0 a 1, com o que o número significa dito em
palavras dentro do prompt — 1 é "o átomo casa com a ficha de um deles e de
nenhum outro", 0,5 é "nada no átomo distingue os candidatos". Abaixo do
`LIMIAR_CONFIANCA` (0,7, editável em `/agentes`), a menção vai à **segunda
passada**.

```
agente 2 (resolucao-5)  →  confiança ≥ limiar  →  vale, certo: true
                        →  confiança <  limiar  →  desempate-1
                                                   ├─ duvida: false → certo: true
                                                   └─ duvida: true  → a revisão marca
```

**Agente próprio, com prompt próprio.** A 4.8 recusou uma passada de costura
alegando um prompt a mais para calibrar à mão para sempre, e o argumento é bom.
Ele não se aplica aqui porque o papel é outro: este agente já **sabe** que a
primeira leitura não resolveu, ele olha **uma** menção, e ele tem o perfil
inteiro na mão. Instruir isso dentro do prompt geral seria escrever um agente
dentro do outro.

O que ele recebe, e que a primeira passada não tinha:

| Entra | Por quê |
|---|---|
| o átomo e a grafia citada | é sobre eles que a decisão se faz |
| o que a primeira leitura respondeu, com a confiança e o motivo | ela viu menos, mas viu algo; não é veredito |
| a ficha **completa** dos candidatos **daquela** menção | resumo, grafias, marca de ficha oficial e os **três campos de perfil, sem teto** |

É a última linha que tornou o `TETO_PERFIL` desnecessário. O perfil não saiu do
sistema na 4.11 — ele saiu do **caminho comum**, e este é o lugar onde ele sempre
valeu a pena: poucos candidatos, de uma menção só.

**Não é tool use, e é escolha.** "Ele consulta uma entidade, lê, decide se quer
outra" seria mais fiel a "ele decide". Foi recusado pelo relógio: isto roda
dentro da extração de cada janela, e a 4.8 existe para cortar espera — um laço de
rodadas imprevisíveis é exatamente o que ela tirou.

**Um limiar, e não dois.** Dois — um para "preciso de mais informação", outro
para "nem com tudo eu resolvo" — seriam duas réguas para calibrar à mão, para
sempre. Com um só, **o que a segunda passada devolver vale como final**, e dúvida
na tela só quando ela marcar `duvida: true` — e aí a revisão pinta o "acho que é
X — confirma?" que já existe, sem uma linha nova de UI.

Degradação, no mesmo contrato do agente 2: falha, resposta vazia ou chave fora
dos candidatos daquela menção deixam o que a primeira passada decidiu, **já
marcado como dúvida** — que é exatamente o que o limiar tinha dito sobre ela.
`duvida` ausente conta como dúvida: o agente que esqueceu o campo não me
autorizou a gravar calado.

As guardas de quem veio antes continuam valendo porque a segunda passada reusa o
mesmo `responder` da pendente: o `eu` travado nos quatro tipos, a colisão de
`NOVA` com um nó existente, e a resposta que vale para as menções iguais do mesmo
átomo. Sem isso, ela seria o buraco por onde um `SENTIMENTO` sai de `eu`.

**Uma chamada por menção, em paralelo**, com `comEsperaDeLimite` e o mesmo `ate`
da janela. Série seria mais educada com o rate limit e mais cara no relógio da
janela do fim, que é a única espera que eu sinto depois de parar de falar.

**O log é a instrumentação da fatia, e o silêncio é informação:**

```
[desempate] sessão <id>: N menção(ões) abaixo do limiar
```

Nenhuma linha quer dizer que a primeira passada bastou em todas. Enquanto os
resumos estiverem vazios isso é o **contrário** do esperado — e é o primeiro
sinal de que o limiar está baixo demais, ou de que a confiança está vindo
inflada (§14).

**O desempate determinístico do canônico acontece antes de qualquer chamada.**
Em `candidatosDe`, os parecidos vêm ordenados por proximidade e, no empate, o
`canonico` vence. Importa porque `unir()` corta em `TOP_K`: dois nós igualmente
próximos disputam a mesma vaga, e quem fica de fora não chega a ser oferecido ao
agente. Até a 4.11 isso era decidido pela ordem em que o catálogo voltava do
banco — consequência do laço, e não decisão.

### 4.9 A ficha, o agente 3 e o agente 4 (`perfil-1`, `enriquecimento-1`)

A ficha de uma entidade tem quatro campos de texto: o `resumo` (o retrato de
identidade, teto de 500) e os três da 005 — `contexto`, `pode_ajudar_com`,
`fizemos_juntos` —, **sem teto desde a 4.11**. O `TETO_PERFIL = 300` não era
estética: os três campos entravam no prompt do agente 2 em toda chamada, e sem
ele o custo crescia junto com o grafo. Esse consumo acabou (§4.8): quem lê os
três agora é a segunda passada (§4.8.1), e só para os candidatos de **uma**
menção em dúvida. Quem cobra tamanho é o `TETO_RESUMO`, do campo que entra em
todo prompt.

**Dois agentes escrevem nesses campos, e eles têm regimes opostos.** A 4.12
abriu o segundo, e esta seção existe para deixar claro qual é qual.

| | agente 3 — `perfil-1` | agente 4 — `enriquecimento-1` |
|---|---|---|
| escopo | **um** campo | os **quatro** de uma vez |
| o que lê | os átomos marcados por `:PERFILA` naquele campo, teto de 20 | **todos** os átomos ativos ligados por `:SOBRE` ou `:MENCIONA`, sem teto |
| o que faz com o resultado | **devolve**; o proposto aparece ao lado do atual e eu decido | **grava**, sem eu ver antes |
| gatilho | botão "rascunhar", por campo | checkbox + botão "enriquecer", por entidade |
| onde roda | dentro da resposta da rota | fila assíncrona, sem janela aberta |
| desfazer | não precisa — nada foi escrito | uma geração, a um toque |

#### O agente 3 continua como estava

Ele lê os átomos que o agente 2 marcou como informação daquele campo e devolve o
texto novo — e **não grava nada**. O proposto aparece **ao lado** do atual, nunca
por cima; eu aceito, edito ou ignoro. Continua `perfil-1` byte a byte: o "no
máximo 300 caracteres" do texto dele ficou como número literal, porque nunca foi
o corte — é instrução de concisão, e é texto calibrado.

**Quem aponta o que é perfil é o agente 2**, que já está olhando átomo e entidade
juntos, e é ele que a 4.9 passou a chamar em toda janela. A marca vira
`(:Atomo)-[:PERFILA { campo }]->(:Entidade)` no confirmar (§8.3), e só ali
(regra 5). A validação é dupla: o agente só pode marcar uma entidade que o
**próprio átomo** cita, e o servidor só grava campo do schema e entidade
aprovada.

**A 4.12 não tocou no `:PERFILA`, nem em quem o marca, nem no agente 3.** O que
acontece com ele — conviver, encolher ou sair — se decide depois de o lote rodar
e eu ver se ainda uso o botão.

#### O agente 4 escreve sozinho, e isso reabre uma decisão desta seção

**Até a 4.12, esta seção dizia que nada entrava no perfil sem o meu toque campo a
campo.** O risco que sustentava a regra continua verdadeiro, e por isso está
escrito de novo aqui: o perfil é exatamente o que os agentes leem para
desambiguar; ficha errada contamina toda atribuição futura, e o erro se
realimenta — átomo atribuído ao Rapha por engano vira evidência do perfil do
Rapha.

**O que mudou não foi o risco, foi a conta.** A regra cobrava um toque por campo
por entidade, e o resultado medido foi cinco entidades no grafo **sem nenhum dos
quatro campos escritos**, desde 02/09 — com a camada 3a (candidatos por perfil)
nascendo inerte por falta de texto para comparar, e, depois da 4.11, com
**quase toda menção caindo na segunda passada** porque o `resumo` estava vazio. A
defesa perfeita não estava protegendo nada: não havia ficha para proteger.

A defesa passou a ser outra, e ela é de três partes:

| | |
|---|---|
| **eu escolho quem entra** | checkbox por linha e "selecionar todas" — a seleção mais o botão são o meu toque |
| **eu leio a ficha depois** | `/entidades` é a mesma tela onde o resultado aparece, campo por campo, editável |
| **o desfazer está a um toque** | os quatro campos voltam de uma vez, e o toque acidental se conserta com outro toque |

**A regra 5 do `CLAUDE.md` continua valendo inteira, e não foi emendada.** Ela
fala de **átomo** e da tela de revisão: nenhum átomo entra no grafo por este
caminho. O que mudou de regime foi a ficha da entidade, e é esta seção que
registra a mudança. Emendar a regra 5 para acomodar um caso que ela não cobria
foi recusado — alargar a regra mais forte do projeto é caro, e desnecessário.

#### O que o agente 4 lê, e por que não é `:PERFILA`

Todos os átomos ativos ligados por `:SOBRE` ou `:MENCIONA`, do mais novo para o
mais velho, com tipo e data. Sem filtro e sem teto.

`:PERFILA` é o filtro que o agente 2 aplica em tempo de extração, com o critério
dele — "de fato acrescenta algo duradouro" —, e o próprio prompt diz que lista
vazia é resposta legítima. O efeito é que a maior parte do que o diário sabe de
uma pessoa nunca chegava ao perfil dela: a menção de passagem, a história em que
ela aparece, o trabalho que apareceu num `FATO` sem virar marca. O lote não
precisa desse filtro — ele decide o que importa **com todos os átomos na
frente**, que é uma decisão melhor informada que a de quem viu um átomo por vez.

**Relê tudo a cada rodada, e não acumula.** Incremental (o resumo atual mais os
átomos novos) teria custo constante por rodada — é o desenho do agente 3 —, mas
um erro escrito numa rodada se perpetuaria nas seguintes: a ficha carregaria para
sempre o que uma rodada ruim escreveu. Relendo tudo, **reordenar prioridade é só
rodar de novo**.

**Uma chamada por entidade, e não uma por campo:** os quatro campos saem da mesma
leitura, e quatro chamadas leriam os mesmos átomos quatro vezes.

**Entidade sem átomo nenhum não vai ao modelo.** Ela sai `pronta` com os campos
inalterados e `enriquecimento_atomos: 0`. Pagar uma chamada para não ter o que
dizer é desperdício, e sobrescrever a ficha com o vazio seria perda.

O prompt diz três coisas que decidem a qualidade do resultado: o `resumo` é
**retrato de identidade** — a primeira frase é sempre o que distingue esta
entidade de outra parecida —; os três campos mantêm palavra por palavra a
descrição que o agente 3 já usava, para os dois não divergirem; e **só se afirma
o que os átomos sustentam**, que é a regra que mais importa aqui, porque ninguém
revisa antes de gravar.

#### A fila: como ela anda sem janela aberta

O mecanismo não é novo — é **estado idempotente mais `waitUntil`**, o mesmo da
transcrição por blocos desde a slice 2. A diferença é onde o estado mora: no nó
(`enriquecimento_estado`, migration 010), e não no navegador.

```
POST /api/entidades/enriquecer { chaves }
  grava na_fila em todas  →  responde na hora  →  waitUntil(primeiro elo)

cada elo ({ elo: true }):
  reivindica UMA (na_fila → rodando, escrita condicional)
  responde na hora, e em waitUntil: roda o agente, grava a ficha,
  marca pronta ou falhou, põe os vetores em dia
  →  chama a si mesmo para a próxima
fila vazia  →  o encadeamento para
```

**O elo seguinte é requisição nova, e não um laço dentro da mesma função.** Duas
razões: cada entidade começa com o orçamento de execução inteiro (`maxDuration =
300`), e quem chamou pode morrer assim que a resposta sai, em vez de ficar vivo
segurando o resto da corrente. O elo se autentica com o **meu próprio cookie**,
repassado da requisição que o originou — a fila não abre porta nenhuma que já não
estivesse aberta (§7).

**Rate limit sem prazo.** `comEsperaDeLimite` é chamado **sem `ate`**: não há
ninguém esperando do outro lado da tela, então a fila pode dormir o quanto o
Gateway pedir. É a diferença entre este agente e os que rodam dentro da extração
de uma janela, onde a espera come o orçamento de fechar a sessão.

**Retomada:** entidade em `rodando` com carimbo mais velho que `LEASE_MS` (300 s,
o mesmo teto de execução) volta a ser reivindicável — e isso mora **na própria
consulta de reivindicação**, e não numa varredura à parte: um lugar só decide
quem é a próxima.

**Idempotência (regra 4):** a chave é a entidade. Rodar duas vezes a mesma
entidade produz a mesma ficha a partir dos mesmos átomos, e o `_anterior` da
segunda rodada é o resultado da primeira — que é o comportamento certo, e o custo
declarado de guardar uma geração só.

#### O desfazer, e por que ele é uma troca

`resumo_anterior`, `contexto_anterior`, `pode_ajudar_com_anterior` e
`fizemos_juntos_anterior` (migration 010) guardam **uma** geração. O botão de
desfazer volta os quatro de uma vez.

**Ele troca em vez de restaurar**: o que estava na ficha vira o `_anterior`.
Assim o invariante — "o `_anterior` é sempre a geração imediatamente anterior" —
continua verdadeiro depois dele, e o pior caso de um toque acidental é outro
toque. É por isso que o desfazer é de **um** toque, e não de dois como o apagar
de sessão: ele restaura, não destrói.

**Toda escrita de campo de ficha guarda o `_anterior`, e não só o lote.**
`gravarCampo` (`perfil.ts`) e `gravarResumo` (`fusao.ts`) fazem o mesmo, pelo
mesmo invariante: sem isso, uma edição minha depois do lote deixaria o
`_anterior` apontando duas gerações atrás, e um toque no desfazer apagaria o
texto que eu tinha acabado de escrever.

Histórico com data e origem foi recusado: custaria nós ou propriedades novas e
uma tela para ler isso, para cobrir um caso que ainda não aconteceu. Uma geração
cobre o caso real — rodei, olhei, não gostei, voltei.

### 4.10 O vetor, e as duas camadas semânticas (slice 4.5)

Até aqui **toda semelhança deste sistema era grafia**: `nome_normalizado` na
slice 3, `proximidade()` na 4. Letra não alcança dois átomos que dizem a mesma
coisa com palavras diferentes, nem uma pessoa cujo nome eu falo de um jeito que o
grafo não escreveu. O vetor é a primeira comparação daqui que não passa por
letra.

**O que isto não é.** Não é economia de token: o gasto dominante continua sendo
o `extracao-9`, que manda a fala inteira ao modelo — hoje repartida em janelas
(§4.6), o que não muda o total —, e embedding não corta um token dele. O que ele
compra é a **seleção de candidato** — a mesma peça que a slice 5 usa para achar
candidato de *relação* entre átomos (§4.15), e que também é a única forma
possível de um dia deduplicar átomo: cinco sessões por semana a 15 átomos dão
~3.900 átomos por ano, ou ~7,6 milhões de pares, que não é caro: é impossível.

```
src/lib/embedding.ts   texto → vetor. Fala com o Gateway, não com o Neo4j
src/lib/entidades.ts   vetor → candidatos. Fala com o Neo4j, e junta as pontas
src/lib/resolucao.ts   candidatos → decisão. Não fala com nenhum dos dois
```

Essa divisão é a mesma que já existe entre `duplicatas.ts` (string pura,
testável sem rede) e quem a usa, e é o que deixa a **regra de união** — que é
onde os erros de desenho moram — testável sem banco e sem chave.

#### O que vira vetor, e o que fica de fora

| Nó | Fonte do vetor |
|---|---|
| `:Atomo` | **só `a.texto`** |
| `:Entidade` | uma string canônica: `nome`, `tipo`, `aliases` e os três campos de perfil, com campo vazio **omitido**. As grafias vêm da união das duas fontes desde a 009 (§8.2); o `resumo` **não entra** — pô-lo ali reembutiria o grafo inteiro e mudaria a camada 3a, e isso é decisão que a 4.11 não tomou |

Nada de tipo, entidade ou sessão no átomo: as três já são estrutura no grafo, e a
divisão é essa — **o corte estrutural é do grafo, o semântico é do vetor.** Enfiar
o tipo no texto embutido faria dois APRENDIZADO parecerem próximos por serem
APRENDIZADO, que é exatamente o sinal que o grafo já dá de graça e melhor.

Na entidade, o nó inteiro **não** entra. `id`, `nome_normalizado` e `chaves` são
duplicação ou ruído; e `sessoes`/`atomos` são contagens que mudam a cada confirmar
sem que o significado da entidade mude — entrariam no hash e forçariam reembutir o
grafo inteiro toda sessão, de graça. Campo de perfil vazio é omitido e não posto
em branco: string vazia no meio do texto é ruído com posição.

**Os átomos da entidade ficam de fora, e isso é decisão, não esquecimento.** Com
átomos na fonte, um átomo atribuído errado viraria evidência para a próxima
atribuição — dissolvido num vetor que ninguém audita e do qual não dá para
tirá-lo depois. É a mesma realimentação que a slice 4 fechou ao decidir que o
agente 3 nunca escreve (4.9). A diferença entre aquela e a da camada 3b abaixo é
**visibilidade**, e é ela que decide o que entra.

#### As quatro camadas de candidato

`candidatosDe()` tem quatro camadas **aditivas**, nunca substitutivas — nenhuma
camada anterior mudou de comportamento:

| Camada | Sinal | Pega o caso |
|---|---|---|
| 1. exato por chave | `nome_normalizado`, alias inclusive | grafia conhecida |
| 2. string (`proximidade`) | Levenshtein e palavra em comum | homófono: "Rafa" × "Raffa" × "Rapha" |
| 3a. perfil parecido | átomo × `entidade_embedding` | entidade **com perfil e sem átomo** — o Rapha no dia seguinte ao passo zero |
| 3b. vizinhos votam | átomo × `atomo_embedding`, voto por `:SOBRE`/`:MENCIONA` | entidade **com átomos e sem perfil** — todo o grafo de hoje |

As duas semânticas cobrem buracos **opostos**, e é por isso que as duas ficam.
Uma entidade recém-criada, sem perfil e sem átomo, continua invisível para ambas
— só a string a acha, e é por isso que criar um nome à mão pede escrever o perfil
no mesmo gesto.

**A 3b devolve o porquê.** Ela consulta os vizinhos do átomo novo e conta votos
por entidade, devolvendo junto os **ids, as datas e os trechos** dos átomos que
elegeram cada candidato. A revisão mostra isso no modal de fontes: *"você disse
em 12/ago: «…»"*. Isso não é enfeite. Esta camada herda atribuição passada — um
erro de atribuição pode sugerir o próximo —, e a única coisa que a torna
aceitável é ser **um voto entre `k`, com o átomo à mão**: alcançável e
corrigível. Sem o `porque`, esta camada não entraria.

**E ele aparece com o agente certo, não só quando ele hesitou** (4.8.1). Até ali
a linha só saía junto do bloco de dúvida, ou seja, a herança era invisível
exatamente no caminho comum (`certo: true`), que é onde ela mais acontece — a
condição declarada da camada valia para a minoria dos casos. A procedência passou
a existir sempre que houver evidência, independente de o agente ter hesitado; o
que mudou desde então é **onde** ela aparece — de uma lista fixa embaixo do átomo
para o `ⓘ` ao lado da entidade, a um toque (§4.7).

`ReferenciaResolvida` ganhou `camada?: Camada` no mesmo gesto, porque o `porque`
sozinho chega sem dizer se decidiu alguma coisa: é o campo que separa "a grafia
bateu" de "átomos passados seus votaram", e `FRASE_DA_CAMADA` é o que a tela diz
de cada uma. `exato` e `string` ficam fora dessa linha de propósito — ali nada
foi herdado, é o que eu mesmo falei, e uma linha em todo átomo viraria ruído. O
campo é **opcional e assim fica**: proposta anterior à 4.8.1 não tem, e ausente é
"não sei de onde veio", a mesma degradação de `certo` e `porque`
(`referencias.ts`). Valor fora de `CAMADAS_DE_CANDIDATO` é lido como ausente, e
não repassado.

A 4.9 acrescentou `"extrator"` à lista, e ela **entra** na procedência, pelo mesmo
argumento e mais forte: ali o nome dentro do texto do átomo deixou de ser o que
eu falei, e o `citado` da referência é o único lugar que guarda a grafia. É a
condição de a camada existir, como o `porque` é a da 3b — e é o caso em que abrir
o modal de fontes (§4.7) mais se paga, porque é o único que mexeu no que eu disse.

#### Teto e piso são obrigatórios

`TOP_K = 3` sobre a **união** das quatro camadas, e piso de score por camada —
e desde a 4.9 são `TOP_K = 4` e cinco camadas (§4.14), porque a chave do extrator
tinha de caber **junto** com as três e não no lugar de uma.
Sem teto e sem piso, todo átomo ganha candidato e a lista de dúvida da revisão
vira lista de nomes. **Uma camada semântica sem piso é uma camada que sempre
acha alguém.**

O outro argumento que sustentava os dois **caducou na 4.9**: até a 4.8 eles eram
o que fazia `decidir()` não cair sempre em `julgar` e o critério 5 da slice 4
sobreviver — sessão sem ambiguidade não pagava nada, porque o caso comum era a
grafia casar com um nó e os vizinhos votarem **no mesmo nó**, união de tamanho 1,
decisão de graça. A 4.9 pôs o agente 2 em toda menção com candidato de propósito
(§4.14), e o critério morreu ali. O que **não** morreu é a deduplicação: ela
continua sendo o que mantém a lista curta e honesta.

Os pisos de 3a e 3b se calibram **separado**, e o mesmo número não significa a
mesma coisa nas duas: 3a é assimétrica (texto de átomo contra string curta de
perfil), 3b é simétrica (átomo contra átomo). O ponto de partida é medido, não
escolhido — com `openai/text-embedding-3-small`, o par de teste da slice
(dois APRENDIZADO sobre relacionamento, de sessões diferentes, sem uma palavra
rara em comum) dá 0,594 entre si contra 0,19–0,29 de assunto não relacionado.

```
PISO_VIZINHOS = 0.45   (cosseno)   simétrica
PISO_PERFIL   = 0.34   (cosseno)   assimétrica, pontua sistematicamente menos
ALCANCE       = { perfis: 5, vizinhos: 8 }
```

Os pisos vivem em espaço de **cosseno**, e não no do banco:
`db.index.vector.queryNodes` com cosseno devolve `(1 + cosseno) / 2`, e as
consultas de `entidades.ts` desfazem essa normalização antes de comparar. A razão
é poder conferir o piso à mão — `cosineSimilarity` do pacote `ai` fala cosseno, e
um número que só existe dentro do banco é um número que ninguém audita.

#### A versão do prompt do agente 2, de `resolucao-2` a `resolucao-5`

`PROMPT_VERSION_RESOLUCAO` subiu para `resolucao-2` na 4.5, e o texto do prompt
quase não mudou. **A versão acompanha a entrada, não só a redação:** o conjunto
de candidatos que o agente recebe é outro, e isso é saída diferente (regra 7). Na
4.9 ela subiu de novo, para `resolucao-3`, pelo mesmo critério e mais o texto: a
chave do extrator entrou como quinta camada, a lista virou a de todas as menções
com candidato, e duas frases entraram no prompt (§4.14). E para `resolucao-4` com
a migration 007, pelos dois motivos outra vez — o catálogo passou a ter
organizações, e a regra de tipo passou a travar `HISTORIA` em `eu` junto com os
outros três. E para `resolucao-5` na 4.11, pelos dois motivos mais uma vez: o
catálogo trocou os três campos de perfil pela apresentação única (§4.8), e
`certo: true|false` virou `confianca` de 0 a 1.
O prompt passou a dizer, ao lado de cada candidato, **por que ele está na lista** —
e quando o motivo é "átomos passados parecidos", os trechos vão junto, porque
evidência de uso é o sinal mais forte que existe quando o perfil está vazio.

#### Nada no caminho do embedding impede uma gravação

É a regra de precedência da slice inteira. O confirmar grava o átomo **e só
então** o embute; se o Gateway falhar, o átomo fica no grafo sem vetor, com um
`[atomos]` no log, e `POST /api/atomos/embutir` o alcança depois. Vetor é
derivável do texto a qualquer momento — refazer 4.000 deles é uma passada de
`embedMany` que custa menos de um centavo. Gravação não é derivável de nada.

A mesma regra vale na leitura: se o índice ainda não existe, se o Gateway está
fora, ou se nada passa do piso, `candidatosSemanticos` engole a falha, registra o
motivo e devolve lista vazia — e a resolução se comporta exatamente como na
slice 4. É também o que permite este código ir ao ar antes de a migration 006
rodar.

E vale para o vetor da **entidade** desde a 4.8.1: `passadaDeVetores()` roda em
`waitUntil` depois do confirmar e das oito rotas de `/entidades`, engolindo a
falha com `[entidades]` no log (§8.4). Até ali a camada 3a era código que não
podia achar nada — `garantirEmbeddings()` tinha um chamador só, uma rota que
nenhuma tela chama —, e entidade nascida num confirmar ficava sem vetor para
sempre.

### 4.11 A correção que a revisão produz (slice 4.6)

A correção mais cara do sistema se perdia de graça. Rejeitar um átomo, editar um
texto, trocar um tipo: tudo isso já acontecia na revisão, e nada sobrevivia ao
clique de confirmar — o servidor chegava a calcular quantos átomos foram
rejeitados só para descartar o número na resposta HTTP. Esta metade da 4.6 não
pede nenhum gesto novo na tela; ela só para de jogar fora o que a revisão já
produz.

**O grafo é o único lugar que ela não toca.** `POST /confirmar` grava exatamente
o mesmo Cypher de antes. Só depois de responder, dentro de `waitUntil`, o
servidor compara a proposta com o que foi aprovado, produz os registros de
`Correcao` e os grava **só no R2**. Falhar ali nunca desfaz nem atrasa o que já
foi confirmado.

#### O diff mora no servidor; o que viaja do cliente é só o gesto

Os dois lados de toda correção de átomo já estão no servidor: `extracao.json`
guarda a proposta indexada por índice, e o corpo do confirmar traz o valor final.
Computar o diff na tela faria duas implementações divergirem, com a da tela
vencendo calada — o mesmo argumento que pôs `referencias.ts` num módulo só.

Três coisas, porém, são **gesto e não valor**, e só o navegador testemunha:

| Não derivável | Vem de |
|---|---|
| entidade recusada de propósito × não usada por acaso | as candidatas desmarcadas que de fato não viraram nó |
| o par original→final de um renome | o POST manda só o final |
| campo que eu toquei × canonização (a grafia do grafo vencendo) | as chaves de `edicoes[indice]` — a chave existir **é** o gesto |

Daí o campo **opcional** `gestos` no corpo do confirmar
(`{ atomos, entidades_recusadas, renomes, faltantes }`). Ele não carrega valor
nenhum. Corpo sem ele continua confirmando: o servidor infere pelo valor e marca
`tocado: false`. Retrocompatível de propósito — nenhum 400 novo nasceu aqui.

**Duas travas contra correção-fantasma de canonização**, nesta ordem: (1) a
comparação é por nome normalizado, então caixa e acento nunca viram correção;
(2) chave diferente sem o campo em `gestos` é provável travessia de alias —
registrada mesmo assim, mas marcada como inferida. E as entidades que aparecem
em `gestos.renomes` ou entre as recusadas **saem da conta** antes de computar
`sujeito` e `menciona`: um renome no rodapé já muda todo átomo que cita aquela
entidade, e uma edição minha não pode virar dez correções.

#### O que uma correção guarda, e de quem é a culpa

`Correcao` (`tipos.ts`) tem `antes`, `depois`, o texto proposto, as âncoras do
átomo (é delas que sai o `▶ mm:ss` da tela de calibração, mais abaixo nesta
seção), a procedência — nunca do corpo, regra 7 —, `tocado` e `incorporada_em`
(`null` = em aberto).

**A procedência é do agente que a etiqueta acusa, e não sempre a do átomo**
(slice 8.1). Até a 8.1 ela era copiada do átomo da proposta, que carrega sempre
`prompt_version` e `modelo` da **extração** — então uma correção etiquetada
`resolucao` dizia um agente na etiqueta e outro no carimbo, e era o agente que
a slice 7 acabara de ligar ao laço de aprendizado. Agora correção de `sujeito`
ou `mencao_removida` marcada como `resolucao` carrega `prompt_version_resolucao`
e `modelo_resolucao` da proposta; todo o resto continua com a versão da
extração, que é quem produziu o átomo.

A chave **não** é sempre `${atomo_id}|${tipo}`. Três tipos não têm átomo, e com
um id fixo por tipo os três colapsariam num registro só, uma correção nova
apagando a anterior em silêncio:

```
átomo     rejeitado, texto, tipo, sujeito, mencao_*  -> `${atomo_id}|${tipo}`
entidade  entidade_recusada|renomeada|tipo           -> `${sessao_id}|${tipo}|${chave}`
faltou                                               -> `${sessao_id}|faltou|${chave40}`
```

`mencao_adicionada` e `mencao_removida` são dois tipos e não um: com um só,
acrescentar e tirar menção no mesmo átomo colapsariam num registro, e o segundo
apagaria o primeiro.

Cada correção sai etiquetada com o agente que a produziu:

| Tipo | Agente | Por quê |
|---|---|---|
| `rejeitado`, `texto`, `tipo`, `faltou` | `extracao` | é o `extracao-9` produzindo o que não presta |
| `entidade_recusada` | `extracao` | listou como entidade o que não é pessoa, organização, projeto nem objetivo |
| `entidade_tipo` | `extracao` | errou o palpite de tipo na lista `entidades` |
| `sujeito`, `mencao_removida` | `resolucao` ou `extracao` | `sobre.conhecida` **e** a resolução ter rodado na sessão |
| `mencao_adicionada` | `extracao` | menção que o extrator não listou; não há referência original para a resolução ter errado |
| `entidade_renomeada` | `grafo` | higiene de grafia — salvo quando o nome apagado era pronome, e aí é `extracao` furando a seção "NOME DE ENTIDADE É NOME" |

O sinal de `sujeito`/`mencao_*` tem **duas partes, e elas vêm de escalas
diferentes**. A primeira é por átomo: `conhecida: true` é a resolução decidindo
entre nós que existem, e `conhecida: false` é candidata nova, mais perto de "o
extrator escreveu algo que não bate com nada". A segunda é por sessão, e entrou
na 8.1: **a resolução só responde por uma sessão em que ela rodou.**
`resolucao.ts` roda a camada determinística para toda menção e só chama o modelo
quando há ambiguidade, e `prompt_version_resolucao` fica `null` quando nenhuma
foi — sessão sem ambiguidade nenhuma, comum com o grafo pequeno, não chamou o
agente 2, e quem escreveu aquele nome foi o agente 1. Nessas, a correção volta a
ser da `extracao`, com a versão dela, e o `calibracao-2` deixa de receber
material sobre um prompt que não participou.

**A precisão fica certa por sessão e grosseira por menção, e isso é escolha.**
Saber se *aquela* menção foi ao modelo pediria um campo novo gravado em toda
proposta — o que tiraria a emenda do tamanho de emenda. Numa sessão mista, duas
menções ao modelo e oito determinísticas, as correções das oito ainda vão para a
resolução: erra para o lado de dar material demais ao agente 2, que é o agente
que existe para decidir isso.

**Capturava os três e calibrava um só até a slice 7.** `resolucao` e `grafo`
acumularam etiquetados e sem consumidor por três fatias. Na 7 `Correcao.agente`
deixou de ser um enum de três valores e passou a ser o `AgenteId` do registro
mais `"grafo"` — e `paraCalibrar` ganhou o parâmetro que faltava. O que estava
gravado no R2 migrou sozinho: `"extracao"` e `"resolucao"` já eram `AgenteId`.

`grafo` continua sem consumidor, e agora por um motivo e não por omissão: ele
não é agente, não tem prompt, e não há o que emendar. Conserto de grafia se
resolve no vocabulário do STT.

#### Por que R2, e por que dois objetos

O grafo é o que eu vivi; correção é o que o pipeline errou. Um `:Atomo` dizendo
"o modelo escreveu FATO onde era OPINIAO" apareceria numa busca por "o que eu
aprendi" e apodreceria a coisa que o sistema existe para fazer. Some-se a regra
2, e não valia uma migration.

`sessoes/<id>/correcoes.json` é o registro permanente daquela revisão — uma
fotografia do momento da confirmação, gravada com `If-None-Match: *`, e escrita
mesmo quando não houve correção nenhuma: o objeto vazio é o que distingue
"revisei e não corrigi nada" de "o `waitUntil` morreu antes de apurar". Separado
de `extracao.json` porque `forcar` sobrescreve a proposta sem backup, e correção
guardada junto morreria na primeira recalibração — quando ela mais vale.

`calibracao/indice.json` é a mesa de trabalho: o acumulado, com teto de 500.
Existe porque `r2.ts` não tem `LIST` — sem ele, uma correção seria alcançável só
por quem já soubesse o id da sessão. Guarda as correções inteiras (o corpus é
esparso por construção) e a escrita é read-modify-write por etag, no mesmo laço
de espera de `atualizarManifest` (§6.1), com o conteúdo recalculado **dentro** de
cada tentativa. Estourado o teto, a eviction come as **fechadas** antes das
**abertas**: fechada já cumpriu o papel e o registro por sessão cobre auditoria;
aberta perdida daqui é inatingível para sempre.

#### A tela: o material mandou no desenho

`/calibracao` é gestão — `tipografia.ts` a serve com Inter sem ninguém marcar
nada, porque `RITUAL` é allowlist —, e vive na gaveta da `Gestao`, sempre, e não
só quando há o que calibrar: gaveta é mapa, e porta que aparece e some é porta
que se procura no lugar errado.

**O desenho dela saiu da primeira rodada real, não de palpite.** Medido em
2026-09-04, com 5 sessões e 21 correções: **metade são correções de `texto`, com
`antes` e `depois` de 200 a 660 caracteres.** Isso a tira da categoria "lista de
rótulos curtos" — o que ela precisa resolver é ler dois parágrafos e enxergar
onde diferem. Daí a única regra de apresentação que não é CSS: par que somado
cabe em 90 caracteres vai **em linha**, com a seta; acima disso vai
**empilhado**, um bloco sob o outro, cada um etiquetado ("o que veio" / "o que
eu deixei"). Sem diff colorido: cor que aponta o que mudou é a tela afirmando
uma leitura que eu não pedi.

Cada correção com âncora ganha `▶ mm:ss` (`localizarNoAudio`, o mesmo da
revisão), e a proposta da sessão só é buscada **quando eu clico** — uma ida à
rede por sessão, guardada, não uma por correção ao abrir. Correção com
`tocado: false` mostra "inferida": ela veio da trava 2, não de um gesto meu, e a
tela tem que dizer isso ou eu a leio como coisa que fiz.

No rodapé, atrás de um botão, os `descartados` da extração agrupados por motivo
— item que o modelo devolveu e a validação recusou. A revisão já os carregava e
nunca os renderizou. É o outro lado da correção: ali eu digo o que ficou torto,
aqui o código diz o que nem passou.

#### Antes e depois, sem inventar métrica

`extrairSessao({forcar:true})` copia para `extracao-anterior.json` a proposta que
substituiu — **só a última**, não um histórico. A cópia acontece **depois** do
PUT da proposta nova, e a ordem é deliberada: o que eu pedi foi a re-extração, e
perder a cópia custa a comparação daquela sessão enquanto perder a proposta
custaria a chamada de modelo inteira. Falhar ali só escreve no log.

`GET /extracao` devolve `anterior` como **cabeçalho** (`{atomos, prompt_version,
modelo, criado_em}`); a lista de átomos antigos só vem com `?anterior=1`, porque
mandá-la sempre dobraria o payload da tela mais apertada do sistema por um caso
raro. Na revisão, **quando a versão do prompt mudou**, uma linha discreta no fim
da lista oferece "ver a anterior", e ela renderiza a lista antiga somente
leitura — sem checkbox e sem editor, porque o que eu confirmo é a proposta
corrente. Re-extração com a mesma versão não mostra linha nenhuma: comparar duas
saídas do mesmo prompt é ruído na tela que tem 60 s.

Sem diff colorido, sem "melhorou/piorou", sem placar. É a única defesa contra
regressão silenciosa que esta fatia pode oferecer, e ela é olho no olho.

#### Quando roda, e o que se perde se não rodar

Dentro do `waitUntil`, depois da resposta, num `try/catch` que nunca derruba o
confirmar. O que destrava o `router.push("/")` da revisão é a resposta HTTP;
pagar idas ao R2 nos 60 s da revisão por material de meta seria pagar no lugar
errado. `waitUntil` morto perde as correções daquela sessão, sem recuperação —
e nada do diário se perde junto, porque os átomos já estão no grafo quando isto
começa.

### 4.12 O prompt aprende: a pauta e a emenda (slice 4.6, refeita na 7)

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

#### Dois passos, e eu confirmo entre eles

```
correções em aberto do agente X
        │
        ▼  calibracao-2   (paramétrico por agente)
   ≤2 PADRÕES, citando os Correcao.id       ← eu confirmo, edito ou descarto
        │
        ▼  redacao-1
   EDIÇÕES POR SEÇÃO do prompt de X         ← eu aprovo lendo o que muda
        │
        ▼  gravarOverride(X, { prompt })
   prompt novo em vigor, carimbo +p<hash>, correções fechadas
```

São **dois agentes e não um**, com `prompt_version` própria cada um, pela mesma
razão que separou `resolucao-5` de `desempate-1`: calibram separado, e um erro de
redação se conserta sem tocar em quem enxerga padrão.

O `Padrao` é a `Regra` da 4.6 com outro destino. A forma é idêntica, e de
propósito: `id` atribuído no rascunho e nunca editável — é ele que torna
"sobreviveu à minha edição" bem definido —, `texto` o único campo que a tela
deixa mexer, `cita` do agente e imutável porque é a procedência. O que mudou é o
fim: a regra virava apêndice para sempre; o padrão vira pauta, é incorporado ao
corpo do prompt, e se aposenta com `aplicado_em` preenchido.

**Padrão que eu corto antes de redigir deixa as correções que o motivavam em
aberto**, e elas voltam na próxima rodada. É o que faz "descartar" ser diferente
de "endereçar" — a mesma promessa da 4.6, no gesto novo.

A pauta é gravada no índice **antes** de o redator ser chamado, e isso não é
detalhe: são dois passos e duas chamadas de modelo, e eu posso fechar a aba entre
confirmar o padrão e aprovar a emenda sem perder o que já decidi.

#### A conservação é estrutural, e não um pedido no prompt

O `redacao-1` devolve **`edicoes`, nunca o texto inteiro**. Ele não consegue
tocar o que não nomeou, porque o que ele não nomeia nunca sai do servidor —
"seção não citada volta byte a byte" é consequência, não promessa. Um prompt
inteiro de volta exigiria confiar num diff para achar o que mudou, e confiar que
o que parece igual é igual.

Seis amarras, todas no parser de `redacao.ts` — amarra que vive só no texto é
amarra que o modelo ignora num dia ruim, e o que estas protegem é a coisa que
produz todo o resto:

| Amarra | Por quê |
|---|---|
| no máximo **2 seções** por rodada | mais que isso não é emenda, é reescrita |
| só `reescrever`, `acrescentar`, `criar` — **não existe `apagar`** | apagar seção é decisão minha, no editor de `/agentes` |
| toda edição aponta um padrão confirmado, e todo padrão cita ≥2 `Correcao.id` | herdada da 4.6: um caso não é padrão |
| seção nomeada tem de existir no prompt corrente (salvo `criar`) | seção inventada emendaria o que não está lá |
| **a seção do envelope é intocável** | `envelopeFaltando` checa se as chaves continuam lá, não se o exemplo de JSON continua legível — dá para embaralhar o `FORMATO` inteiro mantendo as palavras que ele procura |
| `envelopeFaltando` sobre o texto resultante → 400 | a última porta, a mesma de `POST /api/agentes/:id` |

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

#### Onde o texto final é produzido

`aplicarEdicoes(prompt, edicoes, { antesDe })` é **pura**, e é a função que o
teste aperta inteira — mesmo molde de `apurarCorrecoes`. Ela trabalha sobre
offsets no texto original, e não sobre uma lista de linhas remontada: remontar
com `join("\n")` normalizaria `\r\n` e espaço no fim de linha, e aí "volta byte
a byte" deixaria de ser verdade no caso em que ninguém olharia.

**O corpo de `/aprovar` traz as edições, nunca o texto final.** A tela me mostrou
o resultado, mas quem o produz é o servidor, das mesmas edições, sobre o prompt
que estiver em vigor **agora**. Aceitar o texto pronto do cliente faria duas
coisas ruins de uma vez: uma segunda implementação de `aplicarEdicoes` que
divergiria calada, e uma porta por onde um corpo montado à mão escreveria
qualquer prompt sem passar por amarra nenhuma. O efeito colateral é bom — se eu
editei o prompt no painel entre ver a emenda e aprová-la, a aplicação falha com
409 em vez de sobrescrever o que eu acabei de escrever.

A escrita do prompt vai **antes** da do índice, e a ordem é deliberada: o que
importa é o prompt novo estar valendo. Índice que falhe depois devolve os padrões
à pauta e deixa as correções em aberto — barulho, não perda. O contrário, um
índice dizendo "endereçado" e apontando para um prompt que nunca foi gravado,
seria desaprender em silêncio.

#### A dobra, e o único ponto que muda sem eu aprovar

Tirar `regras()` do caminho de montagem mudaria o prompt da extração **em
silêncio** se houvesse regra em vigor no R2: o apêndice simplesmente deixaria de
ser colado, e a primeira sessão depois do deploy sairia extraída por um prompt do
qual eu nunca tirei nada.

Então `pautaComDobra` lê o `regras_correntes` do objeto cru — o campo saiu do
tipo, mas continua no R2 — e devolve cada regra em vigor como **padrão já
confirmado**, para eu mandar o redator incorporá-la ao corpo do prompt. Aplicada
uma vez, some para sempre: o padrão fica no índice com `aplicado_em` preenchido,
e `jaDobrou` para de oferecê-la. Em quem nunca aprovou regra nenhuma — o caso
comum — é no-op desde o primeiro minuto.

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

`normalizarIndice` é o único lugar que sabe disso, e `carregarIndice` e
`atualizarIndice` passam os dois por ele — o segundo também, porque o mutador
roda sobre o que **acabou de ser lido**, e o que acabou de ser lido pode ser o
objeto velho. Campo a campo, e não `{...vazio, ...bruto}`: espalhar por cima
devolveria o `undefined` do objeto velho para o campo que o molde tinha
preenchido, que é o bug que a função existe para não ter.

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

Índice gravado antes da 7 traz uma string aqui, e ela é lida como "visitei tudo
naquele dia" — a leitura conservadora, que adia a sugestão e nunca a antecipa.
**E a primeira escrita depois da 7 tem de carregá-la**: colapsar a string para
`{}` antes de gravar a chave nova apagaria a visita de todo agente que não fosse
o que eu abri, e aí abrir a tela de um *antecipava* a sugestão dos outros —
exatamente o oposto da promessa, e silencioso, porque era a string que estava
segurando a sugestão e o primeiro toque a soltava.
`GET /api/calibracao/sugestao` pergunta se **algum** agente tem o que olhar;
dizer qual seria placar por outro caminho, e a gaveta continua mostrando uma
linha sem número.

#### A tela: dois níveis, porque o material virou de cinco agentes

`/calibracao` abre numa lista de agentes com material parado — nome, papel,
quantas correções em aberto, quantos padrões na pauta — e cada um tem a sua
página. Uma parede de correções de cinco agentes misturados seria separar com o
olho toda vez, que é o que `/agentes` já tinha aprendido a não fazer ao virar
duas telas na slice 6.

`grafo` aparece na porta **sem botão**, e é deliberado: ele não é agente, é
higiene de grafia minha, não há prompt para emendar com ele, e quem conserta
grafia é o vocabulário do STT. Escondê-lo faria a soma não bater.

**A contagem da pauta na porta sai de `pautaComDobra`, e não de `pautaDe`.** A
diferença só aparece num caso, e é justamente o que a dobra existe para cobrir:
eu tinha regra aprovada na 4.6 e nenhuma correção em aberto. Contada por
`pautaDe`, a extração apareceria com zero e zero, a tela a filtraria da lista, e
a dobra ficaria **inalcançável** — a regra sumiria do prompt em silêncio, que é
o que esta fatia se comprometeu a não deixar acontecer. Custa uma leitura de R2 a
mais, e só uma: `pautaComDobra` só vai ao R2 pela extração, e só enquanto a dobra
não tiver sido aplicada.

O passo da emenda mostra o que muda **seção por seção**: qual seção, o que ela
diz hoje, o que ela passa a dizer. Empilhado sempre — corpo de seção nunca cabe
numa linha — e **sem diff colorido**, pela mesma razão que a 4.6 escreveu para a
correção: cor que aponta o que mudou é a tela afirmando uma leitura que eu não
pedi. Aqui isso vale mais, porque é o par mais longo que esta tela já mostrou.

O resto da página é o que a 4.6 desenhou e continua certo: par curto em linha com
a seta, par longo empilhado com "o que veio" / "o que eu deixei", `▶ mm:ss` em
toda correção com âncora, "inferida" no que veio da trava 2, e o refugo do parser
no rodapé — este só na extração, que é de quem ele é.

### 4.13 O painel dos agentes (slice 4.7)

Treze pontos deste sistema falam com o Gateway — eram oito quando esta fatia
nasceu, e o décimo terceiro é o `redacao-1` da slice 7. Até esta fatia, saber o
que cada um fazia exigia abrir cinco arquivos de
`src/lib/`, e mudar qualquer coisa exigia um deploy. `/agentes` é onde eles
passam a ter rosto: o fluxo desenhado em **duas telas** — `/agentes`, o que
entra no grafo, e `/agentes/consulta`, o que sai dele —, e cada caixa abrindo o
prompt e o modelo que a comandam, e na resolução e no confronto o **limiar**
(4.11, 5.1).

| Agente | Módulo | Quando | Modelo | Envelope que o parser exige |
|---|---|---|---|---|
| STT (sem prompt) | `stt.ts` | automático, por bloco | `STT_MODEL` | — |
| `extracao-9` | `extracao.ts` | automático, por janela de 2 min | `EXTRACAO_MODEL` | `atomos`, `entidades` |
| `resolucao-5` | `resolucao.ts` | automático: por janela, sobre toda menção com candidato | `RESOLUCAO_MODEL` | `referencias`, `perfil` |
| `desempate-1` | `desempate.ts` | condicional: uma menção por vez, abaixo do limiar de confiança | `DESEMPATE_MODEL` | `entidade`, `duvida`, `motivo` |
| `calibracao-2` | `calibracao.ts` | sob demanda, em `/calibracao`, **por agente** | `CALIBRACAO_MODEL` | `padroes`, `cita` |
| `redacao-1` | `redacao.ts` | sob demanda, depois de eu confirmar a pauta (slice 7) | `REDACAO_MODEL` | `edicoes`, `secao`, `padrao` |
| `perfil-1` | `perfil.ts` | sob demanda, em `/entidades` | `PERFIL_MODEL` | `texto` |
| `duplicatas-2` | `duplicatas.ts` | sob demanda, em `/entidades` | `DUPLICATAS_MODEL` | `mesma`, `explicacao` |
| embedding (sem prompt) | `embedding.ts` | automático, depois de gravar | `EMBEDDING_MODEL` | — |
| `confronto-2` | `confronto.ts` | periódico: cron próprio e sob demanda em `/confronto` (slice 5) | `CONFRONTO_MODEL` | `relacoes`, `novo`, `velho` |
| `chat-3` | `chat.ts` | sob demanda, a cada mensagem na barra de `/` (slice 6) | `CHAT_MODEL` | `buscar_atomos`, `historico_do_atomo` |
| `titulo-chat-1` | `conversas.ts` | sob demanda, uma vez por conversa nova (slice 6) | `CHAT_TITULO_MODEL` | `titulo` |

**O `chat` é o único cujo envelope não são chaves de JSON**, e a diferença é
real: o parser dele é o loop de *tool-calling*, não um `JSON.parse`. O que um
prompt editado não pode perder é o nome do que ele pode chamar — um prompt que
não cita `buscar_atomos` é um prompt que desliga a ferramenta, e a recusa diz
isso antes de salvar.

**O limiar é o terceiro campo editável** (4.11), e desde a 5.1 são **dois** os
agentes que têm um — e eles medem coisas diferentes: na resolução, abaixo dele
a menção vai à segunda passada; no confronto, abaixo dele a relação
`COMPLEMENTA` é descartada em vez de gravada (§4.15).
`OverrideDeAgente` ganhou `limiar?: number | null` ao lado de `prompt_hash` e
`modelo`, com a mesma regra: ausente = a base do git, `null` no corpo revoga e
volta a ela, número igual ao do git não é edição. Número fora de `[0,1]` no
arquivo é ignorado como se não estivesse lá — o arquivo é meu, mas um typo não
pode desligar a segunda passada em silêncio.

Ele mora aqui, e não numa constante de código, pela mesma razão que o prompt:
**é número para eu mexer olhando a revisão**, sessão real por sessão real, e
trocá-lo não pode ser deploy. `LIMIAR_CONFIANCA = 0,7` é o ponto de partida
escolhido, não medido.

#### O mecanismo é o da 4.6, generalizado

Nada novo foi inventado: as regras aprovadas já viviam no R2 e já valiam sem
deploy, com snapshot imutável por hash e sufixo no `prompt_version`. `overrides.ts`
é `regras.ts` aberto para todos, e o cabeçalho de lá continua sendo a
explicação de por que R2 (serverless não tem disco gravável nem compartilhado),
por que snapshot imutável (o carimbo tem de resolver para um texto), e **por que
sem cache** (cache por instância faria "salvei, vale na próxima" ser falso de um
jeito que ninguém vê).

```
config/agentes.json                  { overrides: { <agente>: { prompt_hash, modelo, atualizado_em } } }
config/prompt-<agente>-<hash>.json   { agente, hash, texto, anterior, criada_em } — imutável
```

**Nunca propaga erro na leitura.** R2 fora do ar não impede sessão nenhuma de ser
transcrita ou extraída: sem override, o agente sai byte a byte igual ao de antes
desta fatia. A falha degrada para o comportamento bom, não para nenhum — e é o
mesmo motivo que faz a slice inteira ser um **no-op** até o meu primeiro toque.

O custo está declarado: **uma leitura do índice por chamada de agente.** Uma por
sessão na extração, uma na resolução, e **trinta numa sessão gravada de 15 min no
STT**, uma por bloco. É o preço que `regras()` já paga, e é o preço de a promessa
ser verdadeira em vez de quase.

#### A procedência de um prompt editado

`prompt_version` carrega de onde o texto veio, e o prefixo diz por qual chave o
hash resolve:

| Carimbo | Quem produziu | Resolve em |
|---|---|---|
| `extracao-9` | a base do git, sem emenda nem edição | o próprio git |
| `extracao-9+p1b2c3d4` | prompt editado no painel, ou emendado pela calibração | `config/prompt-extracao-<hash>.json` |
| `extracao-9+a3f91c7d` | **só até a slice 7**: a base do git com regra aprovada | `calibracao/regras-<hash>.json` |
| `extracao-9+p1b2c3d4+a3f91c7d` | **só até a slice 7**: prompt editado **e** regra aprovada | os dois objetos, nesta ordem |

Os dois últimos não nascem mais — o apêndice de regras saiu do caminho de
montagem na 7 —, mas continuam sendo lidos: os snapshots são imutáveis e
`versaoDeRegras` continua de pé. Carimbo que não resolve é procedência falsa, e
procedência falsa é pior que procedência nenhuma.

Sem o `p`, ler um carimbo antigo viraria adivinhação: um hash só não teria como
resolver dois objetos diferentes. O hash sai do **conteúdo**, então salvar o
mesmo texto duas vezes não cria versão nova, e desfazer uma edição devolvendo o
texto original devolve o carimbo original.

**E o hash volta `null` quando o texto não foi usado.** Ponteiro que não resolve
objeto — índice apontando para um prompt que sumiu — cai na base **e** carimba a
base. Carimbar uma versão que não rodou é procedência falsa, que é pior que
procedência nenhuma.

#### Onde a calibração entra num prompt editado

Não entra mais por injeção, e é a mudança da slice 7: o que a calibração produz é
uma **emenda ao texto** deste mesmo objeto (§4.12), gravada por `gravarOverride`
como qualquer edição minha. Prompt editado no painel e prompt emendado pela
calibração são a mesma coisa para o sistema — mesmo snapshot, mesmo `+p<hash>`,
mesma última porta em `envelopeFaltando`.

Uma consequência boa e uma ruim. A boa: o prompt efetivo voltou a ser **um texto
num lugar só**, que se lê inteiro no painel. A ruim: eu e o `redacao-1` escrevemos
no mesmo campo, então uma emenda aprovada sobre um prompt que eu editei no meio
do caminho pode não achar a seção que ela nomeou — e aí `/aprovar` devolve 409 e
pede a emenda de novo, em vez de sobrescrever o que eu acabei de escrever.

#### As duas travas, e as duas são no servidor

**O envelope.** Eu posso reescrever o prompt inteiro, inclusive o `FORMATO` — mas
não posso salvar um que deixe de pedir o JSON que o parser sabe ler. `POST
/api/agentes/:id` recusa com 400 dizendo qual chave falta. Sem isso o erro só
apareceria na próxima sessão, na hora de extrair, e derrubaria todas as
seguintes. É substring e não JSON de verdade, de propósito: o que se checa é se o
prompt continua **pedindo** o formato, e isso é pergunta sobre o texto.

**O embedding não tem campo de modelo.** Os dois índices vetoriais declaram 1536
dimensões na migration 006 (§8.4); trocar por um modelo de outra dimensão pede
`DROP` e migration nova, que é decisão aprovada e não toque de tela. A caixa
mostra o modelo e o motivo, em vez de um campo que aceitaria e quebraria.

Duas mais, menores, e as duas evitam que o painel minta: id de modelo continua
passando por `validarIdDeModelo` (regra 8 — string `provedor/modelo`, nunca
objeto de provedor), e **salvar o texto igual ao da base revoga o override**, em
vez de guardar uma "edição" byte a byte idêntica ao git que faria o painel dizer
"editado" e o átomo sair carimbado com `+p`.

#### O desenho, e por que ele em vez de uma lista

Doze linhas numa tabela não dizem que a resolução roda **dentro** da extração,
que a regra que eu aprovo volta para o prompt do extrator, nem que existe
exatamente **um** nó humano no meio de tudo — e é esse nó que a regra 5 protege.
A lista descreve; o desenho explica. Por isso o passo da revisão é terracota e é
o único que não é agente nem dado.

O fluxo é **dado** (`TELAS`, em `agentes.ts`), e não marcação no componente:
sistema que muda tem de quebrar um teste, não só ficar feio numa tela.

#### Duas telas, e uma espinha em cada

O desenho nasceu como **um** diagrama de todos os agentes, e terminou a slice 6
como uma grade CSS de **sete colunas** com as setas roteadas à mão em SVG,
medidas do DOM com `getBoundingClientRect` + `ResizeObserver`, mais sete curvas
pontilhadas de realimentação passando por fora da grade, e `min-width: 51rem`
rolando na horizontal. Duas coisas estavam erradas nele, e as duas foram
consertadas de uma vez.

**Estava confuso, e a culpa era de um invariante geométrico.** Uma aresta de ida
era um cotovelo — desce, atravessa na altura do meio, desce —, então aresta que
pulasse uma linha atravessava a caixa que estivesse entre elas. Isso obrigava
todos os filhos do `grafo` a caberem na **mesma** linha, e cada filho novo
exigia uma coluna nova: quatro na 4.7, cinco na 4.12, seis na 5, sete na 6. O
número de colunas passou a ser consequência da geometria, e não da clareza.

**E misturava dois fluxos que não se tocam.** A faixa de leitura da slice 6 — o
`chat`, o `titulo-chat` e a `conversa` — pendurava no mesmo nó `grafo`, na
coluna 7, nas mesmas linhas dos agentes de higiene. Só que o chat **não escreve
nada**: ele é o caminho de sair do grafo, desenhado por cima do caminho de
entrar nele.

Agora são duas telas, cada uma com URL própria e uma aba no topo:

| rota | tela | o que mostra |
|---|---|---|
| `/agentes` | **o que entra** | a espinha `áudio → STT → transcrição → extração → proposta → revisão → grafo`, e abaixo dela o leque dos seis que partem do grafo já gravado |
| `/agentes/consulta` | **o que sai** | `pergunta → chat → resposta → título → conversa` |

Quatro agentes na espinha de ingestão (`stt`, `extracao` e os dois que rodam
dentro dela), seis no leque, dois na consulta: os doze.

**A espinha não tem geometria.** Uma coluna só, os passos descem, o elo entre
eles é uma borda de CSS, e o cotovelo, o `<svg>`, o `<marker>`, o
`ResizeObserver` e a função `tracar()` deixaram de existir — junto com o teste
que media o caminho das setas em pixel. **Nenhuma dependência entrou**, pela
mesma razão de sempre: um motor de pan/zoom seria pagar por um problema que
este desenho não tem, e agora tem menos ainda.

O que era caixa lateral virou campo do passo, e cada campo diz uma coisa:

| campo | o que é | exemplo |
|---|---|---|
| `entradas` | o que chega de fora do caminho | o vocabulário no STT, o dossiê de candidatas na extração |
| `dentro` | quem roda **dentro** do passo | `resolucao` e `desempate` dentro da `extracao` — que é onde eles de fato rodam (`resolverReferencias` é chamada de dentro de `extrairJanela`) |
| `volta` | a realimentação, em palavra | "↩ volta para extração · a regra que eu aprovo entra no prompt" |

A `volta` é a mudança que mais paga: a curva pontilhada era o traço mais difícil
de seguir do desenho antigo, e uma frase de seis palavras diz o mesmo — inclusive
para onde volta, que a ponta da curva só insinuava. São seis, uma por agente do
leque.

Aninhar a resolução dentro da extração, em vez de enfileirá-la, é mais
**verdadeiro** que o desenho anterior, e não só mais curto. E o leque é grade
que quebra, não fila: os seis partem todos do grafo, e empilhá-los diria que um
espera o outro.

`tests/agentes.test.ts` cobra o que sobrou de invariante, e um a mais que nasceu
com a separação:

1. todo agente do registro tem um cartão somando as duas telas, e todo cartão é
   um agente registrado;
2. nenhum id de passo se repete, dentro de uma tela ou entre elas;
3. existe exatamente um passo humano, ele é a `revisao`, e ele está na ingestão;
4. toda `volta` aponta para um passo que existe — inclusive os aninhados, que é
   o caso de `embedding → resolucao` e `perfil → desempate`;
5. **os fluxos não se misturam**: os agentes da consulta são exatamente `chat` e
   `titulo-chat`, e nenhum deles aparece no caminho de gravar. É o pedido que
   gerou esta mudança virado invariante — quem puser o chat de volta na ingestão
   quebra um teste em vez de só deixar a tela confusa de novo.

#### A varredura, que é o teste que mais vale

`tests/agentes.test.ts` percorre `src/` e falha quando um arquivo chama
`generateText`, `transcribe`, `embed` ou `embedMany` sem pertencer a um agente do
registro. É o mesmo desenho de `tests/gateway.test.ts`, e existe pelo mesmo tipo
de razão: sem ele, um agente novo nasceria **funcionando e invisível** — rodando
em toda sessão, cobrando, e sem caixa no painel nem prompt que eu pudesse ler. Se
ele te barrou, o conserto é registrar o agente em `agentes.ts`.

#### O que esta fatia não faz

Não guarda histórico de edição: `config/agentes.json` tem o que vale agora, e os
snapshots por hash guardam os textos, mas não há linha do tempo nem "desfazer" de
mais de um passo. Não mede nada — não há latência, custo nem contagem de chamada
por agente, porque `CLAUDE.md` proíbe métrica automática de qualidade e porque
custo e latência já têm lugar: o painel do próprio Gateway. E não deixa criar
agente: são os que o código tem, e um novo nasce escrevendo código —
o `enriquecimento-1` da 4.12 nasceu assim, o `confronto-1` da slice 5 também, e
a caixa de cada um apareceu no painel porque `tests/agentes.test.ts` cobra isso.

### 4.14 O extrator conhece o grafo (slice 4.9)

**O erro mais frequente do sistema não era do extrator, e mesmo assim era ele
quem o fixava.** Medido em 2026-09-04, nas 5 primeiras sessões confirmadas: de
21 correções capturadas, **um terço era conserto de grafia de nome próprio que o
STT errou** — "Beijing"→"Behring Founders", "Jean"→"Giampaolo Lepore",
"Dapta"→"Adapta". O extrator não errou nada nessas; ele copiou fielmente o que a
transcrição dizia. Só que o texto do átomo é escrito por ele, e é no texto que o
nome errado se fixa — inclusive dentro do vetor, que sai só de `a.texto`
(§4.10).

Nenhuma das duas defesas existentes alcançava o caso. O vocabulário do STT
(§4.4) ensina a grafia de nome que **já** está no grafo, e ainda assim "Adapta"
saiu como "na data" na medição de 02/09. A camada de string do agente 2 mede
Levenshtein e palavra em comum, e "giam" fica longe demais de "giampaolo lepore"
nos dois — é apelido, não erro de uma letra.

Por isso a 4.9 inverte a decisão que o §4.6 declarava desde a slice 4: o prompt
da extração passa a saber que entidades existem. **Não o catálogo inteiro** — os
até 30 nós que o trecho parece citar, escolhidos por busca. Com um grafo pequeno
os dois são a mesma coisa; a diferença aparece quando ele cresce, e o desenho
tem de estar pronto antes disso.

```
bloco transcrito ──▶ recuperarCandidatas   5 camadas, no R2: candidatas_NNN.json
                             │
     parcial.atomos ─────────┼──▶ dossieDaJanela   união, teto de 30
                             ▼
                     extracao-9  devolve {citado:"Jean", chave:"giampaolo lepore"}
                             │             e escreve "Giampaolo Lepore" no texto
                             ▼
                     resolucao-5  valida TODA menção; a chave é a 5ª camada
                             ▼
                     revisão ──▶ confirmar ──▶ grafo + o alias "jean"
```

#### As cinco camadas, e a que faz o caso "giam" funcionar

`recuperacao.ts` recebe o texto de um bloco e o catálogo, e devolve quem o grafo
acha que aquele trecho cita:

| Camada | Sinal | Pega |
|---|---|---|
| `exato` | n-grama de 1..3 tokens do bloco = uma `chave` do catálogo | grafia conhecida, alias inclusive |
| `prefixo` | token de ≥4 letras que começa uma palavra de ≥6 de uma chave | **"giam" → "giampaolo lepore"** |
| `parecido` | `proximidade()` de `duplicatas.ts` sobre os mesmos n-gramas | homófono: "behrin" → "behring founders" |
| `perfil` | `candidatosPorPerfil` com o texto do bloco | entidade com perfil e sem átomo |
| `vizinhos` | `candidatosPorVizinhos`, voto por `:SOBRE`/`:MENCIONA` | entidade com átomos e sem perfil |

As três primeiras são **puras** (`candidatasPorGrafia`), testáveis sem rede —
mesma divisão que `duplicatas.ts` já tinha. As duas últimas reusam
`candidatosSemanticos` **sem alterá-lo**: ele já aceita texto arbitrário e já
engole a própria falha devolvendo lista vazia (§4.10). Os pisos são os mesmos da
resolução, de propósito — dois lugares para calibrar a mesma pergunta
divergiriam —, e o que muda é o texto de um lado: um bloco de 30 s contra a
frase de um átomo. Está no §14.

Guardas contra falso positivo: n-grama de **um** token exige ≥4 letras e não ser
pronome (`ehPronome`, `texto.ts`); a camada `prefixo` exige palavra-alvo de ≥6
letras. Os dois números saíram de raciocínio e não de dado — §14.

#### Onde vive, e por que o arquivo diz se a busca rodou inteira

`sessoes/<id>/candidatas_NNN.json`, espelho exato de `chunk_NNN.json`: a
existência do objeto é a trava (regra 4), e bloco já consultado não é
reconsultado nem repago.

O campo `semantico` é o que impede o cache de mentir. Com o Gateway sob rate
limit, `candidatosSemanticos` devolve lista vazia — e sem o campo o arquivo
sairia **degradado e cacheado como completo**, o que faria um limite de 75 s no
meio da gravação apagar a camada de vetor da sessão inteira em silêncio. O
catch-up do `/finalizar` refaz **uma** vez os blocos que saíram `false`, e
`refeito` é o que impede a segunda. O preço declarado: o campo não separa "nada
passou do piso" de "a chamada caiu" — separar exigiria mexer em
`candidatosSemanticos`, e refazer um bloco custa uma chamada de embedding.

#### O gatilho, e a precedência que ele herda

```
transcreverBloco(id, i) → recuperarCandidatas(id, i) → avancarJanelas(id)
```

Os três no mesmo `waitUntil` de `/pronto`, porque cada um precisa do anterior: a
busca precisa do texto, a janela precisa das candidatas dos blocos dela. **O
passo do meio nunca derruba os outros dois**: sem `candidatas_NNN.json` o dossiê
fica menor, e dossiê vazio faz o extrator se comportar exatamente como na 4.8. É
a regra de precedência da 4.5 — nada no caminho do vetor impede uma gravação —, e
o sinal é a linha `[candidatas]` no log.

`avancarJanelas` monta o dossiê antes de extrair, calculando o que faltar
(catch-up idempotente, dentro do `ate` que ele já recebe) e lendo o catálogo
**uma vez** por janela, que é o mesmo número de consultas de antes: ele agora
viaja para dentro de `extrairJanela`, que antes o lia sozinha.

#### O dossiê: a união dos blocos com o que a sessão já atribuiu

`dossieDaJanela()` é puro. A janela `n` recebe duas fontes, e a segunda é de
graça:

1. as `candidatas_NNN.json` dos blocos **daquela** janela;
2. as entidades **já atribuídas nas janelas anteriores**, lidas de
   `parcial.atomos` por `sobreDe`/`mencoesDe` — camada `ja_nesta_sessao`, e ela
   vai na frente de todas. É o sinal mais forte que existe dentro de uma sessão,
   e é o análogo incremental do "procure o nome na transcrição INTEIRA" que o
   prompt base já manda fazer.

União por `chave`, ordenada `ja_nesta_sessao > exato > prefixo > parecido >
vizinhos > perfil`, depois score, depois `sessoes`; teto de 30. Chave que não
está no catálogo cai fora em silêncio — mesma regra que `comoCandidatos` aplica
ao que o vetor devolve: candidato que não existe seria um nome impossível de
escolher na revisão.

#### `extracao-7`: um bloco injetado, e a base intacta

> Os dois números desta seção são os que **a 4.9 produziu**, e não os que estão
> em vigor: a migration 007 subiu os dois logo depois, para `extracao-8` e
> `resolucao-4`, e a 4.11 os subiu de novo, para `extracao-9` e `resolucao-5`
> (§4.6, §4.8 e §8.1). O que a 4.9 fez com o prompt continua descrito aqui; o que
> cada versão diz de si está em `PROMPT_VERSION` e `PROMPT_VERSION_RESOLUCAO`.

`INSTRUCOES_BASE` e `FORMATO` **não mudaram um byte**. O bloco novo entra por
`inserirAntesDoFormato`, como `blocoDaJanela` já entrava, e
declara a chave nova de dentro de si — precedente que o `estende` da 4.8 abriu.
`blocoDasCandidatas([])` devolve `""`, e aí a chamada sai **byte a byte igual à
da 4.8**: grafo vazio, primeira sessão da vida do sistema, Gateway fora. É o
mesmo no-op que toda fatia que injeta texto neste prompt garante — e o que torna
cada uma reversível olhando uma linha.

O que o bloco manda fazer: listar as candidatas; devolver a **chave** quando a
menção for uma delas e `null` quando não for, nunca uma chave fora da lista;
escrever no `texto` do átomo o **nome gravado** e não o que a transcrição
escreveu — com a amarra explícita de que **só o nome próprio se troca**, e que no
resto continua valendo `COM AS MINHAS PALAVRAS`.

> **Como a candidata se apresenta mudou na 4.11**, e só isso: chave, nome, tipo,
> a marca de ficha oficial, as grafias **como lista** e o `resumo`, no lugar dos
> aliases concatenados numa string e do `contexto` isolado. É a mesma
> apresentação que o agente 2 vê — `apresentarEntidade`, uma função só (§4.8). O
> resto do bloco ficou byte a byte igual: ele foi calibrado e funciona. Foi essa
> troca que levou `PROMPT_VERSION` a `extracao-9`.

`AtomoCru.sobre` passou de `string` para
`MencaoCrua = { citado, chave: string | null }`, e `menciona` para
`MencaoCrua[]`. **`parsearResposta` aceita as duas formas** — string vira
`{ citado, chave: null }` —, que é o que mantém intacto o caminho sem dossiê e
lê qualquer resposta no formato antigo. `AtomoProposto`, `Extracao` e `Parcial`
não mudaram: a revisão e o confirmar não têm formato novo para aprender.
`EstadoJanela` ganhou `candidatas?: string[]`, que é procedência (regra 7) e é o
que responde "por que ele apontou aquele nó" três meses depois — o dossiê é uma
foto do grafo no momento da janela, e o grafo de hoje não a reconstrói.

**A guarda do `eu` ganhou o lado da extração.** A lista de conhecidos na frente
do modelo é convite para pendurar um `SENTIMENTO` em outra pessoa; o prompt pede
o contrário, e o parse recusa: nos quatro tipos que são sempre de `eu` (§4.8) a
chave cai, e o `citado` fica como veio — quem arbitra sujeito errado do extrator
continua sendo a revisão.

`PROMPT_VERSION` subiu para `extracao-7` mesmo com a base igual, pelo critério
de sempre: a **entrada** mudou. Precedente do `extracao-6` da própria 4.8.

#### `resolucao-3`: valida toda menção

- `candidatosDe` ganhou a chave do extrator como **quinta camada, `extrator`**,
  na cabeça da união; `TOP_K` subiu de 3 para 4 para ela caber **junto** com as
  três. Chave que não existe no catálogo é descartada em silêncio.
- `decidir()` continua como está, mas o resultado dele virou o **prior**, não a
  resposta: toda menção com candidato entra no prompt.
- **A menção sem candidato nenhum não vai.** Ali não há atribuição a validar — a
  união vazia é entidade nova, e a única resposta válida seria a que o prior já
  dá. É o que mantém a promessa de uma sessão com o grafo vazio sair como saía
  na 4.8, sem pagar uma chamada para descobrir que não havia o que perguntar.
- O prompt diz, por menção, `Ele apontou a chave "giampaolo lepore"` — ou que
  ele não apontou nenhuma —, seguido dos candidatos com o `porque` de cada um.

| A resposta do agente | O que fica |
|---|---|
| concorda com o extrator | `certo: true`, com o motivo dele |
| discorda | a do agente 2 vence, `certo: false`, e o motivo nomeia as duas chaves — o texto do átomo já saiu com o nome que o extrator escolheu, e essa é a única marca de que ele pode estar errado |
| não respondeu por esta menção, ou falhou | o **prior**: o que a passada determinística decidia sozinha na 4.8, com o `certo` de lá |

**O critério 5 da slice 4 morreu aqui, de propósito.** "Sessão sem ambiguidade
não paga nada" era promessa da 4; desde que o extrator aponta o nó e escreve o
nome dentro do texto, nenhuma atribuição dele entra sem segunda opinião, e o
preço é uma chamada de resolução por janela em vez de "só quando houver dúvida".

Duas frases entraram no texto de `INSTRUCOES` junto, e são as que a 4.8.1 recusou
subir sozinha: **a regra de tipo** ("SENTIMENTO, APRENDIZADO e ROTINA são sempre
de `eu`" — a guarda de código já existia, e a frase é o que impede o agente de
gastar decisão numa pergunta cuja resposta o código já sabe) e **o escopo das
chaves por menção** (só valem as listadas naquela menção — a distância entre o
que o prompt mostra, até 30 do dossiê, e o que o código aceita, 4 candidatos,
cresceu nesta fatia).

E `comEsperaDeLimite` entrou na chamada. A 4.8 deixou isso fora de escopo; esta
fatia é o que torna o conserto necessário — o agente passou a rodar em **toda**
janela, oito vezes por sessão de 15 min, na mesma rajada em que o STT já disputa
o limite da conta (§5.3).

#### A grafia falada vira alias no confirmar

`registrarGrafia(chaveDoNo, grafiaFalada)` acrescenta a grafia a `v.aliases` — um
item numa lista de strings do próprio nó. O confirmar a chama em `waitUntil`,
**depois** de `gravarAtomos`, casando o `citado` de cada referência — relido de
`extracao.json` pelo índice, nunca do corpo (§4.7) — com a chave final vinda da
tela, e registrando quando as duas diferem.

> Até a 4.10 ela criava um **nó** `:Entidade` com `status = 'fundida'` e
> `-[:FUNDIDA_EM]->` o vencedor, exatamente como `renomear`. A migration 009
> (slice 4.11) converteu esses nós em itens de array e os apagou; o porquê está
> no §8.2, "grafia deixou de ser nó".

Quatro recusas, e as quatro são correção e não política: grafia vazia, pronome
ou igual à chave do próprio nó; nó alvo inexistente ou ele mesmo já fundido;
grafia que já existe como nó **ativo** (seria fundir duas entidades reais
automaticamente); e grafia que já é alias de **outro** nó (roubaria a grafia de
quem já a tem, ou a deixaria com dois destinos). Segunda chamada com a mesma
grafia é no-op: a checagem prévia é a trava, e o `WHERE NOT $falada IN
coalesce(v.aliases, [])` da escrita é a trava por baixo dela.

Dois efeitos, e o segundo deixou de ser de graça: `fonteDaEntidade` inclui
aliases, então o hash muda e a passada de vetores do próprio confirmar reembute
a entidade; e "Jean" **não** é ensinado ao STT — antes porque o filtro de
`status` excluía o nó de grafia, agora porque `nomesParaVocabulario` lê só
`e.nome` e nunca toca o array.

**Este alias não é uma fusão**, e a forma no grafo passou a dizer isso desde a
4.11 — escrever uma string num array não junta nada. A distinção está no §8.2.

#### Na tela

Nenhuma tela nova, e nenhum gesto novo. A camada `extrator` entra na procedência
que a revisão dá de toda referência com evidência — as mesmas de `perfil` e
`vizinhos` (§4.7) —, e pelo mesmo argumento, mais forte: ali o nome dentro do
texto do átomo deixou de ser o que eu falei, e o `citado` da referência é o que
guarda a grafia. A discordância entre os dois agentes chega como dúvida comum.

> Desde que as fontes viraram modal (§4.7), essa procedência é **alcançável**, e
> não mais exibida por padrão — e o `motivo` que o agente 2 escreve deixou de
> aparecer na tela em qualquer caminho. Ele continua no `extracao.json`, e é
> lá que se olha quando a atribuição surpreende. Está no §14.

#### O que esta fatia não faz

Não realimenta o vocabulário do STT — a candidata achada no bloco 3 poderia
entrar como `keyterm` do bloco 4, e isso mexe em `vocabulario.ts`, no cache de
5 min e no teto de 100 termos. Não julga a lista de candidatas com um agente
próprio: o julgamento é do extrator, que já está com a lista e o texto na frente,
e um sexto prompt para calibrar à mão para sempre não se paga. E não conserta o
nome dito **depois** da janela — a janela 1 continua sem saber o nome que só
aparece no minuto 10, e o conserto é o de sempre: o painel de entidades da
revisão, num gesto.

### 4.15 Confrontar: relações entre átomos ao longo do tempo (slice 5, calibrada na 5.1)

O pilar "Confrontar" que `Specs/visao.md` sempre descreveu, e que este arquivo
listava como não existente desde a slice 2: perceber que uma posição mudou.
Nasceu de um pedido de chat/GraphRAG que a entrevista de alinhamento desviou —
responder "como minha opinião sobre X mudou" pede comparar átomos ao longo do
tempo, e a peça que faz isso nunca tinha sido construída (`Specs/slice-5.md`).

**Nunca em tempo real.** O agente `confronto` (`src/lib/confronto.ts`) não roda
quando um átomo é confirmado — só por cron próprio (`GET /api/cron/confronto`,
separado do `cron/diario`, §10) e sob demanda (`POST /api/confronto/rodar`,
botão em `/confronto`). É decisão da entrevista: comparar um átomo contra o
grafo inteiro é trabalho de fundo, não parte do caminho crítico da gravação.

**Quatro relações, sempre do mais novo para o mais antigo:**

```
(:Atomo mais_novo)-[:ATUALIZA|:CONTRADIZ|:CONFIRMA|:COMPLEMENTA {
  execucao, motivo, confianca, criado_em, modelo, prompt_version
}]->(:Atomo mais_antigo)
```

`ATUALIZA` substitui a mesma afirmação específica; `CONTRADIZ` se opõe a ela;
`CONFIRMA` a repete sem mudar nada; `COMPLEMENTA` — o quarto tipo, que a
entrevista acrescentou aos três do contrato original do `CLAUDE.md` — acrescenta
informação nova e compatível sem mudar nem repetir o que já estava dito. Sem
`COMPLEMENTA`, o caso mais comum entre dois átomos sobre o mesmo assunto não
tinha nome.

**Todos os tipos de átomo entram**, por decisão da entrevista: em vez de uma
lista fixa de tipos elegíveis excluir de antemão um caso que faria sentido, o
próprio agente decide caso a caso se a comparação vale a pena.

**Candidatos, pelo mesmo mecanismo vetorial da 4.5.**
`db.index.vector.queryNodes('atomo_embedding', …)` a partir do vetor do átomo
sendo processado, restrito a `valido_em` estritamente anterior (comparação
lexicográfica de ISO 8601 — átomo sem data nunca é candidato de ninguém) e
acima de `PISO_CONFRONTO` — ponto de partida igual ao `PISO_VIZINHOS` da
resolução, mas uma constante própria e independente, porque aqui o texto
inteiro do candidato entra no prompt e um piso frouxo custa tokens, não só
ruído. Sem candidato acima do piso, o átomo não vai ao modelo — mesmo
espírito custo-consciente de `decidir()` em `resolucao.ts`.

**Uma geração, sem precisar casar `execucao`.** Ao contrário da ficha da
entidade (que sobrescreve um campo e por isso guarda um `_anterior` para
restaurar), uma relação é uma aresta que só existe se for escrita.
`gravarRelacoes` apaga **todas** as relações de saída do átomo antes de
escrever as novas, toda vez que roda — nunca há mais de uma geração viva ao
mesmo tempo, e o desfazer (`POST /api/confronto/desfazer`) apaga o que existe
agora, porque "o que existe agora" já é a última geração. Isso também cobre de
graça uma rodada que morreu entre gravar e marcar `processado`: a tentativa
seguinte substitui, nunca duplica. `execucao` continua gravado, em cada
relação e no átomo (`confronto_execucao`) — é rastro de auditoria, não trava.

**A fila é o mesmo mecanismo da 4.12: estado idempotente mais `waitUntil`.**
Um **lote** por vez (`reivindicarProximosAtomos`, até `ALVOS_POR_LOTE` = 10
átomos), do `valido_em` mais antigo para o mais novo — processar nessa ordem
evita avaliar um átomo recente antes de um antigo do qual ele dependeria, e de
quebra faz os alvos de um lote serem vizinhos no tempo, que é quando eles
compartilham candidato —, com o mesmo *lease* de retomada de
`reivindicarProxima`. `POST /api/confronto/rodar` não distingue "começar" de
"elo seguinte" como `enriquecer` faz — não há passo de escolher o que entra:
todo POST reivindica um lote pendente e se autoencadeia. O cron corre a mesma
fila num loop simples, até ela esvaziar ou o orçamento de tempo acabar.

**A falha é do lote inteiro** (`marcarFalhaEmLote`), e por escolha: tentar
salvar individualmente os alvos que vieram no JSON complicaria o parser para
cobrir um caso que a retentativa já cobre de graça (regra 4). Ela só marca quem
ainda está `rodando`, então um alvo que já saiu `processado` antes de o lote
morrer não é rejulgado — e dez linhas com o mesmo motivo em `/confronto` são
uma falha, não dez.

**Ele escreve sozinho, sem tela de aprovação** — mesmo padrão do agente 4
(enriquecimento, §4.9/§4.14). A regra 5 do `CLAUDE.md` continua inteira: ela
fala de átomo e da tela de revisão, e nenhum átomo entra no grafo por aqui — o
que entra é a relação **entre** átomos já confirmados.

**`/confronto`** (`src/components/Confronto.tsx`) é manutenção mínima, não
navegação: botão "rodar agora", botão "reprocessar tudo" (dois toques), quantos
átomos ainda esperam (a tela relê sozinha a cada 4 s enquanto houver fila,
mesma decisão de `/entidades`), e a lista dos últimos átomos tocados com as
relações que ganharam e um desfazer por linha. Uma tela de navegar relação por
relação fica para quando o chat precisar mostrar isso como procedência.

Décimo agente do registro (`src/lib/agentes.ts`); no desenho de `/agentes` ele
é um dos seis do leque que parte do grafo gravado. (Quando esta fatia nasceu, o
desenho ainda era a grade de colunas, e o `confronto` custou a sexta delas; foi
esse crescimento, repetido a cada agente novo, que levou o desenho à espinha de
hoje — §4.13.)

#### 4.15.1 O que a primeira revisão à mão mudou (slice 5.1)

A slice 5 foi medida do único jeito que este sistema aceita: **58 átomos
processados, 21 relações escritas, todas lidas uma a uma por mim.** Cinco
reprovadas — e **todas as cinco eram `COMPLEMENTA`**; as seis que não eram
(`ATUALIZA`, `CONFIRMA`, `CONTRADIZ`) passaram inteiras. `Specs/slice-5.1.md`
tem a tabela par a par; o que segue é o sistema que saiu dela.

**Dois botões foram medidos e recusados antes de qualquer conserto.**
`PISO_CONFRONTO` está **inerte**: o par menos parecido dos 21 tinha
similaridade 0,728, muito acima de 0,45 — quem seleciona é o top-8 do índice, e
subir o piso até onde cortaria os falsos positivos (0,77) levaria junto duas
das três `CONTRADIZ` aprovadas. Um piso de confiança **global** também não
separa: das reprovadas, três estavam em 0,6 e duas em 0,7, mas havia três
aprovadas em 0,6 e três em 0,7. O que sobrou foi prompt, informação e um piso
por tipo.

**O prompt virou `confronto-2`**, com `NENHUMA` declarada como a resposta
padrão, um portão explícito (nomear a afirmação específica compartilhada, com
palavras dos **dois** trechos, ou é `NENHUMA`), e três proibições que vieram
direto dos erros: não vale mesma pessoa/mesmo dia/mesmo tema; não vale presumir
que duas referências vagas ("a empresa", "o negócio", "ela") são a mesma coisa;
e não vale inventar a abstração que liga os dois — num dos erros o `motivo` do
próprio modelo dizia "generaliza a percepção antiga". `CONFIRMA` foi
redefinido de "repete sem acrescentar nada" para **corroboração**: o novo
sustenta a afirmação antiga, repetindo-a **ou** trazendo resultado que mostra
que ela se cumpriu.

**O átomo chega ao modelo com as entidades que ele aponta**, sem o `"eu"` —
`sobre:` e `cita:`, e `sem entidade nomeada` quando não há. Elas custam 700
chars no grafo inteiro e servem para **barrar** referente presumido, nunca para
justificar ligação: dois dos falsos positivos eram pares em que um lado é
`sobre: Behring Founders` e o outro não nomeia empresa nenhuma, mas um terceiro
era um par que **compartilha** duas pessoas e mesmo assim não tem relação — daí
a regra de que entidade em comum não é motivo estar escrita no prompt.

**O lote com acervo numerado compartilhado** substituiu uma chamada por átomo.
A medição: numa varredura completa o desenho antigo gastava 39 chamadas e
mandava 47.322 chars de candidato para 14.431 distintos — o mesmo texto **3,3
vezes**. Agora cada átomo envolvido entra uma vez só num acervo numerado, e a
lista de pares vem depois (`7 → 3`); a resposta referencia os números do
acervo, e **par que ninguém pediu é descartado** — inclusive o mesmo par na
direção errada. `MAX_TOKENS_SAIDA` subiu de 1.500 para 4.000, porque o teto
antigo era dimensionado para um alvo.

**O `COMPLEMENTA` ganhou piso de confiança próprio** (`LIMIAR_COMPLEMENTA`,
0,7), e é o `limiarPadrao` do agente — o mesmo campo que a resolução usa desde
a 4.11, editável em `/agentes` sem deploy, que é o que uma calibração precisa
ser. Os outros três tipos não têm piso.

**`POST /api/confronto/reprocessar`** apaga todas as relações e devolve o grafo
inteiro à fila. Existe porque trocar o prompt é o trabalho normal desta fatia:
sem ele, `confronto-2` só alcançaria átomo novo e o gabarito — as relações já
julgadas à mão — ficaria congelado no prompt que as produziu. É destrutivo e
não tem desfazer próprio; o contrapeso é que a varredura reconstrói, e que a
tela pede dois toques.

#### 4.15.2 O que a segunda rodada mediu, e a decisão que saiu dela

O `confronto-2` rodou sobre os mesmos 58 átomos, e o resultado foi conferido
contra o gabarito das 21 relações já julgadas: **21 relações viraram 13.**

- **Os cinco erros foram corrigidos, 5 de 5.** `94→57` voltou como `CONFIRMA`,
  que era o veredito; os outros quatro não voltaram.
- **Das dezesseis aprovadas, oito sobreviveram** — e a perda é legível.
  **Quatro delas (`63→27`, `64→27`, `65→27`, `68→27`) apontavam para o mesmo
  átomo**, um `FATO` que diz "uma menina que eu conheci na festa do rock" e que
  **não tem entidade ligada nenhuma**; os átomos novos dizem `cita: Franciele
  Sena`, e a regra de referente recusou o par — certa pela letra, errada pelo
  fato. Outras três (`67→5`, `80→26`, `93→29`) são exatamente o que as regras
  novas proíbem — mesma pessoa, mesmo padrão de comportamento, abstração — e
  tinham sido aprovadas.
- **`68→27` prova que não foi o piso**: `CONTRADIZ` não tem piso de confiança, e
  morreu igual. Foram as regras.

**A decisão foi manter assim**, sabendo o preço: o confronto está calibrado
para **precisão, não cobertura**. Num grafo que existe para responder perguntas,
um falso positivo contamina a resposta e um falso negativo apenas deixa de
ajudar — e as duas alavancas de recuperação (afrouxar "mesma pessoa"/"mesmo
padrão", baixar o limiar) trariam ruído junto. Ligar o átomo órfão à entidade
certa continua sendo o conserto honesto quando o caso voltar: ele arruma o
dado, não o prompt.

### 4.16 O chat: perguntar ao grafo (slice 6)

`ARCHITECTURE.md` listava "busca" e "tela Perguntar" como inexistentes desde a
slice 2. A entrevista de 13/09 resolveu a tensão de produto — é **chat de
verdade**, com memória de conversa e histórico entre visitas, e não a tela
minimalista de uma pergunta e uma resposta que `Specs/visao.md` §6 descrevia —
e desviou para construir a slice 5 primeiro, porque o "Confrontar" é o material
que esta fatia consome.

#### 4.16.1 Agente com ferramentas, e não pipeline

Foi a decisão técnica central, e ela foi tomada contra um exemplo real. O
desenho proposto primeiro era um pipeline de passo fixo: um passo de extração
estruturada da pergunta (entidade, período, tipo), seguido de uma busca
determinística. Ele cai em perguntas como estas, que são as que eu de fato faço:

- *"como eu estava me sentindo depois que terminei com a Isinha?"*
- *"e depois da viagem pra Serra da Canastra?"*

As duas exigem **achar a data de um evento numa busca para só então filtrar por
ela na seguinte**. Nenhum pipeline de passo fixo cobre isso sem virar, na
prática, um agente disfarçado — então ele é um agente declarado, com um teto
escrito e o rastro visível.

O loop mora em `src/lib/chat.ts` e é `generateText` com `tools` (SDK `ai`, id de
modelo em **string** — regra 8, como todo o resto). Ele para quando o modelo
escreve texto, ou quando a soma das chamadas de ferramenta chega a
`TETO_FERRAMENTAS = 8`.

**Oito é piso, e não teto exato — desde que a slice 9 autorizou busca paralela.**
`stopWhen` é avaliado **entre** passos, então um passo que pede três chamadas de uma
vez parte de 7 e termina em 10. Isso já era possível antes (o SDK sempre pôde
agrupar), mas o `chat-2` nunca dizia que podia, e o caso era raro; o `chat-3` manda
fazer, e o caso vira comum. O transbordo é limitado pelo tamanho de um passo e
barato, e por isso está documentado em vez de cortado — cortá-lo pediria
`prepareStep` ou `activeTools`, custo de desenho para um risco que não apareceu.

**Oito, e o número tem os dois lados medidos contra a pergunta real.** Quatro
foi recusado: o caso Isinha gasta duas chamadas só para achar a data do término,
e sobraria orçamento de menos para o resto. Dezesseis foi recusado pelo lado
oposto — o pior caso de latência cresce sem nenhum exemplo pedindo, e cada
chamada é uma ida ao Gateway que eu pago.

**A síntese pode custar uma segunda chamada, e isso não é acidente.** Quando o
loop para no teto, ele para *em cima de um resultado de ferramenta*: o modelo
ainda não escreveu nada. Aí sai uma segunda chamada, com o mesmo histórico e
`toolChoice: "none"` — "agora responda com o que você tem". Sem ela, a pergunta
mais composta do sistema, a que gastou as oito buscas, seria justamente a que
volta vazia.

**A data de hoje entra fora do prompt editável** (`montarSistema`). Ela é a
única coisa deste agente que muda todo dia, e um prompt salvo com "hoje é 13/09"
congelaria a mentira dentro do objeto imutável do `prompt_hash` — "esse mês" e
"semana passada" passariam a ser resolvidos contra o dia em que eu editei o
prompt em `/agentes`.

#### 4.16.2 As duas ferramentas, e por que duas

Quatro ferramentas de dimensão única — semântica, entidade, período, confronto —
foram desenhadas primeiro e recusadas: uma pergunta composta ("o que eu fiz,
aprendi e conquistei em agosto") exigiria encadear e cruzar à mão o que um
parâmetro de lista resolve numa chamada só. Uma terceira, para comparar duas
entidades diretamente, também foi recusada — nenhum exemplo real pediu, e se
aparecer o agente tenta com duas chamadas de `buscar_atomos`.

```
buscar_atomos({ texto?, entidade?, tipo?: TipoAtomo[], desde?, ate? })
```

Todos opcionais, todos combináveis. **Sem `texto`** é um `MATCH` filtrado,
ordenado por `valido_em` desc, com teto de `TETO_ATOMOS = 8`. **Com `texto`** o
índice vetorial `atomo_embedding` (migration 006) entra e os demais filtros se
somam como condição, ordenando por similaridade; `2 * score - 1` desfaz a
normalização do índice de volta para cosseno, a mesma conta de `entidades.ts` e
`confronto.ts`. Acima de `PISO_BUSCA = 0,45`, e não de 0,30 — ver logo abaixo.

##### O aperto de volume, depois da primeira pergunta vaga de verdade

A fatia nasceu com três números que, juntos, entregavam o diário inteiro em vez
de uma resposta: piso de 0,30, doze átomos por busca, e nenhuma memória entre as
buscas de um mesmo turno. "Quais são minhas prioridades" cobrou os três de uma
vez. O conserto foi de calibragem, sem capacidade nova — nenhuma terceira
ferramenta, nenhum catálogo de entidades injetado:

- **`PISO_BUSCA` 0,30 → 0,45.** O argumento original era que numa leitura o átomo
  errado custa só uma linha que o modelo descarta. Custa mais: ele **enterra** o
  acerto no meio de uma resposta longa. E 0,30 não cortava nada — a medida já
  estava no repositório, em 4.15: numa varredura inteira de confronto o par de
  átomos **menos** parecido dava 0,728, e o piso de 0,45 "nunca cortou nada". Os
  átomos deste diário vivem alto no espaço de cosseno; contra uma pergunta
  abstrata, 0,30 aprova o corpus e os primeiros colocados viram sorteio. 0,45
  alinha com `PISO_CONFRONTO` e `PISO_VIZINHOS` — um número a menos para
  calibrar;
- **`TETO_ATOMOS` 12 → 8.** Doze cabiam no prompt e na tela do (i); a conta que
  faltava era a outra — doze vezes o teto de oito chamadas são quase cem trechos
  num contexto só;
- **o mesmo átomo não volta inteiro duas vezes no mesmo turno.** As duas
  ferramentas compartilham um conjunto de ids já mostrados; da segunda vez em
  diante o que vai ao modelo é `[id X] já mostrado acima`. **Colapsar, e não
  omitir:** um átomo que duas buscas alcançam é informação — sumir com ele faria
  o modelo ler a segunda busca como mais pobre do que foi e buscar de novo, que
  é justamente o que o teto de oito chamadas não tem para gastar. O conjunto é
  montado **por tentativa**, dentro do fecho que `comEsperaDeLimite` repete, pelo
  mesmo motivo que o rastro já era zerado ali: um conjunto sobrevivente
  colapsaria, na tentativa boa, exatamente o átomo que só a tentativa perdida
  mostrou — uma resposta citando "já mostrado acima" sem nada acima;
- **o prompt virou `chat-2`.** Ele mandava alargar ("outra palavra, sem filtro de
  tipo, período mais largo") e nunca mandava descartar. Agora alargar é só para a
  busca que voltou **nada**; pergunta vaga se estreita com `desde` e o recorte
  usado vai dito na resposta; e há um teto de trechos citados, com a instrução
  explícita de que o normal é descartar a maior parte do que a busca trouxe.

**O (i) não perdeu nada nisso.** `paraRastro` e `PassoDeFerramenta` continuam
guardando todos os achados inteiros de todas as chamadas — o rastro completo é a
promessa da fatia, e o corte é só do que volta ao prompt.

##### `chat-3`: a resposta para de fazer o trabalho do (i) (slice 9)

O aperto acima cuidou de **quanto** material vem da busca. O que sobrou errado era
o que a resposta fazia com ele: saía um relatório das buscas, e não uma resposta.

O `chat-2` empurrava para esse registro em três instruções — *"Cite as datas"*,
*"Cite no máximo cinco trechos"*, *"mostre os dois"* — e puxava para curto em uma
só, na forma mais fraca que existe: *"Sem lista com marcador **quando** duas frases
bastam"*, uma negativa condicional que autoriza a lista por omissão. Não havia teto
de tamanho nem ordem, então evidência e resposta saíam misturadas. E "cite no
máximo cinco" era lido como cota: cinco.

O `chat-3` inverte a seção `COMO RESPONDER`:

- **a resposta responde nas duas primeiras frases**, antes de qualquer evidência, e
  sem preâmbulo nem repetição da pergunta — os passos na tela já disseram que
  procurou;
- **teto em número de frases**, não em adjetivo. "Prosa curta" não é teto;
- **prosa, e lista só se eu pedir com essas palavras** — a permissão deixou de ser
  por omissão;
- **um trecho, no máximo dois**, e a justificativa entra no próprio prompt: a
  procedência inteira mora no (i), e a resposta estava duplicando o (i) em prosa;
- **a data entra dentro da frase**, não num bloco de citações.

**O tom do `Specs/visao.md` §7 não mudou, e o princípio 4 do §5 continua cumprido.**
Bibliotecário atento e não coach, não inventar, mostrar as duas pontas de uma
contradição: tudo fica. "Sucinto" aqui é o oposto de "relatório", não de "com
origem" — o que saiu da resposta foi o bloco de citações, não a origem, porque a
origem tem um lugar melhor desde a slice 6.

**E o `chat-3` autoriza busca paralela**, que o `chat-2` nunca disse que podia
embora o SDK já agrupasse: duas buscas que não dependem uma da outra saem no mesmo
passo. Junto vem o número que faltava — a maioria das perguntas se resolve em uma
ou duas buscas, e mais de três é sinal de varredura. Ver o transbordo do teto em
§4.16.1.

**Ficou de fora de propósito**: a instrução para o modelo ler a linha de recorte da
busca (`8 de 34 trechos`). Ela vai no `chat-4`, junto com a mudança que faz essa
linha existir — instrução sobre saída que ainda não existe é texto morto, e
atrapalharia o julgamento à mão que decide se o `chat-3` melhorou a resposta.

Três detalhes que erram calado, e por isso estão fixados por teste:

- **o período compara data com data.** O parâmetro é `AAAA-MM-DD` e o campo é um
  instante; sem `left(a.valido_em, 10)`, um `<= '2026-08-31'` excluiria tudo o
  que aconteceu no próprio dia 31;
- **átomo sem `valido_em` sai de qualquer pergunta com período.** String vazia
  passa no `<= ate` e apareceria como se fosse de antes do começo do diário;
- **entidade que não existe volta com aviso, não com lista vazia.** A diferença
  entre "essa pessoa não está no diário" e "você escreveu o nome de outro jeito"
  é a diferença entre uma resposta errada e um segundo palpite; o aviso leva os
  nomes parecidos do catálogo junto. A entidade resolve por `listarEntidades` +
  `acharPorChave` — o mesmo caminho da extração, que atravessa alias de graça —
  e a consulta atravessa `:FUNDIDA_EM` para alcançar o átomo antigo que ainda
  aponta para o nó perdedor.

```
historico_do_atomo({ atomo_id })
```

Anda `[:ATUALIZA|CONTRADIZ|CONFIRMA|COMPLEMENTA*1..4]` **sem seta**, nas duas
direções. É a parte que importa: as relações da migration 011 nascem sempre do
mais novo para o mais antigo, então andar só para frente mostraria o que este
átomo mudou, e andar só para trás mostraria o que mudou este átomo — e a
pergunta "como minha opinião mudou" quer os dois lados do ponto onde eu parei.
São duas consultas e não uma (os átomos, depois as arestas entre eles): todo o
resto do sistema conversa com o Neo4j em escalar e mapa, e é o que mantém
`linhas<T>` simples.

**Átomo sem vizinho devolve um aviso, não uma lista de um item.** Um item só não
é "não mudou": é "a varredura do confronto ainda não passou por aqui", e as duas
coisas levam a respostas opostas.

**As ferramentas nunca propagam erro.** Ferramenta que estoura derruba o loop e
a pergunta fica sem resposta; ferramenta que devolve "não consegui" deixa o
modelo tentar outro caminho — que é o que uma pessoa faria. O erro vai para o
rastro do (i) do mesmo jeito, então nada fica escondido.

#### 4.16.3 Só leitura, e nem por ferramenta

Uma ferramenta de escrita com confirmação — arquivar um átomo direto do chat —
foi considerada e recusada. É a leitura mais direta da regra 5 do `CLAUDE.md`, e
espalhar o lugar onde escrita acontece para mais uma tela não tinha pedido real
por trás. É o que a separação das duas telas de `/agentes` desenha: o chat é a
tela inteira do que **sai** do grafo, e nela não há uma volta sequer.

#### 4.16.4 A conversa: nó leve, mensagens no R2

Migration 012 (§8.6). O nó `:Conversa` carrega o que a lista precisa para
desenhar uma linha e ordenar; as mensagens e o rastro de cada resposta ficam em
`conversas/<id>/mensagens.json` (§9) — a regra 2 aplicada de novo, e o mesmo
padrão de `:Sessao`. Guardar tudo no R2, com um manifesto e nenhum nó novo, foi
considerado e recusado: listar viraria ler-e-regravar um arquivo em vez de uma
query.

Cada mensagem do agente carrega `rastro`, `modelo` e `prompt_version` — a regra
7 aplicada em espírito, como a migration 011 já fez com a relação: ela fala de
átomo, e uma resposta escrita por LLM pede a mesma auditoria.

**A escrita é read-modify-write por etag**, como o manifest, e o `atualizada_em`
do nó sobe **depois** do R2 — a lista ordenar por uma escrita que não aconteceu
seria mentir na única tela onde a conversa é encontrada.

**A pergunta é gravada antes de o modelo começar.** Se eu apertar "parar", ou se
a função morrer no meio, a pergunta fica e a resposta não — que é o resultado
honesto, e o mesmo que a tela mostra. Gravar as duas juntas no fim perderia a
pergunta de uma resposta interrompida.

**O rastro das respostas antigas não volta ao modelo.** Ele fica na mensagem,
para o (i), mas não entra no prompt do turno seguinte: replicar as chamadas de
ferramenta de todos os turnos anteriores encheria o contexto de material que já
virou prosa. O que o modelo relê de um turno passado é a resposta que ele
escreveu — que é também o que eu li.

#### 4.16.5 Apagar e arquivar — as duas, e a exceção declarada à regra 6

São ações distintas, e o pedido da entrevista foi explícito em ter as duas:

| ação | o que faz |
|---|---|
| **arquivar** | `SET c.arquivada_em`. Congela: sai da lista principal, `POST /api/chat` recusa com 409, continua legível num separador de arquivadas. Desarquivar é o mesmo gesto com `false` |
| **apagar** | `remover` no R2 e `DETACH DELETE` no nó. Some de vez, sem volta |

**É a única deleção de verdade deste sistema.** A regra 6 do `CLAUDE.md` proíbe
`DELETE` em átomo; conversa não é átomo — não é conhecimento, é a transcrição de
uma pergunta que eu fiz a uma tela. Nenhum átomo perde procedência quando ela
some, e nada do grafo depende dela. A migration 012 escreve isso por extenso.

**O R2 primeiro, o grafo depois.** Na ordem inversa, uma falha no meio deixaria
um objeto órfão que ninguém mais alcança: a chave só existia no nó que acabou de
sumir, e `r2.ts` não tem `LIST` para reencontrá-la. É a mesma razão de
`chavesDaSessao` pôr o manifest por último.

#### 4.16.6 O título, e o agente `titulo-chat`

Uma chamada barata sobre a primeira troca, gravada em `titulo` assim que sai.
Título por truncamento da primeira mensagem foi recusado — sai sem sentido
quando a pergunta é longa ou vaga, e o produto citado como referência
(ChatGPT/Claude) gera título por modelo. O truncamento continua existindo como
**fallback** na tela, enquanto o agente não respondeu.

String vazia é resultado válido: se o modelo falhar, a conversa fica sem título
e a lista mostra a primeira pergunta cortada. Ninguém perde uma resposta porque
o batismo não saiu.

`titulo-chat` é o primeiro id de agente com hífen, e por isso `chavePromptAgente`
passou a aceitá-lo: o que aquele validador barra é travessia de caminho, não
hífen.

#### 4.16.7 O fluxo NDJSON, e o progresso por passo

`POST /api/chat` devolve um fluxo de NDJSON — um objeto JSON por linha:

```
{"tipo":"conversa","conversa":{…}}     primeiro, para o cliente saber o id
{"tipo":"passo","passo":{…}}           um por chamada de ferramenta concluída
{"tipo":"resposta","mensagem":{…}}     a síntese, já gravada
{"tipo":"titulo","titulo":"…"}         só na primeira troca
{"tipo":"erro","erro":"…"}             o que não coube num código HTTP
```

**Nenhuma dependência nova.** O pacote `ai` traz protocolo de streaming pronto e
ele foi recusado: ele fala de *token*, e o que esta tela mostra enquanto espera
não é token — é qual busca o agente está fazendo. Um objeto por linha resolve
isso com `fetch` e `TextDecoder`, que todo navegador já tem, e mantém o
`package.json` do jeito que a slice 6 o encontrou.

O evento de passo chega **depois** que a ferramenta respondeu, e por isso a
linha de progresso fala no passado ("buscou 'término' · sobre Isinha — 4
trechos"). Escrever "buscando…" sobre trabalho terminado seria o tipo de
mentirinha de interface que faz a espera parecer mais longa do que é.

**Sem chave de idempotência**, e é a única rota do sistema assim (regra 4). A
regra chaveia por `sessao_id` porque o pipeline pode ser reexecutado sozinho,
por `waitUntil` e por retomada; aqui quem dispara sou eu apertando enviar, e
duas perguntas iguais seguidas são duas perguntas, não uma repetida.


### 4.17 O sistema se cronometra (slice 8)

**O tempo entre o toque em parar e a revisão abrir deixou de ser impressão.** Até
esta fatia a previsão era "de um a dois minutos para segundos" e previsão não é
medição: nada nunca foi cronometrado desde que a 4.8 desconcentrou a extração. A
única sessão longa real que se olhou (`mtqoeoqh3e3724514q1f`, 1044 s) mediu token
e `finishReason`, nunca relógio — e o sistema saiu do `localhost`, roda no
telefone, e o telefone é onde eu espero olhando a tela.

**Três objetos, e o que impede o registro de inchar é a forma, não a disciplina:**

| Objeto | O que é | O que o mantém pequeno |
|---|---|---|
| `sessoes/<id>/medidas.json` | o detalhe de uma sessão | passos e agentes **agregados** (`{n, ms, pior_ms}`), não lista de eventos; falhas com teto de 20; morre com a sessão |
| `medidas/indice.json` | uma linha por sessão, os números de manchete | teto de 400 linhas, podado como as correções; **sem texto livre** |
| `medidas/<AAAA-MM>.json` | o resumo do mês — n, mediana, pior caso, por passo | doze objetos por ano, e nada mais cresce |

**Por que não o log da Vercel:** ele expira, e o que esta fatia quer é dizer,
daqui a três fatias, se alguma coisa regrediu. **Por que não o Neo4j:** série
temporal quer índice por data, e a cota de índice do Aura Free já está no teto
pelos dois índices vetoriais da 006 (§14). **Por que R2 com índice:** `r2.ts` não
tem `LIST` — é exatamente por isso que `calibracao/indice.json` existe, e o mesmo
molde serve aqui.

**O que entra:** tempo por passo, falha (o que quebrou e por quê) e custo
(chamadas por agente, e tokens quando o Gateway devolve). **O que não entra:**
campo sem pergunta atrás. Cada número gravado responde a uma pergunta que eu de
fato faço — "onde foi o tempo", "isso piorou desde a emenda", "quantas janelas
ficaram para trás". Log de depuração genérico é o que apodrece. **Texto livre de
erro fica no objeto da sessão**, que é limitado e some com ela; o índice guarda
código e contagem, e é ali que esse tipo de registro sempre incha.

**Apagar a sessão não apaga a linha do índice.** `chaveMedidas` entra em
`chavesDaSessao` e `medidas/indice.json` não, exatamente como a correção já
sobrevive ao átomo (§9). A série não ganha buraco quando eu apago uma sessão de
teste, e sessão de teste que foi mal não some para melhorar a média sozinha.

**O número é do toque em parar até a revisão abrir**, e inclui a rede de
propósito: é o tempo que eu espero olhando o telefone, não o que o servidor gosta
de contar. Isso obriga o cliente a marcar três instantes que o servidor não tem
como saber, e ele marca em `src/client/medidas.ts`:

| Marca | Onde nasce | Quando |
|---|---|---|
| `parou` | `Gravacao.parar()` / `Importacao` | o toque em "parar", ou o arquivo aceito — o último gesto meu antes da espera |
| `fila_vazia` | `Processando` | `aguardarFilaVazia()` voltou e o `/finalizar` vai sair |
| `revisou` | `Revisao` | a proposta montou na tela. É o fim da espera — e desde a 8.2 é o **primeiro** evento do fluxo que a marca, uma vez só, não cada janela que chega |

`parou` **não vai à rede** quando acontece: ele fica no `sessionStorage` e sobe
junto com `fila_vazia`, num pedido só. Mandá-lo no instante do toque seria mandar
no pior momento possível — é o mesmo em que a fila acorda, a sessão fecha e a
navegação acontece.

**Os três vêm do mesmo relógio**, o do navegador, e é entre eles que a subtração
acontece. Os passos do servidor são gravados como **duração**, nunca como
carimbo, justamente para que "instante do servidor menos instante do cliente" não
seja uma conta possível.

**A marca da revisão só vale se aquela aba passou pelo corredor.** É o
`sessionStorage` que amarra as três, e é ele a guarda: abrir pela lista a revisão
de uma sessão de três semanas atrás não inventa uma espera de três semanas.

**Como a instrumentação chega aos passos sem atravessar quinze assinaturas.**
`comMedicao` abre um `AsyncLocalStorage` no `waitUntil` que começa o trabalho, e
`medir`/`medirAgente`/`registrarFalha` escrevem no coletor daquele contexto —
`stt.ts`, `extracao.ts`, `resolucao.ts`, `desempate.ts`, `embedding.ts`,
`pipeline.ts`. **Fora de um contexto as três são transparentes**: chamam a função
e devolvem o resultado, sem tocar em rede nenhuma. É isso que faz o `pnpm test`
continuar exercitando `finalizarSessao` direto sem gravar medida, e o chat, o
confronto e o enriquecimento não pagarem por um registro que não é deles.

**Uma invocação escreve uma vez.** O contexto é aberto em três `waitUntil` —
`/chunks/:i/pronto`, `/finalizar` e `/extrair` —, e só os dois últimos passam
`fecha: true`: o `/pronto` roda trinta vezes por sessão, e trinta idas ao índice
seriam pagar trinta vezes por uma linha que ainda vai mudar. Chamado dentro de um
contexto que já existe, `comMedicao` vira `medir` — o `/finalizar` que emenda na
extração não abre um segundo registro.

Os passos são lista fechada (`PASSOS_MEDIDOS`), e de propósito: com uma lista, um
passo novo no pipeline que ninguém instrumentar é uma linha que **falta** e se
vê, em vez de um campo livre que cada chamador inventa à sua maneira.

**A chamada de modelo é contada por dentro da espera de rate limit**, e não por
fora: tentativa recusada por 429 também é ida ao Gateway e custa igual. Contar só
a que deu certo esconderia exatamente a rajada que esta fatia foi medir. Os
tokens entram quando o Gateway os devolve e ficam **ausentes** quando não —
ausência é informação, zero seria mentira.

**Nada aqui pode derrubar o pipeline.** Uma falha ao gravar a medida vira uma
linha `[medidas]` no log e nada mais, e o erro do trabalho sobe inteiro com a
medida do que já tinha rodado gravada junto.

**E o coletor descarrega no meio do caminho, não só no fim** (18/09). Gravar
apenas no `finally` deixava o registro cego exatamente onde ele é mais
necessário: função morta pelo `maxDuration` não chega ao `finally`, e a medida
inteira daquela invocação ia junto. Foi o que a sessão `mu73d88b0w4u6o5d440j`
mostrou — `espera_blocos` e `concatenar` **rodaram** (o `transcricao.json` e o
`finalizado: true` provam) e não estão no objeto, porque o `/finalizar` foi morto
no meio da chamada seguinte. `INTERVALO_DESCARGA_MS` é 30 s: uma passada de
`/pronto` típica dura segundos e não paga descarga nenhuma, e a de 300 s paga
dez, contra um registro inteiro perdido.

**Drenar, e não copiar.** `fundirMedidas` soma, então mandar duas vezes o mesmo
acumulado contaria o mesmo trabalho duas vezes e a medida passaria a mentir para
cima: cada descarga leva o pedaço novo e zera o coletor, e o objeto no R2 é a
soma de todos eles. Descarga que falha **devolve** o pedaço ao coletor, para a
próxima tentar de novo com ele junto; e as descargas são enfileiradas, nunca
simultâneas, porque duas gravações sobre a mesma chave brigariam no laço por etag
à toa.

**O que continua faltando numa invocação morta é o passo de fora** — `finalizar`,
`pronto` —, que por definição não terminou. Essa ausência não é buraco: é o
sinal. Passo de fora que falta é invocação que não voltou.

**Sem tela nesta fatia.** Quando eu quiser olhar, eu peço: `GET /api/medidas` dá
o índice, `?mes=AAAA-MM` o resumo do mês, e `GET /api/sessoes/:id/medidas` o
detalhe daquela sessão. As rotas existem porque sem `LIST` no R2 a série só seria
alcançável pelo console do Cloudflare — não porque haja o que desenhar. Se a
leitura virar hábito, a tela vira item da pauta (8.4).

**O resumo mensal sai na batida diária**, depois do backup e engolindo a própria
falha: o que não pode faltar naquela batida é o dump e a consulta que mantém a
Aura acordada. Enquanto as linhas de um mês estiverem no índice, o resumo dele é
reescrito todo dia e fica mais completo; quando a poda começar a comê-lo, o
resumo já gravado tem mais sessões que o índice mostra e **não** é reescrito. É
essa guarda, e não a ordem de execução, que faz o detalhe de março sumir e a linha
de março ficar.


### 4.18 Os seis consertos, e o penhasco (slice 8)

A segunda metade da fatia. Ela sobe **depois** de a medida ter rodado numa sessão
real, e a ordem não é cerimônia: com instrumento e conserto no mesmo deploy não
haveria como saber o que melhorou.

**Primeiro o que elimina trabalho, depois o que paraleliza.**

| # | O que era | O que é |
|---|---|---|
| 1 | o STT do último bloco podia ser pago **duas vezes** | o bloco ganha lease no manifest (`transcrevendo_em`), espelhando `reivindicarJanela` |
| 2 | `listarEntidades()` rodava **duas vezes por finalização** | um retrato só, passado às janelas e à montagem da proposta (`catalogoUmaVez`) |
| 3 | `configAgentes()` era um GET por chamada de agente | cache **por invocação** (`invocacao.ts`), que não fura "salvei, vale na próxima" |
| 4 | ~3,5 s de polling puro entre "acabou" e "abriu" | 1 s → 400 ms no laço dos blocos, 500 → 150 ms na fila, 2 s → 750 ms na tela |
| 5 | o RAG da janela percorria os 4 blocos em série | `Promise.all`, com o `catch` **por bloco** para um não levar os outros |
| 5 | a fila do cliente subia um bloco por vez | três frentes, que só importam no instante do `parar` |
| 6 | toda falha esperava a escada de 20 s e 60 s | só o 429; o resto tenta de novo em segundos (§5.3) |

**O lease do bloco fecha uma janela que a trava antiga não cobria.** A existência
de `chunk_NNN.json` só vale **depois** de o STT voltar; entre o pedido e a
resposta havia dezenas de segundos em que o `waitUntil` de `/chunks/:i/pronto` e
o laço de espera de `finalizarSessao` podiam mandar o mesmo áudio, e o
`/finalizar` chega segundos depois do último `/pronto`. Agora quem não reivindica
recebe `null` — que **não é falha**: é a resposta certa, e o laço relê o manifest
na volta seguinte e vê o bloco pronto. Bloco que falha **solta** o lease antes de
subir o erro, para o próximo não esperar dois minutos por um trabalho que já
acabou; e `marcarTranscrito` também o solta, porque bloco pronto não tem dono.

**O cache por invocação não revoga a decisão de `overrides.ts`, lê-a com mais
precisão.** O que aquele comentário proíbe é cache **de instância**: função
serverless quente guarda estado de módulo entre requisições, e ele serviria o
prompt velho depois de eu ter salvo o novo. O de invocação morre com o
`waitUntil` — a próxima lê de novo —, e o que ele elimina é a repetição dentro do
mesmo trabalho. O caso que o tornou necessário é o desempate (4.11), que roda em
`Promise.all`: N menções abaixo do limiar viravam N GETs simultâneos do mesmo
objeto. Só os três `waitUntil` do pipeline abrem o escopo; nenhuma rota que
escreve e relê no mesmo pedido abre.

**O penhasco vira erro.** Até aqui, se **qualquer** janela não estivesse `pronta`
na finalização, `propostaDaSessao` descartava tudo que a 4.8 acumulou e rodava
`extrair()` sobre a sessão inteira num passe só — **em silêncio**, sem nada na
tela que distinguisse uma proposta montada de oito janelas de uma tirada num
passe de 17 minutos. É o caminho de 1–2 min que a 4.8 existe para eliminar, e eu
o pagava sem saber. Agora a sessão vai para `erro` com o motivo no log
(`JanelaPresaError`) e espera eu mandar re-extrair.

**E o gatilho mais comum dele nem era defeito.** Ele disparava sempre que um
lease de 120 s ainda estava segurado por um `waitUntil` anterior no instante em
que o `/finalizar` rodava — que é a condição **normal**, não a excepcional.
`avancarJanelas` deixou de desistir nesse caso: fechando a sessão, ela **espera**
quem está na janela (`esperarQuemEstaNela`, 700 ms entre conferências), e só
assume quando o lease vence de fato. As três saídas são `pronta` (ele fechou),
`minha` (o lease venceu e eu assumi) e `desistiu` (acabou o orçamento) — e só a
última vira erro. Durante a gravação nada mudou: quem encontra a janela ocupada
para, e não pula, porque a janela `n` precisa do acumulado da `n-1`.

**A troca está declarada:** uma sessão que antes entregaria nove átomos por passe
único passa a parar e pedir re-extração. É a troca que eu quis — prefiro saber.
Áudio, transcrição e acumulado continuam todos no R2, e o retry é
`POST /api/sessoes/:id/extrair`, o mesmo botão de sempre.


### 4.19 A revisão abre antes de a proposta fechar (slice 8.2)

A slice 8 declarou esta fatia **condicional**: ela só existia se o número da 8
continuasse ruim. Continuou. Depois dos seis consertos, as sessões reais gravadas
a partir de 18/09 ainda mostraram 119–301 s de espera entre parar de falar e a
revisão abrir, e a `mu4um3ot3t5k4g1u1p1j` ficou **dois dias** presa, retentada e
falhando do mesmo jeito a cada vez. O gatilho disparou.

**O que sobrava de espera era trabalho que só pode acontecer depois que eu paro:**
o STT do último bloco, a janela final, a resolução de identidade dela. Isso tem
piso. O resto da sessão — que é a maior parte — **já estava extraído** quando eu
parava, desde a 4.8. O que esta fatia faz é parar de esconder esse material.

**A tela de revisão abre com o que existe e recebe o resto.** Não é prévia em
modo leitura: é a revisão de verdade, com edição, marcação e player. O que torna
isso viável não é óbvio e está na 4.8: o id do átomo é carimbado **na escrita**
(`aplicarJanela`), não na extração. A lista cresce por baixo; nada se renumera,
nada troca de lugar. `edicoes`, `rejeitados`, `renomes` e `abertos` são todos
`Record`/`Set` chaveados por esse índice — então trocar a proposta inteira a cada
evento é seguro **por construção**.

| Peça | O que era | O que é |
|---|---|---|
| `GET /api/sessoes/:id/extracao` | 404 enquanto `extracao.json` não existisse | serve o acumulado de `parcial.json`, dizendo `crescendo: true`; o 404 passou a significar **zero átomos** |
| `GET …/extracao/eventos` | não existia | um fluxo NDJSON, consumido pelas **duas** telas |
| `Processando` | esperava `status === "em_revisao"` | sai no **primeiro** evento com átomo, antes do status virar |
| `Revisao` | buscava uma vez e parava | consome o fluxo, funde, e destrava o confirmar no fim |
| janela que falha | derrubava a proposta e a sessão ia para `erro` | é tentada **uma segunda vez, só ela**, antes de desistir |

**"O servidor empurra" é uma meia-verdade, e ela está no código.** Não há pub/sub
neste projeto — sem Redis, sem WebSocket, fora do stack decidido em `CLAUDE.md`.
O que `acompanharProposta` faz é **polling curto do lado do servidor**: relê
`parcial.json` a cada `INTERVALO_EVENTOS_MS` (700 ms, a mesma ordem de grandeza
de `INTERVALO_LEASE_MS`) e só emite quando `parcial.atualizado_em` mudou. O que a
conexão aberta compra é a viagem de ida que o polling do navegador pagaria a cada
volta, e o formato é exatamente o de `/api/chat`: `ReadableStream<Uint8Array>`,
`application/x-ndjson`, `Cache-Control: no-store`, `X-Accel-Buffering: no`. Não
há um segundo protocolo de streaming no projeto.

**O carimbo é o que segura o custo.** Enquanto `atualizado_em` não muda, não se
remonta `montarExtracao` nem se releem os blocos: um tick sem novidade custa duas
leituras pequenas no R2. O catálogo do grafo é lido **uma vez por conexão**
(`catalogoUmaVez`, §4.18), como na finalização e pelo mesmo motivo — nada entre
os ticks escreve entidade.

**O teto do fluxo é o que decide se a fatia é usável**, e a própria spec o diz.
`TETO_STREAM_MS` é 280 s: fecha limpo 20 s antes do `maxDuration` de 300 s da
rota, para o corpo nunca ser cortado no meio pela plataforma. Fechar sem evento
final é seguro porque o cliente reconecta — e a reconexão traz o outro cuidado,
`mesclarProposta`: um retrato com **menos** átomos que o da tela é um retrato
velho de uma conexão anterior, e é ignorado. A lista só cresce.

**Confirmar espera a proposta fechar, e isso é absoluto.** Enquanto `crescendo`
for verdadeiro o botão fica travado, e a guarda está também dentro de
`confirmar()` — o `disabled` é aparência, a linha é a regra. Confirmar em duas
levas foi recusado: partiria em duas tudo que é chaveado por `sessao_id` — a
captura de correções, os embeddings, o confronto, a idempotência inteira.
Confirmar descartando o que chegasse depois foi recusado por pior: eu perderia
átomos do fim da fala sem reparar. **A regra 5 não está em jogo** — nada é
gravado antes da confirmação, com ou sem esta fatia; o que está em jogo é não
gravar **metade**. Nem o teto da espera destrava: passado ele, a tela troca a
mensagem por uma honesta e o botão continua travado.

**A linha do rodapé é a única concessão de interface.** "faltam 2 de 9 trecho(s)",
e ela some quando a proposta fecha. Nada de barra de progresso, nada de marca de
"novo" em átomo que chega: esta é a tela mais apertada do sistema e ela foi
enxugada de propósito fora de fatia (o texto edita no lugar, a dúvida virou uma
frase, a procedência foi para trás de um `ⓘ`). Encher de indicador agora desfaria
isso.

**O mapa de blocos vem do parcial, e é o que faz o player funcionar antes do
fim.** `transcricao.json` só existe depois que a sessão fecha; na proposta que
cresce, `concatenar` sobre o **prefixo contíguo** dos blocos já transcritos
devolve o mesmo mapa `{i, offset_s}` que a revisão sempre usou. Sem ele, o átomo
apareceria sem botão de escutar justamente enquanto eu o estou julgando.

**A segunda chance da janela não é código novo de retry.** `avancarJanelas` já
pula janela `pronta` e já reivindica de novo a que está `falhou`; chamá-la uma
segunda vez reprocessa exclusivamente o que falta, na ordem, sem tocar no que
fechou. **As duas passadas dividem um orçamento só** (`ORCAMENTO_JANELAS_MS`), e
isso não é economia: `finalizarSessao` já pode ter gasto até `ESPERA_MAX_MS`
(150 s) esperando blocos, e `150 + 120 = 270 s` cabe de propósito sob o
`maxDuration` de 300 s. Dar 120 s novos à segunda levaria o pior caso a 390 s — a
função morreria no meio, que é pior que a falha que ela existe para consertar. Se
a segunda também falhar, a sessão vai para `erro`, como a decisão 5 da slice 8
manda: a coerência entre as duas fatias é deliberada.

O caminho durante a fala (`fechando: false`, a cada `/pronto`) não mudou: uma
janela que falha ali já é retentada de graça na chamada natural do bloco seguinte.

**A máquina de estados não ganhou estado novo.** `em_revisao` continua
significando "a proposta fechou"; o que mudou é que a tela de revisão não espera
mais por ele para abrir.

**O parser de NDJSON saiu do `Chat.tsx`.** Com o segundo fluxo do projeto, três
telas passaram a consumir o mesmo dialeto, e `partirLinhas`/`lerEventos` foram
para `src/client/ndjson.ts`. `Chat.tsx` reexporta `partirLinhas` porque é de lá
que `tests/chat.test.ts` o importa, e é o mesmo parser. Pelo mesmo motivo
`TETO_DA_ESPERA_MS`/`esperouDemais` saíram de `Processando.tsx` para
`src/client/espera.ts`: duas telas passaram a contar o mesmo teto, e a segunda
não deve arrastar a primeira inteira para o bundle por causa de seis linhas puras
(é a razão de `localizarNoAudio` morar em `transcricao.ts`, §4.5).


## 5. Estados da sessão

```
gravando → finalizando → transcrevendo → transcrito → extraindo → em_revisao → confirmada
                                                          ▲            │
                                                          └────────────┘  reextrair
   qualquer um destes ────────────────────────────────────────────▶ erro
   (menos confirmada)                                               │
                                                                    └──▶ retry manual:
                                                                        finalizando,
                                                                        transcrevendo,
                                                                        transcrito ou
                                                                        extraindo
```

`transcrito` **não é mais terminal**: a extração emenda nele. O fim da linha é
`confirmada`, e quem confirma sou eu, na revisão — `estaConcluida` mudou junto.
`confirmada` **não tem transição de saída**, e desde 05/09 isso vale de fato: as
quatro escritas de `erro` (três em `pipeline.ts`, uma na rota `/finalizar`)
levam a lista de onde se pode cair em `erro`, e ela é a máquina inteira menos
`confirmada`. Antes elas iam sem guarda nenhuma, e um `/finalizar` numa sessão
já confirmada cuja `transcricao.json` tivesse sumido do R2 gravava `erro` por
cima: os átomos continuavam no grafo e a sessão aparecia como falha.

O `erro` sai de qualquer estado porque qualquer passo pode falhar — o que ele
não pode é desfazer o único estado terminal. `em_revisao → extraindo` é o botão
"reextrair" da lista de sessões, e a volta a partir de `erro` é retry manual.

**Esse retry esteve trancado por um guard de rota.** `POST /:id/extrair` barrava
em `temTranscricao`, que não inclui `erro`, e respondia `409 sessão em 'erro':
não há transcrição para extrair` — numa sessão cuja `transcricao.json` estava
intacta no R2, e dez linhas abaixo do próprio docstring que diz que a rota
existe para quando "a sessão ficou em `extraindo` ou `erro`". Todo o resto já
concordava: `PERMITIDAS.erro` inclui `extraindo`, e a escrita em `pipeline.ts`
lista `erro` como origem válida. Hoje o guard é `podeReextrair`, que é
`temTranscricao` mais `erro`. As duas perguntas ficaram separadas de propósito:
`temTranscricao` é "a transcrição está pronta para eu mostrar", e é o que a tela
de leitura e a lista continuam usando; `podeReextrair` é "vale disparar a
extração". Sessão que caiu em `erro` antes de existir transcrição não vira 500 —
`extrairSessao` procura o `transcricao.json` e devolve `erro` com log próprio.

**Há duas representações desta máquina, e só uma roda.** `estados.ts` é a
**declarada**: `PERMITIDAS`, `podeIrPara` e as predicadas, verificadas por
`tests/estados.test.ts` e não importadas por nenhum caminho de produção. A que
roda é o `sePartirDe` do Cypher, escrita a escrita — e é ela que está descrita
no fim desta seção. As duas têm de contar a mesma história; quando divergirem,
quem está errada é a declarada. Unificá-las foi considerado e recusado: derivar
a guarda de `PERMITIDAS` dentro de `atualizarSessao` tiraria do ponto de uso a
resposta a "o que impede esta escrita", e poria guarda implícita em escritas que
levam dado junto do status — `pipeline.ts` grava `transcrito` com
`chunks_total` e `duracao_s` no mesmo `SET`, e uma guarda que falhasse ali
engoliria os três em silêncio.

Quatro predicadas dizem o que cada estado significa para as telas:

| Predicada | Verdadeira em | Para quê |
|---|---|---|
| `temTranscricao` | `transcrito`, `extraindo`, `em_revisao`, `confirmada` | a leitura para o polling; a extração corre atrás |
| `estaPendenteDeRevisao` | `em_revisao` | tem proposta esperando |
| `terminouDeProcessar` | `em_revisao`, `confirmada`, `erro` | a leitura para o polling |
| `estaConcluida` | `confirmada` | terminal: o grafo já recebeu o que eu aprovei |

`estaConcluida` é a única das quatro sem consumidor em `src/`: a lista de
sessões reescreve a mesma comparação à mão, em `jaRevisada`. Está aqui porque é
exportada e testada, e porque duas cópias da mesma regra divergem no primeiro
ajuste.

**`terminouDeProcessar` ganhou um segundo consumidor na 4.10**, e é a guarda do
`DELETE` de sessão (§10): apagar no meio do pipeline correria com um `waitUntil`
vivo, que voltaria a gravar o que acabou de sumir. A pergunta é a mesma — "nada
mais vai mudar sozinho aqui" — e por isso é a mesma predicada, na rota e no botão.

**`descartada_em` não é um estado, e é de propósito** (migration 008). A máquina
descreve o que a sessão está *fazendo*; descartar é gesto meu, por fora, sobre
uma sessão que já parou. Como valor de `status` obrigaria toda transição e todo
guard a conhecer um estado que não transiciona para lugar nenhum. Como
propriedade à parte, ele é lido num lugar só: o `WHERE s.descartada_em IS NULL`
de `todasSessoes`.

**A máquina de recuperação foi apagada inteira.** Com o chip da home saíram
`GET /api/sessoes/abertas` e `sessoesAbertas()`, e com eles as peças que só
existiam para alimentá-los: `STATUS_ABERTOS`, `estaAberta`, `foiAbandonada` e
`duracaoPorChunks` (`estados.ts`), `ABANDONO_MIN` (`tipos.ts`), `proximoIndice` e
`duracaoEstimadaS` (`manifest.ts`), e a opção `indiceInicial` do `Gravador`.
Nenhuma delas ficou como código morto com teste em volta: elas estão no git, e a
que voltar a ser necessária se reescreve em três linhas. O que fica no lugar é
uma marca só, na lista de sessões, e ela sai de `confirmada` — verde é sessão
revisada, branco é sessão com trabalho pendente (`jaRevisada`, seção 11).

**`abandonada` saiu da máquina junto.** Ele estava em `STATUS_SESSAO`, na tabela
de transições e nos `sePartirDe` de `/pronto`, `/finalizar` e `pipeline.ts` — mas
nenhuma escrita no grafo jamais produziu esse status: `foiAbandonada()` só
reetiquetava a resposta de `/api/sessoes/abertas` em memória, nunca o nó. Era
vocabulário sem fato, e um estado que nunca acontece só serve para o próximo
leitor tratar como caso real. **Nenhum nó do banco carrega esse valor**, pelo
mesmo motivo — não há dado a migrar, e por isso a remoção não pede migration.
Uma gravação que a aba interrompeu fica em `gravando` até `/finalizar` levá-la
adiante, que é o que já acontecia de fato.

`terminouDeProcessar` existe porque `completa` não serve para parar o polling da
leitura: `completa` é sobre a transcrição e fica verdadeiro em `transcrito`, ou
seja, antes de a extração acabar — a tela nunca veria o link para a revisão
aparecer.

A guarda real da idempotência está no Cypher: `atualizarSessao(id, mudança,
sePartirDe)` só grava se o status atual estiver na lista, então um segundo
`finalizar` não rebaixa uma sessão já `em_revisao`, e nada devolve `confirmada`
para trás.

**Guarda que não casa não estoura: devolve `null`.** A cláusula é um `WHERE`, e
não casar é resultado vazio, não exceção — o chamador segue como se tivesse
gravado. É o que faz a trava ser barata e idempotente, e é também o que faz uma
guarda errada ser invisível. Quem precisa saber se a transição aconteceu tem de
olhar o retorno; hoje ninguém precisa.

### 5.1 Onde o motivo de uma falha aparece

`erro` é um estado sem explicação — e agora ele cobre duas coisas diferentes,
falha de transcrição e falha de extração. A tela só sabe dizer que falhou e
o grafo guarda o status, não a causa — `:Sessao` não tem propriedade de erro, e
acrescentar uma é mudança de schema. **O motivo existe só no log do servidor**,
com prefixo:

| Linha | Quem escreve | Quando |
|---|---|---|
| `[stt] sessão <id> bloco <i> falhou:` | rota `/chunks/:i/pronto` | o bloco falhou ao ser transcrito na subida (ou o avanço das janelas estourou) |
| `[pipeline] sessão <id> bloco <i> não transcreveu:` | laço de espera em `finalizarSessao` | a retentativa da finalização falhou |
| `[pipeline] sessão <id>: desistiu após 150s…` | `finalizarSessao` | o prazo estourou; lista os blocos que faltaram, e diz se a causa foi rate limit |
| `[limite] <rótulo>: rate limit do Gateway — esperando Ns` | `comEsperaDeLimite` | o Gateway recusou por excesso e vai haver outra tentativa |
| `[limite] <rótulo>: sem orçamento para esperar Ns` | `comEsperaDeLimite` | o limite ainda vale, mas esperar estouraria o prazo de quem chamou |
| `[limite] <rótulo>: a chamada não voltou em Ns — cortada.` | `comEsperaDeLimite` | a quarta classe de falha (§5.3): o Gateway não respondeu dentro do prazo e **eu** cortei, antes que o `maxDuration` matasse a função |
| `[limite] <rótulo>: sem orçamento para chamar o modelo` | `comEsperaDeLimite` | o que sobrava do prazo não cabia nem a chamada; melhor não chamar do que morrer no meio dela |
| `[janela] sessão <id> janela <n> (blocos a-b): +N átomo(s)…` | `avancarJanelas` | uma janela fechou — é o `console.log` que mostra a extração acontecendo durante a gravação, e ele diz de quantas entidades era o dossiê |
| `[candidatas] sessão <id> bloco <i>:` | `/pronto` e `candidatasDaJanela` | a busca daquele bloco falhou; o dossiê fica menor e a janela roda como na 4.8 |
| `[grafias] sessão <id>: N grafia(s) viraram alias` | `/confirmar` | a grafia que eu falei virou alias do nó que eu confirmei (§4.14) |
| `[janela] sessão <id> janela <n> falhou:` | `avancarJanelas` | a janela não fechou; ela fica `falhou` no `parcial.json` e é retentada na passada seguinte |
| `[janela] sessão <id>: sem orçamento para a janela <n>` | `avancarJanelas` | o prazo do `finalizar` acabou antes de a janela do fim rodar |
| `[janela] sessão <id>: janela(s) N não fecharam…` | `propostaDaSessao` | a sessão vai para `erro` e espera eu mandar re-extrair. Era o fallback de passe único até a slice 8 (§4.18) |
| `[janela] sessão <id> janela <n>: outro worker está nela, esperando` | `esperarQuemEstaNela` | o `/finalizar` encontrou um lease vivo e está esperando quem está na janela — condição normal, não defeito |
| `[janela] sessão <id>: janela <n> presa até o fim do orçamento` | `esperarQuemEstaNela` | esperou e o lease não soltou; é daqui que a sessão cai em `erro` |
| `[stt] sessão <id> bloco <i>: já tem dono, deixando com ele` | `transcreverBloco` | a trava do bloco funcionou e o STT **não** foi pago duas vezes (§4.18) |
| `[extracao] sessão <id> falhou:` | `extrairSessao` | o modelo estourou, ou a resposta não era JSON válido |
| `[extracao] sessão <id>: sem transcricao.json…` | `extrairSessao` | pediram extração de uma sessão sem transcrição gravada |
| `[finalizar] sessão <id> falhou:` | rota `/finalizar` | `finalizarSessao` estourou uma exceção |
| `[extrair] sessão <id> falhou:` | rota `/extrair` | a re-extração manual morreu — é o log do botão "reextrair" da lista |
| `[calibracao] sessão <id>: …` | `capturarCorrecoes` | as correções daquela revisão foram (ou não foram) registradas |
| `[atomos] N átomo(s) gravados sem vetor;` | `gravarAtomos` | o confirmar gravou e o embedding falhou — `POST /api/atomos/embutir` alcança depois (§4.10) |
| `[overrides] <id>: o hash <h> não resolve texto nenhum, usando a base` | `resolver` | um prompt editado sumiu do R2; o agente cai na base **e** carimba a base (§4.13) |
| `[overrides] não consegui ler o prompt <agente>+<hash>:` | `promptPorHash` | o mesmo, um nível abaixo — o R2 recusou a leitura |
| `[medidas] sessão <id>: não consegui gravar a medida:` | `comMedicao` | o cronômetro tropeçou; a sessão segue inteira, e é só a medida daquela invocação que se perde (§4.17) |

Os cinco últimos não são falha de sessão: a sessão segue, e o que se perde é
material de calibração, um vetor, um prompt editado ou uma medida. Estão aqui
porque esta é a tabela que responde "onde aparece o motivo", e um log que ninguém
sabe que existe não é diferente de log nenhum. As três linhas de `[janela]` e a
de `[stt]` sobre o dono do bloco também não são falha: elas dizem que uma trava
**funcionou**, e é por elas que se distingue "o sistema esperou" de "o sistema
travou".

O laço de espera engolia o erro do bloco em `catch {}` — a falha ia para `erro`
sem uma linha sequer, e depois do fato não havia o que investigar.
`tests/pipeline.test.ts` fixa isso: falha de bloco sempre deixa rastro.

Log de terminal morre com a janela. Por isso `scripts/dev.ps1` também escreve
tudo em `logs/dev-<data>.log` (seção 13) — sem isso, diagnosticar uma falha
exige reproduzi-la.

### 5.2 Quando a falha é da rede, e não do sistema

Tudo que este sistema faz sai por `fetch`: Neo4j pela HTTP Query API, R2 pela
API S3, modelo pelo AI Gateway. O undici derruba a conexão que não completa o
handshake em **10 s** — o erro é `TypeError: fetch failed` com
`UND_ERR_CONNECT_TIMEOUT` no `cause`, e o pedido **nunca saiu**. Em link com
meia dúzia de saltos e jitter alto isso acontece de verdade: medido no link que
produziu o primeiro caso, o handshake frio com o R2 falhou depois de 24,8 s e as
quatro tentativas seguintes abriram em menos de 400 ms cada.

**Esses 10 s não são configuráveis.** O `fetch` do Node usa a cópia interna do
undici, e ela recusa um dispatcher vindo do pacote `undici` do npm — por símbolo
global ou pelo `init`, dá `UND_ERR_INVALID_ARG`. Aumentar o prazo exigiria
trocar a implementação de `fetch` do processo inteiro e atropelar o cache de
fetch do Next. Não faz falta: quem conserta é o retry, não o prazo maior.

`rede.ts` classifica o erro pelo código dentro do `cause` e decide se repetir é
seguro — a pergunta é sempre a mesma, "o pedido chegou a sair?":

| Classe | Códigos | Repete |
|---|---|---|
| antes do envio | `UND_ERR_CONNECT_TIMEOUT`, `ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN`, `EHOSTUNREACH`, `ENETUNREACH` | sempre — a conexão nem abriu, não há efeito para duplicar |
| depois de abrir | `ECONNRESET`, `ETIMEDOUT`, `EPIPE`, `UND_ERR_SOCKET`, `UND_ERR_HEADERS_TIMEOUT`, `UND_ERR_BODY_TIMEOUT` | só em leitura (`{ leitura: true }`) |
| erro do serviço | Cypher inválido, 404, 412 | nunca — repetir o que vai falhar de novo só faz a tela esperar mais |

É a regra inviolável 4 vista pelo outro lado: `query` do Neo4j serve escrita
também, e por isso vai sem `leitura` — só repete o que comprovadamente não saiu.
O mesmo vale para o `put` do R2, que é condicional: se o primeiro PUT chegou, o
segundo levaria 412 e viraria conflito falso no manifest. `getTexto`, `getBytes`
e `existe` são leitura pura e repetem as duas classes.

São **3 tentativas**, com o mesmo backoff da fila de upload (1 s, 2 s, com
jitter). Pior caso de uma chamada: ~33 s antes de desistir.

O caminho do modelo não passa por `rede.ts` e não precisa: o AI SDK reconhece o
`fetch failed` como `isRetryable` e já repete por conta própria (`maxRetries`
padrão 2). Quem estava descoberto era só o que fala direto com Neo4j e R2.

Quando desiste, a rota responde **502** por `erroDeInfra`, com a causa no log e
uma frase legível na tela — `fetch failed` não diz nada a quem está olhando.
Rota sem esse tratamento deixava o erro subir cru e o Next respondia **500** com
stack de undici, o que faz a rede parecer defeito do sistema:

| Linha | Quem escreve | Quando |
|---|---|---|
| `[rede] <alvo>: <código> — tentativa n/3` | `comRetry` | uma tentativa falhou e vai haver outra |
| `[sessoes] …` | `GET`/`POST /api/sessoes` | Neo4j fora |
| `[extracao] …` | `GET /api/sessoes/:id/extracao` | Neo4j ou R2 fora |
| `[entidades] …` | `GET /api/entidades` | Neo4j fora |

A outra metade do conserto é não pagar a latência quatro vezes: as quatro buscas
de `GET /api/sessoes/:id/extracao` (uma no Neo4j e três no R2 — `extracao.json`,
`transcricao.json` e `extracao-anterior.json`) são independentes e
vão em `Promise.all`. Em série, essa tela custava a soma de quatro idas à rede.

### 5.3 Quando a falha é pressa, e não defeito

Medido em 2026-09-02 (§4.2.1): o free tier do AI Gateway recusa rajada de
chamada, **na conta inteira e não por modelo**. É a terceira classe de falha
deste sistema, e a única em que o conserto é o relógio:

| Classe | Onde mora | O que fazer |
|---|---|---|
| rede | `rede.ts` | repetir já, se o pedido não saiu |
| serviço | quem chamou | subir: repetir vai falhar igual |
| **limite de taxa** | **`limite.ts`** | **esperar dezenas de segundos e repetir** |
| **a chamada que não volta** | **`limite.ts`** | **cortar dentro do orçamento e subir — nunca repetir** |

`rede.ts` não serve aqui, e juntar os dois seria erro: lá a pergunta é "o pedido
chegou a sair?", e um 429 cairia em "erro do serviço — nunca repete", que é o
oposto do certo. O pedido saiu, foi recusado inteiro, repetir não duplica nada;
o que falta é **quando**.

O erro chega embrulhado — o AI SDK já tentou três vezes por conta própria e
sobe um `RetryError` com o `GatewayRateLimitError` em `lastError`. Por isso
`ehLimiteDeTaxa` percorre a cadeia (`lastError`, `errors`, `cause`) e reconhece
pela forma, em quatro sinais: `name`, `type`, `statusCode` e, por último, a
mensagem. **Nada disso importa `@ai-sdk/gateway`** — regra inviolável 8 vale
também para o tipo do erro; `tests/limite.test.ts` é quem avisa se o SDK mudar
o embrulho.

As esperas são **20 s e 60 s**, com o jitter da fila de upload, sempre para
cima: a medição mostrou ~75 s de janela, e esperar menos que o medido é o jeito
de a espera não servir para nada. São duas e não cinco porque o teto de cima é o
`maxDuration` de 300 s da rota, e a extração ainda roda depois.

**Aquele limite era do free tier, e desde a compra de créditos ele não
reapareceu.** A medição de 02/09 é real e o desenho que ela produziu continua
certo — mas o que ela mediu foi uma **conta gratuita**, não o modelo nem o
Gateway. A consequência é de projeto, e ela é a segunda metade da slice 8:
**paralelismo deixou de ser risco e virou escolha.** Num sistema de um usuário,
requisição à toa não é custo. A escada longa fica porque custa zero enquanto o
limite não volta, e porque conta gratuita é um estado ao qual se pode voltar.

**Duas escadas desde a slice 8, e a diferença é o diagnóstico.** O módulo nasceu
de uma medição só e tratava tudo que não fosse 429 como definitivo — um 502 do
Gateway, um socket que morreu no meio, um `overloaded` do provedor derrubavam a
janela na primeira tentativa. Isso ficou caro pelo lado oposto quando o penhasco
virou erro (§4.18): falha boba de rede passou a custar a sessão. `ehTransitorio`
reconhece as três formas — código de rede dentro do `cause`, status 5xx ou 408, e
o `overloaded` que vem no corpo —, e elas levam `ESPERAS_TRANSITORIA_MS`, de 1 s
e 3 s. Os **contadores são separados**: um blip de rede no começo não gasta a
paciência que o 429 vai precisar depois. Fora das duas listas nada é repetido —
modelo inexistente, prompt que estoura o contexto e JSON inválido falham igual na
segunda vez.

Quem chama dentro de um prazo passa o seu (`ate`): `finalizarSessao` tem 150 s
para os blocos que faltam, e a janela do fim tem os 120 s de
`ORCAMENTO_JANELAS_MS`. Uma espera que não caiba nesse orçamento é pior que não
esperar — o `waitUntil` morre antes de a chamada voltar, e a falha fica sem nem
o log. **Onde não há prazo não se passa nada**, e desde a 4.8 esse caso é o que
mais importa: as janelas que fecham durante a gravação vão sem `ate`, porque ali
esperar o limite passar é de graça — eu ainda estou falando.

Os dois pontos que falam com modelo no caminho automático estão cobertos:
`stt.ts` e `extracao.ts`. A extração era a mais exposta das duas justamente por
rodar logo depois dos 30 blocos de STT, que é quando o limite está mais perto de
estourar; **a slice 4.8 desfez essa concentração** — são oito chamadas menores
espalhadas pela gravação, e sete delas sem prazo nenhum para esperar.

**A resolução entrou na lista na 4.9**, e ela é o terceiro ponto do caminho
automático. Até a 4.8 o agente 2 falhava em vez de esperar; a degradação já era
a certa (as menções voltam como dúvida e a revisão me deixa escolher, §4.8), mas
o critério declarado aqui é "quem roda em `waitUntil` espera", e ele estava do
lado errado da linha. O que tornou o conserto necessário foi a 4.9: o agente
passou a rodar em **toda** janela, oito vezes por sessão de 15 min, na mesma
rajada em que o STT já disputa o limite da conta. Ele recebe o `ate` de quem o
chamou — o mesmo da extração daquela janela.

Perfil, duplicatas e embedding **não** estão cobertos: saem de um clique meu, e
ali a falha aparece na tela em vez de matar uma sessão em `waitUntil`.

A busca por candidatas (§4.14) não precisa de espera própria: ela sai por
`candidatosSemanticos`, que engole a própria falha, e o `semantico: false` do
arquivo é o que manda o `/finalizar` refazer o bloco uma vez.

Quando a espera não basta, a linha de desistência diz isso com todas as letras —
"a causa foi rate limit do AI Gateway… chamar /finalizar de novo daqui a alguns
minutos costuma resolver" —, porque a alternativa é procurar defeito no código
onde só havia pressa. O áudio fica intacto no R2 e o retry é o mesmo de sempre.

**A quarta classe foi medida em 2026-09-18, e ela não é pressa: é silêncio.** A
sessão `mu73d88b0w4u6o5d440j` — 203 s de fala, 7 blocos — gastou **300.116 ms**
numa única chamada de extração que o Gateway nunca respondeu, e morreu no
`headersTimeout` do undici. Todo o resto daquela sessão foi rápido: STT 7,2 s
somados (pior bloco 1,8 s), catálogo 88 ms, camada semântica 513 ms, a fila do
cliente drenando em 2,7 s. **Não foi volume**: 43 entidades, 108 átomos, uma
janela de dois minutos de fala, e o Gateway não devolveu um token sequer de uso.

O que torna isso estrutural, e não azar: **o `headersTimeout` do undici é 300 s,
que é exatamente o `maxDuration` da rota.** Quando ele dispara não sobra
orçamento nenhum para o `catch` gravar a falha, marcar a sessão como `erro` ou
cair em outro caminho — a função é morta no meio e a sessão fica presa em
`extraindo` **para sempre**, com a tela batendo. Foi o que aconteceu: quem
estourou primeiro (o `/pronto` do bloco 3, começado às 15:08:42) alcançou o
`catch` e deixou `parcial.json` e a medida; o `/finalizar`, começado às 15:10:06,
foi morto antes do seu. E **sem streaming em lugar nenhum** do sistema, o Gateway
só manda headers quando a geração inteira acaba — então aquele teto é, na
prática, "tempo total de geração", e um modelo que pensa demais é indistinguível
de um Gateway pendurado.

**O conserto é o prazo por chamada, e ele mora onde já mora o orçamento.**
`comEsperaDeLimite` passou a entregar um `AbortSignal` a quem ela embrulha, e as
quatro chamadas do caminho automático o repassam ao `generateText`/`transcribe`
(`stt.ts`, `extracao.ts`, `resolucao.ts`, `desempate.ts`); `embedding.ts` leva o
mesmo teto direto, sem a escada, porque quem o chama já engole a falha.

| | Prazo da chamada |
|---|---|
| quem passa `ate` | o que sobra do orçamento, menos `FOLGA_PARA_GRAVAR_MS` (5 s) |
| quem não passa (`/pronto`) | `TETO_CHAMADA_MS`, 90 s |

Os 90 s são aritmética de orçamento, não gosto: ficam abaixo dos 120 s de
`ORCAMENTO_JANELAS_MS`, então na janela do fim quem manda continua sendo o
orçamento de quem chamou; e no `/pronto` deixam a corrente daquela passada — STT,
extração, resolução, os desempates em paralelo — caber nos 300 s. A folga de 5 s
existe porque prazo que termina junto com o orçamento é o mesmo defeito outra
vez, só que menor: quando a chamada é cortada ainda falta escrever
`parcial.json`, o objeto de medidas e o estado da sessão, e os três são laços por
etag.

**O sinal é passado, e não uma corrida por fora**, porque cortar o socket é o que
faz a chamada *terminar* — e chamada que termina é chamada que `medirAgente`
consegue contar. Corrida por fora deixaria a promessa pendurada e o custo dela
fora do registro, justamente no caso que a slice 8 existe para medir.

**E o corte não é transitório.** `PrazoDeChamadaError` sobe na primeira, como o
modelo inexistente e o JSON inválido, e `ehTransitorio` o recusa na primeira
linha. Sem essa amarra o conserto viraria o defeito: `UND_ERR_HEADERS_TIMEOUT`
está em `DEPOIS_DE_ABRIR` (`rede.ts`), então uma chamada pendurada seria lida
como blip de rede e ganharia a escada curta — três chamadas de 90 s onde havia
uma, num `waitUntil` que morre aos 300 s. Vindo de fora, sem ter sido eu a
cortar, o mesmo código continua sendo transitório.

**Orçamento que não cabe a chamada não vira chamada.** Antes o modelo era chamado
assim mesmo e o `waitUntil` morria no meio dele, sem deixar sequer o log; agora
sobe `PrazoDeChamadaError` com `prazo_ms: 0` e quem chamou tem tempo de gravar.

### 5.4 Quando não há o que transcrever

Há uma quarta classe, e ela não é falha nenhuma: **o bloco em que ninguém fala.**
Trinta segundos de silêncio existem em toda sessão real — eu paro para pensar, o
arquivo importado tem uma pausa longa. O provedor não devolve texto, e o AI SDK
levanta `AI_NoTranscriptGeneratedError`.

Até 09/09 isso derrubava a **sessão inteira**. O erro é determinístico: o laço de
`finalizarSessao` insistia no mesmo bloco mudo pelos 150 s de `ESPERA_MAX_MS`,
sempre com a mesma resposta, e depois mandava tudo para `erro`. Medido na sessão
`mtu336r50a5i4j3k2o1g`: 9 blocos, 7 com fala, os blocos 4 e 8 com RMS de 0,004
contra 0,11 dos outros. Quatro minutos e meio de diário perdidos por duas pausas
minhas — e o diagnóstico custou baixar os WAV do R2 e medir, porque o log dizia
"não transcreveu" para silêncio e para defeito com as mesmas palavras.

`ehSemTranscricao` (`stt.ts`) reconhece esse erro e devolve **bloco vazio**:
texto `""`, nenhuma palavra. O bloco é gravado, o manifest anda, a sessão segue.
A concatenação já sabia lidar com ele — `juntarTexto` descarta texto vazio e o
bloco não contribui palavra nenhuma —, e a janela de extração cujo texto sai
vazio devolve lista vazia em vez de chamar o modelo (§4.6). Só a sessão **inteira**
vazia continua estourando, que é o comportamento que `extrair` sempre teve.

Reconhecido pelo `isInstance` do próprio SDK, com o `name` como segunda via para
o erro que atravessou serialização — a mesma prudência de `ehLimiteDeTaxa`. `ai`
não é pacote de provedor: a regra inviolável 8 continua de pé.

**O que se perde:** um tropeço do provedor que devolva nada tem exatamente a
mesma cara que silêncio, e agora vira bloco vazio em silêncio em vez de erro
barulhento. A troca foi feita de olho aberto — o outro lado dela era perder a
sessão inteira toda vez que eu faço uma pausa —, e o sinal é a linha
`[pipeline] … STT não ouviu fala — bloco vazio`, que sai em todo bloco vazio.
Transcrição com um buraco se confere ali, contra o áudio, que está intacto no R2.

## 6. Idempotência

Regra inviolável 4: todo passo é chaveado por `sessao_id` (+ `chunk_index`).
Eram três travas na slice 1 — o bloco, a proposta e o manifest; a tabela cresceu
com cada fatia, e hoje são estas:

| Trava | Onde | Efeito |
|---|---|---|
| `chunk_NNN.json` existir | `pipeline.transcreverBloco` | não rechama o STT nem sobrescreve resultado pronto — mas só **depois** de a transcrição voltar |
| lease `transcrevendo_em` com prazo (`LEASE_BLOCO_MS`, 120 s) | `manifest.reivindicarBloco` | fecha a janela que a trava de cima não cobre: entre o pedido e a resposta do STT, dois workers mandavam o mesmo áudio (slice 8, §4.18) |
| janela `pronta` no `parcial.json` | `janela.reivindicar` | janela fechada não é reextraída nem repaga, por mais vezes que `/pronto` chame |
| lease `em_curso` com prazo (`LEASE_MS`, 120 s) | `janela.reivindicar` | dois `waitUntil` não extraem a mesma janela; worker morto libera a janela em vez de travá-la |
| `If-Match` + laço de retry no `parcial.json` | `janela.atualizarParcial` | duas janelas concorrentes se somam em vez de se sobrescrever |
| o `id` do átomo é carimbado **na escrita**, não na extração | `janela.aplicarJanela` | duas janelas nunca produzem o mesmo `<sessao_id>-<índice>` — que é o que faz o `MERGE` do confirmar ser idempotente |
| `candidatas_NNN.json` existir | `recuperacao.recuperarCandidatas` | bloco já consultado não é reconsultado nem repago, por mais vezes que `/pronto` e `/finalizar` passem por ele |
| `semantico: false` + `refeito` | catch-up do `/finalizar` | a camada de vetor que caiu é refeita **uma** vez, não a cada passada |
| a checagem prévia da grafia, e o `WHERE NOT … IN` do `SET` | `fusao.registrarGrafia` | confirmar duas vezes não acrescenta a mesma grafia duas vezes a `aliases` |
| `extracao.json` existir | `pipeline.extrairSessao` | não rechama o modelo nem sobrescreve proposta que eu já posso ter revisado |
| `If-None-Match: *` no PUT da proposta | `pipeline.extrairSessao` | dois workers na mesma sessão geram uma proposta só: quem chega em segundo usa a do primeiro |
| entrada no manifest por `i` | `manifest.registrarChunk` | reenviar o mesmo bloco não duplica nem reabre bloco transcrito |
| `id` do átomo = `<sessao_id>-<índice>` | `atomos.gravarAtomos` (`MERGE`) | confirmar duas vezes não duplica átomo |
| `nome_normalizado` único (constraint) | `atomos.gravarEntidades` (`MERGE`) | duas menções à mesma pessoa viram um nó, mesmo em corrida |
| `campo` **dentro** do `MERGE` de `:PERFILA` | `atomos.gravarAtomos` | reconfirmar não dobra a aresta de perfil: a identidade dela é (átomo, campo, entidade) |
| o rascunho de perfil não escreve | `perfil.rascunhar` | pedir o rascunho dez vezes não muda o grafo; só `POST /api/entidades/perfil` grava |
| status na cláusula `WHERE` | `sessoes.atualizarSessao` | transição já feita não volta atrás; confirmar duas vezes não reprocessa |
| `embedding IS NULL` ou modelo diferente | `atomos.embutirAtomos` e `atomosSemVetor` | reconfirmar não reembute o que já tem vetor; rodar o retrofill duas vezes não gasta duas vezes |
| `embedding_fonte` bater | `entidades.garantirEmbeddings` | entidade em dia não é reembutida — e por isso não há gancho a esquecer em nenhuma das oito rotas de entidade |
| `CREATE VECTOR INDEX … IF NOT EXISTS` | migration 006 | reaplicar a migration é no-op |
| `If-None-Match: *` em `correcoes.json` | `calibracao.capturarCorrecoes` | reenviar o confirmar não sobrescreve o registro permanente da revisão |
| `If-Match` + laço de retry no índice | `calibracao.atualizarIndice` | duas capturas concorrentes se somam; quem perde a corrida relê e reaplica |
| `Correcao.id` condicional ao tipo | `correcoes.apurarCorrecoes` | correção de átomo, de entidade e "faltou" nunca colidem entre si |
| id que já está no índice não é reaberto | `correcoes.juntarNoIndice` | reapurar não devolve `incorporada_em` para `null` |
| `prompt-<agente>-<hash>.json` imutável, com `If-None-Match` | `overrides.gravarVersaoDePrompt` | reaprovar o mesmo texto não cria versão nova: o hash sai do conteúdo |
| o rascunho de padrão não escreve | `calibracao.rascunharPadroes` | pedir dez rascunhos não muda prompt nenhum |
| a redação não escreve prompt | `redacao.redigir` | ela grava a **pauta** e devolve edições; só `POST /api/calibracao/aprovar` toca o prompt |
| a emenda é aplicada no servidor, das edições | `redacao.aplicarEdicoes` | o corpo do aprovar nunca traz o texto final, então não há segunda implementação para divergir |

A trava de `extracao.json` vale para **os dois agentes**: proposta pronta não
rechama nem a extração nem a resolução, e `forcar` refaz as duas. Calibrar o
`resolucao-5` custa, sim, uma extração junto — o que a arquitetura de dois
agentes barateia é o contrário: mexer no `resolucao-5` não mexe no `extracao-9`.

**A única saída da trava é `extrairSessao(id, { forcar: true })`**, exposta por
`POST /api/sessoes/:id/extrair` com `{"forcar": true}`. Ela existe para calibrar
o prompt: sem ela, cada versão nova exigiria gravar áudio novo, porque a proposta
existente bloqueia o reprocessamento. Forçado sobrescreve — inclusive proposta já
revisada — e por isso vai sem `If-None-Match`. O caminho automático nunca força.

`finalizar` numa sessão `em_revisao` ou `confirmada` devolve
`{ ja_finalizada: true }` sem reprocessar (aceite 9). Numa sessão que já
transcreveu mas ainda não extraiu, a segunda chamada **é** o retry da extração —
é por ela que se recupera um `waitUntil` que morreu no meio.

### 6.1 Concorrência no manifest

Vários `/pronto` podem chegar ao mesmo tempo. `atualizarManifest` faz
read-modify-write condicional: lê o objeto com o etag, aplica um mutador **puro e
idempotente**, grava com `If-Match` (ou `If-None-Match: *` na primeira vez). Em
412/409 (`ConflitoR2Error`) relê e reaplica, com backoff, até 10 tentativas
(subiu de 6 na importação, slice 4.10 — ver abaixo), teto de 2 s por espera.

**O laço mora em `etag.ts` desde a slice 8, e é um só.** Ele estava copiado três
vezes — manifest, `parcial.json` e `calibracao/indice.json` —, com a dívida
declarada no docstring de `atualizarParcial` ("extrair um helper é refatoração
fora do escopo desta fatia"); a quarta cópia seria a das medidas, e quatro é onde
uma correção passa a alcançar só três. Cada chamador
continua trazendo o que é dele: a curva de espera (os números do manifest são os
únicos diferentes, e o porquê está logo abaixo), o `normalizar` que materializa o
objeto ausente ou conserta o formato antigo, e o mutador. O que o laço devolve a
mais é `mudou` — "a escrita foi minha?" —, e é isso que faz a reivindicação de
uma janela ser uma trava de verdade em vez de uma esperança.

**Módulo próprio e não uma função em `r2.ts`**, por um motivo estrutural de
teste: meia dúzia de arquivos de `tests/` troca `@/lib/r2` inteiro por uma
fábrica com `getJson`/`putJson` mockados, e um laço morando lá obrigaria cada
fábrica dessas a fornecê-lo também. Daqui ele **consome** o `r2.ts` mockado.
`tests/etag.test.ts` cobre as duas escritas que se somam, o conflito reaplicado,
o `null` que não grava e o teto da espera.

**A importação multiplica quem escreve o manifest ao mesmo tempo.** Um bloco cujo
STT tropeça no rate limit do Gateway fica preso em `comEsperaDeLimite` por até
60 s (`limite.ts`) antes de `marcarTranscrito` gravar. Na gravação ao vivo isso
não se acumula — os blocos chegam a cada 30 s de fala real. Na importação,
`BLOCOS_SIMULTANEOS` sobe dois blocos por vez sem pausa nenhuma; se o rate limit
pegar vários blocos seguidos, as esperas deles terminam perto umas das outras, e
o `marcarTranscrito` de todos colide com o `registrarChunk` dos blocos novos que
continuam chegando. Com 6 tentativas e teto de ~1,3 s essa rajada esgotava o
laço e a exceção subia crua da rota `pronto` — 500 sem causa nenhuma na tela,
só `${url} respondeu 500` no cliente (`Importacao.tsx`). Dez tentativas com teto
de 2 s absorvem a rajada sem transformar isso numa espera visível de dezenas de
segundos.

**A rota `pronto` também passou a responder 502 legível, não 500 cru.** Faltava
o mesmo tratamento que `sessoes/route.ts` e companhia já tinham (§5.2):
`existe`, `atualizarManifest` e `atualizarSessao` agora estão dentro de um
`try/catch` que devolve `erroDeInfra` — o que sobrar do laço acima, ou qualquer
outro tropeço de R2/Neo4j síncrono, aparece com a causa no log e uma frase na
tela em vez de um 500 mudo. O `waitUntil` de STT/janelas continua fora do
`try`: falhar ali não pode derrubar a resposta que já foi decidida.

Duas exigências de transporte do R2 sustentam isso, ambas dentro de `put()` em
`r2.ts`, ambas descobertas quebrando na primeira gravação real (2026-08-24):

- **`Content-Length` sempre explícito.** O undici o deduz de corpo em texto, mas
  essa dedução se perde quando o corpo chega como stream — que é o que acontece
  no caminho do `waitUntil`, depois da resposta já enviada. Sem o header a
  requisição sai *chunked* e o R2 responde **411 MissingContentLength**. Por isso
  `put()` codifica o corpo uma vez e manda o tamanho em bytes, nunca em
  caracteres.
- **`If-Match` só com validador forte.** O R2 comprime a resposta de GET de
  objeto compressível — o manifest é um — e nesse caso devolve o etag como
  `W/"…"`. O digest é o mesmo; só o prefixo sobra. Repassado cru, o R2 compara
  estrito e recusa com **412 em toda gravação**, esgotando as 6 tentativas.
  `etagForte()` remove o `W/` antes de assinar.

O primeiro erro mascarava o segundo: o 411 estourava antes de o laço de retry
chegar a exercitar o `If-Match`. `tests/r2.test.ts` cobre os dois.

### 6.2 Gravação interrompida

**Retomar não existe mais.** Havia um chip na home que oferecia "retomar" e
"revisar" no mesmo cartão; ele saiu para tirar a cobrança da tela de gravar
(visão §6), e o "retomar" foi junto — era o único lugar de onde podia ser
chamado, porque precisa do microfone e do `Gravador`. Todo o maquinário dele foi
apagado com ele (§5): `proximoIndice`, `foiAbandonada`, `ABANDONO_MIN`,
`indiceInicial`. Uma gravação nova sempre começa em `chunk_000` de uma sessão
nova.

**Fala não se perde por isso.** Os blocos que já subiram estão no R2, e a sessão
interrompida continua na lista de sessões levando a `/sessao/:id`, onde
`Processando` finaliza e transcreve o que existe. O que se perde é emendar fala
nova na mesma sessão — está no §14 como limite.

## 7. Fronteira de segurança

- **Auth:** magic link com um único e-mail permitido (`ALLOWED_EMAIL`). Token é
  `escopo.exp.HMAC-SHA256`, assinado com `AUTH_SECRET` via WebCrypto; comparação
  em tempo constante. Link vale 15 min, cookie de sessão 90 dias, `httpOnly` +
  `sameSite=lax` + `secure` em produção. Sem signup, sem roles, sem reset.
- **A janela de 90 dias desliza.** `precisaRenovar` (`auth.ts`) responde se sobra
  menos de um terço da vida do token, e o middleware emite cookie novo quando
  sobra. Dispositivo em uso regular não cai nunca; largado por 90 dias, cai. Sem
  isto o prazo era fixo e o ritual morria quatro vezes por ano por relógio, e não
  por decisão — que é exatamente o atrito que a tela de gravar existe para não
  ter. Renovar por limiar, e não a cada requisição, evita um `Set-Cookie` em cada
  asset. A renovação **não reconfere a assinatura**: quem chama é o middleware,
  uma linha depois de `tokenValido` ter conferido.
- **A entrega do magic link é o Resend** (`api/auth/link/route.ts`), por `fetch` e
  sem SDK — o projeto já fala com o Neo4j e com o R2 assim, e não ganha uma sexta
  dependência de runtime por um POST. Sem domínio verificado o Resend **só entrega
  ao dono da conta**, que tem de ser o mesmo endereço do `ALLOWED_EMAIL`: a
  restrição do provedor e a regra do app coincidem hoje, e isso é conveniência, não
  garantia — verificar um domínio um dia solta a primeira sem soltar a segunda. A
  resposta da rota é **idêntica nos três caminhos** em produção (e-mail errado,
  entrega feita, entrega falhada): dizer na tela que a entrega falhou responderia,
  a quem perguntasse, qual é o e-mail certo, porque só o endereço permitido chega a
  ter entrega para falhar. Falha vira linha de log, e o link continua saindo no
  `console.log` — que é por onde se recupera com o provedor fora.
- **Middleware** é a porta única, e desde o deploy ela reconhece **duas**
  credenciais. No corpo dele só `/entrar` e `/api/auth/*` passam sem nenhuma.
  Requisição a `/api/*` sem credencial recebe 401; navegação vai para `/entrar`.
  A segunda credencial é o header `Authorization: Bearer $CRON_SECRET` que a
  Vercel manda na batida diária, e ela vale **só sob `/api/cron/`** — credencial
  de máquina não abre o app. Mora no middleware, e não numa exceção do `matcher`,
  justamente para a resposta de "o que entra sem cookie" continuar cabendo num
  lugar só. `CRON_SECRET` é lido por `req()` e só quando há header para conferir:
  requisição normal nunca toca nessa linha, e nome de variável errado vira erro
  claro no log em vez de um 401 calado todo dia às 6 da manhã.
- Antes do corpo há o `matcher`, e ele decide onde o middleware **nem roda**:
  `_next/static`, `_next/image`, `favicon.ico`, `manifest.webmanifest`,
  `sw.js`, `icone.svg` e tudo que começa com `icone-` (os quatro PNG). Todos os
  do PWA são exigência do navegador, que busca manifest, ícone e service worker
  **sem** cookie de app; os três primeiros são estático de build. A resposta
  completa de "o que responde sem credencial" é a soma dos dois lugares.
- **Nenhuma chave de servidor chega ao cliente** (regra 3): `src/lib/env.ts` só
  roda no servidor e nenhum segredo usa `NEXT_PUBLIC_`. O navegador recebe
  apenas URLs presigned de 5 minutos, uma por bloco.
- **Bucket privado**, sem acesso público. CORS (`config/r2-cors.json`) é
  obrigatório: sem ele o preflight barra o PUT e nada sobe — e a tela não mostra
  erro, porque a mecânica de upload é invisível.
- `idValido()` aceita só o formato que este sistema gera (`^[0-9a-z]{8,40}$`),
  barrando path traversal nas chaves do R2.
- **O áudio também não passa por function na volta** (regra 1): a rota
  `/chunks/:i/audio` assina um GET presigned de 5 min e o navegador busca os
  bytes direto no R2. A rota confere que a chave existe antes de assinar — URL
  para objeto inexistente faria o `<audio>` falhar calado.
- **O confirmar não aceita procedência do cliente** (4.7): offsets, âncoras,
  `prompt_version` e `modelo` são relidos do R2.
- **A fila de enriquecimento chama a si mesma com o meu cookie** (4.12): cada elo
  repassa o `cookie` da requisição que o originou, e o middleware o valida como
  qualquer outra. Nenhuma porta nova, nenhum token de serviço, nenhuma exceção no
  `matcher`. O custo é que cookie expirado no meio de uma fila longa para o
  encadeamento — declarado no §14, e o conserto é apertar o botão de novo.

## 8. Neo4j

Acesso pela **HTTP Query API**, nunca pelo driver Bolt: serverless não sustenta
pool de conexões. `NEO4J_QUERY_URL` é o endpoint completo
(`https://<id>.databases.neo4j.io/db/<banco>/query/v2`). O `<banco>` **não é
necessariamente `neo4j`**: nesta instância Aura ele é o próprio id da instância,
o valor de `NEO4J_DATABASE` no arquivo de credenciais. Errar esse segmento dá
`Database does not exist` no `pnpm migrate`. `query()` traduz o par
`fields`/`values` da resposta em objetos e transforma `errors[0]` em
`Neo4jError`.

Quatro módulos escrevem em nó de conteúdo, e a divisão importa:

| Módulo | Escreve | Quem chama |
|---|---|---|
| `atomos.ts` | `:Atomo`, `:Entidade` e `:PERFILA` | **só o confirmar** — nenhum átomo entra antes da revisão (regra 5) |
| `fusao.ts` | `:Entidade` — funde, renomeia, troca tipo, cria, escreve `resumo`, edita `aliases`, marca `canonico` | as rotas de `/entidades`, com um toque meu em cada uma — e `registrarGrafia`, que o confirmar chama sozinho (§4.14) |
| `perfil.ts` | `:Entidade` — os três campos de perfil (8.3) | só `POST /api/entidades/perfil`, com um toque meu |
| `entidades.ts` | `:Entidade` — `embedding`, `embedding_modelo` e `embedding_fonte` (8.4) | `passadaDeVetores()` em `waitUntil`, no confirmar e nas oito rotas de `/entidades`, mais `POST /api/entidades/embutir` para o retrofill; o módulo que lê o catálogo é o mesmo que põe o vetor em dia |

`entidades.ts` está na lista porque escrever vetor é escrever no grafo, mesmo
que o que ele escreva seja derivável do texto a qualquer momento. Ele é a
exceção da regra de cima e a confirma: é o único dos quatro que grava sem um
toque meu, e é o único cujo dado se refaz sozinho na passada seguinte.

A regra 5 é sobre o **pipeline** não gravar sozinho. `fusao.ts` é o contrário
disso: é eu corrigindo à mão o que o pipeline deixou torto. A resolução de
entidade (4.6) continua só lendo. Labels que o código escreve:

```
(:Sessao { id, iniciada_em, duracao_s, status, audio_key,
           transcricao_key, chunks_total, descartada_em })          (008)
```

`:Sessao` é infraestrutura de gravação, não conteúdo: gravar o nó sem
confirmação não conflita com a regra 5 (nada entra no grafo sem aprovação) —
essa regra vale para átomo e entidade.

`descartada_em` (migration 008) é ISO, e **ausente é o caso normal**: toda sessão
de antes da 4.10 passa no `IS NULL` de `todasSessoes` sem migração de dado
nenhuma. Ele é o único efeito do `DELETE` de sessão sobre o grafo — os átomos e o
`:GEROU` ficam onde estavam (regra 6, §10).

### 8.1 Schema da slice 2, aplicado e em uso

A migration `002_atomo_entidade.cypher` já rodou: `:Atomo` e `:Entidade` têm
constraint e índice no Aura, e o grafo já recebeu conteúdo de sessões reais —
átomos com as duas listas de offsets, `ancoras`, `status`, `prompt_version` e
`modelo`, ligados por `:GEROU`, `:SOBRE` e `:MENCIONA`. O `MERGE` com label
literal por tipo, a constraint de `nome_normalizado` e as listas paralelas como
float foram conferidos contra o Aura, não só contra o banco mockado. Quem escreve neles é o confirmar da revisão, por
`atomos.ts`; `entidades.ts` só lê, por `nome_normalizado`.

Neo4j não aceita label vindo de parâmetro e o projeto não usa APOC, então
`gravarEntidades` roda **uma consulta por tipo**, com o label literal na string.
É seguro porque o valor sai de `TIPOS_ENTIDADE`, constante fechada, e nunca do
cliente.

Depois das migrations 003 e 007 o contrato de `:Atomo` é:

```
(:Atomo { id, texto, tipo, inicios_s, fins_s, ancoras,
          criado_em, valido_em, status, prompt_version, modelo })

tipo ∈ FATO | OPINIAO | SENTIMENTO | APRENDIZADO | CONQUISTA | DECISAO
     | HISTORIA | ROTINA
```

`HISTORIA` entrou na 007, e é o contrário dos outros sete: eles pedem a
afirmação destilada, ela pede o episódio com o detalhe que foi contado (§4.6).
Ela entra também em `TIPOS_SEMPRE_EU` (`tipos.ts`), junto com `SENTIMENTO`,
`APRENDIZADO` e `ROTINA`. **Nenhum átomo muda de tipo**: o que o `extracao-7`
colapsou em `FATO` continua `FATO`, e o `prompt_version` carimbado é o que diz
por quê.

`inicios_s`/`fins_s`/`ancoras` são listas paralelas, uma entrada por âncora —
Neo4j não guarda array de mapa como propriedade. A proposta no R2 guarda a forma
rica (`trechos: [{texto, inicio_s, fim_s, ancora}]`); o achatamento acontece no
confirmar. A 003 **não tem statement nenhum**: nada do que ela muda é declarável
no Aura Free, então ela documenta o contrato e o código o garante.

| Constraint | Alcance |
|---|---|
| `atomo_id` | id determinístico `<sessao_id>-<índice>` — é ele que faz o `MERGE` do confirmar ser idempotente |
| `entidade_id` | |
| `entidade_nome_normalizado` | único entre **todas** as entidades: `:Pessoa`, `:Projeto`, `:Objetivo` e `:Organizacao` carregam `:Entidade`, então um projeto e uma pessoa não podem ter o mesmo nome. Deliberado — é a trava que impede duplicata em corrida, ao custo de recusar colisão legítima de nome entre tipos |

`:Organizacao` entrou na 007 e não trouxe constraint nem índice novo: as duas
constraints acima são por `:Entidade`, e valem para os quatro labels de uma vez.
A migration é um no-op, como a 003 e a 005 — label passa a existir quando o
primeiro nó o recebe, no confirmar. **Nada é reclassificado para trás**: a
empresa que já está no grafo como `:Pessoa` continua `:Pessoa` até eu trocar o
tipo à mão em `/entidades` (§8.2), e reclassificar em massa exigiria adivinhar
quais nós são empresas.

Índices em `:Atomo(status)`, `:Atomo(tipo)` e `:Atomo(valido_em)`.

Constraint de existência de propriedade (`IS NOT NULL`) não existe aqui: é
recurso Enterprise e o Aura Free recusa. `prompt_version` e `modelo`
obrigatórios em todo átomo (regra 7) são garantidos por código e teste, não pelo
banco.

Tipo de relação não se declara em Neo4j — `:GEROU`, `:SOBRE` e `:MENCIONA` só
passam a existir com a primeira aresta. Ficam registrados em comentário no topo
da migration, que é a definição canônica do schema.

**Mudança de schema = nova migration numerada**, proposta e aprovada antes de
rodar. `db/migrations/` é a definição canônica; `scripts/migrate.ts` aplica os
arquivos em ordem pela Query API. Nunca alterar schema direto no código ou no
console do Aura.

### 8.2 Higiene: fundir é criar alias (migration 004)

Duas grafias da mesma coisa entram como dois nós — a constraint de
`nome_normalizado` impede duplicata da **mesma** grafia, não de grafias
parecidas: "Exxmed" e "Exx Med" normalizam para chaves diferentes.

```
(:Entidade { …, status, aliases })       status ∈ 'ativa' | 'fundida'
                                         aliases: lista de grafias (009)
(:Entidade)-[:FUNDIDA_EM]->(:Entidade)   fusão de duas entidades reais
(:Entidade)-[:DISTINTA_DE]->(:Entidade)  recusa minha: não propor de novo
```

**Desde a 4.11 são dois mecanismos, e não um.** Grafia (o que o STT errou, o
nome antigo de um renome, o que eu escrevo à mão) mora em `e.aliases`, uma lista
de strings no próprio nó; `:FUNDIDA_EM` ficou significando uma coisa só — fusão
de duas entidades reais, que é o registro de uma decisão minha. Até a migration
009 as duas coisas tinham a **mesma forma** no grafo e nenhuma consulta as
distinguia. Ver "grafia deixou de ser nó", abaixo.

**Fundir não apaga** (regra 6). O perdedor fica com `status = 'fundida'` e uma
aresta `:FUNDIDA_EM`; as **três** arestas que apontam para entidade — `:SOBRE`,
`:MENCIONA` e `:PERFILA` — migram por `MERGE`, uma consulta por tipo: Neo4j não
aceita tipo de relação vindo de parâmetro, e repetir a linha é bem menos frágil
que uma subquery com `UNION`.

`:PERFILA` migra **fora do laço** das outras duas, e é a única que precisa
disso: ela carrega `campo` (migration 005), então o `MERGE` do destino tem de
casar o par (átomo, campo), que é a identidade da aresta. Generalizar o laço
para propriedade custaria mais que repetir a consulta uma vez.

O ponto do desenho: **como o perdedor mantém o `nome_normalizado`, a grafia
morta nunca renasce como nó novo.** Dita outra vez, ela casa com o alias e a
leitura segue até o vencedor. A fusão é o mecanismo de alias, não um efeito
colateral dele — e é o que faz ela valer para amanhã, não só arrumar o ontem.

#### A cadeia: fundir o vencedor leva os aliases dele junto (4.8.1)

**Todas as travessias de `:FUNDIDA_EM` do projeto são de um salto** — dez
lugares, em `atomos.ts`, `entidades.ts`, `perfil.ts` e `fusao.ts`. Isso está
certo e fica: fusão é rara e é escrita; leitura é quente e inclui duas consultas
de índice vetorial por janela, e pagar expansão de comprimento variável
(`-[:FUNDIDA_EM*1..]->`) em dez leituras para consertar um caso de escrita é o
lado errado da conta.

O preço é uma consulta a mais em `fundir()`, antes de marcar a perdedora: os
aliases que apontavam para ela passam a apontar para o vencedor novo.

```
MATCH (x:Entidade)-[r:FUNDIDA_EM]->(p:Entidade { nome_normalizado: $perdedora })
MATCH (v:Entidade { nome_normalizado: $vencedora })
MERGE (x)-[:FUNDIDA_EM]->(v)
DELETE r
```

Sem ela, `rapha2 → rapha` seguido de `rapha → raphael` deixava `rapha2`
pendurada num nó fundido. O efeito é silencioso e irreversível: a chave `rapha2`
sai de `chaves` no catálogo, e dita de novo numa sessão nova o `MERGE` do
confirmar reencontra o nó morto — a constraint da 002 impede o segundo — e
pendura o `:SOBRE` em **`rapha`**, que nenhuma listagem mostra e que a camada dos
vizinhos descarta. `MERGE` + `DELETE` como o resto: refazer a fusão cura, que é o
contrato que o §14 declara para ela não ser atômica.

**E `fundir` recusa vencedora com `status = 'fundida'`.** Até a 4.8 só a
perdedora era conferida, e fundir **para dentro** de um alias corrompe do mesmo
jeito.

#### Grafia deixou de ser nó (migration 009, slice 4.11)

A grafia falada é registrada automaticamente no confirmar desde a 4.9
(`registrarGrafia`, §4.14): eu disse "Jean", confirmei "Giampaolo Lepore", e na
sessão seguinte "jean" casa por grafia exata, sem depender da busca. Até a 4.10
ela virava um **nó** `:Entidade` com `status = 'fundida'` e uma `:FUNDIDA_EM`
para o vencedor.

**O problema não era o efeito, era a forma.** O grafo passou a ter duas espécies
de nó fundido idênticas entre si — a grafia que o STT errou, criada sozinha, e o
perdedor de uma fusão que eu mandei fazer, com arestas migradas — e nenhuma
consulta as distinguia. `/entidades` mostrava as duas como "histórico do nome", a
lista não era editável, e eu não conseguia ensinar uma grafia **antes** de o STT
errar pela primeira vez, que é justamente quando ele mais erra.

A migration 009 converteu as primeiras em itens de `aliases` do vencedor
terminal da cadeia e apagou os nós. **O discriminador é o label**, e não a
contagem de átomos: nó de grafia nasce só com `:Entidade`, entidade real ganha o
label do tipo no `ON CREATE` — e o perdedor de uma fusão real também fica com
zero átomo, porque `fundir()` migra as três arestas.

Depois disso:

| Escrita | O que ela faz |
|---|---|
| `registrarGrafia` (confirmar) | `SET v.aliases = coalesce(v.aliases, []) + $falada` |
| `renomear` | o nó assume o nome novo; o antigo entra em `aliases` |
| `fundir` | inalterada: nó perdedor, `status = 'fundida'`, `:FUNDIDA_EM`, arestas migradas |

As quatro recusas de `registrarGrafia` continuam de pé — grafia vazia, pronome
ou igual à chave do nó; nó alvo inexistente ou ele mesmo fundido; grafia que já é
entidade **ativa**; grafia que já é alias de outro nó. A quarta é a que mudou de
mecanismo: até a 009 o índice único de `nome_normalizado` era a trava, porque a
grafia era nó. String dentro de array o banco não recusa, então a trava passou a
ser uma leitura do catálogo, em memória — a mesma decisão que `acharPorChave` já
tomava. Pela mesma razão, `criarEntidade` e o conflito de `renomear` também
conferem a propriedade: sem isso eu semearia "Jean" como pessoa nova enquanto
"Jean" é grafia do Giampaolo, e o casamento exato passaria a ter dois donos para
a mesma chave.

Quem lê as grafias, e de onde:

| Onde | Fonte | Por quê |
|---|---|---|
| `listarEntidades` | `e.aliases` **∪** `alias.nome` | monta `chaves`; é o que faz o casamento exato atravessar a grafia sem consulta a mais |
| `garantirEmbeddings` | as duas, unidas em Cypher | a grafia entra na string canônica, então acrescentá-la muda o hash e a entidade se reembute sozinha |
| `buscarConhecidas` / `resolver` | `chaves` | "Exx Med" numa sessão nova volta como conhecida, com o nome do vencedor |
| `gravarAtomos` e `fundir` (`:SOBRE`, `:MENCIONA`, `:PERFILA`) | `:FUNDIDA_EM` | fusão real continua sendo nó, e a travessia continua igual |
| `nomesParaVocabulario` | **só `e.nome`** | mandar a grafia rejeitada ensinaria o STT a reproduzi-la — e isso deixou de ser consequência do filtro de status para ser escolha escrita na consulta |

Depois da travessia dois nomes distintos podem virar o mesmo nó, e `:SOBRE` +
`:MENCIONA` para a mesma entidade não é contrato válido — a menção redundante é
descartada, o sujeito vence.

O que a 009 apaga não tem átomo, não tem perfil e não tem label de tipo. **Um
`:DISTINTA_DE` apontando para um nó de grafia ia junto no `DETACH DELETE`** — no
grafo em que ela rodou não havia nenhum, e a recusa contra uma *grafia* (e não
contra uma entidade) não se sustenta depois que a grafia deixa de ser nó.

**O tipo também se conserta.** Ele só era editável enquanto a entidade era
`nova`, na primeira revisão em que aparecia; depois disso ela vira `conhecida`,
a revisão a mostra fixa (o grafo vence sobre o extrator) e o label errado ficava
para sempre. `trocarTipo` põe o label novo e remove os outros, uma consulta com
labels literais — `:Entidade` nunca sai, porque é ele que carrega a constraint.
Desde a 007 os outros são três (`:Organizacao` entrou na lista), e é por aqui
que passa a reclassificação das empresas que nasceram `:Pessoa`: um nó por vez,
com um toque meu em cada um.

**Semear é criar entidade antes de falá-la.** `/entidades` deixa criar nome e
tipo à mão, e o nó nasce **órfão de propósito** — zero átomos, e a lista mostra
"ainda não falada". O confirmar evita órfão com cuidado, porque lá seria
acidente; aqui é o pedido. O ganho é que o nome entra no vocabulário do STT
**antes** da primeira menção, que é quando o transcritor mais erra, e quando ele
enfim for falado a resolução acha a entidade pronta com o tipo que eu escolhi,
em vez do palpite do extrator.

**`status` ausente conta como ativa, e a ausência é o caso normal — não o
legado.** `Specs/slice-3.md` põe a escolha em duas opções ("ou a migration
preenche com `'ativa'`, ou o código trata ausência como ativa") e decide pela
segunda, por ser mais barata e por sobreviver a nó criado por código antigo. A
implementação seguiu: `gravarEntidades` (`atomos.ts`), que é o caminho por onde
quase toda entidade nasce, grava `id`, `nome`, `nome_normalizado` e `criado_em`
e **não** grava `status`; quem grava `status: 'ativa'` é só a semeadura manual
de `/entidades/criar`. As três leituras de entidade usam
`coalesce(e.status, 'ativa') <> 'fundida'`, e a defesa está toda ali.

Duas consequências que só se descobrem lendo o código, e por isso ficam
escritas aqui:

- **o índice `entidade_status` da 004 não é usado.** `coalesce()` sobre a
  propriedade impede o planejador de usá-lo, e propriedade nula não entra em
  índice de faixa. Ele existe, está `ONLINE` e não serve a nenhuma das três
  consultas. Não custa nada com dezenas de nós; é candidato a `DROP` numa
  migration futura, não a conserto agora;
- **`WHERE e.status = 'ativa'` não é consulta válida neste grafo.** Quem ler só
  a migration vai escrevê-la e não achar quase nada. A forma certa, em Cypher
  novo, é sempre o `coalesce`.

**Nada é automático.** `duplicatas.ts` só propõe — string primeiro (de graça),
o modelo depois, sobre a lista curta e com os textos dos átomos como contexto.
Fundir é um toque meu: "Marina" e "Mariana" são distância 1 e duas pessoas, e o
custo do erro é assimétrico — duas entidades a mais é grafo um pouco sujo, uma
fusão errada é grafo mentindo, sem desfazer.

### 8.3 Perfil e a aresta que o alimenta (migration 005)

```
(:Entidade { …, contexto, pode_ajudar_com, fizemos_juntos })
(:Atomo)-[:PERFILA { campo }]->(:Entidade)
campo ∈ contexto | pode_ajudar_com | fizemos_juntos
```

A 005, como a 003, **não tem statement nenhum**: propriedade de valor livre não
se declara no Aura Free (constraint de existência é Enterprise) e tipo de relação
não se declara em Neo4j nenhum. Ela existe porque `db/migrations/` é a definição
canônica do schema, e quem for ler tem que ver o contrato inteiro.

**Campo de perfil ausente conta como vazio, na leitura** (`coalesce` em toda
consulta) — mesma decisão do `status` na 004 e pela mesma razão: a defesa tem que
valer para o nó que um deploy antigo criar amanhã, não só para os que existem
hoje. Sem índice: ninguém busca por perfil.

**Por que aresta, e não propriedade do átomo.** Duas razões, e a primeira é a que
manda: a marca precisa dizer **de quem** é a informação. "fui no parque andar de
slackline com o Raffa" é `sobre: "eu"` pelas regras de tipo do `extracao-9`, e a
informação de perfil é do Raffa. A segunda é que Neo4j não guarda array de mapa
como propriedade — foi isso que forçou as listas paralelas da 003. Aresta com
propriedade ele guarda bem, e fica consultável: "todo átomo que diz o que o Rapha
sabe fazer".

**Idempotente por construção**: o `campo` vai **dentro** do `MERGE`, então o par
(átomo, campo, entidade) é a identidade da aresta e reconfirmar não a dobra
(regra 4). Fora do `MERGE`, um `SET` depois criaria uma aresta nova a cada
confirmação. Como `:SOBRE` e `:MENCIONA`, ela **atravessa alias na escrita** e
**migra na fusão** (8.2): proposta montada antes de uma fusão penduraria a marca
num nó morto, e uma fusão posterior a deixaria lá.

A travessia sozinha não bastaria, e a assimetria é o motivo: `atomosMarcados`
vai do **alias para o vencedor**, nunca ao contrário. Marca esquecida no nó
perdido sumiria do perfil do vencedor sem erro e sem aviso — e fusão não tem
desfazer.

Neo4j também não aceita **nome de propriedade** vindo de parâmetro, então
`perfil.ts` monta o `SET alvo.<campo>` com o nome literal — mesmo padrão do label
literal em `atomos.ts`, e seguro pela mesma razão: o valor sai de `CAMPOS_PERFIL`,
constante fechada, e nunca do cliente.

**Sem migração de dado.** Nenhum campo é preenchido: as entidades de hoje entram
no catálogo do agente 2 só com nome e tipo, que é o comportamento anterior à
slice. Perfil vazio é perfil válido.

### 8.3.1 A ficha se apresenta: `resumo`, `aliases`, `canonico` (migration 009)

```
(:Entidade { …, resumo, aliases, canonico })

resumo    texto livre, teto de 500 (TETO_RESUMO); ausente = ''
aliases   lista de grafias; ausente = []          — ver §8.2
canonico  booleano, marcado à mão; ausente = false
```

**O `resumo` é o retrato de identidade**: quem a entidade é para mim e, antes de
tudo, o que a distingue de outra parecida. Ele é o que os **dois** agentes leem
por padrão desde a 4.11 — o dossiê do extrator (§4.14) e o catálogo do agente 2
(§4.8). Até aqui eles liam coisas diferentes da mesma entidade: o extrator via só
`contexto`, escolhido em código entre os três, e o agente 2 via os três campos
inteiros de **todas** as entidades em toda chamada. Uma apresentação só, nos dois
lugares.

O teto de 500 não é estética, e é o mesmo argumento que a 005 usou com 300: sem
teto, o custo de todo prompt passa a depender do tamanho de cada ficha, e uma
entidade muito falada empurra as outras para fora do contexto. 300 era pouco para
um retrato — e este campo cobra sozinho o que antes se cobrava dos três juntos.
O corte é no servidor (`gravarResumo`), como o do perfil era.

**Resumo vazio é estado válido, e não ganha fallback.** É como toda entidade
nasce. A entidade sem resumo entra no prompt com nome, tipo e grafias e mais
nada; o agente devolve confiança baixa, a confiança baixa dispara a segunda
passada, e a segunda passada carrega o perfil inteiro — que é exatamente o que o
agente 2 lia antes desta fatia. Entre a 4.11 e a 4.12 essa passada vai ser a
regra, e isso é **comportamento esperado** (§14): a frequência cai sozinha
conforme os resumos forem escritos.

**`canonico` é preferência, não obrigação.** "Esta é a ficha oficial desta
entidade": marcada à mão, um toque, reversível, sem consequência retroativa —
nenhum átomo já gravado muda. Ela não exige sobrenome, não impede entidade nova
de nascer e não trava unicidade nenhuma. O que ela faz:

| Onde | O que ela vale |
|---|---|
| no dossiê do extrator e no catálogo do agente 2 | uma palavra na linha do candidato dizendo que aquela é a ficha oficial |
| em `/entidades` | marca na linha e ordenação na frente (`ORDER BY canonico DESC`) |
| no desempate determinístico | quando dois candidatos empatam, o canônico vence — em código, antes de qualquer chamada |

Nome canônico é preferência do mesmo jeito: `:Pessoa` sem sobrenome funciona
igual, e `/entidades` mostra que falta. Nada bloqueia, e nenhuma gravação é
recusada por isso.

**Sem índice**, como o perfil: ninguém busca por `resumo` nem por `canonico`, e o
Aura Free tem cota de índice.

**O `TETO_PERFIL` de 300 saiu** com esta migration, e é ela que o mata. O motivo
declarado na 005 era o consumo do agente 2 — "os três campos de todas as
entidades entram no prompt de resolução, e sem teto o custo cresce com o grafo".
A partir da 4.11 os três campos **não entram mais no caminho comum**: eles só
aparecem na segunda passada, para os poucos candidatos de uma menção em dúvida.
O motivo do teto deixou de existir, e o teto com ele.

Contrato completo de `:Entidade` depois da 009:

```
(:Entidade { id, nome, nome_normalizado, criado_em, status,
             contexto, pode_ajudar_com, fizemos_juntos,
             embedding, embedding_modelo, embedding_fonte,
             resumo, aliases, canonico })
status ∈ 'ativa' | 'fundida'
resumo   ≤ 500 (TETO_RESUMO)   aliases  lista   canonico  booleano
contexto, pode_ajudar_com, fizemos_juntos — SEM TETO a partir da 009

(:Entidade)-[:FUNDIDA_EM]->(:Entidade)   fusão de duas entidades reais   (004)
                                         — grafia de STT não usa mais    (009)
(:Entidade)-[:DISTINTA_DE]->(:Entidade)  recusa minha                    (004)
(:Atomo)-[:PERFILA { campo }]->(:Entidade)                               (005)
```

### 8.3.2 O desfazer e a fila (migration 010)

```
(:Entidade { …, resumo_anterior, contexto_anterior,
                pode_ajudar_com_anterior, fizemos_juntos_anterior,
                enriquecimento_estado, enriquecimento_motivo,
                enriquecimento_em, enriquecimento_atomos })

*_anterior             ausente = '' (não há geração guardada)
enriquecimento_estado  'na_fila' | 'rodando' | 'pronta' | 'falhou';
                       ausente = nunca enriquecida
enriquecimento_motivo  o erro, quando falhou
enriquecimento_em      ISO 8601 — quando o estado mudou
enriquecimento_atomos  quantos átomos entraram na última rodada; ausente = 0
```

A 010, como a 005 e a 007, **não tem statement nenhum**: propriedade de valor
livre não se declara no Aura Free. Ela existe porque `db/migrations/` é a
definição canônica do schema e o contrato mudou. **Sem migração de dado** —
nenhuma ficha existente é tocada, e entidade sem `enriquecimento_estado`
simplesmente nunca foi enriquecida, que é o estado de todas elas no dia em que a
migration foi escrita.

**Todos ausentes contam como vazio na leitura**, pela mesma razão do `status` na
004 e do perfil na 005: a defesa vale para o nó que um deploy antigo criar
amanhã, não só para os que existem hoje. Estado que o código não conhece é lido
como "nunca enriquecida", e não como erro.

**Os quatro `_anterior` são o desfazer** (§4.9), e são a razão de esta fatia ter
migration própria em vez de caber na 009: eles existem porque alguma coisa passou
a escrever a ficha sem eu ver antes.

**O estado da fila mora no nó, e não no R2**, ao contrário do acumulado de uma
sessão (§9). Lá a razão é a regra 5 — nada entra no grafo antes da revisão. Aqui
a entidade **já está** no grafo, e o que a fila guarda é sobre ela, não é
proposta de conteúdo nenhum. É esse estado que faz "fechar a aba não interrompe
nada" ser verdade: o elo seguinte lê o banco, não o navegador.

**Sem índice**, como o perfil e o resumo: a fila é varrida sobre o catálogo que
`listarEntidades()` já carrega inteiro, e o Aura Free tem cota de índice. É mais
um lugar que pediria índice no dia em que o catálogo não couber na memória de uma
função (§14).

Contrato completo de `:Entidade` depois da 010:

```
(:Entidade { id, nome, nome_normalizado, criado_em, status,
             contexto, pode_ajudar_com, fizemos_juntos,
             embedding, embedding_modelo, embedding_fonte,
             resumo, aliases, canonico,                            (009)
             resumo_anterior, contexto_anterior,
             pode_ajudar_com_anterior, fizemos_juntos_anterior,    (010)
             enriquecimento_estado, enriquecimento_motivo,
             enriquecimento_em, enriquecimento_atomos })           (010)
```

### 8.4 O vetor no grafo (migration 006)

```
(:Atomo    { …, embedding: [1536 floats], embedding_modelo })
(:Entidade { …, embedding: [1536 floats], embedding_modelo, embedding_fonte })

CREATE VECTOR INDEX atomo_embedding    FOR (a:Atomo)    ON (a.embedding)
CREATE VECTOR INDEX entidade_embedding FOR (e:Entidade) ON (e.embedding)
  vector.dimensions: 1536, vector.similarity_function: 'cosine'
```

Diferente da 003 e da 005, esta migration **tem statement de verdade** — índice
se declara. Propriedade continua não se declarando no Aura Free, então os três
campos são contrato escrito, não statement.

**O tier Free aceita índice vetorial**, verificado contra a instância real
(`0adada47`, Neo4j 5.27-aura) em 2026-09-02: `CREATE` aceito, `ONLINE` em menos
de 500 ms, `db.index.vector.queryNodes` devolvendo vizinhos com score. A doc
negava só "Vector Optimization" (configuração ≥ 4 GB), que é outra coisa. **E a
cota do Free não é medida em bytes**: o teto publicado é de 200 mil nós e 400 mil
arestas, e embedding é propriedade em nó que já existe — não cria nó nem aresta.
Com 4.000 átomos o grafo vai a ~4.050 nós, 2% do teto.

O resto da configuração fica no **padrão medido** (`quantization.type: SCALAR`,
`hnsw.m: 16`, `ef_construction: 100`, `default_search_expansion_factor: 1.5`).
Explicitar qualquer um desses seria fixar número que não foi calibrado contra
nada — e é o `SCALAR` do padrão que mantém o vetor **do índice** em torno de
6 MB para 4.000 átomos, contra os ~48 MB das propriedades.

**A dimensão é a única coisa aqui que amarra.** Trocar para um modelo de outra
dimensão exige `DROP` e recriar os dois índices, por migration nova;
`embedding.ts` estoura na porta quando a dimensão não bate, para o erro aparecer
antes do banco e dizendo o que fazer.

#### Os três campos, e por que cada um existe

| Campo | Onde | Para quê |
|---|---|---|
| `embedding` | átomo e entidade | o vetor |
| `embedding_modelo` | átomo e entidade | vetores de **dois modelos no mesmo índice não dão erro: dão vizinhança errada**. Sem o campo não há como saber quais nós voltam para a fila quando `EMBEDDING_MODEL` mudar |
| `embedding_fonte` | **só** entidade | hash da string canônica. É o que torna o refresh idempotente, e o que faz um gancho esquecido custar **atraso** em vez de vetor velho |

O átomo não tem `embedding_fonte`, e não é esquecimento: texto de átomo
confirmado não muda — deleção é soft (regra 6) e o `MERGE` é por
`<sessao_id>-<índice>`. Lá `embedding IS NULL` é a trava que basta.

O `embedding_fonte` é o que faz `/perfil`, `/renomear`, `/fundir`, `/tipo` e
`/criar` não precisarem lembrar de **invalidar** nada: a string canônica muda, o
hash muda, e a próxima passada de `garantirEmbeddings()` reembute.

**Quem faz essa próxima passada acontecer** (4.8.1), toda em `waitUntil` e toda
engolindo a falha com `[entidades]` no log:

| Call site | Por que ali |
|---|---|
| `POST /api/sessoes/:id/confirmar` | depois de `gravarAtomos`, junto do `capturarCorrecoes` — é onde nascem as entidades novas |
| `POST /api/entidades/perfil` | o que mais muda a string canônica |
| `POST /api/entidades/renomear` | nome novo e alias novo, dos dois lados |
| `POST /api/entidades/fundir` | o vencedor ganha alias, e alias entra na fonte |
| `POST /api/entidades/tipo` | o tipo entra na fonte |
| `POST /api/entidades/criar` | é o passo zero: o nó semeado à mão só entra na 3a com vetor |

Até a 4.8 o único chamador era `POST /api/entidades/embutir`, **que nenhuma tela
chama** — a varredura de `fetch("/api/…")` em `src/` dá 30 chamadas e nenhuma é
essa —, e não há cron nem `waitUntil` em lugar nenhum apontando para lá. Ou
seja: a "próxima passada" descrita neste parágrafo não existia. Entidade nascida
num confirmar ficava sem vetor para sempre, e a camada 3a (4.10) era código que
não podia achar nada.

O argumento que recusava o gancho continua escrito acima e continua bom — um
lugar a mais onde alguém esquece de invalidar. Ele não se aplica **porque o
gancho não invalida nada**: quem decide é o hash. Esquecer um call site custa
atraso, não vizinhança errada, porque a próxima passada de qualquer outro
alcança. E rodar com nada fora de dia custa uma consulta e zero chamada de
modelo, o que é o que permite chamar à toa.

O teto de `limite = 500` de `garantirEmbeddings()` fica: grafo maior que isso é
problema de outra fatia, e a rota manual continua existindo para o retrofill.

**Sem migração de dado**: nenhum vetor é calculado pela migration. Quem preenche
são `POST /api/atomos/embutir` e `POST /api/entidades/embutir` — e, desde a
4.8.1, os seis call sites da tabela acima. É isso que faz o retrofill custar uma
chamada de rota em vez de uma reextração.

Contrato completo depois da 006:

```
(:Atomo    { id, texto, tipo, inicios_s, fins_s, ancoras, valido_em, status,
             prompt_version, modelo, criado_em,
             embedding, embedding_modelo })                              (006)
(:Entidade { id, nome, nome_normalizado, criado_em, status,
             contexto, pode_ajudar_com, fizemos_juntos,
             embedding, embedding_modelo, embedding_fonte })             (006)
```

### 8.5 As relações de confronto (migration 011)

Sem `CREATE INDEX`/`CREATE CONSTRAINT`, mesmo padrão da 005, 007 e 010:
propriedade de valor livre e relação nova não se declaram no Aura Free, e a
cota de índice já está no limite conhecido (§14). A varredura de pendentes usa
o índice `atomo_status` (002) que já existe, filtrando `confronto_estado` em
memória — mesma decisão da fila de enriquecimento sobre o catálogo de
entidades (§8.3.2).

`:Atomo` ganha três propriedades de controle e `confronto_motivo`:

```
confronto_estado     'rodando' | 'processado' | 'falhou' — ausente = nunca tentado
confronto_em         ISO 8601
confronto_execucao   id da última rodada — auditoria, não trava de desfazer
confronto_motivo     o erro, quando falhou
```

E quatro relações novas, sempre do átomo mais novo para o mais antigo:

```
(:Atomo mais_novo)-[:ATUALIZA|:CONTRADIZ|:CONFIRMA|:COMPLEMENTA {
  execucao, motivo, confianca, criado_em, modelo, prompt_version
}]->(:Atomo mais_antigo)
```

`modelo` e `prompt_version` na relação vão além da letra da regra 7 do
`CLAUDE.md` (que fala de átomo), mas seguem o espírito: é um julgamento de LLM
como outro qualquer, e precisa da mesma auditoria. Detalhe de por que o
desfazer não precisa casar `execucao` — a gravação apaga a geração anterior
antes de escrever, então só existe uma viva por vez — está em §4.15 e, por
extenso, no cabeçalho da própria migration.

Contrato completo do que esta migration acrescenta:

```
(:Atomo { …,
          confronto_estado, confronto_em,
          confronto_execucao, confronto_motivo })                        (011)

(:Atomo mais_novo)-[:ATUALIZA|:CONTRADIZ|:CONFIRMA|:COMPLEMENTA
  { execucao, motivo, confianca,
    criado_em, modelo, prompt_version }]->(:Atomo mais_antigo)            (011)
```

### 8.6 A conversa, e o primeiro label solto do grafo (migration 012)

Slice 6. **Proposta — não rodada.** Como a 005, a 007, a 008, a 010 e a 011, ela
não tem statement nenhum: propriedade de valor livre não se declara no Aura Free
(constraint de existência é Enterprise) e índice novo não entra por cota (§14).
`scripts/migrate.ts` conta 0 statement(s) e segue. Ela existe porque
`db/migrations/` é a definição canônica do schema e o contrato do grafo mudou.

```
(:Conversa {
  id,                 // base36, o mesmo `novoId()` de :Sessao
  titulo,             // do agente `titulo-chat`; string vazia até ele responder
  criado_em,
  atualizada_em,      // é por ele que a lista ordena
  arquivada_em,       // ISO, ou AUSENTE — e ausente é o estado "ativa"
  mensagens_key       // a chave do objeto no R2
})
```

**Sem relação nenhuma, e é a característica que define o label.** `:Conversa`
não é `:Entidade` nem `:Atomo`, e não se liga a nada do grafo de conhecimento —
é metadado de aplicação, como `:Sessao`. Uma conversa enxerga o grafo pelas duas
ferramentas do agente `chat`, nunca por aresta própria; e **uma conversa nunca
enxerga outra**. Conversas virarem fonte de busca umas das outras — uma terceira
ferramenta, com embedding nas mensagens — foi considerado e recusado na
entrevista: nasceu de uma ambiguidade de linguagem, não de um pedido real.

**Sem índice, e nem constraint de unicidade em `id`.** `listarConversas` varre
`(:Conversa)` com `ORDER BY` e `LIMIT` sobre o grafo de uma pessoa só — a mesma
conta de `todasSessoes` (008). E, ao contrário de `:Sessao` (001), nada aqui faz
`MERGE` por id: a conversa nasce de um `CREATE` com id sorteado, e a unicidade
vem da origem. Um índice para proteger o que a origem já garante seria cota
gasta por simetria.

**`arquivada_em` ausente conta como ativa, na leitura** — mesma decisão do
`status` na 004, do perfil na 005 e do `descartada_em` na 008, e pela mesma
razão: a defesa vale para o nó que um deploy antigo criar amanhã, não só para os
que existem hoje.

**Esta é a única exceção à regra 6 do `CLAUDE.md` em todo o sistema**, e ela é
deliberada. A regra 6 fala de átomo: "deleção é soft, nunca `DELETE` em átomo".
Conversa não é átomo — não é conhecimento, é a transcrição de uma pergunta que
eu fiz a uma tela. Nada do grafo depende dela, nenhum átomo perde procedência
quando ela some, e o pedido da entrevista foi explícito em ter as **duas** ações
e não só uma: `arquivar` congela (`SET c.arquivada_em`), `apagar` apaga
(`DETACH DELETE` mais o objeto no R2). O `DETACH` é cinto de segurança, não
necessidade: o nó nasce sem aresta e deve morrer assim.

Contrato completo do que esta migration acrescenta — e nada do que já existia
muda:

```
(:Conversa { id, titulo, criado_em, atualizada_em,
             arquivada_em, mensagens_key })                              (012)
```


## 9. Layout do R2

```
sessoes/<id>/manifest.json      { sessao_id, chunks: [{i, bytes, subido_em, transcrito, ext?}], finalizado }
sessoes/<id>/chunk_000.webm     áudio do bloco gravado no navegador
sessoes/<id>/chunk_000.wav      áudio importado e fatiado — WAV 16 kHz mono (slice 4.10)
sessoes/<id>/chunk_000.opus     áudio importado que o navegador não fatiou — a extensão é a de origem
sessoes/<id>/chunk_000.json     transcrição do bloco, offsets relativos, modelo, granularidade
sessoes/<id>/candidatas_000.json quem o grafo acha que o bloco cita: { candidatas: [{chave, camada, score}], semantico, refeito? }
sessoes/<id>/transcricao.json   final, offsets absolutos
sessoes/<id>/parcial.json       a proposta enquanto cresce: { janelas: [{n, de, ate, estado, em, procedência}], atomos, entidades, descartados }
sessoes/<id>/extracao.json      proposta: átomos ancorados, referências resolvidas (com o `porque` da camada 3b), marcas de perfil, entidades agregadas, procedência dos dois agentes
sessoes/<id>/extracao-anterior.json  a proposta que o `forcar` substituiu — só a última, para eu comparar
sessoes/<id>/correcoes.json     o que eu corrigi naquela revisão — fotografia do momento da confirmação, escrita uma vez só
sessoes/<id>/medidas.json       quanto aquela sessão levou (slice 8): { cliente: {parou, fila_vazia, revisou}, passos: {<passo>: {n, ms, pior_ms}}, agentes: {<id>: {n, ms, entrada?, saida?}}, falhas }
conversas/<id>/mensagens.json   a conversa inteira (slice 6): { conversa_id, mensagens: [{papel, texto, criado_em, rastro?, modelo?, prompt_version?}] }
calibracao/indice.json          a mesa de trabalho: as correções acumuladas de todas as sessões (teto de 500),
                                os padrões vivos e a visita de cada agente
calibracao/regras-<hash>.json   uma composição de regras aprovada na 4.6 — imutável, e desde a 7 só de leitura:
                                nada mais escreve um, e um átomo carimbado `+a<hash>` ainda resolve por ela
config/agentes.json             o que eu editei de cada agente: hash do prompt e modelo (slice 4.7)
config/prompt-<agente>-<hash>.json  um prompt editado — imutável para sempre; é o que o sufixo `+p<hash>` resolve
medidas/indice.json             uma linha por sessão: espera, fila, servidor, blocos, tempo por passo,
                                chamadas, tokens e os códigos de falha (teto de 400, sem texto livre)
medidas/<AAAA-MM>.json          o mês fechado: n, mediana, pior caso, por passo — escrito na batida diária
backup/grafo-<dia>.json         o dump diário do grafo: { gerado_em, nos, arestas } — sem `embedding`
_smoke/                         objetos temporários do `pnpm smoke`, apagados no fim
```

**`backup/` gira pelo dia do mês, e a chave que se repete é o mecanismo.**
Sobrescrever `grafo-07.json` todo dia 7 deixa entre 28 e 31 cópias sem nenhum
`LIST` e sem nenhum `DELETE` — e `r2.ts` não tem `LIST`, por decisão que um
backup não vai derrubar. Datar a chave daria histórico infinito e exigiria listar
para saber o que apagar.

O `embedding` fica de fora, e a exclusão acontece **no Cypher**
(`[k IN keys(n) WHERE k <> 'embedding' | [k, n[k]]]`): são ~12 KB por nó, ~48 MB
num grafo de 4.000 átomos (§14), e excluir em JavaScript ainda faria esses
megabytes atravessarem a Query API toda madrugada para serem jogados fora. É
legítimo excluir porque o vetor é **derivado** — `passadaDeVetores()` o refaz a
partir do texto, por hash (§8.4). O dump carrega o que só existe uma vez.

`candidatas_NNN.json` **espelha `chunk_NNN.json`**, e a existência dele é a
trava do RAG como a do bloco é a da transcrição (§6). Guarda chave, camada e
score — e não o nó inteiro: o arquivo é cache de uma busca, e guardar nome, tipo
e perfil junto faria dele uma foto do grafo que envelhece sozinha. Quem resolve
chave → nó é o dossiê, com o catálogo da hora. `semantico: false` marca o bloco
cuja camada de vetor não trouxe nada, e é o que o catch-up do `/finalizar` refaz
uma vez (§4.14).

`calibracao/`, `config/`, `conversas/` e `medidas/` ficam **fora** do prefixo
`sessoes/` de propósito: nem o índice de correções, nem a configuração dos
agentes, nem uma conversa, nem a série de medidas são de sessão nenhuma. E são
quatro prefixos e não um porque são quatro coisas: `calibracao/` é material que o
sistema acumulou sozinho, `config/` é o que eu escrevi, `conversas/` é o que eu
perguntei, e `medidas/` é o relógio do sistema sobre si mesmo (§4.17).

`conversas/<id>/mensagens.json` é o gêmeo de `transcricao.json` na outra ponta do
sistema: no Neo4j vai só a chave (regra 2), e o conteúdo — incluindo o rastro de
ferramentas de cada resposta, que é o material do botão (i) — fica aqui. Ele é o
**único** objeto do R2 que é apagado de verdade fora de uma sessão descartada, e
`apagarConversa` o remove **antes** do nó: a chave só existe no nó, e sem `LIST`
não há como reencontrar um objeto órfão (§4.16.5).

**`parcial.json` e `extracao.json` são dois objetos e não um** porque têm donos
diferentes no tempo. O parcial é escrito por vários `waitUntil` concorrentes, com
read-modify-write por etag; a proposta é escrita uma vez, com `If-None-Match`, e
essa escrita única **é** a trava de idempotência da extração (§6). Um objeto só
não poderia ser as duas coisas. O parcial fica no R2 depois de a proposta existir
— é onde o motivo de uma janela que falhou continua legível.

`chaves.ts` é o único lugar que monta chave — rota, worker e teste passam por ele.
Por isso é lá que a extensão é validada contra a lista de `audio.ts`, e não só na
rota: extensão é parte de caminho, e quem confia no chamador escreve fora do
prefixo da sessão mais cedo ou mais tarde.

`ext` só aparece no manifest quando **não** é `webm`. Ausente significa gravação,
o que mantém legível todo manifest escrito antes da importação existir
(`extensaoDoChunk`). É esse campo que diz ao `transcreverBloco` onde o áudio
está — procurar sempre em `.webm` mataria toda sessão importada.

**Apagar uma sessão enumera daqui, e não de um `LIST`** (slice 4.10). `r2.ts` não
tem `LIST` — nunca teve, e é por isso que `calibracao/indice.json` existe —, então
`chavesDaSessao(manifest)` monta as chaves a partir do manifest: três por bloco
(áudio na extensão registrada, transcrição, candidatas) mais as **sete** fixas
(`medidas.json` entrou na slice 8). Mora
em `chaves.ts` pela mesma razão que todo o resto: um lugar só monta chave, e uma
segunda cópia do layout numa rota envelheceria calada na primeira chave nova.

**O manifest é o último a ser apagado**, e a ordem é do próprio `chavesDaSessao`:
ele é quem sabe quais blocos existem, e apagá-lo primeiro deixaria trinta e cinco
objetos inalcançáveis para sempre. `calibracao/indice.json` e `medidas/indice.json` **não** entram
na lista: as correções daquela sessão são material de calibração, não dado de
sessão, e apagá-las seria desaprender (§14); a linha de medida é a série, e
sessão de teste que foi mal não pode sumir para melhorar a média (§4.17).

## 10. Rotas

| Rota | Faz | Notas |
|---|---|---|
| `POST /api/sessoes` | cria `:Sessao {status:'gravando'}` | devolve `id` |
| `GET /api/sessoes` | a lista de sessões, da mais recente para a mais antiga | teto de 50; **esconde sessão sem bloco** que não esteja `gravando` — ver abaixo |
| `POST /api/sessoes/:id/chunks/:i/url` | presigned PUT de 5 min | corpo `{ext?}`; 415 fora da lista; o áudio não passa por aqui |
| `POST /api/sessoes/:id/chunks/:i/pronto` | HEAD + manifest + `waitUntil(STT → janelas)` | corpo `{ext?, duracao_s?}`; a importação fatiada **não** manda `duracao_s` (§3.0) |
| `POST /api/sessoes/:id/finalizar` | `finalizando`, responde na hora, fecha **e extrai** em `waitUntil` | `ja_finalizada` a partir de `em_revisao`; antes disso, é o retry da extração |
| `GET /api/sessoes/:id` | estado + transcrição (parcial enquanto processa) | polling de 2 s; `completa` é sobre a transcrição, não sobre a sessão |
| `DELETE /api/sessoes/:id` | apaga os objetos da sessão no R2 e marca `descartada_em` | **409 se ainda está processando**; o grafo fica intacto (regra 6) — ver abaixo |
| `POST /api/sessoes/:id/extrair` | dispara extração **e resolução** de uma sessão já transcrita | retry do `waitUntil` perdido; `{"forcar":true}` refaz as duas e sobrescreve |
| `GET /api/sessoes/:id/extracao` | a proposta + o mapa de blocos, para a revisão — **fechada ou ainda crescendo** | o mapa é o que traduz offset em bloco; a referência traz o `porque` da camada 3b desde a slice 4.5; `anterior` vem como cabeçalho, e a lista antiga só com `?anterior=1`. Desde a 8.2 responde também do `parcial.json`, com `crescendo`/`trechos_totais`/`trechos_faltando`, e o **404 passou a significar "zero átomos"** (§4.19) |
| `GET /api/sessoes/:id/extracao/eventos` | um **fluxo NDJSON** da proposta enquanto ela cresce: um evento por mudança, o último com `crescendo: false` | mesmo dialeto de `/api/chat`; polling curto do lado do servidor (700 ms), fecha sozinho aos 280 s e o cliente reconecta. As duas telas do corredor consomem o mesmo fluxo (§4.19) |
| `POST /api/sessoes/:id/medidas` | as marcas que só o navegador sabe dar: `parou`, `fila_vazia`, `revisou` | epoch em ms, e toda marca reescreve a linha do índice; corpo sem marca plausível não grava nada (§4.17) |
| `GET /api/sessoes/:id/medidas` | o detalhe medido daquela sessão | não há tela: é por aqui que "o objeto é lido sob demanda" acontece |
| `GET /api/medidas` | o índice; com `?mes=AAAA-MM`, o resumo daquele mês | só leitura; existe porque `r2.ts` não tem `LIST` |
| `GET /api/sessoes/:id/chunks/:i/audio` | presigned GET do bloco, para o player | 404 se a chave não existe, para o `<audio>` não falhar calado |
| `POST /api/sessoes/:id/confirmar` | grava os aprovados no grafo, com `:PERFILA`, e apura as correções em `waitUntil` | `ja_confirmada` na segunda; procedência relida do R2, não do corpo; `gestos` é **opcional** e corpo sem ele confirma igual |
| `GET /api/calibracao` | sem `?agente`, o mapa: quanto material parado cada agente tem. Com `?agente`, as correções dele, a pauta viva e as seções do prompt em vigor | marca `visitado_em` **daquele agente** em `waitUntil` — best-effort, e só se o índice já existe |
| `GET /api/calibracao/sugestao` | `{ sugerir: boolean }` — se **algum** agente tem o que olhar | **puro, nunca escreve**; a gaveta o consulta ao abrir |
| `POST /api/calibracao/padroes` | o `calibracao-2` diz que padrão as correções daquele agente revelam | **não escreve nada**; é `POST` porque gasta chamada de modelo |
| `POST /api/calibracao/redacao` | guarda a pauta que eu confirmei e o `redacao-1` escreve a emenda | grava a **pauta**, nunca o prompt; devolve as edições e o texto que elas produzem |
| `POST /api/calibracao/aprovar` | as edições viram o prompt em vigor daquele agente | o **único** lugar que escreve prompt por calibração; o corpo manda edições, nunca o texto final |
| `GET /api/entidades` | o que está no grafo, com átomos, sessões e grafias; `?perfil=1` traz também `resumo`, `canonico` e os três campos | só leitura; nó fundido vira alias do vencedor; alimenta também o seletor da revisão, que não pede o perfil |
| `POST /api/entidades/duplicatas` | propõe pares que parecem a mesma coisa | **não escreve nada**; é `POST` porque gasta chamada de modelo |
| `POST /api/entidades/fundir` | `{vencedora, perdedora}` — migra arestas, marca alias | idempotente pela guarda de `status` |
| `POST /api/entidades/distintas` | `{a, b}` — a recusa que impede a pergunta de voltar | |
| `POST /api/entidades/renomear` | `{chave, nome}` — grafia velha entra em `aliases` | recusa pronome, como o confirmar; recusa nome que já é grafia de outro nó |
| `POST /api/entidades/tipo` | `{chave, tipo}` — troca o label | o tipo só era editável enquanto a entidade era nova |
| `POST /api/entidades/criar` | `{nome, tipo}` — semeia um nome antes de falá-lo | cria nó órfão de propósito |
| `POST /api/entidades/perfil` | `{chave, campo, texto}` — grava um dos três campos | o único lugar que escreve perfil; **sem teto** desde a 009 |
| `POST /api/entidades/resumo` | `{chave, texto}` — grava o retrato de identidade | o único lugar que o escreve; corta em `TETO_RESUMO` (500) no servidor; texto vazio limpa |
| `POST /api/entidades/aliases` | `{chave, grafia, acao}` — acrescenta ou tira uma grafia | um item por chamada: a lista na tela é a união de duas fontes, e mandá-la de volta gravaria uma na outra. Acrescentar reusa `registrarGrafia`, com as quatro recusas |
| `POST /api/entidades/canonico` | `{chave, canonico}` — marca a ficha oficial | reversível, sem consequência retroativa; não trava nada |
| `POST /api/entidades/perfil/rascunho` | `{chave, campo}` — o agente 3 propõe | **não escreve nada**; é `POST` porque gasta chamada de modelo |
| `POST /api/entidades/enriquecer` | `{chave}` uma agora; `{chaves}` põe na fila e responde na hora; `{elo:true}` um elo | a **única** rota que escreve conteúdo sem eu aprovar campo a campo (§4.9) — nenhum átomo entra por ela, e a regra 5 continua inteira. O elo se autentica com o meu cookie, repassado |
| `POST /api/entidades/desfazer` | `{chave}` — os quatro campos da ficha voltam uma geração | é uma **troca**, não uma restauração: outro toque traz de volta. 400 quando não há geração guardada |
| `POST /api/atomos/embutir` | dá vetor aos átomos que ainda não têm, em lote | retrofill e retry; 200 por chamada, `continua: true` enquanto sobrar; não toca no texto nem reextrai |
| `POST /api/entidades/embutir` | põe em dia o vetor das entidades, comparando `embedding_fonte` | não editar nada devolve `embutidas: 0` |
| `POST /api/chat` | `{conversa_id?, texto}` — a pergunta; devolve um **fluxo de NDJSON** com a conversa, um evento por chamada de ferramenta, a resposta e o título | cria a conversa quando não vem `conversa_id`; **409 em conversa arquivada**; grava a pergunta antes de o modelo começar, para o "parar" não perdê-la; sem chave de idempotência, e é a única assim (§4.16.7) |
| `GET /api/chat?conversa_id=` | as mensagens de uma conversa, com o rastro de cada resposta | mora aqui, e não em `/api/conversas/:id`, porque é a leitura do mesmo objeto do R2 que o `POST` escreve |
| `GET /api/conversas` | a lista, ativas e arquivadas juntas, por `atualizada_em` desc | quem separa é a tela. **Sem `POST`**: conversa nasce da primeira pergunta, não de um botão — assim a lista nunca acumula conversa vazia |
| `PATCH /api/conversas/:id` | `{arquivada: boolean}` — congela ou descongela | um booleano e não duas rotas: as duas direções são a mesma decisão |
| `DELETE /api/conversas/:id` | apaga de vez — o objeto no R2 **e** o nó | a **única deleção de verdade** do sistema, e a exceção declarada à regra 6 (§4.16.5, migration 012). R2 antes do nó, sempre |
| `GET /api/agentes` | `{agentes, telas, atualizado_em}` — os doze com o que está em vigor, mais **as duas telas** do fluxo (`/agentes` e `/agentes/consulta` escolhem a sua por `fluxo`) | **de graça**: nenhuma chamada de modelo, nenhuma ida ao grafo; a base do git viaja junto, para a tela dizer "editado" sem segunda ida à rede |
| `POST /api/agentes/:id` | `{prompt?, modelo?}` — o que passa a valer | o **único** lugar que escreve configuração de agente; `null` revoga o campo e volta à base; recusa prompt que quebre o envelope e id de modelo fora do formato |
| `GET /api/confronto` | quantos átomos esperam, e os últimos que a varredura tocou | só leitura; alimenta a tela `/confronto` |
| `POST /api/confronto/rodar` | reivindica um átomo pendente e roda; se autoencadeia em `waitUntil` até a fila esvaziar | mesmo cookie repassado do elo de enriquecimento; sem distinção entre "começar" e "elo seguinte" — não há passo de escolher o que entra |
| `POST /api/confronto/desfazer` | `{atomo_id}` — apaga as relações de saída daquele átomo e limpa o estado | uma **troca** para "nunca tentado", não uma restauração de conteúdo; 400 quando o átomo nunca foi tocado |
| `POST /api/confronto/reprocessar` | apaga **todas** as relações de confronto e devolve o grafo inteiro à fila (5.1) | é como um prompt novo alcança o que já foi julgado. Não roda a fila — a tela chama `rodar` em seguida; destrutivo e sem desfazer, por isso dois toques na tela |
| `POST /api/auth/link` | pede o magic link, e o Resend entrega | resposta idêntica nos três caminhos em produção — e-mail errado, entregue, falhou (§7). Fora de produção o link volta no corpo |
| `GET /api/auth/entrar?token=` | troca o link pelo cookie | |
| `GET /api/cron/diario` | o dump do grafo para o R2, a consulta que mantém a Aura acordada, e o resumo mensal das medidas | **não abre com cookie**: entra pelo header `Authorization: Bearer $CRON_SECRET`, conferido no middleware e só sob `/api/cron/` (§7). Uma vez por dia — é o que o Hobby dá, e é o que uma janela de 72 h pede |
| `GET /api/cron/confronto` | a batida diária do confronto — processa a fila em loop até esvaziar ou o orçamento de tempo acabar | mesma credencial de cron; horário próprio, separado do `/cron/diario` (`vercel.json`) |

Todas com `runtime = "nodejs"`. `GET /api/sessoes`, `POST /api/sessoes`,
`GET /api/sessoes/:id/extracao` e `GET /api/entidades` respondem **502** quando
Neo4j ou R2 não atendem, com a causa legível no corpo (seção 5.2).

**As duas configurações que mudam comportamento, por extenso.** Nenhuma delas é
detalhe de deploy: o teto de execução é o que decide se um `waitUntil` termina, e
`force-dynamic` é o que impede o App Router de servir estado de sessão em cache.

| `maxDuration` | Rotas |
|---|---|
| 300 s | `/chunks/:i/pronto`, `/finalizar`, `/extrair`, `/entidades/enriquecer`, `/confronto/rodar`, `/cron/confronto`, `/chat`, `/extracao/eventos` — as que chamam modelo dentro de `waitUntil`, correm a mesma fila em loop, encadeiam até oito chamadas antes de responder, ou **mantêm um fluxo aberto** |
| 60 s | `/confirmar`, `/atomos/embutir`, `/entidades/embutir`, `/entidades/duplicatas`, `/entidades/fundir`, `/entidades/perfil/rascunho`, `/calibracao/rascunho` |
| padrão | todo o resto |

O 60 s do `/confirmar` é o que mais importa: a apuração de correções roda no
`waitUntil` dele, **depois** da resposta, e é dentro desse teto que ela termina
ou não (§4.11).

O 300 s do `/entidades/enriquecer` não é o tempo de uma ficha — uma chamada de
modelo e duas consultas cabem folgado em 60. Ele é o que permite a **espera de
rate limit sem prazo** que a fila usa (§4.9): uma espera de 75 s estouraria um
teto de 60 e mataria o elo no meio do sono. `LEASE_MS` é o mesmo número, e é por
isso: passado ele, a função que reivindicou está morta com certeza.

`dynamic = "force-dynamic"` em treze rotas, todas de leitura de estado:
`GET /api/sessoes`, `GET /api/sessoes/:id`, `GET /api/sessoes/:id/extracao`,
`GET /api/sessoes/:id/extracao/eventos`, `GET /api/entidades`,
`GET /api/calibracao`, `GET /api/calibracao/sugestao`, `GET /api/confronto`,
`GET /api/conversas`, as duas de `/api/chat` e as duas de medidas
(`/api/medidas` e `/api/sessoes/:id/medidas`).

O 300 s do `/chat` é o mais justificado da tabela, e o único que não é sobre
`waitUntil`: uma pergunta composta paga até oito idas ao Gateway antes da
síntese, mais a síntese, e a espera de rate limit continua sem prazo. Ele
responde em **fluxo**, então a resposta começa a chegar muito antes disso — o
teto é para o pior caso, não para o normal.

O 300 s de `/extracao/eventos` é de outra natureza: ali nenhum modelo é chamado,
e o teto é quanto a **conexão** pode viver. `TETO_STREAM_MS` (280 s) fecha o
corpo 20 s antes dele de propósito — fluxo morto pela plataforma no meio deixaria
a revisão esperando para sempre um átomo que não vem, e com o confirmar travado
junto (§4.19).

**O `DELETE` de sessão apaga o material, não o grafo** (slice 4.10). Existe porque
calibrar gera sessão de teste, e uma sessão de 17 min fatiada são 35 objetos no
R2: limpar à mão no console não é caminho. A rota carrega o manifest, percorre
`chavesDaSessao` na ordem (§9) e só então grava `descartada_em` no `:Sessao`.

A guarda é `terminouDeProcessar(status)` — 409 em qualquer outro. Apagar no meio
do pipeline correria com um `waitUntil` vivo, que voltaria a gravar o que acabou
de sumir, e sobraria um objeto órfão de uma sessão já fora da lista, sem `LIST`
que o encontrasse. `Sessoes.tsx` aplica a mesma pergunta para não oferecer um
botão que levaria 409. A contrapartida: sessão largada em `gravando` não tem
botão nenhum (§14).

**Sem `DELETE` no grafo**, e não por conservadorismo: a regra 6 proíbe `DELETE`
em átomo, e um `DETACH DELETE` no `:Sessao` levaria junto o `GEROU` e orfanaria
os átomos de uma sessão já confirmada. O nó fica, marcado; `todasSessoes` filtra
por `descartada_em IS NULL`; e `audio_key` passa a apontar para objetos que não
existem mais — consequência aceita e escrita na migration 008 (§14).

**`GET /api/sessoes` esconde uma categoria de nó, e isso não é bug.** O filtro é
`chunks_total > 0 || status === "gravando"`: uma sessão criada e largada antes de
o primeiro bloco subir não é áudio nenhum e não aparece na lista. O `:Sessao`
continua no Neo4j para sempre — deleção é soft (regra 6) e nada apaga sessão —,
então existe uma categoria de nó órfão que a única tela que lista sessões não
mostra. Custo hoje: nenhum. Custo no dia em que eu contar sessões por Cypher: o
número não vai bater com a tela.

## 11. Telas

| Rota | Componente | O que mostra |
|---|---|---|
| `/` | `Gravacao` + `BotaoGravar` + `Gestao` + `Chat` | o círculo "Como foi seu dia?", uma engrenagem discreta na borda esquerda e a barra do chat no rodapé, centralizada — **nada mais**; gravando: ondas laterais, selo de REC, timer e um ponto de "salvo", e nem a engrenagem nem a barra |
| `/sessao/:id` | `Processando` | o corredor, e desde a 8.2 uma **ponte curta**: um verbo do passo atual, sem transcrição; empurra a sessão que está parada e sai para a revisão no primeiro átomo que existir |
| `/sessao/:id/revisar` | `Revisao` | a proposta: aprovar, corrigir o texto no próprio lugar, escutar cada trecho, resolver a dúvida de quem é, abrir as fontes de uma sugestão no `ⓘ`, confirmar — e, desde a 8.2, **crescer** enquanto o fim é extraído, com o confirmar travado e uma linha no rodapé até fechar |
| `/sessao/:id/transcricao` | `Leitura` | o texto literal, em pedaços enquanto transcreve — porta de serviço |
| `/sessoes` | `Sessoes` | lista de sessões: abrir, ler a transcrição, forçar re-extração, **apagar** — e a cor que diz o que já foi revisado |
| `/entidades` | `Entidades` | o que está no grafo, buscável por nome e por grafia, filtrável por tipo e por "sem resumo", em ordem de mais falada. Cada linha é um nome e uma linha de meta; tocá-la abre a **ficha** num painel de tela cheia — tipo, renomear, canônica, resumo, grafias, os três campos de perfil, o enriquecer/desfazer e **fundir com…**, que funde duas entidades quaisquer à mão. O lote é modo: "enriquecer" acende os checkboxes e uma barra grudada no topo |
| `/calibracao` | `Calibracao` | as regras em vigor (editáveis) e o que eu já corrigi, com o selo do agente, o `antes → depois` e o áudio à mão |
| `/agentes` | `Agentes` | **o que entra**: a espinha do áudio ao grafo — STT, extração (com resolução e desempate rodando dentro dela), a revisão e o leque dos seis que partem do grafo gravado. Clicar num agente abre o prompt, o modelo e (na resolução e no confronto) o limiar |
| `/agentes/consulta` | `Agentes` | **o que sai**: pergunta, chat, resposta, título, conversa. Mesma gaveta de edição; nada nesta tela escreve no grafo |
| `/confronto` | `Confronto` | quantos átomos esperam a varredura, o botão "rodar agora", e os últimos átomos tocados com as relações que ganharam e o desfazer por linha (slice 5) |
| `/entrar` | página de login | pede o e-mail permitido |

**Clicar na sessão leva sempre para onde ainda há o que fazer.** Proposta
esperando abre na revisão; sessão `confirmada` abre no texto literal, que é o
que sobrou dela; **todo o resto vai para o corredor**, e é ele quem chama
`/finalizar` na sessão parada. `transcrito` levava ao texto literal e o corredor
não a empurrava — uma sessão que transcreveu e nunca extraiu (`waitUntil`
perdido, extração que morreu) ficava sem caminho nenhum até a revisão, com o
texto no R2 e nenhuma proposta. Ler a transcrição continua a um toque, no botão
ao lado, que é onde essa porta de serviço deve estar.

O corredor empurra `gravando`, `transcrito` e `erro` — os três estados que
ficariam parados para sempre —, e não toca em `finalizando`, `transcrevendo` nem
`extraindo`, que já estão andando por conta própria. A chamada é idempotente
(regra 4: proposta que existe não rechama o modelo) e acontece uma vez por
visita.

**E ele tem teto desde 18/09.** O laço não tinha nenhum, e a tela só sabia falar
em falha quando o **status** dizia `erro` — mas sessão cuja função morreu no
`maxDuration` nunca chega a `erro`: ela fica em `extraindo` no grafo (§5.3), e a
tela ficava em "lendo o que você disse…" indefinidamente. É o que faz uma trava
parecer lentidão. Passados `TETO_DA_ESPERA_MS` (6 min) o corredor para de
perguntar e diz o que aconteceu, apontando o reextrair da lista. O relógio é o da
**visita**: abrir a sessão de novo recomeça a contagem, que é o que se quer ao
voltar para conferir.

**Em `/` a porta de serviço inteira é uma engrenagem no meio da borda
esquerda** — sessões, entidades, agentes, calibração e subir um áudio, num menu
lateral (`Gestao`).
Ela fica na altura do círculo, na margem, e **não** no canto superior esquerdo:
aquele canto é da `Marca`, a volta ao início. Um segundo significado ali faria o
canto querer dizer duas coisas conforme a tela. Eram
três controles soltos na tela — o link de importar logo abaixo do círculo e as
duas portas no rodapé —, e três coisas para ler antes de falar. Virar um
**aproxima** a tela do "um botão, um timer, um jeito de parar — idealmente nada
mais" da visão §6, em vez de afastá-la: o que sobra no caminho do olho é o
círculo.

A gaveta entra pela esquerda em 220 ms na mesma curva das ondas, fecha no véu, no
`Esc` e ao navegar, e o foco entra nela ao abrir e volta para a engrenagem ao
fechar. **Clicar em "subir um áudio" não a fecha**, de propósito: o botão vira
"subindo o áudio…" e a recusa de formato aparece logo abaixo — os dois precisam
ficar visíveis onde eu cliquei. Ela some sozinha quando o upload termina e a rota
troca. A engrenagem só existe com a gravação parada, como os três links que ela
substituiu: navegar para fora no meio de uma gravação a mataria.

`Gestao.tsx` **não** ganhou um item de chat, e é deliberado: ao contrário da
slice 5, o chat não é uma rota. Ele mora na própria tela inicial.

#### A barra do chat, e o círculo que minimiza (slice 6)

Uma rota própria e de destaque — `/chat`, ao lado de Gravar/Revisar — foi a
primeira ideia levada à entrevista, e caiu assim que ficou claro que a
integração era com a tela de gravar. O que existe é uma barra:

| estado da tela | o que aparece |
|---|---|
| **parado** | círculo ao centro + engrenagem + a barra do chat, discreta, centralizada no rodapé, com `...` de convite |
| **chat aberto** | o painel toma o centro; o círculo encolhe, sobe para o topo e fica semitransparente — periférico, como a barra era |
| **gravando** | só círculo, timer, ponto de salvo e "parar". A barra **some inteira**, como a engrenagem |

**Era uma bolha de balão no canto de baixo à direita.** Ela caiu no primeiro uso
de verdade: um ícone de balão periférico lê como símbolo de suporte, não como
lugar de perguntar. A barra **não** aceita texto — tocar nela abre o painel e o
foco vai para o campo de dentro. Um `<input>` no estado fechado que não
recebesse o que eu digitasse mentiria, então o que está ali é um botão com cara
de campo.

A barra e o painel são o **mesmo elemento** — uma `<section class="chat">` que
cresce —, pela mesma razão que o `BotaoGravar` é o mesmo nó do DOM parado e
gravando: sem isso não há o que transicionar, só um corte.

##### As duas animações, e por que a primeira versão não era uma

Até o primeiro uso isso era só o que o documento dizia. Na prática o componente
voltava cedo com uma árvore diferente, e o que existia era um `@keyframes` de
entrada — **sem simétrico nenhum na saída**. Fechar era um corte, e a bola
minimizando era um pulo. Duas causas, as duas mecânicas:

- **a caixa** tinha a animação em `@keyframes`, que não tem volta, e a transição
  de opacidade do círculo morava **dentro** da regra `.tela.com-chat` — some
  junto com a classe, e o retorno é instantâneo por construção;
- **a bola** mudava `--circulo` de `min(72vw, 264px)` para `84px` e virava
  `justify-content` de `center` para `flex-start`. Propriedade personalizada não
  registrada **não interpola**, e `justify-content`, `gap` e `padding` não
  interpolam nunca.

O que existe agora, e vale nos dois sentidos porque mora nas regras **base**:

- **a caixa** transiciona geometria — os quatro `inset`, `max-width`, o raio e a
  opacidade. É por isso que a barra fechada declara um `top` numérico
  (`calc(100dvh - recuo - 44px)`) em vez de `auto`, que não interpolaria; e é por
  isso que fundo, borda e opacidade vivem na `.chat` e não nos filhos. Barra e
  painel ficam os dois `position: absolute; inset: 0`, para que nenhum deles
  estique a caixa durante a troca;
- **a bola** se move por `transform: translateY(calc(3.75rem - 50dvh))
  scale(0.32)`. O `0,32` é fator e não comprimento, porque o CSS não divide
  comprimento por comprimento: ele encolhe o que `--circulo-tamanho` disser, e
  com os 220px de hoje a bola parada fica em ~70px. O `50dvh` é exato e não
  estimado, porque a `.tela` é `min-height: 100dvh` com padding vertical
  simétrico, `justify-content: center`, e o `.palco` é o único filho em fluxo.
  Quem chega mais perto do painel não é a bola parada, é o auge da respiração:
  220px × 1,2 × 0,32 dá raio de ~42px, e a borda de baixo para em ~6,4rem, acima
  do `top: 8.5rem` do painel — que é o que faz os dois conviverem sem um cobrir o
  outro. É o único lugar do sistema onde subir `--respiracao-max` ou
  `--circulo-tamanho` tem consequência de layout. O `.palco` fica em `z-index: 6` **sempre**:
  indo e voltando a bola atravessa a faixa do painel (`z-index: 5`), e um
  `z-index` que sumisse com a classe esconderia metade do caminho de volta.

Dois efeitos colaterais do "sem corte" que são decisão, não descuido: o rótulo
"Como foi seu dia?" sai por `color: transparent` (a cor interpola; `font-size: 0`
era mais um corte) e continua no DOM como nome acessível do botão; e o `.brilho`
**continua respirando** minimizado — desligar a animação cortava a escala dela no
meio, e a 32% de tamanho a respiração não se vê. Do lado do React, o painel
sobrevive ao fechar por `DURACAO_CAIXA` (384 ms, o mesmo número da transição),
`inert` enquanto sai; sem isso a caixa encolheria vazia — mas só neste caminho,
pela razão que a seção seguinte explica.

##### A View Transition, e por que a de CSS continua aí

A transição acima é correta e simétrica, e ainda assim não era fluida. A caixa ia
do rodapé ao centro interpolando seis propriedades de **layout** — os quatro
`inset`, o `max-width` e o raio —, recalculadas a cada quadro, com uma lista
rolável dentro; e a bola e a caixa começavam juntas por coincidência de número
(320 ms cada), não por construção.

**Os números abaixo são 384 ms e 216 ms — 20% mais devagar que os 320 ms e
180 ms da primeira versão, a meu pedido.** O fator é o mesmo nos dois caminhos
da troca de modo (View Transition e o fallback de CSS) e em `DURACAO_CAIXA`:
os três precisam continuar lendo como um gesto só.

Onde o navegador tem a **View Transitions API**, a troca de `chatAberto` passa por
`src/client/transicao.ts`: o navegador fotografa o antes e o depois e morfa os
dois elementos nomeados — `circulo` no `.palco`, `caixa-chat` no `.chat` — do
ponto inicial ao de destino, no compositor, com uma linha do tempo só. Os dois
caminhos coexistem de propósito: **a View Transition não inventa estado nenhum**,
ela interpola até o que o CSS já declara, então `.tela.com-chat .palco` e
`.chat.aberto` continuam sendo os destinos, e a transição de geometria continua
sendo o percurso de quem não tem a API.

Quatro coisas que custam caro quando esquecidas, e que estão escritas no código:

- **`flushSync`** dentro do callback de `startViewTransition`. A foto do "depois"
  é tirada quando o callback termina; com o batch normal do React o DOM ainda não
  mudou nessa hora, as duas fotos saem iguais, nada anima, e a tela pula para o
  estado novo depois — um corte pior que o que havia antes;
- **`prefers-reduced-motion` é decidido em JS**, e não no CSS. Quem pediu menos
  movimento não entra na View Transition: volta ao caminho antigo inteiro, onde o
  `@media` do `globals.css` já resolve com `1ms`;
- **o `z-index: 6` do `.palco` não vem junto na foto.** No overlay da transição a
  ordem é a ordem do DOM, e a bola passaria por trás do painel na metade do
  caminho — o mesmo defeito que o `z-index` na regra base já tinha resolvido no
  caminho de CSS. Daí `::view-transition-group(circulo) { z-index: 2 }`;
- **a cauda de `DURACAO_CAIXA` sai do caminho.** Com View Transition a foto do
  antes já mostra o painel inteiro durante a volta toda; segurar o painel montado
  por mais 384 ms o põe dentro da foto do **depois**, por cima da barra. O efeito
  de `Chat.tsx` pula a cauda quando `usaTransicao()` é verdade — e a chamada mora
  dentro do efeito, porque no servidor não há `document` e ler isso na
  renderização divergiria da hidratação.

Dois ajustes que são de olho, não de cálculo: as fotos da caixa levam
`object-fit: cover` (sem isso os `...` da barra são esticados até o tamanho do
painel e viram um borrão), e a foto velha sai em 216 ms em vez de 384 ms, para o
meio da viagem não ficar turvo com os dois conteúdos sobrepostos.

**Manter a barra visível durante a gravação foi recusado.** Nem a `Gestao`, a
única porta de saída que já existia, tem esse privilégio — e a tela de gravar é
onde este projeto historicamente corta, não adiciona (ver o comentário sobre o
chip de recuperação removido em `Gravacao.tsx`).

**Com o chat aberto, o primeiro toque no círculo não grava.** Ele restaura o
círculo ao centro e fecha o chat; só o segundo toque começa a gravar. Um toque
só — fechar e já gravar — foi considerado, por ser o gesto mais parecido com o
"um botão, um toque" que rege esta tela, e recusado: começar uma gravação sem
querer, só tentando sair do chat, custa mais que um toque. O `Esc` segue a mesma
lógica em outra dimensão — com o agente respondendo ele **para a geração**, e só
fecha o painel quando não há nada em curso.

Dentro do painel: a lista de conversas (ativas, com as arquivadas atrás de um
separador que conta quantas são), o botão de nova conversa, a conversa aberta
com as mensagens, o campo de texto, e o "parar" no lugar do enviar enquanto o
agente trabalha.

**Abrir a barra é sempre começar do zero** — conversa nova, campo vazio, foco no
campo. **A slice 6 decidia o contrário** (abrir a conversa ativa mais recente na
primeira abertura de cada visita, para "toco de novo e continuo de onde parei"
ser verdade) e a **8.1 reverteu**: no uso deu o oposto, porque eu abro o chat
para perguntar uma coisa nova e caía no meio da conversa de ontem, com uma saída
a mais para dar antes de escrever. A decisão antiga nem se cumpria como
escrita — ela morava numa `useRef` por montagem do componente, e o `<Chat>` é
desmontado ao gravar e ao navegar, então "só na primeira abertura" virava "toda
vez". O que defende a conversa longa fechada sem querer é a lista, a um toque no
ícone do cabeçalho. Abrir e fechar sem perguntar não grava nada: o nó
`:Conversa` nasce no `POST /api/chat`, com a primeira pergunta.

**O teclado virtual encolhe a caixa do chat por baixo, e só ela** (8.1).
`.chat.aberto` é `position: fixed`, e fixed se posiciona contra o viewport de
**layout**, que o teclado do Android não encolhe — a caixa de escrever ficava
debaixo do teclado e eu digitava sem ver. `Chat.tsx` escuta `visualViewport` e
escreve `--teclado` **no nó da caixa**, e o `bottom` de `.chat.aberto` o soma ao
recuo seguro. A alternativa era `interactiveWidget: "resizes-content"` no
`layout.tsx`: uma linha, e consertaria os campos da revisão de brinde. Perdeu no
critério que a spec da 8.1 fixou — consertar o chat **sem mexer na tela de
gravar** —, porque o chat mora justamente nela: a bola minimizada é posicionada
por `translateY(calc(3.75rem - 50dvh))` e o halo, o véu e as gavetas medem em
`dvh`, e encolher o viewport de layout mexeria em todos eles no instante em que
o teclado sobe, com a bola visível. O preço do caminho cirúrgico é a dívida que
o projeto já tem em três lugares: mais um número que o JS e o CSS têm de manter
em sincronia.

O progresso aparece como uma linha por passo concluído ("buscou 'término' ·
sobre Isinha — 4 trechos"), e não como um carregando genérico: a espera de uma
pergunta composta é real, e fica opaca demais sem sinal nenhum. Cada resposta do
agente tem um **(i)** que abre o rastro completo — cada chamada, os parâmetros e
os átomos que voltaram, com tipo, data, entidades e similaridade.

#### O PWA, que é instalabilidade e tela cheia — e mais nada

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

Em toda tela dessa tabela menos `/` e `/entrar`, `Marca` fica fixa no canto
superior esquerdo e leva a `/`. É **só o ponto terracota** — o nome do projeto
não informa nada a quem já está dentro dele. O ponto tem 16 px, mas o link tem
40 px: alvo de toque menor que isso não se acerta num celular, e este é um app
de celular.

### 11.1 O botão de gravar

`BotaoGravar` é **um nó do DOM só**, parado e gravando. Antes eram duas árvores
diferentes — a de gravar trocava a tela inteira pelo timer — e por isso não
havia o que transicionar entre elas, só um corte. Agora o círculo permanece e o
que muda é o que o cerca: parado, as portas de serviço;
gravando, o timer, o "salvo" e o "parar".

O palco é um grid de uma célula com tudo empilhado (`.palco > * { grid-area: 1/1 }`):

- **o halo** (`.brilho`) é um disco da cor de acento atrás do botão, do mesmo
  tamanho: parado ele some por baixo, e ao respirar (escala 1 → 1,2 e raio
  24 px → 42 px, ciclo inteiro de ~7 s em `ease-in-out alternate`) aparece só a
  borda. O círculo cresce como peça só, com o texto parado no meio. O
  `background` dele não é decoração: sombra externa recorta a própria
  border-box, e sem fundo o anel entre o botão e a borda do halo ficava sem
  sombra **e** sem fundo — um anel preto pulsando em volta do círculo;
- **o círculo** é o botão, 220 px (`min(var(--circulo-guarda), var(--circulo-tamanho))`,
  a guarda de 72vw só para não estourar aparelho estreito), da cor de acento,
  texto branco de 18 px/500;
- **as ondas** são **três de cada lado**, num `<canvas>` absoluto. O bloco que o contém vira a própria
  célula do grid, ou seja a faixa vertical do círculo — é o que põe o eixo da
  onda no centro dele sem número mágico. Some e aparece por opacidade em 400 ms
  com `cubic-bezier(.16,1,.3,1)`;
- **o selo de REC** fica dentro do círculo, abaixo da pergunta, mas **fora** do
  `<button>`: o botão fica `disabled` durante a gravação e levaria o selo junto
  para fora do alcance de um leitor de tela. Entra deslizando 8 px, no mesmo
  tempo e na mesma curva das ondas.

#### A zona morta, e por que `--respiracao-min` não desce abaixo de 1

O disco tem **exatamente** o tamanho do botão e mora **atrás** dele. Isso quer
dizer que a escala do disco não é o que se vê: o que se vê é a largura do anel
que sobra para fora do botão, e ela só existe acima de `scale(1)`. Abaixo disso
o disco está inteiro escondido, e a animação continua rodando sem pintar nada.

Foi o defeito que a respiração teve entre os commits `659073e` e este. O pedido
de então era 30% menos área no fundo e 30% mais no topo; a conversão por área
(√0,7 e √1,3, porque área cresce com o quadrado da escala) deu `scale(0,837) →
scale(1,181)` e estava certa na aritmética. Só que ela foi aplicada à área do
**disco**, e o que a pessoa vê é a área do **anel**. Resultado medido na régua
do próprio keyframe: **47% de cada meia-volta acontecia com o disco invisível**,
e a `ease-in-out` — que espalha a fase lenta pelo intervalo inteiro — gastava
justamente a parte devagar lá dentro, atravessando depressa a faixa visível. O
`box-shadow` (24 px → 42 px) saiu de fase junto: metade do crescimento do glow
já tinha acontecido quando o disco assomava. Não respirava, piscava.

O conserto é o piso: `--respiracao-min: 1` põe o fundo do ciclo exatamente onde
o anel tem largura zero, e o ciclo inteiro passa a ser faixa visível. A amplitude
que era invisível virou amplitude de verdade, `1 → 1,2`, e o ciclo alongou para
~7 s para caber nela sem pressa. **O botão encolheu junto**, de 264 px para
220 px: no auge a respiração chega a 264 px, que é o tamanho que o círculo tinha
parado antes — o gesto ocupa o mesmo espaço de tela, e é o círculo em repouso que
ficou menor.

**O `72vw` continua sendo guarda, e não tamanho.** Num aparelho de 320 px é ele
quem impede o círculo de encostar nas bordas; lá o alvo de 220 px não é
alcançado e o círculo simplesmente fica menor.

#### Os controles

Nada disso é literal no CSS. O topo de `globals.css` tem um bloco `---- os
controles do tema ----` com oito propriedades, e a respiração inteira, o halo e
a cor do sistema saem dele:

| Controle | Padrão | O que faz |
|---|---|---|
| `--acento` | `#d65a31` | a cor do sistema inteiro |
| `--halo-intensidade` | `0.55` | 0 = sem halo, 1 = acento opaco |
| `--halo-raio-min` / `--halo-raio-max` | `24px` / `42px` | o desfoque da sombra nas duas pontas |
| `--respiracao-min` / `--respiracao-max` | `1` / `1.2` | a escala do disco |
| `--respiracao-rpm` | `8.6` | ciclos inteiros por minuto (8,6 ≈ 7 s) |
| `--circulo-tamanho` / `--circulo-guarda` | `220px` / `72vw` | o alvo, e o teto em aparelho estreito |

`--glow` e `--circulo` deixaram de ser valores e viraram derivados: o primeiro é
`color-mix()` de `--acento` com `--halo-intensidade`, o segundo é o `min()` dos
dois últimos. O glow era o **único** ponto do CSS onde o terracota estava escrito
duas vezes (`rgba(214, 90, 49, .55)`), e com ele derivado trocar `--acento` leva
o halo junto.

A duração sai do rpm por `calc(30s / var(--respiracao-rpm))` — 30 s e não 60 s
porque `alternate` faz um ciclo inteiro valer duas durações. A folga vertical do
`.palco`, que era `1.5rem` escolhido à mão para a amplitude de então, virou
`max(1.5rem, calc(var(--circulo) * (var(--respiracao-max) - 1) / 2))`: subir a
amplitude deixou de poder decepar o halo no overflow.

**Limite resolvido de graça:** as ondas nascem na borda do círculo e correm até a
borda da tela (`percurso = largura / 2 - raio`), e o círculo de 264 px havia
encurtado a corrida delas para ~43 px num celular de 390 px. Com 220 px o percurso
volta a ~65 px. O `raio` é medido em tempo de execução
(`circulo.current.offsetWidth / 2`), então `onda.ts` nunca precisou saber de nada
disso.

**Canvas, e não SVG animado**, porque a onda segue o microfone a 60 quadros por
segundo e reconstruir um path do DOM nessa cadência engasga no celular — que é
onde este botão vive. O `AnalyserNode` sai do `MediaStream` que o `Gravador`
agora expõe em `faixa`, e **não se liga ao destino**: ligar devolveria o próprio
microfone pelo alto-falante, que é microfonia na cara de quem está falando. Sem
Web Audio disponível, `nivelSimulado()` mantém a onda viva com duas senoides de
períodos incomensuráveis.

O laço de `requestAnimationFrame` **só existe enquanto grava**; parado, o halo
respira em CSS puro e nada fica de pé. O `AudioContext` é fechado ao parar —
um contexto vivo segura hardware de áudio e conta como microfone em uso.

A matemática mora em `src/lib/onda.ts`, fora do componente: é a única parte
desenhável que dá para testar sem canvas, sem microfone e sem navegador
(`tests/onda.test.ts`). O nível é RMS e não pico — pico pula com qualquer
estalo —, passa por média móvel exponencial, e a amplitude fica entre 15 px e
25 px. `envelope()` zera nas duas pontas: encostada no círculo a linha seria
cortada por ele, e na ponta precisa sumir em vez de ser decepada.

`CAMADAS` são as três linhas: amplitude e opacidade decrescentes — uma
principal com duas acompanhando, não três iguais disputando a faixa. Os ciclos
(3,55 · 4,25 · 3) foram **escolhidos por busca**, não a olho: em razão simples
as três se realinhariam a cada poucos segundos e o conjunto piscaria como uma
onda só, grossa. A razão mais próxima de um racional curto fica a 0,083 dele, e
o teste "os ciclos não estão em razão simples" é o que impede alguém de mexer
nesses números sem perceber.

`prefers-reduced-motion` para o halo no estado médio e tira o deslize do selo.
A onda continua, porque ali ela não é enfeite: é o retorno de que o microfone
está ouvindo. **"Estado médio" passou a custar uma linha a mais.** Enquanto a
amplitude era de 3,6%, `animation: none` bastava: sem animação o disco fica na
escala natural, que é 1. Com o piso da respiração agora em 1 e o teto em 1,2,
escala natural é o fundo do ciclo — o ponto onde o halo não existe —, e a regra
prometia um estado médio que entregava halo nenhum. Ela passa a calcular a média
dos dois extremos, na escala e no raio da sombra, a partir dos mesmos controles.

**O timer deixou de ser o herói.** Ele era `clamp(3rem, 16vw, 5rem)` porque era
o centro da tela; com o círculo nesse posto, ficou em 1,5 rem, tabular, no tom
de texto fraco. Continua na tela porque é informação real — quanto tempo eu já
falei.

### 11.2 Tokens de cor

Um lugar só, no topo de `src/app/globals.css`, e ele tem três camadas: o bloco
de **controles** (o que se mexe), os tokens de superfície (o que quase nunca se
mexe) e os **derivados** (o que não se mexe). Nada de cor literal em regra de
componente — quem precisa de uma variação usa `color-mix()` sobre o token.

Os controles estão tabelados em §11.1, junto com a respiração que a maior parte
deles governa. Aqui ficam os tokens de superfície e os dois derivados:

| Token | Valor | Onde |
|---|---|---|
| `--fundo` | `#0d0d0d` | fundo da tela |
| `--fundo-alto` | `#1a1a1c` | cartão, campo, chip |
| `--texto` / `--texto-fraco` | `#ececec` / `#8a8a8f` | texto e texto secundário |
| `--linha` | `#2a2a2e` | borda |
| `--sobre-acento` | `#ffffff` | texto **sobre** o acento — a única superfície que não usa `--texto` |
| `--status` | `#ffffff` a 0,7 | texto de status e ícone |
| `--rec` | `#ff4d3d` | o ponto vermelho do selo de REC |
| `--raio` | `14px` | o canto de cartão, campo e chip |
| `--ok` | `#6aa84f` | o ponto de "salvo" |
| `--glow` | *derivado* de `--acento` + `--halo-intensidade` | o halo do botão de gravar |
| `--circulo` | *derivado* de `--circulo-tamanho` + `--circulo-guarda` | diâmetro do botão de gravar |

`--acento` governa ~45 regras, todas por `var()` ou `color-mix()`. O único lugar
do CSS onde a cor estava escrita uma segunda vez era `--glow`
(`rgba(214, 90, 49, .55)` é o mesmo `#d65a31` em decimal), e trocar o acento
deixava o halo para trás — daí ele ter virado derivado.

`--fundo` e `--acento` mudaram de `#0f0f10` e `#d8613c` para os valores acima
quando o botão foi redesenhado; a diferença é pequena, e manter dois terracotas
quase iguais no mesmo sistema seria pior que trocar o antigo.

#### O tema fora do CSS

Três arquivos carregam cor que **nenhuma custom property alcança**, porque são
estáticos de build lidos pelo sistema operacional, não pelo navegador. Trocar o
tema pede passar neles à mão:

| Arquivo | O quê |
|---|---|
| `public/icone.svg` | `fill="#d65a31"` (o círculo) e `#0d0d0d` (o fundo) — o ícone do PWA |
| `src/app/layout.tsx` | `themeColor: "#0d0d0d"` na `metadata` — a barra do navegador |
| `public/manifest.webmanifest` | `background_color` e `theme_color`, os dois `#0d0d0d` |

São quatro linhas, e estão aqui para que a próxima troca de cor não deixe o
ícone do PWA em terracota com o resto do sistema em outra cor.

#### A única cor literal em regra de componente

`.selo-rec` tem `background: rgba(0, 0, 0, 0.18)`. Não é o `--fundo`: é sombra
sobre a cor que estiver embaixo, e embaixo dela está o acento, qualquer que ele
seja. Derivá-la de um token mudaria o resultado em vez de preservá-lo, então ela
fica — e fica anotada, para não parecer descuido.

**Phronesis é escuro, e só.** O bloco `prefers-color-scheme: light` saiu: um
segundo tema é uma segunda tela para manter certa a cada mudança, e o botão de
gravar foi desenhado sobre `#0d0d0d` — halo terracota sobre papel é outro
efeito, não o mesmo mais claro. `:root` declara `color-scheme: dark`, sem o que
o navegador desenharia os controles nativos (input, select, checkbox, barra de
rolagem) no tema claro do sistema em cima do fundo escuro.

### 11.3 Tipografia

Duas fontes, uma por natureza de tela:

| | Fonte | Telas |
|---|---|---|
| ritual | **Nunito** | `/`, `/sessao/:id`, `/sessao/:id/revisar` |
| gestão | **Inter** | `/sessao/:id/transcricao`, `/sessoes`, `/entidades`, `/calibracao`, `/agentes`, `/agentes/consulta`, `/entrar` |

Ritual é o que eu faço todo dia — falar, esperar processar, revisar. Gestão é
manutenção, e a transcrição literal está com ela de propósito: é porta de
serviço, não parte do ritual.

**`RITUAL` é allowlist, e é por isso que a tabela cresce sozinha do lado da
gestão.** `/calibracao` e `/agentes` nasceram nas fatias 4.6 e 4.7 e caíram em
Inter sem ninguém marcar nada, que é o comportamento certo: manutenção é
gestão, e uma tela nova que fosse ritual é que teria de ser declarada.

**A regra é por rota, não por classe CSS** (`src/lib/tipografia.ts`,
`ehRitual`). Não é preferência: `Processando` e a `Revisao` ainda carregando
renderizam `<main className="leitura">`, a mesma classe da tela de transcrição.
Pendurar a fonte na classe daria Nunito à transcrição **e** trocaria a fonte da
revisão no meio do carregamento. A rota não tem essa colisão, e tela nova nasce
com a fonte certa sem ninguém lembrar de marcá-la. Mesma forma de `mostraMarca`,
e fixada igual, por `tests/tipografia.test.ts` — o `$` dos padrões é o que impede
`/sessao/x/transcricao` de casar com o do corredor.

`Tipografia` (client) põe a classe `.ritual` ou `.gestao` em volta de
`{children}` no layout raiz. `usePathname()` resolve no SSR, então a classe já
vem no HTML e não há troca de fonte no primeiro quadro.

As duas fontes vêm de `next/font/google` no layout raiz, como variáveis CSS
(`--fonte-ritual`, `--fonte-gestao`). Elas são **baixadas na build e servidas do
próprio domínio**: nenhuma requisição a terceiros em tempo de execução, nada a
acrescentar na fronteira de segurança, e nenhum salto de layout. O stack do
sistema, que era a fonte do `body`, virou `--sistema` e é o fallback das duas.

`/entidades` é a única janela para dentro do grafo — até ela existir, saber o
que tinha lá dentro exigia rodar Cypher por fora. Procurar duplicatas e rascunhar
um perfil são botões, não coisas que acontecem ao abrir: a camada de string é de
graça, a que julga e a que escreve são chamadas de modelo, e manutenção que cobra
sozinha vira cobrança.
Ela não é painel da revisão de propósito — a revisão só vê as entidades da
sessão atual, e o orçamento dela é 60 s (visão §8).

#### A linha, a ficha e a fusão à mão

Cada linha carregava **nove controles**: a caixa do lote, o nome, a estrela de
canônica, uma meta de até seis fatos, o `select` de tipo, renomear, canônica e
ficha — num `flex` sem `wrap`. A ficha abria como acordeão dentro da própria
linha, empurrando a lista para baixo. Num aparelho de 390 px, que é onde este app
vive, nada disso se lê nem se acerta com o dedo. O que existe agora:

| Peça | Como é | Por quê |
|---|---|---|
| **a linha** | um nome (com a estrela) e uma linha de meta — átomos, sessões, "sem resumo" e o selo da fila. A linha inteira é o botão | um alvo só, grande, e nenhuma decisão a tomar antes de tocar |
| **a ficha** | painel `position: fixed` entrando pela **direita**, tela cheia no celular (`min(100vw, 34rem)`), fechando no `←`, no véu e no `Esc` | é o detalhe do que eu acabei de tocar, não navegação — mesma razão e mesmo lado do `.editor-agente` |
| **o topo** | busca, filtro de tipo e "sem resumo" | a lista vem inteira do grafo, e sem busca achar uma entidade é rolar |
| **o lote** | "enriquecer" é um **modo**: só nele existem checkboxes, e a barra de "selecionar todas" fica `sticky` | os checkboxes eram permanentes, e uma coluna deles em toda linha cobra uma decisão que eu quase nunca tomo |
| **fundir** | `fundir com…` dentro da ficha: escolher, comparar lado a lado, escolher quem sobrevive | a rota sempre aceitou qualquer par; era a tela que só sabia propor o que a distância de string tinha aproximado |

**A busca é a de `src/lib/catalogo.ts`, e não uma segunda.** `peneirar()` chama
`montarCatalogo` + `buscar` e depois reencontra o objeto inteiro por
`nome_normalizado` — o catálogo carrega só o subconjunto que a revisão usa.
Escrever um `filter` por nome aqui criaria uma segunda regra de busca para
divergir da primeira, e perderia o que aquela tem de específico: ela acha por
trecho no meio da palavra e **atravessa alias**, que é o que faz digitar a grafia
antiga cair na vencedora da fusão.

**Sem termo a ordem é a de mais falada** (átomos decrescente, desempate pelo
nome), e não a que a rota devolve — `canonico DESC, sessoes DESC, nome` é boa
para desempate de agente e ruim para o olho. **Com termo, quem manda é a
relevância** de `porRelevancia` (prefixo antes de trecho no meio): reordenar por
volume ali jogaria o casamento quase exato para o meio da lista.

**A barra do lote gruda em `top: calc(3.25rem + env(safe-area-inset-top))`, e não
em `0`.** A `.marca` é `fixed` em `0.6rem` com 40 px de altura; uma barra
encostada no topo passaria por baixo dela e esconderia o caminho de volta atrás
do controle do lote. E "selecionar todas" marca **o que está na lista agora**, não
o grafo inteiro: com um filtro ligado, marcar o que não está à vista é surpresa,
e o que sai daí é uma conta de modelo.

**A fusão à mão custa três passos de propósito.** Fundir não tem desfazer
(`src/lib/fusao.ts`), então a tela escolhe com quem, compara as duas lado a lado
— nome, tipo, átomos, sessões, perfil e resumo — e só então pergunta quem
sobrevive. A comparação diz em texto as duas coisas que não se adivinham da tela:
que isto é irreversível, e que **o resumo e o perfil da perdedora não são
copiados** — só as arestas `:SOBRE`, `:MENCIONA` e `:PERFILA` migram. Sem isso eu
escolho o vencedor errado e perco a ficha boa sem saber que perdi. Depois de
fundir, o painel **reaponta para a vencedora**: a perdedora sai da listagem no
mesmo instante (`status='fundida'`), e uma ficha aberta num nó que sumiu mentiria
até eu fechá-la.

**A ficha é a terceira gaveta desta forma** — `.gaveta` (gestão, pela esquerda),
`.editor-agente` (agentes, pela direita) e `.ficha`. As três repetem a mesma
geometria, a mesma curva de 220 ms, o mesmo `env(safe-area-inset-*)` e o mesmo
`.veu` (esse já é compartilhado). **Consolidá-las numa `.gaveta-lateral` é dívida
conhecida**, e não foi feita aqui porque mexeria em `Gestao.tsx` e em
`Agentes.tsx`, fora do escopo desta mudança.

O painel fica **montado sempre**, com a classe `.aberta` ligando e desligando, e
o React segura o conteúdo por `DURACAO_FICHA_MS` (220 ms, o mesmo número da
transição) depois de fechar. Desmontar junto com a classe esvaziaria a caixa no
meio do caminho de volta — é o mesmo erro que o `.chat` cometeu e consertou.

**A volta ao início é a marca, no canto superior esquerdo.** `Marca` mora no
layout raiz — nenhuma tela nova nasce sem caminho de volta — e é ela que decide
onde não aparecer: em `/`, que já *é* o início e é a tela de gravar, onde nada
crônico entra (visão §6), e em `/entrar`, que é anterior à sessão. `mostraMarca()`
é a regra, e `tests/marca.test.ts` a fixa. Ela é `position: fixed`: numa revisão
longa ou numa lista grande de entidades, um "voltar" de rodapé só existe depois
de rolar a tela inteira. Os "voltar → `/`" que ficavam no fim de `Sessoes`,
`Entidades`, `Processando` e da falha da `Revisao` saíram, por duplicarem a
marca. Ficaram os dois que não são ela: o "voltar" da `Leitura`, que vai para
`/sessoes` (de onde se chega), e o "depois" no rodapé da `Revisao`, que é adiar
a revisão, não navegar.

`Processando` é quem dispara `finalizar`, uma vez só (`useRef`), depois de
garantir a fila vazia; faz o polling de 2 s e, ao ver `em_revisao`, troca a URL
por `/sessao/:id/revisar` com `replace` — voltar de um corredor já atravessado
não faz sentido, o botão de voltar tem que sair da sessão.

**A transcrição saiu da jornada.** Ela era a tela que a gravação abria, com o
texto inteiro e um link para revisar; agora é `/sessao/:id/transcricao`, sem
finalizar nada e sem redirecionar, alcançável pelo botão "transcrição" na lista
de sessões, ao lado de "reextrair". Serve para conferir o literal — um nome que o
STT grafou errado, um trecho que ele comeu. `destino()` em `Sessoes` manda cada
linha para onde ainda há o que fazer: revisão se há proposta esperando,
transcrição se o texto já está inteiro, processamento no resto.

**A home não avisa nada, e a lista avisa pela cor.** Havia um `ChipRecuperacao`
na tela de gravar que aparecia sempre que existia sessão aberta e, num dos seus
dois estados, cobrava: "sessão de 12 min esperando revisão". Cobrança na tela
onde eu passo o tempo é a forma de morte da visão §6, e o chip era o único
elemento crônico que restava ali. Ele saiu inteiro.

O que ficou no lugar é `jaRevisada(s)` em `Sessoes`: a linha de uma sessão
`confirmada` sai em `--ok`, o mesmo verde do ponto de "salvo" da gravação, e o
resto da lista fica no branco de `--texto`. Não há classe para "falta revisar" —
uma marca em cada linha não marca nada —, e a legenda vai no cabeçalho, senão a
cor é adivinhação. `confirmada` é o único estado terminal da máquina (seção 5), o
que faz o verde querer dizer exatamente uma coisa; `tests/sessoes-lista.test.ts`
fixa isso, porque pintar de verde uma sessão que ainda tem trabalho é pior que
não pintar nada.

O nome da porta acompanhou: "áudios" virou **"sessões"**, que é como a coisa se
chama no resto do sistema (`:Sessao`, `/sessoes`, `sessao_id`). Áudio é o
arquivo; sessão é o que eu abro ali.

## 12. Ambiente

`next build` passa a precisar de **rede**: `next/font/google` busca Inter e
Nunito na hora da build para servi-las do próprio domínio (§11.3). Em tempo de
execução não há requisição a terceiros.

### 12.1 Produção, e os dois bancos

O sistema roda na Vercel, plano Hobby, em **`https://phronesis-ang.vercel.app`**,
a partir do repositório privado `angbcastro/phronesis`. `phronesis-ashy.vercel.app`
foi o primeiro endereço e hoje **redireciona** para o canônico (307, que preserva
método e corpo) — ele continua na política de CORS porque um link velho aberto no
celular passa por lá antes de chegar aqui. Push em `master` vai a
produção direto: **não há CI**, e a única rede é o `buildCommand` (abaixo)
derrubar o deploy quando a migration falha.

**O que o primeiro deploy provou**, e que só produção responde: a migration roda
no build (as dez, `010` com 0 statements como esperado, e de novo idempotente no
deploy seguinte); o middleware **lê os segredos no Edge** — conferido mandando
cookie forjado e `Bearer` errado, que forçam a leitura de `AUTH_SECRET` e
`CRON_SECRET` e voltaram 307 e 401 em vez de 500; o Resend entrega o link; e a
batida diária escreveu `backup/grafo-12.json` com 95 nós do grafo real.

**Os 300 s de `maxDuration` cabem no Hobby.** Com Fluid Compute — ligado por
padrão em projeto novo — o Hobby tem 300 s de padrão *e* de máximo, que é o teto
das quatro rotas pesadas (`/chunks/[i]/pronto`, `/finalizar`, `/extrair`,
`/entidades/enriquecer`) e o que cobre os `waitUntil(passadaDeVetores(...))` das
dez rotas de `/entidades`. Nada aqui pede plano pago. A **região da função**
acompanha a da instância Aura: cada requisição do pipeline faz várias idas à
Query API, e região trocada multiplica isso por round-trip.

```json
// vercel.json
{ "buildCommand": "pnpm migrate && next build",
  "crons": [{ "path": "/api/cron/diario", "schedule": "0 6 * * *" }] }
```

**A migration roda no build**, contra o banco do ambiente daquele deploy, e a
aprovação passou a ser o ato de mandar buildar o commit que a contém (`CLAUDE.md`).
Versionado, e não escondido no painel: o comando que aplica schema em produção tem
de estar à vista. `scripts/migrate.ts` é TypeScript rodado direto pelo node, por
type stripping — daí `engines.node: ">=22.6"` no `package.json`.

Dois bancos e dois buckets, e a precedência do Next decide qual vale sem ninguém
precisar lembrar:

| Arquivo | Aponta para | Quem lê |
|---|---|---|
| `.env.development.local` | Aura **dev** + bucket **dev** | `pnpm dev` (precedência) e `pnpm migrate:dev` |
| `.env.local` | **produção** | `pnpm migrate` e `pnpm smoke` — a saída de emergência |

O Next mescla por chave, então **variável que faltar no arquivo de dev vaza do de
produção**: os três do Neo4j e o `R2_BUCKET` têm de estar todos no de dev, ou
`pnpm dev` escreve no diário de verdade com a senha certa. Na Vercel o mesmo
cuidado é o **escopo** da variável: Neo4j e R2 de produção só em Production, os de
dev em Preview/Development — com migration rodando no build, escopo errado faz um
preview migrar produção.

```
NEO4J_QUERY_URL, NEO4J_USER, NEO4J_PASSWORD
R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
AI_GATEWAY_API_KEY
AUTH_SECRET, ALLOWED_EMAIL
RESEND_API_KEY            entrega do magic link (§7) — não é chave de modelo
CRON_SECRET               o header da batida diária (§7, §10)
```

```
NEO4J_QUERY_URL, NEO4J_USER, NEO4J_PASSWORD
R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
AI_GATEWAY_API_KEY        única chave de modelo — STT, extração, resolução, desempate, perfil, enriquecimento, deduplicação, embedding, calibração, confronto, chat, título
STT_MODEL                 opcional; padrão xai/grok-stt
EXTRACAO_MODEL            opcional; padrão deepseek/deepseek-v4.1-flash
DUPLICATAS_MODEL          opcional; padrão deepseek/deepseek-v4.1-flash
RESOLUCAO_MODEL           opcional; padrão igual ao da extração
DESEMPATE_MODEL           opcional; padrão igual ao da resolução
PERFIL_MODEL              opcional; padrão igual ao da extração
ENRIQUECIMENTO_MODEL      opcional; padrão igual ao da extração
CALIBRACAO_MODEL          opcional; padrão igual ao da extração
CONFRONTO_MODEL           opcional; padrão igual ao da extração
CHAT_MODEL                opcional; padrão igual ao da extração — é quem precisa de tool-calling multi-passo
CHAT_TITULO_MODEL         opcional; padrão igual ao do chat
EMBEDDING_MODEL           opcional; padrão openai/text-embedding-3-small — TEM que ser de 1536 dimensões
AUTH_SECRET, ALLOWED_EMAIL
```

`env.ts` usa getters: a variável só é exigida quando alguém de fato precisa dela,
e a falta vira erro claro em vez de `undefined` silencioso.

**Três variáveis são lidas por acesso estático, e isso não é estilo.** `req()` lê
por chave dinâmica (`process.env[nome]`), o que basta em função Node — mas o
**middleware roda no Edge**, e lá o bundler só garante o que consegue ler
estaticamente. `AUTH_SECRET`, `ALLOWED_EMAIL` (que vem no mesmo getter) e
`CRON_SECRET` são lidas como `process.env.NOME` escrito por extenso, por
`exigir()`. Conferido no bundle: a forma sobrevive como acesso estático e o valor
**não** é inlinado — o segredo não viaja dentro do artefato. Uma leitura dinâmica
ali é a diferença entre o sistema responder e nada responder, sem causa visível
em lugar nenhum.

**`next.config.mjs` decide se o vocabulário chega à produção**, e por isso não é
arquivo de configuração qualquer:

```js
outputFileTracingIncludes: {
  "/api/sessoes/[id]/chunks/[i]/pronto": ["./config/vocabulario.txt"],
  "/api/sessoes/[id]/finalizar": ["./config/vocabulario.txt"],
},
```

`vocabulario.ts` lê o arquivo do bundle em runtime
(`readFile(join(process.cwd(), "config", "vocabulario.txt"))`). Sem a entrada
correspondente, o arquivo **não viaja** na função da Vercel e `doArquivo()` cai
no `catch` que devolve lista vazia: sem erro, sem log, sem nada na tela. É o
segundo caminho para o modo de falha que §4.4 e §14 descrevem como o pior deste
sistema — o vocabulário sumir sem avisar —, e ele não tem nada a ver com trocar
`STT_MODEL`.

A lista está correta hoje porque `transcrever()` só é alcançada por essas duas
rotas (`/chunks/:i/pronto` direto, `/finalizar` via `finalizarSessao`). **Uma
terceira rota que chame o STT perde o arquivo em silêncio**, e não há teste que
cubra isso.

**Desde a slice 4.7, `/agentes` fica por cima destas variáveis** (§4.13): o modelo
escolhido no painel vence a variável de ambiente, que por sua vez vence o padrão.
A validação é a mesma nos três caminhos — `validarIdDeModelo`, string
`provedor/modelo`, pelo Gateway. `EMBEDDING_MODEL` é a exceção e continua sendo
só variável: a dimensão está declarada na migration 006.

Não há chave de provedor (`OPENAI_API_KEY`, `XAI_API_KEY`, `STT_API_KEY`,
`LLM_API_KEY`…) — seção 4.2. `tests/gateway.test.ts` também confere isso no
`.env.example`, para o arquivo não voltar a oferecer o que a arquitetura proíbe.

## 13. Verificação

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
  tentativas dividem o mesmo `ate`**, porque dar 120 s novos à segunda levaria o
  pior caso a 390 s sob um `maxDuration` de 300 s.
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
- **Bater numa rota do dev server pela porta da frente.** O middleware barra tudo
  sem cookie, e fora de produção `POST /api/auth/link` devolve o magic link **no
  corpo da resposta** (`route.ts`, a função `entregar`). Então: pede o link com o
  `ALLOWED_EMAIL`, segue o link para receber o cookie, e usa o cookie nas
  chamadas seguintes. É o que permite verificar rota de verdade sem forjar token
  e sem `pnpm build` — que aliás não pode rodar com o dev server de pé, porque os
  dois compartilham o `.next`.
- **Validar Cypher sem escrever nada:** prefixar a consulta com `EXPLAIN` faz o
  Aura planejar sem executar, o que pega erro de sintaxe e de schema contra o
  banco real. Foi assim que as escritas da slice 3 foram conferidas antes de
  existir dado para exercitá-las.
- `scripts/dev.ps1` (Windows; atalho **Phronesis** na área de trabalho, recriável
  por `scripts/atalho.ps1`) — sobe o `pnpm dev` do jeito certo: recusa-se a subir
  um segundo servidor quando a 3000 já responde (o Next escolheria outra porta e
  o CORS do bucket, que libera só a 3000, barraria o upload em silêncio), abre o
  navegador quando a porta atende e espelha a saída em `logs/dev-<data>.log` —
  o `2>&1` fica a cargo do `cmd`, porque redirecionado pelo PowerShell cada linha
  de stderr viraria um `NativeCommandError` no meio do log.
- `pnpm smoke` — o que os testes unitários não alcançam: credencial, assinatura,
  CORS e uma transcrição de verdade (usa um `.webm` já gravado do bucket, ou
  `SMOKE_AUDIO=<caminho>`). É o script que responde se o Gateway aceita
  webm/opus, se vêm timestamps por palavra e se o `keyterm` passa adiante.
- `pnpm probe:raciocinio` — mede se dá para pedir a um modelo que pense menos, e
  sob qual nome de opção. **Não é passo de rotina**: o sistema não limita o
  pensamento (§4.4), e a sonda existe para o dia em que a pergunta voltar em
  outro `EXTRACAO_MODEL`. `PROBE_SO=<trecho>` roda só as opções que casam, sem
  gastar o rate limit da conta com a lista inteira; `PROBE_PROVEDOR=<nome>`
  repete tudo sob a chave do provedor que de fato atendeu.
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
- **Ler o índice cru depois de confirmar uma sessão de verdade.** É a verificação
  que nenhum teste substitui, porque o que se confere é se as correções que
  aparecem lá são as que eu de fato fiz. `calibracao/indice.json` se abre no
  object browser do bucket no painel da Cloudflare; `sessoes/<id>/correcoes.json`
  guarda a mesma coisa recortada por sessão. Índice ausente depois de uma
  confirmação com correção significa `waitUntil` perdido — o log traz
  `[calibracao] sessão <id>`.
- O que o confirmar escreveu agora se vê em `/entidades`. Para o detalhe do
  átomo ainda é Cypher à mão no console do Aura:

  ```cypher
  MATCH (s:Sessao)-[:GEROU]->(a:Atomo)-[:SOBRE]->(e:Entidade)
  RETURN a.tipo, a.texto, e.nome, a.inicios_s, a.prompt_version, a.modelo
  ```

  E as marcas de perfil que a slice 4 grava (critério 6):

  ```cypher
  MATCH (a:Atomo)-[p:PERFILA]->(e:Entidade)
  RETURN e.nome, p.campo, a.texto, a.valido_em ORDER BY e.nome, p.campo
  ```

## 14. Limites conhecidos

- **O penhasco virando erro troca uma proposta ruim por nenhuma proposta** (8,
  §4.18). Uma sessão que antes entregaria nove átomos por um passe único sobre a
  transcrição inteira passa a parar e pedir re-extração. É a troca deliberada:
  aquele passe custava 1–2 min **em silêncio**, e eu o pagava sem saber. O que
  reduz a frequência é a espera pelo lease vivo, que era o gatilho mais comum — o
  que sobra é janela genuinamente presa, que é defeito.
- **O lease do bloco troca recuperação rápida por não pagar duas vezes** (8,
  §4.18). Se o `waitUntil` que reivindicou um bloco morrer, o laço de
  `finalizarSessao` espera os 120 s do lease antes de tentar — e ele só tem 150 s
  de orçamento. Antes ele retranscrevia na hora, pagando o STT duas vezes no caso
  comum para recuperar depressa no caso raro. A troca foi feita de olho aberto, e
  o sinal de que ela doeu seria `espera_blocos` alto com `stt` baixo no
  `medidas.json` — que é exatamente o que a primeira metade da fatia existe para
  mostrar.
- **O número da medida inclui a rede** (8, §4.17), então duas sessões não são
  estritamente comparáveis: o mesmo pipeline num 4G ruim e num Wi-Fi bom dá
  números diferentes. É o preço deliberado de medir o que eu sinto em vez do que
  é estável — e o detalhe por passo é o que separa "a rede estava ruim" de "a
  resolução ficou lenta".
- **A medida é mais um objeto por sessão a manter em dia** (8). Se um passo novo
  entrar no pipeline e ninguém instrumentar, o registro passa a mentir por
  omissão — a mesma doença do documento desatualizado, agora em JSON. A defesa é
  `PASSOS_MEDIDOS` ser lista fechada: um passo que falta é uma linha que falta e
  se vê, não um campo livre que cada chamador inventa. Não há teste que pegue
  isto; o que pega é olhar o objeto depois de uma sessão real.
- **A medida confia no relógio do navegador.** As três marcas vêm de
  `Date.now()` do telefone, e um ajuste de NTP no meio da espera aparece como
  número errado. A guarda é mínima e declarada: marca fora de ordem vira `null`
  em vez de número negativo, e epoch implausível é descartado na rota. Num
  sistema de um usuário isso basta; o que não dá para fazer é misturar esse
  relógio com o do servidor, e nada no código mistura.
- **Uma invocação que morre perde a medida dela.** A escrita acontece no fim do
  `waitUntil`, uma vez, e um `waitUntil` que estoura o `maxDuration` não grava
  nada daquele pedaço. A alternativa — gravar a cada passo — custaria uma ida ao
  R2 por bloco para proteger justamente o caso em que o registro importa menos,
  porque a sessão também falhou.
- **A tela de entidades ficou meio a meio** (8.1). Marcar canônica remenda só
  aquela entidade no estado local; as outras dez (fundir, tipo, criar, renomear,
  perfil, resumo, aliases, enriquecer uma, enriquecer as marcadas, desfazer)
  continuam terminando em `carregar()`, que refaz `GET /api/entidades?perfil=1`
  inteiro e redesenha a lista e a ficha — o que dá a impressão de a página pular
  para o topo. A inconsistência é declarada e tem data de validade: começou pela
  estrela porque foi a que incomodou, e o uso diz se e quando as outras vêm.
- **A busca de `/entidades` é no cliente, sobre a lista inteira.**
  `GET /api/entidades` não tem `LIMIT` e nunca teve; `peneirar()` filtra em
  memória o que a rota já mandou. É de graça e instantâneo enquanto o grafo
  couber numa resposta — e o dia em que não couber, a saída é a mesma que §8 já
  registra para o catálogo: um índice full-text no Neo4j, e a busca passa a ser
  uma rota. O sinal de que chegou a hora é a própria tela demorando a abrir.
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
- **Bloco vazio por defeito do provedor é indistinguível de silêncio** (§5.4).
  Desde 09/09 um bloco sem transcrição vira bloco vazio em vez de derrubar a
  sessão, e um tropeço do STT que devolva nada passaria por pausa. O único sinal
  é a linha `[pipeline] … STT não ouviu fala` no log, uma por bloco vazio; não
  há checagem de energia do áudio antes de aceitar o vazio, e não vai haver
  enquanto o log bastar.
- **O perfil passa a ser escrito sem revisão prévia** (4.12). É a reabertura
  consciente do que o §4.9 declarava: ficha errada contamina toda atribuição
  futura, e o erro se realimenta. A defesa deixou de ser "nada entra sem o meu
  toque campo a campo" e passou a ser: eu escolho quem entra na fila, eu leio a
  ficha depois, e o desfazer está a um toque. **A regra 5 do `CLAUDE.md` continua
  valendo inteira** — ela fala de átomo, e nenhum átomo entra no grafo por este
  caminho. O defeito mais caro que este sistema pode ter é uma afirmação na ficha
  que nenhum átomo sustenta, porque ela passa a decidir atribuição; quem procura
  por isso sou eu, lendo a ficha depois de o lote rodar.
- **Uma geração de desfazer** (4.12). Rodar o lote duas vezes seguidas na mesma
  entidade perde o texto original: o `_anterior` da segunda rodada é o resultado
  da primeira. É o preço declarado de não guardar histórico.
- **Entidade muito falada pode não caber na janela do modelo**, e nesse dia ela
  falha e não escreve nada (4.12). Sem tratamento, por escolha: dividir em partes
  e fundir as parciais é trabalho adiantado para um problema que este grafo não
  tem. O sinal é `falhou` com o motivo na linha dela.
- **O custo do lote cresce com o quadrado do uso** (4.12): mais átomos por
  entidade, e mais entidades. Selecionar todas num grafo grande é uma conta que
  ninguém mede antes de disparar — a tela diz quantas foram marcadas, não quanto
  vai custar.
- **A reivindicação da fila é mais fraca que a trava do manifest** (4.12). Lá o
  `If-Match` do R2 é garantido pelo serviço; aqui é um `MATCH ... SET`, e Neo4j
  avalia o `WHERE` **antes** de tomar o lock da escrita — duas invocações
  simultâneas do elo podem, na janela de milissegundos entre as duas, reivindicar
  a mesma entidade. A fila é sequencial por construção, então isso só acontece se
  eu apertar o botão duas vezes; e o custo de perder a corrida é uma chamada de
  modelo repetida com a mesma ficha ao fim, que é o que a idempotência da fatia
  já declara.
- **Um elo que morre entre gravar a ficha e marcar `pronta`** deixa a entidade em
  `rodando` até a retomada. A ficha já está escrita, e a próxima rodada a
  reescreve a partir dos mesmos átomos: não há perda, só trabalho repetido.
- **Se o encadeamento cair, a fila para calada.** O `waitUntil` do elo pode
  morrer, e o cookie repassado pode expirar no meio de uma fila longa. O que
  sobra é a linha `[fila]` no log e as entidades paradas em `na fila` na tela; o
  conserto é apertar o botão de novo, e a retomada pega o que ficou em `rodando`.
  **Nenhum aviso mora fora de `/entidades`** — notificação de PWA seria o
  primeiro uso de push neste sistema, e foi recusada por agora.
- **A fila é varrida sobre o catálogo inteiro em memória**, mesmo limite que a
  4.11 já declara para o casamento exato, e pelo mesmo motivo: sem índice, por
  cota do Aura Free.
- **A segunda passada só encolhe quando os resumos identificarem.** Entre a 4.11
  e a 4.12 quase toda menção passava por ela, porque resumo vazio derruba a
  confiança; a 4.12 escreve os resumos, mas **quem diz se eles bastam é o log**.
  `[desempate]` calado na maioria das menções é o número que fecha a fatia; se
  ele continuar disparando em tudo com as fichas escritas, o resumo não está
  identificando, e o conserto é o prompt do agente 4.
- **A confiança é auto-relatada** (4.11). O modelo diz o quanto confia; ninguém
  verifica. Um modelo que devolva 0,9 para tudo torna o limiar decorativo, e o
  sinal disso é a linha `[desempate]` **sumir** do log enquanto os resumos ainda
  estão vazios. Não há calibração automática: quem olha sou eu, e a pergunta que
  decide se o desenho serve é "menção que voltou 0,9 estava certa?".
- **Se a segunda passada concordar com a primeira em 100% dos casos, ela está
  pagando uma chamada para não fazer nada** (4.11) — e a conclusão seria que o
  perfil inteiro não era o que faltava. É a terceira coisa a olhar numa sessão
  real, ao lado do volume da lista e da voz do átomo.
- **O `resumo` corta em 500 no servidor** (4.11). Texto colado maior que isso
  perde o fim sem aviso, como o perfil fazia em 300.
- **A migration 009 apagou nós** — a primeira deste projeto que apaga alguma
  coisa. O que ela apagou não tinha átomo, perfil nem label de tipo; um
  `:DISTINTA_DE` apontando para um nó de grafia teria ido junto no `DETACH
  DELETE`, e no grafo em que ela rodou não havia nenhum.
- **A importação passa a custar 35 chamadas de STT em vez de 1** (4.10),
  concentradas em cerca de um minuto em vez de espalhadas por dezessete. É o
  preço declarado de ter um caminho só; `BLOCOS_SIMULTANEOS = 2` mais a espera de
  `comEsperaDeLimite` são a mitigação, e é a **medição** da primeira importação
  real que diz se ela basta. Se não bastar, a saída registrada é o bloco de 2
  min: 9 chamadas, ao custo de generalizar `offsetDoBloco` e `janelasDe`.
- **Trinta e cinco costuras na transcrição importada, onde antes havia zero**
  (4.10). Arquivo inteiro não corta palavra ao meio; blocos de 30 s cortam em 35
  lugares. A gravação sempre pagou isso; a importação passa a pagar, e em troca
  ganha a janela e o RAG por bloco.
- **Os bytes subidos pela importação crescem ~10×** (4.10). WAV 16 kHz mono são
  ~960 KB por bloco, ~34 MB numa sessão de 17 min, contra ~3 MB do opus
  original. Sai caro no 4G. WebCodecs resolveria, ao custo de dependência nova e
  suporte irregular no Safari (§3.0).
- **Navegador que não decodifica o formato volta ao bloco único — e em silêncio**
  (4.10). `fatiarArquivo` devolve `null`, a importação sobe o arquivo inteiro e a
  janela fica inerte de novo. **Nada na tela distingue** uma importação fatiada de
  uma que caiu no fallback: o log é o único lugar onde a diferença aparece
  (`[fatiador]`, e depois a ausência das linhas `[janela]`).
- **Sessão descartada deixa átomo apontando para o vazio** (4.10). O nó
  `:Sessao` e os átomos continuam no grafo (regra 6), e `audio_key` e
  `transcricao_key` passam a apontar para objetos que não existem mais — o player
  da revisão e o da calibração dão 404 num átomo de sessão apagada. Consequência
  aceita, não descuido.
- **Sessão largada em `gravando` não tem botão de apagar** (4.10). A guarda é
  `terminouDeProcessar`, e ela existe para não correr com um `waitUntil` vivo
  (§10). Sessão sem bloco nenhum já não aparece na lista; a que subiu um bloco e
  foi abandonada fica lá até alguém finalizá-la.
- **As correções de uma sessão descartada continuam em `calibracao/indice.json`**
  (4.10), e isso é deliberado: correção é material de calibração, não dado de
  sessão, e apagá-la seria desaprender. O efeito colateral é que o áudio à mão da
  tela de calibração deixa de tocar para essas linhas.
- **Proposta salva de resposta cortada pode estar incompleta** (4.10), e não há
  como saber o que faltava: o modelo foi interrompido, não perguntado. O aviso na
  revisão é a única defesa, e quem julga a lista sou eu.
- **`HISTORIA` puxa contra a disciplina de volume, e as duas moram no mesmo
  prompt** (007). Uma seção manda destilar e não passar de 10 a 20 átomos; a
  outra manda não resumir o episódio. O extrator decide sozinho qual das duas
  vale para cada trecho, e o modo de falhar é conhecido de antemão nos dois
  sentidos: `HISTORIA` que engole o dia inteiro (uma janela que devolve um átomo
  gigante e nada mais), ou `HISTORIA` que nunca aparece porque a regra de volume
  venceu. Nenhum teste pega isso — é qualidade de extração, que eu avalio à mão
  na revisão, sessão real por sessão real —, e o conserto, se for preciso, é uma
  regra aprovada em `/calibracao`, não código.
- **As empresas que já estão no grafo continuam `:Pessoa`** (007). A migration
  não reclassifica nada: reclassificar em massa exigiria adivinhar quais nós são
  organizações, e "Adapta" ou "Exxmed" só são óbvias para quem conhece o diário.
  O conserto é `/entidades`, um nó por vez, e até eu passar por lá o filtro de
  tipo da revisão e do seletor mente sobre esses nós.
- **O prompt de cinco agentes passou a ter duas fontes.** O git tem a base; o R2
  tem o que eu editei em `/agentes` (§4.13). É o mesmo custo que a 4.6 já tinha
  declarado para as regras, agora multiplicado: `git revert` sozinho não reverte
  mais o prompt inteiro, e ler o prompt efetivo exige os dois lugares. O
  `prompt_version` e os snapshots imutáveis impedem a procedência de mentir, e
  `voltar ao original` é um toque — mas quem olhar só o repositório vai ver a
  metade do texto.
- **O painel não guarda histórico de edição.** `config/agentes.json` tem o que
  vale agora; os snapshots por hash guardam os textos, e não a ordem em que eu os
  escrevi. Não há linha do tempo nem desfazer de mais de um passo — o `anterior`
  do snapshot dá para andar para trás lendo, e nada na tela faz isso.
- **Trocar `STT_MODEL` pelo painel pode calar o vocabulário sem avisar.** O canal
  de nomes próprios existe só em alguns provedores (§4.4), e a tela agora deixa eu
  escolher um que não o tem. Ela avisa quando isso acontece — é o que
  `provedorAceitaVocabulario` faz na caixa do STT —, mas não impede: qual modelo
  transcreve melhor é medição minha, não regra de código.
- **`db.index.vector.queryNodes` está deprecado a partir do Neo4j 2026.04**, em
  favor da cláusula `SEARCH`. A instância é 5.27 e o procedimento funciona; quando
  a Aura subir, é uma linha a trocar em `entidades.ts`.
- **A camada 3b herda atribuição passada.** Ela sugere por semelhança com átomos
  que já são de alguém, então um erro de atribuição pode sugerir o próximo.
  Mitigado pelo `porque` na tela — um voto entre `k`, com o átomo à mão —, não
  eliminado. **E a mitigação passou a custar um toque**: desde que as fontes
  viraram modal (§4.7), a evidência está a um `ⓘ` de distância em vez de à vista.
  O ícone só aparece onde há o que ver, que é o que impede a evidência de sumir
  de vez — mas herança que eu não abro é herança que eu não confiro.
- **O `motivo` do agente 2 não aparece em tela nenhuma.** A linha de dúvida virou
  `acho que é X — confirma?` (§4.7) e o modal de fontes mostra a camada e as
  citações, não o motivo. O campo continua sendo escrito pelo agente, gravado em
  `extracao.json` e lido por `referencias.ts`; o que não existe é caminho de UI
  até ele. Quando uma atribuição surpreender, é no JSON que se olha — e é por
  isso que este item está escrito aqui, e não descoberto de novo daqui a um mês.
- **Entidade nova, sem perfil e sem átomo, é invisível às duas camadas
  semânticas.** Só a string a acha. É estado transitório por construção — criar um
  nome pede escrever o perfil junto —, mas nada no código obriga.
- **Os pisos de 3a e 3b são ponto de partida, não calibração.** Saíram de uma
  medição de um par contra três textos não relacionados, em 2026-09-02. Quem os
  ajusta sou eu, olhando a revisão, sessão real por sessão real: piso alto demais
  faz a camada calar, baixo demais faz o agente 2 ser chamado à toa.
- **1536 floats por átomo são ~12 KB** de propriedade; 4.000 átomos, ~48 MB. Não
  há cota em bytes no Free contra a qual comparar isso, e o vetor do índice,
  quantizado em `SCALAR`, fica em torno de 6 MB. Se um dia apertar, o botão é a
  dimensão do vetor.
- **O retry cobre link instável, não link caído.** Três tentativas resolvem a
  conexão fria que falha e abre na seguinte, que é o caso medido. Rede fora de
  verdade só faz a rota levar ~33 s para dizer 502 em vez de 10 s.
- **O botão de gravar foi verificado por compilação e teste, não por olho.**
  `tests/onda.test.ts` cobre a matemática da onda, e `tsc` mais `next build`
  passam; ninguém abriu a tela e olhou o halo respirar. Não há navegador
  automatizado no projeto, e o `middleware` exige cookie para chegar em `/`.
- **O backup não sabe voltar.** O dump diário grava nós e arestas no R2 (§9), e
  não existe `restaurar`: reescrever tudo num banco vazio é trabalho que ficaria
  para a hora do desespero, e foi adiado de olho aberto. O que existe é a cópia.
  Testar a volta pediria o banco de desenvolvimento, que agora existe justamente
  para coisas assim.
- **O dump não leva o vetor**, então restaurar a partir dele devolve um grafo sem
  `embedding` — as duas camadas semânticas ficam cegas até `POST
  /api/atomos/embutir` e `POST /api/entidades/embutir` rodarem o retrofill. É
  consequência aceita da exclusão (§9), e o caminho de volta já existe e está
  testado.
- **Gravação com a tela apagada continua não medida.** O `wakeLock` mantém a tela
  acesa enquanto grava, e com isso a aba nunca vai a segundo plano — a pergunta
  de se o Chrome no Android estrangula o `setTimeout` de 30 s do gravador
  (§3.1) fica **sem resposta**, não respondida. Página capturando mídia costuma
  ser isenta; ninguém verificou aqui. Sistema que recuse a trava por bateria
  baixa grava do mesmo jeito, e nesse dia a pergunta volta.
- **O service worker não cacheia nada.** Ele existe só para o Chrome oferecer a
  instalação (§2). Sem rede, o app não abre: o que o sistema promete é não perder
  o que **já** foi gravado, e quem cumpre isso é o IndexedDB (§3.2). Gravar
  offline exigiria criar a sessão localmente — `POST /api/sessoes` é a primeira
  coisa que o botão faz — e é fatia, não linha.
- **A instância Aura Free depende do cron para não pausar.** São 72 h de silêncio
  e o hostname deixa de resolver; a batida diária zera o relógio. Se o cron parar
  (variável removida, plano mudado, rota renomeada), a pausa volta a ser possível
  e **nada avisa** — o sinal é o app responder 502 no dia em que eu for gravar.
- **Um preview aponta para o banco de desenvolvimento, e isso é configuração, não
  código.** Com a migration rodando no build (§12.1), escopo de variável errado na
  Vercel faz um deploy de preview migrar produção. O que protege é o escopo estar
  certo; nada no repositório verifica isso.
- **Deploy de preview não grava áudio.** A URL é aleatória e não está na política
  de CORS do R2 (§7), que lista a origem de produção e o `localhost`. Consequência
  aceita: preview serve para ver tela, não para gravar.
- **`finalizarSessao` espera no máximo 150 s** pelos blocos pendentes; passando
  disso a sessão vai para `erro` com a lista do que faltou. O áudio fica intacto
  e o retry é manual. Eram 45 s até 02/09 — menos que uma janela de rate limit
  (§5.3), então o laço estourava o prazo sem nunca ter chance de passar. O preço
  do prazo maior é real: bloco que falha por motivo definitivo agora leva 150 s
  para ser declarado perdido.
- **O rate limit do Gateway é da conta e não some com troca de modelo** (§4.2.1,
  medido em 02/09). `limite.ts` espera 20 s e 60 s antes de desistir, o que cobre
  a janela medida (~75 s) — não cobre um limite que dure minutos. Aí a sessão vai
  para `erro` dizendo que foi rate limit, e o conserto é chamar `/finalizar` de
  novo mais tarde. **Uma sessão gravada de 15 min são 30 blocos e nunca foi
  transcrita inteira sob limite** — o que se mediu foram chamadas soltas. A
  slice 4.8 mexeu nos dois sentidos: são ~8 chamadas de extração a mais na
  conta, mas espalhadas pelos 15 minutos e sem prazo para esperar, em vez de uma
  rajada no fim. Também não medido.
- **Perfil, duplicatas e embedding não esperam o rate limit**, e é deliberado:
  saem de um clique meu e falham na minha frente (§5.3). STT, extração e — desde
  a 4.9 — resolução chamam `comEsperaDeLimite`.
- **`config/vocabulario.txt`** ainda tem só os três nomes de exemplo. Desde a
  slice 3 ele não é mais a lista inteira — as entidades do grafo entram junto —
  mas continua sendo o único jeito de ensinar um nome **antes** de falá-lo pela
  primeira vez, que é justamente quando o STT mais erra.
- **A importação aceita `opus`, `ogg`, `m4a`, `mp3`, `wav` e `webm`** — a lista
  está em `audio.ts`. `.mp4` ficou de fora de propósito: quase sempre é vídeo, e
  o pipeline manda os bytes crus para o STT. Teto de 25 MB e 30 min.
- **Não foi conferido se o `xai/grok-stt` aceita Ogg/Opus, M4A, MP3 e WAV.** A
  lista de importação promete os cinco; até agora ele só recebeu `audio/webm`.
  Se recusar algum, a saída seria converter, e conversão de áudio não cabe em
  function serverless — a alternativa real é estreitar a lista. Descobre-se no
  primeiro arquivo de cada tipo.
- **Sessão importada não se distingue de gravada no grafo.** `:Sessao` não tem
  `origem`; quem sabe é o `ext` no manifest, no R2. Acrescentar o campo é
  migration nova, e nada hoje lê essa distinção.
- **O "menos de 60 s" da revisão continua sem medição.** A tela já foi usada em
  sessões reais e o caminho inteiro fecha, mas ninguém cronometrou uma revisão de
  sessão de 15 min. Ela ficou **mais densa** na 4.8.1 — a dúvida passou a ser de
  cada referência e a procedência passou a aparecer sempre —, e a densidade foi
  desfeita depois: a linha de dúvida encolheu para uma pergunta e as fontes
  foram para trás de um ícone (§4.7). **As duas mudanças foram feitas a olho, sem
  cronômetro dos dois lados**, e é exatamente por isso que a medição continua
  valendo a pena: hoje não dá para dizer se a tela ficou mais rápida ou só mais
  curta.
- **A sugestão de menção some assim que eu mexo na lista.** A referência casa com
  a posição por índice; acrescentar ou remover uma menção desloca tudo, e a trava
  desliga as sugestões daquele átomo em vez de arriscar mostrá-las na linha
  errada (§4.7). Reabrir a sessão não as traz de volta — a edição já está no
  estado da tela.
- **`ReferenciaResolvida.camada` nasce opcional e assim fica.** Proposta anterior
  à 4.8.1 não a tem, e naquelas sessões a tela não diz de onde veio a sugestão.
- **Editar não muda a procedência.** Reescrever o texto de um átomo mantém os
  offsets do trecho original — é o certo, mas quer dizer que um texto muito
  editado aponta para um áudio que já não o sustenta palavra por palavra.
- **Nome descritivo não é pronome.** "meu pai", "minha mãe" e "meu chefe" passam
  pela lista e viram nó com esse nome. É defensável — o referente é estável — e
  desde a slice 3 tem conserto: renomear em `/entidades` deixa a grafia velha
  como alias, então o nó vira o nome de verdade sem perder os átomos e sem "meu
  pai" recriar um segundo nó depois.
- **A lista de pronomes é fechada e em português.** Ela pega o que apareceu até
  agora; um placeholder que eu use e não esteja lá passa direto e vira nó. O
  conserto é acrescentar à lista em `texto.ts`.
- **Não há como desfazer uma fusão.** Migrar as arestas de volta exigiria saber
  quais eram de quem, e isso não é gravado. O que protege é a fusão nunca ser
  automática: o modelo propõe, eu confirmo. Recusar, sim, é reversível — a
  aresta `:DISTINTA_DE` se apaga à mão no console.
- **Sem átomo, o julgamento de duplicata tende ao NÃO.** Medido: um par de
  entidades semeadas com grafias equivalentes ("ZZTesteFusao" / "ZZ Teste
  Fusao") foi encontrado pela camada de string e **recusado** pelo modelo — sem
  átomo nenhum ele não tem contexto, e o prompt manda responder NÃO na dúvida.
  É o viés certo, mas quer dizer que **duplicata entre entidades semeadas não é
  proposta**; para essas, fundir é ir direto no par. Duplicata vinda de sessões
  reais tem os textos dos átomos como contexto, que é o caso para o qual o
  prompt foi escrito.
- **A qualidade da proposta em caso real não foi medida.** O grafo não tem
  duplicata vinda de sessão, então `duplicatas-1` nunca julgou um par com
  contexto de verdade. A mecânica, sim, está validada ponta a ponta.
- **Fundir não é atômico.** São **seis** consultas pela Query API (a sexta é a
  reposição de alias da 4.8.1), sem transação entre elas. Cair no meio deixa as
  arestas migradas e o perdedor sem alias — um nó de zero átomos aparecendo na
  lista —, ou os aliases repostos e a perdedora ainda ativa. **Refazer a fusão
  cura**: a segunda passada não acha aresta para migrar, repõe o que faltar por
  `MERGE` e marca o alias. O limite mudou de tamanho, não de natureza.
- **Não há como desfazer um confirmar.** `confirmada` não tem transição de saída
  e nada apaga átomo (regra 6). Corrigir depois de confirmar depende de edição
  no grafo, que não existe nesta slice.
- **Forçar a extração de uma sessão confirmada quebra a procedência dela.** A
  tela não oferece o botão — `podeReextrair` (`Sessoes.tsx`) recusa `confirmada`,
  e diz por quê —, mas a rota aceita: `POST /api/sessoes/:id/extrair` com
  `{"forcar":true}` re-extrai, gasta a chamada de modelo e **sobrescreve o
  `extracao.json`** contra o qual aqueles átomos foram confirmados. O grafo fica
  intacto (o status não muda, porque `marcarEmRevisao` tem guarda), e o que se
  perde é a conferência: §4.7 promete que `id`, offsets, âncoras,
  `prompt_version` e `modelo` se releem daquele objeto, e ele passa a descrever
  uma extração que nunca foi confirmada. A proposta real vai para
  `extracao-anterior.json` e some na segunda vez. A trava está na tela e não no
  servidor, que é o desenho que §4.7 recusa em todos os outros pontos — fica
  como limite conhecido, e não como decisão boa.
- **A extração roda no mesmo `waitUntil` da transcrição.** Em dev isso é o mesmo
  processo: fechar a janela do servidor no meio mata o job e a sessão fica em
  `extraindo`. O retry é chamar `/finalizar` de novo. Desde a 4.8 vale também
  para as janelas, com a diferença de que uma janela morta assim fica `em_curso`
  no `parcial.json` até o lease vencer (120 s) — depois disso qualquer passada a
  reivindica de novo.
- **O caminho de "já conhecida" funciona, medido.** As duas primeiras entidades
  nasceram às 13:28:17 e a sessão seguinte só começou às 13:28:37: a extração
  dela encontrou as duas já lá e o segundo confirmar reaproveitou os nós em vez
  de criar novos.
- **O modelo da extração pensa muito, e deixamos — e o padrão trocou sem
  remedir** (20/09). `zai/glm-5.3-flash`, padrão até então, chegou a gastar 1720
  tokens pensando para 122 de texto, e na janela 0 da sessão
  `mtqoeoqh3e3724514q1f` gastou os 8000 inteiros sem escrever um byte de JSON.
  As defesas do §4.6 seguram a janela pelo teto, não pela mordaça: calar o
  raciocínio é possível e medido (§4.4), e foi recusado porque cobraria a conta
  na qualidade da extração. **O limite conhecido que sobra é o custo**: janela
  que estoura paga duas chamadas em vez de uma, e não há medida de quantas
  estouram — a sessão real é que diz. O padrão agora é
  `deepseek/deepseek-v4.1-flash`, por decisão minha e sem sonda nova: **quanto
  ele pensa, se estoura o teto e como se sai na qualidade da lista são três
  coisas ainda não medidas**, e a primeira sessão real é que diz. Trocar de
  volta, ou para outro, continua sendo `EXTRACAO_MODEL`, sem tocar em código — e
  vale notar que `zai/glm-5.3-flash` nem aparecia na lista de modelos conhecidos
  do `@ai-sdk/gateway` instalado (4.0.62), que conhece `zai/glm-5.3`; o id novo
  não foi conferido contra essa lista, e a string sai pelo Gateway de todo jeito.
- **O rate limit do free tier derruba o fallback quando ele mais importa.** Na
  mesma sessão, com a janela perdida, o passe único levou 429 em todas as
  tentativas e a sessão foi para `erro`. As nove chamadas que isso custava
  viraram três (`maxRetries: 0` nas chamadas embrulhadas por `limite.ts`), mas
  **o limite em si é questão de plano, não de código**.
- **O alvo de 10 a 20 átomos por 15 min ainda é aposta.** O prompt está em
  `extracao-9` e as sessões julgadas até agora são curtas; a primeira sessão longa
  confirma ou derruba o número. Desde a 4.8 ele é pedido **em proporção**, janela
  a janela (`orcamentoDaJanela`), o que troca uma aposta por outra: oito janelas
  pedindo de 1 a 3 dão de 8 a 24, e é o `estende` que tem de puxar o número para
  baixo. Mais um motivo para a primeira sessão longa ser a medição que importa.
- **A janela do fim tem 120 s (`ORCAMENTO_JANELAS_MS`) para fechar**, dentro do
  `maxDuration` de 300 s de `/finalizar`, dos quais até 150 s podem ter ido nos
  blocos pendentes. Estourado o orçamento, a sessão vai para `erro` desde a slice
  8 — antes ela caía no passe único, que então rodava com pouco tempo sobrando e
  em silêncio. Continua sendo o caso ruim de um caso já raro (as janelas
  anteriores já fecharam durante a gravação), e o retry continua sendo chamar
  `/finalizar` — ou `/extrair` — de novo.
- **O `estende` é a única coisa que segura o volume da lista, e ele é uma
  instrução de prompt** (slice 4.8). Sem passada de costura no fim, a janela que
  ignorar "não repita, estenda" produz um segundo átomo sobre o mesmo assunto —
  ou um segundo `ROTINA` —, e a revisão abre com mais itens do que devia, que é a
  condição de morte da visão §8. O código impede a corrupção (`ref` inválida vira
  descarte) mas não a duplicação; quem vê é a revisão. **Ainda não foi medido
  contra uma sessão real de 15 min.**
- **O agente 2 pode discordar de si mesmo entre janelas.** Ele vê os átomos já
  propostos num bloco de contexto (§4.8), mas nada o amarra à decisão anterior —
  o `ja_nesta_sessao` da 4.9 amarra o **extrator**, não ele, então o risco ficou
  reduzido e não eliminado:
  o mesmo "Rafa" pode sair `NOVA` na janela 1 e cair no nó "Raffa" na janela 2,
  com o catálogo idêntico, fechando a sessão com duas candidatas para uma pessoa.
  Quem vê é a revisão, e o painel de entidades reaponta as duas num gesto. O
  complemento barato — o mapa `citado → decidido` da própria sessão entrando como
  camada em `candidatosDe` — está anotado e não construído.
- **Um átomo estendido entra no índice com o texto da última janela e a
  atribuição da primeira.** O `estende` troca o `texto` e não mexe em `sobre` nem
  em `menciona` (§4.6) — é a decisão certa, e mantém a resolução incremental —,
  mas `a.texto` é a fonte única do vetor do átomo (§4.10). Quer dizer que o vetor
  fala do assunto inteiro e a atribuição responde ao que se sabia no minuto 2.
- **O bloco da janela não é editável em `/agentes`.** O painel edita o prompt de
  um agente, que para a extração é `BASE` (§4.13); o bloco que `blocoDaJanela`
  injeta é montado em código, com o orçamento calculado e a lista do acumulado
  dentro. Então metade do que o extrator lê hoje se ajusta sem deploy e a outra
  metade não — e a metade que não é justamente a que carrega a instrução do
  `estende`, que é a que mais provavelmente vai precisar de ajuste. Torná-lo
  editável é decidir como um prompt com partes calculadas entra num campo de
  texto, e isso é fatia, não linha.
- **A janela não sabe o que ainda vai ser dito.** Se eu digo "ela" no minuto 2 e
  só nomeio a Marina no minuto 10, a janela 1 não tinha como resolver, e o átomo
  dela nasce com o pronome — `precisa_nome` trava o confirmar até eu nomear. O
  painel de entidades da revisão conserta isso **num gesto**, reapontando todos os
  átomos (`nomeFinal()`, §4.7), e por isso não foi construída uma operação de
  renome na janela: seria antecipar máquina para o que a tela já resolve. Vale
  igual para o agente 2, que decide sobre a sessão até aquela janela (§4.8).
- **A extração agora custa oito chamadas por sessão em vez de uma.** O total de
  tokens de entrada é parecido — a fala é a mesma —, mas o prompt base viaja em
  cada janela, e a lista do acumulado cresce a cada uma. É o preço declarado da
  fatia, e a contrapartida é a espera depois de parar de falar.
- **Uma janela extraída duas vezes é possível, e é o lado barato do erro.** O
  lease de 120 s expira, e um `waitUntil` lento pode ver a própria janela
  reivindicada por outro. Duas extrações custam uma chamada; uma janela travada
  para sempre custaria a sessão. O que **não** acontece é átomo duplicado: quem
  perde a corrida do `If-Match` relê e reaplica.
- **Não haverá medida automática da qualidade da extração.** A avaliação é à mão,
  na tela de revisão; sem gabarito rotulado nem percentual de recall, regressão de
  prompt não aparece em teste — só na revisão seguinte.
- **O `keyterm` vale só para o provedor de hoje, e agora se sabe o custo disso.**
  Medido em 31/08 e de novo em 02/09: funciona no `xai/grok-stt` (§4.4). O nome
  da opção é um mapa por provedor em `modelos.ts`, com **silêncio como padrão**
  para provedor desconhecido — trocar `STT_MODEL` por um provedor fora do mapa
  faz o vocabulário não ser mandado, e não derruba a transcrição. No
  `google/gemini-3.5-transcribe` foi medido que **nenhum** dos cinco nomes de
  opção testados chega ao modelo, e sem `warning` nenhum: a falha é silenciosa
  dos dois lados. Trocar de STT sem medir isso primeiro perde a metade A da
  slice 3 sem que nada apareça na tela.
- **Toda grafia confirmada entra em `aliases` e fica** (4.9, reescrito na 4.11).
  O STT errando de três jeitos deixa três grafias no mesmo nó, e elas engordam a
  string canônica de `fonteDaEntidade` — que é o texto de onde sai o vetor
  daquela entidade. Deixou de ser nó permanente: agora é item de array, e
  `/entidades` remove um com um toque, sem console.
- **Alias não distingue mais "grafia que o STT errou" de "nome antigo depois de
  um renome"** (4.11). As duas são item do mesmo array. `renomear` já produzia
  as duas com a mesma forma; agora elas ficam indistinguíveis também na leitura.
- **O casamento exato passa a depender do catálogo caber na memória** de uma
  função (4.11). Até a 009 a grafia era nó e o índice único de `nome_normalizado`
  resolvia; hoje `listarEntidades` traz tudo e `acharPorChave` varre. Hoje são
  algumas dezenas de entidades e a consulta já carregava o catálogo inteiro; o
  dia em que isso doer, a saída é um índice full-text sobre `aliases` — recusado
  agora por cota de índice do Aura Free.
- **O dossiê é uma foto do grafo no momento da janela** (4.9). Nome dito depois
  dela não volta atrás: se eu digo "ela" no minuto 2 e o nome no minuto 10, a
  janela 1 continua sem saber. Mesma limitação da extração e do agente 2, mesmo
  conserto — o painel de entidades da revisão, num gesto. O que a `candidatas`
  do `EstadoJanela` guarda é justamente essa foto, para eu poder ler depois por
  que ele apontou aquele nó.
- **A camada `prefixo` é heurística sem medição** (4.9). Os pisos de 4 letras no
  token e 6 na palavra-alvo saíram de raciocínio, não de dado — "casa" ainda
  alcança "Casanova", e o custo disso é um item a mais no dossiê. Quem os ajusta
  sou eu, olhando a revisão, sessão real por sessão real.
- **O RAG por bloco usa os mesmos pisos da resolução, sobre um texto de outra
  natureza** (4.9). Lá é a frase de um átomo contra o vetor da entidade; aqui é
  um bloco de 30 s de fala. O número igual nos dois é escolha de ter **um** lugar
  para calibrar, não medição de que ele sirva aos dois — e um bloco longo tende a
  pontuar mais baixo que uma frase.
- **`semantico: false` não distingue "nada passou do piso" de "a chamada
  caiu"** (4.9). O catch-up do `/finalizar` refaz o bloco uma vez nos dois casos,
  e o preço do caso benigno é uma chamada de embedding por bloco silencioso.
  Separar exigiria mexer em `candidatosSemanticos`, que hoje engole a própria
  falha por decisão da 4.5.
- **A resolução passou a custar em toda janela**, não só quando há dúvida (4.9).
  São até oito chamadas de agente 2 por sessão de 15 min onde antes podia ser
  zero. Não medido sob rate limit, como quase tudo nesta faixa.
- **`TOP_K = 4` com `extrator` na cabeça espreme o vetor para fora da união**
  (4.9): `extrator` + `exato` + dois parecidos ocupam as quatro vagas, e as
  camadas semânticas ficam de fora daquela menção. Pode estar certo — o dossiê já
  trouxe o semântico pelo lado do extrator, porque `perfil` e `vizinhos` rodam
  sobre o texto do bloco —, mas é decisão escrita, e não consequência da ordem do
  laço.
- **Uma menção sem candidato nenhum não é validada** (4.9). Ela resolve como
  entidade nova, de graça, sem passar pelo agente 2 — é o que mantém a promessa
  de a sessão com o grafo vazio sair como saía na 4.8, e é a única brecha na
  regra "nenhuma atribuição entra sem segunda opinião". A brecha é estreita por
  construção: sem candidato não há atribuição, só um nome novo.
- **Com o agente 2 fora do ar, a chave do extrator não segura a menção** (4.9). O
  fallback é o prior, e o prior nunca escolhe o parecido: uma menção que só tem o
  nó apontado pelo extrator volta como entidade nova com `certo: false`, com o nó
  entre as alternativas. Quer dizer que o texto do átomo pode dizer "Giampaolo
  Lepore" enquanto o sujeito proposto é "giam" — visível na revisão, e a um
  toque de conserto, mas feio.
- **O casamento de grafia no confirmar depende da posição da menção** (4.9). O
  sujeito casa sempre; as menções, só quando a lista da tela tem o mesmo tamanho
  da proposta. Acrescentar ou remover uma menção desliga o registro daquele
  átomo, em vez de arriscar criar um alias mentindo — mesma trava que a revisão
  já aplica às sugestões.
- **Deduplicação de átomo não existe**, numa fatia futura ainda sem número. A
  de **entidade** ficou pronta na slice 3, mas nada compara um átomo novo com os
  que já estão no grafo: dizer a mesma coisa em duas sessões cria dois átomos —
  a slice 5 (§4.15) aproxima isso de um jeito indireto, ligando os dois por
  `:CONFIRMA`, mas os dois nós continuam existindo.
- **A marca de perfil ficou mais frequente, não mais rara — e isso foi uma
  pergunta respondida ao contrário** (4.9). Até a 4.8 quem aponta perfil é o
  agente 2, e ele só era chamado quando alguma menção precisava de julgamento:
  numa sessão sem nome ambíguo, "o Rapha sabe produzir evento" **não** virava
  `:PERFILA`. A 4.9 pôs o agente 2 em toda janela com candidato, e na prática
  isso resolve o buraco de graça. O que fica registrado é o preço na direção
  oposta: a sessão limpa deixou de ser de graça, e é isso que o critério 5 da
  slice 4 comprava.
- **A resolução ainda não julgou um homófono de verdade.** O grafo já tem nomes
  próprios reais — as 5 sessões confirmadas de 04/09 puseram lá "Behring
  Founders", "Adapta" e "Giampaolo Lepore" —, mas nomes próprios não são a mesma
  coisa que nomes **em disputa**: enquanto nada no grafo soar como outra coisa,
  o `resolucao-5` não tem o que desempatar — ele é chamado (desde a 4.9 toda
  menção com candidato vai), mas responde uma lista de um. O caso concreto de que eu sei a resposta — a sessão com o Rapha e o
  Raffa — depende dos dois estarem **cadastrados antes da primeira menção**. Que
  nomes estão lá hoje se vê em `/entidades`, não neste arquivo.
- **O agente 2 só enxerga os candidatos da menção, não o grafo inteiro.** Quem
  não casa por chave nem se parece por string nunca chega ao prompt — desde a
  4.9 o dossiê do extrator alcança mais um pedaço disso (prefixo e as duas
  camadas semânticas sobre o bloco), mas um apelido sem nenhuma letra em comum
  com o nome do nó ("Bidu" para "Roberto") continua virando entidade nova, e o conserto é fundir depois em `/entidades`. É deliberado —
  mandar o catálogo todo seria pagar por texto que não muda resposta nenhuma —,
  mas é um limite, não um detalhe. O que a barra pesquisável faz é baratear o
  conserto: o grafo inteiro está a duas letras de distância dentro do próprio
  átomo, então "Bidu" vira "Roberto" na revisão em vez de virar nó e fusão.
- **A revisão carrega o grafo inteiro para buscar nele.** `GET /api/entidades`
  não tem `q`, nem limite, nem paginação, e não há índice de texto sobre `nome` —
  a busca é no cliente, sobre a lista toda. A 4.8.1 tirou o perfil do payload
  padrão (§4.7), o que enxuga a resposta e não muda o desenho. Num grafo de dezenas de entidades
  isso é mais rápido que ida ao servidor por tecla; em milhares, deixa de ser, e
  a saída é uma rota de busca com uma migration de índice atrás dela.
- **Não dá para retomar uma gravação interrompida.** O botão "retomar" morava no
  chip da home, e o chip saiu para tirar a cobrança da tela de gravar (11) — os
  dois verbos viviam no mesmo cartão, então perder um custou o outro. O
  maquinário dele foi apagado junto (§5, §6.2): nada ficou como código morto
  esperando uma tela que talvez nunca volte. O que **não** se perde: os blocos já
  subidos estão no R2, e a sessão interrompida continua na lista de sessões
  levando a `/sessao/:id`, onde `Processando` finaliza e transcreve o que
  existe — perde-se emendar fala nova na mesma sessão, não se perde fala. Se um
  dia incomodar, o caminho é um link `retomar` na linha da lista apontando para
  `/?retomar=<id>`, e as três linhas de `proximoIndice` se reescrevem.
- **Não há como separar um nó que já conflacionou duas pessoas.** A máquina da
  slice 3 junta, não divide, e mover átomo entre entidades não existe. É por isso
  que dois nomes homófonos têm que ser cadastrados em `/entidades` **antes** da
  primeira menção: depois de conflacionados, não há caminho de volta.
- **A marca de perfil não é editável na revisão.** Ela aparece no átomo e some se
  eu rejeitar o átomo ou desmarcar a entidade, mas não dá para trocar o campo nem
  apontar outra entidade — é a única das três relações do átomo que continua sem
  controle na tela, agora que `menciona` ganhou o dele (4.7). Se o agente 2 errar o campo com
  frequência, o que se ajusta é o `resolucao-5`.
- **O confirmar dispara uma passada de embedding** (4.8.1), em `waitUntil`, fora
  do caminho da resposta e engolindo a falha. É mais uma coisa acontecendo
  depois do clique que eu não vejo; o sinal é a linha `[entidades]` no log.
- **A regra de tipo é arbitrada em três lugares** (4.8.1 e 4.9): pedida ao
  extrator no `extracao-9`, pedida ao agente 2 no `resolucao-5`, e imposta pelo
  código nas duas pontas — o parse da extração derruba a chave do dossiê no
  sujeito desses quatro tipos, e a resolução recusa o julgamento que tira um
  SENTIMENTO, APRENDIZADO, HISTORIA ou ROTINA de `eu`. Pedir nos dois prompts
  poupa decisão; o que impede o dado errado continua sendo o código.
- **O perfil realimenta a resolução, e isso é o risco declarado da slice.** O
  agente 2 lê o perfil para desambiguar; um perfil errado contamina toda
  atribuição futura, e átomo atribuído por engano vira evidência daquele mesmo
  perfil. As travas são o agente 3 nunca escrever, o proposto aparecer ao lado do
  atual e nunca por cima, e a escrita passar só por `POST /api/entidades/perfil`.
  Nenhuma delas impede eu mesmo aprovar um rascunho ruim depressa.
- **Sessão travada em `extraindo` não tem retry automático.** O corredor a deixa
  em paz de propósito: uma extração pode estar de fato correndo, e empurrar de
  novo pagaria uma segunda chamada de modelo pela mesma sessão. A saída continua
  sendo o **reextrair** da lista; `transcrito` e `erro`, esses, o corredor empurra
  sozinho. **O que mudou em 18/09 é que ela deixou de girar para sempre**: o
  corredor tem teto (`TETO_DA_ESPERA_MS`, 6 min) e passa a dizer que travou, com
  o caminho da lista. Seis minutos porque os 300 s de `maxDuration` do
  `/finalizar` têm de caber inteiros dentro dele — chamar de travado antes seria
  eu reextrair uma sessão viva e pagar duas vezes.
- **Desfazer uma emenda é um passo, e só um** (slice 7). O `VersaoDePrompt` do
  snapshot guarda `anterior`, então dá para voltar ao texto de antes; o que não
  existe é linha do tempo. Duas emendas ruins seguidas se desfazem abrindo o
  editor de `/agentes` e escrevendo o prompt à mão — que continua sendo o
  caminho de sempre, e por isso o painel não some.
- **Uma emenda aprovada depressa pode piorar um prompt calibrado em nove
  versões, e nenhum teste automático vê.** É a mesma consequência que a 4.6
  declarava para a regra, agora sobre o corpo do prompt, e portanto maior: o
  apêndice se revogava tirando uma linha da lista, a emenda só se desfaz pelo
  `anterior` do snapshot. Consequência direta de não haver medida automática de
  qualidade — e não vai haver. As defesas são as seis amarras do `redacao-1`
  (§4.12), o teto de duas seções por rodada, o `extracao-anterior` lado a lado e
  o índice fechado por `incorporada_em`. Nenhuma é métrica; todas dependem do meu
  julgamento na revisão seguinte.
- **Os primeiros padrões nascerão de um punhado de correções.** Risco de
  generalizar demais um caso só; mitigado por nunca propor padrão a partir de uma
  correção isolada, não eliminado.
- **A sugestão é sob demanda de olhar, não de agir.** Correção pode continuar em
  aberto indefinidamente se eu abrir `/calibracao`, ver e não pedir rascunho
  nenhum. É decisão minha, e ignorar é sempre saída válida.
- **A dobra das regras da 4.6 é oferecida uma vez só, e por rodada inteira.** Se
  eu tinha regra em vigor quando a slice 7 subiu, ela aparece como padrão já
  confirmado na primeira calibração da extração (§4.12). Descartar **todas** e
  não redigir nada é seguro: nada é gravado, e elas voltam na próxima visita.
  O buraco é o meio-termo — descartar uma e redigir com a outra grava a rodada,
  `jaDobrou` passa a valer, e a descartada não é oferecida de novo. Ela não se
  perde (o snapshot `regras-<hash>.json` é imutável e continua legível), mas
  recuperá-la vira trabalho à mão no editor de `/agentes`. Em quem nunca aprovou
  regra nenhuma este item é vazio.
- **O registro de correções é best-effort.** Ele roda no `waitUntil`, depois da
  resposta; `waitUntil` morto perde as correções daquela sessão, sem recuperação
  e sem aviso na tela. Custo assumido: o diário já está no grafo quando isso
  roda, então o que se perde é material de calibração, não fala.
- **Ruído de canonização quando `gestos` não chega.** Um corpo montado à mão, ou
  um cliente antigo, faz a apuração inferir só pelo valor: travessia de alias
  vira correção marcada como inferida (`tocado: false`). As duas travas de §4.11
  mitigam, não eliminam — e por isso `tocado` existe.
- **Um terço das correções capturadas é erro de STT, e sai etiquetado como erro
  de agente.** Medido em 2026-09-04, nas 5 primeiras sessões confirmadas: de 21
  correções, 5 eram conserto de grafia de nome próprio ("Beijing"→"Behring
  Founders", "Jean"→"Giampaolo Lepore", "Dapta"→"Adapta") e outras 2 misturavam
  grafia com edição de conteúdo. O extrator não errou nada nessas — ele copiou
  fielmente o que a transcrição dizia —, mas elas saem como `extracao` (correção
  de texto) ou `grafo` (renome), porque nenhum sinal no material distingue "o
  modelo escreveu errado" de "o microfone ouviu errado". O risco concreto é o
  `calibracao-2` ver quatro casos do mesmo padrão e propor, para o `extracao-9`,
  um padrão que conserta algo que nunca chegou até ele.
  **A saída foi construída na 4.9** (§4.14), e não é etiqueta nem regra de
  prompt: é a busca por bloco entregando ao extrator os nós que o trecho parece
  citar, para ele já apontar o nó e escrever o nome gravado no texto do átomo.
  O que continua valendo deste item é a **medição** e o risco enquanto a 4.9 não
  for verificada numa sessão real: correção de grafia que sobreviver à fatia
  continua saindo etiquetada `extracao` ou `grafo`, e o `calibracao-2` continua
  podendo propor padrão para um erro que nunca chegou ao extrator. O que segura é
  a amarra do `calibracao-2` e o meu descarte na pauta.
- **A etiqueta de agente de `sujeito` e `mencao_removida` usa `sobre.conhecida`
  do átomo**, e não a referência de cada menção. É o sinal que a spec fixou, e é
  grosseiro: um átomo sobre "eu" cuja menção era candidata nova sai etiquetado
  `resolucao`. **Isso deixou de ser gratuito na slice 7**, que abriu o consumo das
  correções de `resolucao`: o recorte que o `calibracao-2` lê para aquele agente
  carrega o ruído, e o conserto — a referência de cada menção dizer quem decidiu,
  incluindo o `desempate-1` — é a 7.1. `mencao_adicionada` ficou de fora dessa regra: acrescentar uma menção
  que o extrator não listou é falha de extração por definição — não existe
  referência original para a resolução ter errado.
  **A 8.1 apertou uma dimensão e deixou a outra**: sessão em que nenhuma menção
  foi ao modelo devolve a correção à `extracao`, mas numa sessão mista as
  menções resolvidas sem modelo ainda alimentam o agente 2. Está certo por
  sessão e torto por menção — melhor do que estava, e não exato.
- **Correção de menção decidida no desempate continua creditada à resolução**
  (8.1). A proposta guarda uma versão só de resolução, e ela é a da primeira
  passada; criar campo próprio para a segunda é outra emenda. Consequência: o
  prompt do `desempate-1` segue sem receber correção nenhuma — o buraco que a
  slice 7 abriu e não fechou.
- **As correções gravadas antes da 8.1 ficam com o carimbo torto.** Recalcular
  não é confiável: `forcar` sobrescreve `extracao.json` guardando só uma
  anterior, então a proposta original de uma sessão re-extraída pode já não
  existir. Elas envelhecem e a poda do índice (teto de 500) come as mais
  velhas; até lá o `calibracao-2` aprende com alguma procedência errada, e isso
  é sabido.
- **`grafo` continua sem consumidor, e agora por um motivo.** `resolucao` ganhou o
  dele na slice 7, quando `paraCalibrar` passou a receber o agente; `grafo` não é
  agente, não tem prompt e não há o que emendar com ele. Ele aparece na porta de
  `/calibracao` sem botão, e ocupa vaga no teto de 500 do índice como qualquer
  outra correção. Quem conserta grafia é o vocabulário do STT — slice 7.2.
- `scripts/smoke.ts` roda solto no node e não importa de `src/`, então repete o
  id de modelo padrão. O teste "o smoke usa o mesmo modelo padrão que a lib"
  existe para as duas cópias não divergirem.
- **`PISO_CONFRONTO` está medido como inerte** (slice 5.1), e continua lá: o par
  menos parecido das 21 primeiras relações tinha 0,728, contra um piso de 0,45.
  Quem seleciona é o top-`K_CANDIDATOS` do índice; o piso só pegaria se subisse
  a ponto de cortar `CONTRADIZ` boa junto. Mantido como rede, não como
  calibração.
- **O piso do `COMPLEMENTA` (0,7) sobreviveu à primeira rodada e ficou** (slice
  5.1). Ele mora em `/agentes`, e é ali que se ajusta. São **dois números de
  calibração no mesmo agente**, um em código (similaridade) e um no painel
  (confiança).
- **O confronto perde ligação verdadeira de propósito** (§4.15.2): ele está
  calibrado para precisão, e a segunda rodada custou oito relações aprovadas
  para consertar cinco erradas. A decisão é essa mesma — falso positivo
  contamina resposta, falso negativo só deixa de ajudar.
- **A regra de referente cobra caro quando o átomo antigo não tem entidade
  ligada**: um `FATO` que diz "uma menina que eu conheci na festa" nunca vai se
  ligar a um átomo que nomeia a pessoa, porque o agente se recusa a presumir. O
  conserto é ligar a entidade ao átomo — dado, não prompt —, e hoje não há tela
  que faça isso num átomo já confirmado.
- **O custo do confronto cresce com o volume de átomos**: cada um pendente paga
  uma busca vetorial e, havendo candidato acima do piso, uma fração de chamada
  de modelo — o lote de 10 dilui, não elimina. Sem teto de quantos processar por
  rodada além do orçamento de tempo da função: um grafo com anos de histórico
  leva várias rodadas (cron diário, ou vários toques em "rodar agora") para
  terminar de cobrir o retroativo.
- **O acervo compartilhado acopla os alvos de um lote** (slice 5.1): um texto
  muito longo — uma `HISTORIA` de 2.000 chars — entra uma vez só, que é o ganho,
  mas o lote inteiro cresce com ele. `ALVOS_POR_LOTE` conta alvos, não
  caracteres, e não há teto de tamanho.
- **`reprocessar` é destrutivo e não tem desfazer** (slice 5.1): apaga as
  relações de todos os átomos de uma vez. O contrapeso é a varredura
  reconstruir, e os dois toques na tela.
- **Átomo sem `valido_em` nunca é candidato de ninguém** (slice 5): a
  comparação de data usa string ISO, e string vazia nunca é "anterior" a nada.
  Ele ainda é processado normalmente — só não entra na lista de candidatos de
  outro átomo.
- **Nenhuma segunda passada para relação de baixa confiança.** Desde a 5.1 o
  número é lido — mas só para **descartar** `COMPLEMENTA` abaixo do limiar, e
  não para mandar o par a uma segunda leitura como o `desempate-1` faz na
  resolução. Nos outros três tipos, `confianca` continua sendo só auditoria.
- **O chat assume que a slice 5 funciona bem** (slice 6). `historico_do_atomo`
  lê as relações da migration 011, e se a varredura não tiver passado — ou tiver
  passado e descartado o par certo — ele volta sistematicamente com "este átomo
  ainda não tem nenhuma relação de confronto registrada", e perguntas de "como
  mudei de opinião" ficam sem resposta real. Não é bug desta fatia, e o conserto
  não mora nela: é o prompt do confronto, ou ligar o átomo órfão à entidade certa
  (§4.15.2).
- **O custo cresce com o teto de oito chamadas por pergunta** (slice 6). Uma
  pergunta composta paga até oito idas ao Gateway antes da síntese, mais a
  síntese em si — e, quando o loop para no teto, mais uma. Não há orçamento por
  conversa nem por dia: o teto é por mensagem.
- **E o teto de oito é piso, não teto exato** (slice 9). `stopWhen` é avaliado
  entre passos, então um passo com três chamadas paralelas parte de 7 e termina em
  10. Sempre foi possível; o `chat-3` manda usar busca paralela e transforma o caso
  raro em comum. O transbordo é limitado pelo tamanho de um passo, e foi
  documentado em vez de cortado (§4.16.1).
- **Com busca paralela, qual chamada mostra o átomo repetido é indeterminado**
  (slice 9). O `Set` de vistos é compartilhado pelas duas ferramentas e mutado
  concorrentemente, então qual das buscas simultâneas escreve a linha inteira e
  qual escreve `já mostrado acima` varia entre execuções. É cosmético — o modelo vê
  o átomo uma vez de qualquer jeito, e o (i) guarda os dois achados inteiros —, mas
  é a razão de **não existir teste sobre isso**: ele ficaria intermitente.
- **`CHAT_MODEL` precisa de tool-calling multi-passo bom pelo Gateway, e isso
  não foi medido** (slice 6). O padrão é o mesmo da extração
  (`deepseek/deepseek-v4.1-flash`), escolhido para devolver JSON curto — que não é a mesma
  habilidade. Se ele encadear mal, o conserto é `CHAT_MODEL` ou o painel de
  `/agentes`, sem deploy; mas qual modelo serve ainda é pergunta aberta.
- **A conversa longa entra inteira no prompt, a cada mensagem** (slice 6). Não há
  resumo nem poda de histórico: uma conversa de trinta trocas manda as trinta a
  cada pergunta nova. Se virar problema de custo ou de teto de contexto, é fatia
  própria — e a mitigação que já existe é acidental, o rastro das respostas
  antigas **não** voltar ao modelo (§4.16.4).
- **O título é mais uma chamada por conversa nova** (slice 6). Barata — duas
  mensagens dentro, uma frase fora —, mas soma, e roda dentro do mesmo fluxo da
  primeira resposta.
- **A pergunta interrompida fica sem resposta, e isso é visível** (slice 6).
  "Parar" aborta a chamada depois de a pergunta já estar gravada: ao reabrir a
  conversa, ela aparece sem resposta embaixo. É o comportamento escolhido —
  perder a pergunta seria pior —, mas não existe "regenerar": perguntar de novo é
  mandar outra mensagem.
- **Editar mensagem enviada e regenerar resposta não existem** (slice 6). Não
  foram pedidos e não foram construídos.
- **A tela otimista pode mostrar uma pergunta que o servidor não guardou**
  (slice 6). O painel acrescenta a minha mensagem antes da resposta chegar; se a
  rede cair entre o `fetch` e a gravação no R2, a linha fica na tela e some na
  próxima abertura da conversa. O grafo e o R2 continuam certos — quem mente por
  um instante é a tela.
- **`buscar_atomos` sem `texto` devolve os mais recentes, sem dizer que cortou**
  (slice 6). O teto é `TETO_ATOMOS = 8`, e o modelo não recebe a contagem total:
  uma pergunta sobre um mês inteiro com trinta átomos vê oito e não sabe disso. O
  sinal que existe é indireto — oito resultados redondos —, e o conserto honesto
  seria devolver o total junto, que não foi feito nesta fatia. O aperto de volume
  de 4.16.2 **agravou** este limite de propósito: doze viravam oito, e a troca
  aceita foi ver menos por busca em vez de afogar a resposta.
- **O piso de 0,45 e o teto de 8 não foram medidos contra gabarito** (slice 6, e
  não podiam ser: `CLAUDE.md` diz que quem julga extração aqui sou eu, na tela).
  O que existe é uma medida emprestada — os 0,728 da varredura de confronto, em
  4.15 — e uma pergunta real que ficou ruim. Se 0,45 passar a cortar átomo que
  eu queria, o número que diz isso é a `similaridade` que o (i) já mostra em
  cada achado.
- **As edições da revisão continuam vivendo só na memória da página, e agora a
  página fica aberta muito mais tempo** (8.2, decisão 6). Bloqueio de tela,
  descarte da aba pelo sistema ou trocar de app e voltar perde o que eu editei —
  e isso **já era verdade** antes desta fatia, sem aviso nenhum. O que a 8.2 faz
  é aumentar o tempo de exposição, porque a revisão abre antes e espera o fim ali
  dentro. Foi perguntado e escolhido assim, sabendo do risco; é o limite mais
  afiado da fatia e o primeiro candidato a emenda se me morder.
- **Se a segunda tentativa da janela falhar, a sessão vai para `erro` com a
  revisão aberta** (8.2) — e junto com ela vão as edições em memória. É a
  consequência direta de combinar a decisão 5 com a 6, e as duas foram escolhidas
  sabendo disso. O áudio, a transcrição e o acumulado continuam no R2; o que se
  perde é o trabalho de revisão daquela sessão.
- **A revisão passa a poder mostrar uma proposta que ainda vai mudar** (8.2). Eu
  posso ler o conjunto, formar uma impressão, e ela mudar quando o fim chegar. A
  linha do rodapé é a única defesa contra isso, e ela é discreta de propósito —
  encher a tela mais apertada do sistema de indicador desfaria o enxugamento que
  ela recebeu fora de fatia.
- **Mais um caminho que pode ficar pendurado** (8.2). Um fluxo que o servidor
  esquecesse de fechar deixaria a tela esperando para sempre um átomo que não
  vem, com o confirmar travado junto. As defesas são duas e estão declaradas:
  `TETO_STREAM_MS` (280 s) do lado do servidor e o teto de `@/client/espera`
  (360 s) do lado da tela, que troca a mensagem por uma honesta **sem destravar
  o confirmar**. O que nenhuma das duas cobre é a sessão cujo `waitUntil` morreu:
  aí o fluxo fecha certo e a proposta simplesmente nunca fecha, e o conserto
  continua sendo re-extrair pela lista de sessões.
- **O teto de saída da extração subiu para 16.000 contra a evidência do próprio
  código** (20/09, §4.6). O raciocínio registrado — "o modelo enche o que houver"
  — continua valendo, e o que sustenta a decisão é outra coisa: cada estouro
  refaz a janela inteira, não só a chamada. Se a `mu4um3ot3t5k4g1u1p1j` e as
  próximas continuarem falhando com 16.000, o número não é o problema, e o
  candidato seguinte é trocar o modelo de extração — não subir de novo.

---

## Manutenção deste arquivo

Documento desatualizado é pior que documento nenhum: ele mente com autoridade.

Atualize `ARCHITECTURE.md` **no mesmo commit** da mudança sempre que mexer em:

- fluxo de dado ou ordem dos passos (seções 3 e 4);
- contrato de rota, formato de payload ou chave do R2 (seções 9 e 10);
- tipo do domínio em `src/lib/tipos.ts`, ou schema do grafo (seção 8);
- máquina de estados, trava de idempotência ou concorrência (seções 5 e 6);
- dependência externa, provedor ou variável de ambiente (seções 4.2 e 12);
- fronteira de segurança: auth, middleware, presign, CORS (seção 7);
- módulo novo, removido ou com responsabilidade trocada (seção 2);
- limite conhecido resolvido ou descoberto (seção 14).

Mudança que não toca nada disso — refatoração interna, ajuste de texto na tela,
teste novo sobre comportamento já descrito — não pede atualização.

Ao fechar uma slice, revise o arquivo inteiro: o cabeçalho declara qual slice
está no ar e o que ainda não existe.
