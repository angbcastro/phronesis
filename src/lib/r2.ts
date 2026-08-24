/**
 * Acesso ao R2 via API S3-compatível, assinada com SigV4 (aws4fetch).
 *
 * Bucket privado. O cliente nunca recebe credencial: recebe uma URL
 * presigned de 5 minutos, uma por bloco, e faz PUT direto (regra 1).
 */
import { AwsClient } from "aws4fetch";
import { env } from "./env";

export const VALIDADE_PRESIGN_S = 300; // 5 min

let _cliente: AwsClient | null = null;
function cliente(): AwsClient {
  if (!_cliente) {
    const { accessKeyId, secretAccessKey } = env.r2;
    _cliente = new AwsClient({
      accessKeyId,
      secretAccessKey,
      service: "s3",
      region: "auto",
    });
  }
  return _cliente;
}

export function urlObjeto(key: string): string {
  const { accountId, bucket } = env.r2;
  const caminho = key.split("/").map(encodeURIComponent).join("/");
  return `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${caminho}`;
}

/** URL presigned para o cliente fazer PUT direto do bloco de áudio. */
export async function urlPresignadaPut(
  key: string,
  validadeS: number = VALIDADE_PRESIGN_S,
): Promise<{ url: string; expira_em: string }> {
  const url = new URL(urlObjeto(key));
  url.searchParams.set("X-Amz-Expires", String(validadeS));

  const assinada = await cliente().sign(new Request(url, { method: "PUT" }), {
    aws: { signQuery: true },
  });

  return {
    url: assinada.url,
    expira_em: new Date(Date.now() + validadeS * 1000).toISOString(),
  };
}

export interface ObjetoTexto {
  texto: string;
  etag: string | null;
}

export async function getTexto(key: string): Promise<ObjetoTexto | null> {
  const resp = await cliente().fetch(urlObjeto(key), { method: "GET" });
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`R2 GET ${key} falhou: ${resp.status}`);
  return { texto: await resp.text(), etag: resp.headers.get("etag") };
}

export async function getJson<T>(key: string): Promise<{ valor: T; etag: string | null } | null> {
  const o = await getTexto(key);
  if (!o) return null;
  return { valor: JSON.parse(o.texto) as T, etag: o.etag };
}

export async function getBytes(key: string): Promise<ArrayBuffer | null> {
  const resp = await cliente().fetch(urlObjeto(key), { method: "GET" });
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`R2 GET ${key} falhou: ${resp.status}`);
  return await resp.arrayBuffer();
}

export async function existe(key: string): Promise<{ bytes: number } | null> {
  const resp = await cliente().fetch(urlObjeto(key), { method: "HEAD" });
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`R2 HEAD ${key} falhou: ${resp.status}`);
  return { bytes: Number(resp.headers.get("content-length") ?? 0) };
}

export class ConflitoR2Error extends Error {
  constructor(key: string) {
    super(`R2 PUT ${key} rejeitado por condicional (412)`);
    this.name = "ConflitoR2Error";
  }
}

export interface OpcoesPut {
  contentType?: string;
  /** Só grava se o etag atual bater. Usado no manifest (read-modify-write). */
  ifMatch?: string;
  /** `*` = só grava se o objeto ainda não existir. */
  ifNoneMatch?: string;
}

export async function put(
  key: string,
  corpo: string | ArrayBuffer | Uint8Array,
  opcoes: OpcoesPut = {},
): Promise<{ etag: string | null }> {
  const headers: Record<string, string> = {
    "Content-Type": opcoes.contentType ?? "application/octet-stream",
  };
  if (opcoes.ifMatch) headers["If-Match"] = opcoes.ifMatch;
  if (opcoes.ifNoneMatch) headers["If-None-Match"] = opcoes.ifNoneMatch;

  const resp = await cliente().fetch(urlObjeto(key), {
    method: "PUT",
    headers,
    body: corpo as BodyInit,
  });

  if (resp.status === 412 || resp.status === 409) throw new ConflitoR2Error(key);
  if (!resp.ok) throw new Error(`R2 PUT ${key} falhou: ${resp.status} ${await resp.text()}`);
  return { etag: resp.headers.get("etag") };
}

export async function putJson(key: string, valor: unknown, opcoes: OpcoesPut = {}) {
  return put(key, JSON.stringify(valor), { ...opcoes, contentType: "application/json" });
}
