import type { Metadata } from "next";
import "flag-icons/css/flag-icons.min.css";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Geostats",
  description: "Local-first geocaching statistics",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/geostats-favicon.svg", type: "image/svg+xml" },
      { url: "/geostats-icon.svg", type: "image/svg+xml", sizes: "1024x1024" }
    ],
    apple: [{ url: "/geostats-icon.svg", type: "image/svg+xml" }]
  }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
