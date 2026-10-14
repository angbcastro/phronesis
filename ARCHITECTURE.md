# Arquitetura

Como o Phronesis está construído hoje. Este arquivo é o **mapa**: o estado das
fatias, a topologia, os módulos, a fronteira de segurança e o índice dos
capítulos, que moram em `arquitetura/` com a numeração § de sempre. Ele descreve
o sistema que existe. O produto está em `Specs/visao.md`, as regras invioláveis
em `CLAUDE.md`, o escopo de cada fatia em `Specs/slice-N.md` — e a história
dela, com datas e medições, na seção "Como ficou" da mesma spec. O que está
construído e ainda não foi validado está em `PROXIMOS-TESTES.md`.

> **Este arquivo acompanha o código.** Toda mudança que altere fluxo, contrato,
> layout de dado, dependência externa ou fronteira de segurança atualiza o mapa
> ou o capítulo que ela toca, no mesmo commit. Ver "Manutenção deste arquivo" no
> fim.

## Estado

| Fatia | O que entrega | No ar |
|---|---|---|
| 1 | gravar, subir, transcrever | sim |
| 2 | extrair, revisar, gravar no grafo | sim |
| 3 | higiene do grafo: fundir, renomear, recusar | sim |
| 4 | identidade por contexto: o agente 2 | sim |
| 4.5 | o grafo ganha vetor | sim |
| 4.6 | a correção da revisão vira material de calibração | sim |
| 4.7 | o painel dos agentes | sim |
| 4.8 | a extração acompanha a fala, janela a janela | sim |
| 4.8.1 | as travas que a 4.9 apoia | sim |
| 4.9 | o extrator conhece o grafo | sim |
| 4.10 | o arquivo importado entra pela mesma porta | sim |
| 4.11 | a entidade se apresenta; o agente 2 mede a própria dúvida | sim |
| 4.12 | a ficha se escreve sozinha (agente 4) | sim |
| 4.12.1 | a fila da ficha anda, e bate toda segunda | sim |
| 5 | confrontar: relações entre átomos | sim |
| 5.1 | o confronto calibrado pela primeira revisão à mão | sim |
| 5.2 | o confronto amplo: grafo inteiro, duas camadas, a minha correção | sim |
| 6 | o chat: perguntar ao grafo | sim |
| 7 | o laço de calibração vale para todo agente | sim |
| 8 | o sistema se cronometra | sim |
| 8.1 | as quatro emendas | sim |
| 8.2 | a revisão abre antes de a proposta fechar | sim |
| 9 | a resposta do chat vem antes do despejo | sim |
| 10 | o retrato do "eu" | sim |
| 11 | o que faltou, a pedido | não |

"No ar" é estar em `master` no remoto: push é deploy, e a migration roda no
build (`CLAUDE.md`). Se uma fatia no ar já foi validada é pergunta do
`PROXIMOS-TESTES.md`, e não desta tabela.

## O sistema numa página

**A jornada.** Gravar (ou importar um arquivo), subir, transcrever, extrair,
revisar, confirmar. O áudio sobe em blocos de 30 s direto para o R2 (§3), cada
bloco é transcrito assim que chega, e a cada quatro blocos uma **janela** de
2 min é extraída durante a própria gravação (§4.1, §4.6): quando eu paro, sobra
a janela do fim. A revisão abre no primeiro átomo que existir e cresce enquanto
o fim é extraído (§4.19). Fechada, ela sabe pedir o que o extrator deixou de
fora: um "+" no fim da lista, eu digo em poucas palavras o que faltou, e o mesmo
extrator relê a sessão inteira e devolve o átomo, aprovado e marcado "a pedido"
(§4.6, §4.7) — que vira correção `faltou` quando eu o confirmo (§4.11). O
confirmar grava `:Atomo` e `:Entidade` no grafo, com procedência relida do R2
(§4.7) — nada entra no grafo antes dele (regra 5). A transcrição literal é porta
de serviço, e não passo da jornada (§11).

**Identidade.** Quem eu cito se descobre pelo contexto, e não pela grafia: o
`extracao-9` extrai e propõe o nó, sabendo das candidatas que uma busca de cinco
camadas achou para cada bloco (§4.14); o `resolucao-5` valida cada menção e
devolve confiança; abaixo do limiar, o `desempate-1` relê com a ficha inteira
das candidatas (§4.8, §4.8.1). Dúvida destaca na revisão, e não trava. As
camadas de candidato incluem duas por vetor, aditivas e com teto e piso (§4.10).
A grafia que eu falei vira alias do nó no confirmar.

**Higiene e ficha.** Em `/entidades` eu fundo, renomeio, troco tipo e crio
entidades. Fundir cria alias, e não apaga (§8.2). Cada entidade tem uma
ficha — `resumo` e os três campos de perfil — que o agente 4
(`enriquecimento-1`) escreve sozinho, numa fila que anda sem janela aberta e com
um desfazer de uma geração (§4.9). O "eu" tem um retrato no lugar da ficha: o
Agora e uma seção por dimensão, no R2 (§4.20).

**Relações e perguntas.** O `confronto-3` liga cada átomo novo aos cem mais
parecidos do grafo inteiro com `ATUALIZA`, `CONTRADIZ`, `CONFIRMA` ou
`COMPLEMENTA`, em camada forte ou sutil, e eu corrijo relação por relação em
`/confronto` (§4.15). O chat (`chat-7`) é um agente com quatro ferramentas
só-leitura — `buscar_atomos`, `historico_do_atomo`, `buscar_entidades` e
`ler_retrato` — que encadeia até oito chamadas antes de responder (§4.16).

**Calibração.** Toda correção que eu faço na revisão ou em `/confronto` é
apurada e guardada no R2 (§4.11). Em `/calibracao` o
`calibracao-2` diz que padrão as correções de um agente revelam, eu confirmo, e
o `redacao-1` escreve a emenda seção por seção no prompt daquele agente, que
vale na próxima chamada sem deploy (§4.12). Em `/agentes` eu leio e edito o
prompt e o modelo de cada um dos quinze agentes (§4.13).

**Medida.** O sistema cronometra cada sessão — passos, chamadas de modelo e
falhas — em objetos do R2, e fecha um resumo por mês (§4.17).

**O que ainda não existe:** `:Foco`, as 2–4 perguntas do ritual, me testar sobre
o que aprendi (a fatia C) e a deduplicação de **átomo** — dizer a mesma coisa em
duas sessões cria dois átomos, possivelmente ligados por `:CONFIRMA` (§4.15).

---

## 1. Topologia

```
┌─ navegador ─────────────┐   ┌─ Vercel ────────────┐   ┌─ serviços ───────────┐
│ MediaRecorder + wakeLock│   │ middleware (auth)   │   │ Cloudflare R2        │
│ IndexedDB (blocos)      │   │ App Router /api/*   │   │  áudio + JSON        │
│ fila de upload          │   │ waitUntil (STT)     │   │  + backup/ do grafo  │
│ React (11 telas)        │   │ 3 crons (2 diários) ┼──▶│ Neo4j Aura (HTTP)    │
│ PWA instalado (sw.js)   │   │                     │   │  :Sessao + conteúdo  │
└──────────┬──────────────┘   └──────────┬──────────┘   │ Vercel AI Gateway    │
           │                             │              │  → os quinze agentes │
           │  PUT presigned (áudio)      │              │ Resend → magic link  │
           └─────────────────────────────┴──────────────▶ R2                   │
                                                        └──────────────────────┘
```

O cron diário (§10) é a única coisa que entra sem eu abrir o app. Duas coisas
saem de uma consulta só: o dump do grafo no R2, e manter a instância Aura Free
acordada — ela é pausada após 72 h de silêncio, e pausada o hostname nem resolve.
A terceira é R2 puro e não toca o grafo: fechar o resumo mensal das medidas
(§4.17), engolindo a própria falha para não custar as outras duas. Além dele
entram sem mim a batida do confronto (diária, 05:00 UTC, §4.15) e a do
enriquecimento (segunda, 07:00 UTC, §4.9).

Três planos de dado, cada um com uma responsabilidade única:

| Onde | O que guarda | Por quê |
|---|---|---|
| IndexedDB (navegador) | bloco de áudio até o PUT confirmar | fechar a aba no meio da gravação não pode perder fala |
| Cloudflare R2 | áudio, manifest, transcrição de bloco, transcrição final, proposta parcial e final — e correções, prompts editados, medidas, mensagens do chat, o retrato do "eu" e o dump do grafo (§9) | blob e texto grande não pertencem ao grafo |
| Neo4j Aura | `:Sessao` com estado e **chaves** do R2; `:Atomo` e `:Entidade` a partir do confirmar; `:Conversa` do chat | o grafo é para relação e afirmação, não para blob nem para texto corrido |

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
  fusao.ts        fundir, renomear, recusar, excluir — a escrita de higiene no grafo
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
                  um id por agente, e o diagnóstico de resposta vazia que todo
                  agente usa
  embedding.ts    a porta do vetor: texto → embedding, e a string canônica da
                  entidade mais o hash dela. Não fala com o Neo4j
  stt.ts          transcrição — pede o modelo a modelos.ts
  vocabulario.ts  nomes próprios → keyterms do STT
  transcricao.ts  offsets absolutos, prefixo contíguo, concatenação — e o
                  caminho de volta, do segundo para o bloco que o contém  (client)
  texto.ts        normalização, nome_normalizado e lista de pronomes       (client)
  extracao.ts     átomos a partir de uma janela: prompt, JSON estrito, procedência
                  — e o bloco que diz de que minutos ela é e o que já foi proposto,
                  ou o do pedido, que aponta o foco para o que faltou
  janela.ts       a unidade de extração: fatiar o manifest, reivindicar a janela,
                  somar o que ela produziu ao acumulado. NÃO fala com modelo
  pedidos.ts      o que faltou, a pedido: `pedidos.json`, reivindicar o pedido,
                  carimbar os ids na escrita, juntar pedido e proposta na
                  leitura, e a orquestração da rota. NÃO fala com modelo
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
                  encadeamento e o desfazer de uma geração. O "eu" desvia daqui
                  para o retrato
  retrato.ts      o agente `retrato`: o retrato do "eu" em duas
                  fases — a ficha curta do nó, depois o Agora e uma seção por
                  dimensão em paralelo, todas sobre o mesmo prefixo —, o bloco
                  numerado, a escrita no R2, o desfazer dos dois lados e as
                  fontes do (i)
  retrato-dimensoes.ts o agente `retrato-dimensoes`: propõe as
                  dimensões, e o `config/retrato-eu.json` por etag. Não importa
                  `retrato.ts` — recebe o prefixo pronto
  confronto.ts    o agente `confronto`: os cem
                  candidatos por vetor no grafo inteiro, a ordem do par,
                  ATUALIZA/CONTRADIZ/CONFIRMA/COMPLEMENTA em camada forte ou
                  sutil, e GRAVA — mesmo padrão do enriquecimento, nunca no
                  caminho da resposta. Também o radial de `/confronto` e a
                  minha edição, que congela a relação ou deixa a recusa
  chat.ts         o agente `chat`: as quatro ferramentas só-leitura
                  (`buscar_atomos`, `historico_do_atomo`, `buscar_entidades`,
                  `ler_retrato`), o loop com teto de 8 chamadas, e o rastro que
                  o botão (i) abre. Não sabe que conversa existe
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
                  acumulado, por etag), a correção de relação vinda de
                  `/confronto`, o agente `calibracao-2`, que diz que padrão as
                  correções de um agente revelam e não escreve nada, e a
                  aprovação da emenda
  redacao.ts      o agente `redacao-1`: transforma um padrão confirmado em
                  edições de seção do prompt daquele agente. Devolve edições,
                  nunca o prompt inteiro, e não escreve nada
  regras.ts       a leitura das regras da 4.6, que nada mais escreve: átomo
                  antigo carimbado com elas ainda resolve para o texto que o
                  produziu — e o hashDeTexto que o override usa
  overrides.ts    o prompt e o modelo que eu editei na tela: leitura tolerante,
                  snapshot imutável por hash, e o carimbo. Não sabe quais
                  agentes existem — recebe o id e a base de quem chama
  agentes.ts      o registro dos quinze e o desenho do fluxo. Fica ACIMA dos
                  agentes: importa os prompts deles, e nenhum deles o importa
  referencias.ts  lê os dois formatos de proposta (antes e depois da 4)  (client)
  catalogo.ts     busca de entidade no navegador: trecho, acento, alias (client)
  tipografia.ts   qual tela é ritual e qual é gestão — a regra da fonte  (client)
  atomos.ts       escreve :Atomo, :Entidade e :PERFILA — só o confirmar chama;
                  e embute o átomo depois de gravá-lo, nunca antes
  pipeline.ts     transcrever bloco / avançar janelas / finalizar sessão
                  (o orquestrador) — e a proposta enquanto ela
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
                  três telas que consomem um (chat, processando, revisão)
  espera.ts       até quando vale continuar olhando uma sessão que não fechou —
                  o teto de 360 s do corredor, que a revisão que cresce usa também

src/components/   as telas, todas client
  Marca.tsx       o canto superior esquerdo — volta ao início
  Gravacao.tsx    a tela de gravar
  BotaoGravar.tsx o círculo, o halo, as ondas laterais e o selo de REC
  Gestao.tsx      a engrenagem e a gaveta
  Importacao.tsx  subir arquivo — item da gaveta
  Tipografia.tsx  a classe da fonte, conforme a rota
  Processando.tsx fechar a sessão e esperar; ponte curta, sai no primeiro átomo
                  que existir
  Revisao.tsx     aprovar, editar, escutar, confirmar — e crescer debaixo da mão
                  enquanto o fim é extraído; fechada, o "+" que pede o que faltou
  SeletorEntidade.tsx a barra pesquisável de entidade, nos dois lugares da
                  revisão
  Leitura.tsx     a transcrição literal — porta de serviço
  Sessoes.tsx     lista de sessões, o apagar de dois toques — e a cor que diz o
                  que falta revisar
  Entidades.tsx   higiene do grafo: a lista buscável, a ficha em painel e a
                  fusão à mão
  RetratoDoEu.tsx o painel do "eu" no lugar da ficha: o Agora, as seções com o
                  (i), e as dimensões — editar e aceitar a proposta
  Calibracao.tsx  o que eu já corrigi, com o áudio à mão, e a pauta e a emenda
  Agentes.tsx     o fluxo desenhado, e o prompt e o modelo de cada um
  Confronto.tsx   a varredura de relações (rodar, desfazer, reprocessar), a
                  busca de átomo e o radial onde eu corrijo relação por relação
  Chat.tsx        a barra, o painel, a lista de conversas, o progresso por passo
                  e o (i) com o rastro — nasce dentro da `Gravacao`
  ServiceWorker.tsx registra `sw.js`; não desenha nada
src/app/api/      as rotas, por família — sessão, entidade, calibração, agentes,
                  átomos, confronto, chat e conversas, medidas, auth e cron
                  (seção 10)
src/middleware.ts porta única: sem credencial válida nada responde — cookie de
                  sessão, ou o header do cron sob /api/cron/
public/           manifest.webmanifest, icone.svg, os 4 PNG (192/512, cada um
                  também `maskable`) e sw.js — o mínimo que faz o Chrome no
                  Android oferecer a instalação. `sw.js` não cacheia nada
db/migrations/    definição canônica do schema
scripts/          migrate.ts (aplica migrations), smoke.ts (confere externos),
                  raciocinio.ts (mede como pedir ao modelo para pensar menos),
                  comparar-confronto.ts (os mesmos átomos em vários modelos,
                  lado a lado — o único que importa de `src/`, pelo
                  gancho-src.mjs e o gancho-src-resolver.mjs; §4.15.3);
                  dev.ps1 sobe o `pnpm dev` e abre o navegador, e atalho.ps1
                  recria o atalho dele na área de trabalho
tests/            vitest sobre a lógica pura — nenhuma credencial, nenhuma rede
```

## 7. Fronteira de segurança

- **Auth:** magic link com um único e-mail permitido (`ALLOWED_EMAIL`). Token é
  `escopo.exp.HMAC-SHA256`, assinado com `AUTH_SECRET` via WebCrypto; comparação
  em tempo constante. Link vale 15 min, cookie de sessão 90 dias, `httpOnly` +
  `sameSite=lax` + `secure` em produção. Sem signup, sem roles, sem reset.
- **A janela de 90 dias desliza.** `precisaRenovar` (`auth.ts`) responde se sobra
  menos de um terço da vida do token, e o middleware emite cookie novo quando
  sobra. Dispositivo em uso regular não cai nunca; largado por 90 dias, cai. Com
  prazo fixo o ritual morreria quatro vezes por ano por relógio, e não por
  decisão — que é exatamente o atrito que a tela de gravar existe para não
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
- **Middleware** é a porta única, e ela reconhece **duas** credenciais. No corpo dele só `/entrar` e `/api/auth/*` passam sem nenhuma.
  Requisição a `/api/*` sem credencial recebe 401; navegação vai para `/entrar`.
  A segunda credencial é o header `Authorization: Bearer $CRON_SECRET` que a
  Vercel manda nas batidas agendadas, e ela vale **só sob `/api/cron/`** — credencial
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
- **As filas de enriquecimento e de confronto chamam a si mesmas com o meu
  cookie** (§4.9, §4.15): cada elo repassa o `cookie` da requisição que o
  originou, e o middleware o valida como qualquer outra. O confirmar dispara a
  fila do confronto do mesmo jeito (`/api/confronto/rodar?se_parado=1`). Nenhuma
  porta nova, nenhum token de serviço, nenhuma exceção no `matcher`. O custo é
  que cookie expirado no meio de uma fila longa para o encadeamento — declarado
  no §14; o que retoma a do enriquecimento é `/entidades` aberta (§4.9), e a do
  confronto, a batida diária.
- **A batida semanal chama a si mesma com a credencial do cron** (4.12.1):
  `/api/cron/enriquecimento?continuacao=1` com `Authorization: Bearer
  $CRON_SECRET`, servidor → servidor. É a mesma credencial, no mesmo prefixo, que
  o middleware já aceita — nenhuma porta nova. O segredo sai de `env.ts` no
  servidor e só viaja nesse header; o navegador nunca o vê.

## Índice dos capítulos

O mapa acima é o que se lê inteiro. O resto mora em `arquitetura/`, um arquivo
por capítulo, com a numeração § de sempre — o código cita `§x.y`, e o número
leva ao arquivo por esta tabela.

| § | Arquivo | O que cobre |
|---|---|---|
| 3 | [`arquitetura/03-audio.md`](arquitetura/03-audio.md) | o caminho do áudio: gravação, importação, fila no navegador |
| 4.1–4.7 | [`arquitetura/04-pipeline.md`](arquitetura/04-pipeline.md) | transcrição, porta única de modelo, vocabulário, extração por janela, revisão e confirmação |
| 4.8, 4.8.1, 4.10, 4.14 | [`arquitetura/04.08-identidade.md`](arquitetura/04.08-identidade.md) | resolução de identidade, desempate, vetor e candidatos, o extrator que conhece o grafo |
| 4.9, 4.20 | [`arquitetura/04.09-ficha-e-retrato.md`](arquitetura/04.09-ficha-e-retrato.md) | a ficha da entidade, o perfil e o enriquecimento, o retrato do "eu" |
| 4.11–4.13 | [`arquitetura/04.11-calibracao.md`](arquitetura/04.11-calibracao.md) | correções da revisão, calibração dos prompts, o painel dos agentes |
| 4.15 | [`arquitetura/04.15-confronto.md`](arquitetura/04.15-confronto.md) | o confronto: relações entre átomos |
| 4.16 | [`arquitetura/04.16-chat.md`](arquitetura/04.16-chat.md) | o chat: perguntar ao grafo |
| 4.17–4.19 | [`arquitetura/04.17-desempenho.md`](arquitetura/04.17-desempenho.md) | medidas, os consertos de tempo, a revisão que abre antes |
| 5 | [`arquitetura/05-estados.md`](arquitetura/05-estados.md) | a máquina de estados da sessão e suas falhas |
| 6 | [`arquitetura/06-idempotencia.md`](arquitetura/06-idempotencia.md) | travas de idempotência e concorrência |
| 8 | [`arquitetura/08-grafo.md`](arquitetura/08-grafo.md) | o Neo4j: labels, arestas, migrations |
| 9 | [`arquitetura/09-r2.md`](arquitetura/09-r2.md) | o layout do R2 |
| 10 | [`arquitetura/10-rotas.md`](arquitetura/10-rotas.md) | as rotas de API |
| 11 | [`arquitetura/11-telas.md`](arquitetura/11-telas.md) | as telas, o botão, cores e tipografia |
| 12 | [`arquitetura/12-ambiente.md`](arquitetura/12-ambiente.md) | ambiente, variáveis, os dois bancos |
| 13 | [`arquitetura/13-verificacao.md`](arquitetura/13-verificacao.md) | como o sistema é verificado |
| 14 | [`arquitetura/14-limites.md`](arquitetura/14-limites.md) | limites conhecidos |

## Manutenção deste arquivo

Documento desatualizado é pior que documento nenhum: ele mente com autoridade. A
regra inteira está no `CLAUDE.md`, que vence se as duas divergirem; aqui ela é
curta:

- toda mudança de fluxo, contrato de rota, chave do R2, tipo do domínio, schema,
  estados, idempotência, dependência, variável de ambiente, fronteira de
  segurança, módulo ou limite atualiza o mapa ou o capítulo que ela toca, **no
  mesmo commit**;
- presente do indicativo, e o motivo curto; a crônica vai para o "Como ficou" da
  spec da fatia, e o andamento para o `PROXIMOS-TESTES.md`;
- ao fechar uma slice, revisar a tabela de estado e "O sistema numa página";
- `tests/arquitetura.test.ts` cobra o inventário, os §, os tamanhos e a
  ausência de data e de ID de sessão.
