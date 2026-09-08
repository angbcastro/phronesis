import { NextResponse } from "next/server";
import { agentePorId, envelopeFaltando, retrato } from "@/lib/agentes";
import { ModeloError, validarIdDeModelo } from "@/lib/modelos";
import { configAgentes, ehLimiar, gravarOverride } from "@/lib/overrides";
import { erro, erroDeInfra } from "@/lib/rotas";
import { ehAgenteId } from "@/lib/tipos";

export const runtime = "nodejs";

/**
 * POST /api/agentes/:id — **o único lugar que escreve configuração de agente.**
 *
 * Mesma disciplina de `POST /api/calibracao/regras` e de
 * `POST /api/entidades/perfil`, e pela mesma razão: o que está sendo escrito
 * aqui é o prompt que produz todo o resto.
 *
 * O corpo diz o que deve valer daqui para frente, e não um delta:
 *
 *   { prompt: "…" }     passa a valer este texto
 *   { prompt: null }    revoga, e volta à base do git
 *   { modelo: "a/b" }   passa a valer este modelo
 *   { modelo: null }    revoga, e volta à variável de ambiente
 *   { limiar: 0.8 }     passa a valer este limiar (só quem tem um)
 *   { limiar: null }    revoga, e volta ao número do git
 *   campo ausente       não mexe naquele campo
 *
 * **Mandar o texto igual ao da base revoga.** Não é atalho: um override cujo
 * texto é byte a byte o do git não é uma edição, e guardá-lo faria o painel
 * dizer "editado" sobre um agente que está na base — além de carimbar
 * `extracao-6+p<hash>` num átomo produzido pelo prompt original.
 *
 * As duas guardas vivem aqui, no servidor, e não só na tela: regra que só vale
 * no navegador não é regra.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!ehAgenteId(id)) return erro(`não existe agente "${id}"`, 404);

  const a = agentePorId(id);
  if (!a) return erro(`não existe agente "${id}"`, 404);

  const corpo = (await req.json().catch(() => null)) as {
    prompt?: unknown;
    modelo?: unknown;
    limiar?: unknown;
  } | null;
  if (!corpo || typeof corpo !== "object") {
    return erro("corpo inválido: espera { prompt?, modelo?, limiar? }", 400);
  }

  const mudanca: { prompt?: string | null; modelo?: string | null; limiar?: number | null } = {};

  // ── o prompt ───────────────────────────────────────────────────────────────
  if (corpo.prompt !== undefined) {
    if (corpo.prompt === null) {
      mudanca.prompt = null;
    } else if (typeof corpo.prompt !== "string") {
      return erro("prompt tem de ser texto, ou null para voltar ao original", 400);
    } else if (a.base === null) {
      return erro(`o ${a.rotulo} não tem prompt — ele tem modelo e mais nada`, 400);
    } else {
      // **Não se apara o texto.** A base termina em `Transcrição:\n`, e é
      // esse \n que separa o prompt do que vem depois dele (`montarPrompt`). Um
      // `trim()` aqui comeria a quebra e colaria a transcrição no cabeçalho —
      // em silêncio, e só na próxima sessão. Prompt é texto exato; o `trim` só
      // serve para decidir se está vazio e se é o mesmo da base.
      const texto = corpo.prompt;
      if (texto.trim() === "") return erro("prompt vazio — use null para voltar ao original", 400);

      // O guarda-corpo do envelope. Eu posso reescrever o prompt inteiro, mas
      // não posso salvar um que deixe de pedir o JSON que o parser sabe ler:
      // isso derrubaria toda sessão seguinte, e só na hora de extrair.
      const faltando = envelopeFaltando(a, texto);
      if (faltando.length > 0) {
        return erro(
          `este prompt não pede mais ${faltando.map((c) => `"${c}"`).join(" e ")} — ` +
            `é o que o parser do ${a.rotulo} lê na resposta, e sem isso toda chamada dele falha`,
          400,
        );
      }

      // Texto igual ao do git não é edição: guardá-lo faria o painel dizer
      // "editado" e o átomo sair carimbado `+p` por um prompt que é o original.
      // A comparação é aparada dos dois lados; o que se guarda, não.
      mudanca.prompt = texto.trim() === a.base.trim() ? null : texto;
    }
  }

  // ── o modelo ───────────────────────────────────────────────────────────────
  if (corpo.modelo !== undefined) {
    if (corpo.modelo === null) {
      mudanca.modelo = null;
    } else if (typeof corpo.modelo !== "string") {
      return erro("modelo tem de ser texto, ou null para voltar ao padrão", 400);
    } else if (!a.modeloEditavel) {
      return erro(a.travado ?? `o modelo do ${a.rotulo} não se troca por aqui`, 400);
    } else {
      try {
        // A mesma validação de sempre (regra 8): string `provedor/modelo`, e o
        // erro estoura aqui, não numa chamada com áudio de 30 s já carregado.
        const validado = validarIdDeModelo(corpo.modelo);
        mudanca.modelo = validado === a.padrao() ? null : validado;
      } catch (e) {
        if (e instanceof ModeloError) return erro(e.message, 400);
        throw e;
      }
    }
  }

  // ── o limiar (slice 4.11) ──────────────────────────────────────────────────
  if (corpo.limiar !== undefined) {
    if (corpo.limiar === null) {
      mudanca.limiar = null;
    } else if (a.limiarPadrao === undefined) {
      return erro(`o ${a.rotulo} não tem limiar — ele não decide por confiança`, 400);
    } else if (!ehLimiar(corpo.limiar)) {
      return erro("limiar tem de ser um número entre 0 e 1, ou null para voltar ao original", 400);
    } else {
      // Número igual ao do git não é edição, pela mesma razão do prompt e do
      // modelo: guardá-lo faria a tela dizer "editado" sobre a base.
      mudanca.limiar = corpo.limiar === a.limiarPadrao ? null : corpo.limiar;
    }
  }

  if (
    mudanca.prompt === undefined &&
    mudanca.modelo === undefined &&
    mudanca.limiar === undefined
  ) {
    return erro("nada a mudar: mande prompt, modelo, limiar, ou o que quiser deles", 400);
  }

  try {
    await gravarOverride(id, mudanca);
    // Devolve o retrato inteiro deste agente, relido do R2: é a única resposta
    // que não pode mentir sobre o que ficou valendo.
    const cfg = await configAgentes();
    const depois = (await retrato(cfg)).find((x) => x.id === id);
    return NextResponse.json({ ok: true, agente: depois });
  } catch (e) {
    return erroDeInfra(`agentes ${id}`, e);
  }
}
