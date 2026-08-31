// 004 — Slice 3. Higiene do grafo: entidade ganha estado e as duas arestas que
// registram o que eu decidi sobre pares parecidos.
//
// Esta migration não grava dado nenhum e não converte nó nenhum. Ela declara um
// índice; o resto do contrato abaixo é garantido pelo código que escreve, como
// já vale para :Atomo (002).
//
// Tipo de relação não se declara em Neo4j — as duas abaixo passam a existir com
// a primeira aresta. Ficam aqui em comentário porque db/migrations/ é a
// definição canônica do schema e quem lê este arquivo tem que ver o contrato
// inteiro:
//
//   (:Entidade)-[:FUNDIDA_EM]->(:Entidade)   // do alias para o vencedor
//   (:Entidade)-[:DISTINTA_DE]->(:Entidade)  // recusa minha: não propor de novo
//
// ---------------------------------------------------------------------------
// 1. :Entidade ganha `status`
// ---------------------------------------------------------------------------
//
//   (:Entidade { id, nome, nome_normalizado, criado_em, status })
//   status ∈ 'ativa' | 'fundida'
//
// Fundir NÃO apaga (regra 6). O nó perdedor fica com status 'fundida' e uma
// aresta :FUNDIDA_EM para o vencedor; as arestas :SOBRE e :MENCIONA migram.
//
// O ponto do desenho: como o perdedor mantém o `nome_normalizado` — que é
// constraint única desde a 002 —, a grafia morta nunca renasce como nó novo.
// Dita outra vez numa sessão futura, ela casa com o alias e a resolução segue
// até o vencedor. A fusão é o mecanismo de alias, não um efeito colateral dele.
//
// SEM MIGRAÇÃO DE DADO, de propósito. Os nós criados antes desta migration não
// têm `status`, e o código trata ausência como 'ativa' (coalesce na consulta).
// Preencher agora resolveria os 2 nós de hoje e não resolveria o nó que um
// deploy antigo criasse amanhã — a defesa tem que estar na leitura.

// Índice sobre o estado: toda leitura de entidade filtra por ele — a resolução
// para não casar com alias, o vocabulário para não mandar nome morto ao STT, a
// tela para não listar o que já foi fundido.
CREATE INDEX entidade_status IF NOT EXISTS
FOR (e:Entidade) ON (e.status);
