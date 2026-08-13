import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Suspense } from "react";
import { TopNav } from "@/components/top-nav";
import { Zoya } from "@/components/zoya";
import { cn } from "@/lib/utils";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

/** Hashes, addresses, confidence scores, and every figure in a data column. */
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "TokenForge",
  description:
    "Only verified issuers can turn real financial agreements into programmable onchain assets.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      // Dark-only for now; the class is what enables shadcn's `dark:` variants.
      className={cn("dark h-full antialiased", inter.variable, jetbrainsMono.variable)}
    >
      <body className="flex min-h-full flex-col">
        <Providers>
          <TopNav />
          <main className="flex-1">{children}</main>
          {/* Reads the route to know which note is on screen, so it needs the
              same Suspense treatment the workspace does. */}
          <Suspense fallback={null}>
            <Zoya />
          </Suspense>
        </Providers>
      </body>
    </html>
  );
}
