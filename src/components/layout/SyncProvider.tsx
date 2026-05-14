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
  const isRemoteUpdate = useRef(false);
  const hasInitialSync = useRef(false);

  useEffect(() => {
    startSync((type, data) => {
      isRemoteUpdate.current = true;
      if (type === 'jds') {
        useJDStore.setState({ jds: data as JD[] });
      } else if (type === 'candidates') {
        useInterviewStore.setState({ candidates: data as Candidate[] });
      }
      if (!hasInitialSync.current && (data as unknown[]).length > 0) {
        hasInitialSync.current = true;
      }
      setTimeout(() => { isRemoteUpdate.current = false; }, 100);
    });
  }, []);

  // Only push LOCAL changes (not remote updates)
  useEffect(() => {
    if (!isRemoteUpdate.current) {
      syncPush('jds', jds);
    }
  }, [jds]);

  useEffect(() => {
    if (!isRemoteUpdate.current) {
      syncPush('candidates', candidates);
    }
  }, [candidates]);

  return <>{children}</>;
}
