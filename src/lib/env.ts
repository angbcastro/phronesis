/**
 * Leitura de variáveis de ambiente. Só roda no servidor — nada aqui pode
 * ser importado por componente client (regra inviolável 3).
 */

function req(nome: string): string {
  const v = process.env[nome];
  if (!v) throw new Error(`Variável de ambiente ausente: ${nome}`);
  return v;
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
  get sttApiKey() {
    return req("STT_API_KEY");
  },
  get auth() {
    return { secret: req("AUTH_SECRET"), allowedEmail: req("ALLOWED_EMAIL") };
  },
};
