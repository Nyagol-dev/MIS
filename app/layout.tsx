import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Hospital Management Information System",
    template: "%s | HMIS",
  },
  description: "Hospital operations, patient care, clinical services, health records, billing, and claims.",
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
