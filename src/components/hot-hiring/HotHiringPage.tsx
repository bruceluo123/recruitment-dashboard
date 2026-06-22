'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  Flame, AlertTriangle, Megaphone, X, Copy, Check,
  ClipboardPaste, Loader2, ChevronDown, ChevronUp,
} from 'lucide-react';
import { useJDStore } from '@/store/jd-store';
import { parsePastedTable, pastedRowsToFile } from '@/lib/panel-paste';
import type { JDImportResult, JDCategory } from '@/types/jd';
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

interface HotRow { jd: JD; gap: number; }

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
  const [pasteOpen, setPasteOpen] = useState(false);
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const router = useRouter();
  const jds = useJDStore((s) => s.jds);
  const selectJD = useJDStore((s) => s.selectJD);

  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  const rows: HotRow[] = jds.map((jd) => ({ jd, gap: parseGap(jd.gap) }));

  const urgent = rows
    .filter(({ jd }) => isUrgentPriority(jd.priority))
    .sort((a, b) => {
      const r = priorityRank(a.jd.priority) - priorityRank(b.jd.priority);
      return r !== 0 ? r : b.gap - a.gap;
    });

  const expedited = rows
    .filter(({ jd }) => jd.expedited)
    .sort((a, b) => {
      const r = priorityRank(a.jd.priority) - priorityRank(b.jd.priority);
      return r !== 0 ? r : b.gap - a.gap;
    });

  const urgentGroups = buildUrgentGroups(urgent.map((r) => r.jd));
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
          急招 {urgent.length} 个（P0/P1）· 加急 {expedited.length} 个（❗ 标记）
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 急招 — 分类分组 + 勾选生成 */}
        <GlassPanel>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-semibold text-gray-800 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-500" />急招 · P0 / P1
            </h3>
            <span className="text-xs text-gray-400">共 {urgent.length} 个</span>
          </div>

          {urgent.length > 0 ? (
            <>
              {/* 快捷选择 + 文案生成 */}
              <div className="flex items-center gap-1.5 mb-3 flex-wrap">
                {p0Groups.length > 0 && (
                  <button
                    onClick={selectAllP0}
                    className="text-xs px-2 py-1 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 font-medium transition-colors"
                  >全选 P0</button>
                )}
                {p1Groups.length > 0 && (
                  <button
                    onClick={selectAllP1}
                    className="text-xs px-2 py-1 rounded-lg bg-amber-50 text-amber-600 hover:bg-amber-100 font-medium transition-colors"
                  >全选 P1</button>
                )}
                {selectedGroups.size > 0 && (
                  <button
                    onClick={clearSelection}
                    className="text-xs px-2 py-1 rounded-lg bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors"
                  >清空</button>
                )}
                <div className="flex-1" />
                {selectedGroups.size > 0 ? (
                  <>
                    <button
                      onClick={() => setAdVariant('maimanfen')}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 text-xs font-medium transition-colors"
                    >
                      <Megaphone className="w-3.5 h-3.5" />麦满分
                    </button>
                    <button
                      onClick={() => setAdVariant('tieniu')}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-50 text-amber-600 hover:bg-amber-100 text-xs font-medium transition-colors"
                    >
                      <Megaphone className="w-3.5 h-3.5" />铁牛
                    </button>
                  </>
                ) : (
                  <span className="text-xs text-gray-400">勾选分类后生成文案</span>
                )}
              </div>

              {selectedGroups.size > 0 && (
                <p className="text-xs text-indigo-500 mb-2.5">
                  已选 {selectedGroups.size} 个分类 · {selectedJDs.length} 个岗位
                </p>
              )}

              {/* P0 分类块 */}
              {p0Groups.length > 0 && (
                <div className="mb-3">
                  <p className="text-xs font-bold text-red-500 mb-1.5 px-0.5">P0 急招</p>
                  <div className="space-y-1.5">
                    {p0Groups.map((group) => (
                      <GroupCard
                        key={group.key}
                        group={group}
                        checked={selectedGroups.has(group.key)}
                        onToggle={() => toggleGroup(group.key)}
                        onOpen={handleOpenJD}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* P1 分类块 */}
              {p1Groups.length > 0 && (
                <div>
                  <p className="text-xs font-bold text-amber-500 mb-1.5 px-0.5">P1 急招</p>
                  <div className="space-y-1.5">
                    {p1Groups.map((group) => (
                      <GroupCard
                        key={group.key}
                        group={group}
                        checked={selectedGroups.has(group.key)}
                        onToggle={() => toggleGroup(group.key)}
                        onOpen={handleOpenJD}
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <EmptyState icon={AlertTriangle} title="暂无急招岗位" description="源表「优先级」列标记 P0 / P1 后将在此展示" />
          )}
        </GlassPanel>

        {/* 加急 · ❗ 标记 — 不变 */}
        <GlassPanel>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold text-gray-800 flex items-center gap-2">
              <Flame className="w-4 h-4 text-red-600" />加急 · ❗ 标记
            </h3>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPasteOpen(true)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 text-xs font-medium transition-colors"
              >
                <ClipboardPaste className="w-3.5 h-3.5" />粘贴加急清单
              </button>
              <span className="text-xs text-gray-400">共 {expedited.length} 个</span>
            </div>
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
        <AdCopyDialog jds={selectedJDs} variant={adVariant} onClose={() => setAdVariant(null)} />
      )}

      {pasteOpen && <ExpeditedPasteDialog onClose={() => setPasteOpen(false)} />}
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

// ─── ExpeditedPasteDialog ─────────────────────────────────────────────────────

function filterExpeditedRows(rows: string[][]): string[][] {
  const header = rows[0];
  const idx = header.findIndex((h) => h.trim() === '加急');
  if (idx === -1) return [];
  const kept = rows.slice(1).filter((r) => {
    const v = (r[idx] || '').trim().toLowerCase();
    return v !== '' && !['0', '否', 'no', 'false', 'n', '-'].includes(v);
  });
  return kept.length ? [header, ...kept] : [];
}

function ExpeditedPasteDialog({ onClose }: { onClose: () => void }) {
  const [pasteText, setPasteText] = useState('');
  const [result, setResult] = useState<JDImportResult | null>(null);
  const isImporting = useJDStore((s) => s.isImporting);
  const importFromExcel = useJDStore((s) => s.importFromExcel);

  const handleImport = async () => {
    setResult(null);
    const rows = parsePastedTable(pasteText);
    if (rows.length < 2) {
      setResult({ success: 0, failed: 1, errors: ['没有可识别的加急清单，请在需求面板全选复制带 ❗ 标记的岗位再粘贴'] });
      return;
    }
    const expeditedRows = filterExpeditedRows(rows);
    if (expeditedRows.length < 2) {
      setResult({ success: 0, failed: 1, errors: ['粘贴内容里没有带 ❗ 标记的加急岗位，请确认复制的是加急清单'] });
      return;
    }
    try {
      setResult(await importFromExcel(await pastedRowsToFile(expeditedRows)));
    } catch (err) {
      setResult({ success: 0, failed: 1, errors: [(err as Error).message || '粘贴内容解析失败'] });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={isImporting ? undefined : onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-800 flex items-center gap-2">
            <Flame className="w-4 h-4 text-red-600" />粘贴加急清单
          </h3>
          {!isImporting && (
            <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600">
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
        <div className="px-5 py-4 space-y-3">
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={8}
            placeholder="在需求面板里选中加急岗位（带 ❗ 标记）整页全选 Ctrl+A，Ctrl+C 复制，然后在此处 Ctrl+V 粘贴。已存在的岗位会被点亮为加急，不会重复创建。"
            className="w-full px-4 py-3 rounded-xl bg-white border border-gray-200 text-xs font-mono leading-relaxed focus:outline-none focus:border-red-300 transition-all resize-y"
          />
          <button
            onClick={handleImport}
            disabled={!pasteText.trim() || isImporting}
            className="w-full h-10 rounded-xl bg-red-500 text-white text-sm font-medium hover:bg-red-600 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isImporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ClipboardPaste className="w-4 h-4" />}
            {isImporting ? '解析中...' : '解析并标记加急'}
          </button>
          {result && !isImporting && (
            <div className={cn('p-3 rounded-xl border text-sm', result.failed === 0 ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200')}>
              <div className="flex items-center gap-2">
                {result.failed === 0 ? <Check className="w-4 h-4 text-green-500" /> : <X className="w-4 h-4 text-amber-500" />}
                <span className="font-medium text-gray-800">导入 {result.success} 条{result.failed > 0 && `，失败 ${result.failed} 条`}</span>
              </div>
              {result.errors.length > 0 && (
                <ul className="mt-2 space-y-0.5">{result.errors.slice(0, 5).map((e, i) => <li key={i} className="text-xs text-red-500">{e}</li>)}</ul>
              )}
            </div>
          )}
        </div>
      </div>
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

interface AdSectionProps { label: string; segments: AdSegment[]; }

function AdSection({ label, segments }: AdSectionProps) {
  if (segments.length === 0) return null;
  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold text-gray-700">{label} 急招（{segments.length} 段）</h4>
      {segments.map((seg, i) => <AdSegmentCard key={i} segment={seg} />)}
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
