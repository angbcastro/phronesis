import type { Metadata, Viewport } from "next";
import { Marca } from "@/components/Marca";
import "./globals.css";

export const metadata: Metadata = {
  title: "Phronesis",
  description: "Diário falado.",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#0d0d0d",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        {/* Fica no layout, não em cada tela: assim nenhuma tela nova nasce sem
            caminho de volta. Ela mesma decide onde não aparecer. */}
        <Marca />
        {children}
      </body>
    </html>
  );
}
