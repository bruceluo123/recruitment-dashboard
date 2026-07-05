'use client';
import { useState, useMemo } from 'react';
import type { JD } from '@/types/jd';
import { Bell, X, Megaphone, Sparkles, Copy, Check } from 'lucide-react';
import { buildAdCopy, buildDesensitizedCopy, adVariantLabel, type AdVariant, type AdSegment } from '@/lib/ad-copy';
import { recentWindowLabel } from '@/lib/jd-recent';
import { JdPreviewCard } from './JdPreviewCard';

// 本周新增弹窗：近 5 工作日新增岗位列表，可切「招聘文案」模式，删减岗位后生成/复制文案。
export function WeeklyAddedDialog({ recentJds, onClose }: { recentJds: JD[]; onClose: () => void }) {
  const [previewJd, setPreviewJd] = useState<JD | null>(null);
  const [copyMode, setCopyMode] = useState(false);
  const [copyVariant, setCopyVariant] = useState<AdVariant>('maimanfen');
  const [copyHideSalary, setCopyHideSalary] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  // 文案模式下被排除的岗位（不想发的）。排除后文案会自动从 1 重新编号
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set());

  const weekLabel = recentWindowLabel();

  const handleItemClick = (jd: JD) => {
    setPreviewJd((prev) => (prev?.id === jd.id ? null : jd));
  };

  const toggleExclude = (id: string) => {
    setExcludedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // 滚动窗口内的岗位即「本周新增」，直接用于文案生成（最近的排在前面）
  const weeklyJds = useMemo<JD[]>(
    () => [...recentJds].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')),
    [recentJds],
  );

  // 实际进入文案的岗位 = 本周新增 − 被排除的
  const selectedJds = useMemo<JD[]>(
    () => weeklyJds.filter((jd) => !excludedIds.has(jd.id)),
    [weeklyJds, excludedIds],
  );

  // 文案不再自动生成：用户删完不想发的岗位后，手动点「生成文案」才出结果并从 1 重新编号
  const [generatedSegments, setGeneratedSegments] = useState<AdSegment[]>([]);
  const [generatedSig, setGeneratedSig] = useState('');

  // 当前选择的签名（岗位集合 + 风格 + 脱敏），用于判断生成结果是否已过期
  const currentSig = useMemo(
    () => `${copyHideSalary ? 'd' : 'n'}|${copyVariant}|${selectedJds.map((jd) => jd.id).join(',')}`,
    [copyHideSalary, copyVariant, selectedJds],
  );
  const isDirty = generatedSig !== currentSig;

  const buildSegments = (): AdSegment[] => {
    if (!selectedJds.length) return [];
    if (copyHideSalary) return [buildDesensitizedCopy(selectedJds)];
    return buildAdCopy(selectedJds, '本周新增', copyVariant, 22);
  };

  const handleGenerate = () => {
    setGeneratedSegments(buildSegments());
    setGeneratedSig(currentSig);
  };

  const openCopyMode = () => {
    setPreviewJd(null);
    setCopyMode((on) => {
      const next = !on;
      // 进入文案模式时按当前（全部）岗位先生成一版，用户再删减后点「重新生成」
      if (next) {
        const segs = selectedJds.length
          ? (copyHideSalary ? [buildDesensitizedCopy(selectedJds)] : buildAdCopy(selectedJds, '本周新增', copyVariant, 22))
          : [];
        setGeneratedSegments(segs);
        setGeneratedSig(currentSig);
      }
      return next;
    });
  };

  const handleCopy = (text: string, idx: number) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 1500);
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="fixed inset-0 bg-black/20" onClick={onClose} />

      {previewJd && !copyMode && <JdPreviewCard jd={previewJd} onClose={() => setPreviewJd(null)} />}

      {/* 招聘文案 panel (left of weekly panel, when copyMode) */}
      {copyMode && (
        <div className="relative z-10 w-[400px] h-full bg-white border-r border-gray-100 shadow-xl flex flex-col overflow-hidden animate-fade-in">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0">
            <h4 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
              <Megaphone className="w-4 h-4 text-red-500" />
              招聘文案 · 已选 {selectedJds.length} 个岗位{excludedIds.size > 0 ? `（排除 ${excludedIds.size}）` : ''}
            </h4>
            <button onClick={() => setCopyMode(false)} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 shrink-0">
              <X className="w-4 h-4" />
            </button>
          </div>
          {/* 风格 + 脱敏切换 */}
          <div className="flex gap-2 px-4 py-2.5 border-b border-gray-100 shrink-0 flex-wrap">
            <button
              onClick={() => setCopyHideSalary(false)}
              className={`px-3 h-7 rounded-lg text-xs font-medium transition-all ${!copyHideSalary ? 'bg-gray-700 text-white' : 'border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
            >常规</button>
            <button
              onClick={() => setCopyHideSalary(true)}
              className={`px-3 h-7 rounded-lg text-xs font-medium transition-all ${copyHideSalary ? 'bg-gray-700 text-white' : 'border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
            >脱敏</button>
            {/* 脱敏模式下隐藏风格按钮（模板固定） */}
            {!copyHideSalary && (
              <>
                <div className="w-px self-stretch bg-gray-200 mx-0.5" />
                {(['maimanfen', 'tieniu'] as AdVariant[]).map((v) => (
                  <button
                    key={v}
                    onClick={() => setCopyVariant(v)}
                    className={`px-3 h-7 rounded-lg text-xs font-medium transition-all ${
                      copyVariant === v
                        ? 'bg-red-500 text-white'
                        : 'border border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {adVariantLabel(v)}版
                  </button>
                ))}
              </>
            )}
            <span className="ml-auto text-xs text-gray-400 self-center">
              {selectedJds.length} 个岗位 · {generatedSegments.length} 段
            </span>
          </div>
          <p className="px-4 pt-2.5 text-[11px] text-gray-400 shrink-0">删掉不想发的岗位后点「生成文案」，会自动从 1 重新编号。</p>
          <div className="overflow-y-auto flex-1 px-4 py-3 space-y-3">
            {/* 岗位清单：可逐条删除 */}
            {selectedJds.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-8">{weeklyJds.length === 0 ? '本周暂无可生成文案的岗位' : '已全部删除，点右侧列表可恢复'}</p>
            ) : (
              <div className="rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-600">
                  岗位清单 · {selectedJds.length} 个（删完点生成）
                </div>
                <ul className="divide-y divide-gray-100 max-h-[40vh] overflow-y-auto">
                  {selectedJds.map((jd, i) => (
                    <li key={jd.id} className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-700">
                      <span className="shrink-0 w-5 text-gray-400 tabular-nums">{i + 1}</span>
                      <span className="flex-1 min-w-0 truncate">{jd.title}</span>
                      {(jd.organization || jd.department) && (
                        <span className="text-gray-400 shrink-0 truncate max-w-[100px]">{[jd.organization, jd.department].filter(Boolean).join(' · ')}</span>
                      )}
                      <button
                        onClick={() => toggleExclude(jd.id)}
                        title="从文案中删除该岗位"
                        className="shrink-0 p-1 rounded-md text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* 生成按钮：有改动时高亮提示重新生成 */}
            <button
              onClick={handleGenerate}
              disabled={selectedJds.length === 0}
              className={`w-full flex items-center justify-center gap-1.5 h-9 rounded-xl text-sm font-medium transition-all ${
                selectedJds.length === 0
                  ? 'bg-gray-100 text-gray-300 cursor-not-allowed'
                  : isDirty
                    ? 'bg-red-500 text-white hover:bg-red-600'
                    : 'border border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              <Sparkles className="w-4 h-4" />
              {generatedSegments.length === 0 ? '生成文案' : isDirty ? '重新生成（已改动）' : '已是最新'}
            </button>

            {/* 生成结果 */}
            {generatedSegments.map((seg, idx) => (
              <div key={idx} className="rounded-xl border border-gray-200 overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-200">
                  <span className="text-xs font-semibold text-gray-600">{seg.title}</span>
                  <button
                    onClick={() => handleCopy(seg.text, idx)}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-all border border-gray-200 bg-white hover:bg-gray-50 text-gray-600"
                  >
                    {copiedIdx === idx
                      ? <><Check className="w-3 h-3 text-green-500" />已复制</>
                      : <><Copy className="w-3 h-3" />复制</>
                    }
                  </button>
                </div>
                <pre className="px-3 py-3 text-xs text-gray-700 whitespace-pre-wrap font-sans leading-relaxed select-all">
                  {seg.text}
                </pre>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Weekly panel (right) */}
      <div className="relative z-10 w-[300px] h-full bg-white shadow-xl flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <h3 className="text-base font-semibold text-gray-800 flex items-center gap-2 min-w-0">
            <Bell className="w-4 h-4 text-green-500 shrink-0" />
            <span className="truncate">本周新增{weekLabel ? ` · ${weekLabel}` : ''}</span>
            <span className="text-[10px] text-gray-400 font-normal shrink-0">近5个工作日</span>
          </h3>
          <div className="flex items-center gap-1.5 shrink-0 ml-2">
            <button
              onClick={openCopyMode}
              className={`flex items-center gap-1 px-2.5 h-7 rounded-lg text-xs font-medium transition-all ${
                copyMode
                  ? 'bg-red-500 text-white'
                  : 'border border-red-200 text-red-500 hover:bg-red-50'
              }`}
            >
              <Megaphone className="w-3.5 h-3.5" />招聘文案
            </button>
            <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400"><X className="w-5 h-5" /></button>
          </div>
        </div>
        <div className="overflow-y-auto flex-1 px-5 py-4 text-sm">
          {weeklyJds.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-gray-500 text-sm">近 5 个工作日暂无新增岗位</p>
              <p className="text-gray-400 text-xs mt-1">导入面板里真正新增的岗位会自动出现在这里，5 个工作日后滚动移出。</p>
            </div>
          ) : (
            <>
              <p className="text-gray-500 text-xs mb-3">
                近 5 个工作日新增 <span className="font-semibold text-gray-800">{weeklyJds.length}</span> 个岗位
                {copyMode ? '（取消勾选可从文案中排除）' : '（点击查看详情）'}
              </p>
              <ul className="space-y-0.5">
                {weeklyJds.map((jd) => {
                  const isActive = previewJd?.id === jd.id;
                  const isExcluded = excludedIds.has(jd.id);
                  return (
                    <li
                      key={jd.id}
                      onClick={() => (copyMode ? toggleExclude(jd.id) : handleItemClick(jd))}
                      className={
                        'text-xs flex items-baseline gap-1.5 cursor-pointer rounded-md px-1 py-0.5 -mx-1 hover:bg-gray-50 transition-colors'
                        + (isActive ? ' bg-indigo-50' : '')
                        + (copyMode && isExcluded ? ' text-gray-300' : ' text-gray-700')
                      }
                    >
                      {copyMode ? (
                        <span className={'shrink-0 w-3.5 h-3.5 rounded border flex items-center justify-center self-center ' + (isExcluded ? 'border-gray-300 bg-white' : 'border-green-500 bg-green-500')}>
                          {!isExcluded && <Check className="w-2.5 h-2.5 text-white" />}
                        </span>
                      ) : (
                        <span className="text-green-500 shrink-0">·</span>
                      )}
                      <span className={(copyMode && isExcluded ? 'line-through' : 'hover:text-indigo-600') + ' transition-colors'}>{jd.title}</span>
                      {(jd.organization || jd.department) && (
                        <span className="text-gray-400 shrink-0">{[jd.organization, jd.department].filter(Boolean).join(' · ')}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
