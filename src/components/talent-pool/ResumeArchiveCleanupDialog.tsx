'use client';

import { useEffect, useState } from 'react';
import { FileArchive, HardDrive, Loader2, ShieldCheck, X } from 'lucide-react';
import { useEscapeClose } from '@/hooks/useEscapeClose';

interface CleanupSummary {
  days: number;
  archivedWithResume: number;
  eligibleRecords: number;
  safeRecords: number;
  safeFiles: number;
  protectedRecords: number;
  bytes: number;
  sampleNames: string[];
}

interface ResumeArchiveCleanupDialogProps {
  open: boolean;
  onClose: () => void;
  onCleaned: (ids: string[], cleanedAt: string) => void;
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 MB';
  const mb = bytes / 1024 / 1024;
  if (mb < 1) return `${Math.max(0.1, mb).toFixed(1)} MB`;
  return `${mb.toFixed(1)} MB`;
}

export function ResumeArchiveCleanupDialog({ open, onClose, onCleaned }: ResumeArchiveCleanupDialogProps) {
  const [days, setDays] = useState(30);
  const [summary, setSummary] = useState<CleanupSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [error, setError] = useState('');
  const [completed, setCompleted] = useState('');
  useEscapeClose(onClose, open && !cleaning);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setCompleted('');
    fetch(`/api/talent/archive-cleanup?days=${days}`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok) throw new Error(data.error || '读取清理预览失败');
        setSummary(data as CleanupSummary);
      })
      .catch((fetchError) => {
        if ((fetchError as Error).name !== 'AbortError') setError((fetchError as Error).message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [open, days]);

  if (!open) return null;

  const runCleanup = async () => {
    if (!summary?.safeFiles || cleaning) return;
    setCleaning(true);
    setError('');
    try {
      const response = await fetch('/api/talent/archive-cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days, confirm: true }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || '清理失败');
      onCleaned(Array.isArray(data.cleanedIds) ? data.cleanedIds : [], data.cleanedAt || new Date().toISOString());
      setCompleted(`已清理 ${data.cleanedFiles || 0} 份文件，释放 ${formatBytes(data.bytes || 0)}`);
      setSummary((current) => current ? { ...current, safeRecords: 0, safeFiles: 0, bytes: 0, sampleNames: [] } : current);
    } catch (cleanupError) {
      setError((cleanupError as Error).message || '清理失败');
    } finally {
      setCleaning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 p-4" role="dialog" aria-modal="true" aria-label="旧简历归档清理">
      <div className="w-full max-w-lg overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
              <FileArchive className="h-5 w-5" />
            </span>
            <div>
              <h3 className="text-base font-semibold text-slate-900">旧简历归档清理</h3>
              <p className="mt-1 text-xs text-slate-500">删除过期原始文件，保留人才资料和已识别正文</p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={cleaning} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-40" aria-label="关闭">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 px-5 py-5">
          <div className="flex items-center justify-between gap-4">
            <label htmlFor="resume-retention" className="text-sm font-medium text-slate-700">原始简历保留时间</label>
            <select
              id="resume-retention"
              value={days}
              onChange={(event) => setDays(Number(event.target.value))}
              disabled={cleaning}
              className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-indigo-400"
            >
              <option value={30}>归档满 30 天</option>
              <option value={60}>归档满 60 天</option>
              <option value={90}>归档满 90 天</option>
            </select>
          </div>

          {loading ? (
            <div className="flex h-32 items-center justify-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />正在检查全站引用和文件大小...
            </div>
          ) : summary ? (
            <div className="overflow-hidden rounded-lg border border-slate-200">
              <div className="grid grid-cols-2 divide-x divide-slate-100 bg-slate-50">
                <div className="px-4 py-3">
                  <p className="text-xs text-slate-500">可以安全清理</p>
                  <p className="mt-1 text-xl font-semibold text-slate-900">{summary.safeFiles} <span className="text-sm font-normal text-slate-500">份</span></p>
                </div>
                <div className="px-4 py-3">
                  <p className="text-xs text-slate-500">预计释放空间</p>
                  <p className="mt-1 text-xl font-semibold text-emerald-600">{formatBytes(summary.bytes)}</p>
                </div>
              </div>
              <div className="border-t border-slate-100 px-4 py-3 text-xs leading-5 text-slate-500">
                已归档且有文件 {summary.archivedWithResume} 位，达到期限 {summary.eligibleRecords} 位。
                {summary.protectedRecords > 0 && ` 其中 ${summary.protectedRecords} 位仍被推荐或面试记录引用，已自动跳过。`}
              </div>
            </div>
          ) : null}

          {summary?.sampleNames.length ? (
            <div>
              <p className="mb-2 text-xs font-medium text-slate-500">本次涉及</p>
              <p className="text-sm leading-6 text-slate-700">{summary.sampleNames.join('、')}{summary.safeRecords > summary.sampleNames.length ? ` 等 ${summary.safeRecords} 位` : ''}</p>
            </div>
          ) : null}

          <div className="flex items-start gap-2 rounded-lg bg-blue-50 px-3 py-2.5 text-xs leading-5 text-blue-700">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            <span>活跃人才不会清理；推荐中心、面试日历仍在引用的简历也不会清理。原始文件删除后不可恢复。</span>
          </div>

          {completed && <p className="text-sm font-medium text-emerald-600">{completed}</p>}
          {error && <p className="text-sm font-medium text-red-500">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-4">
          <button type="button" onClick={onClose} disabled={cleaning} className="h-9 rounded-lg border border-slate-200 px-4 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40">
            {completed ? '完成' : '取消'}
          </button>
          {!completed && (
            <button
              type="button"
              onClick={runCleanup}
              disabled={loading || cleaning || !summary?.safeFiles}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-slate-800 px-4 text-sm font-medium text-white hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {cleaning ? <Loader2 className="h-4 w-4 animate-spin" /> : <HardDrive className="h-4 w-4" />}
              {cleaning ? '正在清理' : '确认清理文件'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
