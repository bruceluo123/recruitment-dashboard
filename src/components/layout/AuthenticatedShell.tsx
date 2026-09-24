'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { InterviewReminder } from '@/components/layout/InterviewReminder';
import { SyncProvider } from '@/components/layout/SyncProvider';
import { useInterviewStore } from '@/store/interview-store';
import { usePrefStore } from '@/store/pref-store';
import { useRepushStore, type RepushColumnId } from '@/store/repush-store';
import { useTodoStore } from '@/store/todo-store';

export function AuthenticatedShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (pathname === '/login' || ready) return;
    let active = true;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const validateSession = async (attempt = 0) => {
      try {
        const response = await fetch('/api/auth/session', { cache: 'no-store' });
        if (response.status === 401 || response.status === 403) {
          if (active) window.location.assign(`/login?next=${encodeURIComponent(pathname || '/')}`);
          return;
        }
        if (!response.ok) throw new Error(`session check failed (${response.status})`);
        const data = await response.json().catch(() => ({})) as {
          user?: { owners?: RepushColumnId[] };
        };
        if (!Array.isArray(data.user?.owners) || data.user.owners.length === 0) throw new Error('session unavailable');
        if (!active) return;
        const owners = new Set(data.user.owners);
        useInterviewStore.setState((state) => ({
          candidates: state.candidates.filter((candidate) => owners.has(candidate.owner || 'a')),
        }));
        useRepushStore.setState((state) => ({
          items: state.items.filter((item) => owners.has(item.column)),
        }));
        useTodoStore.setState((state) => ({
          todos: state.todos.filter((todo) => todo.owner === 'both' || owners.has(todo.owner)),
        }));
        if (!owners.has(usePrefStore.getState().activeOwner)) {
          usePrefStore.getState().setActiveOwner(data.user.owners[0]);
        }
        setReady(true);
      } catch {
        if (!active) return;
        if (attempt < 2) {
          retryTimer = setTimeout(() => { void validateSession(attempt + 1); }, 700 * (attempt + 1));
          return;
        }
        // 当前页面请求已经通过服务端中间件鉴权。短暂断网或接口抖动时保留页面，
        // 后续所有数据接口仍各自校验 Cookie，不能把网络错误误判为退出登录。
        setReady(true);
      }
    };

    void validateSession();
    return () => {
      active = false;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [pathname, ready]);

  if (pathname === '/login') return children;
  if (!ready) {
    return <div className="flex min-h-screen items-center justify-center bg-[#f4f7fb] text-sm text-slate-500">正在验证访问权限…</div>;
  }
  return (
    <SyncProvider>
      <AppShell>{children}</AppShell>
      <InterviewReminder />
    </SyncProvider>
  );
}
