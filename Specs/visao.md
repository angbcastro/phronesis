# Visão — Fluxo de Consciência

> Documento de produto. O que o sistema é para mim, como ele se sente no uso, e o que ele nunca pode virar. Quando uma decisão técnica conflitar com o que está aqui, este documento é o critério de desempate.

---

## 1. O problema

Eu penso falando. Ao longo de um dia eu processo em voz alta muito mais do que jamais vou digitar: o que eu senti sobre algum fato, o que percebi sobre um cliente, o que decidi mudar, o que me incomodou e por quê. Nada disso persiste. Some no fim do dia.

O que já tentei falha por dois motivos opostos. Anotar por escrito custa caro demais na hora de registrar — quando o dia acabou, escrever mil palavras é a última coisa que vou fazer. Gravar áudio solto custa barato na hora e caro depois — vira uma pasta de 300 arquivos que ninguém nunca vai reouvir.

**A tese do sistema:** o custo de registrar tem que ser quase zero, e o valor tem que aparecer semanas depois, sem esforço meu. Falar é o input mais barato que existe. O trabalho todo é o que acontece entre eu parar de falar e a informação virar algo que eu consigo recuperar meses depois.

---

## 2. Os quatro trabalhos

Tudo que o sistema faz serve a um destes quatro. Se uma feature não serve, ela não entra.

**Descarregar.** Tirar da cabeça o que está ocupando espaço. Isso tem valor mesmo que eu nunca releia — é metade do motivo de um diário existir. Aqui o único requisito é fricção zero.

**Encontrar.** "O que eu já aprendi sobre conduzir kickoff." "Minhas metas quando eu tinha 21 anos" "Como eu estava em relação ao projeto X em julho." Perguntas que hoje eu não faço porque sei que não há onde procurar.

**Confrontar.** Ver que mudei de ideia — e quando, e depois de quê. É o único jeito de perceber que uma opinião minha era circunstancial e não convicção. É a coisa mais valiosa que o sistema pode me dar, e nenhuma ferramenta que eu uso hoje faz isso.

**Lembrar.** Trazer de volta o que eu esqueci que sabia: um aprendizado de março que se aplica ao problema de hoje, uma conquista que sumiu da memória, um detalhe sobre uma pessoa que muda como eu conduzo a próxima conversa.

---

## 3. O ritual

O sistema é desenhado em torno de um único momento recorrente: **fim de dia, sozinho, 10 a 20 minutos.** Tudo o mais é secundário.

Abro o app. Um botão. Aperto e começo a falar — sem escolher categoria, sem preencher campo, sem decidir onde aquilo vai. Falo desorganizado, volto atrás, me corrijo, mudo de assunto no meio. Isso é esperado e o sistema tem que lidar.

Paro. Em poucos segundos a transcrição está pronta e o sistema me devolve **duas a quatro perguntas**. Não perguntas genéricas de journaling — perguntas que só fazem sentido para quem escutou: *"você falou que está com medo da reunião x, mas ela foi parecida com a y. qual é o seu medo?"*, *"esse aprendizado sobre y discorda de algo que você falou sobre z. Oque te fez mudar de ideia?"*.

Se eu quiser, respondo e continuo. Se não quiser, ignoro — e ignorar não pode ter custo nenhum, nem visual nem funcional.

Fecho com a revisão: uma lista do que ele entendeu, marcável e editável. Confirmo. **Em menos de 60 segundos.** Se a revisão virar trabalho, o sistema morre em três semanas.

Dias depois, num contexto completamente diferente, eu abro e pergunto alguma coisa. É aí que o investimento se paga.

---

## 4. Necessidades

O que o sistema tem que garantir, em ordem de importância:

**Fricção zero na entrada.** Um toque para gravar. Nenhuma decisão antes de falar. Nenhuma interrupção durante. Toda escolha que eu poderia fazer antes de falar tem que ser adiada para depois de falar — ou eliminada.

**Procedência.** Todo item extraído aponta para o segundo exato do áudio em que eu disse aquilo. Sem isso, em seis meses eu não confio no que está lá, e um diário em que não se confia não vale nada.

**Reversibilidade.** Nada entra no grafo sem minha confirmação, nada é apagado de verdade, todo item é editável depois. Eu tenho que poder ser descuidado na hora de falar sabendo que dá para corrigir.

**Privacidade.** Isso é um diário. Vai ter coisa sobre pessoas com nome, sobre clientes, sobre mim. Single-user, sem compartilhamento, sem feature social, e uma decisão consciente sobre o que trafega por API de terceiros.

**Ausência de julgamento.** O sistema não me dá nota, não faz streak, não me cobra o dia que eu pulei, não comenta que eu ando negativo. Culpa é a forma mais eficiente de me fazer parar de usar.

---

## 5. Princípios de UX

1. **A fala nunca é interrompida.** Autosave, upload, transcrição, erro de rede — nada disso pode aparecer na frente de quem está falando. No máximo um indicador discreto.
2. **Uma decisão de cada vez, e sempre depois de falar.** Categorizar, vincular, confirmar: tudo na revisão, nunca antes.
3. **Ignorar é sempre uma saída válida.** Perguntas não respondidas, sessões não revisadas, entidades não organizadas — tudo pode ficar pendente sem quebrar nada e sem me cobrar.
4. **Mostrar a origem, sempre.** Cada item leva ao trecho de áudio. Cada resposta da busca mostra de qual sessão veio.
5. **O grafo é consequência, não interface.** A visualização é para explorar e encontrar buracos, não é o lugar onde eu trabalho. Se eu preciso mexer no grafo para o sistema funcionar, algo está errado no pipeline.

---

## 6. As três telas que importam

**Gravar.** Um botão, um timer, um jeito de parar. Idealmente nada mais na tela. É a tela em que eu passo mais tempo e a que precisa de menos coisa.

**Revisar.** A tela mais difícil de acertar. Precisa mostrar muita informação — o que foi extraído, de que tipo, ligado a quem, o que conflita com o passado — e ainda assim ser resolvível em menos de um minuto. Aprovar tudo é um toque; discordar de um item é dois. O caso comum é aprovar; o caso raro é que pode custar atenção.

**Perguntar.** Uma bolha na tela de gravar, que expande para o centro quando eu toco nela — e o círculo de gravação minimiza e vai para o topo. Dentro: minhas conversas, e a conversa aberta. Escrevo uma pergunta em texto livre, o sistema decide sozinho quais buscas fazer no grafo, mostra cada passo enquanto procura, e responde citando os trechos que usou — com um (i) que abre o rastro inteiro: cada busca feita e o que ela trouxe.

> **Isto mudou na entrevista de 13/09, e o que estava escrito aqui antes era o contrário:** "uma barra de texto, sem chat longo, sem histórico de conversa: pergunta, resposta, origem". A referência que eu dei foi explícita — ChatGPT/Claude —, e por três razões concretas: uma pergunta como "como eu estava depois que terminei com a Isinha" não se responde numa busca só, então **o sistema precisa poder encadear**; a pergunta seguinte quase sempre depende da resposta anterior, então **a conversa precisa de memória**; e eu volto a um assunto dias depois, então **ela precisa persistir entre visitas**. Uma barra sem memória obrigaria a reescrever o contexto toda vez, que é exatamente a fricção que o §8 lista como forma de morte.

O que **não** mudou: a resposta continua mostrando a origem (princípio 4 do §5), e o tom continua sendo o do §7 — bibliotecário, não coach. E a conversa **só enxerga o grafo**: nenhuma conversa é fonte de busca de outra.

---

## 7. Tom do sistema

Nas perguntas, nos resumos e nas respostas de busca, o sistema é **um bibliotecário atento, não um coach**.

Não elogia ("que reflexão profunda!"). Não interpreta minha psicologia. Não sugere o que eu deveria sentir ou fazer. Não usa linguagem de terapia. Não puxa conversa.

O que ele faz: devolve o que eu disse com precisão, aponta contradições sem opinar sobre elas, e pergunta o que falta. Quando não entendeu, diz que não entendeu em vez de inventar. Fala como eu falo — direto, em português brasileiro, sem formalidade.

---

## 8. Como o sistema morre

Registrado aqui porque cada um destes é uma decisão de produto, não um bug:

- **Fricção acumulada.** Cada toque a mais na entrada corta o uso. Duas semanas de atrito e eu paro.
- **Perguntas burras.** Uma pergunta genérica de journaling app, ou uma cuja resposta ele já tem, e eu deixo de responder para sempre.
- **Grafo apodrecido.** Sem deduplicação, seis meses viram um lixo de itens quase iguais e a busca fica inútil.
- **Transcrição ruim.** Se eu preciso corrigir texto, o sistema virou trabalho.
- **Sensação de vigilância.** Se ele começar a me confrontar demais, ou a soar como quem me avalia, eu paro de falar as coisas difíceis — que são justamente as que têm valor.
- **Revisão longa.** Passou de um minuto, vira tarefa. Tarefa acumula. Acumulou, abandonei.

---

## 9. Sinais de que está funcionando

Não são métricas de produto, são sinais que eu vou reconhecer no meu próprio comportamento:

- Gravo 5 dias por semana sem lembrete
- Abro o app para **perguntar** alguma coisa, não só para gravar
- Encontro algo que eu tinha esquecido completamente, pelo menos uma vez por mês
- A revisão leva menos de um minuto e eu aprovo quase tudo sem editar
- Pelo menos uma vez eu vejo uma contradição minha e ela muda uma decisão real

---

## 10. O que isto não é

Não é app de produtividade — não gerencia tarefas, não cobra prazo, não tem checkbox.
Não é ferramenta de trabalho — não é para transcrever reunião de cliente; isso já tem lugar.
Não é rede social nem tem qualquer forma de compartilhamento.
Não é um assistente que fala comigo. É um lugar onde eu falo e que devolve o que eu disse, quando eu preciso.

> **A linha "não é um chat" saiu daqui em 13/09**, e é a única coisa desta seção que já foi revogada. Ela dizia: "o diálogo existe só para completar o que ficou faltando na sessão". O chat que a slice 6 construiu é o oposto disso — é diálogo sobre o que **já** foi registrado, e ele existe porque a alternativa (uma barra de texto sem memória) não responde as perguntas que eu de fato faço (§6).
>
> O que a linha protegia continua protegido, e por outros meios: o chat **não escreve no grafo, nem por ferramenta** (regra 5 do `CLAUDE.md`); ele não puxa conversa, não pergunta nada de volta e não aparece durante a gravação; e a tela de gravar continua sendo um botão, um timer e um jeito de parar. O que este sistema não é continua sendo um assistente que fala comigo — é um que responde quando eu pergunto.
