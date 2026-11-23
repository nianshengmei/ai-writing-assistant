import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI 写作助手",
  description: "AI 小说写作神器：记忆库 · 风格库 · 草稿工作流 · 生成历史",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
