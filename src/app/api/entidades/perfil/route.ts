import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { passadaDeVetores } from "@/lib/entidades";
import { gravarCampo, normalizarCampo, PerfilError } from "@/lib/perfil";
import { erro } from "@/lib/rotas";

export const runtime = "nodejs";

/**
 * POST /api/entidades/perfil — `{ chave, campo, texto }`.
 *
 * **O único lugar que escreve os três campos de perfil.** O agente 3 propõe
 * (`/perfil/rascunho`) e para por aí; o campo só muda quando eu aperto salvar,
 * e é esta rota que o meu toque chama.
 *
 * A razão de ser assim está declarada na slice 4 §6: o perfil é exatamente o
 * que o agente de resolução lê para desambiguar. Perfil rascunhado errado
 * contamina toda atribuição futura, e o erro se realimenta — átomo atribuído ao
 * Rapha por engano vira evidência do perfil do Rapha.
 *
 * Como as outras rotas de `/entidades`, é correção minha e não pipeline: a
 * regra 5 proíbe o pipeline gravar sozinho, e aqui não há pipeline.
 */
export async function POST(req: Request) {
  const corpo = (await req.json().catch(() => null)) as {
    chave?: unknown;
    campo?: unknown;
    texto?: unknown;
  } | null;

  const chave = typeof corpo?.chave === "string" ? corpo.chave : "";
  const campo = normalizarCampo(corpo?.campo);
  // Texto vazio é legítimo: apagar o que eu escrevi errado tem que ser possível.
  const texto = typeof corpo?.texto === "string" ? corpo.texto : "";

  if (chave === "" || !campo) {
    return erro("corpo inválido: espera { chave, campo, texto }", 400);
  }

  try {
    const r = await gravarCampo(chave, campo, texto);
    // O perfil é o que mais muda a string canônica da entidade — e, portanto, o
    // vetor dela. De todos os ganchos da 4.8.1, este é o que mais rende.
    waitUntil(passadaDeVetores("perfil"));
    return NextResponse.json({ ok: true, campo, ...r });
  } catch (e) {
    if (e instanceof PerfilError) return erro(e.message, 400);
    console.error("[perfil]", e);
    return erro(e instanceof Error ? e.message : "não consegui gravar o perfil", 502);
  }
}
