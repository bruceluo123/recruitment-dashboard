'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  AlertTriangle, Megaphone, X, Copy, Check,
  ChevronDown, ChevronUp,
} from 'lucide-react';
import { useJDStore } from '@/store/jd-store';
import type { JDCategory } from '@/types/jd';
import {
  PRIORITY_COLORS,
  isUrgentPriority,
  priorityRank,
  JD_STATUS_COLORS,
  JD_STATUS_LABELS,
  JD_CATEGORY_LABELS,
  getPrimaryCategory,
} from '@/types/jd';

import type { JD } from '@/types/jd';
import {
  buildAdCopy, adVariantLabel, getCategoryEmoji,
  type AdSegment, type AdVariant,
} from '@/lib/ad-copy';
import { cn } from '@/lib/utils';

function parseGap(gap?: string): number {
  if (!gap) return 0;
  const m = gap.match(/\d+/);
  return m ? parseInt(m[0], 10) : 0;
}

interface UrgentGroup {
  priority: 'P0' | 'P1';
  cat: JDCategory;
  jds: JD[];
  key: string;
}

function buildUrgentGroups(jds: JD[]): UrgentGroup[] {
  const groups: UrgentGroup[] = [];
  for (const priority of ['P0', 'P1'] as const) {
    const pJds = jds.filter((j) => j.priority === priority);
    const catMap = new Map<JDCategory, JD[]>();
    for (const jd of pJds) {
      const cat = getPrimaryCategory(jd);
      if (!catMap.has(cat)) catMap.set(cat, []);
      catMap.get(cat)!.push(jd);
    }
    const sorted = Array.from(catMap.entries()).sort((a, b) => {
      if (a[0] === 'ai') return -1;
      if (b[0] === 'ai') return 1;
      return b[1].length - a[1].length;
    });
    for (const [cat, list] of sorted) {
      groups.push({ priority, cat, jds: list, key: `${priority}:${cat}` });
    }
  }
  return groups;
}

export function HotHiringPage() {
  const [mounted, setMounted] = useState(false);
  const [adVariant, setAdVariant] = useState<AdVariant | null>(null);
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const router = useRouter();
  const jds = useJDStore((s) => s.jds);
  const selectJD = useJDStore((s) => s.selectJD);

  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  const urgent = jds
    .filter((jd) => isUrgentPriority(jd.priority))
    .sort((a, b) => {
      const r = priorityRank(a.priority) - priorityRank(b.priority);
      return r !== 0 ? r : parseGap(b.gap) - parseGap(a.gap);
    });

  const urgentGroups = buildUrgentGroups(urgent);
  const p0Groups = urgentGroups.filter((g) => g.priority === 'P0');
  const p1Groups = urgentGroups.filter((g) => g.priority === 'P1');

  const selectedJDs = urgentGroups
    .filter((g) => selectedGroups.has(g.key))
    .flatMap((g) => g.jds);

  const toggleGroup = (key: string) =>
    setSelectedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  const selectAllP0 = () =>
    setSelectedGroups((prev) => new Set([...Array.from(prev), ...p0Groups.map((g) => g.key)]));
  const selectAllP1 = () =>
    setSelectedGroups((prev) => new Set([...Array.from(prev), ...p1Groups.map((g) => g.key)]));
  const clearSelection = () => setSelectedGroups(new Set());

  const handleOpenJD = (id: string) => { selectJD(id); router.push('/jd-library'); };

  return (
    <div className="animate-fade-in space-y-5 max-w-7xl mx-auto">
      <div>
        <h2 className="text-2xl font-bold text-gray-800">热招看板</h2>
        <p className="text-sm text-gray-500 mt-1">
          P0 急招 {p0Groups.reduce((s, g) => s + g.jds.length, 0)} 个 · P1 急招 {p1Groups.reduce((s, g) => s + g.jds.length, 0)} 个
        </p>
      </div>

      {/* 快捷选择 + 文案生成 — 横跨两列 */}
      <GlassPanel>
        <div className="flex items-center gap-1.5 flex-wrap">
          {p0Groups.length > 0 && (
            <button onClick={selectAllP0} className="text-xs px-2 py-1 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 font-medium transition-colors">全选 P0</button>
          )}
          {p1Groups.length > 0 && (
            <button onClick={selectAllP1} className="text-xs px-2 py-1 rounded-lg bg-amber-50 text-amber-600 hover:bg-amber-100 font-medium transition-colors">全选 P1</button>
          )}
          {selectedGroups.size > 0 && (
            <button onClick={clearSelection} className="text-xs px-2 py-1 rounded-lg bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors">清空</button>
          )}
          {selectedGroups.size > 0 && (
            <span className="text-xs text-indigo-500 ml-1">已选 {selectedGroups.size} 个分类 · {selectedJDs.length} 个岗位</span>
          )}
          <div className="flex-1" />
          {selectedGroups.size > 0 ? (
            <>
              <button onClick={() => setAdVariant('maimanfen')} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-red-500 text-white hover:bg-red-600 text-sm font-semibold shadow-sm transition-colors">
                <Megaphone className="w-4 h-4" />生成麦满分文案
              </button>
              <button onClick={() => setAdVariant('tieniu')} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500 text-white hover:bg-amber-600 text-sm font-semibold shadow-sm transition-colors">
                <Megaphone className="w-4 h-4" />生成铁牛文案
              </button>
            </>
          ) : (
            <span className="text-xs text-gray-400">勾选分类后生成文案</span>
          )}
        </div>
      </GlassPanel>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* P0 */}
        <GlassPanel>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-semibold text-gray-800 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-500" />P0 急招
            </h3>
            <span className="text-xs text-gray-400">共 {p0Groups.reduce((s, g) => s + g.jds.length, 0)} 个</span>
          </div>
          {p0Groups.length > 0 ? (
            <div className="space-y-1.5">
              {p0Groups.map((group) => (
                <GroupCard key={group.key} group={group} checked={selectedGroups.has(group.key)} onToggle={() => toggleGroup(group.key)} onOpen={handleOpenJD} />
              ))}
            </div>
          ) : (
            <EmptyState icon={AlertTriangle} title="暂无 P0 岗位" description="源表「优先级」列标记 P0 后将在此展示" />
          )}
        </GlassPanel>

        {/* P1 */}
        <GlassPanel>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-semibold text-gray-800 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />P1 急招
            </h3>
            <span className="text-xs text-gray-400">共 {p1Groups.reduce((s, g) => s + g.jds.length, 0)} 个</span>
          </div>
          {p1Groups.length > 0 ? (
            <div className="space-y-1.5">
              {p1Groups.map((group) => (
                <GroupCard key={group.key} group={group} checked={selectedGroups.has(group.key)} onToggle={() => toggleGroup(group.key)} onOpen={handleOpenJD} />
              ))}
            </div>
          ) : (
            <EmptyState icon={AlertTriangle} title="暂无 P1 岗位" description="源表「优先级」列标记 P1 后将在此展示" />
          )}
        </GlassPanel>
      </div>

      {adVariant && (
        <AdCopyDialog jds={selectedJDs} variant={adVariant} onClose={() => setAdVariant(null)} />
      )}
    </div>
  );
}

// ─── GroupCard ────────────────────────────────────────────────────────────────

interface GroupCardProps {
  group: UrgentGroup;
  checked: boolean;
  onToggle: () => void;
  onOpen: (id: string) => void;
}

function GroupCard({ group, checked, onToggle, onOpen }: GroupCardProps) {
  const [expanded, setExpanded] = useState(false);
  const emoji = getCategoryEmoji(group.cat);
  const label = JD_CATEGORY_LABELS[group.cat] ?? group.cat;

  return (
    <div className={cn(
      'rounded-xl border transition-all',
      checked ? 'border-indigo-200 bg-indigo-50/40' : 'border-gray-100 hover:border-gray-200',
    )}>
      {/* Row header — click = toggle selection */}
      <div
        className="flex items-center gap-2.5 px-3 py-2.5 cursor-pointer"
        onClick={onToggle}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          className="w-4 h-4 accent-indigo-500 cursor-pointer shrink-0"
          onClick={(e) => e.stopPropagation()}
        />
        <span className="text-base leading-none">{emoji}</span>
        <span className="text-sm font-medium text-gray-700 flex-1">{label}类</span>
        <span className={cn(
          'text-xs px-1.5 py-0.5 rounded-md font-medium shrink-0',
          group.priority === 'P0'
            ? 'bg-red-100 text-red-600'
            : 'bg-amber-100 text-amber-600',
        )}>
          {group.jds.length} 个
        </span>
        {/* Expand/collapse toggle — stops propagation so it doesn't toggle checkbox */}
        <button
          className="p-0.5 rounded-md hover:bg-gray-100 text-gray-400 shrink-0"
          onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
          aria-label={expanded ? '收起' : '展开'}
        >
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Expanded JD list */}
      {expanded && (
        <div className="border-t border-gray-100 px-2 py-1.5 space-y-1">
          {group.jds.map((jd) => (
            <HotJDRow
              key={jd.id}
              jd={jd}
              gap={parseGap(jd.gap)}
              onOpen={onOpen}
              showPriority={false}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── AdCopyDialog ─────────────────────────────────────────────────────────────

interface AdCopyDialogProps {
  jds: JD[];
  variant: AdVariant;
  onClose: () => void;
}

function AdCopyDialog({ jds, variant, onClose }: AdCopyDialogProps) {
  // P0 排前、P1 排后，合并成一份文案
  const sorted = [
    ...jds.filter((j) => j.priority === 'P0'),
    ...jds.filter((j) => j.priority === 'P1'),
    ...jds.filter((j) => j.priority !== 'P0' && j.priority !== 'P1'),
  ];
  // perSegment=9999 让所有岗位合成一整段不切割
  const segments = buildAdCopy(sorted, '急招', variant, 9999);

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
          {segments.length > 0
            ? segments.map((seg, i) => <AdSegmentCard key={i} segment={seg} />)
            : <p className="text-sm text-gray-400 text-center py-6">请先勾选至少一个分类</p>
          }
        </div>
      </div>
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

// ─── HotJDRow ─────────────────────────────────────────────────────────────────

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
