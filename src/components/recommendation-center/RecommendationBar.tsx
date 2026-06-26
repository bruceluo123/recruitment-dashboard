'use client';
import { useState } from 'react';
import { CalendarPlus, CalendarCheck, Pencil, Trash2, Phone, UserCog, Check, Sparkles, ChevronDown, ChevronUp } from 'lucide-react';
import type { RepushItem } from '@/store/repush-store';
import { displayName, formatRecommendTime, formatOrgDept } from '@/lib/repush-format';

interface RecommendationBarProps {
  item: RepushItem;
  onSchedule: (item: RepushItem) => void;
  onEdit: (item: RepushItem) => void;
  onRemove: (id: string) => void;
}

export function RecommendationBar({ item, onSchedule, onEdit, onRemove }: RecommendationBarProps) {
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showHighlights, setShowHighlights] = useState(false);
  const base = displayName(item);
  const orgDept = formatOrgDept(item.organization, item.department);

  const copyContact = async () => {
    if (!item.contact) return;
    try {
      await navigator.clipboard.writeText(item.contact);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  };

  return (
    <div className="group rounded-2xl border border-gray-100 bg-white hover:border-indigo-200 hover:shadow-sm transition-all">
      <div className="flex items-center gap-4 px-4 py-3">
      {/* 主信息 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-gray-800 truncate">{base}</span>
          {item.interviewRound && (
            <span className="px-1.5 py-0.5 rounded-md bg-green-50 text-green-600 text-[11px] font-medium shrink-0">{item.interviewRound}</span>
          )}
        </div>
        <div className="mt-1 flex items-center gap-x-3 gap-y-0.5 flex-wrap text-xs text-gray-400">
          {orgDept && <span className="text-indigo-500">{orgDept}</span>}
          {item.contactPerson && <span className="flex items-center gap-0.5"><UserCog className="w-3 h-3" />对接 {item.contactPerson}</span>}
          <span className="text-gray-400">{formatRecommendTime(item.uploadedAt)}</span>
        </div>
      </div>

      {/* TG 号：放大显示，点击复制 */}
      {item.contact && (
        <button
          onClick={copyContact}
          title="点击复制 TG 号"
          className="shrink-0 flex items-center gap-1 px-2.5 h-8 rounded-lg text-sm font-semibold text-indigo-600 bg-indigo-50 border border-indigo-100 hover:bg-indigo-100 transition-colors"
        >
          {copied ? <Check className="w-4 h-4 text-green-500" /> : <Phone className="w-4 h-4" />}
          <span className="max-w-[180px] truncate">{copied ? '已复制' : item.contact}</span>
        </button>
      )}

      {/* 操作区 */}
      <div className="flex items-center gap-1.5 shrink-0">
        {item.highlights && (
          <button
            onClick={() => setShowHighlights((v) => !v)}
            className="flex items-center gap-1 px-2.5 h-8 rounded-lg text-xs font-medium border border-amber-200 bg-amber-50 text-amber-600 hover:bg-amber-100 transition-colors"
            title="查看简历亮点"
          >
            <Sparkles className="w-3.5 h-3.5" />
            亮点
            {showHighlights ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        )}
        {item.interviewStatus === 'scheduled' ? (
          <button
            onClick={() => onSchedule(item)}
            className="flex items-center gap-1 px-2.5 h-8 rounded-lg text-xs font-medium border border-green-200 bg-green-50 text-green-600 hover:bg-green-100 transition-colors"
            title="已约面，点击可改期"
          >
            <CalendarCheck className="w-3.5 h-3.5" />
            已约面
          </button>
        ) : (
          <button
            onClick={() => onSchedule(item)}
            className="flex items-center gap-1 px-2.5 h-8 rounded-lg text-xs font-medium border border-indigo-200 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-colors"
            title="约面并同步面试日历"
          >
            <CalendarPlus className="w-3.5 h-3.5" />
            面试
          </button>
        )}
        <button
          onClick={() => onEdit(item)}
          className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-500 hover:bg-indigo-50 transition-all"
          title="编辑"
        >
          <Pencil className="w-4 h-4" />
        </button>
        {confirming ? (
          <div className="flex items-center gap-1">
            <button onClick={() => { onRemove(item.id); setConfirming(false); }} className="px-2 h-8 rounded-lg text-xs font-medium bg-red-500 text-white hover:bg-red-600">确认删除</button>
            <button onClick={() => setConfirming(false)} className="px-2 h-8 rounded-lg text-xs text-gray-500 hover:bg-gray-100">取消</button>
          </div>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-all opacity-0 group-hover:opacity-100"
            title="删除"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
      </div>

      {/* 简历亮点展开面板 */}
      {showHighlights && item.highlights && (
        <div className="px-4 pb-3 pt-0">
          <div className="rounded-xl bg-amber-50 border border-amber-100 px-4 py-3">
            <p className="text-xs font-medium text-amber-700 mb-1.5 flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5" />简历亮点（仅内部可见）
            </p>
            <pre className="text-xs text-gray-700 leading-relaxed whitespace-pre-wrap font-sans">{item.highlights}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
