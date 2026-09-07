import type { Metadata, Viewport } from "next";
import { Inter, Nunito } from "next/font/google";
import { Marca } from "@/components/Marca";
import { Tipografia } from "@/components/Tipografia";
import "./globals.css";

/**
 * Duas fontes, uma por natureza de tela — ver `src/lib/tipografia.ts`.
 *
 * `next/font/google` baixa na build e serve do próprio domínio: nenhuma
 * requisição a terceiros em tempo de execução, e nenhum salto de layout quando
 * a fonte chega. O preço é `next build` passar a precisar de rede.
 */
const gestao = Inter({ subsets: ["latin"], variable: "--fonte-gestao", display: "swap" });
const ritual = Nunito({ subsets: ["latin"], variable: "--fonte-ritual", display: "swap" });

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
    <html lang="pt-BR" className={`${gestao.variable} ${ritual.variable}`}>
      {/* Nada neste app escreve no `<body>`: não há script inline, nem
          `document.body` em lugar nenhum de `src/`. O descasamento que este
          atributo cala vem de fora — extensão de navegador que injeta atributo
          ali antes de o React hidratar. Fica **só** no `<body>`: suprimir
          hidratação é desligar um alarme, e desligá-lo mais fundo esconderia
          divergência de verdade entre o que o servidor mandou e o que a tela
          montou. */}
      <body suppressHydrationWarning>
        {/* Fica no layout, não em cada tela: assim nenhuma tela nova nasce sem
            caminho de volta. Ela mesma decide onde não aparecer. */}
        <Marca />
        <Tipografia>{children}</Tipografia>
      </body>
    </html>
  );
}
