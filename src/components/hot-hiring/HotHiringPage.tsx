'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  AlertTriangle, Megaphone, X, Copy, Check,
  ChevronDown, ChevronUp, Bell, Sparkles,
} from 'lucide-react';
import { useJDStore } from '@/store/jd-store';
import type { JDCategory } from '@/types/jd';
import { recentlyAddedJds } from '@/lib/jd-recent';
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
  buildAdCopy, buildDesensitizedCopy, renumberDesensitizedText, adVariantLabel, getCategoryEmoji,
  type AdSegment, type AdVariant,
} from '@/lib/ad-copy';
import { cn } from '@/lib/utils';
import { useEscapeClose } from '@/hooks/useEscapeClose';

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

const SMART_ROTATION_STORAGE_KEY = 'recruit:hot-hiring-smart-rotation-v1';

interface SmartRotationRecord {
  date: string;
  maimanfen: string[];
  bobo: string[];
  reasons: string[];
  variant?: number;
}

function shanghaiDateKey(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function readSmartRotationHistory(): SmartRotationRecord[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(SMART_ROTATION_STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((item) => item?.date && Array.isArray(item.maimanfen) && Array.isArray(item.bobo)) : [];
  } catch {
    return [];
  }
}

function saveSmartRotationRecord(record: SmartRotationRecord): void {
  const next = [...readSmartRotationHistory().filter((item) => item.date !== record.date), record]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-3);
  localStorage.setItem(SMART_ROTATION_STORAGE_KEY, JSON.stringify(next));
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
  const [adDialog, setAdDialog] = useState<{ jds: JD[]; label: string; variant: AdVariant } | null>(null);
  const [smartDialog, setSmartDialog] = useState<{
    maimanfen: JD[];
    bobo: JD[];
    reasons: string[];
  } | null>(null);
  const [smartLoading, setSmartLoading] = useState(false);
  const [smartError, setSmartError] = useState('');
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const router = useRouter();
  const jds = useJDStore((s) => s.jds);
  const selectJD = useJDStore((s) => s.selectJD);
  // 本周新增 = 最近 5 个工作日内新增（按 createdAt 滚动窗口，跨周末，与 JD 库角标一致）
  const weeklyJds = useMemo<JD[]>(
    () => recentlyAddedJds(jds).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')),
    [jds],
  );

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

  const handleSmartGenerate = async (forceNew = false) => {
    if (smartLoading) return;
    setSmartLoading(true);
    setSmartError('');
    try {
      const rotationDate = shanghaiDateKey();
      const history = readSmartRotationHistory();
      const byId = new Map(jds.map((jd) => [jd.id, jd]));
      const today = history.find((item) => item.date === rotationDate);
      if (today && !forceNew) {
        const maimanfen = today.maimanfen.map((id) => byId.get(id)).filter((jd): jd is JD => !!jd && jd.status !== 'paused');
        const bobo = today.bobo.map((id) => byId.get(id)).filter((jd): jd is JD => !!jd && jd.status !== 'paused');
        if (maimanfen.length >= 8 && bobo.length >= 8) {
          setSmartDialog({ maimanfen, bobo, reasons: today.reasons });
          return;
        }
      }
      const recentRecords = history.filter((item) => item.date !== rotationDate).slice(-2);
      if (forceNew && today) recentRecords.push(today);
      const recentIds = Array.from(new Set(recentRecords.flatMap((item) => [...item.maimanfen, ...item.bobo])));
      const rotationVariant = forceNew ? ((today?.variant || 0) + 1) % 3 : (today?.variant || 0);
      const response = await fetch('/api/hot-hiring/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rotationDate,
          rotationVariant,
          recentIds,
          jobs: jds.map((jd) => ({
            id: jd.id,
            title: jd.title,
            categories: jd.categories,
            priority: jd.priority,
            gap: jd.gap,
            status: jd.status,
            createdAt: jd.createdAt,
            updatedAt: jd.updatedAt,
            department: jd.department,
            organization: jd.organization,
            serviceUnit: jd.serviceUnit,
            requester: jd.requester,
            salary: jd.salaryText,
          })),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || '智能选岗失败');
      const maimanfen = (Array.isArray(data.maimanfen) ? data.maimanfen : [])
        .map((id: string) => byId.get(id))
        .filter((jd: JD | undefined): jd is JD => !!jd);
      const bobo = (Array.isArray(data.bobo) ? data.bobo : [])
        .map((id: string) => byId.get(id))
        .filter((jd: JD | undefined): jd is JD => !!jd);
      if (!maimanfen.length || !bobo.length) throw new Error('没有生成可用的岗位组合');
      const reasons = Array.isArray(data.reasons) ? data.reasons.map(String) : [];
      saveSmartRotationRecord({
        date: rotationDate,
        maimanfen: maimanfen.map((jd: JD) => jd.id),
        bobo: bobo.map((jd: JD) => jd.id),
        reasons,
        variant: rotationVariant,
      });
      setSmartDialog({
        maimanfen,
        bobo,
        reasons,
      });
    } catch (error) {
      setSmartError(error instanceof Error ? error.message : '智能选岗失败，请重试');
    } finally {
      setSmartLoading(false);
    }
  };

  return (
    <div className="workspace-page max-w-7xl">
      <div>
        <h2 className="page-title">热招看板</h2>
        <p className="page-subtitle">
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
          <button
            onClick={() => handleSmartGenerate()}
            disabled={smartLoading || jds.length === 0}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed text-sm font-semibold shadow-sm transition-colors"
          >
            <Sparkles className={cn('w-4 h-4', smartLoading && 'animate-spin')} />
            {smartLoading ? 'AI 正在选岗' : '智能生成今日文案'}
          </button>
          <button
            onClick={() => setAdDialog({ jds: weeklyJds, label: '本周新增', variant: 'maimanfen' })}
            disabled={weeklyJds.length === 0}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed text-sm font-semibold shadow-sm transition-colors"
          >
            <Bell className="w-4 h-4" />本周新增文案{weeklyJds.length > 0 ? ` (${weeklyJds.length})` : ''}
          </button>
          {selectedGroups.size > 0 ? (
            <>
              <button onClick={() => setAdDialog({ jds: selectedJDs, label: '急招', variant: 'maimanfen' })} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 text-sm font-semibold transition-colors">
                <Megaphone className="w-4 h-4" />生成麦满分文案
              </button>
              <button onClick={() => setAdDialog({ jds: selectedJDs, label: '急招', variant: 'bobo' })} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 text-sm font-semibold transition-colors">
                <Megaphone className="w-4 h-4" />生成啵啵文案
              </button>
            </>
          ) : (
            <span className="text-xs text-gray-400">勾选分类后生成急招文案</span>
          )}
        </div>
      </GlassPanel>

      {smartError && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">{smartError}</div>
      )}

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

      {adDialog && (
        <AdCopyDialog jds={adDialog.jds} label={adDialog.label} initialVariant={adDialog.variant} onClose={() => setAdDialog(null)} />
      )}
      {smartDialog && (
        <SmartAdDialog
          maimanfen={smartDialog.maimanfen}
          bobo={smartDialog.bobo}
          reasons={smartDialog.reasons}
          regenerating={smartLoading}
          onRegenerate={() => handleSmartGenerate(true)}
          onClose={() => setSmartDialog(null)}
        />
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

interface SmartAdDialogProps {
  maimanfen: JD[];
  bobo: JD[];
  reasons: string[];
  regenerating: boolean;
  onRegenerate: () => void;
  onClose: () => void;
}

function SmartAdDialog({ maimanfen, bobo, reasons, regenerating, onRegenerate, onClose }: SmartAdDialogProps) {
  const [variant, setVariant] = useState<AdVariant>('maimanfen');
  const [hideSalary, setHideSalary] = useState(true);
  useEscapeClose(onClose);
  const currentJds = variant === 'maimanfen' ? maimanfen : bobo;
  const [segments, setSegments] = useState<AdSegment[]>(() => [buildDesensitizedCopy(maimanfen)]);
  useEffect(() => {
    setSegments(
      hideSalary
        ? [buildDesensitizedCopy(currentJds)]
        : buildAdCopy(currentJds, '今日智能推荐', variant, 9999),
    );
  }, [bobo, currentJds, hideSalary, maimanfen, variant]);
  const boboIds = useMemo(() => new Set(bobo.map((jd) => jd.id)), [bobo]);
  const overlap = maimanfen.filter((jd) => boboIds.has(jd.id)).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="今日智能招聘文案">
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-5 py-4">
          <div>
            <h3 className="flex items-center gap-2 text-base font-semibold text-gray-900">
              <Sparkles className="h-5 w-5 text-indigo-500" />今日智能选岗
            </h3>
            <p className="mt-1 text-xs text-gray-400">
              麦满分 {maimanfen.length} 个 · 啵啵 {bobo.length} 个 · 共同岗位 {overlap} 个
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onRegenerate}
              disabled={regenerating}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 text-sm font-medium text-indigo-600 transition-colors hover:bg-indigo-100 disabled:cursor-wait disabled:opacity-60"
            >
              <Sparkles className={cn('h-4 w-4', regenerating && 'animate-spin')} />
              {regenerating ? '正在换一版' : '换一版'}
            </button>
            <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600" aria-label="关闭">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        <div className="border-b border-gray-100 bg-gray-50/60 px-5 py-3">
          <div className="flex overflow-hidden rounded-lg border border-gray-200 bg-white text-sm">
            {(['maimanfen', 'bobo'] as AdVariant[]).map((item) => (
              <button
                type="button"
                key={item}
                onClick={() => {
                  setVariant(item);
                  setHideSalary(item === 'maimanfen');
                }}
                className={cn(
                  'h-9 flex-1 font-medium transition-colors',
                  variant === item ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-indigo-50',
                )}
              >
                {adVariantLabel(item)}版 · {item === 'maimanfen' ? maimanfen.length : bobo.length} 个岗位
              </button>
            ))}
          </div>
          <div className="mt-2 flex justify-end gap-1">
            <button
              type="button"
              onClick={() => setHideSalary(false)}
              className={cn('rounded-md px-2.5 py-1 text-xs font-medium', !hideSalary ? 'bg-gray-700 text-white' : 'text-gray-500 hover:bg-gray-100')}
            >常规</button>
            <button
              type="button"
              onClick={() => setHideSalary(true)}
              className={cn('rounded-md px-2.5 py-1 text-xs font-medium', hideSalary ? 'bg-gray-700 text-white' : 'text-gray-500 hover:bg-gray-100')}
            >脱敏</button>
          </div>
          {reasons.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
              {reasons.map((reason) => <span key={reason}>· {reason}</span>)}
            </div>
          )}
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {segments.map((segment, index) => (
            <AdSegmentCard
              key={`${variant}-${hideSalary ? 'd' : 'n'}-${index}`}
              segment={segment}
              editable={hideSalary}
              onChange={(next) => {
                setSegments((current) => current.map((item, itemIndex) => (itemIndex === index ? next : item)));
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
interface AdCopyDialogProps {
  jds: JD[];
  label: string;
  initialVariant: AdVariant;
  onClose: () => void;
}

function AdCopyDialog({ jds, label, initialVariant, onClose }: AdCopyDialogProps) {
  const [variant, setVariant] = useState<AdVariant>(initialVariant);
  const [hideSalary, setHideSalary] = useState(initialVariant === 'maimanfen');
  const [generatedSegments, setGeneratedSegments] = useState<AdSegment[]>([]);
  const [generatedSig, setGeneratedSig] = useState('');
  useEscapeClose(onClose);

  // P0 排前、P1 排后。文案默认包含全部岗位（不再逐条勾选排除）
  const sortedAll = useMemo<JD[]>(
    () => [
      ...jds.filter((j) => j.priority === 'P0'),
      ...jds.filter((j) => j.priority === 'P1'),
      ...jds.filter((j) => j.priority !== 'P0' && j.priority !== 'P1'),
    ],
    [jds],
  );
  const selectedJds = sortedAll;

  const currentSig = useMemo(
    () => `${hideSalary ? 'd' : 'n'}|${variant}|${selectedJds.map((j) => j.id).join(',')}`,
    [hideSalary, variant, selectedJds],
  );
  const isDirty = generatedSig !== currentSig;

  const buildSegments = (): AdSegment[] => {
    if (!selectedJds.length) return [];
    // 脱敏：编号列表模板（无分类/薪资）；常规：按风格生成
    return hideSalary ? [buildDesensitizedCopy(selectedJds)] : buildAdCopy(selectedJds, label, variant, 9999);
  };

  const handleGenerate = () => {
    setGeneratedSegments(buildSegments());
    setGeneratedSig(currentSig);
  };

  // 打开弹窗时先按全部岗位生成一版，用户删减后再点「重新生成」
  useEffect(() => {
    const segs = sortedAll.length
      ? (hideSalary ? [buildDesensitizedCopy(sortedAll)] : buildAdCopy(sortedAll, label, variant, 9999))
      : [];
    setGeneratedSegments(segs);
    setGeneratedSig(`${hideSalary ? 'd' : 'n'}|${variant}|${sortedAll.map((j) => j.id).join(',')}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-800 flex items-center gap-2">
            <Megaphone className="w-4 h-4 text-red-500" />{label}招聘文案 · {adVariantLabel(variant)}版
          </h3>
          <div className="flex items-center gap-1.5">
            {/* 常规 / 脱敏 */}
            <button
              onClick={() => setHideSalary(false)}
              className={cn('px-3 h-7 rounded-lg text-xs font-medium transition-all', !hideSalary ? 'bg-gray-700 text-white' : 'border border-gray-200 text-gray-600 hover:bg-gray-50')}
            >常规</button>
            <button
              onClick={() => setHideSalary(true)}
              className={cn('px-3 h-7 rounded-lg text-xs font-medium transition-all', hideSalary ? 'bg-gray-700 text-white' : 'border border-gray-200 text-gray-600 hover:bg-gray-50')}
            >脱敏</button>
            {/* 麦满分 / 啵啵 — 脱敏模式下隐藏（模板固定） */}
            {!hideSalary && (
              <>
                <div className="w-px h-4 bg-gray-200 mx-0.5" />
                {(['maimanfen', 'bobo'] as AdVariant[]).map((v) => (
                  <button
                    key={v}
                    onClick={() => setVariant(v)}
                    className={cn(
                      'px-3 h-7 rounded-lg text-xs font-medium transition-all',
                      variant === v ? 'bg-red-500 text-white' : 'border border-gray-200 text-gray-600 hover:bg-gray-50',
                    )}
                  >
                    {adVariantLabel(v)}版
                  </button>
                ))}
              </>
            )}
            <button onClick={onClose} className="p-1 ml-1 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
        <div className="overflow-y-auto px-5 py-4 space-y-4">
          {sortedAll.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-6">本周暂无新增岗位，或请先勾选至少一个分类</p>
          )}

          {/* 生成按钮：切换风格/脱敏后高亮提示重新生成 */}
          <button
            onClick={handleGenerate}
            disabled={selectedJds.length === 0}
            className={cn(
              'w-full flex items-center justify-center gap-1.5 h-10 rounded-xl text-sm font-semibold transition-all',
              selectedJds.length === 0
                ? 'bg-gray-100 text-gray-300 cursor-not-allowed'
                : isDirty
                  ? 'bg-red-500 text-white hover:bg-red-600'
                  : 'border border-gray-200 text-gray-600 hover:bg-gray-50',
            )}
          >
            <Sparkles className="w-4 h-4" />
            {generatedSegments.length === 0 ? '生成文案' : isDirty ? '重新生成（已改动）' : '已是最新'}
          </button>

          {/* 生成结果 */}
          {generatedSegments.length > 0
            ? generatedSegments.map((seg, i) => (
              <AdSegmentCard
                key={i}
                segment={seg}
                editable={hideSalary}
                onChange={(next) => {
                  setGeneratedSegments((prev) => prev.map((item, idx) => (idx === i ? next : item)));
                }}
              />
            ))
            : <p className="text-sm text-gray-400 text-center py-6">点上方「生成文案」出结果</p>
          }
        </div>
      </div>
    </div>
  );
}


function AdSegmentCard({
  segment,
  editable = false,
  onChange,
}: {
  segment: AdSegment;
  editable?: boolean;
  onChange?: (segment: AdSegment) => void;
}) {
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

  const handleTextChange = (text: string) => {
    onChange?.({ ...segment, text });
  };

  const handleRenumber = () => {
    const next = renumberDesensitizedText(segment.text);
    onChange?.({
      ...segment,
      text: next.text,
      count: next.count || segment.count,
    });
  };

  return (
    <div className="rounded-xl border border-gray-200 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-100">
        <span className="text-xs font-medium text-gray-500">{segment.title} · {segment.count} 个岗位</span>
        <div className="flex items-center gap-1">
          {editable && (
            <button
              onClick={handleRenumber}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium text-gray-600 hover:bg-gray-100"
            >
              <Sparkles className="w-3.5 h-3.5" />
              重新编号
            </button>
          )}
          <button
            onClick={handleCopy}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium text-indigo-600 hover:bg-indigo-50"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? '已复制' : '复制'}
          </button>
        </div>
      </div>
      {editable ? (
        <textarea
          value={segment.text}
          onChange={(e) => handleTextChange(e.target.value)}
          className="block w-full min-h-[420px] px-3 py-3 text-xs text-gray-700 whitespace-pre-wrap font-sans leading-relaxed bg-white outline-none resize-y"
        />
      ) : (
        <pre className="px-3 py-3 text-xs text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">{segment.text}</pre>
      )}
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
