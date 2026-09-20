/**
 * Descobre qual opção de provedor de fato corta o raciocínio de um modelo.
 *
 *   pnpm probe:raciocinio
 *   EXTRACAO_MODEL=zai/glm-5.3 pnpm probe:raciocinio
 *   PROBE_SO=maxReasoningTokens pnpm probe:raciocinio
 *
 * **O sistema não limita o pensamento, e isto aqui não é o instrumento de uma
 * decisão pendente — é o instrumento de uma já tomada.** O raciocínio é o que a
 * extração faz de útil: ler um diário falado e decidir o que vira átomo é
 * exatamente a tarefa em que pensar antes de escrever paga. Contra o estouro de
 * orçamento existe defesa própria, o escalonamento de teto de `extracao.ts`.
 *
 * A sonda fica porque a pergunta pode voltar — outro modelo em `EXTRACAO_MODEL`,
 * outro provedor, outro comportamento — e porque a resposta que ela já deu para
 * o `zai/glm-5.3-flash` está registrada em `ARCHITECTURE.md` §4.4: **dá** para
 * calar aquele modelo, com duas opções diferentes, e escolhemos não calar. O
 * padrão hoje é outro (`deepseek/deepseek-v4.1-flash`) e a sonda não foi rodada
 * contra ele: é exatamente o tipo de pergunta que ela existe para responder.
 *
 * Por que medir em vez de escrever o nome direto no código, se um dia for o
 * caso: **opção que o provedor não conhece some em silêncio**. É a mesma lição
 * que o vocabulário do STT já ensinou uma vez — o `google/gemini-3.5-transcribe`
 * engole cinco nomes de opção diferentes e devolve saída idêntica, sem um
 * `warning` sequer (§4.4).
 *
 * A opção que serve é a que faz `raciocinio` cair **e** `texto` continuar
 * aparecendo. Opção que derruba a chamada é resultado tão útil quanto: é um nome
 * a não usar.
 *
 * Roda solto no node e **não importa de `src/`** — src/ usa import sem extensão,
 * que node puro não resolve. Por isso o formato do diagnóstico está repetido
 * aqui; `tests/gateway.test.ts` é quem impede a cópia de furar a porta única.
 */
import { generateText } from "ai";

/** Igual a `modeloExtracao()`: `||` e não `??`, string vazia é ausência. */
const MODELO = process.env.EXTRACAO_MODEL || "deepseek/deepseek-v4.1-flash";

/** O mesmo teto que `src/lib/extracao.ts` usa, para a medição valer para ele. */
const TETO = Number(process.env.PROBE_TETO || "8000");

/**
 * Curto de propósito, e mesmo assim do formato que faz o modelo pensar: ler
 * português solto e devolver JSON estrito. A janela que estourou tinha 5210
 * tokens de entrada — o problema nunca foi tamanho de entrada.
 */
const PROMPT = `Você recebe a transcrição de um diário falado, em português.

Devolva SÓ um JSON no formato {"atomos":[{"tipo":"...","texto":"..."}]}, sem
comentário nenhum antes ou depois. Tipos válidos: FATO, OPINIAO, SENTIMENTO,
APRENDIZADO, CONQUISTA, DECISAO, ROTINA.

TRANSCRIÇÃO:
Hoje eu finalmente fechei a parte do pipeline que estava me travando faz duas
semanas. Foi um alívio grande, sério. Conversei com o Rafael de manhã e ele
apontou uma coisa que eu não tinha visto: o problema não era a fila, era que eu
estava tratando erro de rede igual a erro de aplicação. Aprendi que separar os
dois muda o desenho inteiro do retry. Decidi que amanhã eu começo pela parte de
autenticação em vez de continuar mexendo em performance.`;

/** O que cabe num `providerOptions`. Escrito aqui: pacote de provedor não entra (regra 8). */
type ValorJson = string | number | boolean | null | ValorJson[] | { [k: string]: ValorJson };

/**
 * Os nomes que valem tentar, e sob qual chave.
 *
 * **Duas chaves para cada nome, de propósito.** O `providerOptions` é indexado
 * pelo provedor, mas o log da falha mostrou que o Gateway resolveu
 * `zai/glm-5.3-flash` para `resolvedProvider: baseten`. Não dá para saber de
 * fora se a opção tem de vir sob o provedor do id ou sob o que atendeu — então
 * a sonda pergunta às duas, e a resposta decide o que vai para a tabela de
 * `modelos.ts`.
 */
const NOMES: { rotulo: string; valor: Record<string, ValorJson> }[] = [
  { rotulo: 'thinking={type:"disabled"}', valor: { thinking: { type: "disabled" } } },
  { rotulo: "enable_thinking=false", valor: { enable_thinking: false } },
  { rotulo: 'reasoningEffort="minimal"', valor: { reasoningEffort: "minimal" } },
  { rotulo: 'reasoning_effort="minimal"', valor: { reasoning_effort: "minimal" } },
  { rotulo: 'reasoningEffort="none"', valor: { reasoningEffort: "none" } },
  { rotulo: "reasoning={enabled:false}", valor: { reasoning: { enabled: false } } },
  { rotulo: "maxReasoningTokens=512", valor: { maxReasoningTokens: 512 } },
];

interface Tentativa {
  rotulo: string;
  opcoes?: Record<string, Record<string, ValorJson>>;
}

function tentativas(): Tentativa[] {
  const doId = MODELO.split("/")[0].toLowerCase();
  const chaves = [doId, ...(process.env.PROBE_PROVEDOR ? [process.env.PROBE_PROVEDOR] : [])];

  const todas = [
    { rotulo: "sem opção (a linha de base)" },
    ...chaves.flatMap((chave) =>
      NOMES.map((n) => ({
        rotulo: `${chave}.${n.rotulo}`,
        opcoes: { [chave]: n.valor },
      })),
    ),
  ];

  // `PROBE_SO=reasoning,thinking` roda só o que casa. O rate limit da conta é
  // real e chega no meio da medição — na primeira rodada ele engoliu as três
  // últimas opções. Sem isto, remedir uma delas custa a lista inteira de novo,
  // e é a própria lista que gasta o limite.
  const filtro = process.env.PROBE_SO;
  if (!filtro) return todas;

  const termos = filtro.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
  return todas.filter((t) => termos.some((termo) => t.rotulo.toLowerCase().includes(termo)));
}

/** Mesmo formato de `diagnostico()` em src/lib/modelos.ts. */
function diagnostico(r: {
  finishReason?: string;
  text?: string;
  reasoningText?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    outputTokenDetails?: { reasoningTokens?: number };
  };
}): string {
  const n = (v: number | undefined) => (typeof v === "number" ? String(v) : "?");
  const u = r.usage;
  return [
    `finishReason=${r.finishReason ?? "?"}`,
    `entrada=${n(u?.inputTokens)}`,
    `saida=${n(u?.outputTokens)}`,
    `raciocinio=${n(u?.outputTokenDetails?.reasoningTokens)}`,
    `texto=${(r.text ?? "").length} char`,
    `pensamento=${(r.reasoningText ?? "").length} char`,
  ].join(" ");
}

/** De qual provedor o Gateway tirou a resposta — é a chave que a tabela precisa. */
function resolvido(metadata: unknown): string {
  const rota = (metadata as { gateway?: { routing?: { resolvedProvider?: unknown } } })?.gateway
    ?.routing?.resolvedProvider;
  return typeof rota === "string" ? rota : "?";
}

async function medir(t: Tentativa): Promise<void> {
  try {
    const r = await generateText({
      // String de propósito: id em string sai pelo Gateway (regra inviolável 8).
      model: MODELO,
      prompt: PROMPT,
      temperature: 0,
      maxOutputTokens: TETO,
      maxRetries: 0,
      providerOptions: t.opcoes,
    });

    const raciocinio = r.usage?.outputTokenDetails?.reasoningTokens;
    const temTexto = (r.text ?? "").trim().length > 0;
    // O que interessa é o par: pensou pouco **e** escreveu. Uma opção que zera o
    // raciocínio e continua devolvendo texto vazio não consertou nada.
    const marca = temTexto && typeof raciocinio === "number" && raciocinio < TETO / 4 ? "→" : " ";

    console.log(`  ${marca} ${t.rotulo.padEnd(40)} ${diagnostico(r)}`);

    for (const w of r.warnings ?? []) {
      console.log(`      aviso do provedor: ${JSON.stringify(w).slice(0, 140)}`);
    }
    if (t.opcoes === undefined) {
      console.log(`      provedor que atendeu: ${resolvido(r.providerMetadata)}`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`  ! ${t.rotulo.padEnd(40)} ${msg.slice(0, 120)}`);
  }
}

async function main() {
  const lista = tentativas();
  console.log(`\n${MODELO} — teto de ${TETO} tokens, ${lista.length} tentativa(s)`);
  console.log(
    "  → marca a opção que serve: raciocínio abaixo de um quarto do teto e texto presente.\n",
  );

  if (!process.env.AI_GATEWAY_API_KEY) {
    console.log("  falta AI_GATEWAY_API_KEY no ambiente — todo tráfego de modelo passa por ela.\n");
    process.exit(1);
  }

  // Em série, e não em paralelo: o rate limit da conta é o mesmo para todas
  // (src/lib/limite.ts), e sete chamadas de uma vez garantiriam 429 no meio da
  // medição — que é justamente o que confundiria o resultado.
  for (const t of lista) await medir(t);

  console.log(
    "\n  Lembre que hoje o sistema NÃO limita o pensamento, de propósito: contra o\n" +
      "  estouro de orçamento quem responde é o escalonamento de teto de extracao.ts.\n" +
      "  Isto aqui mede se dá para limitar, não decide que se deve.\n" +
      "  Se o provedor que atendeu não for o do id, rode de novo com PROBE_PROVEDOR=<ele>.\n",
  );
}

main();
