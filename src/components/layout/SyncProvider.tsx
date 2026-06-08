'use client';
import { useEffect, useRef } from 'react';
import { startSync, syncPush, syncDelete } from '@/lib/sync';
import { stripContactMeta } from '@/lib/jd-parse-core';
import { useJDStore } from '@/store/jd-store';
import { useInterviewStore } from '@/store/interview-store';
import { useTalentStore } from '@/store/talent-store';
import { useRepushStore, type RepushItem } from '@/store/repush-store';
import { useTodoStore } from '@/store/todo-store';
import type { JD } from '@/types/jd';
import type { Candidate } from '@/types/interview';
import type { Talent } from '@/types/talent';
import type { TodoItem } from '@/types/todo';

// Check if JDs are mock data (all IDs start with "jd-00")
function isMockData(jds: JD[]): boolean {
  if (jds.length === 0) return false;
  return jds.every((j) => j.id.startsWith('jd-00'));
}

/** 取数组里所有 id */
function idsOf(arr: Array<{ id?: string }>): string[] {
  return arr.map((x) => x.id).filter((x): x is string => !!x);
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
  const skipPush = useRef(true);

  // 各类型「上一次 id 集合」，用于检测本地删除并写墓碑（删除才能跨端传播）
  const prevJds = useRef<string[]>([]);
  const prevCandidates = useRef<string[]>([]);
  const prevTalents = useRef<string[]>([]);
  const prevRepush = useRef<string[]>([]);
  const prevTodos = useRef<string[]>([]);

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
        // Only apply remote if it's not empty mock
        const typedJds = normalized as unknown as JD[];
        if (!isMockData(typedJds)) {
          useJDStore.setState({ jds: typedJds });
        }
      }
      if (type === 'candidates') useInterviewStore.setState({ candidates: data as Candidate[] });
      if (type === 'talents') useTalentStore.setState({ talents: data as Talent[] });
      if (type === 'repush') useRepushStore.setState({ items: data as RepushItem[] });
      if (type === 'todos') useTodoStore.setState({ todos: data as TodoItem[] });
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

  return <>{children}</>;
}
