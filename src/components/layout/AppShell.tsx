'use client';
import { Sidebar } from './Sidebar';
import { TopNav } from './TopNav';
import { useUIStore } from '@/store/ui-store';
import { cn } from '@/lib/utils';

/** 客户端外壳：根据桌面侧栏折叠状态动态调整内容左内边距；移动端无左内边距（抽屉悬浮覆盖）。 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const navCollapsed = useUIStore((s) => s.navCollapsed);
  return (
    <>
      <Sidebar />
      <div className={cn('transition-all duration-300', navCollapsed ? 'lg:pl-[64px]' : 'lg:pl-[240px]')}>
        <TopNav />
        <main className="p-4 sm:p-6 min-h-[calc(100vh-4rem)]">{children}</main>
      </div>
    </>
  );
}
