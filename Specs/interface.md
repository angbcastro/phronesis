# Interface — a avaliação, e as quatro ondas

**Objetivo:** que a interface sirva ao que o sistema promete — gravar sem
atrito, revisar em menos de um minuto, perguntar e achar a origem — num
celular de 390 px, com o dedo, sem que erro pareça dica nem que controle
precise de pontaria.

Isto não é uma fatia vertical: é uma avaliação da interface inteira, feita a
pedido, e o plano de quatro ondas que saiu dela. A primeira não pede decisão
nenhuma e está feita (ver "Como ficou"); as outras três dependiam de cinco
decisões, tomadas e registradas abaixo.

**Ponto de retorno:** a tag `ui-antes-da-avaliacao`.

## Por que agora

As telas cresceram fatia a fatia, cada uma com decisões boas e escritas — e a
soma delas nunca tinha sido olhada de uma vez. Olhada, aparecem seis problemas
que nenhuma fatia sozinha criou e nenhuma sozinha resolve.

## O que está forte, e fica

A tela de gravar: um nó só do DOM nos dois estados, transição simétrica com
View Transition e fallback, `prefers-reduced-motion` tratado com cuidado, nada
crônico na home. O bloco de controles do tema. Nenhum `style={{}}` em
componente. O ARIA de combobox do `SeletorEntidade`. O apagar de dois toques, a
fusão em três passos, a `Gestao` devolvendo o foco. E o porquê escrito ao lado
de cada decisão — que é o que torna esta avaliação possível.

## Os seis problemas estruturais

1. **Erro não parece erro.** Falha, carregando e dica saem no mesmo cinza
   (`.aviso`, `.aguardando`), sem `aria-live`. Na ficha de entidades, dez
   ações mandam a falha para um aviso no topo da página, que fica atrás do véu.
2. **O app é de celular, os controles não.** Quase todo controle secundário tem
   15–27 px de altura, há texto de 9,6 px e quinze tamanhos de fonte entre 9,6 e
   15,2 px. Campo abaixo de 16 px faz o iOS dar zoom ao focar.
3. **Contraste no que mais importa.** Branco sobre o terracota dá 3,9:1 — o
   `confirmar`, o `salvar` e o círculo ficam abaixo de 4,5. Terracota como texto
   sobre `--fundo-alto` dá 4,44. A borda `--linha` dá 1,2–1,4:1, e é a única
   borda visível das pílulas.
4. **Componentes proliferaram.** `.reextrair` serve a 55 botões de sentidos
   diferentes; há ~9 estilos de botão secundário que são um só, 28 tamanhos de
   fonte, 31 espaçamentos, 10 raios, 4 larguras de página, 5 estilos de voltar,
   5 de fechar, 3 formatos de data, 4 jeitos de crescer uma textarea e 3
   gavetas duplicadas.
5. **A gestão não tem navegação.** A gaveta só existe em `/`: ir de `/agentes`
   para `/confronto` é marca, engrenagem, item. O `<title>` é o mesmo em toda
   rota.
6. **Explicação que só existe em `title`.** Apagar, reprocessar, "inferida",
   "~", "sem áudio", canônica, o lote do enriquecer — tooltip não existe no
   toque.

## As decisões — tomadas

Perguntadas depois da onda 1, com a recomendação e o custo de cada uma. As
respostas:

1. **Cor de erro: o `--rec`.** Ele já fazia o papel no hover de apagar e no
   "contradiz" do radial. Vale para erro e para ação destrutiva **armada** — em
   repouso, apagar continua neutro. O acento volta a querer dizer "ação". A
   alternativa recusada era manter o acento e diferenciar o erro por ícone e
   posição.
2. **Contraste: só os botões cheios escurecem.** O círculo de gravar fica como
   está — é a identidade —, e todo botão cheio com texto branco passa a acento
   88 % + preto, ~4,9:1. Recusados: escurecer o acento inteiro, e aceitar
   3,9:1.
3. **Navegação da gestão: a mesma engrenagem**, nas telas de gestão, no canto
   superior **direito** — o esquerdo segue só da marca. Recusadas: uma fileira
   de abas, e só ligações cruzadas.
4. **Fechamento do confirmar: sim.** Uma linha efêmera na home, "guardado · 8
   itens", por 3 s — fechamento, não cobrança.
5. **Editar tocando no próprio texto: fica.** E com uma exigência que eu
   acrescentei: o toque já põe o cursor **exatamente onde eu toquei**, e não no
   início do texto. O lápis discreto foi recusado.

## As ondas

### Onda 1 — consertos sem decisão

Feita. Ver "Como ficou".

### Onda 2 — o sistema de design

Feita, com as decisões 1 e 2 — ver "Como ficou". Era assim o plano, no topo do
`globals.css`:

| Eixo | Proposta |
|---|---|
| Tipografia | 6 tokens: 12 · 13 · 14 · 16 · 18 · 24 px; piso de 12 px; campo sempre 16 px |
| Espaçamento | grade de 4 px: 4 · 8 · 12 · 16 · 24 · 32 · 48 |
| Raio | controle 8 px · cartão e painel 14 px · pílula 999 px (+ 50 % no círculo) |
| Botões | um `.botao` com `.primario`, `.secundario`, `.discreto`, `.perigo` e `.icone`; alvo mínimo de 40 px, com a área de toque maior que o desenho onde o visual tiver de ser pequeno |
| Contraste | `--acento-texto` (acento 85 % + branco, ~5,5:1) para texto em acento; `--linha-controle` perto de `#68686d` (~3:1) só nas bordas de controle |
| Toque | hover só sob `@media (hover: hover)` — no toque ele gruda |
| Larguras | duas: leitura (40 rem) e lista (34 rem) |
| Gavetas | `.gaveta-lateral`, a dívida que `ARCHITECTURE.md` §11 já anota |
| Estados | um `.aviso` com `.erro` e `.ok`, à esquerda, com `role="status"` ou `role="alert"` |

E o texto: um `plural()` no lugar de "item(ns)"; um formato de data só; uma
passada de caixa (o ritual mistura "Não consegui…" com tudo minúsculo), de
jargão em tela do ritual ("R2", "nó", "Neo4j", `prompt_version`), de voz (o
"eu" é ora o sistema, ora eu; "Clique" num lugar, "Toque" no outro) e de
número ("0.87" com ponto).

### Onda 3 — o ritual

As decisões 4 e 5 estão feitas (ver "Como ficou"). O resto foi entrevistado em
quatro rodadas, e a spec dele é `Specs/interface-onda-3.md` — que mudou parte
do que está abaixo: as entidades sobem para o topo da revisão, o desmarcado e a
barra do chat ficam como estão, e o ▶ toca 2 s antes do trecho.

- **Revisão:** o tipo do átomo com rótulo ("opinião", e não `OPINIAO` a
  0,68 rem); o desmarcado com estado próprio, e não só opacidade; a faixa
  esquerda do cartão como alvo do checkbox; o ▶ com carregando, tocando, parar,
  falha à vista e parada no `fim_s` do trecho; o pronome que trava marcado no
  próprio átomo, com o rodapé levando até ele; uma linha só para todo motivo de
  trava do confirmar; "guardando…" no lugar de "gravando…"; o rodapé com área
  segura e mais baixo; nada reordenando debaixo do dedo enquanto a lista cresce.
- **Gravar:** um indicador discreto de sem rede e de microfone caído — a visão
  §5 permite exatamente isso, e hoje `fila.offline` é medido e nunca mostrado;
  o foco no "parar" quando a gravação começa.
- **Corredor:** centrado como a tela de gravar, sem jargão, com tentar de novo
  ali mesmo.
- **Chat:** a origem visível na resposta, com ▶ para o áudio (visão §5.4);
  markdown mínimo, ou o prompt proibindo; apagar conversa de dois toques na
  tela, e não `confirm()`; rolagem que respeita quem está relendo; a barra
  fechada visível no toque (hoje os `...` dão ~1,9:1).

### Onda 4 — a gestão

A decisão 3 está feita (ver "Como ficou"), e o `<title>` por rota foi junto.
Parte do resto muda contrato de rota.

- **Sessões com conteúdo:** quantos átomos e as entidades mais citadas, que
  pede mudar `GET /api/sessoes`; "hoje/ontem" e ano; "carregar mais" depois das
  50.
- **Ficha:** um modelo só de salvar, aviso de não salvo, e o `desfazer` que
  não apaga o rascunho das outras entidades; fundir pelo par de duplicatas com
  o mesmo aviso da fusão à mão; o tipo na linha da lista.
- **Radial** legível a 390 px: teto de vizinhos por quadrante, ou a lista
  primeiro.
- **Editor de agente:** guarda de não salvo, diferença contra o git, "voltar ao
  original" de dois toques; a calibração com "descartar" emenda de dois toques.

## Como ficou

**Onda 1, em 14/10/2026** — três commits depois da tag `ui-antes-da-avaliacao`,
sem push (a slice 12 ainda estava na frente do remoto).

Os dezessete consertos, todos conferidos no código antes de mexer:

- o ponto "editado" de `/agentes` usava a classe `.marca`, `position: fixed`, e
  empilhava no canto da tela — virou `.ponto-editado`;
- `/agentes` sem o recuo da marca no topo;
- o editor de agente montava já aberto e desmontava ao fechar, e a transição
  nunca rodava; virou gaveta montada sempre, como a ficha, e o foco parou de
  pular para o × a cada recarga;
- calibração: a falha de um agente ficava em "…" para sempre; o refugo dizia
  "nada" enquanto carregava; "· null ·" na aprovação;
- quatro `.meta` do confronto sem regra nenhuma;
- `.aguardando` sem regra em `.revisao` e em `.sessoes`: a instrução da revisão
  saía com o peso dos átomos;
- o confirmar preso em "gravando…" com resposta não-JSON;
- o "parar" sem try/catch;
- a lista de conversas escondendo a própria falha atrás de "nenhuma conversa
  ainda.";
- o ✕ de menção surdo ao teclado;
- o Esc do renomear fechando a ficha junto;
- a importação navegando depois de desmontada — o que podia matar uma gravação
  começada durante o upload;
- sessões: "em revisao" sem acento, "50 sessão(ões)" parecendo total, e o
  "reextraindo…" que nunca saía;
- corredor e transcrição com título contradizendo o corpo, e o verbo do
  corredor andando para trás;
- a engrenagem por cima do chat aberto, contra o que o próprio comentário do
  CSS dizia.

E a base de acessibilidade: um anel de foco único por `:where()`, as duas
regras que o apagavam removidas, `.so-leitor`, nomes acessíveis no checkbox, no
parágrafo e no ▶ da revisão, no `↑` do chat e no ← da calibração, `role="alert"`
no erro de gravar, e o foco entrando e voltando no modal de fontes, no editor
de agente e — só pelo teclado — no chat.

O que não foi feito: olhar as telas rodando. Está no `PROXIMOS-TESTES.md`.

**Onda 2 e as decisões 1 a 5, em 14/10/2026** — depois da tag
`ui-antes-da-onda-2`, sem push. Em commits separados por tema:

- **A escala e as cores.** Seis tamanhos de letra no lugar de vinte e oito,
  com piso de 12 px; três cantos; duas larguras de página; uma curva. `--erro`
  é o `--rec` (decisão 1); `--acento-cheio` dá ~4,9:1 aos botões cheios, e o
  círculo de gravar fica no acento puro (decisão 2); `--acento-texto` e
  `--linha-controle` levam o acento-como-letra e a borda dos controles ao
  mínimo de contraste. No toque, campo tem 16 px; o hover só existe onde há
  ponteiro. **O espaço não foi migrado de uma vez** — ver a nota no §11.2 do
  `ARCHITECTURE.md`: a grade vale para o que nasce e para o que for tocado.
- **Um botão, e não nove.** `.botao` com `.primario`, `.ligado`, `.perigo`,
  `.discreto`, `.icone` e `.tracejado`; o `.reextrair` saiu dos 55 lugares que
  vestia. Desenho de 32 px, alvo de 44.
- **O recado com tom.** `.aviso.erro` e `.aviso.ok`, com `role="alert"` no
  erro; a falha de ação da ficha aparece dentro dela. No caminho, dois bugs: o
  "em vigor" da calibração sumia no mesmo instante em que aparecia (o
  `abrirAgente` limpava o recado), e `/entrar` sem rede não dizia nada.
- **`.gaveta-lateral`.** As três gavetas viraram uma base com lado.
- **O texto.** Uma data só, dia/mês, no dia de Brasília. **A primeira versão
  usou mês por extenso**, e voltou para o número porque
  `tests/entidades-tela.test.ts` registrava "dia/mês/ano, que é como eu leio" —
  e o chat já mostrava `dd/mm`. As telas que cortavam a string mostravam o dia
  de Greenwich (o limite do §14 encolheu para os prompts). Plural por extenso,
  "guardando…" no confirmar e "salvando…" na gestão, sem "Neo4j" e "R2" no
  ritual.
- **Decisão 3:** a engrenagem em toda tela de gestão, no canto direito, com a
  gaveta entrando por ali e a tela atual marcada; e o `<title>` por rota.
- **Decisão 4:** "guardado · 8 itens" na home por 3 s depois do confirmar.
- **Decisão 5:** o toque no texto do átomo põe o cursor no caractere tocado.

Um tropeço de processo: o commit do texto (`b63349a`) entrou com
`tests/arquitetura.test.ts` falhando — os exemplos literais de data no §11
liam como crônica —, e o conserto veio no commit seguinte (`fc8c896`).

O que não foi feito: olhar nada disto rodando. Está no `PROXIMOS-TESTES.md`.
