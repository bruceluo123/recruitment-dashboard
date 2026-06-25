import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '跨境 AI 渠道助手',
}

export default function StandaloneLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  )
}
