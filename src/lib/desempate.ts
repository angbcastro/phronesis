/**
 * A segunda passada — o agente que decide quando a primeira leitura não bastou
 * (slice 4.11).
 *
 * **Por que ele existe.** Até a 4.10 o agente 2 respondia `certo: true | false`,
 * e `false` era a única coisa que a tela sabia pintar: não havia "resolvi com
 * folga" nem "resolvi raspando", e não havia caminho nenhum para ele **pedir
 * mais informação**. Ou ele decidia com o que recebeu, ou marcava dúvida e me
 * empurrava a decisão.
 *
 * Agora ele devolve uma `confianca` de 0 a 1. Abaixo do limiar, a menção vem
 * para cá — **uma** menção por chamada, com o átomo, o motivo que a primeira
 * passada escreveu, e o **perfil inteiro** (os três campos, sem teto) só dos
 * candidatos daquela menção. O perfil não saiu do sistema na 4.11: ele saiu do
 * caminho comum, e este é o lugar onde ele sempre valeu a pena.
 *
 * **Agente próprio, e não o mesmo com entrada mais rica.** A 4.8 recusou uma
 * passada de costura com o argumento de custar um prompt a mais para calibrar à
 * mão para sempre, e o argumento é bom. Ele não se aplica aqui porque o papel é
 * outro: este agente já **sabe** que a primeira leitura não resolveu, ele olha
 * uma menção só, e ele tem o perfil inteiro na mão. Instruir isso dentro do
 * prompt geral seria escrever um agente dentro do outro.
 *
 * **Não é uma ferramenta de verdade (tool use), e é escolha.** "Ele consulta uma
 * entidade, lê, decide se quer outra" seria mais fiel a "ele decide". Foi
 * recusado pelo relógio: isto roda dentro da extração de cada janela, e a 4.8
 * existe para cortar espera — um laço de rodadas imprevisíveis é exatamente o
 * que ela tirou.
 *
 * **O que ele devolve é final.** Não há segundo limiar: dúvida na tela só quando
 * ele marcar `duvida: true`, e aí a revisão pinta o "acho que é X — confirma?"
 * que já existe, sem uma linha nova de UI.
 *
 * **Nada é escrito no grafo.** Como o agente 2, este módulo só lê e devolve;
 * quem grava é o confirmar, depois da revisão (regra 5).
 */
import { generateText } from "ai";
import type { EntidadeDoGrafo } from "./entidades";
import { comEsperaDeLimite } from "./limite";
import {
  diagnostico,
  faltouOrcamento,
  garantirGateway,
  modeloDesempate,
  textoDaResposta,
  veioDoPensamento,
} from "./modelos";
import { carimbo, efetivo } from "./overrides";
import { CAMPOS_PERFIL, ROTULO_TIPO_ENTIDADE } from "./tipos";

/** Muda sempre que o prompt mudar — mesma disciplina de todo agente (regra 7). */
export const PROMPT_VERSION_DESEMPATE = "desempate-1";

/** O que o modelo responde quando a menção não é nenhum dos candidatos. */
export const NOVA = "NOVA";

/** Uma menção só, e poucos candidatos: cabe folgado no que a resolução usa. */
const MAX_TOKENS_SAIDA = 2000;

/** Como em `resolucao.ts`: o que a segunda tentativa ganha quando foi cortada. */
const FATOR_DE_FOLGA = 2;

/** Quanto da resposta crua entra no log quando o parse falha. */
const AMOSTRA_ERRO = 400;

export const INSTRUCOES = `Você decide de QUEM o dono de um diário falado estava falando numa menção — e você está sendo chamado justamente porque uma primeira leitura não resolveu.

O QUE VOCÊ TEM QUE A PRIMEIRA LEITURA NÃO TINHA
A ficha COMPLETA de cada candidato: o resumo, e os três campos que o dono escreveu à mão — contexto (quem a pessoa é para ele), pode ajudar com (o que ela sabe fazer) e fizemos juntos (o que já viveram juntos). "Fizemos juntos" costuma ser o sinal mais forte, porque atividade compartilhada é o que aparece na transcrição.

COMO DECIDIR
- Compare o que o átomo diz com a ficha inteira de cada candidato. Procure o detalhe que separa um do outro, e não o que os dois têm em comum.
- Leia o motivo da primeira leitura: ele diz o que ela viu. Não é veredito — ela decidiu com menos informação que você.
- Um candidato marcado como FICHA OFICIAL é a ficha que o dono considera a certa daquela pessoa. Empate desempata a favor dele.
- Se a ficha de um deles casa com o átomo e a dos outros não, escolha esse e responda "duvida": false.
- Se depois de ler tudo ainda não dá para separar, escolha o mais provável e responda "duvida": true. O dono vai decidir na tela — a dúvida é útil, não é fracasso.
- Se nenhuma ficha serve — o átomo contradiz todas —, responda "${NOVA}". Duas entidades a mais é grafo um pouco sujo; atribuir ao errado é grafo mentindo.
- Nunca invente uma chave que não está na lista. Ou uma das oferecidas, ou "${NOVA}".

FORMATO
Responda somente com JSON, sem texto antes ou depois:
{"entidade":"<uma chave da lista ou ${NOVA}>","duvida":false,"motivo":"<uma frase curta>"}

"motivo" é uma frase curta, em português, dizendo o que na ficha te fez escolher. Ela é mostrada ao dono quando você marca "duvida": true.`;

/** A ficha inteira de um candidato — o que só esta passada vê. */
function fichaCompleta(e: EntidadeDoGrafo): string {
  const cabeca =
    `- chave "${e.nome_normalizado}" — ${e.nome} ` +
    `(${ROTULO_TIPO_ENTIDADE[e.tipo]}, ${e.sessoes} sessão(ões)` +
    `${e.canonico ? ", FICHA OFICIAL" : ""})`;
  const grafias = e.aliases.length > 0 ? `\n    também escrito: ${e.aliases.join(", ")}` : "";
  const resumo = e.resumo === "" ? "" : `\n    resumo: ${e.resumo}`;
  // Os três campos **sem teto** — é este o lugar por onde eles voltaram, e é o
  // que tornou o `TETO_PERFIL` desnecessário: aqui são poucos candidatos, de
  // uma menção só.
  const campos = CAMPOS_PERFIL.flatMap((c) =>
    e.perfil[c] ? [`    ${c.replace(/_/g, " ")}: ${e.perfil[c]}`] : [],
  );
  const perfil = campos.length > 0 ? `\n${campos.join("\n")}` : "";

  const corpo = grafias + resumo + perfil;
  // Entidade nascida num confirmar e nunca editada não tem ficha nenhuma. Dizer
  // isso é melhor que um candidato que aparece como uma linha só: se todos
  // vierem assim, o agente tem que marcar dúvida, e não escolher no escuro.
  return corpo === "" ? `${cabeca}\n    (ficha em branco)` : cabeca + corpo;
}

/** Uma menção que a primeira passada não resolveu. */
export interface MencaoEmDuvida {
  /** O texto do átomo — é sobre ele que a decisão se faz. */
  atomo: string;
  tipo: string;
  /** A grafia como a transcrição escreveu. */
  citado: string;
  papel: "sobre" | "menciona";
  /** O que a primeira passada respondeu, e por quê. */
  escolhida: string;
  motivo: string;
  confianca: number;
  /** Só os candidatos **daquela** menção, com a ficha inteira. */
  candidatos: readonly EntidadeDoGrafo[];
}

export function montarPrompt(m: MencaoEmDuvida, base: string = INSTRUCOES): string {
  const primeira =
    m.escolhida === ""
      ? "A primeira leitura não respondeu por esta menção."
      : `A primeira leitura respondeu "${m.escolhida}" com confiança ${m.confianca.toFixed(2)}` +
        (m.motivo ? `, dizendo: "${m.motivo}"` : ".");

  return `${base}

O ÁTOMO:
[${m.tipo}] ${m.atomo}

A MENÇÃO A DECIDIR:
o extrator escreveu "${m.citado}" (${m.papel === "sobre" ? "sujeito" : "menção"}).
${primeira}

OS CANDIDATOS, COM A FICHA COMPLETA:
${m.candidatos.map(fichaCompleta).join("\n")}`;
}

export interface Desempate {
  /** A chave escolhida, ou `NOVA`. Vazio quando o agente não respondeu. */
  entidade: string;
  duvida: boolean;
  motivo: string;
  modelo: string;
  prompt_version: string;
}

/** Mesma tolerância dos outros agentes: cerca de markdown, frase antes do JSON. */
export function parsearResposta(bruto: string): {
  entidade: string;
  duvida: boolean;
  motivo: string;
} {
  const semCerca = bruto.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "");
  const inicio = semCerca.indexOf("{");
  const fim = semCerca.lastIndexOf("}");
  if (inicio === -1 || fim <= inicio) {
    throw new Error(`resposta sem JSON reconhecível: ${bruto.slice(0, AMOSTRA_ERRO)}`);
  }

  const v = JSON.parse(semCerca.slice(inicio, fim + 1)) as {
    entidade?: unknown;
    duvida?: unknown;
    motivo?: unknown;
  };

  return {
    entidade: typeof v.entidade === "string" ? v.entidade.trim() : "",
    // **Ausente conta como dúvida**, e não como certeza: o agente que esqueceu
    // de responder o campo não me autorizou a gravar calado.
    duvida: v.duvida !== false,
    motivo: typeof v.motivo === "string" ? v.motivo.trim() : "",
  };
}

/**
 * A segunda passada de **uma** menção.
 *
 * Falhar aqui não derruba nada, e é o mesmo contrato do agente 2: quem chamou
 * fica com a resposta da primeira passada, marcada como dúvida — que é
 * exatamente o que o limiar já tinha dito sobre ela.
 *
 * `ate` é o prazo de quem chamou, repassado à espera de rate limit. Este agente
 * roda **dentro** da extração de cada janela, na mesma rajada em que o STT
 * disputa o limite da conta — é a linha que a 4.9 corrigiu na resolução, e vale
 * igual aqui.
 */
export async function desempatar(
  m: MencaoEmDuvida,
  { ate }: { ate?: number } = {},
): Promise<Desempate | null> {
  garantirGateway();
  const meu = await efetivo("desempate", { prompt: INSTRUCOES, modelo: modeloDesempate() });
  const prompt = montarPrompt(m, meu.prompt);

  try {
    const chamar = (teto: number) =>
      comEsperaDeLimite(
        `desempate ${meu.modelo}`,
        () =>
          generateText({
            // String de propósito: id em string sai pelo Gateway (regra 8).
            model: meu.modelo,
            prompt,
            temperature: 0,
            maxOutputTokens: teto,
            // A espera longa daqui é a única camada de retry, como na resolução.
            maxRetries: 0,
          }),
        { ate },
      );

    let r = await chamar(MAX_TOKENS_SAIDA);
    if (faltouOrcamento(r)) {
      console.warn(
        `[desempate] o raciocínio comeu o orçamento; repetindo com teto de ` +
          `${MAX_TOKENS_SAIDA * FATOR_DE_FOLGA}.`,
        diagnostico(r),
      );
      r = await chamar(MAX_TOKENS_SAIDA * FATOR_DE_FOLGA);
    }

    if (veioDoPensamento(r)) {
      console.warn(`[desempate] texto vazio, lendo o JSON do pensamento.`, diagnostico(r));
    }

    const lido = parsearResposta(textoDaResposta(r));
    return {
      ...lido,
      modelo: r.response?.modelId ?? meu.modelo,
      prompt_version: carimbo(PROMPT_VERSION_DESEMPATE, meu.hash),
    };
  } catch (e) {
    console.error(
      `[desempate] falhou em "${m.citado}"; a menção fica com o que a primeira passada disse:`,
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}
