# Próximos testes

O que está construído e ainda **não foi validado**. A lista foi tirada do
`ARCHITECTURE.md` (cabeçalho e §14) e das specs em 29/09/2026. Cada item diz onde
está o detalhe. Quando um teste passar, ou mudar a decisão, apague a linha — este
arquivo só existe enquanto houver o que conferir.

Itens com **(conferir)** podem já ter sido feitos sem que o documento registre.
Confirme antes de gastar uma sessão com eles.

## Pré-requisito

- [ ] Restaurar o `.env.development.local` (Aura dev + bucket dev, com os três
      do Neo4j e o `R2_BUCKET`). Sem ele o `pnpm dev` escreve em produção
      (§12.1), e os testes em dev da slice 10 não podem rodar.

## Interface — onda 1 (`Specs/interface.md`)

Construída e coberta por `pnpm typecheck` e `pnpm test`; nenhuma tela foi
olhada rodando, porque sem o arquivo de dev o `pnpm dev` lê produção. Num
celular, ou nos 390 px do DevTools, contra o banco de desenvolvimento:

- [ ] `/agentes`: o ponto "editado" aparece no cartão e não no canto da tela; o
      h1 não passa por baixo da marca; a gaveta desliza ao abrir e ao fechar.
- [ ] Na tela de gravar, com o chat aberto: a engrenagem não cobre a borda
      esquerda do painel.
- [ ] A revisão: a instrução do topo e as linhas do rodapé em cinza, menores
      que os átomos. **É a única mudança visível na tela sagrada** — se ficou
      apagada demais, é uma linha no `globals.css`.
- [ ] `/sessoes`: "em revisão" com acento; depois de um reextrair, a linha muda
      sozinha de status sem recarregar a página.
- [ ] `/calibracao`: com a rede cortada no DevTools, abrir um agente mostra a
      falha e o "← voltar à lista", e não "…".
- [ ] Só teclado: Tab mostra o anel terracota em todo controle; Esc fecha o
      modal de fontes, o chat e o editor de agente, e o foco volta de onde saiu;
      Enter no ✕ de uma menção a tira.
- [ ] Importar um áudio, fechar a gaveta no meio do upload e começar a gravar:
      a gravação não é interrompida quando o upload termina, e a sessão
      importada aparece em `/sessoes`.

## Interface — onda 2 e as cinco decisões (`Specs/interface.md`)

Construída e coberta por `pnpm typecheck`, `pnpm test` e `pnpm build`; nada
olhado rodando, pela mesma razão da onda 1. A volta é a tag
`ui-antes-da-onda-2`.

- [ ] **O conjunto.** Passar por todas as telas a 390 px: o desenho mudou pouco
      em cada uma e muito no todo — letras de 12 px no mínimo, bordas de
      controle mais claras (`--linha-controle`), pílulas de 32 px. Se a borda
      ficou clara demais, é um token só.
- [ ] O botão de confirmar, o "salvar" do editor de agente e o "entrar" no
      terracota escurecido; o círculo de gravar igual a antes.
- [ ] Uma falha qualquer (rede cortada no DevTools) sai em vermelho; um
      "apagar?" armado também, e em repouso não.
- [ ] `/entidades`: abrir uma ficha, cortar a rede e salvar o resumo — a falha
      aparece dentro da ficha.
- [ ] Em `/sessoes`, `/entidades`, `/agentes`, `/confronto`, `/calibracao` e na
      transcrição: a engrenagem no canto direito, a gaveta entrando por ali com
      a tela atual marcada, e ir de uma tela a outra sem passar por `/`. No
      corredor e na revisão, nenhuma engrenagem.
- [ ] Confirmar uma revisão: "guardado · N itens" no alto da home por ~3 s, o
      círculo parado; recarregar não o repete.
- [ ] Na revisão, tocar no meio de uma palavra do texto de um átomo: o cursor
      nasce ali, e o teclado do celular sobe. Testar no Chrome do Android e no
      Safari do iPhone — os dois têm caminhos diferentes (`caretPositionFromPoint`
      e `caretRangeFromPoint`).
- [ ] As datas em `dd/mm` nas listas, na revisão e no radial; a lista de
      sessões com "hoje" e "ontem".

## Interface — onda 3, o ritual (`Specs/interface-onda-3.md`)

Construída e coberta por `pnpm typecheck`, `pnpm test` e `pnpm build`; nada
olhado rodando, pela mesma razão das ondas 1 e 2. A volta é a tag
`ui-antes-da-onda-3`. No celular, contra o banco de desenvolvimento:

- [ ] **As entidades no topo, numa revisão que ainda cresce.** Abrir a revisão
      logo depois de parar, rolar até o meio dos itens e esperar o fim chegar: no
      Chrome a tela fica parada; no Safari ela pode pular (limite do §14).
      Trocar uma conhecida por outra entidade: todos os itens que a citavam
      passam a citar a nova, sem abrir item nenhum.
- [ ] **O pronome resolvido no item.** Um item com "ela" mostra "quem é 'ela'?"
      no cartão; escolher ali some o campo de todos os itens e resolve a linha de
      cima. O confirmar travado diz o motivo no próprio texto, e o rodapé não
      muda de altura.
- [ ] **O checkbox.** Tocar um pouco fora dele, à esquerda ou acima, desmarca;
      tocar no começo do texto edita, e não desmarca.
- [ ] **O ▶ atravessando um bloco.** Um trecho perto dos 30 s de um bloco: "…",
      depois ■ com o intervalo, toca de 2 s antes até o fim do que foi dito,
      continua no bloco seguinte (com um vão curto) e para sozinho. Sem rede, o
      botão diz "sem áudio".
- [ ] **O microfone tirado no meio da fala.** Gravando com um fone com fio,
      tirá-lo: a linha abaixo do timer diz "o microfone parou" em vermelho, e o
      "parar" guarda o que já foi. Cortar a rede: "sem rede — guardando no
      aparelho".
- [ ] **O "tentar de novo" do corredor.** Forçar uma falha (rede cortada ao
      parar): o verbo fica no centro, onde o círculo estava, e "tentar de novo"
      ali mesmo leva à revisão quando a rede volta.
- [ ] **O (i) com ▶.** Uma pergunta nova no chat: o (i) abre pelos trechos, cada
      um com tipo, data e ▶, e o ▶ toca o trecho; "como procurei ▸" abre o
      técnico. Uma pergunta que só consulta o grafo abre o (i) direto no
      técnico. Mensagem antiga mostra os trechos sem ▶.
- [ ] **Apagar conversa.** "apagar" vira "apagar?" em vermelho; o segundo toque
      apaga; esperar 4 s, ou tocar fora, desarma.
- [ ] **A rolagem do chat.** Durante uma resposta, subir para reler: a lista não
      é puxada ao fim, e aparece "↓ resposta nova"; tocar nele desce. Com o
      teclado aberto, a última fala continua à vista.

## Interface — onda 4, a gestão (`Specs/interface-onda-4.md`)

Construída e coberta por `pnpm typecheck`, `pnpm test` e `pnpm build`; nada
olhado rodando, pela mesma razão das outras ondas. A volta é a tag
`ui-antes-da-onda-4`. No celular, contra o banco de desenvolvimento:

- [ ] **A linha da sessão.** Cada linha começa pela frase do primeiro item, em
      até duas linhas; embaixo, data, duração, status e "8 itens" — ou "5 para
      revisar" na em revisão. Sessão sem item mostra a data em cima.
- [ ] **A 51ª sessão.** Num banco com mais de 50 sessões, rolar até o fim:
      "carregando…" e as seguintes aparecem; o cabeçalho diz o total. Com a
      rede cortada, "não deu para carregar as seguintes — tentar de novo", e o
      toque carrega quando a rede volta.
- [ ] **A ficha salva ao sair do campo.** Escrever no resumo e tocar fora:
      "salvando…", depois "salvo" ao lado do rótulo. Trocar o nome e dar Enter
      renomeia, e a ficha continua cheia.
- [ ] **Segura no fechar.** Com a rede cortada, escrever e tentar fechar: o ←
      vira "← descartar 1?" em vermelho, e só o segundo toque fecha e perde o
      texto. Esperar 4 s desarma.
- [ ] **Os rascunhos são da entidade.** Com um rascunho que não gravou numa
      ficha, "desfazer" em outra não o apaga.
- [ ] **O par de duplicatas.** "comparar" abre a ficha com as duas lado a lado,
      "Isto não tem desfazer" e o "manter esta" de cada lado.
- [ ] **O radial a 390 px.** A data se lê sem zoom; tocar perto de um nó ou de
      uma sigla acerta, e não o vizinho. Um átomo com vizinho de outro ano à
      direita: a data cabe (ou passa pouco da borda, limite do §14).
- [ ] **O editor de agente.** Mexer numa seção do prompt: aparece "o que
      difere do git — 1 seção", com "no git" e "agora". Apagar uma seção
      inteira: ela aparece "tirada", no fim. Tentar fechar sem salvar: o × vira
      "descartar?", e só o segundo pedido fecha. Num agente editado, "voltar ao
      original" pede "voltar ao original?" antes.
- [ ] **O descartar da emenda.** Em `/calibracao`, com uma emenda escrita,
      "descartar" vira "descartar?" em vermelho; o segundo toque descarta.

## Slice 12 — o chat que navega o grafo (`Specs/slice-12.md`)

Construída e coberta pelo `pnpm test`; os modelos foram comparados pelo
`pnpm comparar:chat`, que só lê. Nada foi olhado no app. No celular:

- [ ] As nove perguntas (§1 da spec), julgadas por mim pelo (i): a informação
      certa, a Cypher de cada passo e as linhas que o modelo leu.
- [ ] "Me teste no que aprendi na última semana", em vários turnos: uma
      pergunta por vez; a correção contra o texto do trecho, com a data; a
      próxima sobre o trecho seguinte; e o fim quando o recorte acaba.
- [ ] Uma pergunta local do tipo Isinha responde como antes: curta, em prosa,
      um ou dois trechos.
- [ ] O (i) a 390 px: a Cypher quebra a linha; "ver as N linhas" abre a
      tabela, que rola por dentro, com o cabeçalho preso, sem a página ganhar
      rolagem horizontal.
- [ ] Nenhum prompt do chat editado em `/agentes` (spec §9): um override salvo
      antes do `chat-8` sombreia o prompt novo, e o envelope agora cobra
      `consultar_grafo`.

## Slice 11 — o que faltou, a pedido (`Specs/slice-11.md`)

Construída e coberta pelo `pnpm test`; nada disto rodou contra modelo ainda. Em
dev, contra o banco de desenvolvimento, numa sessão real em revisão fechada:

- [ ] Pedir algo que eu falei: o átomo chega no fim, aprovado, com player e com
      a linha "a pedido: «…»". **Medir o tempo da chamada** numa sessão de
      ~15 min: se passar de 200 s, parar e rever o prazo (ordem de execução 3 da
      spec — a rota tem 280 s e o rate limit come o resto).
- [ ] Pedir algo que eu não falei: volta "não achei isso na transcrição", e
      nenhum átomo inventado. Se vier átomo, ele está "sem áudio"?
- [ ] O mesmo pedido de novo: volta na hora, sem chamar modelo (sem linha
      `[pedido]` nova no log).
- [ ] Fechar a aba no meio de um pedido e reabrir a revisão: o átomo está lá.
- [ ] Editar o átomo pedido (texto, tipo, sujeito, menções), confirmar, e ver no
      grafo `prompt_version` e `modelo`, as entidades certas, e o confronto dele
      rodando de fundo.
- [ ] Em `/calibracao`, sob `extracao`, a correção `faltou` com o texto final do
      átomo pedido — e nenhuma `rejeitado`/`texto` por causa dele.
- [ ] Re-extrair (`forcar`) uma sessão com pedido: a revisão volta sem os
      átomos pedidos.
- [ ] No celular: o campo do "+" e o botão cabem na largura.

## Slice 5.2 — o confronto amplo (`Specs/slice-5.2.md`)

O modelo já foi escolhido (`deepseek-v4.1-flash`, comparação de 13/10) e o
painel de produção não tem override do `confronto`. Na ordem:

- [ ] Mandar buildar o commit da migration 013 (no-op, só documentação).
- [ ] "Reprocessar tudo" e deixar a fila andar. Ler no log `[confronto] elo de
      …`: quantas relações, quantas rebaixadas, quantas cortadas, quantas falhas.
      Na comparação, um átomo em quinze passou dos 180 s: contar quantos saem
      `falhou` por prazo e se voltam a falhar na varredura seguinte (§14).
- [ ] Abrir o radial de átomos que eu sei que se relacionam (um sentimento e o
      fato da mesma gravação; uma expectativa e o que aconteceu dias depois) e
      julgar: veio? Em que camada? A seta aponta o mais antigo?
- [ ] Corrigir algumas relações (tipo, camada, motivo, apagar) e conferir em
      `/calibracao`, sob `confronto`, que as correções aparecem com o par. Rodar
      o átomo de novo ("desfazer" na lista e "rodar agora") e ver que a editada
      ficou e a apagada não voltou.
- [ ] Confirmar uma sessão e ver o confronto dela rodar de fundo sem eu tocar em
      nada — e não abrir segunda corrente se a fila já estiver andando.
- [ ] Chat: uma pergunta de "depois de quê" sobre um átomo com relação sutil. O
      (i) mostra `(sutil)` no histórico, e a resposta diz "parece ligado a", não
      afirma.
- [ ] No celular: o radial cabe na largura sem rolagem horizontal, e os rótulos
      das arestas são tocáveis.

## Slice 10 — o retrato do "eu" (`Specs/slice-10.md`)

- [ ] Conferir se o "eu" do banco **de desenvolvimento** está `canonico = true`.
      O de produção já está.
- [ ] **Ponto de retorno da spec:** rodar o "eu" em dev e ler no log o tempo da
      fase 1, o da fase 2 e o total. **Se passar de 240 s, a decisão volta para
      a mesa** (§4.20, §14).
- [ ] **Ponto de retorno da spec:** na fase 2, `cache=` perto da `entrada=` em
      **cada** chamada paralela. Se não ler o cache, a decisão é fixar o provedor
      por `providerOptions.gateway` (ainda não está no código).
- [ ] Pedir a proposta de dimensões, editar, aprovar, e ler o
      `config/retrato-eu.json`.
- [ ] Rodar o "eu", ler o retrato seção por seção, e julgar a qualidade: o Agora
      no topo com o "até", e cada dimensão dizendo o que é hoje e o que mudou,
      com mês e ano.
- [ ] Abrir o (i) de uma seção e ver os trechos. Rejeitar um átomo que é fonte e
      conferir que ele aparece riscado.
- [ ] Desfazer e refazer: os dois lados trocam (o nó e `eu.json` ↔
      `eu.anterior.json`). Com a rodada rodando, o desfazer responde 409.
- [ ] Falha parcial numa rodada de verdade, se acontecer: o selo da linha mostra
      o motivo e a seção fica com o texto anterior.
- [ ] Chat: "como está meu treino?" — o (i) mostra `ler_retrato` com a dimensão
      do corpo, e só ela.
- [ ] Chat: se o prompt do chat estiver editado no painel, ele não cita
      `ler_retrato`. Decidir se reedita.
- [ ] Na segunda-feira seguinte a uma semana com átomo novo do "eu": o retrato
      foi reescrito pela batida, e o "eu" saiu na primeira volta.

## Slice 4.12.1 — fila sem teto, retomada, batida semanal

- [ ] Ver as dez entidades de 23/09 saírem da fila em produção.
- [ ] A primeira batida de segunda (05/10, 07:00 UTC) rodar com as canônicas com
      novidade, e ler o log (`[cron-enriquecimento]`).
- [ ] Se a corrente quebrar de novo, ler o status HTTP no log (`[fila] o elo
      seguinte respondeu …`). A causa da quebra de 23/09 continua desconhecida.

## Slices 4.11 e 4.12 — resumo, desempate e o agente 4

- [ ] **A medida que fecha a 4.12:** uma sessão real depois do lote. O
      `[desempate]` deve ficar calado na maioria das menções. Se continuar
      disparando em tudo, o conserto é o prompt do `enriquecimento-1`.
- [ ] Ler as fichas que o agente 4 escreveu. Ele nunca foi julgado numa sessão
      real.
- [ ] Decidir o destino do agente 3 (rascunhar por campo) e do `:PERFILA`:
      conviver, encolher ou sair, depois de ver se ainda uso o botão (§4.9).
- [ ] `LIMIAR_CONFIANCA = 0,7` é ponto de partida, não medida. Ajustar olhando a
      revisão (§4.13).
- [ ] **(conferir)** Que a migration 010 rodou no build (é no-op, 0
      statements). O cabeçalho antigo do `ARCHITECTURE.md` dizia que não; com a
      4.12.1 no ar, ela deve ter rodado.

## Slice 9 (e 6) — o chat

- [ ] Nada da slice 9 foi julgado numa pergunta real: `chat-3`, `chat-4`,
      `chat-5` e, agora, `chat-6`.
- [ ] O `CHAT_MODEL` (`deepseek/deepseek-v4.1-flash`) nunca foi medido em
      tool-calling multi-passo, e agora são quatro ferramentas (§14).
- [ ] O piso de 0,45 (`PISO_BUSCA`) e o teto de 8: julgar pelo (i), que mostra
      quantos passaram do piso e o melhor cortado.

## Slices 8 e 8.2 — medida, e a revisão que abre antes

- [ ] O teto de 16.000 da extração: se a sessão `mu4um3ot3t5k4g1u1p1j` e as
      próximas continuarem estourando, o próximo candidato é trocar o modelo de
      extração, e não subir o teto (§14).
- [ ] O modelo de extração padrão (`deepseek/deepseek-v4.1-flash`) tem três
      pontos não medidos: quanto ele pensa, se estoura o teto e a qualidade da
      lista (§14).
- [ ] Ler o `medidas.json` de sessões reais depois dos seis consertos e ver se
      a espera caiu. Quem fecha a fatia 8 é a leitura, não o código.
- [ ] O prazo das janelas do fim virou o da função (`PRAZO_DA_FUNCAO_MS`, 280 s)
      em 30/09, e a resolução ganhou teto de 100 mil sem segunda tentativa.
      Conferir numa sessão real: `falhas` sem `janela_presa`, nenhuma linha
      `[resolucao] o agente falhou` com `finishReason=length`, e o re-extrair
      da `muo7wzdf656z3d07713z` chegando a `em_revisao`. Se ainda aparecer
      `a chamada não voltou em 180s`, quem corta é o `TETO_CHAMADA_MS` (subiu
      de 90 s para 180 s no mesmo dia, e o `/pronto` passou a ter prazo).

## Slice 7 — o laço de calibração

- [ ] Nenhuma emenda foi aprovada ainda. Rodar pauta → emenda → aprovar num
      agente real, e ver a emenda valer na próxima chamada sem deploy.

## Slices 4.8 e 4.10 — janela e importação

- [ ] Uma sessão real de 15 min: a janela deve **estender** em vez de duplicar
      (inclusive `ROTINA`), e a revisão não pode abrir inchada (§14).
- [ ] Uma sessão de 15 min (30 blocos) transcrita inteira sob rate limit. Até
      agora só foram medidas chamadas soltas (§14).
- [ ] **(conferir)** A verificação à mão da 4.10: importar de novo o áudio de
      17 min (`mtqoeoqh3e3724514q1f`), comparar com a proposta guardada e olhar
      o log.
- [ ] O alvo de 10 a 20 átomos por 15 min, pedido em proporção por janela:
      contar numa sessão longa real quantos saem (§14).

## Slice 4.9 e anteriores — identidade e revisão

- [ ] Numa sessão real, uma grafia que o STT erra chegar ao átomo já com o nome
      gravado (o dossiê do extrator, §4.14). Correção de grafia que sobreviver
      continua saindo etiquetada `extracao` ou `grafo` (§14).
- [ ] Julgar um homófono de verdade: cadastrar os dois nomes em `/entidades`
      **antes** e gravar uma sessão citando os dois (o Rapha e o Raffa). Até
      agora o `resolucao-5` só respondeu listas de um.
- [ ] Cronometrar a revisão de uma sessão de 15 min: a visão promete menos de
      60 s, e a tela mudou duas vezes a olho, sem cronômetro (§4.7).

## Slice 3 — duplicatas

- [ ] A qualidade do `duplicatas-2` num par real vindo de sessão. A mecânica
      está validada; o julgamento com contexto de verdade, não (§14).

## Gravação e PWA

- [ ] Gravar com a tela apagada. Não está medido se o Chrome no Android
      estrangula o `setTimeout` de 30 s do gravador (§14).
- [ ] Abrir a tela de gravar e olhar o halo respirar. O botão foi verificado
      por teste e compilação, não por olho.
- [ ] Importar um arquivo de cada formato da lista (Ogg/Opus, M4A, MP3, WAV) e
      ver o `xai/grok-stt` aceitar. Até agora ele só recebeu `audio/webm` (§14).
