'use client';
import { useState } from 'react';
import { useJDStore } from '@/store/jd-store';
import type { JD, JDImportResult, JDDiffItem } from '@/types/jd';
import { Bell, X, Megaphone, Copy, Check } from 'lucide-react';
import { buildDesensitizedCopy } from '@/lib/ad-copy';
import { JdPreviewCard } from './JdPreviewCard';

// 今日增改弹窗：展示上次覆盖导入的新增/移除/异动明细，点条目左侧滑出该 JD 预览。
// 「今日新增」可一键生成热招文案（沿用热招看板的脱敏分组格式）。
export function ImportDiffDialog({ diff, onClose }: { diff: (JDImportResult & { date: string }) | null; onClose: () => void }) {
  const jds = useJDStore((s) => s.jds);
  const [previewJd, setPreviewJd] = useState<JD | null>(null);
  const [showCopy, setShowCopy] = useState(false);
  const [copied, setCopied] = useState(false);

  const dateLabel = diff ? (() => {
    const d = new Date(diff.date);
    return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  })() : null;

  const findJd = (item: JDDiffItem): JD | undefined => {
    if (item.reqKey) {
      const byKey = jds.find((j) => j.reqKey === item.reqKey);
      if (byKey) return byKey;
    }
    return jds.find((j) => j.title.trim() === item.title.trim());
  };

  // 今日新增岗位映射为完整 JD（脱敏文案按大类分组需要 categories）
  const addedJds: JD[] = (diff?.added || []).map((it) => findJd(it)).filter((j): j is JD => !!j);
  const copyText = addedJds.length ? buildDesensitizedCopy(addedJds).text : '';

  const handleCopy = () => {
    if (!copyText) return;
    navigator.clipboard.writeText(copyText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const handleItemClick = (item: JDDiffItem) => {
    const found = findJd(item);
    if (!found) return;
    setShowCopy(false);
    setPreviewJd((prev) => (prev?.id === found.id ? null : found));
  };

  const renderDiffItem = (item: JDDiffItem, color: string, clickable: boolean) => {
    // 优先读当前库中该岗位的实时字段，让历史 diff 快照也与详情卡保持一致（服务单位）；
    // 找不到（如已移除岗位）时退回 diff 自身记录的字段。
    const live = findJd(item);
    const org = live?.organization ?? item.organization;
    const svc = live?.serviceUnit ?? item.serviceUnit ?? live?.department ?? item.department;
    return (
      <li
        key={item.reqKey || item.title}
        onClick={clickable ? () => handleItemClick(item) : undefined}
        className={clickable ? 'text-xs text-gray-700 flex items-baseline gap-1.5 cursor-pointer rounded-md px-1 py-0.5 -mx-1 hover:bg-gray-50 transition-colors' + (previewJd && live?.id === previewJd.id ? ' bg-indigo-50' : '') : 'text-xs text-gray-700 flex items-baseline gap-1.5'}
      >
        <span className={`shrink-0 ${color}`}>·</span>
        <span className={clickable ? 'hover:text-indigo-600 transition-colors' : ''}>{item.title}</span>
        {(org || svc) && (
          <span className="text-gray-400 shrink-0">
            {[org, svc].filter(Boolean).join(' · ')}
          </span>
        )}
        {item.changes && item.changes.length > 0 && (
          <span className="text-amber-600 ml-1 shrink-0">— {item.changes.join('，')}</span>
        )}
      </li>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="fixed inset-0 bg-black/20" onClick={onClose} />

      {/* 左侧面板：热招文案优先于详情预览 */}
      {showCopy ? (
        <div className="relative z-10 w-[400px] h-full bg-white border-r border-gray-100 shadow-xl flex flex-col overflow-hidden animate-fade-in" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0">
            <h4 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
              <Megaphone className="w-4 h-4 text-red-500" />今日新增 · 热招文案
              <span className="text-xs font-normal text-gray-400">脱敏 · {addedJds.length} 个</span>
            </h4>
            <button onClick={() => setShowCopy(false)} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 shrink-0"><X className="w-4 h-4" /></button>
          </div>
          <div className="px-4 py-2.5 border-b border-gray-100 shrink-0">
            <button
              onClick={handleCopy}
              disabled={!copyText}
              className="flex items-center gap-1 px-2.5 h-8 rounded-lg text-xs font-medium border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 disabled:opacity-50"
            >
              {copied ? <><Check className="w-3.5 h-3.5 text-green-500" />已复制</> : <><Copy className="w-3.5 h-3.5" />复制文案</>}
            </button>
          </div>
          <pre className="overflow-y-auto flex-1 px-4 py-3 text-xs text-gray-700 whitespace-pre-wrap font-sans leading-relaxed select-all">
            {copyText || '（今日新增岗位在库中未找到，可能已被移除）'}
          </pre>
        </div>
      ) : (
        previewJd && <JdPreviewCard jd={previewJd} onClose={() => setPreviewJd(null)} />
      )}

      {/* Diff panel (right) */}
      <div
        className="relative z-10 w-[300px] h-full bg-white shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <h3 className="text-base font-semibold text-gray-800 flex items-center gap-2">
            <Bell className="w-4 h-4 text-indigo-500" />今日增改{dateLabel ? ` · ${dateLabel}` : ''}
          </h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400"><X className="w-5 h-5" /></button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-5 text-sm">
          {!diff ? (
            <div className="py-8 text-center">
              <p className="text-gray-500 text-sm">暂无增改记录</p>
              <p className="text-gray-400 text-xs mt-1">下次批量导入时开启「覆盖模式」，完成后此处将自动保存完整增改明细。</p>
            </div>
          ) : (<>
          <p className="text-gray-500 text-xs">
            已覆盖：岗位库现为 <span className="font-semibold text-gray-800">{diff.replaced}</span> 个岗位
          </p>

          {diff.added && diff.added.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="font-semibold text-green-700">🟢 新增 {diff.added.length} 个岗位</p>
                <button
                  onClick={() => { setPreviewJd(null); setShowCopy(true); }}
                  className={`flex items-center gap-1 px-2 h-6 rounded-md text-[11px] font-medium transition-all ${showCopy ? 'bg-red-500 text-white' : 'bg-red-50 text-red-500 hover:bg-red-100'}`}
                >
                  <Megaphone className="w-3 h-3" />热招文案
                </button>
              </div>
              <ul className="space-y-0.5 pl-1">
                {diff.added.map((d) => renderDiffItem(d, 'text-green-500', true))}
              </ul>
            </div>
          )}

          {diff.removed && diff.removed.length > 0 && (
            <div>
              <p className="font-semibold text-red-600 mb-2">🔴 移除 {diff.removed.length} 个岗位</p>
              <ul className="space-y-0.5 pl-1">
                {diff.removed.map((d) => renderDiffItem(d, 'text-red-400', false))}
              </ul>
            </div>
          )}

          {diff.changed && diff.changed.length > 0 && (
            <div>
              <p className="font-semibold text-amber-600 mb-2">🟡 异动 {diff.changed.length} 个岗位</p>
              <ul className="space-y-0.5 pl-1">
                {diff.changed.map((d) => renderDiffItem(d, 'text-amber-500', true))}
              </ul>
            </div>
          )}

          {!diff.added?.length && !diff.removed?.length && !diff.changed?.length && (
            <p className="text-gray-400 text-center py-4">本次覆盖与上次相比无变化。</p>
          )}
          </>)}
        </div>
      </div>
    </div>
  );
}
