'use client';
import { useEffect, useRef } from 'react';
import { startSync, syncPush } from '@/lib/sync';
import { stripContactMeta } from '@/lib/jd-parse-core';
import { useJDStore } from '@/store/jd-store';
import { useInterviewStore } from '@/store/interview-store';
import { useTalentStore } from '@/store/talent-store';
import type { JD } from '@/types/jd';
import type { Candidate } from '@/types/interview';
import type { Talent } from '@/types/talent';

// Check if JDs are mock data (all IDs start with "jd-00")
function isMockData(jds: JD[]): boolean {
  if (jds.length === 0) return false;
  return jds.every((j) => j.id.startsWith('jd-00'));
}

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const jds = useJDStore((s) => s.jds);
  const candidates = useInterviewStore((s) => s.candidates);
  const talents = useTalentStore((s) => s.talents);
  const skipPush = useRef(true);
  const remoteReceived = useRef(false);

  useEffect(() => {
    startSync((type, data) => {
      skipPush.current = true;
      remoteReceived.current = true;
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
      setTimeout(() => { skipPush.current = false; }, 1000);
    });
  }, []);

  // Push local changes — but NEVER push mock data
  useEffect(() => {
    if (skipPush.current) return;
    if (isMockData(jds)) return; // never push mock data to KV
    syncPush('jds', jds);
  }, [jds]);

  useEffect(() => {
    if (skipPush.current) return;
    syncPush('candidates', candidates);
  }, [candidates]);

  useEffect(() => {
    if (skipPush.current) return;
    syncPush('talents', talents);
  }, [talents]);

  return <>{children}</>;
}