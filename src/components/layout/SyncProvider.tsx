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
      if (type === 'jds') useJDStore.setState({ jds: data as JD[] });
      if (type === 'candidates') useInterviewStore.setState({ candidates: data as Candidate[] });
      setTimeout(() => { skipPush.current = false; }, 2000);
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
