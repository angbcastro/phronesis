import { NextResponse } from "next/server";
import { COOKIE_SESSAO, criarToken, opcoesCookie, tokenValido } from "@/lib/auth";

export const runtime = "nodejs";

/** GET /api/auth/entrar?token=… — troca o magic link pelo cookie de sessão. */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? undefined;

  if (!(await tokenValido(token, "link"))) {
    return NextResponse.redirect(new URL("/entrar?erro=link", req.url));
  }

  const resp = NextResponse.redirect(new URL("/", req.url));
  resp.cookies.set(COOKIE_SESSAO, await criarToken("sessao"), opcoesCookie);
  return resp;
}
