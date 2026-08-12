import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "StarBot Console · QQ 官方机器人平台",
  description: "面向团队的多用户、多机器人、可扩展 QQ 官方机器人管理与开发平台。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
