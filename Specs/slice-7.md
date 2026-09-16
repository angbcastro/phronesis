# Slice 7 — O laço de retroalimentação deixa de ser da extração

**Objetivo:** que a correção que eu faço em **qualquer** agente vire ajuste no
prompt **daquele** agente, sem deploy, pelo mesmo caminho que a extração já usa
desde a 4.6 — e que o ajuste seja uma **emenda**, não uma reescrita.

**Pronto quando:** eu abro `/calibracao`, vejo as correções agrupadas por agente,
escolho um, peço os padrões, confirmo um deles, peço a redação, leio o que mudou
seção por seção, aprovo — e o próximo átomo daquele agente sai carimbado
`<agente>-N+p<hash>`, com o prompt novo em vigor e sem nenhum deploy no meio.

## Por que agora

O sistema tem um laço fechado só. A 4.6 construiu o mecanismo inteiro — captura,
acúmulo, generalização, entrega, snapshot imutável, hash no carimbo — e o cabeou
a um agente: `paraCalibrar` filtra `agente === "extracao"`, `regras_correntes` é
um ponteiro só, e `regras()` tem um consumidor só. Os outros **dez** agentes com
prompt mudam por duas vias, e nenhuma é aprendizado: eu reescrevo o prompt à mão
no painel, ou um commit sobe (`chat-1`→`chat-2`, `PISO_BUSCA` 0,30→0,45).

E o material já está lá: `resolucao` e `grafo` acumulam correções etiquetadas
**sem consumidor** desde a 4.6, o que `ARCHITECTURE.md` §14 declara há três
fatias.

## As decisões

Perguntadas na entrevista de 14/09, antes de qualquer linha de código.

### A regra deixa de ser apêndice permanente e vira a pauta de uma emenda

A pergunta foi se o canal de aprendizado continuava sendo regra imperativa, e a
resposta foi mais forte: **as correções devem alimentar um sistema que avalia o
prompt inteiro do agente e decide a melhor forma de ele passar a considerar o que
eu quero.** Não um apêndice colado antes do `FORMATO` — o corpo do prompt.

O canal de entrega disso **já existe e não precisa ser inventado**:
`gravarOverride` (slice 4.7) grava prompt inteiro em
`config/prompt-<agente>-<hash>.json`, imutável, carimbado `+p<hash>`, com
`envelopeFaltando` recusando um prompt que pare de pedir o JSON que o parser lê.
O que falta é **quem escreve a proposta**.

Consequência aceita: `regras.ts` sai do caminho de montagem. As fontes do prompt
caem de três para duas (a base do git e o prompt aprovado), o que derruba o custo
que §14 declara desde a 4.6 — "ler o prompt efetivo exige os três lugares".
`versaoDeRegras` e `hashDeTexto` **ficam**: um átomo de três meses atrás carimbado
`extracao-9+a3f91c7d` tem de continuar resolvendo para o texto que o produziu.

### Dois passos, e eu confirmo entre eles

O redator **não pode** sair reescrevendo. A exigência da entrevista foi
explícita: alterações incrementais, conforme padrões identificados previamente e
que eu confirmo antes — o fluxo das regras, preservado na forma.

```
correções em aberto do agente X
        │
        ▼  calibracao-2   (paramétrico por agente)
   ≤2 PADRÕES, citando os Correcao.id       ← eu confirmo, edito ou descarto
        │
        ▼  redacao-1
   EDIÇÕES POR SEÇÃO do prompt de X         ← eu aprovo lendo o que mudou
        │
        ▼  gravarOverride(X, { prompt })
   prompt novo em vigor, carimbo +p<hash>, correções fechadas
```

São **dois agentes e não um**, com `prompt_version` própria cada um, pela mesma
razão que separou `resolucao-5` de `desempate-1`: calibram separado, e um erro de
redação se conserta sem tocar em quem enxerga padrão.

### A conservação é estrutural, não um pedido no prompt

O redator devolve **`edicoes`, nunca o texto inteiro**. Ele não consegue tocar o
que não nomeou, porque o que ele não nomeia nunca sai do servidor. Amarra que
vive só no texto do prompt é amarra que o modelo ignora num dia ruim — e o que
esta protege é a coisa que produz todo o resto.

Seis amarras, todas no parser de `redacao.ts`:

| Amarra | Por quê |
|---|---|
| no máximo **2 seções** por rodada | mais que isso não é emenda, é reescrita |
| só `reescrever`, `acrescentar`, `criar` — **não existe `apagar`** | apagar seção é decisão minha, no editor de `/agentes` |
| toda edição aponta um padrão confirmado, e todo padrão cita ≥2 `Correcao.id` | herdada da 4.6: um caso não é padrão, é um caso |
| seção nomeada tem de existir no prompt corrente (salvo `criar`) | seção inventada iria ao prompt apontando para nada |
| seção não citada volta **byte a byte** | por construção — ela nunca sai do servidor |
| `envelopeFaltando` sobre o texto resultante → 400 | já existe desde a 4.7, e continua sendo a última porta |

**Nove dos dez prompts já têm cabeçalho de seção.** `duplicatas` não tem: ganha
cabeçalhos no git e vira `duplicatas-2`. Sem cabeçalho não há seção, e sem seção
a única operação possível seria "reescrever tudo" — exatamente o que esta fatia
existe para não permitir.

### O relógio da sugestão passa a ser por agente

Hoje `visitado_em` é um só e `sugerirCalibracao` conta **todas** as correções em
aberto, mas `rascunharRegras` só lê as de `extracao` e recusa com menos de duas.
Uma sessão que só produza correção de `resolucao` acende "tem o que olhar" e leva
a uma tela que não consegue rascunhar nada. Com o laço aberto para todos, isso
deixa de ser inconsistência e passa a ser erro: o relógio é por agente, e a
gaveta acende quando **algum** agente tem o que olhar.

## O escopo

### Entra

1. **`Correcao.agente` passa a ser `AgenteId | "grafo"`.** `AGENTES_CORRECAO`
   sai. `"extracao"` e `"resolucao"` já são `AgenteId`, então o que está gravado
   no R2 hoje migra sozinho — nenhuma conversão, nenhuma perda.
2. **`Regra` vira `Padrao`**, com `agente`, `confirmado_em` e `aplicado_em`.
   Mesma forma (`id` atribuído no rascunho e imutável — é ele que torna
   "sobreviveu à minha edição" bem definido; `texto` editável; `cita` do agente e
   imutável), destino diferente. Vive no índice para sobreviver a eu fechar a aba
   entre os dois passos. `regras_correntes` sai do índice: o ponteiro do prompt
   em vigor já mora em `config/agentes.json`.
3. **`calibracao-2`**, paramétrico por agente.
4. **`redacao-1`**, agente novo, com caixa no painel e `REDACAO_MODEL`.
5. **`aplicarEdicoes`**, pura, e as seis amarras.
6. **`/calibracao` por agente**, com o passo da redação mostrando o que mudou
   seção por seção.
7. **`duplicatas-2`**, com cabeçalhos.

### A dobra que não pode ser esquecida

Tirar `regras()` do caminho de montagem **muda o prompt da extração em silêncio**
se houver regra em vigor no R2 hoje. Então a primeira rodada de `extracao` recebe
cada regra em vigor como **padrão já confirmado**, para ela ser incorporada ao
corpo do prompt em vez de sumir no primeiro deploy. É o único ponto desta fatia
em que algo muda sem eu aprovar.

### Não entra

- **Nenhuma captura nova.** Os pontos onde o gesto já existe mas nada é gravado
  (`perfil`, `enriquecimento`, `duplicatas`, `desempate`) são a 7.1; os gestos
  que nem existem (`confronto` por relação, `chat`, renomear conversa) são a 7.2.
  Esta fatia abre o **consumo**; sem ela, capturar não teria para onde ir.
- **Nenhuma métrica de qualidade.** O sinal de convergência — há quantas sessões
  eu não corrijo nada de um agente — é contagem dos meus gestos, não nota de
  modelo, e mesmo assim fica para a 7.2.
- **Modelo e limiar continuam sendo meus**, no painel. O redator escreve texto de
  prompt e mais nada.

## Limites que esta fatia cria

- **Uma emenda aprovada depressa pode piorar um prompt calibrado em nove
  versões, e nenhum teste automático vê.** É a mesma consequência que a 4.6 já
  declarou para a regra, agora sobre o corpo do prompt. As defesas são as seis
  amarras, o `anterior` do snapshot (um passo de desfazer no painel) e o meu olho
  na revisão seguinte. Nenhuma delas é medida.
- **O prompt efetivo deixa de ser legível só pelo git**, e isso não é novo — a
  4.7 já abriu essa porta. O que muda é a frequência com que ela é usada.
