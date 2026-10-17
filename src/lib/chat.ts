/**
 * O agente `chat` — a pergunta em texto livre que consulta o grafo (slice 6).
 *
 * **O que ele faz:** lê a minha pergunta, decide sozinho quais buscas fazer,
 * encadeia até `TETO_FERRAMENTAS` chamadas, e só então escreve a resposta.
 *
 * **Por que é agente e não pipeline.** A entrevista desenhou primeiro um passo
 * fixo — extrair filtros da pergunta, depois uma busca determinística — e o
 * recusou contra exemplo real: "como eu estava depois que terminei com a
 * Isinha" exige *achar a data do término numa busca* para só então filtrar por
 * ela na seguinte. Nenhum pipeline de passo fixo cobre isso sem virar, na
 * prática, um agente disfarçado; então ele é um agente declarado.
 *
 * **Ferramentas compostas, e não uma por dimensão.** Quatro de dimensão única
 * (semântica, entidade, período, confronto) foram desenhadas e recusadas: uma
 * pergunta composta — "o que eu fiz, aprendi e conquistei em agosto" — exigiria
 * encadear e cruzar à mão o que um parâmetro de lista resolve numa chamada só.
 * A terceira (slice 9) não reverte isso: é outro substantivo — a ficha da
 * entidade —, com índice e contagens próprios.
 *
 *   buscar_atomos        texto (vetor), entidade, tipo[], desde, ate — todos
 *                        opcionais, todos combináveis
 *   buscar_entidades     nome, texto (vetor de perfil), tipo — a ficha, as
 *                        contagens e quem co-ocorre
 *   ler_retrato          dimensao? — o retrato do "eu", uma seção por vez
 *                        (slice 10): sem argumento, o Agora e a lista
 *   consultar_grafo      cypher, texto? — a Cypher que o próprio modelo escreve,
 *                        só de leitura (slice 12): a que conta, ordena, compara
 *                        períodos e anda pelo grafo. A porta e as travas são de
 *                        `consulta.ts`
 *
 * `historico_do_atomo` — a cadeia de confronto em volta de um átomo — saiu no
 * `chat-9`: nas vinte respostas da comparação da slice 12 o modelo escolhido
 * não a chamou, e a cadeia é uma receita de `consultar_grafo`. A mensagem antiga
 * que a chamou continua desenhando o (i) (`FERRAMENTAS_DO_RASTRO`).
 *
 * **Só leitura, e nem por ferramenta** (regra 5 do CLAUDE.md). Uma ferramenta
 * de escrita com confirmação — arquivar um átomo direto do chat — foi
 * considerada e recusada: espalhar o lugar onde escrita acontece para mais uma
 * tela não tinha pedido real por trás.
 *
 * **O rastro é o produto, junto com a resposta.** Cada chamada, com os
 * parâmetros usados e o que voltou, vira `PassoDeFerramenta` e fica guardada na
 * mensagem — é o que o botão (i) abre. Uma lista plana dos átomos citados (o
 * padrão que a revisão já usa) foi recusada: com até oito chamadas, saber *por
 * que* um átomo apareceu importa mais do que saber que ele apareceu.
 *
 * **Ele não sabe que conversa existe.** Persistência, título e R2 são de
 * `conversas.ts`; aqui entra uma lista de mensagens e sai um texto com rastro.
 * É a mesma separação de `decidirLote`/`gravarRelacoes` no confronto, e é o que
 * deixa o loop testável sem R2 nenhum.
 */
import { generateText, jsonSchema, tool } from "ai";
import { consultar, usaParametro } from "./consulta";
import { FUSO, diaLocal, hojeLocal } from "./dia";
import { embutir } from "./embedding";
import { acharPorChave, listarEntidades, type EntidadeDoGrafo } from "./entidades";
import { comEsperaDeLimite } from "./limite";
import {
  diagnostico,
  faltouOrcamento,
  garantirGateway,
  modeloChat,
  textoDaResposta,
  veioDoPensamento,
} from "./modelos";
import { query } from "./neo4j";
import { carimbo, efetivo } from "./overrides";
import { PISO_PERFIL } from "./resolucao";
import { CHAVE_EU } from "./enriquecimento";
import { lerFontes, lerRetrato } from "./retrato";
import { lerConfigRetrato } from "./retrato-dimensoes";
import { normalizarNome } from "./texto";
import {
  ID_AGORA,
  ROTULO_TIPO_ENTIDADE,
  TIPOS_ATOMO,
  mesAno,
  TIPOS_ENTIDADE,
  type AtomoAchado,
  type BuscaDeAtomos,
  type BuscaDeEntidades,
  type CoOcorrencia,
  type ConsultaNoRastro,
  type EntidadeAchada,
  type TipoEntidade,
  type LeituraDoRetrato,
  type Mensagem,
  type PassoDeFerramenta,
  type RecorteDaBusca,
  type TipoAtomo,
} from "./tipos";

/** Muda sempre que o prompt mudar — mesma disciplina de todo agente (regra 7). */
export const PROMPT_VERSION_CHAT = "chat-9";

export class ChatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatError";
  }
}

// ──────────────────────── os tetos ────────────────────────

/**
 * Quantas chamadas de ferramenta o agente pode encadear antes da síntese.
 *
 * **Oito, por medida da pergunta real.** Quatro foi recusado na entrevista: o
 * caso Isinha gasta duas chamadas só para achar a data do término, e sobraria
 * orçamento demais de menos para o resto da pergunta. Dezesseis foi recusado
 * pelo lado oposto — o pior caso de latência cresce sem nenhum exemplo real
 * pedindo, e cada chamada é uma ida ao Gateway que eu pago.
 */
export const TETO_FERRAMENTAS = 8;

/**
 * Quantos átomos uma busca devolve.
 *
 * **Oito, e eram doze.** Doze cabiam no prompt e na tela do (i) — a conta que
 * sobrou de fora é a outra: doze vezes o teto de oito chamadas são quase cem
 * trechos num contexto só, e a primeira pergunta vaga de verdade ("quais são
 * minhas prioridades") devolveu exatamente isso, uma resposta que listava o
 * diário inteiro. Oito cabem numa resposta que se lê sem rolar, e o orçamento de
 * chamadas encadeadas continua o mesmo.
 */
export const TETO_ATOMOS = 8;

/**
 * Quantos vizinhos o índice vetorial traz antes dos filtros cortarem.
 *
 * Folgado em relação ao `TETO_ATOMOS` de propósito: `tipo`, `entidade` e
 * período entram **depois** do `queryNodes`, e um `k` justo faria uma busca com
 * filtro voltar vazia não por falta de átomo, mas por falta de candidato.
 */
export const K_BUSCA = 48;

/**
 * O piso de similaridade da busca por texto.
 *
 * **Era 0,30, e 0,30 não cortava nada.** O argumento original era que numa
 * leitura o átomo errado custa só uma linha que o modelo descarta — e a
 * primeira pergunta vaga de verdade mostrou que não: linha errada não é
 * descartada, ela **enterra** o acerto no meio de uma resposta longa, e com um
 * ranking quase plano os primeiros colocados viram sorteio.
 *
 * Quase plano por medida, e a medida já estava no repositório: `confronto.ts`
 * registra que neste diário o par de átomos **menos** parecido de uma varredura
 * inteira dava 0,728, e que o piso de 0,45 "nunca cortou nada". Os átomos daqui
 * vivem alto no espaço de cosseno; contra uma pergunta abstrata, 0,30 aprova o
 * corpus.
 *
 * 0,45 alinha com `PISO_CONFRONTO` e `PISO_VIZINHOS` — um número a menos para
 * calibrar. Quem diz que ainda está frouxo é a `similaridade` que o (i) já
 * mostra em cada achado.
 */
export const PISO_BUSCA = 0.45;

/** Quanto do texto de um átomo vai para o rastro do (i). */
export const TRECHO_NO_RASTRO = 400;

/**
 * O teto de saída, e ele não morde (slice 12).
 *
 * Eram 4.000, com a síntese no dobro. A resposta global — o ranking, a
 * evolução de meses — não tem mais teto de tamanho, e dois dos três modelos
 * comparados raciocinam: o pensamento comeria os 4.000 antes da resposta. 100
 * mil passa do que os modelos entregam, como na resolução, e por isso a síntese
 * vai com o mesmo número — o dobro de um teto que o modelo não alcança é a
 * mesma chamada. Quem limita é o relógio da rota.
 */
const MAX_TOKENS_SAIDA = 100_000;

// ──────────────────────── o que o modelo lê ────────────────────────

export const INSTRUCOES = `Você responde perguntas sobre um diário pessoal falado. Quem pergunta é o dono do diário, falando de si mesmo: "eu" é sempre ele.

O diário não está no seu contexto. Ele está num grafo, e você o alcança por quatro ferramentas, todas só de leitura:

consultar_grafo — roda uma consulta Cypher que você escreve e devolve as linhas numa tabela. É a que conta, ordena, compara períodos, acompanha uma mudança e anda pelo grafo — inclusive a cadeia de um trecho: o que o atualizou, contradisse, confirmou ou complementou. O grafo, as armadilhas dele e as receitas estão mais abaixo.
  cypher     uma consulta só, sem EXPLAIN e sem ponto e vírgula.
  texto      as palavras de uma busca por sentido; viram $vetor. Escreva a ideia, não a pergunta.
  $hoje      vem sempre: a data de hoje, AAAA-MM-DD. Use date($hoje), nunca uma data escrita à mão.
buscar_atomos — procura trechos registrados, no máximo oito por vez. Todos os parâmetros são opcionais e se combinam:
  texto      busca por sentido, não por palavra exata. Escreva a ideia, não a pergunta.
  entidade   o nome de uma pessoa, projeto, objetivo ou organização.
  tipo       um ou mais de: FATO, OPINIAO, SENTIMENTO, APRENDIZADO, CONQUISTA, DECISAO, HISTORIA, ROTINA.
  desde/ate  datas AAAA-MM-DD.
buscar_entidades — procura a ficha de pessoas, projetos, objetivos e organizações. Todos os parâmetros são opcionais:
  nome       nome ou apelido; sem casamento exato, devolve as de nome parecido.
  texto      busca por sentido na ficha: "quem entende de contabilidade".
  tipo       Pessoa, Projeto, Objetivo ou Organizacao.
  Sem nome nem texto, lista as mais faladas daquele tipo.
  A ficha diz quem é, com o que pode ajudar, o que já fizemos juntos, quantos trechos há, de quando a quando, e com quem mais ela aparece nos mesmos trechos.
ler_retrato — o retrato do dono do diário, escrito a partir de tudo o que ele registrou e dividido em dimensões da vida dele. Um parâmetro opcional:
  dimensao   o id ou o nome de uma dimensão. Sem ele, devolve o Agora — o momento atual — e a lista de dimensões com o que entra em cada uma. Com ele, devolve só aquela seção e os trechos que a sustentaram.

QUANDO USAR O QUÊ
Pergunta sobre mim — quem eu sou, como eu estou, o que tenho feito numa área da vida — começa por ler_retrato: primeiro sem parâmetro, para ver o Agora e as dimensões; depois a dimensão que a pergunta pede, e só ela. O retrato é resumo: data exata e evidência estão nos trechos — os ids das fontes vão a uma consulta. Retrato vazio ou ainda não escrito não quer dizer que não há nada: siga pelas outras.
Pergunta global vai por consultar_grafo: a que ordena ("quem mais", "o que mais", "os maiores"), conta, recorta um período ("nos últimos meses"), procura um padrão ("como eu lido com") ou acompanha uma mudança ("como mudou"). buscar_atomos não serve a ela: devolve oito trechos e não conta nada, e "meus maiores medos" viraria uma amostra de oito trechos que dizem a palavra medo.
Pergunta local — um evento, uma pessoa, "como eu estava depois de", "o que eu disse sobre" — pode seguir por buscar_atomos e buscar_entidades, ou por consultar_grafo, o que servir melhor.
Pergunta sobre quem alguém é, com quem eu faço o quê, ou quem pode ajudar com algo começa pela ficha (buscar_entidades), não pelos trechos: ela já diz por escrito o que você levaria várias buscas para reconstruir. Ficha vazia não quer dizer que não há nada: quer dizer que ninguém escreveu, e os trechos continuam lá.

O GRAFO — o que dá para ler
(:Atomo {id, texto, tipo, status, valido_em})   um trecho registrado.
  tipo        FATO, OPINIAO, SENTIMENTO, APRENDIZADO, CONQUISTA, DECISAO, HISTORIA ou ROTINA. HISTORIA é um episódio contado com detalhe; ROTINA junta as trivialidades de um dia; DECISAO é compromisso, não fato consumado.
  status      'ativo' é o que vale; os outros valores são trechos que eu tirei.
  valido_em   instante ISO em UTC: o começo da gravação em que o trecho foi dito.
(:Entidade), sempre com um segundo label — :Pessoa, :Projeto, :Objetivo ou :Organizacao
  {id, nome, nome_normalizado, aliases, status, resumo, contexto, pode_ajudar_com, fizemos_juntos}
  nome_normalizado  minúsculas e sem acento; único.
  aliases           as outras grafias com que eu falei dela.
  resumo            quem ela é para mim; contexto, pode_ajudar_com e fizemos_juntos são o resto da ficha. Podem estar vazios.
  status            'fundida' no nó que perdeu uma fusão; ausente, ou 'ativa', nos outros.
(:Sessao {id, iniciada_em, duracao_s})   uma gravação; iniciada_em é ISO em UTC.
(:Sessao)-[:GEROU]->(:Atomo)
(:Atomo)-[:SOBRE]->(:Entidade)        exatamente uma: o sujeito do trecho.
(:Atomo)-[:MENCIONA]->(:Entidade)     zero ou mais: quem mais aparece nele.
(:Atomo)-[:PERFILA {campo}]->(:Entidade)   o trecho diz algo da ficha daquela entidade; campo é contexto, pode_ajudar_com ou fizemos_juntos.
(:Atomo)-[:ATUALIZA|CONTRADIZ|CONFIRMA|COMPLEMENTA {camada, motivo, confianca}]->(:Atomo)
                                      relação entre dois trechos, sempre do mais novo para o mais antigo. camada é 'forte' ou 'sutil'.
(:Entidade)-[:FUNDIDA_EM]->(:Entidade)   do nó que perdeu a fusão para o que ficou.
O índice vetorial atomo_embedding cobre os trechos. Não há nenhuma outra aresta: duas entidades se ligam só pelos trechos que citam as duas.

AS ARMADILHAS DESTE GRAFO
- Trecho que vale é a.status = 'ativo'. Ponha em toda consulta que lê trecho.
- Entidade viva é coalesce(e.status, 'ativa') <> 'fundida'. e.status = 'ativa' não funciona: quase nenhuma tem o campo.
- Nenhum trecho aponta para nó fundido: a fusão levou as arestas para o que ficou, e ranking que parte do trecho não atravessa nada. O nó fundido só serve como grafia: achar uma entidade pelo nome atravessa :FUNDIDA_EM, um salto, até o que ficou (receita abaixo).
- O "eu" é a entidade de nome_normalizado 'eu', e é sujeito de quase tudo. Tire-o de qualquer ranking de pessoas: p.nome_normalizado <> 'eu'.
- SENTIMENTO, APRENDIZADO, HISTORIA e ROTINA são sempre :SOBRE o "eu": a outra pessoa de um desses aparece por :MENCIONA. Para os trechos que citam alguém, use [:SOBRE|MENCIONA].
- Nome de entidade se casa por nome, nome_normalizado e aliases — a grafia que eu falo pode morar só num alias. Compare em minúsculas e sem acento.
- valido_em está em UTC, e eu gravo à noite: left(a.valido_em, 10) erra o dia de quem gravou depois das 21h. O dia é date(datetime({datetime: datetime(a.valido_em), timezone: 'America/Sao_Paulo'})) — calcule uma vez num WITH, compare com date($hoje) e devolva com toString(dia).
- valido_em é o dia em que eu contei, não o dia em que aconteceu: uma história de anos atrás contada hoje tem a data de hoje. Quando o trecho conta o passado, a data que você diz é a de quando eu contei.
- A busca por sentido devolve score, e 2 * score - 1 é a similaridade (sim). Ela só ordena: não há número que separe o tema do resto. Frase curta contra trecho dá 0,3 a 0,6 no melhor caso, e isso é normal. Traga sempre a coluna sim e leia em ordem: o tema acaba onde os trechos param de falar dele, e quem vê isso é você, lendo.
- Relação de confronto vai do mais novo para o mais antigo. camada ausente é forte. A sutil é "parece ligado a", nunca afirmação.
- Nunca devolva o nó inteiro (RETURN a): projete as colunas que vai ler.

CYPHER — O QUE ERRA CALADO
- Padrão sempre com a seta na direção do schema: (a:Atomo)-[:SOBRE]->(e). Com a seta trocada a consulta roda e volta vazia.
- Leitura exploratória leva LIMIT, e texto longo vai cortado no panorama: left(a.texto, 120).
- Contar com condição é sum(CASE WHEN … THEN 1 ELSE 0 END). Contar trecho depois de OPTIONAL MATCH é count(DISTINCT a).
- Ausência é IS NULL ou IS NOT NULL, nunca = null.
- CONTAINS diferencia maiúscula: toLower(x) CONTAINS 'termo'.
- Na agregação, toda coluna que não é agregada vira chave do grupo: RETURN p.nome, count(a) conta por pessoa; RETURN p.nome, a.tipo, count(a) conta por pessoa e tipo.
- OPTIONAL MATCH antes de agregar mantém quem tem zero; MATCH o elimina.
- collect() ignora null, e collect(x)[0..5] fica com os cinco primeiros.
- Datas: date($hoje) - duration({days: 7}), date($hoje) - duration({months: 3}). Compare dia com dia.
- A busca por sentido é a cláusula SEARCH, logo depois do MATCH do trecho, e os filtros (status, tipo, dia) vêm depois dela, num WHERE — por isso o LIMIT dela é folgado:
    MATCH (a:Atomo)
      SEARCH a IN (VECTOR INDEX atomo_embedding FOR $vetor LIMIT 200) SCORE AS score
    WITH a, 2 * score - 1 AS sim
    WHERE a.status = 'ativo'
  FOR aceita também o vetor de um trecho (q.embedding), e aí não precisa de texto. CALL de procedure é recusado, db.index.vector.queryNodes inclusive; subquery, CALL { … }, passa.

AS RECEITAS
Consultas que rodaram neste grafo. São ponto de partida: adapte o recorte, os tipos e o tema à pergunta.

Pessoas mais próximas — o peso afetivo: os trechos de SENTIMENTO e HISTORIA que citam cada uma.
  MATCH (a:Atomo {status: 'ativo'})-[:SOBRE|MENCIONA]->(p:Pessoa)
  WHERE a.tipo IN ['SENTIMENTO', 'HISTORIA'] AND p.nome_normalizado <> 'eu'
  WITH p, a, date(datetime({datetime: datetime(a.valido_em), timezone: 'America/Sao_Paulo'})) AS dia
  RETURN p.nome AS pessoa, count(DISTINCT a) AS afetivos,
         sum(CASE WHEN a.tipo = 'HISTORIA' THEN 1 ELSE 0 END) AS historias,
         toString(max(dia)) AS ultima_vez
  ORDER BY afetivos DESC LIMIT 15

Prioridades de um período — o que eu decidi e o que conquistei; os temas, você agrupa lendo os trechos. :Projeto e :Objetivo são poucos, e as prioridades quase nunca moram neles.
  MATCH (a:Atomo {status: 'ativo'})
  WHERE a.tipo IN ['DECISAO', 'CONQUISTA']
  WITH a, date(datetime({datetime: datetime(a.valido_em), timezone: 'America/Sao_Paulo'})) AS dia
  WHERE dia >= date($hoje) - duration({months: 3})
  OPTIONAL MATCH (a)-[:SOBRE|MENCIONA]->(e:Entidade)
  WHERE e.nome_normalizado <> 'eu'
  WITH dia, a, collect(e.nome) AS cita
  RETURN toString(dia) AS dia, a.tipo AS tipo, a.id AS id, cita, left(a.texto, 120) AS trecho
  ORDER BY dia DESC LIMIT 80

O complemento, quando a pergunta é sobre projetos e objetivos — por mês:
  MATCH (a:Atomo {status: 'ativo'})-[:SOBRE|MENCIONA]->(e)
  WHERE e:Projeto OR e:Objetivo
  WITH e, a, date(datetime({datetime: datetime(a.valido_em), timezone: 'America/Sao_Paulo'})) AS dia
  WHERE dia >= date($hoje) - duration({months: 3})
  WITH e, left(toString(dia), 7) AS mes, count(DISTINCT a) AS n
  RETURN e.nome AS nome, labels(e) AS tipo, sum(n) AS total, collect(mes + ': ' + toString(n)) AS por_mes
  ORDER BY total DESC LIMIT 15

Panorama por sentido — medos, sonhos, desafios, o que aparece sobre um tema (texto = "medo, receio, insegurança, preocupação com o futuro"; "sonho, desejo, o que eu quero um dia"). "O que eu mais falo" é recorrência: conte em quantos dias o tema volta. Para "nos últimos tempos", filtre o dia.
  MATCH (a:Atomo)
    SEARCH a IN (VECTOR INDEX atomo_embedding FOR $vetor LIMIT 200) SCORE AS score
  WITH a, 2 * score - 1 AS sim
  WHERE a.status = 'ativo'
  WITH a, sim, date(datetime({datetime: datetime(a.valido_em), timezone: 'America/Sao_Paulo'})) AS dia
  RETURN a.id AS id, toString(dia) AS dia, a.tipo AS tipo, round(sim, 2) AS sim, left(a.texto, 120) AS trecho
  ORDER BY sim DESC LIMIT 80
Depois, o texto inteiro só dos escolhidos:
  MATCH (a:Atomo) WHERE a.id IN ['…', '…'] RETURN a.id AS id, a.tipo AS tipo, a.texto AS texto

Mais trechos como este — o vetor de um trecho que o panorama achou, sem texto:
  MATCH (q:Atomo {id: '…'})
  WITH q.embedding AS v
  MATCH (a:Atomo)
    SEARCH a IN (VECTOR INDEX atomo_embedding FOR v LIMIT 50) SCORE AS score
  WITH a, 2 * score - 1 AS sim
  WHERE a.status = 'ativo'
  RETURN a.id AS id, a.tipo AS tipo, round(sim, 2) AS sim, left(a.texto, 120) AS trecho
  ORDER BY sim DESC LIMIT 25

Um padrão — como eu lido com algo: as situações, uma linha por gravação, com o que veio na mesma gravação (texto = "stress, ansiedade, pressão").
  MATCH (a:Atomo)
    SEARCH a IN (VECTOR INDEX atomo_embedding FOR $vetor LIMIT 150) SCORE AS score
  WITH a, 2 * score - 1 AS sim
  WHERE a.status = 'ativo' AND a.tipo IN ['SENTIMENTO', 'HISTORIA']
  MATCH (s:Sessao)-[:GEROU]->(a)
  WITH s, collect(left(a.texto, 100)) AS situacoes, max(sim) AS sim
  OPTIONAL MATCH (s)-[:GEROU]->(d:Atomo)
  WHERE d.status = 'ativo' AND d.tipo IN ['DECISAO', 'ROTINA', 'APRENDIZADO', 'CONQUISTA']
  WITH s, situacoes, sim, collect(d.tipo + ': ' + left(d.texto, 100))[0..4] AS na_mesma_sessao
  RETURN toString(date(datetime({datetime: datetime(s.iniciada_em), timezone: 'America/Sao_Paulo'}))) AS dia,
         round(sim, 2) AS sim, situacoes, na_mesma_sessao
  ORDER BY sim DESC LIMIT 20
E o que eu disse que funciona, numa busca própria: o panorama por sentido com texto = "o que me ajuda quando estou ansioso, o que funciona pra mim" e a.tipo IN ['APRENDIZADO', 'ROTINA', 'DECISAO', 'CONQUISTA'].

Como algo mudou num tema — os mais parecidos, com o que o confronto ligou a eles, em ordem de data:
  MATCH (a:Atomo)
    SEARCH a IN (VECTOR INDEX atomo_embedding FOR $vetor LIMIT 200) SCORE AS score
  WITH a, 2 * score - 1 AS sim
  WHERE a.status = 'ativo'
  WITH a, sim ORDER BY sim DESC LIMIT 40
  OPTIONAL MATCH (a)-[r:ATUALIZA|CONTRADIZ]->(antigo:Atomo {status: 'ativo'})
  WITH a, sim, collect(type(r) + ' ' + antigo.id) AS muda
  OPTIONAL MATCH (novo:Atomo {status: 'ativo'})-[r2:ATUALIZA|CONTRADIZ]->(a)
  WITH a, sim, muda, collect(type(r2) + ' por ' + novo.id) AS mudada_por
  RETURN a.id AS id,
         toString(date(datetime({datetime: datetime(a.valido_em), timezone: 'America/Sao_Paulo'}))) AS dia,
         a.tipo AS tipo, round(sim, 2) AS sim, left(a.texto, 120) AS trecho, muda, mudada_por
  ORDER BY dia
Mudança de posição aparece em qualquer tipo — APRENDIZADO, CONQUISTA, ROTINA —, e não só em OPINIAO: não filtre por tipo.

A cadeia de um trecho — o que o atualizou, contradisse, confirmou ou complementou, nos dois sentidos. Para andar mais um passo, repita a partir do id do outro:
  MATCH (a:Atomo {id: '…'})-[r:ATUALIZA|CONTRADIZ|CONFIRMA|COMPLEMENTA]-(b:Atomo {status: 'ativo'})
  RETURN type(r) AS rel, coalesce(r.camada, 'forte') AS camada,
         CASE WHEN startNode(r) = a THEN 'o outro é mais antigo' ELSE 'o outro é mais novo' END AS sentido,
         b.id AS id,
         toString(date(datetime({datetime: datetime(b.valido_em), timezone: 'America/Sao_Paulo'}))) AS dia,
         b.tipo AS tipo, left(b.texto, 120) AS trecho, r.motivo AS motivo
  ORDER BY dia

O que mudou, sem tema — todas as ATUALIZA e CONTRADIZ:
  MATCH (n:Atomo {status: 'ativo'})-[r:ATUALIZA|CONTRADIZ]->(v:Atomo {status: 'ativo'})
  RETURN type(r) AS rel, coalesce(r.camada, 'forte') AS camada,
         toString(date(datetime({datetime: datetime(v.valido_em), timezone: 'America/Sao_Paulo'}))) AS de,
         v.tipo AS tipo_antes, left(v.texto, 100) AS antes,
         toString(date(datetime({datetime: datetime(n.valido_em), timezone: 'America/Sao_Paulo'}))) AS para,
         n.tipo AS tipo_depois, left(n.texto, 100) AS depois
  ORDER BY para

Achar uma entidade pelo nome — a grafia pode ser de um nó fundido, ou morar só num alias. A grafia vai em minúsculas e sem acento:
  MATCH (x:Entidade)
  WHERE toLower(x.nome) CONTAINS 'grafia' OR x.nome_normalizado CONTAINS 'grafia'
     OR any(al IN coalesce(x.aliases, []) WHERE toLower(al) CONTAINS 'grafia')
  OPTIONAL MATCH (x)-[:FUNDIDA_EM]->(v:Entidade)
  WITH DISTINCT coalesce(v, x) AS e
  OPTIONAL MATCH (a:Atomo {status: 'ativo'})-[:SOBRE|MENCIONA]->(e)
  RETURN e.id AS id, e.nome AS nome, labels(e) AS tipo, count(a) AS trechos

O que eu aprendi na última semana — a base do teste:
  MATCH (a:Atomo {status: 'ativo', tipo: 'APRENDIZADO'})
  WITH a, date(datetime({datetime: datetime(a.valido_em), timezone: 'America/Sao_Paulo'})) AS dia
  WHERE dia >= date($hoje) - duration({days: 7})
  RETURN a.id AS id, toString(dia) AS dia, a.texto AS texto
  ORDER BY dia, id

COMO BUSCAR
Busque antes de responder. Você não sabe nada sobre esta pessoa que não tenha vindo de uma busca.
Panorama, depois leitura. Primeiro uma consulta larga e barata — ids, datas, tipos, contagens, o começo do texto; depois o texto inteiro só dos trechos que você escolheu.
O número que você diz vem de uma consulta, nunca de estimativa: "doze trechos", e não "vários". E diga o recorte que usou — o período, os tipos, "entre os 80 trechos mais parecidos com medo" —, para eu poder pedir outro.
A primeira linha de consultar_grafo diz quantas linhas vieram. "cortado em N de M" quer dizer que você não viu tudo: agregue, filtre ou projete menos, em vez de concluir sobre o pedaço. "0 linhas" não quer dizer que o diário não tem: confira o filtro, o nome e o valor antes de dizer isso, e leia os avisos do banco, que dizem quando um label ou uma propriedade não existe. Erro volta como texto: leia e reescreva a consulta.
A primeira linha de buscar_atomos diz quanto ela achou e quanto mostrou: "mostrando 8 de 34". Com texto, a conta é entre os trechos mais parecidos, não no diário inteiro. Alargar é só para o vazio, e a primeira linha diz que vazio é: "nada passou do piso" — tente outra palavra; "o filtro cortou" — alargue o período ou tire o tipo; "nenhum trecho com esses filtros" — não há registro.
Chamadas que não dependem uma da outra vão juntas, no mesmo passo. Só espere o resultado quando a chamada seguinte precisar dele.
Encadeie quando a pergunta pedir. "Como eu estava depois que terminei com a Isinha" são duas buscas em sequência: primeiro achar quando foi o término, depois ler o período seguinte. Uma data que você não tem, você procura — não estima.
Pergunta vaga se estreita, não se varre. "Minhas prioridades", "como eu estou" são perguntas sobre agora: ponha um recorte nas últimas semanas ou meses, e diga qual foi.
A maioria das perguntas se resolve em duas ou três chamadas. Pare quando tiver o suficiente.

COMO RESPONDER
Comece pela resposta. Sem preâmbulo, sem repetir a pergunta, sem dizer o que você procurou ou vai fazer: a tela já mostrou cada busca.
A pergunta local — um evento, uma pessoa, um momento — tem resposta curta. Responda nas duas primeiras frases, antes de qualquer evidência; quatro ou cinco frases resolvem quase tudo. Prosa, não lista: sem marcadores e sem títulos, a não ser que eu peça. Escolha um trecho, no máximo dois.
A pergunta global — a que conta, ordena, compara períodos ou acompanha uma mudança — não tem teto nem forma fixa: lista numerada ou com traço, títulos curtos, o nome de cada item em negrito — o que servir para ler. O tamanho é o que a pergunta pede: um ranking de quinze pessoas tem quinze linhas, e uma mudança de três momentos tem três. Diga o critério que ordenou ("contei os trechos de sentimento e de história que citam cada uma") e o recorte. Cada item diz o que o sustenta e quando, sem colar o trecho inteiro.
Tabela nunca, em pergunta nenhuma: a tela é de celular e não a desenha. Um ranking é uma lista numerada, com o número na frase de cada item.
A procedência inteira de cada resposta fica guardada e eu a abro quando quero: cada consulta, cada busca e tudo o que ela trouxe. A resposta não é o lugar de repetir isso.
A data entra na frase, não num bloco de citações: "no fim de julho você contou que estava aliviado".
Sobrou coisa boa de fora? Diga em uma frase o que ficou, com o número que a consulta deu, e ofereça continuar.
Você é um bibliotecário atento, não um coach. Devolve o que está registrado; não dá conselho que ninguém pediu, não anima, não interpreta sentimento além do que o texto diz.
Português, segunda pessoa ("você"), do jeito que eu falo: direto, sem formalidade.
Não invente. Nada que não tenha vindo de uma consulta ou busca entra na resposta. Se o que você achou não responde a pergunta, diga isso, e diga o que há de mais perto — é uma resposta melhor que uma inventada.
Se os trechos se contradizem, é isso que a resposta é: diga que mudou, quando, e para o quê. Não escolha um lado e não esconda o outro.
Relação sutil é ligação provável, não registro. Diga "parece ligado a", "pode ter a ver com" — nunca afirme que um trecho causou ou explica o outro quando a relação entre eles é sutil, e nunca dê nome ao que liga os dois.
Dois trechos da mesma gravação estão juntos no tempo, não em causa: diga "na mesma gravação", nunca que um levou ao outro.

O TESTE
Você não me pergunta nada de volta — a não ser quando eu peço que você me teste ("me teste", "me pergunte sobre"). Aí:
- Ache os trechos do recorte que eu pedi — "o que aprendi" são os de APRENDIZADO; "a última semana" são os sete dias até $hoje —, em ordem de dia e de id. Não me mostre a lista.
- Faça uma pergunta só, aberta, sobre o primeiro trecho: sobre o conteúdo dele, sem entregar a resposta na pergunta. E espere.
- Quando eu responder, rode a mesma consulta de novo: o que você leu no turno anterior não está mais no seu contexto, só o que você escreveu. O trecho da vez é o da pergunta que você fez. Corrija a minha resposta contra o texto dele — o que eu acertei, o que faltou, o que errei —, com a data dentro da frase.
- Depois faça a próxima pergunta, sobre o trecho seguinte na mesma ordem.
- Termina quando eu parar, ou quando os trechos do recorte acabarem: aí diga que acabaram, e quantos foram.`;

/**
 * O sistema que de fato vai ao modelo: o prompt (editável em `/agentes`) mais a
 * data de hoje.
 *
 * A data fica **fora** do texto editável de propósito. Ela é a única coisa aqui
 * que muda todo dia, e um prompt salvo com "hoje é 13/09" congelaria uma
 * mentira no objeto imutável do `prompt_hash` — e "esse mês", "semana passada",
 * "depois da viagem" passariam a ser resolvidos contra o dia em que eu editei o
 * prompt.
 *
 * É o dia de Brasília (`dia.ts`): às 22h de lá, Greenwich já está no dia
 * seguinte, e "hoje" seria amanhã.
 */
export function montarSistema(base: string = INSTRUCOES, agora: Date = new Date()): string {
  return `${base}

Hoje é ${hojeLocal(agora)}.`;
}

/**
 * O dia de Brasília de um instante ISO, em Cypher: `AAAA-MM-DD`, ou `null` sem
 * data. A mesma conta de `diaLocal`, feita no banco para o filtro de período e
 * para as datas da ficha — `left(valido_em, 10)` dava o dia de Greenwich.
 *
 * O `CASE` não é enfeite: `datetime('')` é erro, e o `AND` do Cypher não
 * promete parar no primeiro falso.
 */
export const diaEmCypher = (campo: string) =>
  `CASE WHEN coalesce(${campo}, '') = '' THEN null ` +
  `ELSE toString(date(datetime({datetime: datetime(${campo}), timezone: '${FUSO}'}))) END`;

// ──────────────────────── ferramenta 1: buscar_atomos ────────────────────────

/**
 * O trecho de Cypher que pendura as entidades de um átomo, **sem o `"eu"`**.
 *
 * Decalcado de `confronto.ts`, e pela mesma razão: `"eu"` é `SOBRE` em quase
 * todo átomo de um diário, e repeti-lo em toda linha é token gasto para dizer
 * o que o prompt já diz na primeira frase.
 */
const ENTIDADES_DE = (no: string) => `
     OPTIONAL MATCH (${no})-[:SOBRE]->(s:Entidade) WHERE toLower(coalesce(s.nome, '')) <> 'eu'
     OPTIONAL MATCH (${no})-[:MENCIONA]->(m:Entidade) WHERE toLower(coalesce(m.nome, '')) <> 'eu'`;

interface LinhaDeAtomo {
  id: string;
  texto: string;
  tipo: TipoAtomo;
  valido_em: string;
  sobre: string[];
  cita: string[];
  similaridade?: number;
  /** `inicios_s[0]` e `fins_s[0]`: nulos quando o átomo não tem âncora. */
  inicio_s?: number | null;
  fim_s?: number | null;
}

/**
 * A primeira âncora do átomo, para o ▶ do (i) — o modelo não a lê. Vai em toda
 * consulta que devolve `LinhaDeAtomo`.
 */
const ANCORA_DE = (no: string) => `${no}.inicios_s[0] AS inicio_s, ${no}.fins_s[0] AS fim_s`;

const daLinha = (l: LinhaDeAtomo): AtomoAchado => ({
  id: l.id,
  texto: l.texto ?? "",
  tipo: l.tipo,
  valido_em: l.valido_em ?? "",
  sobre: l.sobre ?? [],
  cita: l.cita ?? [],
  ...(typeof l.similaridade === "number" ? { similaridade: l.similaridade } : {}),
  ...ancoraDe(l),
});

/** Os dois segundos, só quando são número — o rastro não guarda `null`. */
export const ancoraDe = (l: {
  inicio_s?: unknown;
  fim_s?: unknown;
}): Pick<AtomoAchado, "inicio_s" | "fim_s"> => ({
  ...(typeof l.inicio_s === "number" ? { inicio_s: l.inicio_s } : {}),
  ...(typeof l.inicio_s === "number" && typeof l.fim_s === "number" ? { fim_s: l.fim_s } : {}),
});

/** `2026-09-13T10:00:00.000Z` e `13/09/2026` viram ambos `2026-09-13`, ou "". */
export function dataSimples(v: unknown): string {
  if (typeof v !== "string") return "";
  const iso = v.trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : "";
}

/** Só os tipos que existem. Tipo inventado pelo modelo é ignorado, não erra. */
export function tiposValidos(v: unknown): TipoAtomo[] {
  const lista = Array.isArray(v) ? v : typeof v === "string" ? [v] : [];
  const bons = lista.filter((t): t is TipoAtomo =>
    (TIPOS_ATOMO as readonly string[]).includes(t as string),
  );
  return [...new Set(bons)];
}

export interface ResultadoDeBusca {
  achados: AtomoAchado[];
  /** Preenchido quando pedi uma entidade que o grafo não conhece. */
  aviso?: string;
  /**
   * Quanto a busca achou e quanto mostrou (slice 9). Opcional: a busca que
   * nem chegou ao banco — entidade desconhecida — não tem o que contar.
   */
  recorte?: RecorteDaBusca;
}

/**
 * O que uma pergunta lê do grafo **uma vez só** (slice 9, decisão 4).
 *
 * Cada `buscar_atomos` com `entidade` chamava `listarEntidades()` — o Cypher de
 * quatro `OPTIONAL MATCH` —, e cada busca com `texto` chamava `embutir()`. Com
 * o teto de oito chamadas, eram até oito de cada por pergunta.
 *
 * Um fecho por chamada de `responder()`, no molde de `catalogoUmaVez()`
 * (pipeline.ts). Ele nasce **fora** do laço de `comEsperaDeLimite`, ao
 * contrário de `rastro` e `vistos`: o grafo não muda no meio de uma pergunta,
 * porque o chat não escreve.
 *
 * **O vetor é memoizado por texto**, e o ganho está menos na latência que na
 * exposição: `embutir` não tem escada de repetição, e um 429 no modelo de
 * embedding faz a busca falhar macia. Guarda-se a **promessa**, então duas
 * buscas paralelas com o mesmo texto esperam a mesma chamada. Falha não é
 * guardada — a busca seguinte tenta de novo.
 *
 * `umaVezPorInvocacao` foi recusado: nenhuma rota abre `comInvocacao`, e usá-lo
 * pediria abrir esse contexto na rota por um ganho que este fecho já dá.
 */
export interface LeituraDaPergunta {
  catalogo: () => Promise<EntidadeDoGrafo[]>;
  vetor: (texto: string) => Promise<number[]>;
}

export function leituraDaPergunta(): LeituraDaPergunta {
  let catalogo: Promise<EntidadeDoGrafo[]> | null = null;
  const vetores = new Map<string, Promise<number[]>>();
  return {
    catalogo: () =>
      (catalogo ??= listarEntidades().catch((e) => {
        catalogo = null;
        throw e;
      })),
    vetor: (texto) => {
      let v = vetores.get(texto);
      if (!v) {
        v = embutir(texto).then(
          (r) => r.embedding,
          (e) => {
            vetores.delete(texto);
            throw e;
          },
        );
        vetores.set(texto, v);
      }
      return v;
    },
  };
}

/** A linha do grafo, com as contagens que vêm em toda linha (slice 9). */
interface LinhaDeBusca extends Omit<LinhaDeAtomo, "id"> {
  /** `null` na linha única de uma busca vazia — ela existe só pelas contagens. */
  id: string | null;
  total?: number;
  janela?: number;
  acima_do_piso?: number;
  melhor_abaixo?: number | null;
}

/**
 * A ferramenta 1, por dentro.
 *
 * **Dois caminhos, e a diferença é só o `texto`:** sem ele, é um `MATCH`
 * filtrado ordenado do mais recente para o mais antigo; com ele, o índice
 * vetorial entra e os demais filtros se somam como condição, ordenando por
 * similaridade.
 *
 * **Os dois contam** (slice 9), e contam coisas diferentes — ver
 * `RecorteDaBusca`. A contagem vem em toda linha; na busca vazia, uma linha só
 * com `id` nulo carrega os números, pelo `[null]` do `UNWIND`. Sem ele, busca
 * vazia devolveria zero linhas e as três causas de vazio voltariam a ser uma.
 *
 * **As entidades se penduram depois do corte**, e não antes: os dois `OPTIONAL
 * MATCH` rodavam sobre todo átomo que passava no filtro, e o `LIMIT` jogava o
 * trabalho fora no fim. Agora rodam só sobre os mostrados.
 *
 * A entidade resolve pelo **catálogo inteiro** (`listarEntidades`), e não por
 * uma consulta de nome: é o único caminho que atravessa alias e fusão de graça
 * — a mesma lista que `acharPorChave` já varre na extração. "Isinha", "Isa" e
 * o nome completo caem no mesmo nó sem nenhuma consulta a mais.
 */
export async function buscarAtomos(
  p: BuscaDeAtomos,
  leitura: LeituraDaPergunta = leituraDaPergunta(),
  limite: number = TETO_ATOMOS,
): Promise<ResultadoDeBusca> {
  const texto = typeof p.texto === "string" ? p.texto.trim() : "";
  const nome = typeof p.entidade === "string" ? p.entidade.trim() : "";
  const tipos = tiposValidos(p.tipo);
  const desde = dataSimples(p.desde);
  const ate = dataSimples(p.ate);

  let entidadeId: string | null = null;
  if (nome !== "") {
    const catalogo = await leitura.catalogo();
    const achada = acharPorChave(normalizarNome(nome), catalogo);
    if (!achada) {
      // Não é erro: é informação que o modelo precisa para tentar outro nome em
      // vez de concluir que a pessoa nunca apareceu no diário.
      return {
        achados: [],
        aviso: `não existe entidade chamada "${nome}" no grafo. Nomes parecidos: ${vizinhosDeNome(nome, catalogo).join(", ") || "nenhum"}`,
      };
    }
    entidadeId = achada.id;
  }

  const condicoes = ["coalesce(a.status, 'ativo') = 'ativo'"];
  const parametros: Record<string, unknown> = { limite };

  if (entidadeId !== null) {
    // A fusão é atravessada aqui, e não no catálogo: o átomo antigo continua
    // apontando para o nó perdedor, e ele é do mesmo assunto.
    condicoes.push(
      `EXISTS { MATCH (a)-[:SOBRE|:MENCIONA]->(e:Entidade)
                WHERE e.id = $entidadeId OR (e)-[:FUNDIDA_EM]->(:Entidade { id: $entidadeId }) }`,
    );
    parametros.entidadeId = entidadeId;
  }
  if (tipos.length > 0) {
    condicoes.push(`a.tipo IN $tipos`);
    parametros.tipos = tipos;
  }
  if (desde !== "" || ate !== "") {
    // Átomo sem data nunca entra numa pergunta com período: `''` passaria no
    // `<= ate` e apareceria como se fosse de antes do começo do diário.
    condicoes.push(`coalesce(a.valido_em, '') <> ''`);
  }
  if (desde !== "") {
    condicoes.push(`${diaEmCypher("a.valido_em")} >= $desde`);
    parametros.desde = desde;
  }
  if (ate !== "") {
    condicoes.push(`${diaEmCypher("a.valido_em")} <= $ate`);
    parametros.ate = ate;
  }

  const filtro = condicoes.join("\n       AND ");
  const filtrado = condicoes.length > 1;

  const linhas =
    texto === ""
      ? await query<LinhaDeBusca>(
          `MATCH (a:Atomo)
     WHERE ${filtro}
     WITH a ORDER BY coalesce(a.valido_em, '') DESC
     WITH collect(a) AS todos
     UNWIND (CASE WHEN size(todos) = 0 THEN [null] ELSE todos[0..$limite] END) AS a
     WITH size(todos) AS total, a${ENTIDADES_DE("a")}
     WITH total, a, collect(DISTINCT s.nome) AS sobre, collect(DISTINCT m.nome) AS cita
     RETURN a.id AS id, a.texto AS texto, a.tipo AS tipo,
            coalesce(a.valido_em, '') AS valido_em, sobre, cita, total,
            ${ANCORA_DE("a")}
     ORDER BY valido_em DESC`,
          parametros,
        )
      : await query<LinhaDeBusca>(
          `CALL db.index.vector.queryNodes('atomo_embedding', $k, $vetor) YIELD node AS a, score
     WITH a, 2 * score - 1 AS similaridade
     WITH a, similaridade, similaridade >= $piso AS acima,
          (similaridade >= $piso
       AND ${filtro}) AS passou
     ORDER BY similaridade DESC
     WITH count(a) AS janela,
          sum(CASE WHEN acima THEN 1 ELSE 0 END) AS acima_do_piso,
          max(CASE WHEN acima THEN null ELSE similaridade END) AS melhor_abaixo,
          collect(CASE WHEN passou THEN { no: a, similaridade: similaridade } END) AS passaram
     UNWIND (CASE WHEN size(passaram) = 0 THEN [null] ELSE passaram[0..$limite] END) AS p
     WITH janela, acima_do_piso, melhor_abaixo, size(passaram) AS total,
          p.no AS a, p.similaridade AS similaridade${ENTIDADES_DE("a")}
     WITH janela, acima_do_piso, melhor_abaixo, total, a, similaridade,
          collect(DISTINCT s.nome) AS sobre, collect(DISTINCT m.nome) AS cita
     RETURN a.id AS id, a.texto AS texto, a.tipo AS tipo,
            coalesce(a.valido_em, '') AS valido_em, sobre, cita, similaridade,
            total, janela, acima_do_piso, melhor_abaixo, ${ANCORA_DE("a")}
     ORDER BY similaridade DESC`,
          {
            ...parametros,
            k: K_BUSCA,
            piso: PISO_BUSCA,
            vetor: await leitura.vetor(texto),
          },
        );

  const achados = linhas
    .filter((l): l is LinhaDeBusca & { id: string } => typeof l.id === "string" && l.id !== "")
    .map(daLinha);
  const conta = linhas[0];
  const numero = (v: unknown, padrao: number) => (typeof v === "number" ? v : padrao);

  const recorte: RecorteDaBusca = {
    total: numero(conta?.total, achados.length),
    mostrados: achados.length,
    filtrado,
    ...(texto === ""
      ? {}
      : {
          janela: numero(conta?.janela, achados.length),
          acima_do_piso: numero(conta?.acima_do_piso, achados.length),
          melhor_abaixo: typeof conta?.melhor_abaixo === "number" ? conta.melhor_abaixo : null,
          piso: PISO_BUSCA,
        }),
  };

  return { achados, recorte };
}

/**
 * A primeira linha do que a busca devolve ao modelo: quanto achou, quanto
 * mostrou — e, quando voltou vazia, **qual** vazio (slice 9).
 *
 * As três causas pedem gestos opostos, e é por isso que deixaram de ser uma
 * frase só: nada acima do piso pede outra palavra, e alargar o período é
 * inútil; o filtro que cortou pede alargar o período, e outra palavra é
 * inútil; e nada mesmo é a resposta.
 */
export function linhaDoRecorte(r: RecorteDaBusca): string {
  const vetorial = typeof r.janela === "number";
  const com = r.filtrado ? " com esses filtros" : "";

  if (r.mostrados === 0) {
    if (!vetorial || r.janela === 0) {
      return r.filtrado
        ? "nenhum trecho com esses filtros: o diário não tem nada que passe em todos eles."
        : "nenhum trecho no diário.";
    }
    if ((r.acima_do_piso ?? 0) === 0) {
      const melhor = typeof r.melhor_abaixo === "number" ? r.melhor_abaixo.toFixed(2) : "?";
      return (
        `nada passou do piso de similaridade (${(r.piso ?? PISO_BUSCA).toFixed(2)}): ` +
        `o mais parecido dos ${r.janela} ficou em ${melhor}. ` +
        `Outra palavra pode achar; alargar período ou tipo não muda nada.`
      );
    }
    return (
      `o filtro cortou: ${r.acima_do_piso} passaram do piso, e nenhum deles cabe nos filtros. ` +
      `Alargar período ou tipo pode achar; outra palavra, não.`
    );
  }

  if (vetorial) {
    return (
      `mostrando ${r.mostrados} de ${r.total} que passaram do piso${r.filtrado ? " e dos filtros" : ""}, ` +
      `contados entre os ${r.janela} trechos mais parecidos — não no diário inteiro.`
    );
  }
  return r.total > r.mostrados
    ? `mostrando ${r.mostrados} de ${r.total} trechos${com}, os mais recentes primeiro.`
    : `${r.total} ${r.total === 1 ? "trecho — o único" : "trechos — todos os"}${com}.`;
}

/**
 * Os nomes do catálogo que mais parecem com o que o modelo pediu.
 *
 * Existe só para a mensagem de "não achei": devolver a lista inteira gastaria
 * tokens à toa, e devolver nada faria o modelo concluir que a pessoa não está
 * no diário quando o que ele errou foi a grafia.
 */
function vizinhosDeNome(
  nome: string,
  catalogo: readonly { nome: string; chaves: string[] }[],
  quantos = 5,
): string[] {
  return parecidasPorNome(nome, catalogo, quantos).map((e) => e.nome);
}

/** As entradas do catálogo cujas grafias contêm um pedaço do nome, ou vice-versa. */
function parecidasPorNome<T extends { chaves: string[] }>(
  nome: string,
  catalogo: readonly T[],
  quantos = 5,
): T[] {
  const alvo = normalizarNome(nome);
  const pedacos = alvo.split(" ").filter((t) => t.length >= 3);
  return catalogo
    .filter((e) => e.chaves.some((c) => pedacos.some((t) => c.includes(t) || t.includes(c))))
    .slice(0, quantos);
}

// ──────────────────── ferramenta 3: buscar_entidades ────────────────────

/**
 * Quantas fichas uma busca de entidade devolve inteiras.
 *
 * Cinco, e não oito como os átomos: uma ficha é várias linhas — resumo, três
 * campos de perfil, contagens, quem co-ocorre —, e cinco já é mais texto que
 * oito átomos. Na listagem por tipo, as que sobram vão só pelo nome.
 */
export const TETO_ENTIDADES = 5;

/** Quantas entidades co-ocorrentes cada ficha mostra. */
export const TETO_JUNTO = 5;

/**
 * O piso da busca de entidade por `texto`: o mesmo `PISO_PERFIL` da camada 3a
 * da resolução, e não o `PISO_BUSCA`.
 *
 * É a mesma espécie de comparação — texto corrido contra a string canônica
 * curta de uma entidade (`fonteDaEntidade`), assimétrica, que pontua
 * sistematicamente menos que átomo contra átomo. O `PISO_BUSCA` de 0,45 vive
 * no outro espaço. Nenhum dos dois foi medido contra pergunta de chat; o (i)
 * mostra o melhor cortado, como na busca de átomos.
 */
export const PISO_ENTIDADE = PISO_PERFIL;

export interface ResultadoDeEntidades {
  entidades: EntidadeAchada[];
  /** Nomes que casaram por parecença, não por grafia exata. */
  parecidas?: boolean;
  /** Na listagem, os nomes que ficaram de fora do teto. */
  outras?: string[];
  recorte?: RecorteDaBusca;
  aviso?: string;
  /**
   * Uma linha escrita **pelo código**, que vai junto com as fichas — hoje, só a
   * do "eu" (slice 10), dizendo que o retrato completo está em `ler_retrato`.
   * Não pelo `contexto` da ficha: aquele é texto do modelo, e o próximo
   * `retrato-1` editado no painel podia deixar de escrever a frase.
   */
  nota?: string;
}

/** O que `buscar_entidades` diz ao lado da ficha curta do "eu". */
export const NOTA_DO_EU =
  "esta é a ficha curta do dono do diário. O retrato completo dele, por dimensão da vida, está em ler_retrato.";

interface LinhaDeFicha {
  id: string;
  primeira: string | null;
  ultima: string | null;
  junto_com: CoOcorrencia[] | null;
}

/**
 * O que o catálogo não traz: a primeira e a última data, e quem co-ocorre.
 *
 * **Co-ocorrência, e não travessia.** Não há aresta semântica entre duas
 * entidades — `:ENVOLVIDA_EM`, `:CONTRIBUI_PARA` e `:APONTA_PARA` nunca
 * existiram. O que liga uma pessoa a um projeto são os átomos que citam as
 * duas: aqui, os átomos ativos da entidade e quais outras entidades **esses
 * átomos** citam, contadas por átomo.
 *
 * A fusão é atravessada como em `buscar_atomos`: o átomo antigo que ainda
 * aponta para o nó perdedor é da mesma entidade.
 */
async function lerFichas(ids: readonly string[]): Promise<Map<string, LinhaDeFicha>> {
  if (ids.length === 0) return new Map();
  const linhas = await query<LinhaDeFicha>(
    `UNWIND $ids AS id
     MATCH (e:Entidade { id: id })
     OPTIONAL MATCH (f:Entidade)-[:FUNDIDA_EM]->(e)
     WITH id, e, collect(f) + [e] AS nos
     UNWIND nos AS x
     MATCH (a:Atomo)-[:SOBRE|:MENCIONA]->(x)
     WHERE coalesce(a.status, 'ativo') = 'ativo'
     WITH id, e, collect(DISTINCT a) AS atomos
     WITH id, e, atomos,
          [d IN [a IN atomos | ${diaEmCypher("a.valido_em")}] WHERE d IS NOT NULL] AS datas
     UNWIND atomos AS a
     OPTIONAL MATCH (a)-[:SOBRE|:MENCIONA]->(o:Entidade)
     WHERE o <> e AND NOT (o)-[:FUNDIDA_EM]->(e) AND toLower(coalesce(o.nome, '')) <> 'eu'
     WITH id, datas, o, count(DISTINCT a) AS vezes
     ORDER BY vezes DESC, o.nome
     WITH id, datas,
          collect(CASE WHEN o IS NULL THEN null ELSE { nome: o.nome, vezes: vezes } END) AS junto
     RETURN id,
            reduce(m = '', d IN datas | CASE WHEN m = '' OR d < m THEN d ELSE m END) AS primeira,
            reduce(m = '', d IN datas | CASE WHEN d > m THEN d ELSE m END) AS ultima,
            junto[0..$teto] AS junto_com`,
    { ids: [...ids], teto: TETO_JUNTO },
  );
  return new Map(linhas.map((l) => [l.id, l]));
}

const paraAchada = (
  e: EntidadeDoGrafo,
  ficha: LinhaDeFicha | undefined,
  similaridade?: number,
): EntidadeAchada => ({
  id: e.id,
  nome: e.nome,
  tipo: e.tipo,
  aliases: e.aliases,
  resumo: e.resumo,
  perfil: e.perfil,
  atomos: e.atomos,
  sessoes: e.sessoes,
  primeira: ficha?.primeira ?? "",
  ultima: ficha?.ultima ?? "",
  junto_com: (ficha?.junto_com ?? []).filter(
    (j): j is CoOcorrencia => typeof j?.nome === "string" && typeof j?.vezes === "number",
  ),
  ...(typeof similaridade === "number" ? { similaridade } : {}),
});

/**
 * A ferramenta 3, por dentro (slice 9): a ficha de uma entidade, que até aqui
 * era ilegível para o chat.
 *
 * **Três caminhos, na ordem em que se decidem:**
 *
 * - `nome` — pela grafia exata no catálogo (alias incluído, como em
 *   `buscar_atomos`); sem ela, pelas grafias parecidas, e a resposta diz que
 *   foram parecidas;
 * - `texto` — por sentido, sobre `entidade_embedding` (migration 006): o vetor
 *   é da string canônica — nome, tipo, grafias e os três campos de perfil —, e
 *   por isso "quem pode me ajudar com X" só acha quem tem `pode_ajudar_com`
 *   escrito;
 * - nenhum dos dois — a listagem, as mais faladas primeiro. É o que responde
 *   "quais são meus projetos".
 *
 * `tipo` filtra os três. O catálogo vem de `leitura`, então buscar entidade e
 * depois buscar átomo por ela na mesma pergunta lê o catálogo uma vez só.
 *
 * **Vale o que a ficha tem dentro.** Em 23/09, 2 das 51 entidades tinham
 * resumo. Ficha vazia faz esta ferramenta devolver casca — nome, contagens e
 * quem co-ocorre —, e o conserto disso é rodar o lote de enriquecimento em
 * `/entidades`, não mexer aqui.
 */
export async function buscarEntidades(
  p: BuscaDeEntidades,
  leitura: LeituraDaPergunta = leituraDaPergunta(),
): Promise<ResultadoDeEntidades> {
  const nome = typeof p.nome === "string" ? p.nome.trim() : "";
  const texto = typeof p.texto === "string" ? p.texto.trim() : "";
  const tipo = tipoDeEntidade(p.tipo);
  const doTipo = (e: EntidadeDoGrafo) => tipo === null || e.tipo === tipo;

  const catalogo = await leitura.catalogo();

  if (nome !== "") {
    const exata = acharPorChave(normalizarNome(nome), catalogo);
    if (exata && doTipo(exata)) {
      const fichas = await lerFichas([exata.id]);
      return {
        entidades: [paraAchada(exata, fichas.get(exata.id))],
        ...(exata.nome_normalizado === CHAVE_EU ? { nota: NOTA_DO_EU } : {}),
      };
    }
    const parecidas = parecidasPorNome(nome, catalogo.filter(doTipo), TETO_ENTIDADES);
    if (parecidas.length === 0) {
      return {
        entidades: [],
        aviso: `nenhuma entidade${tipo ? ` do tipo ${ROTULO_TIPO_ENTIDADE[tipo]}` : ""} se chama "${nome}", nem nada parecido. Tente outra grafia, ou buscar_atomos com o texto.`,
      };
    }
    const fichas = await lerFichas(parecidas.map((e) => e.id));
    return {
      entidades: parecidas.map((e) => paraAchada(e, fichas.get(e.id))),
      parecidas: true,
    };
  }

  if (texto !== "") {
    const linhas = await query<{ id: string; similaridade: number }>(
      `CALL db.index.vector.queryNodes('entidade_embedding', $k, $vetor) YIELD node, score
       WITH node AS e, 2 * score - 1 AS similaridade
       OPTIONAL MATCH (e)-[:FUNDIDA_EM]->(vencedor:Entidade)
       WITH coalesce(vencedor, e) AS alvo, max(similaridade) AS similaridade
       RETURN alvo.id AS id, similaridade
       ORDER BY similaridade DESC`,
      { k: K_BUSCA, vetor: await leitura.vetor(texto) },
    );
    const porId = new Map(catalogo.map((e) => [e.id, e]));
    const acima = linhas.filter((l) => l.similaridade >= PISO_ENTIDADE);
    const abaixo = linhas.filter((l) => l.similaridade < PISO_ENTIDADE);
    const passaram = acima
      .map((l) => ({ e: porId.get(l.id), similaridade: l.similaridade }))
      .filter((x): x is { e: EntidadeDoGrafo; similaridade: number } => !!x.e && doTipo(x.e));
    const mostradas = passaram.slice(0, TETO_ENTIDADES);
    const fichas = await lerFichas(mostradas.map((x) => x.e.id));
    return {
      entidades: mostradas.map((x) => paraAchada(x.e, fichas.get(x.e.id), x.similaridade)),
      recorte: {
        total: passaram.length,
        mostrados: mostradas.length,
        filtrado: tipo !== null,
        janela: linhas.length,
        acima_do_piso: acima.length,
        melhor_abaixo: abaixo.length > 0 ? abaixo[0].similaridade : null,
        piso: PISO_ENTIDADE,
      },
    };
  }

  // A listagem. "eu" fica de fora: é sujeito de quase todo átomo, e encabeçaria
  // qualquer lista das mais faladas sem dizer nada que o prompt já não diga.
  const lista = catalogo.filter((e) => doTipo(e) && e.nome_normalizado !== "eu");
  const mostradas = lista.slice(0, TETO_ENTIDADES);
  const fichas = await lerFichas(mostradas.map((e) => e.id));
  return {
    entidades: mostradas.map((e) => paraAchada(e, fichas.get(e.id))),
    outras: lista.slice(TETO_ENTIDADES).map((e) => e.nome),
    recorte: { total: lista.length, mostrados: mostradas.length, filtrado: tipo !== null },
  };
}

/** Uma ficha, do jeito que ela entra no prompt de volta ao modelo. */
export function textoDaFicha(e: EntidadeAchada): string {
  const marcas = [
    ROTULO_TIPO_ENTIDADE[e.tipo],
    ...(typeof e.similaridade === "number" ? [`similaridade ${e.similaridade.toFixed(2)}`] : []),
  ];
  const linhas = [`${e.nome} (${marcas.join(", ")})`];
  if (e.aliases.length > 0) linhas.push(`  também escrito: ${e.aliases.join(", ")}`);

  const campos: [string, string][] = [
    ["resumo", e.resumo],
    ["contexto", e.perfil.contexto],
    ["pode ajudar com", e.perfil.pode_ajudar_com],
    ["fizemos juntos", e.perfil.fizemos_juntos],
  ];
  const escritos = campos.filter(([, v]) => v !== "");
  if (escritos.length === 0) {
    // Dito, e não omitido: sem esta linha o modelo leria a ausência como "não
    // há nada a saber", quando o que há é ficha que ninguém escreveu.
    linhas.push("  ficha vazia: nada escrito sobre ela ainda — o que se sabe está nos trechos.");
  } else {
    for (const [rotulo, valor] of escritos) linhas.push(`  ${rotulo}: ${valor}`);
  }

  const periodo =
    e.primeira === ""
      ? ""
      : e.primeira === e.ultima
        ? `, em ${e.primeira}`
        : `, de ${e.primeira} a ${e.ultima}`;
  linhas.push(`  ${e.atomos} trecho(s) em ${e.sessoes} sessão(ões)${periodo}`);
  if (e.junto_com.length > 0) {
    linhas.push(`  aparece junto com: ${e.junto_com.map((j) => `${j.nome} (${j.vezes})`).join(", ")}`);
  }
  return linhas.join("\n");
}

/** O que `buscar_entidades` devolve ao modelo, com o recorte em cima. */
export function respostaDasEntidades(r: ResultadoDeEntidades): string {
  if (r.aviso) return r.aviso;

  const c = r.recorte;
  let topo: string | null = null;
  if (r.parecidas) {
    topo = "nenhuma se chama exatamente assim; estas são as de nome parecido:";
  } else if (c && typeof c.janela === "number") {
    if (c.mostrados === 0) {
      topo =
        (c.acima_do_piso ?? 0) === 0
          ? `nenhuma ficha passou do piso (${(c.piso ?? PISO_ENTIDADE).toFixed(2)}): a mais parecida ficou em ${typeof c.melhor_abaixo === "number" ? c.melhor_abaixo.toFixed(2) : "?"}. A maioria das fichas ainda não tem perfil escrito — procure nos trechos com buscar_atomos.`
          : `${c.acima_do_piso} fichas passaram do piso, e nenhuma é do tipo pedido.`;
    } else {
      topo = `mostrando ${c.mostrados} de ${c.total} fichas que passaram do piso${c.filtrado ? " e do tipo" : ""}.`;
    }
  } else if (c) {
    topo =
      c.total === 0
        ? "nenhuma entidade desse tipo no grafo."
        : c.total > c.mostrados
          ? `mostrando ${c.mostrados} de ${c.total}, as mais faladas primeiro. As outras: ${(r.outras ?? []).join(", ")}.`
          : `${c.total} no grafo, todas abaixo.`;
  }

  const fichas = r.entidades.map(textoDaFicha).join("\n\n");
  return (
    [topo, fichas, r.nota ?? null].filter((s) => s !== null && s !== "").join("\n\n") ||
    "nenhuma entidade encontrada."
  );
}

/**
 * O tipo que o modelo mandou, se for um dos quatro. "organização", "Organizacao"
 * e "projetos" não casam por igual — o acento e a caixa sim, o plural não:
 * tipo inventado é ignorado, não erra, como em `tiposValidos`.
 */
export function tipoDeEntidade(v: unknown): TipoEntidade | null {
  if (typeof v !== "string") return null;
  const alvo = normalizarNome(v);
  return TIPOS_ENTIDADE.find((t) => normalizarNome(t) === alvo) ?? null;
}

/** A ficha cortada para o rastro: o (i) mostra um retrato, não o perfil inteiro. */
const fichaParaRastro = (e: EntidadeAchada): EntidadeAchada => {
  const corta = (s: string) => (s.length > TRECHO_NO_RASTRO ? `${s.slice(0, TRECHO_NO_RASTRO)}…` : s);
  return {
    ...e,
    resumo: corta(e.resumo),
    perfil: {
      contexto: corta(e.perfil.contexto),
      pode_ajudar_com: corta(e.perfil.pode_ajudar_com),
      fizemos_juntos: corta(e.perfil.fizemos_juntos),
    },
  };
};

/** Os parâmetros de fato usados em `buscar_entidades`, para o (i). */
export function parametrosDeEntidade(p: BuscaDeEntidades): Record<string, unknown> {
  const limpos: Record<string, unknown> = {};
  const nome = typeof p.nome === "string" ? p.nome.trim() : "";
  const texto = typeof p.texto === "string" ? p.texto.trim() : "";
  const tipo = tipoDeEntidade(p.tipo);
  if (nome !== "") limpos.nome = nome;
  if (texto !== "") limpos.texto = texto;
  if (tipo !== null) limpos.tipo = tipo;
  return limpos;
}

// ──────────────────── ferramenta 4: ler_retrato ────────────────────

/** Quanto do texto de cada fonte entra na resposta de `ler_retrato`. */
export const TRECHO_DA_FONTE = 160;

export interface ResultadoDoRetrato {
  /** O que vai ao modelo. */
  resposta: string;
  /** O que vai ao (i). */
  leitura: LeituraDoRetrato;
  /** As fontes da seção, já cortadas — o (i) as mostra como achados. */
  fontes: AtomoAchado[];
  /** Retrato não escrito, seção vazia, dimensão que não existe. */
  aviso?: string;
}

const ate = (iso: string) => {
  const mes = mesAno(diaLocal(iso));
  return mes === "" ? "" : ` (até ${mes})`;
};

/**
 * A ferramenta 4, por dentro (slice 10): o retrato do "eu", **uma dimensão por
 * vez**. É isto que "consultas segregadas" quer dizer — o chat lê a lista,
 * escolhe a dimensão, e só ela entra no contexto.
 *
 * - sem `dimensao` → o Agora, e a lista de dimensões com o `o_que_entra`;
 * - com `dimensao` → só aquela seção, e as fontes (id, data, trecho curto). O id
 *   vai para o chat poder seguir por `consultar_grafo`.
 *
 * `dimensao` casa pelo id **ou** pelo nome normalizado: o modelo lê os dois na
 * lista e pode devolver qualquer um. Seção de dimensão que saiu da lista não é
 * alcançável, como na tela.
 */
export async function lerRetratoDoEu(dimensao?: unknown): Promise<ResultadoDoRetrato> {
  const pedido = typeof dimensao === "string" ? dimensao.trim() : "";
  const [retrato, config] = await Promise.all([lerRetrato(), lerConfigRetrato()]);

  if (!retrato) {
    const aviso =
      "o retrato do dono do diário ainda não foi escrito. Siga por buscar_atomos — os trechos estão lá.";
    return { resposta: aviso, aviso, fontes: [], leitura: { dimensao: pedido || null, nome: "", texto: "", ate: "" } };
  }

  const querAgora = pedido === "" || normalizarNome(pedido) === ID_AGORA;
  if (querAgora) {
    const s = retrato.secoes[ID_AGORA];
    const lista = config.dimensoes.map(
      (d) =>
        `- ${d.id} — ${d.nome}: ${d.o_que_entra}${(retrato.secoes[d.id]?.texto ?? "") === "" ? " (vazia)" : ""}`,
    );
    const aviso = !s || s.texto === "" ? "a seção Agora está vazia." : undefined;
    const partes = [
      `AGORA${ate(s?.ate ?? "")}:\n${s?.texto || "(vazia)"}`,
      lista.length === 0
        ? "Nenhuma dimensão aprovada ainda: o retrato só tem o Agora. Para o resto, buscar_atomos."
        : `DIMENSÕES — peça uma com ler_retrato(dimensao):\n${lista.join("\n")}`,
    ];
    return {
      resposta: partes.join("\n\n"),
      fontes: [],
      ...(aviso ? { aviso } : {}),
      leitura: {
        dimensao: null,
        nome: "Agora",
        texto: corta(s?.texto ?? ""),
        ate: s?.ate ?? "",
        dimensoes: config.dimensoes.map((d) => d.nome),
      },
    };
  }

  const alvo = normalizarNome(pedido);
  const d = config.dimensoes.find((x) => x.id === pedido || normalizarNome(x.nome) === alvo);
  if (!d) {
    const aviso = `não existe dimensão "${pedido}". As que existem: ${config.dimensoes.map((x) => `${x.id} (${x.nome})`).join(", ") || "nenhuma — só o Agora"}.`;
    return { resposta: aviso, aviso, fontes: [], leitura: { dimensao: pedido, nome: "", texto: "", ate: "" } };
  }

  const s = retrato.secoes[d.id];
  if (!s || s.texto === "") {
    const aviso = !s
      ? `a seção "${d.nome}" ainda não foi escrita — a dimensão é nova. Siga por buscar_atomos.`
      : `a seção "${d.nome}" está vazia: a última rodada não achou material para ela. Siga por buscar_atomos.`;
    return { resposta: aviso, aviso, fontes: [], leitura: { dimensao: d.id, nome: d.nome, texto: "", ate: s?.ate ?? "" } };
  }

  const lidas = await lerFontes(s.fontes);
  const fontes = lidas.map(
    (f): AtomoAchado => ({
      id: f.id,
      texto: f.texto.length > TRECHO_DA_FONTE ? `${f.texto.slice(0, TRECHO_DA_FONTE)}…` : f.texto,
      tipo: f.tipo,
      valido_em: f.valido_em,
      sobre: [],
      cita: [],
      ...ancoraDe(f),
    }),
  );
  // O átomo que saiu depois continua na lista, dito: ele sustentou a seção
  // quando ela foi escrita, e o chat não pode citá-lo como se valesse hoje.
  const linhas = fontes.map(
    (f, i) => `${linhaDeAtomo(f)}${lidas[i].status === "ativo" ? "" : ` (${lidas[i].status} depois)`}`,
  );

  return {
    resposta: [
      `${d.nome.toUpperCase()}${ate(s.ate)}:\n${s.texto}`,
      linhas.length === 0 ? "" : `FONTES (os trechos principais que sustentaram a seção):\n${linhas.join("\n")}`,
    ]
      .filter((p) => p !== "")
      .join("\n\n"),
    fontes,
    leitura: { dimensao: d.id, nome: d.nome, texto: corta(s.texto), ate: s.ate },
  };
}

/** O texto da seção cortado para o rastro do (i). */
const corta = (t: string) => (t.length > TRECHO_NO_RASTRO ? `${t.slice(0, TRECHO_NO_RASTRO)}…` : t);

// ──────────────────────── o loop ────────────────────────

/** Um átomo, do jeito que ele entra no prompt de volta ao modelo. */
export function linhaDeAtomo(a: AtomoAchado): string {
  const quando = diaLocal(a.valido_em) || "sem data";
  const quem = [
    ...(a.sobre.length > 0 ? [`sobre: ${a.sobre.join(", ")}`] : []),
    ...(a.cita.length > 0 ? [`cita: ${a.cita.join(", ")}`] : []),
  ];
  return `[id ${a.id} · ${a.tipo} · ${quando}${quem.length > 0 ? ` · ${quem.join(" · ")}` : ""}] ${a.texto}`;
}

/**
 * O que a ferramenta devolve ao modelo, em texto.
 *
 * Texto e não JSON, de propósito: o modelo vai **ler** isto para escrever prosa,
 * e o id precisa estar visível em cada linha para ele poder pedir o texto inteiro
 * ou a cadeia do trecho por `consultar_grafo` em seguida. Um envelope JSON gastaria tokens em chaves
 * que ninguém usa.
 */
/**
 * Uma linha de átomo, ou a lembrança dela — se `vistos` disser que o modelo já
 * a leu neste turno.
 *
 * **Colapsar, e não omitir.** Um átomo que duas buscas alcançam é informação: a
 * segunda busca *de fato* o achou, e sumir com ele faria o modelo ler a segunda
 * como mais pobre do que foi — e buscar de novo, que é justamente o que o teto
 * de oito chamadas não tem para gastar. O que sai é só o texto, que ele já leu
 * inteiro alguns milhares de tokens acima.
 *
 * Sem `vistos` nada colapsa: é o caminho de quem chama a função para conferir
 * uma busca isolada.
 */
function umaVezSo(a: AtomoAchado, vistos?: Set<string>): string {
  if (!vistos) return linhaDeAtomo(a);
  if (vistos.has(a.id)) return `[id ${a.id}] já mostrado acima`;
  vistos.add(a.id);
  return linhaDeAtomo(a);
}

/**
 * A busca como o modelo a lê: a linha do recorte em cima, os átomos embaixo.
 *
 * O recorte vai **antes** de propósito — é o número que o `chat-4` manda usar
 * quando disser que recorte usou, e é a frase que diz de que vazio se trata.
 */
export function respostaDaBusca(r: ResultadoDeBusca, vistos?: Set<string>): string {
  if (r.aviso) return r.aviso;
  const topo = r.recorte ? linhaDoRecorte(r.recorte) : null;
  if (r.achados.length === 0) return topo ?? "nenhum trecho encontrado.";
  const trechos = r.achados.map((a) => umaVezSo(a, vistos)).join("\n");
  return topo ? `${topo}\n${trechos}` : trechos;
}

/** O átomo cortado para o rastro: o (i) mostra uma linha, não o átomo inteiro. */
const paraRastro = (a: AtomoAchado): AtomoAchado => ({
  ...a,
  texto: a.texto.length > TRECHO_NO_RASTRO ? `${a.texto.slice(0, TRECHO_NO_RASTRO)}…` : a.texto,
});

/** Os parâmetros de fato usados, sem os vazios — é o que o (i) mostra. */
export function parametrosLimpos(p: BuscaDeAtomos): Record<string, unknown> {
  const limpos: Record<string, unknown> = {};
  const texto = typeof p.texto === "string" ? p.texto.trim() : "";
  const entidade = typeof p.entidade === "string" ? p.entidade.trim() : "";
  const tipos = tiposValidos(p.tipo);
  const desde = dataSimples(p.desde);
  const ate = dataSimples(p.ate);
  if (texto !== "") limpos.texto = texto;
  if (entidade !== "") limpos.entidade = entidade;
  if (tipos.length > 0) limpos.tipo = tipos;
  if (desde !== "") limpos.desde = desde;
  if (ate !== "") limpos.ate = ate;
  return limpos;
}

const ESQUEMA_BUSCA = jsonSchema<BuscaDeAtomos>({
  type: "object",
  properties: {
    texto: {
      type: "string",
      description:
        "busca por sentido no texto dos trechos. Escreva a ideia procurada, não a pergunta inteira.",
    },
    entidade: {
      type: "string",
      description:
        "nome de uma pessoa, projeto, objetivo ou organização. Apelido e grafia errada resolvem para o mesmo nó.",
    },
    tipo: {
      type: "array",
      items: { type: "string", enum: [...TIPOS_ATOMO] },
      description: "um ou mais tipos; eles se somam com OU.",
    },
    desde: { type: "string", description: "data AAAA-MM-DD, inclusive." },
    ate: { type: "string", description: "data AAAA-MM-DD, inclusive." },
  },
});

const ESQUEMA_ENTIDADES = jsonSchema<BuscaDeEntidades>({
  type: "object",
  properties: {
    nome: {
      type: "string",
      description: "nome, apelido ou grafia errada. Sem casamento exato, devolve as de nome parecido.",
    },
    texto: {
      type: "string",
      description:
        "busca por sentido na ficha — o que a pessoa faz, com o que pode ajudar. Escreva a ideia, não a pergunta.",
    },
    tipo: { type: "string", enum: [...TIPOS_ENTIDADE] },
  },
});

const ESQUEMA_RETRATO = jsonSchema<{ dimensao?: string }>({
  type: "object",
  properties: {
    dimensao: {
      type: "string",
      description:
        "o id ou o nome de uma dimensão, como aparecem na lista que ler_retrato devolve sem parâmetro. Sem ele: o Agora e a lista.",
    },
  },
});

/** O que `consultar_grafo` aceita. */
export interface PedidoDeConsulta {
  cypher: string;
  texto?: string;
}

const ESQUEMA_CONSULTA = jsonSchema<PedidoDeConsulta>({
  type: "object",
  properties: {
    cypher: {
      type: "string",
      description:
        "a consulta, uma só, sem EXPLAIN e sem ponto e vírgula. Projete só as colunas que vai ler — nunca o nó inteiro — e agregue no banco.",
    },
    texto: {
      type: "string",
      description:
        "as palavras de uma busca por sentido: viram $vetor. Só quando a consulta usa $vetor. Escreva a ideia, não a pergunta.",
    },
  },
  required: ["cypher"],
});

/**
 * A consulta como o (i) a guarda. Nasce também quando a ferramenta estoura antes
 * de o banco responder — a Cypher que o modelo escreveu é o que eu preciso ver
 * para entender o erro.
 */
const consultaParaRastro = (
  cypher: string,
  texto: string,
  r?: Awaited<ReturnType<typeof consultar>>,
): ConsultaNoRastro => ({
  cypher,
  ...(texto !== "" ? { texto } : {}),
  colunas: r?.colunas ?? [],
  linhas: r?.linhas ?? [],
  total: r?.total ?? 0,
  cortado: r?.cortado ?? false,
  ...(r && r.avisos.length > 0 ? { avisos: r.avisos } : {}),
});

export interface OpcoesResposta {
  /** Chamado assim que uma ferramenta termina — é o progresso na tela. */
  aoPasso?: (passo: PassoDeFerramenta) => void;
  /** O "parar" da tela. Aborta a chamada em curso e nada é gravado. */
  sinal?: AbortSignal;
  agora?: Date;
  /**
   * Um modelo dado direto, com o prompt **da base**, sem ler o painel. É a
   * comparação de modelos (`scripts/comparar-chat.ts`): ela mede a base do git
   * contra modelos que eu ainda não escolhi, e um override salvo no painel
   * misturaria as duas coisas — o mesmo desenho do confronto.
   */
  modelo?: string;
}

/** O que as chamadas de uma resposta gastaram; `null` quando o provedor não disse. */
export interface UsoDeTokens {
  entrada: number | null;
  saida: number | null;
  raciocinio: number | null;
}

export interface Resposta {
  texto: string;
  rastro: PassoDeFerramenta[];
  modelo: string;
  prompt_version: string;
  /**
   * A soma do loop inteiro e da síntese, quando houve. Serve à comparação de
   * modelos; a rota não o grava na mensagem.
   */
  uso: UsoDeTokens;
}

type ComUso = {
  totalUsage?: {
    inputTokens?: number;
    outputTokens?: number;
    outputTokenDetails?: { reasoningTokens?: number };
  };
};

/** O uso somado de várias chamadas. Um número que nenhuma informou continua `null`. */
export function somarUso(chamadas: readonly ComUso[]): UsoDeTokens {
  const soma = (pegar: (u: NonNullable<ComUso["totalUsage"]>) => number | undefined) => {
    const ns = chamadas
      .map((c) => (c.totalUsage ? pegar(c.totalUsage) : undefined))
      .filter((n): n is number => typeof n === "number");
    return ns.length === 0 ? null : ns.reduce((a, b) => a + b, 0);
  };
  return {
    entrada: soma((u) => u.inputTokens),
    saida: soma((u) => u.outputTokens),
    raciocinio: soma((u) => u.outputTokenDetails?.reasoningTokens),
  };
}

/**
 * As ferramentas, prontas para o SDK.
 *
 * **Elas nunca propagam erro.** Ferramenta que estoura derruba o loop inteiro e
 * a pergunta fica sem resposta; ferramenta que devolve "não consegui" deixa o
 * modelo tentar outro caminho — que é o que uma pessoa faria. O erro vai para o
 * rastro do (i) do mesmo jeito, então nada fica escondido.
 *
 * **`vistos` é a memória do turno**, e ela é de quem monta as ferramentas, não
 * de dentro delas: o conjunto atravessa as duas (um átomo que a busca já
 * mostrou não volta inteiro no histórico, e vice-versa) e morre junto com a
 * tentativa. Quem o cria é `responder`, pelo mesmo motivo que zera o rastro.
 * `consultar_grafo` não o usa: as colunas são do modelo, e uma linha não é um
 * átomo.
 *
 * `agora` é o relógio de `$hoje` — o mesmo do "Hoje é" do sistema.
 */
export function ferramentas(
  aoPasso?: (p: PassoDeFerramenta) => void,
  vistos?: Set<string>,
  leitura: LeituraDaPergunta = leituraDaPergunta(),
  agora: Date = new Date(),
) {
  const anunciar = (p: PassoDeFerramenta) => {
    try {
      aoPasso?.(p);
    } catch (e) {
      // O progresso é enfeite: ninguém perde uma resposta porque a tela caiu.
      console.error("[chat] falha ao anunciar o passo:", e);
    }
  };

  return {
    buscar_atomos: tool({
      description:
        "Procura trechos do diário. Todos os parâmetros são opcionais e se combinam; sem nenhum, devolve os mais recentes.",
      inputSchema: ESQUEMA_BUSCA,
      execute: async (entrada: BuscaDeAtomos) => {
        const parametros = parametrosLimpos(entrada ?? {});
        const inicio = Date.now();
        try {
          const r = await buscarAtomos(entrada ?? {}, leitura);
          anunciar({
            ferramenta: "buscar_atomos",
            parametros,
            achados: r.achados.map(paraRastro),
            ...(r.recorte ? { recorte: r.recorte } : {}),
            duracao_ms: Date.now() - inicio,
            ...(r.aviso ? { erro: r.aviso } : {}),
          });
          return respostaDaBusca(r, vistos);
        } catch (e) {
          const erro = e instanceof Error ? e.message : String(e);
          console.error("[chat] buscar_atomos falhou:", e);
          anunciar({
            ferramenta: "buscar_atomos",
            parametros,
            achados: [],
            duracao_ms: Date.now() - inicio,
            erro,
          });
          return `a busca falhou: ${erro}`;
        }
      },
    }),

    buscar_entidades: tool({
      description:
        "Procura a ficha de pessoas, projetos, objetivos e organizações: quem é, o que pode ajudar, o que fizemos juntos, quantos trechos, e com quem mais aparece. Sem parâmetro, lista as mais faladas.",
      inputSchema: ESQUEMA_ENTIDADES,
      execute: async (entrada: BuscaDeEntidades) => {
        const parametros = parametrosDeEntidade(entrada ?? {});
        const inicio = Date.now();
        try {
          const r = await buscarEntidades(entrada ?? {}, leitura);
          anunciar({
            ferramenta: "buscar_entidades",
            parametros,
            achados: [],
            entidades: r.entidades.map(fichaParaRastro),
            ...(r.recorte ? { recorte: r.recorte } : {}),
            duracao_ms: Date.now() - inicio,
            ...(r.aviso ? { erro: r.aviso } : {}),
          });
          return respostaDasEntidades(r);
        } catch (e) {
          const erro = e instanceof Error ? e.message : String(e);
          console.error("[chat] buscar_entidades falhou:", e);
          anunciar({
            ferramenta: "buscar_entidades",
            parametros,
            achados: [],
            duracao_ms: Date.now() - inicio,
            erro,
          });
          return `a busca falhou: ${erro}`;
        }
      },
    }),

    ler_retrato: tool({
      description:
        "Lê o retrato do dono do diário, uma seção por vez. Sem parâmetro: o Agora e a lista de dimensões da vida dele. Com dimensao: só aquela seção, e os trechos que a sustentaram.",
      inputSchema: ESQUEMA_RETRATO,
      execute: async (entrada: { dimensao?: string }) => {
        const dimensao = typeof entrada?.dimensao === "string" ? entrada.dimensao.trim() : "";
        const parametros = dimensao === "" ? {} : { dimensao };
        const inicio = Date.now();
        try {
          const r = await lerRetratoDoEu(dimensao);
          anunciar({
            ferramenta: "ler_retrato",
            parametros,
            achados: r.fontes.map(paraRastro),
            retrato: r.leitura,
            duracao_ms: Date.now() - inicio,
            ...(r.aviso ? { erro: r.aviso } : {}),
          });
          for (const f of r.fontes) vistos?.add(f.id);
          return r.resposta;
        } catch (e) {
          const erro = e instanceof Error ? e.message : String(e);
          console.error("[chat] ler_retrato falhou:", e);
          anunciar({
            ferramenta: "ler_retrato",
            parametros,
            achados: [],
            duracao_ms: Date.now() - inicio,
            erro,
          });
          return `a leitura do retrato falhou: ${erro}. Siga por buscar_atomos.`;
        }
      },
    }),

    consultar_grafo: tool({
      description:
        "Roda uma consulta Cypher só de leitura no grafo do diário e devolve as linhas numa tabela. É a que conta, ordena, compara períodos e anda pelo grafo. $hoje é a data de hoje (AAAA-MM-DD); com texto, $vetor é o vetor dele, para a cláusula SEARCH no índice atomo_embedding. Escrita, CALL de procedure, LOAD CSV e :Conversa são recusados antes de rodar. A saída tem teto: conte e agregue no banco em vez de trazer tudo.",
      inputSchema: ESQUEMA_CONSULTA,
      execute: async (entrada: PedidoDeConsulta) => {
        const cypher = typeof entrada?.cypher === "string" ? entrada.cypher.trim() : "";
        // `texto` sem `$vetor` na consulta não vira chamada de embedding: o
        // modelo pediu um vetor que não ia usar.
        const pedido = typeof entrada?.texto === "string" ? entrada.texto.trim() : "";
        const texto = pedido !== "" && usaParametro(cypher, "vetor") ? pedido : "";
        const parametros = texto === "" ? {} : { texto };
        const inicio = Date.now();
        try {
          const valores: Record<string, unknown> = { hoje: hojeLocal(agora) };
          if (texto !== "") valores.vetor = await leitura.vetor(texto);
          const r = await consultar(cypher, valores);
          anunciar({
            ferramenta: "consultar_grafo",
            parametros,
            achados: [],
            consulta: consultaParaRastro(cypher, texto, r),
            duracao_ms: Date.now() - inicio,
            ...(r.erro ? { erro: r.erro } : {}),
          });
          return r.texto;
        } catch (e) {
          const erro = e instanceof Error ? e.message : String(e);
          console.error("[chat] consultar_grafo falhou:", e);
          anunciar({
            ferramenta: "consultar_grafo",
            parametros,
            achados: [],
            consulta: consultaParaRastro(cypher, texto),
            duracao_ms: Date.now() - inicio,
            erro,
          });
          return `a consulta falhou: ${erro}`;
        }
      },
    }),
  };
}

/**
 * O texto que responde, ou "".
 *
 * **Quem parou pedindo ferramenta ainda não respondeu**: o que ele escreveu ou
 * pensou ali é o plano da próxima busca, e não a resposta. Ler o pensamento
 * nesse caso punha na tela "let me fetch the full texts…". Vale para o loop que
 * bate no teto e para a síntese — o `deepseek-v4.1-flash` pede ferramenta
 * mesmo com `toolChoice: "none"`.
 */
const respostaDe = (r: Parameters<typeof textoDaResposta>[0] & { finishReason?: string }) =>
  r.finishReason === "tool-calls" ? "" : textoDaResposta(r).trim();

/** Quantas chamadas de ferramenta já saíram. É o que o teto conta. */
export const chamadasFeitas = (
  passos: readonly { toolCalls?: readonly unknown[] }[],
): number => passos.reduce((n, p) => n + (p.toolCalls?.length ?? 0), 0);

/**
 * A conversa como o modelo a recebe.
 *
 * **O rastro das respostas antigas não volta.** Ele fica na mensagem, para o
 * (i), mas não entra no prompt: replicar as chamadas de ferramenta de todos os
 * turnos anteriores encheria o contexto de material que já virou prosa. O que o
 * modelo relê de um turno passado é a resposta que ele escreveu — que é também
 * o que eu li.
 */
export const paraOModelo = (m: Mensagem) =>
  ({ role: m.papel === "eu" ? "user" : "assistant", content: m.texto }) as const;

/**
 * A resposta a uma pergunta, com o rastro do que foi consultado.
 *
 * `historico` termina na pergunta nova. Nada é gravado aqui — quem grava é
 * `conversas.ts`.
 *
 * **A síntese pode custar uma segunda chamada.** Quando o loop para no teto de
 * `TETO_FERRAMENTAS`, ele para *em cima de um resultado de ferramenta*: o
 * modelo ainda não escreveu nada. A segunda chamada vai com o mesmo histórico e
 * `toolChoice: "none"` — ou seja, "agora responda com o que você tem". Sem ela,
 * a pergunta mais composta do sistema seria justamente a que volta vazia.
 */
export async function responder(
  historico: readonly Mensagem[],
  opcoes: OpcoesResposta = {},
): Promise<Resposta> {
  garantirGateway();
  const { aoPasso, sinal, agora = new Date() } = opcoes;

  const meu =
    opcoes.modelo !== undefined
      ? { prompt: INSTRUCOES, modelo: opcoes.modelo, hash: null }
      : await efetivo("chat", { prompt: INSTRUCOES, modelo: modeloChat() });
  const system = montarSistema(meu.prompt, agora);
  const messages = historico.map(paraOModelo);

  // O rastro definitivo sai dos `steps` no fim, e não do `aoPasso`: se
  // `comEsperaDeLimite` repetir a chamada inteira por rate limit, as
  // ferramentas rodam de novo e o `aoPasso` anunciaria os dois conjuntos.
  const rastro: PassoDeFerramenta[] = [];

  // Fora do laço, ao contrário do rastro e dos vistos: o grafo não muda no meio
  // de uma pergunta, e uma tentativa repetida por rate limit reaproveita o que
  // a perdida já leu.
  const leitura = leituraDaPergunta();

  /**
   * As ferramentas de **uma tentativa** — rastro zerado e memória de vistos
   * nova.
   *
   * Montar por tentativa, e não uma vez fora do laço, é pelo mesmo motivo que o
   * `rastro.length = 0` já existia aqui: `comEsperaDeLimite` repete a chamada
   * inteira por rate limit, e um conjunto de vistos sobrevivente colapsaria, na
   * tentativa boa, exatamente o átomo que só a tentativa perdida mostrou — uma
   * resposta que cita "já mostrado acima" sem nada acima.
   */
  const ferramentasDaTentativa = () => {
    rastro.length = 0;
    return ferramentas(
      (p) => {
        rastro.push(p);
        aoPasso?.(p);
      },
      new Set<string>(),
      leitura,
      agora,
    );
  };

  const comum = {
    model: meu.modelo, // string de propósito: id em string sai pelo Gateway (regra 8)
    system,
    temperature: 0,
    maxRetries: 0,
    ...(sinal ? { abortSignal: sinal } : {}),
  };

  const r = await comEsperaDeLimite(`chat ${meu.modelo}`, () =>
    generateText({
      ...comum,
      tools: ferramentasDaTentativa(),
      messages,
      maxOutputTokens: MAX_TOKENS_SAIDA,
      stopWhen: ({ steps }) => chamadasFeitas(steps) >= TETO_FERRAMENTAS,
    }),
  );

  let texto = respostaDe(r);
  let ultima: { response?: { modelId?: string } } = r;
  const chamadas: ComUso[] = [r];

  if (texto === "") {
    console.warn(
      `[chat] o loop parou sem texto (${chamadasFeitas(r.steps)} chamada(s) de ferramenta); ` +
        `pedindo a síntese.`,
      diagnostico(r),
    );
    const sintese = await comEsperaDeLimite(`chat síntese ${meu.modelo}`, () =>
      generateText({
        ...comum,
        // As definições ainda são necessárias para o SDK reler os resultados de
        // ferramenta que já estão no histórico — mas estas nunca rodam
        // (`toolChoice: "none"`), e por isso não zeram o rastro nem ganham
        // memória de vistos.
        tools: ferramentas(),
        messages: [...messages, ...r.responseMessages],
        toolChoice: "none",
        maxOutputTokens: MAX_TOKENS_SAIDA,
      }),
    );
    texto = respostaDe(sintese);
    ultima = sintese;
    chamadas.push(sintese);
    if (texto !== "" && veioDoPensamento(sintese)) {
      console.warn(`[chat] texto vazio na síntese, lendo o pensamento.`, diagnostico(sintese));
    }
    if (texto === "" && sintese.finishReason === "tool-calls") {
      throw new ChatError(
        `o modelo chegou ao teto de ${TETO_FERRAMENTAS} buscas e, chamado a responder, pediu mais ` +
          `uma em vez de escrever: ${diagnostico(sintese)}`,
      );
    }
    if (faltouOrcamento(sintese) && texto === "") {
      throw new ChatError(
        `o modelo não escreveu resposta nenhuma: ${diagnostico(sintese)}`,
      );
    }
  } else if (veioDoPensamento(r)) {
    console.warn(`[chat] texto vazio, lendo a resposta do pensamento.`, diagnostico(r));
  }

  if (texto === "") throw new ChatError(`o modelo não escreveu resposta nenhuma: ${diagnostico(r)}`);

  return {
    texto,
    rastro,
    modelo: ultima.response?.modelId ?? meu.modelo,
    prompt_version: carimbo(PROMPT_VERSION_CHAT, meu.hash),
    uso: somarUso(chamadas),
  };
}
