'use client';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Check, Copy, FileText, Loader2, Pause, Search, Sparkles, X } from 'lucide-react';
import { useTalentStore } from '@/store/talent-store';
import { searchTalentsByQuery } from '@/lib/talent-match';
import type { TalentMatchResult } from '@/types/talent-match';
import { useEscapeClose } from '@/hooks/useEscapeClose';

interface TalentQueryDialogProps {
  isOpen: boolean;
  onClose: () => void;
  initialQuery?: string;
  autoRun?: boolean;
}

const EXAMPLES = [
  'AI + Go',
  'AI 架构 + Agent 落地',
  'Go 后端 + 大模型接入',
  'OpenAI / Claude + 工程化',
];

function scoreColor(score: number): string {
  if (score >= 85) return 'text-green-600 bg-green-50 ring-green-200';
  if (score >= 70) return 'text-indigo-600 bg-indigo-50 ring-indigo-200';
  if (score >= 55) return 'text-amber-600 bg-amber-50 ring-amber-200';
  return 'text-gray-500 bg-gray-50 ring-gray-200';
}

export function TalentQueryDialog({ isOpen, onClose, initialQuery, autoRun = false }: TalentQueryDialogProps) {
  const talents = useTalentStore((s) => s.talents);
  const [query, setQuery] = useState('AI + Go');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState<TalentMatchResult[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastAutoRunRef = useRef('');
  useEscapeClose(onClose, isOpen && !loading);

  const activeTalents = useMemo(() => talents.filter((t) => !t.archived), [talents]);
  const scannedCount = activeTalents.filter((t) => t.hasResumeText).length;

  const runSearch = useCallback(async (overrideQuery?: string) => {
    const q = (overrideQuery ?? query).trim();
    if (!q) {
      setError('请输入要找的人才画像');
      return;
    }
    if (!activeTalents.length) {
      setError('人才库为空，请先导入候选人');
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError('');
    setResults([]);
    try {
      const matched = await searchTalentsByQuery(q, activeTalents, controller.signal);
      setResults(matched);
      if (!matched.length) setError('暂时没有找到匹配的人才');
    } catch (err) {
      if ((err as Error).name === 'AbortError') setError('已暂停搜索');
      else setError(`搜索失败：${(err as Error).message}`);
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }, [activeTalents, query]);

  useEffect(() => {
    if (!isOpen) {
      lastAutoRunRef.current = '';
      return;
    }
    if (!isOpen || !initialQuery) return;
    setQuery(initialQuery);
    setError('');
    setResults([]);
    if (autoRun && lastAutoRunRef.current !== initialQuery) {
      lastAutoRunRef.current = initialQuery;
      void runSearch(initialQuery);
    }
  }, [autoRun, initialQuery, isOpen, runSearch]);

  if (!isOpen) return null;

  const handleQueryKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || loading) return;
    event.preventDefault();
    void runSearch();
  };

  const copyContact = async (value: string, id: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedId(id);
      setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1500);
    } catch { /* ignore */ }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/30" />
      <div className="relative w-full max-w-3xl max-h-[88vh] flex flex-col bg-white border border-gray-200 rounded-2xl shadow-xl animate-fade-in">
        <div className="flex items-center justify-between p-6 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-2">
            <Search className="w-5 h-5 text-indigo-500" />
            <h2 className="text-lg font-semibold text-gray-800">人才查询助手</h2>
          </div>
          {!loading && <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>}
        </div>

        <div className="p-6 space-y-4 overflow-y-auto">
          <p className="text-xs text-gray-400">
            从 {activeTalents.length} 位活跃人才中搜索，已扫描简历正文 {scannedCount} 位。按 Enter 搜索，Shift+Enter 换行。
          </p>

          <div className="space-y-2">
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleQueryKeyDown}
              rows={3}
              placeholder="例如：AI + Go；AI 架构 + Agent 落地；Go 后端 + 大模型接入"
              className="w-full px-4 py-3 rounded-xl bg-white border border-gray-200 text-sm focus:outline-none focus:border-indigo-300 resize-none"
            />
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map((item) => (
                <button
                  key={item}
                  onClick={() => setQuery(item)}
                  className="h-8 px-3 rounded-lg border border-gray-200 text-xs text-gray-600 hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-600 transition-all"
                >
                  {item}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="flex items-center gap-2">
              <div className="flex-1 h-10 rounded-xl bg-indigo-500/90 text-white text-sm font-medium flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />正在搜索人才...
              </div>
              <button onClick={() => abortRef.current?.abort()}
                className="h-10 px-4 rounded-xl border border-red-200 text-red-500 text-sm font-medium hover:bg-red-50 transition-all flex items-center gap-2 shrink-0">
                <Pause className="w-4 h-4" />暂停
              </button>
            </div>
          ) : (
            <button onClick={() => runSearch()}
              className="w-full h-10 rounded-xl bg-indigo-500 text-white text-sm font-medium hover:bg-indigo-600 transition-all flex items-center justify-center gap-2">
              <Sparkles className="w-4 h-4" />搜索人才
            </button>
          )}

          {error && <div className="px-4 py-2.5 rounded-xl bg-red-50 border border-red-100 text-sm text-red-600">{error}</div>}

          {results.length > 0 && (
            <div className="space-y-3 pt-1">
              <p className="text-sm font-medium text-gray-600">搜索结果（{results.length} 位，按推荐优先级排序）</p>
              {results.map((r) => (
                <div key={r.id} className="rounded-xl border border-gray-100 p-4 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-800">{r.talent.name || '未知'} <span className="font-normal text-gray-400">· {r.talent.jobTitle || '-'}</span></p>
                      <p className="text-xs text-gray-500 mt-0.5">{r.reasoning}</p>
                    </div>
                    <span className={`shrink-0 px-2.5 py-1 rounded-lg text-sm font-bold ring-1 ring-inset ${scoreColor(r.score)}`}>{r.score}</span>
                  </div>

                  {r.highlights.length > 0 && (
                    <ul className="space-y-0.5">
                      {r.highlights.slice(0, 3).map((h, i) => <li key={i} className="text-xs text-green-700 flex gap-1.5"><Check className="w-3 h-3 mt-0.5 shrink-0" />{h}</li>)}
                    </ul>
                  )}
                  {r.concerns.length > 0 && (
                    <ul className="space-y-0.5">
                      {r.concerns.slice(0, 2).map((c, i) => <li key={i} className="text-xs text-amber-600">! {c}</li>)}
                    </ul>
                  )}

                  <div className="flex flex-wrap items-center gap-3 pt-1">
                    {r.talent.resumeUrl && (
                      <a href={r.talent.resumeUrl} target="_blank" rel="noopener noreferrer" download={r.talent.resumeFileName}
                        className="inline-flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-700 hover:underline">
                        <FileText className="w-3.5 h-3.5" />{r.talent.resumeFileName || '简历'}
                      </a>
                    )}
                    {[
                      ['TG', r.talent.tg],
                      ['电话', r.talent.phone],
                      ['邮箱', r.talent.email],
                    ].map(([label, value]) => value ? (
                      <button key={label} onClick={() => copyContact(value, `${r.id}-${label}`)} className="inline-flex items-center gap-1.5 text-xs text-gray-600 hover:text-indigo-600">
                        {copiedId === `${r.id}-${label}` ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5 text-gray-300" />}{label}: {value}
                      </button>
                    ) : null)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
