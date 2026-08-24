import { Leitura } from "@/components/Leitura";

export default async function PaginaSessao({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Leitura id={id} />;
}
