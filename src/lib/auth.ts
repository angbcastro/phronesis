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

/**
 * Fração da vida do cookie abaixo da qual ele se renova sozinho.
 *
 * Sem isto os 90 dias são um prazo fixo e o ritual morre quatro vezes por ano
 * sem motivo nenhum: o diário é diário, e ser expulso dele é justamente o
 * atrito que a tela de gravar existe para não ter. Com a janela deslizando,
 * dispositivo em uso regular não cai nunca; dispositivo largado por 90 dias
 * cai, que é o comportamento que se quer de qualquer jeito.
 *
 * Um terço, e não toda requisição: renovar sempre poria um `Set-Cookie` em cada
 * asset da página, e o ganho seria zero.
 */
const RENOVAR_ABAIXO_DE = 1 / 3;

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

/**
 * Este token de sessão está perto demais do fim para valer outro dia?
 *
 * **Não confere assinatura** — quem chama é o middleware, logo depois de
 * `tokenValido` ter conferido. Repetir o HMAC aqui custaria uma segunda
 * derivação de chave por requisição para responder o que já se sabe; e a
 * pergunta que esta função responde é sobre o relógio, não sobre autenticidade.
 * Token malformado responde `false`: não renovar é sempre a resposta segura.
 */
export function precisaRenovar(token: string | undefined, agora: number = Date.now()): boolean {
  if (!token) return false;
  const exp = token.split(".")[1];
  if (!/^\d+$/.test(exp ?? "")) return false;
  return Number(exp) * 1000 - agora < TTL_SESSAO_S * 1000 * RENOVAR_ABAIXO_DE;
}

/**
 * O header que a Vercel manda no cron — `Authorization: Bearer <CRON_SECRET>`.
 *
 * Mora aqui, e não numa exceção do `matcher`, porque a porta é uma só: o §7
 * promete que sem credencial válida nada responde, e essa resposta tem de caber
 * num lugar. A comparação é a mesma de tempo constante do token.
 *
 * Só é consultada quando há header — request sem `Authorization` nunca lê
 * `CRON_SECRET`, e por isso a variável pode faltar sem quebrar o app inteiro.
 */
export function credencialDeCron(header: string | null): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  return tempoConstante(header.slice("Bearer ".length), env.cronSecret);
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
