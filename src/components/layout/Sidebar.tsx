'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/store/ui-store';
import { LayoutDashboard, Briefcase, FileSearch, CalendarDays, ChevronLeft, ChevronRight, Settings, Users, Flame, Send } from 'lucide-react';

const menuItems = [
  { href: '/', label: '推荐中心', icon: LayoutDashboard },
  { href: '/repush-pool', label: '本周推荐', icon: Send },
  { href: '/hot-hiring', label: '热招看板', icon: Flame },
  { href: '/jd-library', label: 'JD 库', icon: Briefcase },
  { href: '/talent-pool', label: '人才库', icon: Users },
  { href: '/resume-matching', label: '简历匹配', icon: FileSearch },
  { href: '/interview-calendar', label: '面试日历', icon: CalendarDays },
];

export function Sidebar() {
  const pathname = usePathname();
  const mobileNavOpen = useUIStore((s) => s.mobileNavOpen);
  const navCollapsed = useUIStore((s) => s.navCollapsed);
  const closeNav = useUIStore((s) => s.closeNav);
  const toggleCollapsed = useUIStore((s) => s.toggleCollapsed);

  // 桌面折叠时隐藏文字标签；移动端抽屉始终显示完整标签
  const labelHidden = navCollapsed ? 'lg:hidden' : '';

  return (
    <>
      {/* 移动端遮罩：点击关闭抽屉 */}
      <div
        onClick={closeNav}
        className={cn(
          'fixed inset-0 z-30 bg-black/40 backdrop-blur-sm transition-opacity lg:hidden',
          mobileNavOpen ? 'opacity-100' : 'opacity-0 pointer-events-none',
        )}
      />
      <aside className={cn(
        'fixed left-0 top-0 h-full z-40 flex flex-col border-r border-gray-200 bg-white transition-all duration-300',
        'w-[240px]',
        navCollapsed ? 'lg:w-[64px]' : 'lg:w-[240px]',
        mobileNavOpen ? 'translate-x-0' : '-translate-x-full',
        'lg:translate-x-0',
      )}>
        <div className="h-16 flex items-center gap-3 px-4 border-b border-gray-100 shrink-0">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-cyan-500 flex items-center justify-center shrink-0">
            <span className="text-white text-sm">🐧</span>
          </div>
          <span className={cn('font-semibold text-sm text-gray-800', labelHidden)}>企鹅岛</span>
        </div>

        <nav className="flex-1 py-4 px-2 space-y-1">
          {menuItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link key={item.href} href={item.href} onClick={closeNav} className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200',
                isActive ? 'bg-indigo-50 text-indigo-700' : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50',
              )}>
                <item.icon className={cn('w-5 h-5 shrink-0', isActive && 'text-indigo-500')} />
                <span className={labelHidden}>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="p-2 border-t border-gray-100">
          <Link href="/settings" onClick={closeNav} className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-gray-500 hover:text-gray-800 hover:bg-gray-50 transition-all">
            <Settings className="w-5 h-5 shrink-0" />
            <span className={labelHidden}>设置</span>
          </Link>
          {/* 折叠开关仅桌面端显示 */}
          <button onClick={toggleCollapsed} className="hidden lg:flex w-full items-center justify-center py-2 mt-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-all">
            {navCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        </div>
      </aside>
    </>
  );
}
