"use client";

/**
 * Põe a classe da fonte em volta da tela, conforme a rota.
 *
 * A regra mora em `tipografia.ts`, puro e testado; aqui só se consulta o
 * caminho. `usePathname()` resolve também no SSR, então a classe já vem no HTML
 * — sem troca de fonte no primeiro quadro.
 *
 * A `Marca` fica de fora deste embrulho de propósito: é um SVG, não tem texto.
 */
import { usePathname } from "next/navigation";
import { ehRitual } from "@/lib/tipografia";

export function Tipografia({ children }: { children: React.ReactNode }) {
  return <div className={ehRitual(usePathname()) ? "ritual" : "gestao"}>{children}</div>;
}
