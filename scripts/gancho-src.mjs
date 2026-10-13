/**
 * Deixa um script em `scripts/` importar de `src/` rodando em node puro.
 *
 * `src/` é escrito para o bundler do Next: alias `@/` e import relativo sem
 * extensão. O node remove os tipos do `.ts` sozinho (v22.18+), mas não resolve
 * nenhum dos dois. Este gancho resolve só isso — e nada mais: o que ele não
 * reconhece segue para o resolvedor padrão.
 *
 * É o que deixa `comparar-confronto.ts` usar o prompt e o parser de produção
 * em vez de uma cópia que divergiria em silêncio. Os outros scripts continuam
 * soltos (`smoke.ts`, `raciocinio.ts`), por decisão já registrada neles.
 *
 *   node --import ./scripts/gancho-src.mjs scripts/comparar-confronto.ts
 */
import { register } from "node:module";

register("./gancho-src-resolver.mjs", import.meta.url);
