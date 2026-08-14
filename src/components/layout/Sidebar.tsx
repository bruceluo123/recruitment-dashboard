'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/store/ui-store';
import { LayoutDashboard, Briefcase, FileSearch, CalendarDays, ChevronLeft, ChevronRight, Settings, Users, Flame, Send, ListTodo, Building2 } from 'lucide-react';

const menuSections = [
  [
    { href: '/', label: '推荐中心', icon: LayoutDashboard },
    { href: '/jd-library', label: 'JD 库', icon: Briefcase },
    { href: '/resume-matching', label: '简历匹配', icon: FileSearch },
    { href: '/interview-calendar', label: '面试日历', icon: CalendarDays },
  ],
  [
    { href: '/hot-hiring', label: '热招看板', icon: Flame },
    { href: '/talent-pool', label: '人才库', icon: Users },
    { href: '/companies', label: '公司库', icon: Building2 },
    { href: '/repush-pool', label: '本周推荐', icon: Send },
    { href: '/todos', label: '待办事项', icon: ListTodo },
  ],
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
          'fixed inset-0 z-30 bg-slate-950/30 backdrop-blur-sm transition-opacity lg:hidden',
          mobileNavOpen ? 'opacity-100' : 'opacity-0 pointer-events-none',
        )}
      />
      <aside className={cn(
        'fixed left-0 top-0 h-full z-40 flex flex-col border-r border-slate-200/80 bg-white transition-all duration-300',
        'w-[240px]',
        navCollapsed ? 'lg:w-[64px]' : 'lg:w-[240px]',
        mobileNavOpen ? 'translate-x-0' : '-translate-x-full',
        'lg:translate-x-0',
      )}>
        <div className="h-16 flex items-center gap-3 px-4 border-b border-slate-100 shrink-0">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shrink-0 shadow-sm shadow-blue-200">
            <span className="text-white text-sm">🐧</span>
          </div>
          <span className={cn('font-semibold text-sm text-gray-800', labelHidden)}>企鹅岛</span>
        </div>

        <nav className="flex-1 px-2 py-4 overflow-y-auto">
          {menuSections.map((section, sectionIndex) => (
            <div key={sectionIndex} className={cn('space-y-1', sectionIndex > 0 && 'mt-4 border-t border-slate-100 pt-4')}>
              {section.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <Link key={item.href} href={item.href} onClick={closeNav} className={cn(
                    'group/nav relative flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 text-[15px] font-semibold transition-all duration-200',
                    isActive
                      ? 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-100'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50 active:scale-[0.98]',
                  )}>
                    {isActive && <span className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-blue-500" />}
                    <item.icon className={cn('w-5 h-5 shrink-0 transition-colors', isActive ? 'text-blue-600' : 'text-slate-400 group-hover/nav:text-slate-600')} />
                    <span className={labelHidden}>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="p-2 border-t border-slate-100">
          <Link href="/settings" onClick={closeNav} className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-slate-500 hover:text-slate-800 hover:bg-slate-50 transition-all">
            <Settings className="w-5 h-5 shrink-0" />
            <span className={labelHidden}>设置</span>
          </Link>
          {/* 折叠开关仅桌面端显示 */}
          <button onClick={toggleCollapsed} className="hidden lg:flex w-full items-center justify-center py-2 mt-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-all">
            {navCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        </div>
      </aside>
    </>
  );
}
