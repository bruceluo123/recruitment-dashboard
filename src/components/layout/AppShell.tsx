'use client';
import { Sidebar } from './Sidebar';
import { TopNav } from './TopNav';
import { useUIStore } from '@/store/ui-store';
import { cn } from '@/lib/utils';
import { QuickTodoDrawer } from '@/components/todos/QuickTodoDrawer';

/** 客户端外壳：根据桌面侧栏折叠状态动态调整内容左内边距；移动端无左内边距（抽屉悬浮覆盖）。 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const navCollapsed = useUIStore((s) => s.navCollapsed);
  return (
    <>
      <Sidebar />
      <div className={cn('workspace-canvas min-h-screen transition-all duration-300', navCollapsed ? 'lg:pl-[72px]' : 'lg:pl-[248px]')}>
        <TopNav />
        <main className="min-h-[calc(100vh-4.5rem)] p-4 sm:p-6 lg:px-8 lg:py-7">{children}</main>
      </div>
      <QuickTodoDrawer />
    </>
  );
}
