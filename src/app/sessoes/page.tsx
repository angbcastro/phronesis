import type { Metadata } from "next";
import { Sessoes } from "@/components/Sessoes";

export const metadata: Metadata = { title: "sessões" };

export default function PaginaSessoes() {
  return <Sessoes />;
}
