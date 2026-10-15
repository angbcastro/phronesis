import type { Metadata } from "next";
import { Revisao } from "@/components/Revisao";

export const metadata: Metadata = { title: "revisão" };

export default async function PaginaRevisao({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Revisao id={id} />;
}
