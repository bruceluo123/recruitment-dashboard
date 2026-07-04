'use client';
import { useEffect, useRef } from 'react';
import { startSync, syncPush, syncDelete, fetchImportDiff, fetchWeeklyAdded, pushWeeklyAdded } from '@/lib/sync';
import { stripContactMeta } from '@/lib/jd-parse-core';
import { isMockJds } from '@/lib/mock-guard';
import { mondayKey } from '@/lib/utils';
import { useJDStore } from '@/store/jd-store';
import { useInterviewStore } from '@/store/interview-store';
import { useTalentStore } from '@/store/talent-store';
import { useRepushStore, type RepushItem } from '@/store/repush-store';
import { useTodoStore } from '@/store/todo-store';
import { useCompanyStore } from '@/store/company-store';
import type { JD, JDImportResult, JDDiffItem, WeeklyAdded } from '@/types/jd';
import type { Candidate } from '@/types/interview';
import type { Talent } from '@/types/talent';
import type { TodoItem } from '@/types/todo';
import type { Company } from '@/types/company';

/** 取数组里所有 id */
function idsOf(arr: Array<{ id?: string }>): string[] {
  return arr.map((x) => x.id).filter((x): x is string => !!x);
}

// 空数据保护（数据安全优先）：绝不用空数组覆盖本地非空数据。
// 之前尝试用「readOk」放行合法清空，但 Upstash 对「暂时缺失的键」也返回 HTTP 200+空，
// 导致空数据被当成合法清空下发、把 JD 库整个清空并回灌 KV（2026-07-04 线上事故）。
// 结论：跨端「整组清空」是极边缘场景，不值得冒数据丢失风险。
// 真正的删除走墓碑按 id 传播，不依赖整组清空，因此此保护不影响删除生效。
function shouldApply(incoming: unknown[], currentLen: number): boolean {
  return !(incoming.length === 0 && currentLen > 0);
}

/** prev 有、next 没有的 id（即本地刚删除的项） */
function removedIds(prev: string[], next: string[]): string[] {
  const nextSet = new Set(next);
  return prev.filter((id) => !nextSet.has(id));
}

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const jds = useJDStore((s) => s.jds);
  const candidates = useInterviewStore((s) => s.candidates);
  const talents = useTalentStore((s) => s.talents);
  const repushItems = useRepushStore((s) => s.items);
  const todos = useTodoStore((s) => s.todos);
  const companies = useCompanyStore((s) => s.companies);
  const skipPush = useRef(true);

  // 各类型「上一次 id 集合」，用于检测本地删除并写墓碑（删除才能跨端传播）
  const prevJds = useRef<string[]>([]);
  const prevCandidates = useRef<string[]>([]);
  const prevTalents = useRef<string[]>([]);
  const prevRepush = useRef<string[]>([]);
  const prevTodos = useRef<string[]>([]);
  const prevCompanies = useRef<string[]>([]);

  useEffect(() => {
    startSync((type, data) => {
      skipPush.current = true;
      if (type === 'jds') {
        const normalized = (data as Array<Record<string, unknown>>).map((jd: Record<string, unknown>) => {
          const f = { ...jd } as Record<string, unknown>;
          if (f.category && !f.categories) {
            const map: Record<string, string> = { 'product-design': 'design' };
            f.categories = [map[f.category as string] || f.category];
            delete f.category;
          }
          if (!f.categories || !(f.categories as unknown[]).length) f.categories = ['operations'];
          if (!f.status) f.status = 'active';
          // 清理混入职责/要求尾部的联系人/来源/部门元数据（KV 数据不经过 persist 迁移）
          if (Array.isArray(f.responsibilities)) f.responsibilities = stripContactMeta((f.responsibilities as unknown[]).map(String));
          if (Array.isArray(f.requirements)) f.requirements = stripContactMeta((f.requirements as unknown[]).map(String));
          return f;
        });
        // Only apply remote if it's not empty mock，且不会用空覆盖本地非空
        const typedJds = normalized as unknown as JD[];
        if (!isMockJds(typedJds) && shouldApply(typedJds, useJDStore.getState().jds.length)) {
          useJDStore.setState({ jds: typedJds });
        }
      }
      if (type === 'candidates') {
        const d = data as Candidate[];
        if (shouldApply(d, useInterviewStore.getState().candidates.length)) useInterviewStore.setState({ candidates: d });
      }
      if (type === 'talents') {
        const d = data as Talent[];
        if (shouldApply(d, useTalentStore.getState().talents.length)) useTalentStore.setState({ talents: d });
      }
      if (type === 'repush') {
        const d = data as RepushItem[];
        if (shouldApply(d, useRepushStore.getState().items.length)) useRepushStore.setState({ items: d });
      }
      if (type === 'todos') {
        const d = data as TodoItem[];
        if (shouldApply(d, useTodoStore.getState().todos.length)) useTodoStore.setState({ todos: d });
      }
      if (type === 'companies') {
        const d = data as Company[];
        if (shouldApply(d, useCompanyStore.getState().companies.length)) useCompanyStore.setState({ companies: d });
      }
      setTimeout(() => { skipPush.current = false; }, 1000);
    });
  }, []);

  // Push local changes — but NEVER push mock data
  useEffect(() => {
    const next = idsOf(jds);
    const removed = removedIds(prevJds.current, next);
    prevJds.current = next;
    if (skipPush.current) return;
    if (isMockJds(jds)) return; // never push mock data to KV
    if (removed.length) syncDelete('jds', removed);
    syncPush('jds', jds);
  }, [jds]);

  useEffect(() => {
    const next = idsOf(candidates);
    const removed = removedIds(prevCandidates.current, next);
    prevCandidates.current = next;
    if (skipPush.current) return;
    if (removed.length) syncDelete('candidates', removed);
    syncPush('candidates', candidates);
  }, [candidates]);

  useEffect(() => {
    const next = idsOf(talents);
    const removed = removedIds(prevTalents.current, next);
    prevTalents.current = next;
    if (skipPush.current) return;
    if (removed.length) syncDelete('talents', removed);
    syncPush('talents', talents);
  }, [talents]);

  useEffect(() => {
    const next = idsOf(repushItems);
    const removed = removedIds(prevRepush.current, next);
    prevRepush.current = next;
    if (skipPush.current) return;
    if (removed.length) syncDelete('repush', removed);
    syncPush('repush', repushItems);
  }, [repushItems]);

  useEffect(() => {
    const next = idsOf(todos);
    const removed = removedIds(prevTodos.current, next);
    prevTodos.current = next;
    if (skipPush.current) return;
    if (removed.length) syncDelete('todos', removed);
    syncPush('todos', todos);
  }, [todos]);

  useEffect(() => {
    const next = idsOf(companies);
    const removed = removedIds(prevCompanies.current, next);
    prevCompanies.current = next;
    if (skipPush.current) return;
    if (removed.length) syncDelete('companies', removed);
    syncPush('companies', companies);
  }, [companies]);

  // 轮询今日增改 diff 和本周新增：远端比本地更新时同步过来
  useEffect(() => {
    const checkRemoteState = async () => {
      try {
        const [remoteDiff, remoteWeekly] = await Promise.all([fetchImportDiff(), fetchWeeklyAdded()]);
        // 今日增改
        const rd = remoteDiff as ({ date: string; added?: JDDiffItem[] } & Record<string, unknown>) | null;
        if (rd?.date) {
          const local = useJDStore.getState().lastImportDiff;
          if (new Date(rd.date).getTime() > (local ? new Date(local.date).getTime() : 0)) {
            useJDStore.setState({ lastImportDiff: rd as unknown as (JDImportResult & { date: string }) });
          }
        }
        // 本周新增：优先用远端 weeklyAdded；若 KV 中 weeklyAdded 为空则从 lastImportDiff.added 补充
        const rw = remoteWeekly as WeeklyAdded | null;
        if (rw?.weekKey) {
          const local = useJDStore.getState().weeklyAdded;
          const remoteTs = new Date(rw.lastUpdated).getTime();
          const localTs = local ? new Date(local.lastUpdated).getTime() : 0;
          if (!local || rw.weekKey > local.weekKey || (rw.weekKey === local.weekKey && remoteTs > localTs)) {
            // 同 weekKey 时合并 items（取并集），不同 weekKey 时直接替换
            if (local && rw.weekKey === local.weekKey) {
              const existingKeys = new Set(local.items.map((i) => i.reqKey || i.title));
              const toAdd = rw.items.filter((i) => !existingKeys.has(i.reqKey || i.title));
              if (toAdd.length > 0) {
                useJDStore.setState({ weeklyAdded: { ...rw, items: [...local.items, ...toAdd] } });
              }
            } else {
              useJDStore.setState({ weeklyAdded: rw });
            }
          }
        } else if (rd?.added?.length && rd.date) {
          // KV 中 weeklyAdded 为空：从 lastImportDiff.added 直接补充
          const weekKey = mondayKey(new Date(rd.date));
          const localWeekly = useJDStore.getState().weeklyAdded;
          if (!localWeekly?.items?.length) {
            const newWeekly: WeeklyAdded = { weekKey, items: rd.added!, lastUpdated: rd.date };
            useJDStore.setState({ weeklyAdded: newWeekly });
            pushWeeklyAdded(newWeekly).catch((err) => console.error('pushWeeklyAdded failed', err));
          }
        }
      } catch {}
    };
    checkRemoteState();
    const t = setInterval(checkRemoteState, 10000);
    return () => clearInterval(t);
  }, []);

  return <>{children}</>;
}
