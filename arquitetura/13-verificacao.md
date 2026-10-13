## 13. Verificação

O que cada teste guarda se lê no próprio arquivo, em `tests/`. Este capítulo é o
que os testes não alcançam, e como se verifica o resto.

- `pnpm test` — vitest, sem credencial e sem rede. Duas guardas varrem o código
  inteiro em vez de testar uma função: `tests/gateway.test.ts` (a porta única de
  modelo, §4.2 — import de pacote de provedor, endpoint escrito à mão, chave de
  provedor, dependências e `.env.example`) e `tests/agentes.test.ts` (todo
  `generateText`/`transcribe`/`embed` de `src/` pertence a um agente do
  registro, §4.13).
- `pnpm typecheck` — `tsc --noEmit`.

**O que nenhum teste alcança, e por quê:**

- **A qualidade** — da extração, da resolução, da ficha, do retrato, das
  relações do confronto e da resposta do chat. A avaliação é à mão, na tela,
  sessão real por sessão real (`CLAUDE.md`): não há gabarito rotulado nem
  percentual de recall, e regressão de prompt só aparece na revisão seguinte.
- **O Cypher em si.** `query` é mockado nos testes, e quem recusa Cypher
  inválido é o banco: uma consulta ilegal passa em todos os testes e só aparece
  contra o Aura. O Cypher do backup que tira o `embedding` mora numa constante, e
  só o banco responde por ele. Validar com `EXPLAIN` (abaixo).
- **O `fatiador`.** Ele é `AudioContext` e `decodeAudioData` puros, e simulá-los
  testaria o simulador. O que se testa sem navegador é `fecharJsonTruncado` e
  `chavesDaSessao`; o que o fatiador faz se verifica na importação real, pelo
  log: `[janela] sessão <id> janela 0 (blocos 0-3)`.
- **A cascata do CSS e as animações** — quem mede é o navegador (§14).

**Como verificar à mão:**

- **Bater numa rota do dev server pela porta da frente.** O middleware barra tudo
  sem cookie, e fora de produção `POST /api/auth/link` devolve o magic link **no
  corpo da resposta** (`route.ts`, a função `entregar`). Então: pede o link com o
  `ALLOWED_EMAIL`, segue o link para receber o cookie, e usa o cookie nas
  chamadas seguintes. É o que permite verificar rota de verdade sem forjar token
  e sem `pnpm build` — que aliás não pode rodar com o dev server de pé, porque os
  dois compartilham o `.next`.
- **Validar Cypher sem escrever nada:** prefixar a consulta com `EXPLAIN` faz o
  Aura planejar sem executar, o que pega erro de sintaxe e de schema contra o
  banco real, antes de existir dado para exercitá-lo.
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
