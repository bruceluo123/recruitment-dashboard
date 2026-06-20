'use client';
import { useEffect, useRef, useState } from 'react';
import { Sparkles, X, Loader2, Search } from 'lucide-react';
import { researchCompany } from '@/lib/company-research';
import { useCompanyStore } from '@/store/company-store';

interface CompanyResearchDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** 调研完成后回调，传入新建/更新公司的 id，便于直接打开详情 */
  onDone: (companyId: string) => void;
}

export function CompanyResearchDialog({ isOpen, onClose, onDone }: CompanyResearchDialogProps) {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const upsertCompanyByName = useCompanyStore((s) => s.upsertCompanyByName);

  useEffect(() => {
    if (!isOpen) {
      setName('');
      setError(null);
      setLoading(false);
      abortRef.current?.abort();
      abortRef.current = null;
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleResearch = async () => {
    const trimmed = name.trim();
    if (!trimmed || loading) return;
    setError(null);
    setLoading(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const draft = await researchCompany(trimmed, ctrl.signal);
      const id = upsertCompanyByName(draft);
      onDone(id);
      onClose();
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setError((err as Error).message || '调研失败，请重试');
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={loading ? undefined : onClose} />
      <div className="relative w-full max-w-md rounded-2xl bg-white shadow-xl border border-gray-100 animate-fade-in">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-cyan-500 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <h3 className="text-base font-semibold text-gray-800">调研公司</h3>
          </div>
          <button onClick={onClose} disabled={loading} className="text-gray-400 hover:text-gray-600 disabled:opacity-40 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-5 space-y-4">
          <p className="text-sm text-gray-500 leading-relaxed">
            输入公司名，AI 按 11 维度方法论自动调研，完成后直接加入公司库。
          </p>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleResearch(); }}
              disabled={loading}
              placeholder="例如：智谱 AI、月之暗面…"
              className="w-full h-11 pl-9 pr-3 rounded-xl bg-gray-50 border border-gray-200 text-sm focus:outline-none focus:border-indigo-300 focus:bg-white disabled:opacity-60 transition-all"
            />
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 border border-red-100 px-3 py-2 text-xs text-red-600">{error}</div>
          )}

          <button
            onClick={handleResearch}
            disabled={loading || !name.trim()}
            className="w-full h-11 rounded-xl bg-gradient-to-r from-indigo-500 to-cyan-500 text-white text-sm font-medium hover:opacity-90 disabled:opacity-40 transition-all flex items-center justify-center gap-2"
          >
            {loading ? (<><Loader2 className="w-4 h-4 animate-spin" />调研中，请稍候…</>) : (<><Sparkles className="w-4 h-4" />开始调研</>)}
          </button>
          {loading && (
            <p className="text-xs text-gray-400 text-center">AI 正在按 11 维度整理，约需 20-40 秒</p>
          )}
        </div>
      </div>
    </div>
  );
}
