import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import "flag-icons/css/flag-icons.min.css";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";
import { ClerkSessionGate } from "../components/clerk-session-gate";

export const metadata: Metadata = {
  title: "Geostats",
  description: "Local-first geocaching statistics",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/geostats-icon-192.png", type: "image/png", sizes: "192x192" },
      { url: "/geostats-favicon.svg", type: "image/svg+xml" },
      { url: "/geostats-icon.svg", type: "image/svg+xml", sizes: "1024x1024" }
    ],
    shortcut: [{ url: "/favicon.ico" }],
    apple: [{ url: "/geostats-apple-touch-icon.png", type: "image/png", sizes: "180x180" }]
  }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim();
  const configuredAuthMode = process.env.NEXT_PUBLIC_AUTH_MODE?.trim();
  const clerkEnabled = Boolean(publishableKey) && configuredAuthMode !== "password" && configuredAuthMode !== "dev";

  return (
    <html lang="en">
      <body>
        {clerkEnabled ? (
          <ClerkProvider publishableKey={publishableKey}>
            <ClerkSessionGate>{children}</ClerkSessionGate>
          </ClerkProvider>
        ) : (
          children
        )}
      </body>
    </html>
  );
}
