/** O resolvedor de `gancho-src.mjs`: `@/` vira `src/`, e o relativo sem extensão ganha `.ts`. */
const SRC = new URL("../src/", import.meta.url);

const semExtensao = (s) => !/\.[cm]?[jt]sx?$|\.json$/.test(s);

export async function resolve(especificador, contexto, proximo) {
  let alvo = especificador;
  if (alvo.startsWith("@/")) alvo = new URL(alvo.slice(2), SRC).href;

  const relativo = alvo.startsWith(".") || alvo.startsWith("file:");
  if (relativo && semExtensao(alvo)) {
    for (const ext of [".ts", ".tsx", "/index.ts"]) {
      try {
        return await proximo(alvo + ext, contexto);
      } catch {
        // tenta a próxima
      }
    }
  }
  return proximo(alvo, contexto);
}
