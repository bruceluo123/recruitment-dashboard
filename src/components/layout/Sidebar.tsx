'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/store/ui-store';
import { LayoutDashboard, Briefcase, FileSearch, CalendarDays, ChevronLeft, ChevronRight, Settings, Users, Flame, Send, ListTodo, Building2, Sparkles } from 'lucide-react';

const menuSections = [
  { label: '核心工作台', items: [
    { href: '/', label: '推荐中心', icon: LayoutDashboard },
    { href: '/repush-pool', label: '反馈中心', icon: Send },
    { href: '/jd-library', label: 'JD 库', icon: Briefcase },
    { href: '/resume-matching', label: '简历匹配', icon: FileSearch },
    { href: '/interview-calendar', label: '面试/Offer', icon: CalendarDays },
  ] },
  { label: '资源与管理', items: [
    { href: '/hot-hiring', label: '热招看板', icon: Flame },
    { href: '/talent-pool', label: '人才库', icon: Users },
    { href: '/companies', label: '公司库', icon: Building2 },
    { href: '/todos', label: '待办事项', icon: ListTodo },
  ] },
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
          'fixed inset-0 z-30 bg-slate-950/35 backdrop-blur-sm transition-opacity lg:hidden',
          mobileNavOpen ? 'opacity-100' : 'opacity-0 pointer-events-none',
        )}
      />
      <aside className={cn(
        'fixed left-0 top-0 h-full z-40 flex flex-col border-r border-[#1d3153] bg-[#10213d] text-white transition-all duration-300',
        'w-[248px]',
        navCollapsed ? 'lg:w-[72px]' : 'lg:w-[248px]',
        mobileNavOpen ? 'translate-x-0' : '-translate-x-full',
        'lg:translate-x-0',
      )}>
        <div className="flex h-[72px] shrink-0 items-center gap-3 border-b border-white/10 px-5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#4e7af3] shadow-[0_8px_20px_rgba(0,0,0,0.22)]">
            <span className="text-base text-white">🐧</span>
          </div>
          <div className={labelHidden}>
            <span className="block text-[15px] font-bold tracking-[-0.02em] text-white">企鹅岛</span>
            <span className="block text-[10px] font-medium tracking-[0.12em] text-[#8fa9d3]">RECRUITING OS</span>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-5">
          {menuSections.map((section, sectionIndex) => (
            <div key={section.label} className={cn('space-y-1', sectionIndex > 0 && 'mt-6')}>
              <p className={cn('mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#7e98bf]', labelHidden)}>{section.label}</p>
              {section.items.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <Link key={item.href} href={item.href} onClick={closeNav} className={cn(
                    'group/nav relative flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] font-medium transition-[background-color,color,box-shadow,transform] duration-200',
                    isActive
                      ? 'bg-[#3569e8] font-semibold text-white shadow-[0_8px_22px_rgba(12,32,82,0.35)]'
                      : 'text-[#b7c7e2] hover:bg-white/10 hover:text-white active:scale-[0.99]',
                  )}>
                    {isActive && <span className="absolute -left-3 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-[#78a3ff]" />}
                    <item.icon className={cn('h-[18px] w-[18px] shrink-0 transition-colors', isActive ? 'text-white' : 'text-[#8da6cc] group-hover/nav:text-white')} />
                    <span className={labelHidden}>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="border-t border-white/10 p-3">
          <div className={cn('mb-2 flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-xs text-[#a9bbd8]', labelHidden)}>
            <Sparkles className="h-3.5 w-3.5 text-[#79a3ff]" />把合适的人，送到合适的岗位
          </div>
          <Link href="/settings" onClick={closeNav} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-[#a9bbd8] transition-colors hover:bg-white/10 hover:text-white">
            <Settings className="h-[18px] w-[18px] shrink-0" />
            <span className={labelHidden}>设置</span>
          </Link>
          {/* 折叠开关仅桌面端显示 */}
          <button onClick={toggleCollapsed} className="mt-1 hidden w-full items-center justify-center rounded-xl py-2 text-[#8da6cc] transition-colors hover:bg-white/10 hover:text-white lg:flex" aria-label={navCollapsed ? '展开侧栏' : '收起侧栏'}>
            {navCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        </div>
      </aside>
    </>
  );
}
