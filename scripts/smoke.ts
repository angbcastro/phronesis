/**
 * Confere as dependências externas antes de gravar de verdade.
 *
 * Não substitui `pnpm test` — testa o que os testes unitários não alcançam:
 * credencial, rede, assinatura, CORS e o que o STT devolve de verdade.
 * Não toca em dado de sessão real: usa um prefixo `_smoke/` próprio e
 * limpa o que criou.
 *
 *   pnpm smoke
 *   SMOKE_AUDIO=caminho/chunk_000.webm pnpm smoke
 */
import { readFile } from "node:fs/promises";
import { AwsClient } from "aws4fetch";
import { experimental_transcribe as transcribe } from "ai";

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
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: auth,
      },
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

function clienteR2(): AwsClient {
  return new AwsClient({
    accessKeyId: env("R2_ACCESS_KEY_ID"),
    secretAccessKey: env("R2_SECRET_ACCESS_KEY"),
    service: "s3",
    region: "auto",
  });
}

const raizR2 = () => `https://${env("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com/${env("R2_BUCKET")}`;

async function checarR2() {
  console.log("\nCloudflare R2");
  const cliente = clienteR2();
  const key = `_smoke/${Date.now()}.txt`;
  const alvo = `${raizR2()}/${key}`;

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
  const presign = new URL(`${alvo}.presigned`);
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
    await cliente.fetch(`${raizR2()}/${k}`, { method: "DELETE" }).catch(() => {});
  }
  ok("limpeza", "objetos de smoke removidos");
}

function contarPalavras(metadata: unknown): number {
  if (!metadata || typeof metadata !== "object") return 0;
  for (const valor of Object.values(metadata as Record<string, unknown>)) {
    const w = (valor as { words?: unknown })?.words;
    if (Array.isArray(w) && w.length > 0) return w.length;
  }
  return 0;
}

/** Usa áudio de verdade: um bloco já gravado vale mais que um tom sintético. */
async function audioDeTeste(): Promise<{ bytes: ArrayBuffer; origem: string } | null> {
  const caminho = process.env.SMOKE_AUDIO;
  if (caminho) {
    const buf = await readFile(caminho);
    return {
      bytes: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
      origem: caminho,
    };
  }

  if (!process.env.R2_ACCOUNT_ID) return null;

  try {
    const cliente = clienteR2();
    const lista = await cliente.fetch(`${raizR2()}?list-type=2&prefix=sessoes/&max-keys=200`);
    if (!lista.ok) return null;

    const xml = await lista.text();
    const chave = [...xml.matchAll(/<Key>([^<]+\.webm)<\/Key>/g)].map((m) => m[1])[0];
    if (!chave) return null;

    const obj = await cliente.fetch(`${raizR2()}/${chave}`);
    if (!obj.ok) return null;
    return { bytes: await obj.arrayBuffer(), origem: chave };
  } catch {
    return null;
  }
}

async function checarStt() {
  console.log("\nSTT (Vercel AI Gateway)");

  if (!process.env.AI_GATEWAY_API_KEY) {
    falha("AI_GATEWAY_API_KEY", "não definida — todo tráfego de modelo passa por ela");
    return;
  }
  ok("AI_GATEWAY_API_KEY presente");

  // Mesma semântica de `modeloStt()` em src/lib/modelos.ts: `||`, não `??` —
  // `STT_MODEL=` vazio no `.env.local` tem de cair no padrão. (O script não
  // importa o módulo porque src/ usa import sem extensão, que node puro não
  // resolve; se divergir daqui, o teste da porta é quem manda.)
  const modelo = process.env.STT_MODEL || "xai/grok-stt";
  const provedor = modelo.split("/")[0];

  const audio = await audioDeTeste();
  if (!audio) {
    aviso(
      "transcrição de verdade",
      "não achei bloco nenhum — grave 30 s, ou rode com SMOKE_AUDIO=<caminho.webm>",
    );
    return;
  }
  ok("bloco de teste", `${audio.origem} (${(audio.bytes.byteLength / 1024).toFixed(0)} kB)`);

  let termos: string[] = [];
  try {
    const conteudo = await readFile("config/vocabulario.txt", "utf8");
    termos = conteudo
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("#"))
      .slice(0, 100);
  } catch {
    /* sem vocabulário, segue sem keyterm */
  }

  // Três incógnitas de uma vez: o gateway aceita webm/opus? devolve
  // timestamp por palavra ou só por segmento? o keyterm passa adiante?
  try {
    const r = await transcribe({
      model: modelo,
      audio: new Uint8Array(audio.bytes),
      providerOptions: termos.length > 0 ? { [provedor]: { keyterm: termos } } : undefined,
    });

    ok("webm/opus aceito", `${modelo} transcreveu o bloco`);

    const palavras = contarPalavras(r.providerMetadata);
    if (palavras > 0) {
      ok("timestamps", `${palavras} palavras com tempo — precisão por palavra`);
    } else if ((r.segments?.length ?? 0) > 0) {
      aviso(
        "timestamps",
        `só segmentos (${r.segments.length}) — procedência fica na frase, não na palavra`,
      );
    } else {
      falha("timestamps", "nenhum tempo devolvido — procedência impossível");
    }

    for (const w of r.warnings ?? []) {
      aviso("aviso do provedor", JSON.stringify(w).slice(0, 160));
    }
    if (termos.length > 0 && (r.warnings?.length ?? 0) === 0) {
      ok("keyterm", `${termos.length} termo(s) aceitos sem reclamação`);
    }

    const trecho = (r.text ?? "").trim().slice(0, 160);
    console.log(`\n  transcrição: "${trecho}${trecho.length === 160 ? "…" : ""}"`);
    console.log("  confira à mão se os nomes próprios saíram grafados certo.\n");
  } catch (e) {
    falha("transcrição", String(e instanceof Error ? e.message : e));
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
