import { NextResponse } from "next/server";
import { listarEntidades } from "@/lib/entidades";
import { erroDeInfra } from "@/lib/rotas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/entidades — o que está no grafo. `?perfil=1` traz os três campos.
 *
 * Só leitura. Nó fundido não vem como linha própria: ele aparece como alias do
 * vencedor, que é o que faz a lista mostrar o grafo como ele vale hoje e ainda
 * assim guardar o histórico do nome.
 *
 * **O perfil sai por padrão** (4.8.1). Os dois clientes desta rota querem coisas
 * diferentes: `/entidades` edita os três campos e pede `?perfil=1`; a revisão só
 * quer nome, chaves e tipo para a barra pesquisável, e baixa o grafo inteiro a
 * cada abertura (§14). O perfil é o campo mais pesado da resposta, e era carga
 * que ninguém lia ali — `catalogo.ts` já dizia que ele ficava de fora, e não
 * ficava.
 */
export async function GET(req: Request) {
  const comPerfil = new URL(req.url).searchParams.get("perfil") === "1";

  try {
    const entidades = await listarEntidades();
    return NextResponse.json({
      entidades: comPerfil
        ? entidades
        : // Campo a campo, e não `delete`: o que a revisão recebe é contrato
          // (`EntidadeDoCatalogo`), e campo novo em `EntidadeDoGrafo` não deve
          // vazar para cá sem alguém decidir.
          entidades.map((e) => ({
            id: e.id,
            nome: e.nome,
            nome_normalizado: e.nome_normalizado,
            chaves: e.chaves,
            tipo: e.tipo,
            sessoes: e.sessoes,
            atomos: e.atomos,
            aliases: e.aliases,
          })),
    });
  } catch (e) {
    return erroDeInfra("entidades", e);
  }
}
