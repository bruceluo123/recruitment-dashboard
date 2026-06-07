'use client';
import { Bell, Search, Menu } from 'lucide-react';
import { useUIStore } from '@/store/ui-store';

export function TopNav() {
  const openNav = useUIStore((s) => s.openNav);
  return (
    <header className="sticky top-0 z-20 h-16 border-b border-gray-200 bg-white/80 backdrop-blur-xl flex items-center justify-between px-4 sm:px-6">
      <div className="flex items-center gap-3">
        <button onClick={openNav} className="lg:hidden p-2 -ml-1 rounded-lg text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-all" aria-label="打开菜单">
          <Menu className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-lg font-semibold text-gray-800">企鹅岛</h1>
          <p className="text-xs text-gray-500 hidden sm:block">猎头岗位匹配系统</p>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <div className="relative hidden md:block">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="快速搜索..." className="w-64 h-9 pl-9 pr-3 rounded-lg bg-gray-50 border border-gray-200 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:border-indigo-300 focus:bg-white transition-all" />
        </div>
        <button className="relative p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-all">
          <Bell className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2 pl-2 border-l border-gray-200">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-cyan-500 flex items-center justify-center text-xs font-medium text-white">
            HR
          </div>
          <span className="text-sm text-gray-600 hidden sm:block">招聘官</span>
        </div>
      </div>
    </header>
  );
}
