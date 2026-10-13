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
| `GET /api/sessoes/:id/extracao` | a proposta + o mapa de blocos, para a revisão — **fechada ou ainda crescendo** | o mapa é o que traduz offset em bloco; a referência traz o `porque` da camada 3b; `anterior` vem como cabeçalho, e a lista antiga só com `?anterior=1`. Enquanto a proposta cresce responde do `parcial.json`, com `crescendo`/`trechos_totais`/`trechos_faltando`, e o **404 significa "zero átomos"** (§4.19) |
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
| `POST /api/entidades/tipo` | `{chave, tipo}` — troca o label | na revisão, o tipo só é editável enquanto a entidade é nova |
| `POST /api/entidades/criar` | `{nome, tipo}` — semeia um nome antes de falá-lo | cria nó órfão de propósito |
| `POST /api/entidades/excluir` | `{chave}` — `DETACH DELETE` no nó, e nas perdedoras de fusão que apontavam para ele | a segunda exceção à regra 6. **409 quando ela é sujeito de algum átomo**, de qualquer status — o conserto é fundir; a trava vale também no `WHERE` da escrita. Recusa o "eu". Devolve quantas menções saíram |
| `POST /api/entidades/perfil` | `{chave, campo, texto}` — grava um dos três campos | o único lugar que escreve perfil; **sem teto** |
| `POST /api/entidades/resumo` | `{chave, texto}` — grava o retrato de identidade | o único lugar que o escreve; corta em `TETO_RESUMO` (500) no servidor; texto vazio limpa |
| `POST /api/entidades/aliases` | `{chave, grafia, acao}` — acrescenta ou tira uma grafia | um item por chamada: a lista na tela é a união de duas fontes, e mandá-la de volta gravaria uma na outra. Acrescentar reusa `registrarGrafia`, com as quatro recusas |
| `POST /api/entidades/canonico` | `{chave, canonico}` — marca a ficha oficial | reversível, sem consequência retroativa; não trava nada |
| `POST /api/entidades/perfil/rascunho` | `{chave, campo}` — o agente 3 propõe | **não escreve nada**; é `POST` porque gasta chamada de modelo |
| `POST /api/entidades/enriquecer` | `{chave}` uma agora; `{chaves}` põe na fila e responde na hora; `{elo:true}` um elo | a **única** rota que escreve conteúdo sem eu aprovar campo a campo (§4.9) — nenhum átomo entra por ela, e a regra 5 continua inteira. O elo se autentica com o meu cookie, repassado |
| `POST /api/entidades/desfazer` | `{chave}` — os quatro campos da ficha voltam uma geração | é uma **troca**, não uma restauração: outro toque traz de volta. 400 quando não há geração guardada. **A chave do "eu" desvia** para o desfazer do retrato (slice 10) — senão trocaria só o nó |
| `GET /api/entidades/retrato` | o retrato do "eu", as dimensões e se há geração anterior no R2 (slice 10) | só leitura; devolve todas as seções — quem esconde a de dimensão removida é a tela |
| `POST /api/entidades/retrato/dimensoes` | `{dimensoes}` a lista inteira, na ordem; `{aceitar:true}`; `{descartar:true}` | quem dá id é o servidor: o que veio e casa com o formato fica, dimensão nova ganha pelo nome, nunca `agora`. Por etag. Não chama modelo |
| `POST /api/entidades/retrato/proposta` | o agente `retrato-dimensoes` propõe a lista inteira | grava em `sugestao`, **nunca** em `dimensoes`; a resposta espera |
| `POST /api/entidades/retrato/desfazer` | os dois lados do "eu": os `_anterior` do nó e `eu.json` ↔ `eu.anterior.json` | 409 com a rodada em `rodando`; 400 sem geração em nenhum dos lados; 502 quando o R2 trocou e o nó não, dizendo isso (§4.20) |
| `POST /api/entidades/retrato/fontes` | `{ids}` — os átomos do (i) de uma seção, pelo id | lidos agora, com `status`: o que saiu depois volta, para a tela riscar; teto de 64 ids |
| `POST /api/atomos/embutir` | dá vetor aos átomos que ainda não têm, em lote | retrofill e retry; 200 por chamada, `continua: true` enquanto sobrar; não toca no texto nem reextrai |
| `POST /api/entidades/embutir` | põe em dia o vetor das entidades, comparando `embedding_fonte` | não editar nada devolve `embutidas: 0` |
| `POST /api/chat` | `{conversa_id?, texto}` — a pergunta; devolve um **fluxo de NDJSON** com a conversa, um evento por chamada de ferramenta, a resposta e o título | cria a conversa quando não vem `conversa_id`; **409 em conversa arquivada**; grava a pergunta antes de o modelo começar, para o "parar" não perdê-la; sem chave de idempotência, e é a única assim (§4.16.7) |
| `GET /api/chat?conversa_id=` | as mensagens de uma conversa, com o rastro de cada resposta | mora aqui, e não em `/api/conversas/:id`, porque é a leitura do mesmo objeto do R2 que o `POST` escreve |
| `GET /api/conversas` | a lista, ativas e arquivadas juntas, por `atualizada_em` desc | quem separa é a tela. **Sem `POST`**: conversa nasce da primeira pergunta, não de um botão — assim a lista nunca acumula conversa vazia |
| `PATCH /api/conversas/:id` | `{arquivada: boolean}` — congela ou descongela | um booleano e não duas rotas: as duas direções são a mesma decisão |
| `DELETE /api/conversas/:id` | apaga de vez — o objeto no R2 **e** o nó | uma das **duas deleções de verdade** do sistema, exceção declarada à regra 6 (§4.16.5, migration 012). R2 antes do nó, sempre |
| `GET /api/agentes` | `{agentes, telas, atualizado_em}` — os quinze com o que está em vigor, mais **as duas telas** do fluxo (`/agentes` e `/agentes/consulta` escolhem a sua por `fluxo`) | **de graça**: nenhuma chamada de modelo, nenhuma ida ao grafo; a base do git viaja junto, para a tela dizer "editado" sem segunda ida à rede |
| `POST /api/agentes/:id` | `{prompt?, modelo?}` — o que passa a valer | o **único** lugar que escreve configuração de agente; `null` revoga o campo e volta à base; recusa prompt que quebre o envelope e id de modelo fora do formato |
| `GET /api/confronto` | quantos átomos esperam, e os últimos que a varredura tocou, com quantas relações fortes e sutis cada um tem | só leitura; alimenta a tela `/confronto` |
| `POST /api/confronto/rodar` | reivindica até cinco átomos pendentes e os julga em paralelo; se autoencadeia em `waitUntil` até a fila esvaziar. `?se_parado=1` (o disparo do confirmar, 5.2) só começa se nenhum elo estiver rodando | mesmo cookie repassado do elo de enriquecimento; sem distinção entre "começar" e "elo seguinte" — não há passo de escolher o que entra |
| `POST /api/confronto/desfazer` | `{atomo_id}` — apaga as relações que a rodada daquele átomo escreveu (as do agente cujo `dono` é ele) e limpa o estado | uma **troca** para "nunca tentado", não uma restauração de conteúdo; as que eu editei ficam; 400 quando o átomo nunca foi tocado |
| `POST /api/confronto/reprocessar` | apaga todas as relações **do agente** e devolve o grafo inteiro à fila (as que eu editei e as minhas recusas ficam) | é como um prompt novo alcança o que já foi julgado. Não roda a fila — a tela chama `rodar` em seguida; destrutivo e sem desfazer, por isso dois toques na tela |
| `GET /api/confronto/atomo/:id` | o radial (5.2): o átomo, todas as relações dele nas duas direções, e os vizinhos ativos | só leitura; 404 quando o átomo não existe |
| `POST /api/confronto/relacao` | `{novo_id, velho_id, acao, valor}`, `acao ∈ tipo\|camada\|motivo\|recusar` — a minha edição: congela a relação (`origem: 'eu'`) ou a apaga deixando `CONFRONTO_RECUSADO`; a correção vai ao índice de calibração em `waitUntil` | 400 para tipo, camada ou motivo inválidos e para relação que não existe mais; apagar não tem desfazer, e é a tela que pede dois toques |
| `GET /api/confronto/busca?q=` | a `buscarAtomos` do chat por texto, os doze mais parecidos — para achar o átomo cujo radial abrir | só leitura |
| `POST /api/auth/link` | pede o magic link, e o Resend entrega | resposta idêntica nos três caminhos em produção — e-mail errado, entregue, falhou (§7). Fora de produção o link volta no corpo |
| `GET /api/auth/entrar?token=` | troca o link pelo cookie | |
| `GET /api/cron/diario` | o dump do grafo para o R2, a consulta que mantém a Aura acordada, e o resumo mensal das medidas | **não abre com cookie**: entra pelo header `Authorization: Bearer $CRON_SECRET`, conferido no middleware e só sob `/api/cron/` (§7). Uma vez por dia — é o que o Hobby dá, e é o que uma janela de 72 h pede |
| `GET /api/cron/confronto` | a batida diária do confronto — processa a fila em elos sequenciais, começando elo novo só nos primeiros 120 s; todos dividem o prazo contado do começo da batida (5.2) | mesma credencial de cron; horário próprio, separado do `/cron/diario` (`vercel.json`) |
| `GET /api/cron/enriquecimento` | a batida semanal (segunda, 07:00 UTC): enfileira as canônicas com novidade, responde na hora e anda a fila em `waitUntil`; `?continuacao=1` só processa | mesma credencial de cron, e é ela que a rota repassa quando chama a si mesma (§4.9, §7) |

Todas com `runtime = "nodejs"`. `GET /api/sessoes`, `POST /api/sessoes`,
`GET /api/sessoes/:id/extracao` e `GET /api/entidades` respondem **502** quando
Neo4j ou R2 não atendem, com a causa legível no corpo (seção 5.2).

**As duas configurações que mudam comportamento, por extenso.** Nenhuma delas é
detalhe de deploy: o teto de execução é o que decide se um `waitUntil` termina, e
`force-dynamic` é o que impede o App Router de servir estado de sessão em cache.

| `maxDuration` | Rotas |
|---|---|
| 300 s | `/chunks/:i/pronto`, `/finalizar`, `/extrair`, `/entidades/enriquecer`, `/entidades/retrato/proposta`, `/confronto/rodar`, `/cron/confronto`, `/cron/enriquecimento`, `/chat`, `/extracao/eventos` — as que chamam modelo dentro de `waitUntil`, correm a mesma fila em loop, encadeiam até oito chamadas antes de responder, ou **mantêm um fluxo aberto** |
| 60 s | `/confirmar`, `/atomos/embutir`, `/entidades/embutir`, `/entidades/duplicatas`, `/entidades/fundir`, `/entidades/perfil/rascunho`, `/calibracao/padroes`, `/calibracao/redacao` |
| padrão | todo o resto |

O 60 s do `/confirmar` é o que mais importa: a apuração de correções roda no
`waitUntil` dele, **depois** da resposta, e é dentro desse teto que ela termina
ou não (§4.11).

O 300 s do `/entidades/enriquecer` não é o tempo de uma ficha — uma chamada de
modelo e duas consultas cabem folgado em 60. Ele é o que permite a **espera de
rate limit sem prazo** que a fila usa (§4.9): uma espera de 75 s estouraria um
teto de 60 e mataria o elo no meio do sono. `LEASE_MS` é o mesmo número, e é por
isso: passado ele, a função que reivindicou está morta com certeza.

`dynamic = "force-dynamic"` nas rotas que leem estado — nenhuma delas pode
servir resposta de cache: `/api/sessoes`, `/api/sessoes/:id`,
`/api/sessoes/:id/extracao`, `/api/sessoes/:id/extracao/eventos`,
`/api/entidades`, `/api/entidades/retrato`, `/api/calibracao`,
`/api/calibracao/sugestao`, `/api/confronto`, `/api/confronto/atomo/:id`,
`/api/confronto/busca`, `/api/chat`, `/api/conversas`, `/api/conversas/:id`,
as duas de medidas (`/api/medidas` e `/api/sessoes/:id/medidas`) e as três de
cron.

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

