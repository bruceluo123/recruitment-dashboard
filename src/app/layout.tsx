import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { AppShell } from '@/components/layout/AppShell';
import { SyncProvider } from '@/components/layout/SyncProvider';
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
      <body className={`${geistSans.className} bg-gray-50 text-gray-900 antialiased`}>
        <SyncProvider>
          <AppShell>{children}</AppShell>
        </SyncProvider>
      </body>
    </html>
  );
}
