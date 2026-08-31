import { Revisao } from "@/components/Revisao";

export default async function PaginaRevisao({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Revisao id={id} />;
}
