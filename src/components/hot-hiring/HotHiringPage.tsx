'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { EmptyState } from '@/components/ui/EmptyState';
import { Flame, Layers, AlertTriangle } from 'lucide-react';
import { useJDStore } from '@/store/jd-store';
import {
  PRIORITY_COLORS,
  isUrgentPriority,
  priorityRank,
  JD_STATUS_COLORS,
  JD_STATUS_LABELS,
} from '@/types/jd';
import type { JD } from '@/types/jd';
import { cn } from '@/lib/utils';

/** 把缺口文本（"3"、"5人"、"急招2"）解析为数字，无法解析时为 0。 */
function parseGap(gap?: string): number {
  if (!gap) return 0;
  const m = gap.match(/\d+/);
  return m ? parseInt(m[0], 10) : 0;
}

interface HotRow {
  jd: JD;
  gap: number;
}

export function HotHiringPage() {
  const [mounted, setMounted] = useState(false);
  const router = useRouter();
  const jds = useJDStore((s) => s.jds);
  const selectJD = useJDStore((s) => s.selectJD);

  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  const rows: HotRow[] = jds.map((jd) => ({ jd, gap: parseGap(jd.gap) }));

  // 急招：优先级 P0 / P1，P0 在前，其次按缺口降序
  const urgent = rows
    .filter(({ jd }) => isUrgentPriority(jd.priority))
    .sort((a, b) => {
      const r = priorityRank(a.jd.priority) - priorityRank(b.jd.priority);
      return r !== 0 ? r : b.gap - a.gap;
    });

  // 大量招：缺口 >= 2，按缺口降序
  const massHiring = rows
    .filter(({ gap }) => gap >= 2)
    .sort((a, b) => b.gap - a.gap);

  const handleOpenJD = (id: string) => { selectJD(id); router.push('/jd-library'); };

  return (
    <div className="animate-fade-in space-y-5 max-w-7xl mx-auto">
      <div>
        <h2 className="text-2xl font-bold text-gray-800">热招看板</h2>
        <p className="text-sm text-gray-500 mt-1">
          急招 {urgent.length} 个（P0/P1）· 大量招 {massHiring.length} 个（缺口 ≥ 2）
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 急招 */}
        <GlassPanel>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold text-gray-800 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-500" />急招 · P0 / P1
            </h3>
            <span className="text-xs text-gray-400">共 {urgent.length} 个</span>
          </div>
          {urgent.length > 0 ? (
            <div className="space-y-2">
              {urgent.map(({ jd, gap }) => (
                <HotJDRow key={jd.id} jd={jd} gap={gap} onOpen={handleOpenJD} showPriority />
              ))}
            </div>
          ) : (
            <EmptyState icon={AlertTriangle} title="暂无急招岗位" description="源表「优先级」列标记 P0 / P1 后将在此展示" />
          )}
        </GlassPanel>

        {/* 大量招 */}
        <GlassPanel>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold text-gray-800 flex items-center gap-2">
              <Layers className="w-4 h-4 text-orange-500" />大量招 · 缺口 ≥ 2
            </h3>
            <span className="text-xs text-gray-400">共 {massHiring.length} 个</span>
          </div>
          {massHiring.length > 0 ? (
            <div className="space-y-2">
              {massHiring.map(({ jd, gap }) => (
                <HotJDRow key={jd.id} jd={jd} gap={gap} onOpen={handleOpenJD} showPriority />
              ))}
            </div>
          ) : (
            <EmptyState icon={Flame} title="暂无大量招岗位" description="JD 设置缺口 ≥ 2 后将在此排序展示" />
          )}
        </GlassPanel>
      </div>
    </div>
  );
}

interface HotJDRowProps {
  jd: JD;
  gap: number;
  onOpen: (id: string) => void;
  showPriority?: boolean;
}

function HotJDRow({ jd, gap, onOpen, showPriority }: HotJDRowProps) {
  return (
    <button
      onClick={() => onOpen(jd.id)}
      className="w-full flex items-center gap-3 p-3 rounded-xl border border-gray-100 hover:bg-gray-50 hover:border-gray-200 transition-all text-left group"
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800 truncate group-hover:text-indigo-600">{jd.title}</p>
        <p className="text-xs text-gray-400 truncate">{jd.department || jd.organization || '—'}</p>
      </div>
      {showPriority && jd.priority && (
        <span className={cn('px-2 py-0.5 rounded-md text-xs font-medium shrink-0', PRIORITY_COLORS[jd.priority] || PRIORITY_COLORS.P3)}>
          {jd.priority}
        </span>
      )}
      {jd.status === 'urgent' && (
        <span className={cn('px-2 py-0.5 rounded-md text-xs font-medium shrink-0', JD_STATUS_COLORS.urgent)}>{JD_STATUS_LABELS.urgent}</span>
      )}
      {gap > 0 && (
        <span className="shrink-0 text-right">
          <span className="text-lg font-bold text-red-500">{gap}</span>
          <span className="text-xs text-gray-400 ml-0.5">缺口</span>
        </span>
      )}
    </button>
  );
}
