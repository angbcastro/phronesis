/**
 * Porta única do app: sem credencial válida, nada além de /entrar
 * e das rotas de auth responde.
 *
 * Duas credenciais, e não uma: o cookie de sessão (eu, no navegador) e o
 * header do cron da Vercel (a batida diária, sem navegador nenhum). A segunda
 * vale **só** em `/api/cron/` — credencial de máquina não abre o app.
 */
import { NextResponse, type NextRequest } from "next/server";
import {
  COOKIE_SESSAO,
  credencialDeCron,
  criarToken,
  opcoesCookie,
  precisaRenovar,
  tokenValido,
} from "@/lib/auth";

const PUBLICAS = ["/entrar", "/api/auth"];
const PREFIXO_CRON = "/api/cron/";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLICAS.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const cookie = req.cookies.get(COOKIE_SESSAO)?.value;
  if (await tokenValido(cookie, "sessao")) {
    const resposta = NextResponse.next();
    // A janela desliza aqui, e não na rota: assim toda tela e toda rota
    // renovam, e não só as que alguém lembrou de instrumentar.
    if (precisaRenovar(cookie)) {
      resposta.cookies.set(COOKIE_SESSAO, await criarToken("sessao"), opcoesCookie);
    }
    return resposta;
  }

  if (pathname.startsWith(PREFIXO_CRON) && credencialDeCron(req.headers.get("authorization"))) {
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

/**
 * Onde o middleware nem roda. `manifest.webmanifest`, `icone.svg`, os PNG e
 * `sw.js` são exigência do PWA — o navegador busca tudo isso **sem** cookie de
 * app, e o service worker é o que faz o Chrome oferecer a instalação. Os três
 * primeiros são estático de build. A resposta completa de "o que responde sem
 * credencial" é a soma deste matcher com o corpo acima.
 */
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icone.svg|icone-).*)",
  ],
};
