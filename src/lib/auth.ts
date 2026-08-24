/**
 * Auth: magic link com um único e-mail permitido.
 * Sem signup, sem roles, sem reset de senha.
 *
 * Nada aqui é exposto ao cliente: o token vive num cookie httpOnly e a
 * verificação roda no middleware (regra 3).
 */
import { env } from "./env";

export const COOKIE_SESSAO = "phronesis_sessao";
const TTL_LINK_S = 15 * 60;
const TTL_SESSAO_S = 60 * 60 * 24 * 90;

const enc = new TextEncoder();

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const byte of b) s += String.fromCharCode(byte);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function chave(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(env.auth.secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function assinar(dados: string): Promise<string> {
  return b64url(await crypto.subtle.sign("HMAC", await chave(), enc.encode(dados)));
}

export function emailPermitido(email: string): boolean {
  return email.trim().toLowerCase() === env.auth.allowedEmail.trim().toLowerCase();
}

type Escopo = "link" | "sessao";

export async function criarToken(escopo: Escopo, agora: number = Date.now()): Promise<string> {
  const exp = Math.floor(agora / 1000) + (escopo === "link" ? TTL_LINK_S : TTL_SESSAO_S);
  const corpo = `${escopo}.${exp}`;
  return `${corpo}.${await assinar(corpo)}`;
}

export async function tokenValido(token: string | undefined, escopo: Escopo): Promise<boolean> {
  if (!token) return false;
  const partes = token.split(".");
  if (partes.length !== 3) return false;

  const [esc, exp, assinatura] = partes;
  if (esc !== escopo) return false;
  if (!/^\d+$/.test(exp) || Number(exp) * 1000 < Date.now()) return false;

  const esperada = await assinar(`${esc}.${exp}`);
  return tempoConstante(assinatura, esperada);
}

function tempoConstante(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return dif === 0;
}

export const opcoesCookie = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: TTL_SESSAO_S,
} as const;
