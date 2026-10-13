## 14. Limites conhecidos

- **Uma chamada por dimensão lê todos os átomos do "eu"** (10, §4.20). Cabe
  enquanto o bloco couber no contexto do modelo — ~5 anos no ritmo de 23/09 para
  o padrão de 1M. Trocar `RETRATO_MODEL` por um de contexto menor antecipa esse
  dia. O conserto, quando vier, é capítulos por período.
- **O cache do provedor é uma economia, não um contrato** (10, §4.20). Se o
  provedor não cachear — ou se as chamadas paralelas da fase 2 caírem em
  backends diferentes —, a rodada custa N vezes a entrada inteira: mais caro,
  igualmente certo. **Ainda não medido em paralelo**; o `cache=` do log de cada
  chamada é onde se olha.
- **O retrato escreve sem eu revisar antes**, como a ficha da 4.12. A defesa é a
  mesma: eu leio depois, e o desfazer está a um toque.
- **O (i) do retrato mostra o que o modelo disse que usou**, não uma prova de que
  cada frase está sustentada. Frase sem apoio só aparece quando eu leio.
- **O desfazer do "eu" não é atômico** entre Neo4j e R2, nem dentro do R2 (dois
  PUTs). Falha no meio deixa um lado trocado, a rota diz qual, e o conserto é à
  mão — um segundo toque trocaria o R2 de volta e o nó para a frente.
- **O "eu" na batida depende da ordem da reivindicação** (10, §4.9). Rodada que
  cresça além de ~240 s não cabe numa invocação nem começando no segundo zero, e
  aí a batida deixa de reescrever o retrato — em silêncio, a não ser pelo
  `rodando` que volta pelo lease toda semana. **O tempo da rodada inteira ainda
  não foi medido**; os 60 s de `JANELA_DO_EU_MS` pressupõem até 240 s.
- **Um prompt do chat editado em `/agentes` antes da slice 10 não conhece
  `ler_retrato`** — a ferramenta é oferecida, mas sem a instrução de começar por
  ela nas perguntas sobre mim. Salvá-lo de novo pede que ele a cite (envelope).

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
- **Sem teto de saída, o custo de uma ficha é o que o modelo decidir pensar**
  (4.12.1). Para o "eu", em 23/09, ~8 mil tokens de saída por rodada, e cresce com
  ele — centavos no preço daquele dia. O teto que sobra é o do modelo (32.768 de
  saída para o padrão), e trocar `ENRIQUECIMENTO_MODEL` troca esse número junto.
  Bater nele é `falhou` com `finishReason=length` no motivo.
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
- **O encadeamento ainda pode cair, e a quebra de 23/09 continua sem causa
  conhecida** (4.12.1). O `waitUntil` do elo pode morrer, e o cookie repassado
  pode expirar no meio de uma fila longa. O que a 4.12.1 garante é que a próxima
  quebra deixa a linha `[fila] o elo seguinte respondeu <status>` no log, e que
  `/entidades` aberta retoma a corrente sozinha — não que ela não quebre. **Com a
  aba fechada, uma corrente que cai na terça espera** até eu abrir a tela ou até
  a batida de segunda-feira.
- **A batida semanal escreve fichas sem eu ter apertado nada** (4.12.1), que é a
  recusa da 4.12 reaberta por pedido meu. A defesa é a mesma do lote — só
  canônicas, desfazer de um toque —, e o custo que ela cria é este: a ficha que
  eu edito à mão numa canônica é reescrita na segunda seguinte se ela ganhou
  átomo. O desfazer traz a minha versão de volta; a próxima batida a sobrescreve
  de novo.
- **A primeira batida pega o atrasado inteiro.** Em 29/09 eram 28 canônicas: o
  "eu" (falhou), Isinha e meu pai (ganharam átomo), e 25 que nunca rodaram —
  mais as 10 que estão em `na_fila` desde 23/09. É uma rodada de ~40 fichas, e
  só essa.
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
- **As janelas do fim têm até 280 s (`PRAZO_DA_FUNCAO_MS`) contados do começo
  da função**, sob o `maxDuration` de 300 s — o máximo do plano Hobby. Eram 120 s
  fixos (`ORCAMENTO_JANELAS_MS`) até 30/09, e com o `deepseek/deepseek-v4.1-flash`
  cabia uma janela neles, às vezes nenhuma: uma janela custa 60–100 s (extração
  ~50 s, resolução 15–30 s), e das 19 sessões medidas no R2 saíram 22 falhas
  `janela_presa`. Não era "o caso ruim de um caso raro": a extração não alcança a
  fala durante a gravação, e o `/finalizar` herda uma ou duas janelas quase
  sempre. O re-extrair (`forcar`, que refaz tudo do zero) nunca fechava uma
  sessão de três janelas nos 120 s. Estourado o prazo, a sessão continua indo
  para `erro`, e o retry continua sendo `/finalizar` ou `/extrair`. **O que ainda
  limita é o relógio**: `TETO_CHAMADA_MS` corta cada chamada em 180 s (eram 90 s
  até 30/09), e três janelas lentas ainda podem não caber em 280 s.
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
- **O confronto não tem mais piso de similaridade** (slice 5.2): `PISO_CONFRONTO`
  foi medido inerte na 5.1 (o par menos parecido das 21 primeiras relações tinha
  0,728) e saiu quando os candidatos passaram a ser cem. O corte é o ranking do
  índice e mais nada.
- **O piso do `COMPLEMENTA` (0,7) ficou, e mudou de efeito** (slice 5.1, 5.2):
  abaixo dele a relação forte desce para sutil, em vez de sumir. Mora em
  `/agentes`, e é ali que se ajusta.
- **A camada forte continua calibrada para precisão** (§4.15.2); a cobertura
  que a 5.1 cortou foi para a camada **sutil**, rotulada (§4.15.3). O preço que
  sobra é que a camada sutil é, por definição, a que mais erra — o que a segura
  é o rótulo no chat e a minha correção no radial, não o prompt.
- **O custo por átomo multiplicou** (slice 5.2): cem trechos por chamada, uma
  chamada por átomo, onde a 5.1 dividia uma chamada entre dez. Centavos no
  deepseek, mas uma varredura completa — o reprocessar — fica mais lenta e mais
  cara, e cinco chamadas paralelas por elo chegam mais perto do rate limit da
  conta.
- **O teto de sete é da rodada do átomo** (slice 5.2): as arestas que rodadas
  de outros átomos apontam para ele não contam, então um átomo muito citado pode
  ter mais de sete relações.
- **Relação congelada nunca é revisitada** (slice 5.2), nem quando o prompt
  melhora. E **a recusa não tem desfazer na tela**: apagar uma relação é para
  sempre até eu pedir outra coisa.
- **Par julgado `NENHUMA` não deixa rastro** (slice 5.2): pode ser julgado de
  novo quando o outro átomo for alvo, e a leitura é paga duas vezes.
- **Prompt editado no painel sombreia a base**: um override do `confronto`
  salvo antes da 5.2 pediria o envelope velho (`novo`/`velho`), e o parser novo
  não o leria — toda resposta viraria "nenhuma relação". Em 13/10 o painel de
  produção não tinha override nenhum do `confronto`; o risco volta se um prompt
  antigo for restaurado de lá.
- **O modelo do confronto passa do teto de chamada às vezes** (slice 5.2): na
  comparação de 13/10 o `deepseek-v4.1-flash` levou 54 s em média com cem
  candidatos, e um átomo em quinze não voltou em 180 s (`TETO_CHAMADA_MS`). Esse
  átomo sai `falhou` e volta na varredura seguinte — com a mesma entrada, então
  pode falhar de novo. Se a fila acumular `falhou` por prazo, o conserto é
  menos candidatos ou outro modelo, não um teto maior: a função tem 300 s.
- **A regra de referente cobra caro quando o átomo antigo não tem entidade
  ligada**: um `FATO` que diz "uma menina que eu conheci na festa" nunca vai se
  ligar a um átomo que nomeia a pessoa, porque o agente se recusa a presumir. O
  conserto é ligar a entidade ao átomo — dado, não prompt —, e hoje não há tela
  que faça isso num átomo já confirmado.
- **O custo do confronto cresce com o volume de átomos**: cada um pendente paga
  uma busca vetorial e, havendo candidato, uma chamada de modelo. Sem teto de
  quantos processar por rodada além do orçamento de tempo da função: um grafo
  com anos de histórico leva várias rodadas (cron diário, o disparo do
  confirmar, ou vários toques em "rodar agora") para terminar de cobrir o
  retroativo.
- **Cem candidatos não têm teto de tamanho** (slice 5.2): `K_CANDIDATOS` conta
  átomos, não caracteres, e uma vizinhança de `HISTORIA`s longas faz o prompt
  daquele alvo crescer junto.
- **`reprocessar` é destrutivo e não tem desfazer** (slice 5.1): apaga as
  relações do agente de todos os átomos de uma vez. O contrapeso é a varredura
  reconstruir, e os dois toques na tela.
- **Átomo sem `valido_em` nunca é candidato de ninguém** (slice 5): sem data não
  há como dizer quem é o mais novo. Ele ainda passa pela fila — e sai sem
  relação nenhuma, sem ir ao modelo.
- **Nenhuma segunda passada para relação de baixa confiança.** O número é lido
  só para rebaixar `COMPLEMENTA` forte abaixo do limiar e para o teto de sete
  escolher entre as sutis — não para mandar o par a uma segunda leitura como o
  `desempate-1` faz na resolução.
- **Duas correntes do confronto podem nascer juntas** (slice 5.2): `se_parado`
  olha se há átomo `rodando`, e entre um elo e o seguinte há um instante sem
  ninguém. O preço é pagar em dobro por um tempo, nunca gravar em dobro — o
  lease separa os alvos.
- **O chat assume que a slice 5 funciona bem** (slice 6). `historico_do_atomo`
  lê as relações da migration 011, e se a varredura não tiver passado — ou tiver
  passado e descartado o par certo — ele volta sistematicamente com "este átomo
  ainda não tem nenhuma relação de confronto registrada", e perguntas de "como
  mudei de opinião" ficam sem resposta real. Não é bug desta fatia, e o conserto
  não mora nela: é o prompt do confronto, ou ligar o átomo órfão à entidade certa
  (§4.15.2). Desde a 5.2 o confronto cobre bem mais — e o chat passou a depender
  também de respeitar o rótulo `(sutil)`, que só o prompt dele garante.
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
  não foi medido** (slice 6). Desde a slice 9 o padrão é **constante própria**
  (`MODELO_CHAT_PADRAO`), e não mais herança da extração: a troca de 20/09 mudou
  a resposta do chat num commit que não falava do chat. O id continua sendo
  `deepseek/deepseek-v4.1-flash` — escolhido para devolver JSON curto, que não é
  a mesma habilidade —, e continua escolha sem medição: a spec da 9 pedia medir
  cinco perguntas reais por candidato antes de fixar, e eu decidi fixar sem
  medir. Se ele encadear mal, o conserto é `CHAT_MODEL` ou o painel de
  `/agentes`, sem deploy; qual modelo serve continua pergunta aberta.
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
- **O total do caminho vetorial conta dentro da janela de `K_BUSCA`, não do
  diário** (slice 9). O "sem dizer que cortou" da slice 6 está resolvido — as
  duas Cypher contam, e o modelo lê o número antes dos trechos (§4.16.2) —, mas
  com `texto` a conta é de quantos dos 48 vizinhos passaram. Com 108 átomos
  (18/09) a janela era quase metade do diário; em 23/09 já eram 151, e ela é um
  terço. A linha diz isso com todas as letras ("não no diário inteiro"); quando o
  diário crescer mais, é o texto dela e o `K_BUSCA` que se revisitam juntos.
- **`buscar_entidades` vale o que a ficha tem dentro** (slice 9). Em 23/09, 2 das
  51 entidades ativas tinham `resumo`, 2 tinham `contexto`, 1 tinha
  `pode_ajudar_com`. Ficha vazia faz a ferramenta custar uma chamada para
  devolver casca — nome, contagens, datas e quem co-ocorre —, e o caminho por
  `texto` quase só acha pelo nome, porque é só o nome que está no vetor. O
  conserto é rodar o lote de enriquecimento em `/entidades` (4.12), não mexer
  na ferramenta; o agente 4 que escreve as fichas nunca foi medido numa sessão
  real.
- **Três ferramentas disputam mais atenção do modelo que duas** (slice 9) — e
  desde a slice 10 são quatro —, e o
  `CHAT_MODEL` que as recebe é o `deepseek/deepseek-v4.1-flash`, escolhido sem
  medir tool-calling multi-passo. Se ele encadear mal, a ferramenta nova piora a
  resposta em vez de melhorar — e o conserto é o modelo ou o prompt, não remover
  a ferramenta.
- **Um prompt do chat editado em `/agentes` antes da slice 9 não conhece o que
  ela trouxe.** O override guardado no R2 vence o `chat-5` do código: a linha de
  recorte continua saindo da busca, e `buscar_entidades` continua oferecida,
  mas sem as instruções de como ler uma nem quando usar a outra.
- **O piso de 0,45 e o teto de 8 não foram medidos contra gabarito** (slice 6, e
  não podiam ser: `CLAUDE.md` diz que quem julga extração aqui sou eu, na tela).
  O que existe é uma medida emprestada — os 0,728 da varredura de confronto, em
  4.15, que é átomo contra átomo e não diz nada sobre pergunta contra átomo — e
  uma pergunta real que ficou ruim. Desde a slice 9 o instrumento está no (i):
  por passo, quantos passaram do piso, quantos ficaram abaixo e o melhor
  cortado.
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

