'use client';
import { useMemo, useRef, useState } from 'react';
import { X, Loader2, Sparkles, FileText, Copy, Check, Search, Pause, History, Trash2, RotateCcw } from 'lucide-react';
import { useTalentStore } from '@/store/talent-store';
import { useJDStore } from '@/store/jd-store';
import { useMatchHistoryStore } from '@/store/match-history-store';
import { matchJDToTalents } from '@/lib/talent-match';
import type { JD, JDCategory } from '@/types/jd';
import type { MatchJDInput, TalentMatchResult } from '@/types/talent-match';

interface TalentMatchDialogProps { isOpen: boolean; onClose: () => void; }

type Mode = 'library' | 'paste';

function jdToInput(jd: JD): MatchJDInput {
  return {
    title: jd.title,
    department: jd.department,
    location: jd.location,
    salaryText: jd.salaryText || (jd.salaryRange?.min ? `${jd.salaryRange.min}K-${jd.salaryRange.max}K` : '面议'),
    responsibilities: jd.responsibilities || [],
    requirements: jd.requirements || [],
  };
}

/** 历史记录时间：今天显示「今天 HH:mm」，否则「M月D日 HH:mm」 */
function formatSavedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const now = new Date();
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  return sameDay ? `今天 ${hh}:${mm}` : `${d.getMonth() + 1}月${d.getDate()}日 ${hh}:${mm}`;
}

function scoreColor(score: number): string {
  if (score >= 85) return 'text-green-600 bg-green-50 ring-green-200';
  if (score >= 70) return 'text-indigo-600 bg-indigo-50 ring-indigo-200';
  if (score >= 55) return 'text-amber-600 bg-amber-50 ring-amber-200';
  return 'text-gray-500 bg-gray-50 ring-gray-200';
}

export function TalentMatchDialog({ isOpen, onClose }: TalentMatchDialogProps) {
  const talents = useTalentStore((s) => s.talents);
  const jds = useJDStore((s) => s.jds);
  const history = useMatchHistoryStore((s) => s.history);
  const addRecord = useMatchHistoryStore((s) => s.addRecord);
  const removeRecord = useMatchHistoryStore((s) => s.removeRecord);

  const [mode, setMode] = useState<Mode>('library');
  const [jdSearch, setJdSearch] = useState('');
  const [selectedJdId, setSelectedJdId] = useState<string | null>(null);
  const [pasteTitle, setPasteTitle] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<TalentMatchResult[] | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // 当前展示的结果来自哪条历史记录（复看时显示横幅 + 岗位/时间）；null 表示刚跑出的新结果
  const [viewingTitle, setViewingTitle] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const filteredJds = useMemo(() => {
    const q = jdSearch.trim().toLowerCase();
    const list = q ? jds.filter((j) => `${j.title} ${j.department || ''} ${j.organization || ''}`.toLowerCase().includes(q)) : jds;
    return list.slice(0, 50);
  }, [jds, jdSearch]);

  if (!isOpen) return null;

  const scannedCount = talents.filter((t) => t.hasResumeText).length;

  const handleMatch = async () => {
    setError(null);
    setResults(null);

    let jdInput: MatchJDInput;
    let jdCategories: JDCategory[] = [];
    let jdTitle = '';
    let jdSubtitle = '';
    if (mode === 'library') {
      const jd = jds.find((j) => j.id === selectedJdId);
      if (!jd) { setError('请先选择一个岗位'); return; }
      jdInput = jdToInput(jd);
      jdCategories = jd.categories || [];
      jdTitle = jd.title;
      jdSubtitle = [jd.department, jd.organization].filter(Boolean).join(' · ') || '库内 JD';
    } else {
      if (!pasteText.trim()) { setError('请粘贴 JD 文本'); return; }
      jdTitle = pasteTitle.trim() || '（粘贴岗位）';
      jdSubtitle = '粘贴 JD 文本';
      jdInput = { title: jdTitle, responsibilities: [], requirements: [pasteText.trim()] };
    }

    if (!talents.length) { setError('人才库为空，请先导入候选人'); return; }

    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setViewingTitle(null);
    try {
      const res = await matchJDToTalents(jdInput, jdCategories, talents, controller.signal);
      setResults(res);
      if (!res.length) setError('未找到匹配的候选人');
      else {
        // 存档供复看：保留最近 5 条，退出/刷新后仍可查看，无需重新匹配
        addRecord({
          jdTitle, jdSubtitle, mode,
          talentTotal: talents.length,
          scannedCount,
          results: res,
        });
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') setError('已暂停匹配');
      else setError(`匹配失败: ${(err as Error).message}`);
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  };

  const handlePause = () => abortRef.current?.abort();

  const handleReview = (id: string) => {
    const rec = history.find((r) => r.id === id);
    if (!rec) return;
    setResults(rec.results);
    setViewingTitle(`${rec.jdTitle} · ${formatSavedAt(rec.savedAt)}`);
    setError(null);
  };

  const handleCopyTg = async (tg: string, id: string) => {
    try {
      await navigator.clipboard.writeText(tg);
      setCopiedId(id);
      setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1500);
    } catch { /* clipboard 不可用时忽略 */ }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/30" onClick={loading ? undefined : onClose} />
      <div className="relative w-full max-w-3xl max-h-[88vh] flex flex-col bg-white border border-gray-200 rounded-2xl shadow-xl animate-fade-in">
        <div className="flex items-center justify-between p-6 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-indigo-500" />
            <h2 className="text-lg font-semibold text-gray-800">JD 匹配人选</h2>
          </div>
          {!loading && <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>}
        </div>

        <div className="p-6 space-y-4 overflow-y-auto">
          <p className="text-xs text-gray-400">
            从 {talents.length} 位人选中匹配（已扫描简历正文 {scannedCount} 位）。未扫描的候选人仅凭岗位名称粗判，建议先「扫描识别简历」。
          </p>

          {/* 模式切换 */}
          <div className="inline-flex rounded-xl border border-gray-200 p-0.5 bg-gray-50">
            <button onClick={() => setMode('library')}
              className={`px-4 h-8 rounded-lg text-sm font-medium transition-all ${mode === 'library' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500'}`}>选库内 JD</button>
            <button onClick={() => setMode('paste')}
              className={`px-4 h-8 rounded-lg text-sm font-medium transition-all ${mode === 'paste' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500'}`}>粘贴 JD 文本</button>
          </div>

          {mode === 'library' ? (
            <div className="space-y-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input value={jdSearch} onChange={(e) => setJdSearch(e.target.value)} placeholder="搜索岗位名称 / 部门 / 编制组织..."
                  className="w-full h-10 pl-9 pr-3 rounded-xl bg-white border border-gray-200 text-sm focus:outline-none focus:border-indigo-300" />
              </div>
              <div className="max-h-44 overflow-y-auto rounded-xl border border-gray-100 divide-y divide-gray-50">
                {filteredJds.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-6">无匹配岗位</p>
                ) : filteredJds.map((jd) => (
                  <button key={jd.id} onClick={() => setSelectedJdId(jd.id)}
                    className={`w-full text-left px-4 py-2.5 transition-colors ${selectedJdId === jd.id ? 'bg-indigo-50' : 'hover:bg-gray-50'}`}>
                    <p className="text-sm font-medium text-gray-800 truncate">{jd.title}</p>
                    <p className="text-xs text-gray-400 truncate">{[jd.department, jd.organization].filter(Boolean).join(' · ') || '—'}</p>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <input value={pasteTitle} onChange={(e) => setPasteTitle(e.target.value)} placeholder="岗位名称（可选）"
                className="w-full h-10 px-3 rounded-xl bg-white border border-gray-200 text-sm focus:outline-none focus:border-indigo-300" />
              <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} rows={5} placeholder="粘贴完整 JD 文本（职责、要求等）..."
                className="w-full px-3 py-2 rounded-xl bg-white border border-gray-200 text-sm focus:outline-none focus:border-indigo-300 resize-none" />
            </div>
          )}

          {loading ? (
            <div className="flex items-center gap-2">
              <div className="flex-1 h-10 rounded-xl bg-indigo-500/90 text-white text-sm font-medium flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />AI 匹配中...
              </div>
              <button onClick={handlePause}
                className="h-10 px-4 rounded-xl border border-red-200 text-red-500 text-sm font-medium hover:bg-red-50 transition-all flex items-center gap-2 shrink-0">
                <Pause className="w-4 h-4" />暂停匹配
              </button>
            </div>
          ) : (
            <button onClick={handleMatch}
              className="w-full h-10 rounded-xl bg-indigo-500 text-white text-sm font-medium hover:bg-indigo-600 transition-all flex items-center justify-center gap-2">
              <Sparkles className="w-4 h-4" />开始匹配
            </button>
          )}

          {error && <div className="px-4 py-2.5 rounded-xl bg-red-50 border border-red-100 text-sm text-red-600">{error}</div>}

          {/* 历史匹配记录：退出/刷新后仍可复看，最多保留 5 条 */}
          {!loading && history.length > 0 && (
            <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3 space-y-1.5">
              <div className="flex items-center gap-1.5 px-0.5">
                <History className="w-3.5 h-3.5 text-gray-400" />
                <span className="text-xs font-medium text-gray-500">历史匹配记录（保留最近 5 条）</span>
              </div>
              {history.map((rec) => {
                const isActive = viewingTitle?.startsWith(rec.jdTitle) && viewingTitle.includes(formatSavedAt(rec.savedAt));
                return (
                  <div key={rec.id}
                    className={`group flex items-center gap-2 px-2.5 py-2 rounded-lg border transition-colors ${isActive ? 'border-indigo-200 bg-indigo-50/70' : 'border-transparent bg-white hover:bg-indigo-50/40'}`}>
                    <button onClick={() => handleReview(rec.id)} className="flex-1 min-w-0 text-left">
                      <p className="text-sm font-medium text-gray-700 truncate">{rec.jdTitle}
                        <span className="ml-2 text-xs font-normal text-gray-400">{rec.results.length} 位 · {formatSavedAt(rec.savedAt)}</span>
                      </p>
                      <p className="text-xs text-gray-400 truncate">{rec.jdSubtitle}</p>
                    </button>
                    <button onClick={() => handleReview(rec.id)}
                      className="shrink-0 inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700 px-2 py-1 rounded-md hover:bg-indigo-100/60">
                      <RotateCcw className="w-3.5 h-3.5" />复看
                    </button>
                    <button onClick={() => { removeRecord(rec.id); if (isActive) { setResults(null); setViewingTitle(null); } }}
                      className="shrink-0 p-1 rounded-md text-gray-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {results && results.length > 0 && (
            <div className="space-y-3 pt-1">
              {viewingTitle ? (
                <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-100">
                  <span className="text-xs text-amber-700 flex items-center gap-1.5 min-w-0">
                    <History className="w-3.5 h-3.5 shrink-0" /><span className="truncate">复看历史结果：{viewingTitle}</span>
                  </span>
                  <button onClick={() => { setResults(null); setViewingTitle(null); }}
                    className="shrink-0 text-xs text-amber-600 hover:text-amber-800 underline">收起</button>
                </div>
              ) : (
                <p className="text-sm font-medium text-gray-600">匹配结果（{results.length} 位，按分数降序）</p>
              )}
              {results.map((r) => (
                <div key={r.id} className="rounded-xl border border-gray-100 p-4 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-800">{r.talent.name || '未知'} <span className="font-normal text-gray-400">· {r.talent.jobTitle || '—'}</span></p>
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
                      {r.concerns.slice(0, 2).map((c, i) => <li key={i} className="text-xs text-amber-600">⚠ {c}</li>)}
                    </ul>
                  )}

                  <div className="flex items-center gap-3 pt-1">
                    {r.talent.resumeUrl && (
                      <a href={r.talent.resumeUrl} target="_blank" rel="noopener noreferrer" download={r.talent.resumeFileName}
                        className="inline-flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-700 hover:underline">
                        <FileText className="w-3.5 h-3.5" />{r.talent.resumeFileName || '简历'}
                      </a>
                    )}
                    {r.talent.tg && (
                      <button onClick={() => handleCopyTg(r.talent.tg!, r.id)} className="inline-flex items-center gap-1.5 text-xs text-gray-600 hover:text-indigo-600">
                        {copiedId === r.id ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5 text-gray-300" />}{r.talent.tg}
                      </button>
                    )}
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
