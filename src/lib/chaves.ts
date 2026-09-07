/**
 * Layout do R2. Um lugar só monta chave — em toda rota, worker e teste.
 *
 *   sessoes/<id>/manifest.json
 *   sessoes/<id>/chunk_000.webm   (gravado no navegador)
 *   sessoes/<id>/chunk_000.opus   (arquivo importado — a extensão é a de origem)
 *   sessoes/<id>/chunk_000.json
 *   sessoes/<id>/candidatas_000.json
 *   sessoes/<id>/transcricao.json
 *   sessoes/<id>/parcial.json
 *   sessoes/<id>/extracao.json
 *   sessoes/<id>/extracao-anterior.json
 *   sessoes/<id>/correcoes.json
 *   calibracao/indice.json
 *   calibracao/regras-<hash>.json
 *   config/agentes.json
 *   config/prompt-<agente>-<hash>.json
 */
import { EXT_GRAVACAO, extensaoAceita } from "./audio";
import type { Manifest } from "./tipos";

export const prefixoSessao = (id: string) => `sessoes/${id}`;
export const chaveManifest = (id: string) => `${prefixoSessao(id)}/manifest.json`;
export const chaveTranscricao = (id: string) => `${prefixoSessao(id)}/transcricao.json`;

/**
 * A proposta de extração. A existência deste objeto é a trava de idempotência
 * da extração: se ele está lá, não se chama o modelo de novo nem se sobrescreve
 * proposta que já pode ter sido revisada.
 */
export const chaveExtracao = (id: string) => `${prefixoSessao(id)}/extracao.json`;

/**
 * A proposta enquanto ela ainda cresce (slice 4.8).
 *
 * Existe porque a extração deixou de acontecer no fim: cada janela de 2 min
 * fecha durante a própria gravação e acrescenta os átomos dela aqui. Quando a
 * última fecha, `extracao.json` é montado a partir deste objeto.
 *
 * Separado de `extracao.json` porque os dois têm donos diferentes no tempo:
 * este é escrito por vários `waitUntil` concorrentes, com read-modify-write por
 * etag; aquele é escrito uma vez, com `If-None-Match`, e é a trava de
 * idempotência da extração. Um objeto só não poderia ser as duas coisas.
 */
export const chaveParcial = (id: string) => `${prefixoSessao(id)}/parcial.json`;

/**
 * A proposta que o `forcar` sobrescreveu — **só a última**, não um histórico.
 *
 * É a única defesa contra regressão silenciosa que esta fatia oferece: com uma
 * regra nova em vigor, poder ver a lista anterior ao lado da nova é o que
 * permite dizer "piorou" olhando, sem inventar métrica de qualidade nenhuma.
 */
export const chaveExtracaoAnterior = (id: string) =>
  `${prefixoSessao(id)}/extracao-anterior.json`;

/**
 * O registro permanente do que eu corrigi naquela revisão (slice 4.6).
 *
 * Separado de `extracao.json` porque `forcar` sobrescreve a proposta sem
 * backup (`pipeline.ts`): correção guardada junto morreria na primeira
 * recalibração — que é exatamente quando ela mais vale.
 */
export const chaveCorrecoes = (id: string) => `${prefixoSessao(id)}/correcoes.json`;

/**
 * A mesa de trabalho da calibração: o acumulado de todas as sessões.
 *
 * Existe porque `r2.ts` não tem `LIST` — sem um objeto que reúna as correções,
 * cada uma seria alcançável só por quem já soubesse o id da sessão. Fora do
 * prefixo `sessoes/` de propósito: não é de sessão nenhuma.
 */
export const chaveIndiceCalibracao = () => `calibracao/indice.json`;

/**
 * Uma versão de regras aprovada, **imutável para sempre**.
 *
 * O nome é o próprio hash porque é ele que aparece no `prompt_version` do
 * átomo (`extracao-6+a3f91c7d`): dado um átomo de três meses atrás, o texto do
 * prompt que o produziu se acha por esta chave e por mais nada.
 */
export const chaveRegras = (hash: string) => `calibracao/regras-${hash}.json`;

/**
 * O que eu editei dos agentes: por agente, o hash do prompt e o modelo.
 *
 * Um objeto só para os sete, e não um por agente, porque a tela e cada chamada
 * de agente querem o mesmo retrato — sete GETs para responder "o que está em
 * vigor" seria pagar sete vezes pela mesma pergunta.
 *
 * Fora de `sessoes/` e fora de `calibracao/`: não é de sessão nenhuma e não é
 * material de calibração; é configuração.
 */
export const chaveAgentes = () => `config/agentes.json`;

/**
 * Um prompt editado, **imutável para sempre** — o gêmeo de `chaveRegras`.
 *
 * O nome carrega o agente **e** o hash porque o mesmo texto em dois agentes
 * seria o mesmo hash, e ler `config/prompt-a3f91c7d.json` não diria de quem é.
 * É por esta chave, e por mais nenhuma, que um átomo carimbado
 * `extracao-6+a3f91c7d` resolve o texto que o produziu.
 */
export const chavePromptAgente = (agente: string, hash: string) => {
  if (!/^[a-z]{3,20}$/.test(agente)) throw new Error(`Agente inválido: ${agente}`);
  if (!/^[0-9a-f]{8,64}$/.test(hash)) throw new Error(`Hash inválido: ${hash}`);
  return `config/prompt-${agente}-${hash}.json`;
};

export function indiceChunk(i: number): string {
  if (!Number.isInteger(i) || i < 0 || i > 999_999) {
    throw new Error(`Índice de bloco inválido: ${i}`);
  }
  return String(i).padStart(3, "0");
}

/**
 * A extensão vira caminho no R2, então é validada aqui e não só na rota:
 * este é o único lugar que monta a chave, e quem confia no chamador
 * escreve fora do prefixo da sessão mais cedo ou mais tarde.
 */
export const chaveChunkAudio = (id: string, i: number, ext: string = EXT_GRAVACAO) => {
  if (!extensaoAceita(ext)) throw new Error(`Extensão de áudio inválida: ${ext}`);
  return `${prefixoSessao(id)}/chunk_${indiceChunk(i)}.${ext}`;
};

export const chaveChunkTranscricao = (id: string, i: number) =>
  `${prefixoSessao(id)}/chunk_${indiceChunk(i)}.json`;

/** Aceita só o formato que este sistema gera. Barra a travessia de caminho. */
export function idValido(id: string): boolean {
  return /^[0-9a-z]{8,40}$/.test(id);
}

/**
 * As candidatas que o grafo aponta para um bloco (slice 4.9).
 *
 * **Espelho exato de `chunk_NNN.json`**, e de propósito: a existência do objeto
 * é a trava de idempotência do RAG, como a do bloco é a da transcrição (regra
 * 4). Um bloco já consultado não é reconsultado nem repago, por mais vezes que
 * `/pronto` e `/finalizar` passem por ele.
 */
export const chaveChunkCandidatas = (id: string, i: number) =>
  `${prefixoSessao(id)}/candidatas_${indiceChunk(i)}.json`;

/**
 * Tudo o que uma sessão tem no R2 — para apagar (slice 4.10).
 *
 * Mora aqui porque **um lugar só monta chave**: enumerar objetos de sessão numa
 * rota seria a segunda cópia do layout, e ela envelheceria calada na primeira
 * chave nova.
 *
 * Sai do manifest, e não de um `LIST`, porque `r2.ts` não tem `LIST` — é o
 * manifest que sabe quantos blocos existem e com que extensão cada um foi
 * subido. **Por isso ele vem por último na lista**, e apagar na ordem devolvida
 * é o que importa: apagá-lo primeiro perderia a lista de blocos e deixaria
 * trinta e cinco objetos inalcançáveis, sem `LIST` para reencontrá-los.
 *
 * A extensão sai de `c.ext ?? EXT_GRAVACAO`, que é o que `extensaoDoChunk` faz
 * — chamá-la aqui fecharia um ciclo, porque `manifest.ts` importa este módulo.
 *
 * As fixas entram mesmo quando não existem: apagar objeto que não está lá é
 * 404, e `remover` trata 404 como sucesso. Perguntar antes custaria um HEAD por
 * chave para economizar um DELETE por chave.
 *
 * O que **não** entra, de propósito: `calibracao/indice.json`. As correções
 * desta sessão são material de calibração, não dado de sessão, e apagá-las
 * seria desaprender.
 */
export function chavesDaSessao(m: Manifest): string[] {
  const id = m.sessao_id;

  const porBloco = m.chunks.flatMap((c) => [
    chaveChunkAudio(id, c.i, c.ext ?? EXT_GRAVACAO),
    chaveChunkTranscricao(id, c.i),
    chaveChunkCandidatas(id, c.i),
  ]);

  return [
    ...porBloco,
    chaveTranscricao(id),
    chaveParcial(id),
    chaveExtracao(id),
    chaveExtracaoAnterior(id),
    chaveCorrecoes(id),
    chaveManifest(id), // por último, sempre — ver o docstring
  ];
}
