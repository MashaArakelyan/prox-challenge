import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OmniPro 220 Agent",
  description: "Technical assistant for the Vulcan OmniPro 220 multiprocess welder",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full antialiased">{children}</body>
    </html>
  );
}
