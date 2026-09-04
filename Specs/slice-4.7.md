# Slice 4.7 — O painel dos agentes

> **Spec escrita depois da fatia, em 04/09.** A 4.7 foi construída sem uma, e o
> `ARCHITECTURE.md` §4.13 era o único lugar onde os critérios dela existiam.
> `CLAUDE.md` manda ler a spec da fatia atual no começo de qualquer tarefa, e
> para a última fatia construída não havia o que ler. O que está aqui é o que
> foi construído — nada de escopo novo, e o que ficou de fora está em "Fora de
> escopo" como decisão registrada, não como plano.

**Objetivo:** os sete pontos deste sistema que falam com o Gateway passam a ter
rosto. `/agentes` desenha o fluxo inteiro — quem chama quem, que dado corre
entre eles, e onde está o único nó humano — e clicar numa caixa abre o prompt e
o modelo daquele agente, editáveis, valendo na execução seguinte e **sem
deploy**.

**Pronto quando:** eu abro `/agentes`, vejo os sete e as três realimentações que
fecham o sistema; abro a caixa da extração, mudo uma frase do prompt, salvo; a
**próxima** sessão que eu gravar sai extraída com esse texto e carimbada
`extracao-5+p<hash>`; e clicar em "voltar ao original" devolve o carimbo
`extracao-5` sem sufixo. Sem tocar em `extracao.ts`, sem deploy.

## Por que agora — e o que isto não é

**Não é medida de nada.** Nem latência, nem custo, nem contagem de chamada por
agente. `CLAUDE.md` proíbe métrica automática de qualidade, e custo e latência
já têm lugar: o painel do próprio Gateway. Este painel mostra **configuração**,
não desempenho.

**É que hoje saber o que cada agente faz custa abrir cinco arquivos de
`src/lib/`, e mudar qualquer coisa custa um deploy.** A 4.6 já provou o
mecanismo com as regras aprovadas: texto no R2, snapshot imutável por hash,
sufixo no `prompt_version`, valendo na chamada seguinte. Esta fatia é aquele
mecanismo **generalizado para os sete** — `overrides.ts` é `regras.ts` aberto,
e nada de novo foi inventado.

**E é que o sistema cresceu sem que ninguém pudesse vê-lo inteiro.** Sete
agentes entraram em cinco fatias, cada um com sua razão, e a única
representação do conjunto era uma tabela de sete linhas. Tabela descreve;
desenho explica: que a resolução roda **dentro** da extração, que a regra que eu
aprovo volta ao prompt do extrator, e que existe exatamente **um** nó humano no
meio de tudo — o que a regra 5 protege.

## Os sete

| Agente | Módulo | Quando | Variável | Envelope que o parser exige |
|---|---|---|---|---|
| STT (sem prompt) | `stt.ts` | automático, por bloco | `STT_MODEL` | — |
| `extracao-5` | `extracao.ts` | automático, no fim da transcrição | `EXTRACAO_MODEL` | `atomos`, `entidades` |
| `resolucao-2` | `resolucao.ts` | condicional: só com menção ambígua | `RESOLUCAO_MODEL` | `referencias`, `perfil` |
| `calibracao-1` | `calibracao.ts` | sob demanda, em `/calibracao` | `CALIBRACAO_MODEL` | `regras`, `cita` |
| `perfil-1` | `perfil.ts` | sob demanda, em `/entidades` | `PERFIL_MODEL` | `texto` |
| `duplicatas-1` | `duplicatas.ts` | sob demanda, em `/entidades` | `DUPLICATAS_MODEL` | `mesma`, `explicacao` |
| embedding (sem prompt) | `embedding.ts` | automático, depois de gravar | `EMBEDDING_MODEL` | — |

**Um oitavo agente nasce escrevendo código**, não pela tela. O painel edita os
que existem; criar não é gesto de tela.

## 1. Onde a configuração vive (R2)

```
config/agentes.json                  { overrides: { <agente>: { prompt_hash, modelo, atualizado_em } }, atualizado_em }
config/prompt-<agente>-<hash>.json   { agente, hash, texto, anterior, criada_em } — imutável para sempre
```

Fora de `sessoes/` e fora de `calibracao/`: não é de sessão nenhuma e não é
material de calibração; é configuração. Um objeto só para os sete, e não um por
agente, porque a tela e cada chamada de agente querem o mesmo retrato — sete
GETs para responder "o que está em vigor" seria pagar sete vezes pela mesma
pergunta.

O nome do snapshot carrega o **agente e o hash**: o mesmo texto em dois agentes
daria o mesmo hash, e `config/prompt-a3f91c7d.json` não diria de quem é.

**Sem cache, como em `regras.ts`.** Cache por instância serverless faria
"salvei, vale na próxima" ser falso de um jeito que ninguém vê. O custo está
declarado: **uma leitura do índice por chamada de agente** — uma por sessão na
extração, uma na resolução, e trinta numa sessão gravada de 15 min no STT, uma
por bloco.

**Nunca propaga erro na leitura.** R2 fora do ar não impede sessão nenhuma de
ser transcrita ou extraída: sem override, o agente sai byte a byte igual ao de
antes desta fatia. A falha degrada para o comportamento bom, não para nenhum.

## 2. A procedência de um prompt editado

| Carimbo | Quem produziu | Resolve em |
|---|---|---|
| `extracao-5` | a base do git, sem regra aprovada | o próprio git |
| `extracao-5+a3f91c7d` | a base do git, com regra aprovada | `calibracao/regras-<hash>.json` |
| `extracao-5+p1b2c3d4` | prompt editado no painel | `config/prompt-extracao-<hash>.json` |
| `extracao-5+p1b2c3d4+a3f91c7d` | prompt editado **e** regra aprovada | os dois objetos, nesta ordem |

O prefixo `p` existe porque um hash sozinho não teria como resolver dois objetos
diferentes. O hash sai do **conteúdo**: salvar o mesmo texto duas vezes não cria
versão nova, e desfazer uma edição devolvendo o texto original devolve o carimbo
original.

**O hash volta `null` quando o texto não foi usado.** Ponteiro que não resolve
objeto — índice apontando para um prompt que sumiu do R2 — cai na base **e**
carimba a base, com uma linha `[overrides]` no log. Carimbar uma versão que não
rodou é procedência falsa, que é pior que procedência nenhuma.

## 3. Onde a regra aprovada entra num prompt editado

O bloco `AJUSTES QUE EU PEDI` continua entrando **antes do cabeçalho
`FORMATO`**: depois de tudo o que instrui, antes do que descreve o envelope de
saída. Enquanto o prompt eram duas constantes, esse ponto era a emenda entre
elas; agora é um cabeçalho procurado no texto (`comRegras`), porque a base pode
ser um prompt que eu escrevi.

Se eu renomear o cabeçalho ao editar, as regras vão para o fim, antes da
transcrição — pior lugar, e ainda assim o comportamento certo: **regra aprovada
não pode sumir porque um cabeçalho mudou de nome.**

## 4. As duas travas, e as duas são no servidor

**O envelope.** Eu posso reescrever o prompt inteiro, inclusive o `FORMATO` —
mas não posso salvar um que deixe de pedir o JSON que o parser sabe ler.
`POST /api/agentes/:id` recusa com 400 dizendo qual chave falta. Sem isso o erro
só apareceria na próxima sessão, na hora de extrair, e derrubaria todas as
seguintes. É substring e não JSON de verdade, de propósito: o que se checa é se
o prompt continua **pedindo** o formato, e isso é pergunta sobre o texto.

**O modelo.** Id continua passando por `validarIdDeModelo` — string
`provedor/modelo`, pelo Gateway, nunca objeto de provedor (regra 8).

Duas menores, e as duas evitam que o painel minta:

- **salvar o texto igual ao da base revoga o override**, em vez de guardar uma
  "edição" byte a byte idêntica ao git que faria o painel dizer "editado" e o
  átomo sair carimbado `+p`;
- **o prompt não é aparado.** A base termina em `Transcrição:\n`, e é esse `\n`
  que separa o prompt do que vem depois. Um `trim()` colaria a transcrição no
  cabeçalho, em silêncio e só na próxima sessão.

**O embedding não tem campo de modelo.** Os dois índices vetoriais declaram 1536
dimensões na migration 006; trocar por um modelo de outra dimensão pede `DROP` e
migration nova, que é decisão aprovada e não toque de tela. A caixa mostra o
modelo e o motivo, em vez de um campo que aceitaria e quebraria.

## 5. O desenho, e por que ele em vez de uma lista

O fluxo é **dado** (`NOS` e `ARESTAS`, em `agentes.ts`), não marcação no
componente: sistema que muda tem de quebrar um teste, não só ficar feio numa
tela.

A grade é **vertical**, quatro colunas, e rola na horizontal quando não couber.
Este app vive no celular: um canvas que se arrasta e se dá zoom é confortável no
monitor e inútil no telefone. **Nenhuma dependência entra** — as caixas são uma
grade CSS posicionada pelo `linha`/`coluna` do registro, e as setas são um
`<svg>` por cima, medido do DOM com `ResizeObserver`. Mesma escolha do
`SeletorEntidade`.

**Quatro colunas, e não três, por causa de um invariante do roteador.** Uma
aresta de ida é um cotovelo — desce, atravessa na altura do meio entre as duas
linhas, desce —, então aresta que pula uma linha atravessa a caixa que está
entre elas. O `grafo` tem três filhos (`duplicatas`, `perfil`, `embedding`) e
eles têm de caber na mesma linha; a quarta coluna é por onde a calibração desce
sem disputar espaço com eles.

A realimentação tem traço próprio — curva pontilhada terracota, saindo pela
lateral e subindo **por fora** da grade. São as três voltas que fecham o sistema
(a regra que volta ao extrator, o perfil e o vetor que voltam ao resolvedor)
mais a proposta de fusão, e elas são justamente o que uma lista de sete linhas
não conta.

O nó da revisão é terracota e é o único que não é agente nem dado: é o ponto que
a regra 5 protege.

## Rotas

| Rota | Faz |
|---|---|
| `GET /api/agentes` | os sete com o que está em vigor, mais o desenho do fluxo. **De graça**: nenhuma chamada de modelo, nenhuma ida ao grafo. A base do git viaja junto, para a tela dizer "editado" sem segunda ida à rede |
| `POST /api/agentes/:id` | `{prompt?, modelo?}` — o que passa a valer. O **único** lugar que escreve configuração de agente. `null` revoga o campo e volta à base; campo ausente não mexe naquele campo |

Migration nenhuma, node novo nenhum: esta fatia não toca o grafo.

## Ambiente

Nenhuma variável nova. O que muda é a precedência: **o modelo escolhido no
painel vence a variável de ambiente, que vence o padrão**. A validação é a mesma
nos três caminhos. `EMBEDDING_MODEL` é a exceção e continua sendo só variável —
a dimensão está declarada na migration 006.

## Idempotência

| Trava | Onde | Efeito |
|---|---|---|
| `prompt-<agente>-<hash>.json` imutável, com `If-None-Match` | `overrides.gravarVersaoDePrompt` | salvar o mesmo texto duas vezes não cria versão nova: o hash sai do conteúdo |
| `If-Match` no índice | `overrides.gravarOverride` | duas escritas concorrentes não se apagam |
| texto igual ao da base revoga | `POST /api/agentes/:id` | não existe override que seja o original |
| hash que não resolve texto cai na base **e** carimba a base | `overrides.resolver` | procedência nunca aponta para o que não rodou |

## Critérios de aceite

1. `/agentes` mostra os sete, com o que está em vigor, sem nenhuma chamada de
   modelo e sem ida ao grafo.
2. **Sem override nenhum, todo agente sai byte a byte igual ao de antes desta
   fatia** — a fatia é um no-op até o primeiro toque, e portanto incapaz de
   piorar nada enquanto eu não mandar.
3. Editar o prompt da extração e salvar faz a **próxima** sessão sair com esse
   texto e carimbada `extracao-5+p<hash>`, sem deploy.
4. "Voltar ao original" devolve o carimbo sem sufixo, e salvar um texto igual ao
   da base tem o mesmo efeito.
5. Prompt que deixa de pedir uma chave do envelope é recusado com 400 dizendo
   qual chave falta — pelo servidor, não pela tela.
6. Id de modelo fora do formato `provedor/modelo` é recusado, no painel como em
   qualquer outro caminho (regra 8).
7. Com prompt editado **e** regra aprovada, o carimbo carrega os dois sufixos,
   nesta ordem, e cada um resolve seu objeto.
8. R2 fora do ar não impede transcrição nem extração: sem configuração, a base.
9. `tests/agentes.test.ts` falha quando um arquivo de `src/` chama
   `generateText`, `transcribe`, `embed` ou `embedMany` sem pertencer a um
   agente do registro.
10. O desenho é íntegro: toda aresta liga nós que existem, todo agente tem
    caixa, nenhum nó fica solto, o nó humano continua sendo um só, aresta de ida
    liga linhas vizinhas e realimentação sempre sobe.
11. `pnpm test` passa sem edição nos testes que já existem.

## Fora de escopo

- **Histórico de edição.** `config/agentes.json` tem o que vale agora, e os
  snapshots por hash guardam os textos — não a ordem em que eu os escrevi. O
  `anterior` do snapshot dá para andar para trás lendo; nada na tela faz isso.
- **Medição por agente.** Latência, custo e contagem de chamada não entram: o
  Gateway já os tem, e `CLAUDE.md` proíbe métrica automática de qualidade.
- **Criar agente pela tela.** Os sete são os que o código tem.
- **Editar o modelo do embedding.** A dimensão está na migration 006.

## Limites conhecidos que esta fatia cria

- **O prompt de cinco agentes passa a ter mais de uma fonte.** `git revert`
  sozinho não reverte mais o prompt inteiro, e ler o prompt efetivo exige o git
  e o R2. O `prompt_version` e os snapshots imutáveis impedem a procedência de
  mentir; quem olhar só o repositório vai ver a metade do texto.
- **Trocar `STT_MODEL` pelo painel pode calar o vocabulário sem avisar.** O
  canal de nomes próprios existe só em alguns provedores. A tela avisa
  (`provedorAceitaVocabulario`), e não impede: qual modelo transcreve melhor é
  medição minha, não regra de código.
- **Uma leitura do índice por chamada de agente**, trinta numa sessão gravada de
  15 min. É o preço de a promessa ser verdadeira em vez de quase.
