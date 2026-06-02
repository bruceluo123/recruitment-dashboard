'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { LayoutDashboard, Briefcase, FileSearch, CalendarDays, ChevronLeft, ChevronRight, Settings, Users, Flame, Send } from 'lucide-react';

const menuItems = [
  { href: '/', label: '仪表盘', icon: LayoutDashboard },
  { href: '/hot-hiring', label: '热招看板', icon: Flame },
  { href: '/jd-library', label: 'JD 库', icon: Briefcase },
  { href: '/talent-pool', label: '人才库', icon: Users },
  { href: '/resume-matching', label: '简历匹配', icon: FileSearch },
  { href: '/repush-pool', label: '今日复推池', icon: Send },
  { href: '/interview-calendar', label: '面试日历', icon: CalendarDays },
];

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();

  return (
    <aside className={cn(
      'fixed left-0 top-0 h-full z-30 flex flex-col border-r border-gray-200 bg-white transition-all duration-300',
      collapsed ? 'w-[64px]' : 'w-[240px]',
    )}>
      <div className="h-16 flex items-center gap-3 px-4 border-b border-gray-100 shrink-0">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-cyan-500 flex items-center justify-center shrink-0">
          <span className="text-white text-sm">🐧</span>
        </div>
        {!collapsed && <span className="font-semibold text-sm text-gray-800">企鹅岛</span>}
      </div>

      <nav className="flex-1 py-4 px-2 space-y-1">
        {menuItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link key={item.href} href={item.href} className={cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200',
              isActive ? 'bg-indigo-50 text-indigo-700' : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50',
            )}>
              <item.icon className={cn('w-5 h-5 shrink-0', isActive && 'text-indigo-500')} />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      <div className="p-2 border-t border-gray-100">
        <Link href="/settings" className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-gray-500 hover:text-gray-800 hover:bg-gray-50 transition-all">
          <Settings className="w-5 h-5 shrink-0" />
          {!collapsed && <span>设置</span>}
        </Link>
        <button onClick={() => setCollapsed(!collapsed)} className="w-full flex items-center justify-center py-2 mt-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-all">
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>
    </aside>
  );
}
