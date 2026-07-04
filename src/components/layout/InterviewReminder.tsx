'use client';
import { useEffect, useRef, useState } from 'react';
import { useInterviewStore } from '@/store/interview-store';
import { Bell, X } from 'lucide-react';

// 全局面试提醒：挂在根布局，任意页面都生效（不再只在面试日历页）。
// 提前量 15 分钟；除页内 toast 外，还发浏览器系统通知——切走标签页/最小化也能收到。
const LEAD_MIN = 15;
const POLL_MS = 30_000;

interface Reminder { id: string; name: string; time: string; diffMin: number; }

export function InterviewReminder() {
  const candidates = useInterviewStore((s) => s.candidates);
  const reminded = useRef<Set<string>>(new Set());
  const [toast, setToast] = useState<Reminder | null>(null);

  // 尽力请求一次通知权限（浏览器要求在用户手势后才会真正弹窗，这里不强求）
  useEffect(() => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  useEffect(() => {
    const check = () => {
      const now = Date.now();
      for (const c of candidates) {
        // 已出结果(入职/淘汰等)的候选人不再提醒
        if (!c.interviewDate || c.outcome || reminded.current.has(c.id)) continue;
        const diffMin = Math.floor((new Date(c.interviewDate).getTime() - now) / 60000);
        if (diffMin >= 0 && diffMin <= LEAD_MIN) {
          reminded.current.add(c.id);
          const body = diffMin <= 0 ? `${c.name} 的面试即将开始` : `${c.name} 的面试将在约 ${diffMin} 分钟后开始`;
          if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            try { new Notification('面试提醒', { body, tag: c.id }); } catch { /* 通知失败不影响页内 toast */ }
          }
          setToast({ id: c.id, name: c.name, time: c.interviewDate, diffMin });
        }
      }
    };
    check();
    const t = setInterval(check, POLL_MS);
    return () => clearInterval(t);
  }, [candidates]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 12000);
    return () => clearTimeout(t);
  }, [toast]);

  if (!toast) return null;
  return (
    <div className="fixed top-20 right-6 z-[100] animate-slide-in-right">
      <div className="bg-amber-50 border border-amber-200 rounded-2xl shadow-xl p-4 max-w-sm">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center shrink-0"><Bell className="w-5 h-5 text-amber-600" /></div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-800">面试提醒</p>
            <p className="text-sm text-amber-700 mt-1"><span className="font-medium">{toast.name}</span> 的面试即将开始</p>
            <p className="text-xs text-amber-500 mt-0.5">{new Date(toast.time).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
          </div>
          <button onClick={() => setToast(null)} className="p-1 rounded-lg hover:bg-amber-100 text-amber-400"><X className="w-4 h-4" /></button>
        </div>
      </div>
    </div>
  );
}
