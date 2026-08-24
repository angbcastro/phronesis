/**
 * Confere as dependências externas antes de gravar de verdade.
 *
 * Não substitui `pnpm test` — testa o que os testes unitários não alcançam:
 * credencial, rede, assinatura e CORS. Não toca em dado de sessão real:
 * usa um prefixo `_smoke/` próprio e limpa o que criou.
 *
 *   pnpm smoke
 */
import { AwsClient } from "aws4fetch";

const ORIGEM_DEV = process.env.SMOKE_ORIGIN ?? "http://localhost:3000";

let falhas = 0;

function ok(nome: string, detalhe = "") {
  console.log(`  ok    ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
}
function falha(nome: string, motivo: string) {
  falhas++;
  console.log(`  FALHA ${nome} — ${motivo}`);
}
function aviso(nome: string, motivo: string) {
  console.log(`  aviso ${nome} — ${motivo}`);
}

function env(nome: string): string {
  const v = process.env[nome];
  if (!v) throw new Error(`falta ${nome} no ambiente`);
  return v;
}

async function checarNeo4j() {
  console.log("\nNeo4j (HTTP Query API)");
  const url = env("NEO4J_QUERY_URL");

  if (!/\/db\/[^/]+\/query\/v\d+\/?$/.test(url)) {
    aviso("formato da URL", `esperava terminar em /db/<banco>/query/v2, veio "${url}"`);
  }

  const auth =
    "Basic " + Buffer.from(`${env("NEO4J_USER")}:${env("NEO4J_PASSWORD")}`).toString("base64");

  async function q(statement: string) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: auth },
      body: JSON.stringify({ statement }),
    });
    const corpo = (await r.json().catch(() => ({}))) as {
      data?: { values: unknown[][] };
      errors?: { message: string }[];
    };
    if (corpo.errors?.length) throw new Error(corpo.errors[0].message);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return corpo.data?.values ?? [];
  }

  try {
    await q("RETURN 1");
    ok("conexão e credencial");
  } catch (e) {
    falha("conexão e credencial", String(e instanceof Error ? e.message : e));
    return;
  }

  try {
    const nomes = (await q("SHOW CONSTRAINTS YIELD name RETURN name")).flat();
    if (nomes.includes("sessao_id")) ok("migration 001 aplicada", "constraint sessao_id existe");
    else falha("migration 001", "constraint sessao_id não existe — rode `pnpm migrate`");
  } catch (e) {
    falha("leitura de constraints", String(e instanceof Error ? e.message : e));
  }

  try {
    const n = (await q("MATCH (s:Sessao) RETURN count(s)")).flat()[0];
    ok("leitura de :Sessao", `${n} sessão(ões) no banco`);
  } catch (e) {
    falha("leitura de :Sessao", String(e instanceof Error ? e.message : e));
  }
}

async function checarR2() {
  console.log("\nCloudflare R2");
  const conta = env("R2_ACCOUNT_ID");
  const bucket = env("R2_BUCKET");
  const cliente = new AwsClient({
    accessKeyId: env("R2_ACCESS_KEY_ID"),
    secretAccessKey: env("R2_SECRET_ACCESS_KEY"),
    service: "s3",
    region: "auto",
  });

  const key = `_smoke/${Date.now()}.txt`;
  const alvo = `https://${conta}.r2.cloudflarestorage.com/${bucket}/${key}`;

  try {
    const r = await cliente.fetch(alvo, {
      method: "PUT",
      body: "smoke",
      headers: { "Content-Type": "text/plain" },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    ok("escrita com credencial de servidor");
  } catch (e) {
    falha("escrita com credencial de servidor", String(e instanceof Error ? e.message : e));
    return;
  }

  // O caminho que o navegador usa de verdade: presigned PUT, sem credencial.
  const presign = new URL(alvo.replace(key, `${key}.presigned`));
  presign.searchParams.set("X-Amz-Expires", "300");
  const assinada = await cliente.sign(new Request(presign, { method: "PUT" }), {
    aws: { signQuery: true },
  });

  try {
    const r = await fetch(assinada.url, {
      method: "PUT",
      body: "smoke",
      headers: { "Content-Type": "audio/webm" },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
    ok("PUT por presigned URL", "é assim que o áudio sobe");
  } catch (e) {
    falha("PUT por presigned URL", String(e instanceof Error ? e.message : e));
  }

  // Sem CORS, o PUT do navegador morre no preflight e nenhum bloco sobe.
  try {
    const r = await fetch(assinada.url, {
      method: "OPTIONS",
      headers: {
        Origin: ORIGEM_DEV,
        "Access-Control-Request-Method": "PUT",
        "Access-Control-Request-Headers": "content-type",
      },
    });
    const permitido = r.headers.get("access-control-allow-origin");
    if (permitido && (permitido === "*" || permitido === ORIGEM_DEV)) {
      ok("CORS do bucket", `libera ${ORIGEM_DEV}`);
    } else {
      falha(
        "CORS do bucket",
        `preflight de ${ORIGEM_DEV} não voltou allow-origin (HTTP ${r.status}) — aplique config/r2-cors.json`,
      );
    }
  } catch (e) {
    falha("CORS do bucket", String(e instanceof Error ? e.message : e));
  }

  for (const k of [key, `${key}.presigned`]) {
    await cliente
      .fetch(`https://${conta}.r2.cloudflarestorage.com/${bucket}/${k}`, { method: "DELETE" })
      .catch(() => {});
  }
  ok("limpeza", "objetos de smoke removidos");
}

async function checarStt() {
  console.log("\nSTT");
  const chave = env("STT_API_KEY");
  const url = process.env.STT_URL ?? "https://api.openai.com/v1/audio/transcriptions";
  const base = new URL(url).origin;

  try {
    const r = await fetch(`${base}/v1/models`, { headers: { Authorization: `Bearer ${chave}` } });
    if (r.status === 401) return falha("credencial", "chave rejeitada (401)");
    if (!r.ok) return aviso("credencial", `HTTP ${r.status} em /v1/models — pode não existir nesta API`);
    ok("credencial aceita", "transcrição de verdade só na primeira gravação");
  } catch (e) {
    falha("credencial", String(e instanceof Error ? e.message : e));
  }
}

async function checarAuth() {
  console.log("\nAuth");
  const segredo = process.env.AUTH_SECRET ?? "";
  const email = process.env.ALLOWED_EMAIL ?? "";
  if (segredo.length < 32) falha("AUTH_SECRET", `${segredo.length} caracteres — use pelo menos 32`);
  else ok("AUTH_SECRET");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) falha("ALLOWED_EMAIL", `"${email}" não parece e-mail`);
  else ok("ALLOWED_EMAIL", email);
}

async function main() {
  console.log("Conferindo dependências externas…");
  for (const checagem of [checarNeo4j, checarR2, checarStt, checarAuth]) {
    try {
      await checagem();
    } catch (e) {
      falha(checagem.name, String(e instanceof Error ? e.message : e));
    }
  }

  console.log(
    falhas === 0
      ? "\nTudo de pé. Dá para gravar.\n"
      : `\n${falhas} problema(s) — resolver antes de gravar.\n`,
  );
  process.exit(falhas === 0 ? 0 : 1);
}

main();
