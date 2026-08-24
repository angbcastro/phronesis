/**
 * Porta única do app: sem cookie de sessão válido, nada além de /entrar
 * e das rotas de auth responde.
 */
import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_SESSAO, tokenValido } from "@/lib/auth";

const PUBLICAS = ["/entrar", "/api/auth"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLICAS.some((p) => pathname.startsWith(p))) return NextResponse.next();

  if (await tokenValido(req.cookies.get(COOKIE_SESSAO)?.value, "sessao")) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  }

  const url = req.nextUrl.clone();
  url.pathname = "/entrar";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icone.svg).*)"],
};
