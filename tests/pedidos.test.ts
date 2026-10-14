/**
 * O que faltou, a pedido (slice 11).
 *
 * Quatro invariantes justificam este arquivo, e nenhuma delas aparece na tela
 * até ser tarde:
 *
 *   1. **O átomo pedido não colide com ninguém.** O id é `<sessao_id>-<n>`, e é
 *      ele que faz o `MERGE` do confirmar ser idempotente (regra 4). Dois
 *      pedidos concorrentes, aplicados sobre o mesmo retrato, não podem nascer
 *      com o mesmo `n` — nem com o de um átomo da proposta.
 *   2. **Quem nunca tocou no "+" não vê diferença nenhuma.** Proposta sem pedido
 *      sai da junção igual, e o prompt sem pedido sai byte a byte o de antes.
 *   3. **A procedência do átomo pedido vem do R2**, como a de qualquer outro
 *      (§4.7) — e a correção se apura contra o que o extrator propôs sozinho.
 *   4. **O "faltou" só nasce do que eu aprovei**, com o texto final.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/r2", () => ({ getJson: vi.fn(), putJson: vi.fn() }));
vi.mock("@/lib/sessoes", () => ({
  buscarSessao: vi.fn(),
  atualizarSessao: vi.fn(async () => null),
}));
vi.mock("@/lib/atomos", () => ({
  gravarAtomos: vi.fn(async () => {}),
  gravarEntidades: vi.fn(async () => {}),
}));
vi.mock("@/lib/calibracao", () => ({ capturarCorrecoes: vi.fn(async () => 0) }));

import { POST } from "@/app/api/sessoes/[id]/confirmar/route";
import { faltantesDosPedidos, montarGestos } from "@/components/Revisao";
import { gravarAtomos } from "@/lib/atomos";
import type { AtomoParaGravar } from "@/lib/atomos";
import { capturarCorrecoes } from "@/lib/calibracao";
import { chavesDaSessao } from "@/lib/chaves";
import { BASE, FORMATO, blocoDoPedido, montarPrompt } from "@/lib/extracao";
import type { ResultadoDaJanela } from "@/lib/extracao";
import {
  LEASE_PEDIDO_MS,
  aplicarPedido,
  estadoDoPedido,
  gestosDoExtrator,
  idDoPedido,
  juntarPedidos,
  marcarFalhaPedido,
  pedidosVazio,
  reivindicarPedido,
} from "@/lib/pedidos";
import { getJson } from "@/lib/r2";
import { buscarSessao } from "@/lib/sessoes";
import { GESTOS_VAZIOS, NUNCA_ENRIQUECIDA } from "@/lib/tipos";
import type {
  AtomoProposto,
  EntidadeCandidata,
  Extracao,
  Manifest,
  Pedidos,
} from "@/lib/tipos";

const SESSAO = "mtgn3zf7";
const AGORA = new Date("2026-10-13T12:00:00.000Z");

const referencia = (nome: string) => ({
  citado: nome,
  entidade: nome,
  conhecida: false,
  certo: true,
  alternativas: [],
  motivo: "",
  porque: [],
});

const atomo = (indice: number, texto: string, extra: Partial<AtomoProposto> = {}): AtomoProposto => ({
  id: `${SESSAO}-${indice}`,
  indice,
  texto,
  tipo: "FATO",
  sobre: referencia("Marina"),
  menciona: [],
  trechos: [{ texto, inicio_s: 10 + indice, fim_s: 12 + indice, ancora: "exata" }],
  perfila: [],
  prompt_version: "extracao-9",
  modelo: "deepseek/deepseek-v4.1-flash",
  ...extra,
});

const candidata = (nome: string, ocorrencias: number): EntidadeCandidata => ({
  nome,
  nome_normalizado: nome.toLowerCase(),
  tipo: "Pessoa",
  conhecida: false,
  id: null,
  ocorrencias,
  sessoes: 0,
  precisa_nome: false,
});

const proposta: Extracao = {
  sessao_id: SESSAO,
  atomos: [atomo(0, "A Marina topou revisar o contrato"), atomo(1, "Almocei com o Pedro")],
  entidades: [candidata("Marina", 1), candidata("Pedro", 1)],
  descartados: [],
  prompt_version: "extracao-9",
  modelo: "deepseek/deepseek-v4.1-flash",
  prompt_version_resolucao: null,
  modelo_resolucao: null,
  granularidade: "palavra",
  criado_em: "2026-10-13T11:00:00.000Z",
};

/** O que o extrator devolveu para um pedido, antes de os ids serem carimbados. */
const resultado = (...textos: string[]): ResultadoDaJanela => ({
  // A extração numera a partir do que ela viu; o mutador renumera.
  novos: textos.map((t, k) => atomo(k, t, { prompt_version: "extracao-9+p1b2c3d4" })),
  estende: [],
  entidades: [],
  descartados: [],
  prompt_version: "extracao-9+p1b2c3d4",
  modelo: "deepseek/deepseek-v4.1-flash",
  prompt_version_resolucao: "resolucao-5",
  modelo_resolucao: "deepseek/deepseek-v4.1-flash",
  catalogo: [],
  candidatas: ["marina"],
});

const reivindicado = (p: Pedidos, texto: string, agora = AGORA) =>
  reivindicarPedido(p, idDoPedido(texto), texto, agora)!;

describe("o id do pedido", () => {
  it("é o hash do texto normalizado — caixa, acento e pontuação não mudam o pedido", () => {
    expect(idDoPedido("A conversa com a Marina.")).toBe(idDoPedido("a conversa com a marina"));
    expect(idDoPedido("a conversa com a Marina")).not.toBe(idDoPedido("o almoço com a Marina"));
  });
});

describe("reivindicar um pedido", () => {
  it("o primeiro é meu", () => {
    const p = reivindicado(pedidosVazio(SESSAO), "o contrato");
    expect(estadoDoPedido(p, idDoPedido("o contrato"))?.estado).toBe("em_curso");
  });

  it("em curso com lease fresco não se refaz; vencido, sim", () => {
    const p = reivindicado(pedidosVazio(SESSAO), "o contrato");
    const id = idDoPedido("o contrato");
    expect(reivindicarPedido(p, id, "o contrato", new Date(AGORA.getTime() + 1000))).toBeNull();
    expect(
      reivindicarPedido(p, id, "o contrato", new Date(AGORA.getTime() + LEASE_PEDIDO_MS + 1)),
    ).not.toBeNull();
  });

  it("pronto não se refaz — é a idempotência; falhou se refaz", () => {
    const id = idDoPedido("o contrato");
    const pronto = aplicarPedido(
      reivindicado(pedidosVazio(SESSAO), "o contrato"),
      id,
      resultado("x"),
      [],
      2,
      AGORA,
    )!;
    expect(reivindicarPedido(pronto, id, "o contrato", AGORA)).toBeNull();

    const falhou = marcarFalhaPedido(reivindicado(pedidosVazio(SESSAO), "o contrato"), id, "rate limit", AGORA)!;
    expect(estadoDoPedido(falhou, id)?.motivo).toBe("rate limit");
    expect(reivindicarPedido(falhou, id, "o contrato", AGORA)).not.toBeNull();
  });
});

describe("aplicar o que o pedido produziu", () => {
  it("carimba os ids depois da proposta, e marca o pedido no átomo", () => {
    const id = idDoPedido("o contrato");
    const p = aplicarPedido(
      reivindicado(pedidosVazio(SESSAO), "o contrato"),
      id,
      resultado("A Marina pediu mais prazo", "Eu aceitei o prazo"),
      [candidata("Marina", 2)],
      proposta.atomos.length,
      AGORA,
    )!;

    expect(p.atomos.map((a) => a.id)).toEqual([`${SESSAO}-2`, `${SESSAO}-3`]);
    expect(p.atomos.map((a) => a.indice)).toEqual([2, 3]);
    expect(p.atomos.every((a) => a.pedido?.id === id && a.pedido.texto === "o contrato")).toBe(true);
    const estado = estadoDoPedido(p, id)!;
    expect(estado).toMatchObject({ estado: "pronto", indices: [2, 3], candidatas: ["marina"] });
    expect(estado.prompt_version).toBe("extracao-9+p1b2c3d4");
  });

  /**
   * O laço por etag reaplica o mutador sobre o objeto corrente: o segundo
   * pedido vê o primeiro já gravado e numera depois dele, mesmo tendo saído do
   * mesmo retrato.
   */
  it("dois pedidos aplicados sobre o mesmo retrato não repetem id", () => {
    const a = idDoPedido("o contrato");
    const b = idDoPedido("o almoço");
    const retrato = reivindicado(reivindicado(pedidosVazio(SESSAO), "o contrato"), "o almoço");

    const depoisDeA = aplicarPedido(retrato, a, resultado("contrato"), [], 2, AGORA)!;
    const depoisDeB = aplicarPedido(depoisDeA, b, resultado("almoço", "sobremesa"), [], 2, AGORA)!;

    const ids = depoisDeB.atomos.map((x) => x.id);
    expect(ids).toEqual([`${SESSAO}-2`, `${SESSAO}-3`, `${SESSAO}-4`]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(estadoDoPedido(depoisDeB, b)?.indices).toEqual([3, 4]);
  });

  it("pedido que já não está em curso não grava — re-extraído no meio, ou outro terminou", () => {
    const id = idDoPedido("o contrato");
    expect(aplicarPedido(pedidosVazio(SESSAO), id, resultado("x"), [], 2, AGORA)).toBeNull();
  });

  it("não achar nada é resposta: pronto, sem átomo", () => {
    const id = idDoPedido("o que eu não falei");
    const p = aplicarPedido(reivindicado(pedidosVazio(SESSAO), "o que eu não falei"), id, resultado(), [], 2, AGORA)!;
    expect(estadoDoPedido(p, id)).toMatchObject({ estado: "pronto", indices: [] });
    expect(p.atomos).toEqual([]);
  });
});

describe("juntarPedidos", () => {
  it("proposta sem pedido sai igual — o mesmo objeto", () => {
    expect(juntarPedidos(proposta, null)).toBe(proposta);
    expect(juntarPedidos(proposta, pedidosVazio(SESSAO))).toBe(proposta);
  });

  it("os átomos pedidos seguem depois da proposta, e o cabeçalho é o dela", () => {
    const id = idDoPedido("o contrato");
    const pedidos = aplicarPedido(
      reivindicado(pedidosVazio(SESSAO), "o contrato"),
      id,
      resultado("A Marina pediu mais prazo"),
      [candidata("Marina", 1), candidata("Joana", 1)],
      2,
      AGORA,
    )!;

    const j = juntarPedidos(proposta, pedidos);
    expect(j.atomos.map((a) => a.indice)).toEqual([0, 1, 2]);
    expect(j.prompt_version).toBe(proposta.prompt_version);
    expect(j.criado_em).toBe(proposta.criado_em);
    // A mesma chave soma as ocorrências; a nova entra.
    expect(j.entidades.map((e) => [e.nome_normalizado, e.ocorrencias])).toEqual([
      ["marina", 2],
      ["pedro", 1],
      ["joana", 1],
    ]);
    // E a proposta não muda um byte.
    expect(proposta.atomos).toHaveLength(2);
  });
});

describe("o prompt do pedido", () => {
  const GIAMPAOLO = {
    id: "e1",
    nome: "Giampaolo Lepore",
    nome_normalizado: "giampaolo lepore",
    chaves: ["giampaolo lepore"],
    tipo: "Pessoa" as const,
    sessoes: 3,
    atomos: 7,
    aliases: ["Giam"],
    resumo: "Sócio na Adapta.",
    canonico: true,
    enriquecimento: NUNCA_ENRIQUECIDA,
    perfil: { contexto: "", pode_ajudar_com: "", fizemos_juntos: "" },
  };
  const dossie = [{ entidade: GIAMPAOLO, camada: "prefixo" as const, score: 0.5 }];

  it("sem pedido é byte a byte o de antes", () => {
    expect(blocoDoPedido()).toBe("");
    expect(blocoDoPedido("   ")).toBe("");
    expect(montarPrompt("bla", BASE, undefined, [], undefined)).toBe(montarPrompt("bla"));
    expect(montarPrompt("bla", BASE, undefined, dossie, "")).toBe(
      montarPrompt("bla", BASE, undefined, dossie),
    );
  });

  it("com pedido, o bloco entra depois do dossiê e antes do FORMATO", () => {
    const p = montarPrompt("bla", BASE, undefined, dossie, "a conversa com a Marina");
    const dossieEm = p.indexOf("QUEM O DIÁRIO JÁ CONHECE");
    const pedidoEm = p.indexOf("O QUE FALTOU");
    const formatoEm = p.lastIndexOf(FORMATO);
    expect(dossieEm).toBeGreaterThan(-1);
    expect(dossieEm).toBeLessThan(pedidoEm);
    expect(pedidoEm).toBeLessThan(formatoEm);
    expect(p).toContain("«a conversa com a Marina»");
    expect(p).not.toContain("ESTA JANELA");
    expect(p).not.toContain('"estende"');
  });
});

describe("o faltou que nasce do pedido", () => {
  const pedido = { id: "abc12345", texto: "o contrato" };
  const pedidoA = atomo(2, "A Marina pediu mais prazo", { pedido });
  const pedidoB = atomo(3, "Eu aceitei", { pedido });
  const textoDe = (a: AtomoProposto) => (a.indice === 2 ? "A Marina pediu mais prazo no contrato" : a.texto);

  it("só dos átomos pedidos aprovados, com o texto final", () => {
    // `pedidoB` foi desmarcado: não está entre os aprovados.
    const faltantes = faltantesDosPedidos([proposta.atomos[0], pedidoA], textoDe);
    expect(faltantes).toEqual([{ texto: "A Marina pediu mais prazo no contrato" }]);

    const g = montarGestos({
      edicoes: {},
      entidades: [],
      finalDe: (e) => e,
      recusadas: new Set(),
      faltantes,
    });
    expect(g.faltantes).toEqual(faltantes);
  });

  it("revisão sem átomo pedido aprovado não manda faltante nenhum", () => {
    expect(faltantesDosPedidos(proposta.atomos, textoDe)).toEqual([]);
    expect(faltantesDosPedidos([pedidoB], () => "  ")).toEqual([]);
  });
});

describe("gestosDoExtrator", () => {
  it("recusa, renome e edição só do que o extrator propôs sozinho; faltantes passam", () => {
    const g = gestosDoExtrator(
      {
        atomos: [
          { indice: 0, campos: ["texto"] },
          { indice: 2, campos: ["texto"] },
        ],
        entidades_recusadas: ["pedro", "joana"],
        renomes: [
          { de: "Marina", para: "Marina Souza" },
          { de: "Joana", para: "Joana Lima" },
        ],
        faltantes: [{ texto: "A Marina pediu mais prazo" }],
      },
      proposta,
    );
    expect(g).toEqual({
      atomos: [{ indice: 0, campos: ["texto"] }],
      entidades_recusadas: ["pedro"],
      renomes: [{ de: "Marina", para: "Marina Souza" }],
      faltantes: [{ texto: "A Marina pediu mais prazo" }],
    });
    expect(gestosDoExtrator(null, proposta)).toBeNull();
    expect(gestosDoExtrator(GESTOS_VAZIOS, proposta)).toEqual(GESTOS_VAZIOS);
  });
});

describe("o confirmar com um átomo pedido", () => {
  const id = idDoPedido("o contrato");
  const pedidos = aplicarPedido(
    reivindicado(pedidosVazio(SESSAO), "o contrato"),
    id,
    resultado("A Marina pediu mais prazo"),
    [],
    2,
    AGORA,
  )!;

  const ctx = { params: Promise.resolve({ id: SESSAO }) };
  const chamar = (corpo: unknown) =>
    POST(
      new Request(`http://localhost/api/sessoes/${SESSAO}/confirmar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      }),
      ctx,
    );

  beforeEach(() => {
    vi.mocked(getJson)
      .mockReset()
      .mockImplementation((async (key: string) => {
        if (key.endsWith("/extracao.json")) return { valor: proposta, etag: null };
        if (key.endsWith("/pedidos.json")) return { valor: pedidos, etag: "e1" };
        return null;
      }) as never);
    vi.mocked(buscarSessao)
      .mockReset()
      .mockResolvedValue({ id: SESSAO, status: "em_revisao", iniciada_em: "2026-10-13T11:00:00.000Z" } as never);
    vi.mocked(gravarAtomos).mockReset().mockResolvedValue(undefined);
    vi.mocked(capturarCorrecoes).mockReset().mockResolvedValue(0);
  });

  it("acha a procedência do átomo pedido no R2, e não no corpo", async () => {
    const r = await chamar({
      aprovados: [
        {
          indice: 2,
          texto: "A Marina pediu mais prazo no contrato",
          tipo: "FATO",
          sobre: "Marina",
          menciona: [],
          // O navegador tenta afirmar procedência; o servidor não escuta.
          id: `${SESSAO}-0`,
          prompt_version: "inventada",
          modelo: "inventado",
        },
      ],
      entidades: [{ nome: "Marina", tipo: "Pessoa" }],
    });
    expect(r.status).toBe(200);

    const [gravado] = vi.mocked(gravarAtomos).mock.calls[0][1] as AtomoParaGravar[];
    expect(gravado.id).toBe(`${SESSAO}-2`);
    expect(gravado.prompt_version).toBe("extracao-9+p1b2c3d4");
    expect(gravado.modelo).toBe("deepseek/deepseek-v4.1-flash");
    expect(gravado.inicios_s).toEqual([10]);
    expect(gravado.texto).toBe("A Marina pediu mais prazo no contrato");
  });

  it("apura as correções contra a proposta sem os pedidos", async () => {
    await chamar({
      aprovados: [{ indice: 2, texto: "A Marina pediu mais prazo", tipo: "FATO", sobre: "Marina", menciona: [] }],
      entidades: [{ nome: "Marina", tipo: "Pessoa" }],
      gestos: { ...GESTOS_VAZIOS, faltantes: [{ texto: "A Marina pediu mais prazo" }] },
    });
    const entrada = vi.mocked(capturarCorrecoes).mock.calls[0][0];
    expect(entrada.proposta).toBe(proposta);
    expect(entrada.gestos?.faltantes).toEqual([{ texto: "A Marina pediu mais prazo" }]);
  });

  it("índice fora da lista juntada continua recusado", async () => {
    const r = await chamar({
      aprovados: [{ indice: 9, texto: "x", tipo: "FATO", sobre: "Marina", menciona: [] }],
      entidades: [{ nome: "Marina", tipo: "Pessoa" }],
    });
    expect(r.status).toBe(400);
  });
});

describe("apagar a sessão apaga o pedido", () => {
  it("chavesDaSessao traz pedidos.json, e o manifest continua por último", () => {
    const m = { sessao_id: SESSAO, chunks: [{ i: 0 }] } as unknown as Manifest;
    const chaves = chavesDaSessao(m);
    expect(chaves).toContain(`sessoes/${SESSAO}/pedidos.json`);
    expect(chaves.indexOf(`sessoes/${SESSAO}/pedidos.json`)).toBeLessThan(chaves.length - 1);
    expect(chaves[chaves.length - 1]).toBe(`sessoes/${SESSAO}/manifest.json`);
  });
});
