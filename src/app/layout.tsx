import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { AuthProvider } from "@/lib/supabase-auth";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
  fallback: ["system-ui", "Arial", "sans-serif"],
});

const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
  fallback: ["ui-monospace", "Consolas", "monospace"],
});

export const metadata: Metadata = {
  title: "Duty Sync | Military Duty Roster Management",
  description: "Scalable, automated, and fair digital system for military duty roster management",
  keywords: ["military", "duty roster", "scheduling", "USMC", "duty management"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
