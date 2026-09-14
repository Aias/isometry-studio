import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Isometry · Drawing Studio",
  description: "Generate isometric drawings from lines, connections, and solid surfaces.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
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
