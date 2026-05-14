'use client';
import { useEffect } from 'react';
import { startSync, syncPush } from '@/lib/sync';
import { useJDStore } from '@/store/jd-store';
import { useInterviewStore } from '@/store/interview-store';
import type { JD } from '@/types/jd';
import type { Candidate } from '@/types/interview';

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const jds = useJDStore((s) => s.jds);
  const candidates = useInterviewStore((s) => s.candidates);

  useEffect(() => {
    startSync((type, data) => {
      if (type === 'jds') {
        useJDStore.setState({ jds: data as JD[] });
      } else if (type === 'candidates') {
        useInterviewStore.setState({ candidates: data as Candidate[] });
      }
    });
  }, []);

  useEffect(() => { syncPush('jds', jds); }, [jds]);
  useEffect(() => { syncPush('candidates', candidates); }, [candidates]);

  return <>{children}</>;
}
