import type { Metadata } from "next";
import "./globals.css";

// rubens-claude-design's Type section is system fonts throughout (Arial/
// Helvetica UI, Menlo/Consolas mono, Georgia editorial) — no Google Fonts
// to load, unlike the retired design-canon.md's Inter/IBM Plex Mono.
export const metadata: Metadata = {
  title: "RubensJournal",
  description: "A syndicate of agents searching the space a hand-derived generator opens.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
