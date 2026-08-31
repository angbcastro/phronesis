import { NextResponse } from "next/server";
import { acharPorChave, listarEntidades, normalizarNome } from "@/lib/entidades";
import { atomosMarcados, normalizarCampo, PerfilError, rascunhar } from "@/lib/perfil";
import { erro } from "@/lib/rotas";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/entidades/perfil/rascunho — `{ chave, campo }`.
 *
 * O agente 3 propõe o texto novo a partir dos átomos que o agente 2 marcou com
 * `:PERFILA` naquele campo. **Não escreve nada** — devolve o texto e para. Quem
 * grava é `POST /api/entidades/perfil`, e só com o meu toque.
 *
 * É `POST` e não `GET` pela mesma razão de `/duplicatas`: gasta uma chamada de
 * modelo. Juntar os átomos marcados é de graça; propor o texto não é, e isso não
 * pode acontecer toda vez que a tela abre.
 */
export async function POST(req: Request) {
  const corpo = (await req.json().catch(() => null)) as {
    chave?: unknown;
    campo?: unknown;
  } | null;

  const chave = typeof corpo?.chave === "string" ? corpo.chave : "";
  const campo = normalizarCampo(corpo?.campo);
  if (chave === "" || !campo) return erro("corpo inválido: espera { chave, campo }", 400);

  try {
    const entidade = acharPorChave(normalizarNome(chave), await listarEntidades());
    if (!entidade) return erro(`"${chave}" não está no grafo`, 404);

    const marcados = await atomosMarcados(chave, campo);
    const rascunho = await rascunhar(entidade.nome, campo, entidade.perfil[campo], marcados);

    return NextResponse.json({
      campo,
      // O atual vai junto de propósito: a tela mostra os dois lado a lado, e o
      // proposto nunca aparece por cima do que eu escrevi.
      atual: entidade.perfil[campo],
      ...rascunho,
    });
  } catch (e) {
    if (e instanceof PerfilError) return erro(e.message, 400);
    console.error("[perfil rascunho]", e);
    return erro(e instanceof Error ? e.message : "não consegui rascunhar", 502);
  }
}
