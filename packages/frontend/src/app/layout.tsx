import type { Metadata } from "next";
import { Manrope, JetBrains_Mono, Bebas_Neue } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";
import { AuthProvider } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { OrgProvider } from "@/contexts/OrgContext";
import { Toaster } from "sonner";

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

// Stat / numeric display font — Bebas Neue. Condensed, sporty, instantly
// readable at huge sizes. Matches the "Colin Murphy" PPL pitching report
// aesthetic so the app feels brand-consistent with the PDFs coaches already
// hand out. Used ONLY for big numeric readouts (prices, stat cards,
// capacity counters) via the font-stat utility — NEVER for body text.
const bebasNeue = Bebas_Neue({
  variable: "--font-bebas",
  subsets: ["latin"],
  weight: "400",
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

// Accent display font — Transducer (Chad-licensed, self-hosted). Big bold
// italic with a sporty, performance-driven look. Great for short punchy
// sub-headings like "WHAT'S YOUR PLAYING LEVEL?" where we want personality
// the brand heading (Bank Gothic) doesn't carry alone. Always pair with
// UPPERCASE — it's a display face and looks cramped in mixed case.
const transducer = localFont({
  variable: "--font-transducer",
  display: "swap",
  src: [
    { path: "../../public/fonts/Transducer-Black.otf", weight: "900", style: "normal" },
    { path: "../../public/fonts/Transducer-BlackOblique.otf", weight: "900", style: "italic" },
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
      className={`${manrope.variable} ${jetbrainsMono.variable} ${bankGothic.variable} ${transducer.variable} ${bebasNeue.variable} h-full antialiased`}
    >
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#15803d" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="PPL" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="icon" type="image/png" sizes="192x192" href="/ppl-icon-192.png" />
        <link rel="icon" type="image/png" sizes="512x512" href="/ppl-icon-512.png" />
      </head>
      <body className="min-h-full flex flex-col font-sans">
        <OrgProvider>
          <ThemeProvider>
            <AuthProvider>{children}</AuthProvider>
          </ThemeProvider>
        </OrgProvider>
        {/* Sonner toasts — premium non-blocking notifications.
            Positioned top-right on desktop, top-center on mobile.
            Dark theme styling + PPL brand accents via `toastOptions`. */}
        <Toaster
          position="top-right"
          richColors
          closeButton
          expand={false}
          toastOptions={{
            duration: 4500,
            classNames: {
              toast: 'font-sans',
            },
          }}
        />
      </body>
    </html>
  );
}
