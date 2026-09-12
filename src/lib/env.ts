/**
 * Leitura de variáveis de ambiente. Só roda no servidor — nada aqui pode
 * ser importado por componente client (regra inviolável 3).
 */

function req(nome: string): string {
  return exigir(nome, process.env[nome]);
}

/**
 * A mesma checagem, mas recebendo o valor já lido.
 *
 * Existe por causa do **middleware**, que roda no Edge: lá o bundler só
 * garante o que consegue ler estaticamente, e `process.env[nome]` — chave
 * dinâmica — pode chegar vazio. Confirmado no bundle: o `middleware-manifest`
 * lista as variáveis que viajam, e uma leitura dinâmica não entra nessa lista.
 *
 * Rota de API roda em função Node, onde `process.env` é objeto de verdade e
 * `req` basta. Quem é lido pela porta em **toda** requisição — o segredo que
 * assina o cookie, o e-mail permitido que vem no mesmo getter, e o segredo do
 * cron — passa por aqui, com `process.env.NOME` escrito por extenso.
 *
 * O que se conferiu no bundle: a forma escrita por extenso **sobrevive** como
 * `process.env.AUTH_SECRET`, e o valor **não** é inlinado — o segredo não viaja
 * dentro do artefato, e continua sendo lido em tempo de execução. A troca é de
 * uma leitura que nenhuma análise estática alcança por uma que o Edge resolve.
 *
 * `env.auth` devolve os dois campos juntos, então ler o segredo avalia o e-mail
 * no mesmo gesto — é por isso que `ALLOWED_EMAIL` está nesta lista mesmo sem o
 * middleware nunca perguntar por ele.
 */
function exigir(nome: string, valor: string | undefined): string {
  if (!valor) throw new Error(`Variável de ambiente ausente: ${nome}`);
  return valor;
}

export const env = {
  get neo4j() {
    return {
      url: req("NEO4J_QUERY_URL"),
      user: req("NEO4J_USER"),
      password: req("NEO4J_PASSWORD"),
    };
  },
  get r2() {
    return {
      accountId: req("R2_ACCOUNT_ID"),
      accessKeyId: req("R2_ACCESS_KEY_ID"),
      secretAccessKey: req("R2_SECRET_ACCESS_KEY"),
      bucket: req("R2_BUCKET"),
    };
  },
  /**
   * Todo tráfego de modelo (STT agora, extração na slice 2) sai pelo
   * Vercel AI Gateway — uma chave só, um lugar só para ver custo.
   */
  get aiGatewayKey() {
    return req("AI_GATEWAY_API_KEY");
  },
  get auth() {
    return {
      secret: exigir("AUTH_SECRET", process.env.AUTH_SECRET),
      allowedEmail: exigir("ALLOWED_EMAIL", process.env.ALLOWED_EMAIL),
    };
  },
  /**
   * Entrega do magic link. Não é chave de modelo — a regra inviolável 8 fala de
   * tráfego de LLM, e e-mail não é LLM —, e entra por `fetch`, sem SDK: o
   * projeto já fala com o Neo4j e com o R2 assim.
   */
  get resendKey() {
    return req("RESEND_API_KEY");
  },
  /**
   * O que a Vercel manda no header do cron. Lido por `req`, e não como
   * opcional, de propósito: variável com nome errado vira erro claro no log da
   * função em vez de um 401 calado todo dia às 6 da manhã. O middleware só
   * chega aqui quando existe header `Authorization` para conferir — request
   * normal nunca toca nesta linha.
   */
  get cronSecret() {
    return exigir("CRON_SECRET", process.env.CRON_SECRET);
  },
};
