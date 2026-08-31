import { Processando } from "@/components/Processando";

export default async function PaginaSessao({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Processando id={id} />;
}
