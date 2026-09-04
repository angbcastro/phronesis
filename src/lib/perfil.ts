/**
 * Os três campos de perfil de uma entidade: ler, gravar, e o agente 3 que
 * propõe o texto novo a partir dos átomos marcados.
 *
 * Para que eles existem: são o que o agente de resolução lê para decidir de quem
 * eu estou falando quando dois nomes soam igual (`resolucao.ts`). "Raffa" e
 * "Rapha" chegam da transcrição com uma grafia só, e a grafia não carrega sinal
 * nenhum sobre quem é — o perfil carrega.
 *
 * **O risco está declarado, e é o que desenha o fluxo:** o perfil é exatamente o
 * que o agente 2 lê para desambiguar. Perfil rascunhado errado contamina toda
 * atribuição futura, e o erro se realimenta — átomo atribuído ao Rapha por
 * engano vira evidência do perfil do Rapha. Por isso:
 *
 *   - o agente 3 **não escreve**: ele devolve um texto e para por aí;
 *   - o texto atual nunca é sobrescrito sem eu ver os dois lado a lado;
 *   - `gravarCampo` só é chamado pela rota que o meu toque dispara.
 *
 * O botão é sob demanda, no padrão do "procurar duplicatas": juntar os átomos
 * marcados é de graça, a chamada de modelo não pode acontecer toda vez que a
 * tela abre.
 */
import { generateText } from "ai";
import { garantirGateway, modeloPerfil } from "./modelos";
import { carimbo, efetivo } from "./overrides";
import { query } from "./neo4j";
import { normalizarNome } from "./texto";
import { CAMPOS_PERFIL, TETO_PERFIL } from "./tipos";
import type { CampoPerfil } from "./tipos";

/** Muda sempre que o prompt mudar — mesma disciplina de todo agente (regra 7). */
export const PROMPT_VERSION_PERFIL = "perfil-1";

/** Quantos átomos marcados vão ao modelo. Além disso a proposta vira resumo de resumo. */
const TETO_ATOMOS = 20;

export class PerfilError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PerfilError";
  }
}

/** "contexto", "CONTEXTO", " Contexto " — tudo o mesmo campo. Fora da lista, `null`. */
export function normalizarCampo(valor: unknown): CampoPerfil | null {
  if (typeof valor !== "string") return null;
  const alvo = valor.trim().toLowerCase();
  return (CAMPOS_PERFIL as readonly string[]).includes(alvo) ? (alvo as CampoPerfil) : null;
}

/**
 * Neo4j não aceita nome de propriedade vindo de parâmetro, e este projeto não
 * usa APOC. A saída é a mesma de `statementDeEntidade` em `atomos.ts`: o nome
 * literal na string, seguro porque sai de `CAMPOS_PERFIL`, constante fechada, e
 * nunca do cliente.
 *
 * Atravessa alias: gravar perfil numa grafia já fundida tem que ir para o
 * vencedor, senão o texto ficaria num nó que nenhuma leitura enxerga.
 */
function statementDeCampo(campo: CampoPerfil): string {
  if (!CAMPOS_PERFIL.includes(campo)) throw new PerfilError(`Campo inválido: ${campo}`);
  return `MATCH (e:Entidade { nome_normalizado: $chave })
     OPTIONAL MATCH (e)-[:FUNDIDA_EM]->(v:Entidade)
     WITH coalesce(v, e) AS alvo
     SET alvo.${campo} = $texto
     RETURN alvo.id AS id, alvo.nome AS nome`;
}

/**
 * Grava um dos três campos. Texto vazio limpa o campo — apagar o que eu escrevi
 * errado tem que ser possível, e campo vazio é estado válido.
 *
 * O corte em `TETO_PERFIL` acontece aqui, no servidor: o teto existe para o
 * prompt do agente 2 não inchar conforme o grafo cresce, e uma regra que só
 * vale na tela não é regra.
 */
export async function gravarCampo(
  chaveOuNome: string,
  campo: CampoPerfil,
  texto: string,
): Promise<{ id: string; nome: string; texto: string }> {
  const chave = normalizarNome(chaveOuNome);
  if (chave === "") throw new PerfilError("gravar perfil exige a entidade");
  if (!CAMPOS_PERFIL.includes(campo)) throw new PerfilError(`Campo inválido: ${campo}`);

  const limpo = texto.trim().slice(0, TETO_PERFIL);
  const r = await query<{ id: string; nome: string }>(statementDeCampo(campo), {
    chave,
    texto: limpo,
  });
  if (r.length === 0) throw new PerfilError(`"${chaveOuNome}" não está no grafo`);

  return { ...r[0], texto: limpo };
}

export interface AtomoMarcado {
  texto: string;
  tipo: string;
  valido_em: string;
}

/**
 * Os átomos que o agente 2 marcou como informação daquele campo, do mais novo
 * para o mais velho.
 *
 * É de graça — só uma consulta — e é o que a tela mostra antes de eu decidir se
 * vale pagar o rascunho.
 */
export async function atomosMarcados(
  chaveOuNome: string,
  campo: CampoPerfil,
): Promise<AtomoMarcado[]> {
  const chave = normalizarNome(chaveOuNome);
  if (chave === "" || !CAMPOS_PERFIL.includes(campo)) return [];

  const linhas = await query<AtomoMarcado>(
    `MATCH (e:Entidade { nome_normalizado: $chave })
     OPTIONAL MATCH (e)-[:FUNDIDA_EM]->(v:Entidade)
     WITH coalesce(v, e) AS alvo
     MATCH (a:Atomo)-[p:PERFILA { campo: $campo }]->(alvo)
     WHERE coalesce(a.status, 'ativo') = 'ativo'
     RETURN a.texto AS texto, a.tipo AS tipo, a.valido_em AS valido_em
     ORDER BY a.valido_em DESC
     LIMIT $teto`,
    { chave, campo, teto: TETO_ATOMOS },
  );

  return linhas.filter((l) => typeof l.texto === "string" && l.texto.trim() !== "");
}

const COMO_USAR: Record<CampoPerfil, string> = {
  contexto:
    "quem essa entidade é para o dono do diário — a relação, o papel, onde ela entra na vida dele — e qualquer outro contexto relevante sobre ela: momento de vida, situação, o que está acontecendo",
  pode_ajudar_com: "o que essa entidade sabe, com o que já trabalhou, o que sabe fazer",
  fizemos_juntos: "o que o dono do diário e essa entidade já fizeram juntos",
};

export const INSTRUCOES = `Você mantém a ficha de uma entidade num diário pessoal. Recebe o texto que já está escrito num campo dessa ficha e os trechos do diário que falam desse campo, e devolve o texto ATUALIZADO.

REGRAS
- Escreva na terceira pessoa, direto, sem floreio. Não é um parágrafo bonito, é uma anotação para ser lida rápido.
- PRESERVE o que já estava escrito, a menos que os trechos contradigam. Este campo é escrito à mão pelo dono; você acrescenta, não substitui o julgamento dele.
- Junte o que se repete numa frase só. A ficha é curta por desenho.
- Só afirme o que os trechos ou o texto atual sustentam. Não deduza, não complete com o que "costuma ser".
- Se os trechos não acrescentam nada ao que já está escrito, devolva o texto atual sem mudanças.
- No máximo ${TETO_PERFIL} caracteres. Se não couber, corte o menos específico — nome, habilidade e história concreta ficam; adjetivo sai.

FORMATO
Responda somente com JSON, sem texto antes ou depois:
{"texto":"..."}`;

export interface Rascunho {
  texto: string;
  atomos: number;
  modelo: string;
  prompt_version: string;
}

/**
 * O agente 3 propõe o texto novo. **Não grava nada** — devolve, e quem decide
 * sou eu, com o proposto ao lado do atual e nunca por cima.
 */
export async function rascunhar(
  nome: string,
  campo: CampoPerfil,
  atual: string,
  marcados: readonly AtomoMarcado[],
): Promise<Rascunho> {
  if (!CAMPOS_PERFIL.includes(campo)) throw new PerfilError(`Campo inválido: ${campo}`);
  if (marcados.length === 0) {
    throw new PerfilError(
      "nenhum átomo marcou este campo ainda — o agente de resolução marca no confirmar de uma sessão",
    );
  }

  garantirGateway();
  // O prompt e o modelo que eu editei no painel, ou a base do git (slice 4.7).
  const meu = await efetivo("perfil", { prompt: INSTRUCOES, modelo: modeloPerfil() });
  const modelo = meu.modelo;

  const trechos = marcados.map((a) => `- [${a.tipo}] ${a.texto}`).join("\n");
  const prompt = `${meu.prompt}

ENTIDADE: ${nome}
CAMPO: ${campo} — ${COMO_USAR[campo]}

TEXTO ATUAL:
${atual.trim() === "" ? "(vazio)" : atual.trim()}

TRECHOS DO DIÁRIO QUE FALAM DESTE CAMPO:
${trechos}`;

  let bruto: string;
  try {
    const r = await generateText({
      // String de propósito: id em string sai pelo Gateway (regra 8).
      model: modelo,
      prompt,
      temperature: 0,
      maxOutputTokens: 2000,
    });
    bruto = r.text ?? "";
  } catch (e) {
    throw new PerfilError(e instanceof Error ? e.message : String(e));
  }

  return {
    texto: extrairTexto(bruto).slice(0, TETO_PERFIL),
    atomos: marcados.length,
    modelo,
    prompt_version: carimbo(PROMPT_VERSION_PERFIL, meu.hash),
  };
}

/** Mesma tolerância dos outros agentes: cerca de markdown, frase antes do JSON. */
export function extrairTexto(bruto: string): string {
  const semCerca = bruto.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "");
  const inicio = semCerca.indexOf("{");
  const fim = semCerca.lastIndexOf("}");
  if (inicio !== -1 && fim > inicio) {
    try {
      const v = JSON.parse(semCerca.slice(inicio, fim + 1)) as { texto?: unknown };
      if (typeof v.texto === "string") return v.texto.trim();
    } catch {
      // Cai no texto solto abaixo: o conteúdo importa mais que o envelope, e
      // quem decide se presta sou eu, olhando na tela.
    }
  }
  const solto = semCerca.trim();
  if (solto === "") throw new PerfilError("o agente devolveu resposta vazia");
  return solto;
}
