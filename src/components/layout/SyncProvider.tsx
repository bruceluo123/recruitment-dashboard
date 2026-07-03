'use client';
import { useEffect, useRef } from 'react';
import { startSync, syncPush, syncDelete, fetchImportDiff, fetchWeeklyAdded, pushWeeklyAdded } from '@/lib/sync';
import { stripContactMeta } from '@/lib/jd-parse-core';
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

// Check if JDs are mock data (all IDs start with "jd-00")
function isMockData(jds: JD[]): boolean {
  if (jds.length === 0) return false;
  return jds.every((j) => j.id.startsWith('jd-00'));
}

/** 取数组里所有 id */
function idsOf(arr: Array<{ id?: string }>): string[] {
  return arr.map((x) => x.id).filter((x): x is string => !!x);
}

// 空数据保护：区分「读取故障返回空」与「合法的清空到 0」。
// - 非空数据：始终应用。
// - 空数据：仅当该键的远端读取确实成功(readOk)才应用（合法清空）；
//   读取失败(readOk=false)时跳过，避免单键故障用空覆盖本地非空（"推荐数据变 0"根因）。
// 这样合法的整组清空（如清空全部 todos）能跨端传播，同时保留对读取故障的防护。
function shouldApply(incoming: unknown[], currentLen: number, readOk: boolean): boolean {
  if (incoming.length > 0) return true;
  if (currentLen === 0) return true;
  return readOk;
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
    startSync((type, data, _version, readOk) => {
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
        if (!isMockData(typedJds) && shouldApply(typedJds, useJDStore.getState().jds.length, readOk)) {
          useJDStore.setState({ jds: typedJds });
        }
      }
      if (type === 'candidates') {
        const d = data as Candidate[];
        if (shouldApply(d, useInterviewStore.getState().candidates.length, readOk)) useInterviewStore.setState({ candidates: d });
      }
      if (type === 'talents') {
        const d = data as Talent[];
        if (shouldApply(d, useTalentStore.getState().talents.length, readOk)) useTalentStore.setState({ talents: d });
      }
      if (type === 'repush') {
        const d = data as RepushItem[];
        if (shouldApply(d, useRepushStore.getState().items.length, readOk)) useRepushStore.setState({ items: d });
      }
      if (type === 'todos') {
        const d = data as TodoItem[];
        if (shouldApply(d, useTodoStore.getState().todos.length, readOk)) useTodoStore.setState({ todos: d });
      }
      if (type === 'companies') {
        const d = data as Company[];
        if (shouldApply(d, useCompanyStore.getState().companies.length, readOk)) useCompanyStore.setState({ companies: d });
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
    if (isMockData(jds)) return; // never push mock data to KV
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
          const diffDate = new Date(rd.date);
          const day = diffDate.getDay();
          const mon = new Date(diffDate);
          mon.setDate(diffDate.getDate() + (day === 0 ? -6 : 1 - day));
          const weekKey = `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, '0')}-${String(mon.getDate()).padStart(2, '0')}`;
          const localWeekly = useJDStore.getState().weeklyAdded;
          if (!localWeekly?.items?.length) {
            const newWeekly: WeeklyAdded = { weekKey, items: rd.added!, lastUpdated: rd.date };
            useJDStore.setState({ weeklyAdded: newWeekly });
            pushWeeklyAdded(newWeekly).catch(() => {});
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
