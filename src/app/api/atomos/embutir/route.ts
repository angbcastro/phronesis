import { NextResponse } from "next/server";
import { atomosSemVetor, contarAtomosSemVetor, embutirAtomos } from "@/lib/atomos";
import { modeloEmbedding } from "@/lib/modelos";
import { erroDeInfra } from "@/lib/rotas";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Quantos átomos uma chamada embute.
 *
 * O teto não é do Gateway, é do relógio: `maxDuration` são 60 s, e uma função
 * que morre no meio deixa metade gravada — o que aqui não é problema nenhum,
 * porque a metade gravada não volta na chamada seguinte. Rodar duas, três,
 * dez vezes até `restantes: 0` é o modo de uso, e é ele que faz o retrofill de
 * milhares de átomos caber numa função serverless sem fila e sem cron.
 */
const POR_CHAMADA = 200;

/**
 * POST /api/atomos/embutir — dá vetor aos átomos que ainda não têm.
 *
 * É o **retrofill** dos que já estão no grafo e o **retry** de qualquer falha:
 * embutir acontece no confirmar, mas nada no caminho do embedding pode impedir
 * uma gravação de acontecer (slice 4.5), então átomo gravado sem vetor é
 * esperado e esta rota é quem o alcança depois.
 *
 * **Não toca no texto de ninguém e não reextrai nada.** O vetor é derivável do
 * que já está gravado; refazê-lo é uma passada de `embedMany`, não uma chamada
 * de extração.
 *
 * Idempotente por construção (regra 4): a seleção é "sem vetor **ou** vetor de
 * outro modelo", então rodar duas vezes seguidas com o mesmo `EMBEDDING_MODEL`
 * devolve `embutidos: 0` na segunda. É também o que faz uma troca de modelo se
 * consertar sozinha — sem o campo, dois espaços vetoriais conviveriam no mesmo
 * índice, o que não dá erro: dá vizinhança errada.
 *
 * `POST` e não `GET` porque gasta chamada de modelo — a mesma razão de
 * `/api/entidades/duplicatas` ser POST.
 */
export async function POST() {
  try {
    const pendentes = await atomosSemVetor(POR_CHAMADA);
    const embutidos = await embutirAtomos(pendentes);

    // Depois de gravar, e do banco, não de `pendentes.length - embutidos`: a
    // conta do que ainda falta é dele. Chegar a zero é o sinal de que acabou.
    const restantes = await contarAtomosSemVetor();

    return NextResponse.json({
      embutidos,
      restantes,
      /** `true` quando vale chamar de novo. */
      continua: restantes > 0,
      modelo: modeloEmbedding(),
    });
  } catch (e) {
    return erroDeInfra("atomos/embutir", e);
  }
}
