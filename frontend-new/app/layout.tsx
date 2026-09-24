import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CompliLens — Legal Metrology Packaging Compliance",
  description:
    "Automated packaging inspection and statutory compliance checking under the Legal Metrology (Packaged Commodities) Rules, 2011.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200"
        />
      </head>
      <body className="bg-paper text-ink antialiased font-body">
        {children}
      </body>
    </html>
  );
}
