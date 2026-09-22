import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { AuthenticatedShell } from '@/components/layout/AuthenticatedShell';
import './globals.css';

const geistSans = localFont({
  src: './fonts/GeistVF.woff',
  variable: '--font-geist-sans',
});

export const metadata: Metadata = {
  title: '企鹅岛 - 猎头岗位匹配系统',
  description: 'AI驱动的猎头JD岗位智能匹配平台，支持简历解析、岗位匹配和面试流程管理',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className={`${geistSans.className} text-slate-900 antialiased`}>
        <AuthenticatedShell>{children}</AuthenticatedShell>
      </body>
    </html>
  );
}
