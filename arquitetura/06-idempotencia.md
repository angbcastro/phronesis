## 6. Idempotência

Regra inviolável 4: todo passo é chaveado por `sessao_id` (+ `chunk_index`).
As travas:

| Trava | Onde | Efeito |
|---|---|---|
| `chunk_NNN.json` existir | `pipeline.transcreverBloco` | não rechama o STT nem sobrescreve resultado pronto — mas só **depois** de a transcrição voltar |
| lease `transcrevendo_em` com prazo (`LEASE_BLOCO_MS`, 120 s) | `manifest.reivindicarBloco` | fecha a janela que a trava de cima não cobre: entre o pedido e a resposta do STT, dois workers mandariam o mesmo áudio (§4.18) |
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
| `embedding_fonte` bater | `entidades.garantirEmbeddings` | entidade em dia não é reembutida — e por isso não há gancho a esquecer em nenhuma das rotas de entidade |
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
e teto de 2 s por espera — ver abaixo.

**O laço mora em `etag.ts`, e é um só** — manifest, `parcial.json`,
`calibracao/indice.json` e medidas passam por ele, e com cópias uma correção
alcançaria só algumas. Cada chamador traz o que é dele: a curva de espera (os
números do manifest são os únicos diferentes, e o porquê está logo abaixo), o
`normalizar` que materializa o objeto ausente ou conserta o formato antigo, e o
mutador. O que o laço devolve a mais é `mudou` — "a escrita foi minha?" —, e é
isso que faz a reivindicação de uma janela ser uma trava de verdade em vez de
uma esperança.

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
continuam chegando. Dez tentativas com teto de 2 s absorvem a rajada sem
transformar isso numa espera visível de dezenas de segundos; com menos, o laço se
esgota e a exceção sobe da rota `pronto`.

**A rota `pronto` responde 502 legível, não 500 cru**, como as outras (§5.2):
`existe`, `atualizarManifest` e `atualizarSessao` estão dentro de um
`try/catch` que devolve `erroDeInfra` — o que sobrar do laço acima, ou
qualquer outro tropeço de R2/Neo4j síncrono, aparece com a causa no log e uma
frase na tela. O `waitUntil` de STT/janelas fica fora do `try`: falhar ali não
pode derrubar a resposta que já foi decidida.

Duas exigências de transporte do R2 sustentam isso, ambas dentro de `put()` em
`r2.ts`:

- **`Content-Length` sempre explícito.** O undici o deduz de corpo em texto, mas
  essa dedução se perde quando o corpo chega como stream — que é o que acontece
  no caminho do `waitUntil`, depois da resposta já enviada. Sem o header a
  requisição sai *chunked* e o R2 responde **411 MissingContentLength**. Por isso
  `put()` codifica o corpo uma vez e manda o tamanho em bytes, nunca em
  caracteres.
- **`If-Match` só com validador forte.** O R2 comprime a resposta de GET de
  objeto compressível — o manifest é um — e nesse caso devolve o etag como
  `W/"…"`. O digest é o mesmo; só o prefixo sobra. Repassado cru, o R2 compara
  estrito e recusa com **412 em toda gravação**. `etagForte()` remove o `W/`
  antes de assinar.

`tests/r2.test.ts` cobre os dois.

### 6.2 Gravação interrompida

**Retomar não existe.** Uma gravação nova sempre começa em `chunk_000` de uma
sessão nova; emendar fala na mesma sessão pediria o microfone e o `Gravador` de
volta fora da tela de gravar, que não cobra nada de ninguém (visão §6).

**Fala não se perde por isso.** Os blocos que já subiram estão no R2, e a sessão
interrompida continua na lista de sessões levando a `/sessao/:id`, onde
`Processando` finaliza e transcreve o que existe. O que se perde é emendar fala
nova na mesma sessão — está no §14 como limite.

