'use client';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Check, Copy, FileText, Loader2, Maximize2, Minimize2, Pause, Search, Sparkles, X } from 'lucide-react';
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
  'AI 架构',
  'Go 后端 + 大模型接入',
  'Agent 落地 + 工程化',
];

function scoreColor(score: number): string {
  if (score >= 85) return 'text-green-600 bg-green-50 ring-green-200';
  if (score >= 70) return 'text-indigo-600 bg-indigo-50 ring-indigo-200';
  if (score >= 55) return 'text-amber-600 bg-amber-50 ring-amber-200';
  return 'text-gray-500 bg-gray-50 ring-gray-200';
}

export function TalentQueryDialog({ isOpen, onClose, initialQuery, autoRun = false }: TalentQueryDialogProps) {
  const talents = useTalentStore((s) => s.talents);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState<TalentMatchResult[]>([]);
  const [minimized, setMinimized] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const queryRef = useRef('');
  const abortRef = useRef<AbortController | null>(null);
  const lastAutoRunRef = useRef('');
  useEscapeClose(onClose, isOpen && !loading);

  const activeTalents = useMemo(() => talents.filter((t) => !t.archived), [talents]);
  const scannedCount = activeTalents.filter((t) => t.hasResumeText).length;

  const updateQuery = (value: string) => {
    queryRef.current = value;
    setQuery(value);
  };

  const runSearch = useCallback(async (overrideQuery?: string) => {
    const q = (overrideQuery ?? queryRef.current).trim();
    if (!q) {
      setError('请输入要搜索的人才关键词');
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
  }, [activeTalents]);

  useEffect(() => {
    if (!isOpen) {
      lastAutoRunRef.current = '';
      setMinimized(false);
      abortRef.current?.abort();
      return;
    }
    const nextQuery = initialQuery || '';
    queryRef.current = nextQuery;
    setQuery(nextQuery);
    setError('');
    setResults([]);
    window.setTimeout(() => inputRef.current?.focus(), 0);
    if (autoRun && nextQuery && lastAutoRunRef.current !== nextQuery) {
      lastAutoRunRef.current = nextQuery;
      void runSearch(nextQuery);
    }
  }, [autoRun, initialQuery, isOpen, runSearch]);

  if (!isOpen) return null;

  if (minimized) {
    const statusText = loading
      ? '正在搜索人才...'
      : results.length > 0
        ? `找到 ${results.length} 位人选`
        : error || '搜索已暂停';

    return (
      <div data-search-state="minimized" className="fixed right-4 bottom-4 z-50 w-[min(360px,calc(100vw-2rem))] rounded-2xl border border-gray-200 bg-white shadow-xl animate-fade-in">
        <div className="p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                {loading ? <Loader2 className="w-4 h-4 text-indigo-500 animate-spin" /> : <Search className="w-4 h-4 text-indigo-500" />}
                <p className="text-sm font-semibold text-gray-800">人才全局搜索</p>
              </div>
              <p className="mt-1 text-xs text-gray-500 truncate">{query || '未输入关键词'}</p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {loading && (
                <button type="button" onClick={() => abortRef.current?.abort()} className="p-1.5 rounded-lg text-red-500 hover:bg-red-50" title="暂停搜索">
                  <Pause className="w-4 h-4" />
                </button>
              )}
              <button type="button" data-search-action="expand" onClick={() => setMinimized(false)} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-indigo-500" title="展开搜索">
                <Maximize2 className="w-4 h-4" />
              </button>
              {!loading && (
                <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600" title="关闭">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
          <div className="h-9 rounded-xl bg-gray-50 px-3 text-sm text-gray-600 flex items-center justify-between gap-3">
            <span className="truncate">{statusText}</span>
            <button type="button" data-search-action="expand" onClick={() => setMinimized(false)} className="text-xs font-medium text-indigo-600 hover:text-indigo-700 shrink-0">查看</button>
          </div>
        </div>
      </div>
    );
  }

  const handleQueryKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || loading) return;
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
    <div data-search-state="open" className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[10vh]">
      <button type="button" aria-label="关闭人才搜索" onClick={() => { if (!loading) onClose(); }} className="fixed inset-0 bg-black/30" />
      <div className="relative w-full max-w-4xl max-h-[82vh] flex flex-col bg-white border border-gray-200 rounded-2xl shadow-xl animate-fade-in overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-2">
            <Search className="w-5 h-5 text-indigo-500" />
            <h2 className="text-lg font-semibold text-gray-800">人才全局搜索</h2>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" data-search-action="minimize" onClick={() => setMinimized(true)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-indigo-500" title="收起到一边">
              <Minimize2 className="w-5 h-5" />
            </button>
            {!loading && <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>}
          </div>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          <p className="text-xs text-gray-400">
            从 {activeTalents.length} 位活跃人才中搜索，已扫描简历正文 {scannedCount} 位。输入关键词后按 Enter 搜索。
          </p>

          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                ref={inputRef}
              value={query}
                onChange={(e) => updateQuery(e.target.value)}
              onKeyDown={handleQueryKeyDown}
                placeholder="输入 AI 架构、Go、Agent、OpenAI..."
                className="w-full h-14 pl-12 pr-28 rounded-2xl bg-white border border-gray-200 text-base focus:outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-50 transition-all"
              />
              {loading ? (
                <button onClick={() => abortRef.current?.abort()}
                  className="absolute right-2 top-2 h-10 px-3 rounded-xl border border-red-200 text-red-500 text-sm font-medium hover:bg-red-50 transition-all flex items-center gap-2">
                  <Pause className="w-4 h-4" />暂停
                </button>
              ) : (
                <button onClick={() => runSearch()}
                  className="absolute right-2 top-2 h-10 px-4 rounded-xl bg-indigo-500 text-white text-sm font-medium hover:bg-indigo-600 transition-all flex items-center gap-2">
                  <Sparkles className="w-4 h-4" />搜索
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map((item) => (
                <button
                  key={item}
                  onClick={() => { updateQuery(item); void runSearch(item); }}
                  className="h-8 px-3 rounded-lg border border-gray-200 text-xs text-gray-600 hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-600 transition-all"
                >
                  {item}
                </button>
              ))}
            </div>
          </div>

          {loading && (
            <div className="h-10 rounded-xl bg-indigo-50 text-indigo-600 text-sm font-medium flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />正在搜索人才...
            </div>
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
