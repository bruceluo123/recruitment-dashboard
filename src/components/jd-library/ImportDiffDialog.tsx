'use client';
import { useState } from 'react';
import { useJDStore } from '@/store/jd-store';
import type { JD, JDImportResult, JDDiffItem } from '@/types/jd';
import { Bell, X } from 'lucide-react';
import { JdPreviewCard } from './JdPreviewCard';

// 今日增改弹窗：展示上次覆盖导入的新增/移除/异动明细，点条目左侧滑出该 JD 预览。
export function ImportDiffDialog({ diff, onClose }: { diff: (JDImportResult & { date: string }) | null; onClose: () => void }) {
  const jds = useJDStore((s) => s.jds);
  const [previewJd, setPreviewJd] = useState<JD | null>(null);

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

  const handleItemClick = (item: JDDiffItem) => {
    const found = findJd(item);
    if (!found) return;
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

      {previewJd && <JdPreviewCard jd={previewJd} onClose={() => setPreviewJd(null)} />}

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
              <p className="font-semibold text-green-700 mb-2">🟢 新增 {diff.added.length} 个岗位</p>
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
