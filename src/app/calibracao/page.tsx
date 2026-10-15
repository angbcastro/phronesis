import type { Metadata } from "next";
import { Calibracao } from "@/components/Calibracao";

export const metadata: Metadata = { title: "calibração" };

export default function PaginaCalibracao() {
  return <Calibracao />;
}
