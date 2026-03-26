import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "EVO Dashboard",
  description: "LegAI & EVO-X2 control panel",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="cs">
      <body className="bg-gray-950 text-gray-100 min-h-screen">{children}</body>
    </html>
  );
}
