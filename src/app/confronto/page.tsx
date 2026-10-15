import type { Metadata } from "next";
import { Confronto } from "@/components/Confronto";

export const metadata: Metadata = { title: "confronto" };

export default function PaginaConfronto() {
  return <Confronto />;
}
