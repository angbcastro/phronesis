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
- [ ] `LIMIAR_CONFIANCA = 0,7` é ponto de partida, não medida. Ajustar olhando a
      revisão (§4.13).
- [ ] **(conferir)** O cabeçalho do `ARCHITECTURE.md` ainda diz que a migration
      010 "não foi rodada". Com a 4.12.1 no ar, ela deve ter rodado no build.
      Confirmar e corrigir o documento.

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

## Slice 3 — duplicatas

- [ ] A qualidade do `duplicatas-2` num par real vindo de sessão. A mecânica
      está validada; o julgamento com contexto de verdade, não (§14).

## Gravação e PWA

- [ ] Gravar com a tela apagada. Não está medido se o Chrome no Android
      estrangula o `setTimeout` de 30 s do gravador (§14).
