"use client";

/**
 * O fluxo NDJSON, do lado do navegador.
 *
 * O projeto tem duas rotas que transmitem — `POST /api/chat` (slice 6) e
 * `GET /api/sessoes/:id/extracao/eventos` (slice 8.2) — e as duas falam o mesmo
 * dialeto: um objeto JSON por linha, `Content-Type: application/x-ndjson`,
 * `X-Accel-Buffering: no`. Três telas consomem esse dialeto. Este módulo existe
 * para o laço que o lê ser **um só**: ele nasceu dentro de `Chat.tsx`, e a
 * terceira cópia dele é que o tirou de lá.
 *
 * Nada aqui sabe o que é um evento. O tipo vem de quem chama, porque o que
 * viaja na linha é contrato da rota, não deste módulo.
 */

/**
 * Parte o que chegou do fluxo em linhas inteiras, guardando o resto.
 *
 * **O resto não é detalhe**: um chunk de rede corta onde quiser, inclusive no
 * meio de um `\n` ou de um caractere multibyte, e `JSON.parse` de meia linha
 * derruba a leitura inteira. É a única coisa deste arquivo que erraria em
 * silêncio — daí ela ser pura e testada.
 */
export function partirLinhas(acumulado: string): { linhas: string[]; resto: string } {
  const partes = acumulado.split("\n");
  const resto = partes.pop() ?? "";
  return { linhas: partes.filter((l) => l.trim() !== ""), resto };
}

/**
 * Lê o corpo até o fim, chamando `aoEvento` uma vez por linha válida.
 *
 * **Linha que não é JSON não derruba o fluxo**: ela vai para o log e a leitura
 * segue. Um evento perdido custa um quadro da tela; abortar a leitura custaria
 * a conexão inteira, e é a conexão que carrega os próximos.
 *
 * O `stream: true` do decodificador é o que impede um caractere acentuado
 * partido entre dois chunks de virar "�" no meio de uma resposta em
 * português.
 */
export async function lerEventos<T>(
  corpo: ReadableStream<Uint8Array>,
  aoEvento: (evento: T) => void,
  rotulo = "ndjson",
): Promise<void> {
  const leitor = corpo.getReader();
  const decodificador = new TextDecoder();
  let sobra = "";

  for (;;) {
    const { done, value } = await leitor.read();
    sobra += decodificador.decode(value ?? new Uint8Array(), { stream: !done });
    const { linhas, resto } = partirLinhas(sobra);
    sobra = resto;

    for (const linha of linhas) {
      let e: T;
      try {
        e = JSON.parse(linha) as T;
      } catch {
        console.error(`[${rotulo}] linha que não é JSON:`, linha.slice(0, 200));
        continue;
      }
      aoEvento(e);
    }

    if (done) break;
  }
}
