import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Lato } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

// Design asks for Lato 400/600/700/800; Google's Lato ships 300/400/700/900,
// so 600→700 and 800→900 (see DECISIONS.md).
const lato = Lato({
  variable: "--font-lato",
  subsets: ["latin"],
  weight: ["300", "400", "700", "900"],
});

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["500", "600"],
});

export const metadata: Metadata = {
  title: "DailyLog Admin",
  description: "Center operations console for DailyLog",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${lato.variable} ${plexSans.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
