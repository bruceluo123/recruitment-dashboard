'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { EmptyState } from '@/components/ui/EmptyState';
import { Flame, AlertTriangle, Megaphone, X, Copy, Check } from 'lucide-react';
import { useJDStore } from '@/store/jd-store';
import {
  PRIORITY_COLORS,
  isUrgentPriority,
  priorityRank,
  JD_STATUS_COLORS,
  JD_STATUS_LABELS,
} from '@/types/jd';
import type { JD } from '@/types/jd';
import { buildAdCopy, adVariantLabel, type AdSegment, type AdVariant } from '@/lib/ad-copy';
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
  const [adVariant, setAdVariant] = useState<AdVariant | null>(null);
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

  // 加急：源表 ❗ 标记的岗位，P0 在前，其次按缺口降序
  const expedited = rows
    .filter(({ jd }) => jd.expedited)
    .sort((a, b) => {
      const r = priorityRank(a.jd.priority) - priorityRank(b.jd.priority);
      return r !== 0 ? r : b.gap - a.gap;
    });

  const handleOpenJD = (id: string) => { selectJD(id); router.push('/jd-library'); };

  return (
    <div className="animate-fade-in space-y-5 max-w-7xl mx-auto">
      <div>
        <h2 className="text-2xl font-bold text-gray-800">热招看板</h2>
        <p className="text-sm text-gray-500 mt-1">
          急招 {urgent.length} 个（P0/P1）· 加急 {expedited.length} 个（❗ 标记）
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 急招 */}
        <GlassPanel>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold text-gray-800 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-500" />急招 · P0 / P1
            </h3>
            <div className="flex items-center gap-2">
              {urgent.length > 0 && (
                <>
                  <button
                    onClick={() => setAdVariant('maimanfen')}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 text-xs font-medium transition-colors"
                  >
                    <Megaphone className="w-3.5 h-3.5" />麦满分文案
                  </button>
                  <button
                    onClick={() => setAdVariant('tieniu')}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-50 text-amber-600 hover:bg-amber-100 text-xs font-medium transition-colors"
                  >
                    <Megaphone className="w-3.5 h-3.5" />铁牛文案
                  </button>
                </>
              )}
              <span className="text-xs text-gray-400">共 {urgent.length} 个</span>
            </div>
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

        {/* 加急 */}
        <GlassPanel>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold text-gray-800 flex items-center gap-2">
              <Flame className="w-4 h-4 text-red-600" />加急 · ❗ 标记
            </h3>
            <span className="text-xs text-gray-400">共 {expedited.length} 个</span>
          </div>
          {expedited.length > 0 ? (
            <div className="space-y-2">
              {expedited.map(({ jd, gap }) => (
                <HotJDRow key={jd.id} jd={jd} gap={gap} onOpen={handleOpenJD} showPriority expedited />
              ))}
            </div>
          ) : (
            <EmptyState icon={Flame} title="暂无加急岗位" description="粘贴需求面板「加急」清单（带 ❗ 标记）后将在此展示" />
          )}
        </GlassPanel>
      </div>

      {adVariant && (
        <AdCopyDialog jds={urgent.map((r) => r.jd)} variant={adVariant} onClose={() => setAdVariant(null)} />
      )}
    </div>
  );
}

interface AdCopyDialogProps {
  jds: JD[];
  variant: AdVariant;
  onClose: () => void;
}

function AdCopyDialog({ jds, variant, onClose }: AdCopyDialogProps) {
  const p0Segments = buildAdCopy(jds.filter((jd) => jd.priority === 'P0'), 'P0', variant);
  const p1Segments = buildAdCopy(jds.filter((jd) => jd.priority === 'P1'), 'P1', variant);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-800 flex items-center gap-2">
            <Megaphone className="w-4 h-4 text-red-500" />急招招聘文案 · {adVariantLabel(variant)}版
          </h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4 space-y-5">
          <AdSection label="P0" segments={p0Segments} />
          <AdSection label="P1" segments={p1Segments} />
          {p0Segments.length === 0 && p1Segments.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-6">暂无 P0 / P1 急招岗位</p>
          )}
        </div>
      </div>
    </div>
  );
}

interface AdSectionProps {
  label: string;
  segments: AdSegment[];
}

function AdSection({ label, segments }: AdSectionProps) {
  if (segments.length === 0) return null;
  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold text-gray-700">{label} 急招（{segments.length} 段）</h4>
      {segments.map((seg, i) => (
        <AdSegmentCard key={i} segment={seg} />
      ))}
    </div>
  );
}

function AdSegmentCard({ segment }: { segment: AdSegment }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(segment.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-100">
        <span className="text-xs font-medium text-gray-500">{segment.title} · {segment.count} 个岗位</span>
        <button
          onClick={handleCopy}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium text-indigo-600 hover:bg-indigo-50"
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre className="px-3 py-3 text-xs text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">{segment.text}</pre>
    </div>
  );
}

interface HotJDRowProps {
  jd: JD;
  gap: number;
  onOpen: (id: string) => void;
  showPriority?: boolean;
  expedited?: boolean;
}

function HotJDRow({ jd, gap, onOpen, showPriority, expedited }: HotJDRowProps) {
  return (
    <button
      onClick={() => onOpen(jd.id)}
      className="w-full flex items-center gap-3 p-3 rounded-xl border border-gray-100 hover:bg-gray-50 hover:border-gray-200 transition-all text-left group"
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800 truncate group-hover:text-indigo-600">
          {expedited && <span className="mr-1 text-red-600">❗</span>}{jd.title}
        </p>
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
