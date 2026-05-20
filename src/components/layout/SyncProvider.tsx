'use client';
import { useEffect, useRef } from 'react';
import { startSync, syncPush } from '@/lib/sync';
import { useJDStore } from '@/store/jd-store';
import { useInterviewStore } from '@/store/interview-store';
import type { JD } from '@/types/jd';
import type { Candidate } from '@/types/interview';

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const jds = useJDStore((s) => s.jds);
  const candidates = useInterviewStore((s) => s.candidates);
  const skipPush = useRef(true); // skip initial push on mount

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
          return f;
        });
        useJDStore.setState({ jds: normalized as unknown as JD[] });
      }
      if (type === 'candidates') useInterviewStore.setState({ candidates: data as Candidate[] });
      setTimeout(() => { skipPush.current = false; }, 5000);
    });
  }, []);

  // Push local changes (debounced 1s in sync.ts, skipped for remote updates)
  useEffect(() => {
    if (!skipPush.current) syncPush('jds', jds);
    skipPush.current = false;
  }, [jds]);

  useEffect(() => {
    if (!skipPush.current) syncPush('candidates', candidates);
    skipPush.current = false;
  }, [candidates]);

  return <>{children}</>;
}
