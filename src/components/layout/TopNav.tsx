'use client';
import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { Bell, Search, Menu, LogOut, ChevronRight } from 'lucide-react';
import { useUIStore } from '@/store/ui-store';
import { TalentQueryDialog } from '@/components/talent-pool/TalentQueryDialog';
import { requestSyncTypes } from '@/lib/sync';

const pageNames: Record<string, string> = {
  '/': '推荐中心',
  '/repush-pool': '反馈中心',
  '/jd-library': 'JD 库',
  '/resume-matching': '简历匹配',
  '/interview-calendar': '面试 / Offer',
  '/hot-hiring': '热招看板',
  '/talent-pool': '人才库',
  '/companies': '公司库',
  '/todos': '待办事项',
  '/settings': '设置',
};

export function TopNav() {
  const pathname = usePathname();
  const openNav = useUIStore((s) => s.openNav);
  const [searchOpen, setSearchOpen] = useState(false);

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.assign('/login');
  }

  return (
    <>
      <header className="sticky top-0 z-20 flex h-[72px] items-center justify-between border-b border-[#e4eaf3] bg-white/90 px-4 backdrop-blur-xl sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <button onClick={openNav} className="-ml-1 rounded-xl p-2 text-gray-500 transition-colors hover:bg-slate-100 hover:text-gray-800 lg:hidden" aria-label="打开菜单">
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2 text-sm">
            <span className="hidden font-medium text-slate-400 sm:inline">工作台</span>
            <ChevronRight className="hidden h-3.5 w-3.5 text-slate-300 sm:inline" />
            <h1 className="font-semibold tracking-[-0.02em] text-slate-800">{pageNames[pathname] || '企鹅岛'}</h1>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <button type="button" data-search-trigger="talent-global" onClick={() => { requestSyncTypes(['talents']); setSearchOpen(true); }} className="group hidden md:block text-left">
            <span className="flex h-10 w-64 items-center gap-2.5 rounded-xl border border-[#e3e9f3] bg-[#f7f9fc] px-3 text-sm transition-all group-hover:border-[#a9bff8] group-hover:bg-white group-hover:shadow-[0_4px_16px_rgba(49,89,216,0.08)] lg:w-72">
              <Search className="h-4 w-4 shrink-0 text-slate-400" />
              <span className="font-medium text-slate-600">搜索人才</span>
              <span className="ml-auto hidden text-xs text-slate-400 lg:inline">姓名 · 技能 · 岗位</span>
            </span>
          </button>
          <button type="button" data-search-trigger="talent-global" onClick={() => { requestSyncTypes(['talents']); setSearchOpen(true); }} className="rounded-xl p-2 text-slate-500 transition-colors hover:bg-slate-100 md:hidden" aria-label="搜索人才">
            <Search className="h-5 w-5" />
          </button>
          <button className="relative rounded-xl p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600" aria-label="通知">
            <Bell className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2 border-l border-slate-200 pl-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#eaf0ff] text-xs font-bold text-[#3159d8] ring-1 ring-inset ring-[#dbe6ff]">
              HR
            </div>
            <span className="hidden text-sm font-medium text-slate-700 sm:block">招聘官</span>
          </div>
          <button type="button" onClick={() => void logout()} className="rounded-xl p-2 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600" aria-label="退出登录" title="退出登录">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>
      <TalentQueryDialog isOpen={searchOpen} onClose={() => setSearchOpen(false)} initialQuery="" />
    </>
  );
}
