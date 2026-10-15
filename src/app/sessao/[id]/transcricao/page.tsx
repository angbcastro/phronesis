import type { Metadata } from "next";
import { Leitura } from "@/components/Leitura";

export const metadata: Metadata = { title: "transcrição" };

export default async function PaginaTranscricao({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Leitura id={id} />;
}
