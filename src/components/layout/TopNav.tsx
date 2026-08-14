'use client';
import { useState } from 'react';
import { Bell, Search, Menu } from 'lucide-react';
import { useUIStore } from '@/store/ui-store';
import { TalentQueryDialog } from '@/components/talent-pool/TalentQueryDialog';

export function TopNav() {
  const openNav = useUIStore((s) => s.openNav);
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <>
      <header className="sticky top-0 z-20 h-16 border-b border-slate-200/80 bg-white/90 backdrop-blur-xl flex items-center justify-between px-4 sm:px-6 lg:px-7">
        <div className="flex items-center gap-3">
          <button onClick={openNav} className="lg:hidden p-2 -ml-1 rounded-lg text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-all" aria-label="打开菜单">
            <Menu className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-base font-bold text-slate-900">企鹅岛</h1>
            <p className="text-xs text-slate-500 hidden sm:block">猎头岗位匹配系统</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button type="button" data-search-trigger="talent-global" onClick={() => setSearchOpen(true)} className="group hidden md:block text-left">
            <span className="flex w-72 h-10 items-center gap-2.5 rounded-lg border border-blue-200 bg-blue-50/80 px-3 text-sm shadow-sm shadow-blue-100/70 transition-all group-hover:border-blue-400 group-hover:bg-white group-hover:shadow-blue-100">
              <Search className="w-4 h-4 shrink-0 text-blue-600" />
              <span className="font-semibold text-slate-800">人才全局搜索</span>
              <span className="ml-auto text-xs text-blue-500">姓名 · 技能 · 岗位</span>
            </span>
          </button>
          <button className="relative p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-all">
            <Bell className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2 pl-2 border-l border-gray-200">
            <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-xs font-semibold text-white shadow-sm shadow-blue-200">
              HR
            </div>
            <span className="text-sm text-gray-600 hidden sm:block">招聘官</span>
          </div>
        </div>
      </header>
      <TalentQueryDialog isOpen={searchOpen} onClose={() => setSearchOpen(false)} initialQuery="" />
    </>
  );
}
