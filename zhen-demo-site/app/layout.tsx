import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "甄不想加班 · C 端交互 Demo",
  description: "职场 Say No AI 参谋移动端产品交互演示",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
