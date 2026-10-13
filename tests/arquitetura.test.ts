/**
 * Guarda do inventário da documentação.
 *
 * O `ARCHITECTURE.md` é o mapa, e os capítulos moram em `arquitetura/`
 * (`Specs/documentacao.md`). Este teste cobra que nada do sistema fique sem
 * texto: todo módulo no §2, toda rota no §10, toda variável no §12, toda
 * migration no §8, todo agente em algum lugar — e que toda referência `§x.y`
 * do código aponte para um cabeçalho que existe. Cobra também a forma: o
 * tamanho de cada arquivo, e nenhuma data nem ID de sessão, que são crônica e
 * moram no "Como ficou" da spec da fatia.
 *
 * Mesmo molde de `tests/gateway.test.ts`: se ele te barrou, o conserto é
 * escrever o texto que falta, não afrouxar o teste.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { AGENTES } from "@/lib/agentes";

const MAPA = "ARCHITECTURE.md";
const CAPITULOS = "arquitetura";
const LIMITE_MAPA = 50 * 1024;
const LIMITE_CAPITULO = 120 * 1024;

type Doc = { arquivo: string; texto: string };

/** O mapa primeiro, depois os capítulos na ordem do nome — que é a do §. */
function documentos(): Doc[] {
  const capitulos = existsSync(CAPITULOS)
    ? readdirSync(CAPITULOS)
        .filter((f) => f.endsWith(".md"))
        .sort()
        .map((f) => join(CAPITULOS, f))
    : [];
  return [MAPA, ...capitulos].map((arquivo) => ({
    arquivo,
    texto: readFileSync(arquivo, "utf8").replace(/\r\n/g, "\n"),
  }));
}

const DOCS = documentos();
const TUDO = DOCS.map((d) => d.texto).join("\n");

/** `## 4.`, `### 4.8.1`, `#### 4.15.3` → "4", "4.8.1", "4.15.3". */
const CABECALHO = /^#{2,4} (\d+(?:\.\d+)*)\.?\s/gm;

const CABECALHOS = new Set([...TUDO.matchAll(CABECALHO)].map((m) => m[1]));

/**
 * O texto de uma seção de topo: do `## n.` até o próximo `## `, dentro do
 * arquivo onde ela está. Funciona antes e depois da divisão.
 */
function secao(n: number): string {
  for (const { texto } of DOCS) {
    const linhas = texto.split("\n");
    const ini = linhas.findIndex((l) => new RegExp(`^## ${n}\\.\\s`).test(l));
    if (ini < 0) continue;
    const fim = linhas.findIndex((l, i) => i > ini && /^## /.test(l));
    return linhas.slice(ini, fim < 0 ? undefined : fim).join("\n");
  }
  return "";
}

function arquivos(raiz: string, re: RegExp): string[] {
  return readdirSync(raiz, { recursive: true, encoding: "utf8" })
    .filter((p) => re.test(p))
    .map((p) => join(raiz, p));
}

/** `src/app/api/sessoes/[id]/chunks/[i]/url/route.ts` → `/api/sessoes/:id/chunks/:i/url`. */
function rotaDe(arquivo: string): string {
  return arquivo
    .replace(/\\/g, "/")
    .replace(/^src\/app/, "")
    .replace(/\/route\.ts$/, "")
    .replace(/\[([^\]]+)\]/g, ":$1");
}

/** A rota citada inteira — `/api/sessoes` não vale por `/api/sessoes/:id`. */
function citaRota(texto: string, rota: string): boolean {
  const esc = rota.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${esc}(?![\\w:/-])`).test(texto);
}

/** `§4.8.1`, `§ 14` — o número, sem o ponto final de frase. */
const REFERENCIA = /§ ?(\d+(?:\.\d+)*)/g;

/**
 * Nas specs, `§` também aponta para a própria spec e para documentos que já
 * não existem; só conta o que diz que é do `ARCHITECTURE`.
 */
const REFERENCIA_NA_SPEC = /ARCHITECTURE(?:\.md)?`?\s*§ ?(\d+(?:\.\d+)*)/g;

/** Crônica: `2026-09-02`, `2026-09`, `29/09`. */
const DATA = /\b20\d\d-(?:0[1-9]|1[0-2])(?:-\d\d)?\b|\b\d{1,2}\/(?:0[1-9]|1[0-2])\b/;

/** ID de sessão: base36 longo, com letra e dígito (`mu73d88b0w4u6o5d440j`). */
const ID_SESSAO = /\b(?=[0-9a-z]*\d)(?=[0-9a-z]*[a-z])[0-9a-z]{16,40}\b/;

/** Lidas fora do §12 de propósito: o ambiente do Node e o exemplo num comentário. */
const VARIAVEIS_FORA = new Set(["NODE_ENV", "NOME"]);

describe("inventário da documentação", () => {
  it("lê um mapa e um corpo que não estão vazios", () => {
    // Sem isto, um erro de caminho faria os testes abaixo passarem sem olhar nada.
    expect(DOCS[0].arquivo).toBe(MAPA);
    expect(CABECALHOS.size).toBeGreaterThan(50);
    for (const n of [2, 8, 10, 12]) expect(secao(n), `§${n}`).not.toBe("");
  });

  it("os próprios padrões pegam o que deveriam", () => {
    expect(DATA.test("medido em 2026-09-02")).toBe(true);
    expect(DATA.test("no ar desde 29/09")).toBe(true);
    expect(DATA.test("1/2 do bloco, 30 s")).toBe(false);
    expect(ID_SESSAO.test("sessão `mu73d88b0w4u6o5d440j`")).toBe(true);
    expect(ID_SESSAO.test("identidadeporcontexto")).toBe(false);
    expect(rotaDe(join("src", "app", "api", "sessoes", "[id]", "chunks", "[i]", "url", "route.ts"))).toBe(
      "/api/sessoes/:id/chunks/:i/url",
    );
    expect(citaRota("`GET /api/sessoes/:id/extracao`", "/api/sessoes/:id")).toBe(false);
    expect(citaRota("`GET /api/sessoes/:id` |", "/api/sessoes/:id")).toBe(true);
  });

  it("todo módulo de src/lib, src/client e src/components está no §2", () => {
    const s2 = secao(2);
    const modulos = ["src/lib", "src/client", "src/components"].flatMap((r) =>
      arquivos(r, /\.(ts|tsx)$/),
    );
    expect(modulos.length).toBeGreaterThan(40);
    const faltam = modulos.filter((m) => !s2.includes(basename(m)));
    expect(faltam, "módulo sem linha no mapa dos módulos").toEqual([]);
  });

  it("toda rota de src/app/api está no §10", () => {
    const s10 = secao(10);
    const rotas = arquivos(join("src", "app", "api"), /(^|[\\/])route\.ts$/).map(rotaDe);
    expect(rotas.length).toBeGreaterThan(30);
    const faltam = rotas.filter((r) => !citaRota(s10, r));
    expect(faltam, "rota sem linha na tabela de rotas").toEqual([]);
  });

  it("todo agente de AGENTES é citado", () => {
    const faltam = AGENTES.map((a) => a.id).filter((id) => !TUDO.includes(id));
    expect(faltam).toEqual([]);
  });

  it("toda variável de ambiente lida está no §12", () => {
    const s12 = secao(12);
    const lidas = new Set<string>();
    for (const f of arquivos("src", /\.(ts|tsx)$/)) {
      const fonte = readFileSync(f, "utf8");
      for (const m of fonte.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) lidas.add(m[1]);
      for (const m of fonte.matchAll(/\breq\(\s*"([A-Z][A-Z0-9_]*)"\s*\)/g)) lidas.add(m[1]);
    }
    const faltam = [...lidas].filter((v) => !VARIAVEIS_FORA.has(v) && !s12.includes(v));
    expect(lidas.size).toBeGreaterThan(15);
    expect(faltam, "variável lida pelo código e ausente do §12").toEqual([]);
  });

  it("toda migration de db/migrations está no §8", () => {
    const s8 = secao(8);
    const numeros = readdirSync(join("db", "migrations"))
      .filter((f) => f.endsWith(".cypher"))
      .map((f) => f.slice(0, 3));
    expect(numeros.length).toBeGreaterThan(10);
    const faltam = numeros.filter((n) => !new RegExp(`\\b${n}(?:_|\\b)`).test(s8));
    expect(faltam, "migration que o §8 não cita").toEqual([]);
  });

  it("todo § citado no código e nas specs existe como cabeçalho", () => {
    const quebradas: string[] = [];
    const varrer = (arqs: string[], re: RegExp) => {
      for (const f of arqs) {
        for (const m of readFileSync(f, "utf8").matchAll(re)) {
          if (!CABECALHOS.has(m[1])) quebradas.push(`${f}: §${m[1]}`);
        }
      }
    };
    varrer(
      ["src", "tests", "db", "scripts"].flatMap((r) => arquivos(r, /\.(ts|tsx|mjs|cypher)$/)),
      REFERENCIA,
    );
    varrer(arquivos("Specs", /\.md$/), REFERENCIA_NA_SPEC);
    expect(quebradas, "referência § para cabeçalho que não existe").toEqual([]);
  });

  it("o mapa e cada capítulo cabem no limite", () => {
    const grandes = DOCS.filter(({ arquivo }) => {
      const limite = arquivo === MAPA ? LIMITE_MAPA : LIMITE_CAPITULO;
      return statSync(arquivo).size > limite;
    }).map(({ arquivo }) => `${arquivo}: ${Math.round(statSync(arquivo).size / 1024)} KB`);
    expect(grandes).toEqual([]);
  });

  it("nenhuma data nem ID de sessão no mapa e nos capítulos", () => {
    const cronica = DOCS.flatMap(({ arquivo, texto }) =>
      texto
        .split("\n")
        .map((linha, i) => ({ linha, i }))
        .filter(({ linha }) => DATA.test(linha) || ID_SESSAO.test(linha))
        .map(({ linha, i }) => `${arquivo}:${i + 1}: ${linha.trim().slice(0, 80)}`),
    );
    expect(cronica, "crônica vai para o \"Como ficou\" da spec da fatia").toEqual([]);
  });
});
