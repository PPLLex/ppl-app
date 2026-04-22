import type { Metadata } from "next";
import { Manrope, JetBrains_Mono } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";
import { AuthProvider } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { OrgProvider } from "@/contexts/OrgContext";

// Body / UI font — Manrope. Geometric bones to echo Bank Gothic, rounded
// terminals for warmth and mobile readability. Used for every non-display
// piece of text in the app.
const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  display: "swap",
});

// Monospace — numeric-heavy UI (session counts, velo if we ever surface it).
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  display: "swap",
});

// Display / headline font — Bank Gothic (Chad-licensed, self-hosted).
// Used ONLY for brand-carrying headings: page titles, section banners.
// NEVER for body copy — Bank Gothic is all-caps square and hurts readability
// below ~14px.
const bankGothic = localFont({
  variable: "--font-bank-gothic",
  display: "swap",
  src: [
    { path: "../../public/fonts/BankGothic-Light.otf", weight: "300", style: "normal" },
    { path: "../../public/fonts/BankGothic-Medium.ttf", weight: "500", style: "normal" },
    { path: "../../public/fonts/BankGothic-Bold.ttf", weight: "700", style: "normal" },
  ],
});

export const metadata: Metadata = {
  title: "PPL — Pitching Performance Lab",
  description: "Book sessions, manage your membership, and train with PPL.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${manrope.variable} ${jetbrainsMono.variable} ${bankGothic.variable} h-full antialiased`}
    >
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#15803d" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body className="min-h-full flex flex-col font-sans">
        <OrgProvider>
          <ThemeProvider>
            <AuthProvider>{children}</AuthProvider>
          </ThemeProvider>
        </OrgProvider>
      </body>
    </html>
  );
}
