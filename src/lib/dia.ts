/**
 * O dia de Brasília (slice 12): a data que o chat diz.
 *
 * `valido_em`, `criado_em` e companhia são instantes ISO em UTC, e cortar os dez
 * primeiros caracteres dá o dia de Greenwich — a sessão gravada depois das 21h
 * sai com o dia seguinte. Num diário falado à noite isso não é borda: quando a
 * fatia contou, eram 60 dos 226 átomos. O chat inteiro converte por aqui —
 * `$hoje`, o "Hoje é", os filtros e as datas das ferramentas, o (i) e a lista de
 * conversas. O resto do sistema ainda corta (§14).
 *
 * Puro, sem rede nem credencial: o servidor e a tela importam o mesmo. A conta
 * em Cypher, para filtrar no banco, é `diaEmCypher` (chat.ts).
 */

export const FUSO = "America/Sao_Paulo";

const formato = new Intl.DateTimeFormat("en-CA", {
  timeZone: FUSO,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * `AAAA-MM-DD` de Brasília para um instante; "" quando não é instante.
 *
 * Uma data sem hora já é um dia, e volta como veio: `new Date("2026-09-13")` é a
 * meia-noite de Greenwich, e convertê-la daria o dia 12.
 */
export function diaLocal(instante: string | Date): string {
  if (typeof instante === "string") {
    const s = instante.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    if (s === "") return "";
    instante = new Date(s);
  }
  if (Number.isNaN(instante.getTime())) return "";
  const p = Object.fromEntries(formato.formatToParts(instante).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

/** Hoje, em Brasília. */
export const hojeLocal = (agora: Date = new Date()): string => diaLocal(agora);
