/**
 * O dia de Brasília (slice 12): a data que o chat diz.
 *
 * `valido_em`, `criado_em` e companhia são instantes ISO em UTC, e cortar os dez
 * primeiros caracteres dá o dia de Greenwich — a sessão gravada depois das 21h
 * sai com o dia seguinte. Num diário falado à noite isso não é borda: quando a
 * fatia contou, eram 60 dos 226 átomos. O chat inteiro converte por aqui —
 * `$hoje`, o "Hoje é", os filtros e as datas das ferramentas, o (i) e a lista de
 * conversas. As telas também passam por aqui, por `dataCurta` e `dataEHora`; os
 * prompts dos outros agentes ainda cortam (§14).
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

const hora = new Intl.DateTimeFormat("en-GB", {
  timeZone: FUSO,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/**
 * A data das telas: `14/09`, e `14/09/2025` fora do ano corrente. "" quando
 * não é data.
 *
 * Dia/mês/ano, que é como eu leio — e um formato só para o sistema inteiro:
 * eram quatro (`12 de ago`, `12 ago 26`, `13/09`, `14/09/2026`), e os que
 * cortavam a string davam o dia de Greenwich. O ano só entra quando muda
 * alguma coisa: o radial e a lista de sessões atravessam anos, e o resto quase
 * nunca.
 */
export function dataCurta(instante: string, agora: Date = new Date()): string {
  const d = diaLocal(instante);
  if (d === "") return "";
  const [ano, mes, dia] = d.split("-");
  return ano === hojeLocal(agora).slice(0, 4) ? `${dia}/${mes}` : `${dia}/${mes}/${ano}`;
}

/**
 * A data com hora, para quando a hora diz algo — a lista de sessões:
 * `hoje, 21:03`, `ontem, 21:03`, `12/08, 21:03`. "" quando não é instante.
 */
export function dataEHora(instante: string, agora: Date = new Date()): string {
  const d = diaLocal(instante);
  if (d === "") return "";
  // Um dia sem hora não tem hora a dizer.
  if (/^\d{4}-\d{2}-\d{2}$/.test(instante.trim())) return dataCurta(d, agora);
  const hhmm = hora.format(new Date(instante));
  const hoje = hojeLocal(agora);
  // Brasília não tem horário de verão desde 2019: um dia são 24 h.
  const ontem = diaLocal(new Date(agora.getTime() - 86_400_000));
  const dia = d === hoje ? "hoje" : d === ontem ? "ontem" : dataCurta(d, agora);
  return `${dia}, ${hhmm}`;
}
