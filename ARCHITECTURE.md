# Arquitetura

Como o Phronesis está construído hoje. Descreve o **sistema que existe**, não o
que está planejado — para o produto ver `Specs/visao.md`, para as regras
invioláveis `CLAUDE.md`, para o escopo da fatia atual `Specs/slice-10.md`.

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

**A slice 5.2 está construída, e não verificada.** A fatia
(`Specs/slice-5.2.md`) alarga o confronto (§4.15.3): cada átomo é julgado contra
os cem mais parecidos do grafo inteiro — mais antigos, mais novos e da mesma
sessão —, a direção da aresta é decidida pelo código, e toda relação ganha uma
**camada**, forte ou sutil, que o chat (`chat-7`) lê com ressalva. A tela
`/confronto` ganhou busca e um radial onde eu corrijo relação por relação; a
edição congela a relação, apagar vira recusa do par, e cada gesto vira correção
em `/calibracao`. Migration 013, sem statement. O modelo foi escolhido pela
comparação de 13/10 (`deepseek/deepseek-v4.1-flash`, agora padrão próprio), e o
painel de produção não tem override do `confronto` nem do `chat` (conferido no
mesmo dia). **O que falta:** buildar o commit da 013 e reprocessar tudo.

**A slice 10 está construída, e não verificada.** A fatia
(`Specs/slice-10.md`) dá ao "eu" um **retrato** no lugar da ficha de quatro
campos (§4.20): o Agora e uma seção por dimensão da minha vida, no R2, escritos
por dois agentes novos (`retrato-1`, `retrato-dimensoes-1`) em duas fases sobre
um prefixo comum; uma tela em `/entidades` para ler, aprovar as dimensões e
desfazer os dois lados; e `ler_retrato`, a quarta ferramenta do chat (`chat-6`),
que lê uma dimensão por vez. Sem migration. **O que falta, e é o ponto de
retorno da spec:** rodar o "eu" contra o banco de desenvolvimento e ler no log o
tempo das duas fases e o `cache=` de cada chamada paralela — se a rodada passar
de 240 s, ou a fase 2 não ler o cache, a decisão volta para mim. Não foi feito
nesta sessão porque não há `.env.development.local` neste checkout, e sem ele
`pnpm dev` escreveria em produção (§12.1). O "eu" de desenvolvimento também
precisa ser conferido como `canonico` antes da primeira batida.

**A slice 4.12.1 está no ar desde 29/09.** A primeira rodada de
verdade do enriquecimento em lote (23/09) falhou de dois jeitos: o "eu" estourou
o teto de saída, e a fila parou calada depois de quatro entidades. A fatia
(`Specs/slice-4.12.1.md`) tira o teto de saída do agente 4, faz a corrente dizer
o status HTTP quando quebra, faz `/entidades` retomar a fila parada, e dá à fila
uma batida semanal para as canônicas com novidade (§4.9). O ritmo semanal
reabre uma recusa da 4.12, por pedido meu. O Hobby aceitou a terceira entrada
de cron (§12). **Falta ver as dez entidades de 23/09 saírem da fila em
produção**, e a primeira batida de segunda rodar.

**A slice 9 está construída, e sobe em partes.** A fatia (`Specs/slice-9.md`) é
o miolo do chat — como a pergunta vira busca e como a busca vira resposta. Em
quatro commits, cada um ponto de retorno: o prompt responde antes de despejar e
autoriza busca paralela (`chat-3`); o chat tem padrão de modelo próprio
(`MODELO_CHAT_PADRAO`); a busca diz quanto cortou e de que vazio se trata, o (i)
mostra o recorte e a duração de cada passo, e catálogo e vetor são lidos uma vez
por pergunta (`chat-4`); e a terceira ferramenta, `buscar_entidades`, lê a ficha
da entidade (`chat-5`, §4.16.2). **Não aconteceram, por decisão minha:** a
medição de `CHAT_MODEL` antes de fixar o padrão, e o streaming do texto final —
a resposta mais curta encolhe a espera que ele consertaria. Nada disto foi
julgado numa pergunta real ainda; é o que falta.

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
novo e comparar com a proposta guardada, olhando o log. A lista do que falta
gravar e olhar vive na spec da fatia, em `Specs/` — o `PROXIMA-SESSAO.md` que a
carregava foi apagado, porque checkpoint fora da spec virava uma segunda fonte de
verdade que envelhecia sozinha.
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
│ React (11 telas)        │   │ 3 crons (2 diários) ┼──▶│ Neo4j Aura (HTTP)    │
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
(§4.17), engolindo a própria falha para não custar as outras duas. Além dele
entram sem mim a batida do confronto (diária, 05:00 UTC, §4.15) e, desde a
4.12.1, a do enriquecimento (segunda, 07:00 UTC, §4.9).

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
                  encadeamento e o desfazer de uma geração. O "eu" desvia daqui
                  para o retrato (slice 10)
  retrato.ts      o agente `retrato` (slice 10): o retrato do "eu" em duas
                  fases — a ficha curta do nó, depois o Agora e uma seção por
                  dimensão em paralelo, todas sobre o mesmo prefixo —, o bloco
                  numerado, a escrita no R2, o desfazer dos dois lados e as
                  fontes do (i)
  retrato-dimensoes.ts o agente `retrato-dimensoes` (slice 10): propõe as
                  dimensões, e o `config/retrato-eu.json` por etag. Não importa
                  `retrato.ts` — recebe o prefixo pronto
  confronto.ts    o agente `confronto` (slice 5, alargado na 5.2): os cem
                  candidatos por vetor no grafo inteiro, a ordem do par,
                  ATUALIZA/CONTRADIZ/CONFIRMA/COMPLEMENTA em camada forte ou
                  sutil, e GRAVA — mesmo padrão do enriquecimento, nunca no
                  caminho da resposta. Também o radial de `/confronto` e a
                  minha edição, que congela a relação ou deixa a recusa
  chat.ts         o agente `chat` (slice 6): as quatro ferramentas só-leitura (a
                  terceira, `buscar_entidades`, desde a slice 9; a quarta,
                  `ler_retrato`, desde a 10), o loop com
                  teto de 8 chamadas, e o rastro que o botão (i) abre.
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
  agentes.ts      o registro dos quinze e o desenho do fluxo. Fica ACIMA dos
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
                  RetratoDoEu (o painel do "eu" no lugar da ficha: o Agora, as
                    seções com o (i), e as dimensões — editar e aceitar a
                    proposta),
                  Confronto (estado da varredura de relações, rodar e desfazer),
                  Chat (a barra, o painel, a lista de conversas, o progresso por
                    passo e o (i) com o rastro — nasce dentro da `Gravacao`),
                  ServiceWorker (registra `sw.js`; não desenha nada)
src/app/api/      51 rotas em dez famílias — sessão, entidade, calibração,
                  agentes, átomos, confronto, chat/conversas, medidas, as 2 de
                  auth e a do cron (seção 10)
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
                  gancho-src.mjs; §4.15.3)
tests/            vitest sobre a lógica pura — nenhuma credencial, nenhuma rede
```

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
- **A fila de enriquecimento chama a si mesma com o meu cookie** (4.12): cada elo
  repassa o `cookie` da requisição que o originou, e o middleware o valida como
  qualquer outra. Nenhuma porta nova, nenhum token de serviço, nenhuma exceção no
  `matcher`. O custo é que cookie expirado no meio de uma fila longa para o
  encadeamento — declarado no §14; o que o retoma é `/entidades` aberta (§4.9).
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
