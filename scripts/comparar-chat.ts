/**
 * Compara modelos no chat (slice 12): as mesmas perguntas, o mesmo prompt
 * `chat-8`, um modelo por coluna — e uma página para eu ler lado a lado e
 * escolher.
 *
 *   pnpm comparar:chat caminho/das/perguntas.txt
 *   COMPARAR_MODELOS=deepseek/deepseek-v4.1-flash,outro/modelo ...  (padrão: os três da slice 12)
 *   COMPARAR_SAIDA=caminho.html ...                                 (padrão: pasta temporária)
 *
 * **As perguntas são minhas, uma por linha, e não moram no repositório.** Não são
 * gabarito nem fixture (`CLAUDE.md`): se a resposta presta, quem diz sou eu,
 * lendo a página.
 *
 * **Só lê o grafo.** Chama `responder()` — o loop, as ferramentas e o prompt de
 * produção — com o modelo dado direto, sem ler o painel, e não grava conversa:
 * nem `:Conversa`, nem R2. O custo é o das chamadas de modelo, e só.
 *
 * **Uma pergunta de vários turnos mede só o primeiro.** "Me teste" devolve a
 * primeira pergunta do teste; a correção se confere no app.
 *
 * Importa de `src/` pelo mesmo motivo do `comparar-confronto.ts`: uma cópia do
 * loop aqui mediria um chat que não é o de produção. Ao lado do HTML sai um
 * JSON com tudo — o rastro inteiro de cada resposta.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PROMPT_VERSION_CHAT, responder, type UsoDeTokens } from "@/lib/chat";
import { FERRAMENTAS_CHAT, type PassoDeFerramenta } from "@/lib/tipos";

/** Os três da decisão da slice 12: o de raciocínio forte, a linha de base e o barato. */
const PADRAO = ["anthropic/claude-sonnet-5.5", "deepseek/deepseek-v4.1-flash", "zai/glm-5.3-flash"];

const MODELOS = (process.env.COMPARAR_MODELOS ?? "")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);
const modelos = MODELOS.length > 0 ? MODELOS : PADRAO;

interface Rodada {
  modelo: string;
  ms: number;
  texto: string;
  rastro: PassoDeFerramenta[];
  uso: UsoDeTokens | null;
  modelo_respondeu: string | null;
  erro: string | null;
}

async function rodar(pergunta: string, modelo: string): Promise<Rodada> {
  const t0 = Date.now();
  try {
    const r = await responder([{ papel: "eu", texto: pergunta, criado_em: new Date().toISOString() }], {
      modelo,
    });
    return {
      modelo,
      ms: Date.now() - t0,
      texto: r.texto,
      rastro: r.rastro,
      uso: r.uso,
      modelo_respondeu: r.modelo,
      erro: null,
    };
  } catch (e) {
    return {
      modelo,
      ms: Date.now() - t0,
      texto: "",
      rastro: [],
      uso: null,
      modelo_respondeu: null,
      erro: e instanceof Error ? e.message : String(e),
    };
  }
}

const consultas = (r: Rodada) => r.rastro.filter((p) => p.ferramenta === "consultar_grafo");
const consultasComErro = (r: Rodada) => consultas(r).filter((p) => p.erro).length;

const esc = (t: string) =>
  t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const seg = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const tok = (n: number | null | undefined) => (typeof n === "number" ? n.toLocaleString("pt-BR") : "?");

function celula(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v) && v.every((x) => x === null || typeof x !== "object")) return v.join(", ");
  return JSON.stringify(v);
}

/** Um passo do rastro, como o (i) o abriria — com tudo à vista. */
function passo(p: PassoDeFerramenta, i: number): string {
  const ms = typeof p.duracao_ms === "number" ? ` · ${seg(p.duracao_ms)}` : "";
  const params = Object.keys(p.parametros ?? {}).length > 0 ? ` <code>${esc(JSON.stringify(p.parametros))}</code>` : "";
  const partes = [`<p class="cab">${i + 1}. <b>${esc(p.ferramenta)}</b>${params}${ms}</p>`];
  if (p.erro) partes.push(`<p class="erro">${esc(p.erro)}</p>`);
  const c = p.consulta;
  if (c) {
    if (c.texto) partes.push(`<p class="meta">sentido: “${esc(c.texto)}”</p>`);
    for (const a of c.avisos ?? []) partes.push(`<p class="meta">aviso do banco: ${esc(a)}</p>`);
    partes.push(`<pre>${esc(c.cypher)}</pre>`);
    const quantas = c.cortado ? `${c.linhas.length} de ${c.total} linhas (cortado)` : `${c.total} linha(s)`;
    if (c.linhas.length > 0) {
      partes.push(
        `<details><summary>${quantas}</summary><div class="tabela"><table><tr>${c.colunas
          .map((col) => `<th>${esc(col)}</th>`)
          .join("")}</tr>${c.linhas
          .map((l) => `<tr>${l.map((v) => `<td>${esc(celula(v))}</td>`).join("")}</tr>`)
          .join("")}</table></div></details>`,
      );
    } else {
      partes.push(`<p class="meta">${quantas}</p>`);
    }
  }
  if (p.achados.length > 0) {
    partes.push(
      `<details><summary>${p.achados.length} trecho(s)</summary><ul>${p.achados
        .map(
          (a) =>
            `<li><span class="meta">${esc(a.tipo)} · ${esc(a.valido_em.slice(0, 10))}${
              typeof a.similaridade === "number" ? ` · ${a.similaridade.toFixed(2)}` : ""
            }</span> ${esc(a.texto)}</li>`,
        )
        .join("")}</ul></details>`,
    );
  }
  if ((p.entidades?.length ?? 0) > 0) {
    partes.push(`<p class="meta">fichas: ${esc(p.entidades!.map((e) => e.nome).join(", "))}</p>`);
  }
  if (p.retrato) partes.push(`<p class="meta">retrato: ${esc(p.retrato.nome || "o Agora")}</p>`);
  return `<div class="passo">${partes.join("")}</div>`;
}

function coluna(r: Rodada): string {
  const u = r.uso;
  const meta =
    `${seg(r.ms)} · ${r.rastro.length} chamada(s) · ${consultas(r).length} consulta(s), ` +
    `${consultasComErro(r)} com erro` +
    (u ? ` · entrada ${tok(u.entrada)} · saída ${tok(u.saida)} · raciocínio ${tok(u.raciocinio)}` : "");
  const cabeca = `<h4>${esc(r.modelo)}</h4><p class="meta">${meta}</p>`;
  if (r.erro) return `<div class="col">${cabeca}<p class="erro">${esc(r.erro)}</p></div>`;
  return (
    `<div class="col">${cabeca}<div class="resposta">${esc(r.texto)}</div>` +
    `<details class="rastro"><summary>como procurou</summary>${r.rastro.map(passo).join("")}</details></div>`
  );
}

function resumo(todas: Rodada[][]): string {
  const linhas = modelos.map((m) => {
    const deste = todas.flat().filter((r) => r.modelo === m);
    const ok = deste.filter((r) => !r.erro);
    const media = (f: (r: Rodada) => number) =>
      ok.length === 0 ? 0 : ok.reduce((s, r) => s + f(r), 0) / ok.length;
    const soma = (f: (u: UsoDeTokens) => number | null) =>
      ok.reduce((s, r) => s + (r.uso ? (f(r.uso) ?? 0) : 0), 0);
    return (
      `<tr><td>${esc(m)}</td><td>${seg(media((r) => r.ms))}</td>` +
      `<td>${media((r) => r.rastro.length).toFixed(1)}</td>` +
      `<td>${ok.reduce((s, r) => s + consultas(r).length, 0)}</td>` +
      `<td>${ok.reduce((s, r) => s + consultasComErro(r), 0)}</td>` +
      `<td>${tok(soma((u) => u.entrada))}</td><td>${tok(soma((u) => u.saida))}</td>` +
      `<td>${tok(soma((u) => u.raciocinio))}</td><td>${deste.length - ok.length}</td></tr>`
    );
  });
  return (
    `<table><tr><th>modelo</th><th>tempo médio</th><th>chamadas por pergunta</th><th>consultas</th>` +
    `<th>com erro</th><th>tokens de entrada</th><th>de saída</th><th>de raciocínio</th><th>falhas</th></tr>` +
    `${linhas.join("")}</table>`
  );
}

/** Quantas vezes cada ferramenta foi chamada, por modelo — é o que decide o `chat-9`. */
function usoDasFerramentas(todas: Rodada[][]): string {
  const linhas = modelos.map((m) => {
    const passos = todas.flat().filter((r) => r.modelo === m).flatMap((r) => r.rastro);
    return `<tr><td>${esc(m)}</td>${FERRAMENTAS_CHAT.map(
      (f) => `<td>${passos.filter((p) => p.ferramenta === f).length}</td>`,
    ).join("")}</tr>`;
  });
  return `<table><tr><th>modelo</th>${FERRAMENTAS_CHAT.map((f) => `<th>${f}</th>`).join("")}</tr>${linhas.join("")}</table>`;
}

async function main() {
  const arquivo = process.argv[2];
  if (!arquivo) {
    console.error("diga o arquivo das perguntas, uma por linha: pnpm comparar:chat caminho.txt");
    process.exit(1);
  }
  const perguntas = readFileSync(arquivo, "utf-8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"));
  console.log(`[comparar] ${perguntas.length} pergunta(s), ${modelos.length} modelo(s): ${modelos.join(", ")}`);

  const todas: Rodada[][] = [];
  const blocos: string[] = [];
  for (const [i, pergunta] of perguntas.entries()) {
    console.log(`[comparar] ${i + 1}/${perguntas.length} ${pergunta}`);
    // Os modelos de uma pergunta vão em paralelo; as perguntas, uma por vez.
    const rodadas = await Promise.all(modelos.map((m) => rodar(pergunta, m)));
    todas.push(rodadas);
    for (const r of rodadas) {
      console.log(
        `  ${r.modelo}: ${r.erro ? `falhou — ${r.erro.slice(0, 120)}` : `${r.rastro.length} chamada(s), ${consultasComErro(r)} consulta(s) com erro`}` +
          ` em ${seg(r.ms)}`,
      );
    }
    blocos.push(
      `<section><h3>${i + 1}. ${esc(pergunta)}</h3><div class="cols">${rodadas.map(coluna).join("")}</div></section>`,
    );
  }

  const pagina = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Comparação do chat</title>
<style>
:root { color-scheme: dark; --fundo:#0d0d0d; --alto:#1a1a1c; --texto:#ececec; --fraco:#8a8a8f; --linha:#2a2a2e; --acento:#d65a31; }
body { background: var(--fundo); color: var(--texto); font: 15px/1.45 system-ui, sans-serif; margin: 0 auto; padding: 1.5rem 1rem 4rem; max-width: 110rem; }
h1 { font-size: 1.2rem; } h2 { font-size: 1rem; margin: 1.5rem 0 .3rem; } h3 { font-size: 1rem; margin: 0 0 .5rem; } h4 { font-size: .9rem; margin: 0; }
section { border-top: 1px solid var(--linha); padding: 1rem 0; }
.meta { color: var(--fraco); font-size: .8rem; margin: .2rem 0; }
.cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(22rem, 1fr)); gap: .8rem; align-items: start; }
.col { background: var(--alto); border-radius: .6rem; padding: .7rem; min-width: 0; }
.resposta { white-space: pre-wrap; overflow-wrap: anywhere; margin: .6rem 0; }
.rastro summary, details summary { cursor: pointer; color: var(--fraco); font-size: .85rem; }
.passo { border-top: 1px dashed var(--linha); padding: .4rem 0; font-size: .85rem; }
.cab { margin: 0 0 .2rem; } code { font-size: .78rem; color: var(--fraco); overflow-wrap: anywhere; }
pre { background: var(--fundo); border: 1px solid var(--linha); border-radius: .4rem; padding: .5rem; font-size: .75rem; white-space: pre-wrap; overflow-wrap: anywhere; margin: .3rem 0; }
.tabela { overflow: auto; max-height: 20rem; }
.erro { color: var(--acento); overflow-wrap: anywhere; }
.resposta-md { margin: .6rem 0; overflow-wrap: anywhere; } .resposta-md table { display: block; overflow-x: auto; }
body.md .resposta { display: none; } body:not(.md) .resposta-md { display: none; }
label.alterna { position: sticky; top: 0; display: inline-block; background: var(--alto); padding: .3rem .6rem; border-radius: .4rem; font-size: .85rem; z-index: 1; }
table { border-collapse: collapse; margin: .5rem 0 1rem; font-size: .8rem; } td, th { border-bottom: 1px solid var(--linha); padding: .25rem .6rem; text-align: left; vertical-align: top; }
ul { margin: .3rem 0 0; padding-left: 1rem; } li { margin: 0 0 .3rem; }
</style></head><body>
<h1>Chat — ${esc(modelos.join(" × "))}</h1>
<p class="meta">${perguntas.length} pergunta(s), prompt ${PROMPT_VERSION_CHAT}, gerado em ${new Date().toISOString()}. A resposta aparece como texto cru, que é como a tela do chat a mostra hoje; a caixa abaixo a mostra com o markdown renderizado.</p>
<label class="alterna"><input type="checkbox" id="md"> mostrar com markdown</label>
<h2>O resumo</h2>
${resumo(todas)}
<h2>As ferramentas chamadas</h2>
${usoDasFerramentas(todas)}
${blocos.join("\n")}
<script src="https://cdnjs.cloudflare.com/ajax/libs/marked/12.0.2/marked.min.js"></script>
<script>
// Só para comparar as duas formas: a tela do chat não renderiza markdown.
const caixa = document.getElementById("md");
for (const r of document.querySelectorAll(".resposta")) {
  const md = document.createElement("div");
  md.className = "resposta-md";
  md.innerHTML = window.marked ? marked.parse(r.textContent) : "(sem o marked, não dá para renderizar)";
  r.after(md);
}
caixa.addEventListener("change", () => document.body.classList.toggle("md", caixa.checked));
</script>
</body></html>`;

  const saida = process.env.COMPARAR_SAIDA || join(tmpdir(), `comparacao-chat-${Date.now()}.html`);
  writeFileSync(saida, pagina, "utf-8");
  writeFileSync(saida.replace(/\.html?$/, "") + ".json", JSON.stringify({ modelos, perguntas, todas }, null, 2), "utf-8");
  console.log(`[comparar] escrito em ${saida}`);
}

main().catch((e) => {
  console.error("[comparar] falhou:", e);
  process.exit(1);
});
