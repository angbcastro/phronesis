/**
 * Compara modelos no confronto (slice 5.2): os mesmos átomos reais, o mesmo
 * prompt `confronto-3`, um modelo por coluna — e uma página para eu ler lado a
 * lado e escolher.
 *
 *   COMPARAR_MODELOS=deepseek/deepseek-v4.1-flash,outro/modelo pnpm comparar:confronto
 *   COMPARAR_ALVOS=20 ...                 quantos átomos (padrão 15)
 *   COMPARAR_IDS=mtgn3zf7-4,mtgn3zf7-9 ...  átomos escolhidos à mão, no lugar da amostra
 *   COMPARAR_SAIDA=caminho.html ...         onde escrever (padrão: pasta temporária)
 *
 * **Só lê o grafo.** Usa as mesmas consultas da fila — `alvosDoLote` e
 * `candidatosDeLote` — e o mesmo juiz, `decidirAlvo`, com o modelo dado direto:
 * prompt e limiar da base, sem ler o painel. Nada é gravado, nenhum átomo é
 * reivindicado; o custo é o das chamadas de modelo, e só.
 *
 * **Por que importa de `src/`**, ao contrário dos outros scripts: uma cópia do
 * prompt e do parser aqui mediria um juiz que não é o de produção, e divergiria
 * em silêncio no primeiro ajuste. `gancho-src.mjs` resolve o `@/` e o import
 * sem extensão; `--experimental-transform-types` cobre o que o node não sabe
 * só apagar.
 *
 * **A amostra é determinística**: os átomos datados, em ordem de data,
 * espaçados por igual — o começo, o meio e o fim do diário, e a mesma lista em
 * duas rodadas, para comparar um modelo novo contra o resultado de ontem.
 */
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  alvosDoLote,
  candidatosDeLote,
  decidirAlvo,
  distancia,
  type AtomoAlvo,
  type Decisao,
} from "@/lib/confronto";
import { query } from "@/lib/neo4j";
import type { CandidatoDeConfronto } from "@/lib/tipos";

const MODELOS = (process.env.COMPARAR_MODELOS ?? "")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);
const QUANTOS = Number(process.env.COMPARAR_ALVOS || "15");
const IDS = (process.env.COMPARAR_IDS ?? "")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);

/** Cada modelo julga um alvo por vez; os modelos de um alvo vão em paralelo. */
interface Resultado {
  modelo: string;
  ms: number;
  decisao: Decisao | null;
  erro: string | null;
}

async function amostra(): Promise<string[]> {
  if (IDS.length > 0) return IDS;
  const linhas = await query<{ id: string }>(
    `MATCH (a:Atomo)
     WHERE coalesce(a.status, 'ativo') = 'ativo'
       AND a.embedding IS NOT NULL
       AND coalesce(a.valido_em, '') <> ''
     RETURN a.id AS id
     ORDER BY a.valido_em ASC, a.id ASC`,
  );
  const todos = linhas.map((l) => l.id);
  if (todos.length <= QUANTOS) return todos;
  const passo = todos.length / QUANTOS;
  return Array.from({ length: QUANTOS }, (_, i) => todos[Math.floor(i * passo)]);
}

async function julgar(
  alvo: AtomoAlvo,
  candidatos: CandidatoDeConfronto[],
  modelo: string,
): Promise<Resultado> {
  const t0 = Date.now();
  try {
    const decisao = await decidirAlvo(alvo, candidatos, { modelo });
    return { modelo, ms: Date.now() - t0, decisao, erro: null };
  } catch (e) {
    return { modelo, ms: Date.now() - t0, decisao: null, erro: e instanceof Error ? e.message : String(e) };
  }
}

const esc = (t: string) =>
  t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function coluna(alvo: AtomoAlvo, candidatos: CandidatoDeConfronto[], r: Resultado): string {
  const tok = r.decisao?.tokens;
  const cabeca = `<h4>${esc(r.modelo)}</h4><p class="meta">${(r.ms / 1000).toFixed(1)} s` +
    (tok ? ` · entrada ${tok.entrada ?? "?"} · saída ${tok.saida ?? "?"} · raciocínio ${tok.raciocinio ?? "?"}` : "") +
    `</p>`;
  if (r.erro) return `<div class="col">${cabeca}<p class="erro">${esc(r.erro)}</p></div>`;

  const porId = new Map(candidatos.map((c) => [c.id, c]));
  const itens = (r.decisao?.relacoes ?? []).map((rel) => {
    const outroId = rel.novo_id === alvo.id ? rel.velho_id : rel.novo_id;
    const outro = porId.get(outroId);
    const lado = outro ? distancia(alvo, outro) : "";
    return `<li class="${rel.camada}"><b>${rel.tipo}</b> · ${rel.camada} · ${rel.confianca.toFixed(2)}` +
      ` <span class="meta">(${esc(lado)})</span>` +
      `<br><span class="vizinho">${esc(outro ? `[${outro.tipo}] ${outro.texto}` : outroId)}</span>` +
      `<br><span class="motivo">${esc(rel.motivo)}</span></li>`;
  });
  const extra = r.decisao && (r.decisao.rebaixadas > 0 || r.decisao.cortadas > 0)
    ? `<p class="meta">${r.decisao.rebaixadas} rebaixada(s) · ${r.decisao.cortadas} cortada(s) pelo teto</p>`
    : "";
  return `<div class="col">${cabeca}${extra}${itens.length === 0 ? "<p class=\"meta\">nenhuma relação</p>" : `<ul>${itens.join("")}</ul>`}</div>`;
}

function resumo(todos: Resultado[][]): string {
  const linhas = MODELOS.map((m) => {
    const deste = todos.flat().filter((r) => r.modelo === m);
    const ok = deste.filter((r) => r.decisao);
    const rel = ok.flatMap((r) => r.decisao!.relacoes);
    const media = ok.length === 0 ? 0 : ok.reduce((s, r) => s + r.ms, 0) / ok.length / 1000;
    const saida = ok.reduce((s, r) => s + (r.decisao!.tokens.saida ?? 0), 0);
    return `<tr><td>${esc(m)}</td><td>${rel.filter((x) => x.camada === "forte").length}</td>` +
      `<td>${rel.filter((x) => x.camada === "sutil").length}</td><td>${media.toFixed(1)} s</td>` +
      `<td>${saida}</td><td>${deste.length - ok.length}</td></tr>`;
  });
  return `<table><tr><th>modelo</th><th>fortes</th><th>sutis</th><th>tempo médio</th><th>tokens de saída</th><th>falhas</th></tr>${linhas.join("")}</table>`;
}

async function main() {
  if (MODELOS.length === 0) {
    console.error("diga os modelos: COMPARAR_MODELOS=provedor/modelo,provedor/outro");
    process.exit(1);
  }

  const ids = await amostra();
  console.log(`[comparar] ${ids.length} átomo(s), ${MODELOS.length} modelo(s): ${MODELOS.join(", ")}`);

  const alvos = await alvosDoLote(ids);
  const candidatos = await candidatosDeLote(alvos.map((a) => a.id));

  const blocos: string[] = [];
  const todos: Resultado[][] = [];
  for (const [i, alvo] of alvos.entries()) {
    const seus = candidatos[alvo.id] ?? [];
    console.log(`[comparar] ${i + 1}/${alvos.length} ${alvo.id}: ${seus.length} candidato(s)`);
    const resultados = await Promise.all(MODELOS.map((m) => julgar(alvo, seus, m)));
    todos.push(resultados);
    for (const r of resultados) {
      console.log(
        `  ${r.modelo}: ${r.erro ? `falhou — ${r.erro.slice(0, 120)}` : `${r.decisao!.relacoes.length} relação(ões)`}` +
          ` em ${(r.ms / 1000).toFixed(1)} s`,
      );
    }
    blocos.push(
      `<section><h3>[${alvo.tipo}] ${esc(alvo.valido_em.slice(0, 10))} · ${esc(alvo.id)}</h3>` +
        `<p class="alvo">${esc(alvo.texto)}</p><p class="meta">${seus.length} candidato(s)</p>` +
        `<div class="cols">${resultados.map((r) => coluna(alvo, seus, r)).join("")}</div></section>`,
    );
  }

  const pagina = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Comparação do confronto</title>
<style>
:root { color-scheme: dark; --fundo:#0d0d0d; --alto:#1a1a1c; --texto:#ececec; --fraco:#8a8a8f; --linha:#2a2a2e; --acento:#d65a31; }
body { background: var(--fundo); color: var(--texto); font: 15px/1.45 system-ui, sans-serif; margin: 0 auto; padding: 1.5rem 1rem 4rem; max-width: 90rem; }
h1 { font-size: 1.2rem; } h3 { font-size: 1rem; margin: 0 0 .3rem; } h4 { font-size: .9rem; margin: 0; }
section { border-top: 1px solid var(--linha); padding: 1rem 0; }
.alvo { margin: 0 0 .3rem; } .meta { color: var(--fraco); font-size: .8rem; margin: .2rem 0; }
.cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr)); gap: .8rem; }
.col { background: var(--alto); border-radius: .6rem; padding: .7rem; min-width: 0; }
ul { margin: .4rem 0 0; padding-left: 1rem; } li { margin: 0 0 .6rem; }
li.sutil b { font-style: italic; } .vizinho { color: var(--fraco); } .motivo { font-size: .85rem; }
.erro { color: var(--acento); overflow-wrap: anywhere; }
table { border-collapse: collapse; margin: .5rem 0 1rem; } td, th { border-bottom: 1px solid var(--linha); padding: .3rem .7rem; text-align: left; }
</style></head><body>
<h1>Confronto — ${esc(MODELOS.join(" × "))}</h1>
<p class="meta">${alvos.length} átomo(s), prompt confronto-3, gerado em ${new Date().toISOString()}</p>
${resumo(todos)}
${blocos.join("\n")}
</body></html>`;

  const saida = process.env.COMPARAR_SAIDA || join(tmpdir(), `comparacao-confronto-${Date.now()}.html`);
  writeFileSync(saida, pagina, "utf-8");
  console.log(`[comparar] escrito em ${saida}`);
}

main().catch((e) => {
  console.error("[comparar] falhou:", e);
  process.exit(1);
});
