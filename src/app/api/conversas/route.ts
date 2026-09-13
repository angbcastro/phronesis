import { NextResponse } from "next/server";
import { listarConversas } from "@/lib/conversas";
import { erroDeInfra } from "@/lib/rotas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/conversas — a lista que o painel do chat desenha.
 *
 * Ativas e arquivadas juntas, da mais recentemente tocada para a mais antiga:
 * quem separa é a tela, que põe as arquivadas atrás de um separador. Duas
 * consultas pagariam duas varreduras pelo mesmo grafo de uma pessoa só.
 *
 * **Sem POST.** Conversa não nasce de um botão: ela nasce da primeira pergunta,
 * em `POST /api/chat` sem `conversa_id`. O "nova conversa" da tela só limpa o
 * painel — assim a lista nunca acumula conversa vazia que eu abri e desisti.
 */
export async function GET() {
  try {
    return NextResponse.json({ conversas: await listarConversas() });
  } catch (e) {
    return erroDeInfra("conversas", e);
  }
}
