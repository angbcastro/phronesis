/**
 * Qual das duas fontes cada tela usa.
 *
 * O sistema tem duas naturezas, e elas passaram a ter tipografia própria:
 *
 *   ritual   gravar, esperar processar, revisar — o que eu faço todo dia
 *   gestão   sessões, entidades, transcrição literal, entrar — manutenção
 *
 * A regra é sobre **rota**, e não sobre classe CSS, por um motivo concreto:
 * `Processando` e a `Revisao` ainda carregando renderizam `<main
 * className="leitura">`, a mesma classe da tela de transcrição — que é gestão.
 * Pendurar a fonte na classe daria Nunito à transcrição e trocaria a fonte da
 * revisão no meio do carregamento. A rota não tem essa colisão, e uma tela nova
 * nasce com a fonte certa sem ninguém lembrar de marcá-la.
 *
 * Mesma forma de `mostraMarca` (`Marca.tsx`): função pura, fixada por teste, e
 * o componente só a consulta.
 *
 * Módulo puro e do lado do cliente: não fala com rede, banco nem modelo.
 */

/**
 * As rotas do ritual. `/sessao/:id/transcricao` fica **de fora**: o texto
 * literal é porta de serviço (`ARCHITECTURE.md` §11), não parte do que eu faço
 * todo dia — e é por isso que o `$` dos dois padrões importa. Sem ele,
 * `/sessao/x/transcricao` casaria com o do corredor.
 */
const RITUAL = [/^\/$/, /^\/sessao\/[^/]+$/, /^\/sessao\/[^/]+\/revisar$/];

export const ehRitual = (rota: string | null): boolean =>
  rota !== null && RITUAL.some((r) => r.test(rota));
