import type { Metadata } from "next";
import { getPublicSiteSettings } from "@/lib/system-settings-service";
import "./globals.css";

export function generateMetadata(): Metadata {
  const site = getPublicSiteSettings();
  return {
    title: `${site.siteName} · ${site.siteTagline}`,
    description: site.siteDescription,
    icons: site.faviconUrl ? { icon: site.faviconUrl, shortcut: site.faviconUrl } : undefined,
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
