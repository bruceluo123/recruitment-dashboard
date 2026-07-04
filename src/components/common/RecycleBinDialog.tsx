'use client';
import { useRecycleStore, type RecycleType } from '@/store/recycle-store';
import { useJDStore } from '@/store/jd-store';
import { useTalentStore } from '@/store/talent-store';
import { generateId } from '@/lib/utils';
import type { JD } from '@/types/jd';
import type { Talent } from '@/types/talent';
import { Trash2, RotateCcw, X, Archive } from 'lucide-react';

interface RecycleBinDialogProps {
  type: RecycleType;
  open: boolean;
  onClose: () => void;
}

const TYPE_LABEL: Record<RecycleType, string> = { jd: '岗位', talent: '人选' };

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86400000);
  if (d >= 1) return `${d} 天前`;
  const h = Math.floor(diff / 3600000);
  if (h >= 1) return `${h} 小时前`;
  const m = Math.floor(diff / 60000);
  return m >= 1 ? `${m} 分钟前` : '刚刚';
}

export function RecycleBinDialog({ type, open, onClose }: RecycleBinDialogProps) {
  const entries = useRecycleStore((s) => s.entries).filter((e) => e.type === type);
  const remove = useRecycleStore((s) => s.remove);

  // 恢复：赋新 id 后重新加入对应 store。
  // 必须换新 id —— 原 id 已进 KV 墓碑，沿用会被 applyTombstones 再次过滤掉（数据事故同源教训）。
  const restore = (key: string, data: unknown) => {
    const now = new Date().toISOString();
    if (type === 'jd') {
      const jd = data as JD;
      useJDStore.getState().addJdBatch([{ ...jd, id: generateId(), createdAt: now, updatedAt: now }]);
    } else {
      const t = data as Talent;
      useTalentStore.getState().addTalent({ ...t, id: generateId(), createdAt: now, updatedAt: now });
    }
    remove(key);
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-lg max-h-[80vh] flex flex-col bg-white border border-gray-200 rounded-2xl shadow-2xl animate-fade-in">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
            <Archive className="w-4 h-4 text-gray-500" />回收站 · {TYPE_LABEL[type]}
            <span className="text-xs font-normal text-gray-400">（本机保留 30 天）</span>
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100"><X className="w-5 h-5 text-gray-400" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {entries.length === 0 ? (
            <p className="text-center text-sm text-gray-400 py-10">回收站为空，最近没有删除记录。</p>
          ) : (
            <ul className="space-y-1.5">
              {entries.map((e) => (
                <li key={e.key} className="flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-100 hover:bg-gray-50">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-800 truncate">{e.label || '(无标题)'}</p>
                    <p className="text-xs text-gray-400">{e.deletedBy} · {timeAgo(e.deletedAt)}删除</p>
                  </div>
                  <button onClick={() => restore(e.key, e.data)}
                    className="shrink-0 flex items-center gap-1 px-2.5 h-8 rounded-lg text-xs font-medium bg-indigo-50 text-indigo-600 hover:bg-indigo-100">
                    <RotateCcw className="w-3.5 h-3.5" />恢复
                  </button>
                  <button onClick={() => remove(e.key)} title="永久删除"
                    className="shrink-0 p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
