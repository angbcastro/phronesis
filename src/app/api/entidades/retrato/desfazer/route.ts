import { responderDesfazerDoEu } from "./resposta";

export const runtime = "nodejs";

/**
 * POST /api/entidades/retrato/desfazer — o desfazer do "eu" (slice 10).
 *
 * **Um botão, os dois lados**: os `_anterior` do nó e `eu.json` ↔
 * `eu.anterior.json`. Uma rodada é uma coisa só. `POST /api/entidades/desfazer`
 * com a chave do "eu" desvia para a mesma resposta — senão o botão genérico
 * trocaria só o nó. Os status estão em `resposta.ts`.
 */
export async function POST() {
  return responderDesfazerDoEu();
}
