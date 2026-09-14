'use client';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { bootstrapSyncedData, startSync, stopSync, syncPush, retrySync, resolveSyncConflicts, subscribeSyncStatus, fetchImportDiff, fetchWeeklyAdded, requestSyncTypes, isApplyingRemoteStoreUpdate, applyRemoteStoreUpdate, type DataType } from '@/lib/sync';
import { isMockJds } from '@/lib/mock-guard';
import { mergeUniqueJDs } from '@/lib/jd-parse-core';
import { useJDStore } from '@/store/jd-store';
import { useInterviewStore } from '@/store/interview-store';
import { useTalentStore } from '@/store/talent-store';
import { useRepushStore } from '@/store/repush-store';
import { useTodoStore } from '@/store/todo-store';
import { useCompanyStore } from '@/store/company-store';
import { usePerformanceStore, type PerformanceKpiRecord } from '@/store/performance-store';
import type { JD, JDImportResult, WeeklyAdded } from '@/types/jd';
import type { Candidate } from '@/types/interview';
import type { Talent } from '@/types/talent';
import type { RepushItem } from '@/store/repush-store';
import type { TodoItem } from '@/types/todo';
import type { Company } from '@/types/company';

function routeTypes(path: string): DataType[] {
  const common: DataType[] = ['candidates', 'repush', 'todos', 'performance'];
  if (path === '/' || path.startsWith('/resume-matching') || path.startsWith('/repush-pool')
    || path.startsWith('/interview-calendar') || path.startsWith('/hot-hiring')) return [...common, 'jds'];
  if (path.startsWith('/jd-library')) return [...common, 'jds', 'companies'];
  if (path.startsWith('/talent-pool')) return [...common, 'talents', 'jds'];
  if (path.startsWith('/companies')) return [...common, 'companies'];
  return common;
}

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = useState('');
  const [conflictCount, setConflictCount] = useState(0);
  const [resolvingConflict, setResolvingConflict] = useState(false);
  const [deliveryMessage, setDeliveryMessage] = useState('');
  const pathname = usePathname();

  useEffect(() => { requestSyncTypes(routeTypes(pathname)); }, [pathname]);

  useEffect(() => {
    let active = true;
    let reading = false;
    let offset = 0;
    const controller = new AbortController();
    const pollDeliveries = async () => {
      if (reading || document.hidden) return;
      const ids = Array.from(new Set(useRepushStore.getState().items
        .filter(row => row.deliveryId && (row.deliveryStatus === 'queued' || row.deliveryStatus === 'sending'))
        .map(row => row.deliveryId!)));
      if (!ids.length) return;
      reading = true;
      const selected = [...ids.slice(offset), ...ids.slice(0, offset)].slice(0, 10);
      offset = (offset + selected.length) % ids.length;
      try {
        const params = new URLSearchParams();
        selected.forEach(id => params.append('ids', id));
        const response = await fetch(`/api/tg/send?${params}`, {
          cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
        });
        if (!response.ok) throw new Error('读取失败');
        const result = await response.json() as { ok?: boolean; results?: Array<{
          ok?: boolean; status?: string; records?: RepushItem[];
        }> };
        if (!active || !result.ok) return;
        const completed = result.results?.filter(row => row.ok) || [];
        applyRemoteStoreUpdate('repush', () => {
          for (const task of completed) for (const record of task.records || []) {
            useRepushStore.getState().upsertDeliveryRecommendation(record);
          }
          return useRepushStore.getState().items;
        });
        const failed = completed.some(row => row.status === 'failed' || row.status === 'partial_failed');
        const pending = useRepushStore.getState().items.some(row => row.deliveryStatus === 'queued' || row.deliveryStatus === 'sending');
        setDeliveryMessage(previous => failed ? '部分 TG 发送未完成，请到推荐中心核对失败记录后重试。'
          : previous.startsWith('部分 TG') ? previous
            : completed.length === 0 ? 'TG 进度暂时无法核对，请到推荐中心查看任务。'
              : pending ? 'TG 正在后台发送，可继续处理其他人选。' : 'TG 后台发送已完成。');
      } catch {
        if (active) setDeliveryMessage('TG 进度暂时无法读取，稍后自动重查，请勿重复新建发送任务。');
      } finally { reading = false; }
    };
    void pollDeliveries();
    const interval = setInterval(() => void pollDeliveries(), 5_000);
    return () => { active = false; controller.abort(); clearInterval(interval); };
  }, []);

  useEffect(() => {
    // Suppress only the synchronous store notification caused by a remote apply.
    // A user edit after that notification is always queued, with no timed blind window.
    const applying = new Set<DataType>();
    const changed = (type: DataType, next: unknown[], previous: unknown[]) => {
      if (next === previous || applying.has(type) || isApplyingRemoteStoreUpdate(type)
        || (type === 'jds' && isMockJds(next as JD[]))) return;
      syncPush(type, next, previous);
    };
    const unsubscribers = [
      subscribeSyncStatus((nextMessage, nextConflictCount) => {
        setMessage(nextMessage);
        setConflictCount(nextConflictCount);
      }),
      useJDStore.subscribe((next, previous) => changed('jds', next.jds, previous.jds)),
      useInterviewStore.subscribe((next, previous) => changed('candidates', next.candidates, previous.candidates)),
      useTalentStore.subscribe((next, previous) => changed('talents', next.talents, previous.talents)),
      useRepushStore.subscribe((next, previous) => changed('repush', next.items, previous.items)),
      useTodoStore.subscribe((next, previous) => changed('todos', next.todos, previous.todos)),
      useCompanyStore.subscribe((next, previous) => changed('companies', next.companies, previous.companies)),
      usePerformanceStore.subscribe((next, previous) => changed('performance', next.records, previous.records)),
    ];
    const handleRemoteChange = (type: DataType, data: unknown[], _version: number, readOk: boolean) => {
      if (!readOk) return;
      applying.add(type);
      try {
        if (type === 'jds' && !isMockJds(data as JD[])) {
          // 云端和本地统一走同一套岗位身份去重，避免某台设备的历史重复缓存再次扩散。
          useJDStore.setState({ jds: mergeUniqueJDs([], data as JD[]).jds });
        }
        if (type === 'candidates') useInterviewStore.setState({ candidates: data as Candidate[] });
        if (type === 'talents') useTalentStore.setState({ talents: data as Talent[] });
        if (type === 'repush') useRepushStore.setState({ items: data as RepushItem[] });
        if (type === 'todos') useTodoStore.setState({ todos: data as TodoItem[] });
        if (type === 'companies') useCompanyStore.setState({ companies: data as Company[] });
        if (type === 'performance') usePerformanceStore.setState({ records: data as PerformanceKpiRecord[] });
      } finally { applying.delete(type); }
    };
    let active = true;
    void bootstrapSyncedData({
      jds: isMockJds(useJDStore.getState().jds) ? [] : useJDStore.getState().jds,
      candidates: useInterviewStore.getState().candidates,
      talents: useTalentStore.getState().talents,
      repush: useRepushStore.getState().items,
      todos: useTodoStore.getState().todos,
      companies: useCompanyStore.getState().companies,
      performance: usePerformanceStore.getState().records,
    }).then((failedTypes) => {
      if (!active) return;
      const safeTypes = routeTypes(window.location.pathname).filter((type) => !failedTypes.includes(type));
      startSync(handleRemoteChange, safeTypes);
      if (failedTypes.length) setMessage('部分本机数据初始化未完成，已保留本机数据，请稍后刷新重试');
    });
    const summaries = async () => {
      if (!routeTypes(window.location.pathname).includes('jds')) return;
      if (document.hidden) return;
      try {
        const [diff, weekly] = await Promise.all([fetchImportDiff(), fetchWeeklyAdded()]);
        if (!active) return;
        if (diff && typeof diff === 'object' && 'date' in diff) useJDStore.setState({ lastImportDiff: diff as JDImportResult & { date: string } });
        if (weekly && typeof weekly === 'object' && 'weekKey' in weekly) useJDStore.setState({ weeklyAdded: weekly as WeeklyAdded });
      } catch { /* Keep the previous summary while the data service is unavailable. */ }
    };
    void summaries();
    const interval = setInterval(() => void summaries(), 120_000);
    return () => { active = false; clearInterval(interval); stopSync(); unsubscribers.forEach((unsubscribe) => unsubscribe()); };
  }, []);
  return <>
    {deliveryMessage && <div role="status" className="flex items-center justify-between gap-3 border-b border-indigo-100 bg-indigo-50 px-4 py-2 text-sm text-indigo-700">
      <span>{deliveryMessage}</span>
      <button type="button" onClick={() => setDeliveryMessage('')} className="shrink-0 underline">知道了</button>
    </div>}
    {message && <div role="status" className="flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
      <span>{message}</span>
      {conflictCount > 0 ? (
        <div className="flex shrink-0 items-center gap-3">
          <button
            type="button"
            className="underline disabled:opacity-50"
            disabled={resolvingConflict}
            onClick={() => {
              setResolvingConflict(true);
              void resolveSyncConflicts('local').finally(() => setResolvingConflict(false));
            }}
          >
            保留本机
          </button>
          <button
            type="button"
            className="underline disabled:opacity-50"
            disabled={resolvingConflict}
            onClick={() => {
              setResolvingConflict(true);
              void resolveSyncConflicts('remote').finally(() => setResolvingConflict(false));
            }}
          >
            采用云端
          </button>
        </div>
      ) : (
        <button type="button" className="shrink-0 underline" onClick={() => void retrySync()}>重试同步</button>
      )}
    </div>}
    {children}
  </>;
}
