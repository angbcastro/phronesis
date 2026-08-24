import { NextResponse } from "next/server";
import { criarToken, emailPermitido } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * POST /api/auth/link — pede o magic link.
 *
 * Um único e-mail permitido. A resposta é sempre a mesma, com ou sem
 * acerto no e-mail.
 *
 * TODO(slice 1): não há provedor de e-mail configurado (não existe chave
 * para isso em CLAUDE.md). Por ora o link sai no log do servidor, e fora
 * de produção volta também no corpo da resposta. Trocar `entregar` por
 * uma chamada ao provedor é o único ponto a mexer.
 */
async function entregar(link: string) {
  console.log(`[auth] magic link: ${link}`);
}

export async function POST(req: Request) {
  const { email } = (await req.json().catch(() => ({}))) as { email?: string };

  if (!email || !emailPermitido(email)) {
    return NextResponse.json({ ok: true });
  }

  const token = await criarToken("link");
  const link = new URL(`/api/auth/entrar?token=${encodeURIComponent(token)}`, req.url).toString();
  await entregar(link);

  return NextResponse.json(
    process.env.NODE_ENV === "production" ? { ok: true } : { ok: true, link },
  );
}
