import { NextResponse } from "next/server";
import { criarToken, emailPermitido } from "@/lib/auth";
import { env } from "@/lib/env";

export const runtime = "nodejs";

/**
 * A entrega do magic link, pelo Resend.
 *
 * Por `fetch` e sem SDK, como o Neo4j (Query API) e o R2 (`aws4fetch`) — o
 * projeto tem cinco dependências de runtime e não precisa de uma sexta para um
 * POST. `RESEND_API_KEY` não é chave de modelo: a regra inviolável 8 governa
 * tráfego de LLM, e e-mail não é LLM.
 *
 * `onboarding@resend.dev` é o remetente enquanto não houver domínio verificado,
 * e nessa condição o Resend **só entrega ao dono da conta** — que é exatamente
 * o destinatário único que este sistema tem (`ALLOWED_EMAIL`). A restrição do
 * provedor e a regra do app coincidem, e isso é conveniente, não garantido:
 * verificar um domínio um dia solta a primeira sem soltar a segunda.
 *
 * Falha de entrega vira **linha de log, não campo na resposta**. Dizer na tela
 * "a entrega falhou" seria útil para mim e responderia, para qualquer um que
 * perguntasse, qual é o e-mail certo — só o endereço permitido chega a ter
 * entrega para falhar. A resposta uniforme é propriedade desta rota desde a
 * slice 1, e conveniência minha não é motivo para gastá-la. O link continua
 * saindo no `console.log` acima, que é por onde se recupera quando o provedor
 * está fora.
 */
async function entregar(link: string, para: string) {
  console.log(`[auth] magic link: ${link}`);

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Phronesis <onboarding@resend.dev>",
      to: [para],
      subject: "Entrar no Phronesis",
      text: `${link}\n\nO link vale 15 minutos. Se não foi você, ignore.`,
    }),
    cache: "no-store",
  });

  if (!resp.ok) {
    throw new Error(`Resend recusou o envio (${resp.status}): ${(await resp.text()).slice(0, 300)}`);
  }
}

/**
 * POST /api/auth/link — pede o magic link.
 *
 * Um único e-mail permitido, e a resposta é sempre a mesma — em produção,
 * `{ ok: true }` nos três caminhos: e-mail errado, entrega feita, entrega
 * falhada. Fora de produção o link volta no corpo, que é o que faz o `pnpm dev`
 * não precisar de provedor nenhum.
 */
export async function POST(req: Request) {
  const { email } = (await req.json().catch(() => ({}))) as { email?: string };

  if (!email || !emailPermitido(email)) {
    return NextResponse.json({ ok: true });
  }

  const token = await criarToken("link");
  const link = new URL(`/api/auth/entrar?token=${encodeURIComponent(token)}`, req.url).toString();

  try {
    await entregar(link, email);
  } catch (e) {
    console.error(`[auth] falhei em entregar o link: ${e instanceof Error ? e.message : String(e)}`);
  }

  return NextResponse.json(
    process.env.NODE_ENV === "production" ? { ok: true } : { ok: true, link },
  );
}
