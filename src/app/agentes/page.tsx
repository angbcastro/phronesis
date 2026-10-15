import type { Metadata } from "next";
import { Agentes } from "@/components/Agentes";

export const metadata: Metadata = { title: "agentes" };

/** O caminho de entrar: da minha voz até o grafo. */
export default function PaginaAgentes() {
  return <Agentes fluxo="ingestao" />;
}
