import type { Metadata } from "next";
import { Entidades } from "@/components/Entidades";

export const metadata: Metadata = { title: "entidades" };

export default function PaginaEntidades() {
  return <Entidades />;
}
