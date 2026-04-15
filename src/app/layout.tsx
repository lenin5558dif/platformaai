import type { Metadata } from "next";
import { Inter, Space_Grotesk } from "next/font/google"; // Import Space_Grotesk
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "cyrillic"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "PlatformaAI",
  description: "Платформа-агрегатор ИИ с единым чатом и биллингом.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body className={`${inter.variable} ${spaceGrotesk.variable} antialiased bg-[#fdf8f5]`}>{children}</body>
    </html>
  );
}
