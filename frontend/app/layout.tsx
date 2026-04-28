import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kural TTS",
  description: "Privacy-first text-to-speech. Runs entirely offline.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
