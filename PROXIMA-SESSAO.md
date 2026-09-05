# Checkpoint — 2026-09-05

Documento de trabalho, não de arquitetura. **A slice 4.8 está construída,
commitada e verificada só por teste — a promessa dela ainda é previsão, não
medição.** Apagar quando as validações da seção 2 estiverem feitas.

Contexto permanente está em `CLAUDE.md` (regras), `ARCHITECTURE.md` (como o
sistema funciona hoje) e `Specs/slice-4.8.md` (o que a fatia atual tem que ser).
Este arquivo só diz o que fazer a seguir.

> **Substitui o checkpoint de 02/09**, que descrevia a slice 4.5 como planejada e
> não escrita. Desde então foram construídas a 4.5, a 4.6, a 4.7 e a 4.8. O que
> restou de lá e continua valendo está na seção 4 — **não conferido nesta
> sessão**, porque depende de olhar o banco e a fila de revisão.

---

## 1. O que esta sessão fez

**`b71e860` — a extração deixou de esperar eu parar de falar.** A cada 4 blocos
transcritos (2 min) uma janela é extraída e resolvida durante a própria gravação,
e os átomos vão para `sessoes/<id>/parcial.json`. Quando eu paro, sobra a janela
do fim. `Specs/slice-4.8.md` tem o escopo; `ARCHITECTURE.md` §4.1 e §4.6, o
sistema. `src/lib/janela.ts` é novo e não fala com modelo nenhum.

**`08c042a` — o documento parou de dizer que a resolução roda sob demanda.** §5.3
e §14 listavam o `resolucao-2` como agente de clique, quando ele roda dentro da
extração desde a slice 4. Correção de texto; o conserto de código está na
seção 3.

Nada disto passou pelo Gateway. **Nenhuma janela real foi extraída ainda.**

---

## 2. As validações que faltam

Nesta ordem. As três primeiras são a fatia; a quarta e a quinta são o que ela
pode ter quebrado sem ninguém ver.

### 2.1 Gravar 3 minutos e ver a janela fechar antes de parar

Menos de 3 min não fecha janela nenhuma durante a fala — a janela é de 4 blocos,
e uma gravação curta cai no passe único, que é o caminho de antes da fatia. Então
uma sessão de teste de 40 s **não testa nada desta slice**.

```
scripts/dev.ps1
```

Gravar, e **antes de parar** procurar em `logs/dev-<data>.log`:

```
[janela] sessão <id> janela 0 (blocos 0-3): +N átomo(s), M estendido(s)
```

E conferir que `sessoes/<id>/parcial.json` já existe no bucket com átomos dentro,
com a janela 0 marcada `pronta`.

| O que aparece | O que quer dizer |
|---|---|
| a linha `[janela] … janela 0` | o caminho novo está vivo |
| nenhuma linha `[janela]` | o `avancarJanelas` não está sendo chamado, ou nenhum bloco fechou janela — conferir se os 4 primeiros blocos ficaram `transcrito: true` no manifest |
| `[janela] … falhou:` | o motivo está na própria linha; a janela fica `falhou` no parcial e é retentada no bloco seguinte |
| `[janela] … não fecharam` no fim | caiu no passe único. A sessão não morreu, mas a fatia não entregou nada — é o caso a investigar |

### 2.2 Cronometrar do botão até a revisão abrir

**É o número desta fatia, e ele não existe ainda.** Hoje a previsão é "de um a
dois minutos para segundos", e previsão não é medição. Cronometrar do toque em
parar até `/sessao/:id/revisar` abrir sozinha.

Se continuar em dezenas de segundos, o suspeito não é a extração: é a resolução
da janela do fim (embedding + duas consultas vetoriais + a chamada do agente 2),
que roda inteira ali.

### 2.3 Olhar a lista na revisão — o maior risco da fatia

Não há passada de costura no fim. O que segura o volume da lista é o `estende`,
que é **instrução de prompt**. Três coisas a olhar, e as três só olho vê:

- **o volume caiu na faixa?** Oito janelas pedindo de 1 a 3 dão de 8 a 24 no
  papel; é o `estende` que tem de puxar para baixo;
- **existe UM átomo `ROTINA`?** Dois é o sinal mais claro de que a instrução não
  pegou — a regra "no máximo uma por sessão" agora depende de a janela ver a
  ROTINA da janela anterior e estendê-la;
- **um assunto tocado no minuto 2 e retomado no 9 virou um átomo com dois
  trechos, ou dois átomos?** Um átomo com dois trechos é o `estende` funcionando.

**Se falhar, o conserto não é todo sem deploy.** A base do prompt é editável em
`/agentes`; o bloco da janela — que é onde mora a instrução do `estende` — é
montado em código, em `blocoDaJanela` (`src/lib/extracao.ts`). Está no §14 como
limite. Ajustar a instrução do `estende` hoje é deploy.

### 2.4 Importar um arquivo e conferir que nada mudou

Arquivo importado é um bloco só, então é uma janela que se declara a sessão
inteira, e o prompt sai byte a byte igual ao de antes desta fatia. É o caminho
mais fácil de quebrar sem perceber, porque nenhum log de janela aparece nele —
a única linha esperada é a do passe único.

### 2.5 O rate limit, que mexeu nos dois sentidos

São ~8 chamadas de extração a mais na conta por sessão, mas espalhadas pelos 15
minutos e **sem prazo para esperar** (durante a gravação, `comEsperaDeLimite` vai
sem `ate`). A rajada que existia — a chamada grande logo depois de 30 blocos de
STT — deixou de existir.

Nenhuma das duas coisas foi medida, e uma sessão de 15 min nunca foi processada
inteira sob limite, nem antes desta fatia. O que procurar no log:
`[limite] extracao <modelo>: rate limit do Gateway — esperando Ns`.

---

## 3. O conserto de uma linha que ficou pendente

**`resolucao.ts` não chama `comEsperaDeLimite`.** Ele roda no caminho automático,
dentro da extração de cada janela, num `waitUntil` — e um limite ativo o faz
falhar em vez de esperar. A degradação já é a certa (menção volta com
`certo: false`, a revisão destaca, eu escolho), então não é urgente; mas o
critério declarado no §5.3 é "quem roda em `waitUntil` espera", e ele está do
lado errado da linha.

Não foi feito no commit da correção do documento para não misturar texto com
código, nem no da fatia para não misturar duas mudanças no mesmo arquivo.

---

## 4. Do checkpoint anterior — não conferido nesta sessão

Estes itens são de 02/09 e dependem de olhar o banco e a fila. **Podem já estar
resolvidos**; nada nesta sessão os tocou, e nada nesta sessão os verificou.

- **O passo zero das entidades.** Em 02/09 as cinco entidades do grafo não tinham
  nenhum dos três campos de perfil, e `Raffael do Vale` estava semeado numa
  grafia que a camada de string não casa com "Rafa". Sem perfil escrito, a camada
  3a da resolução nasce inerte — e a 4.5 foi construída depois disso. Vale abrir
  `/entidades` e ver como está.
- **A fila de revisão.** Eram 7 sessões esperando em 02/09, e o checkpoint
  anterior chamava isso pelo nome certo: `Specs/visao.md` §8 diz que revisão
  acumulada é abandono. Se ainda houver fila, ela vale mais que qualquer fatia —
  e agora tem uso duplo, porque revisar uma delas mede o "menos de 60 s" que
  segue sem medição.
- **`config/vocabulario.txt` ainda tem 3 nomes** (conferido: 3 linhas úteis). Só
  ele ensina um nome **antes** de eu falá-lo pela primeira vez, que é justamente
  quando o STT mais erra.
- **Bancada de comparação de modelos**, pedida e adiada cinco vezes. Desenho
  discutido está no checkpoint anterior, no histórico do git.

---

## 5. Decisões da 4.8 — não relitigar

| Decisão | Por quê |
|---|---|
| Janela de 4 blocos (2 min), não de 1 | 30 s corta frase no meio e dobra a exposição ao rate limit; 2 min é fala suficiente para um átomo nascer inteiro |
| Tudo por janela: extração **e** resolução | deixar a resolução no fim custaria 10-15 s da espera que a fatia existe para cortar |
| Sem passada de costura no fim | custaria um oitavo agente, mais um prompt para calibrar à mão para sempre, e ~10 s acrescentados exatamente à espera que se está cortando |
| `INSTRUCOES_BASE` não muda um byte | cinco versões de calibração produziram o que está lá |
| `extracao-6` mesmo com o texto igual | a entrada mudou; precedente do `resolucao-2` na 4.5 |
| `resolucao-2` **não** sobe de versão | o prompt dele é o mesmo e o bloco de contexto some quando vazio; o que um `prompt_version` resolve é um texto |
| `estende` não mexe em `sobre` nem `menciona` | é o que mantém a resolução incremental sem reabrir átomo já atribuído |
| Sem operação de renome na janela | o painel de entidades da revisão já reaponta todos os átomos num gesto |
| A sessão inteira é uma janela, não um caminho paralelo | um prompt só para calibrar, para sempre |
| `JANELA_BLOCOS = 0` desliga tudo | botão de pânico sem deploy de emergência |
