import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MIS — Management Information System",
  description:
    "A unified platform for schools, clinics, NGOs, and civic agencies to manage operations, scale programs, and handle complex reporting.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
    >
      <body>{children}</body>
    </html>
  );
}
