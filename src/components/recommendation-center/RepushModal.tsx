'use client';

import { useMemo, useState } from 'react';
import { Check, Copy, FileText, Repeat, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { JD } from '@/types/jd';
import type { RepushItem } from '@/store/repush-store';
import { displayName } from '@/lib/repush-format';
import { useEscapeClose } from '@/hooks/useEscapeClose';
import { buildRecommendationText, recommendationOrganization } from '@/lib/recommendation-copy';

export interface RepushArgs {
  jdTitle: string;
  organization: string;
  department: string;
  contactPerson: string;
  recommendationText: string;
}

interface RepushModalProps {
  item: RepushItem;
  existingItems: RepushItem[];
  jds: JD[];
  onClose: () => void;
  onConfirm: (args: RepushArgs) => void;
}

function clean(value?: string): string {
  return String(value || '').trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readLabeledValue(text: string, labels: string[]): string {
  for (const label of labels) {
    const match = text.match(new RegExp(`${escapeRegExp(label)}[^\\n:：]*[:：][ \\t\\u3000]*([^\\n]*)`, 'i'));
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return '';
}

function targetKey(title?: string, organization?: string, department?: string): string {
  return [title, organization, department].map((value) => clean(value).toLowerCase()).join('|');
}

function isSameCandidate(a: RepushItem, b: RepushItem): boolean {
  if (a.column !== b.column) return false;
  if (a.candidateCode && b.candidateCode) return clean(a.candidateCode).toLowerCase() === clean(b.candidateCode).toLowerCase();
  return clean(a.candidateName || displayName(a)).toLowerCase() === clean(b.candidateName || displayName(b)).toLowerCase();
}

function buildRepushCopy(item: RepushItem, jd: JD): string {
  const rawText = item.rawText || '';
  const candidateName = clean(item.candidateName || readLabeledValue(rawText, ['候选人姓名', '候选姓名', '姓名']) || displayName(item).split('-')[0]);
  return buildRecommendationText(item.column, jd, {
    candidateCode: clean(item.candidateCode),
    candidateName,
    workYears: readLabeledValue(rawText, ['工作年限', '工作经验年限', '工作经验']),
    currentSalary: readLabeledValue(rawText, ['当前薪资', '目前薪资', '现薪资', '现薪']),
    expectedSalary: readLabeledValue(rawText, ['期望薪资', '薪资期望', '期望月薪']),
    location: readLabeledValue(rawText, ['目前所在地', '当前所在地', '现居地', '所在地', '现居']),
    arrivalTime: readLabeledValue(rawText, ['预计可到岗时间', '可到岗时间', '到岗时间', '最快到岗时间']),
    contact: clean(item.contact) || readLabeledValue(rawText, ['候选人联系方式', '联系方式']),
    resumeSource: readLabeledValue(rawText, ['简历来源']) || '简历储备',
  });
}

/** 在推荐中心直接选择一个具体 JD、生成文案并建立复推记录。 */
export function RepushModal({ item, existingItems, jds, onClose, onConfirm }: RepushModalProps) {
  const [query, setQuery] = useState('');
  const [selectedJdId, setSelectedJdId] = useState('');
  const [copied, setCopied] = useState(false);
  useEscapeClose(onClose);

  const recommendedTargets = useMemo(() => {
    const targets = new Set<string>();
    for (const existing of existingItems) {
      if (isSameCandidate(item, existing)) {
        targets.add(targetKey(existing.jdTitle, existing.organization, existing.department));
      }
    }
    return targets;
  }, [existingItems, item]);

  const matchingJds = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return jds
      .filter((jd) => jd.status !== 'paused')
      .filter((jd) => {
        if (!keyword) return true;
        return [jd.title, jd.organization, jd.serviceUnit, jd.department, jd.odc]
          .some((value) => clean(value).toLowerCase().includes(keyword));
      })
      .sort((a, b) => {
        const aUsed = recommendedTargets.has(targetKey(a.title, recommendationOrganization(a), a.department));
        const bUsed = recommendedTargets.has(targetKey(b.title, recommendationOrganization(b), b.department));
        if (aUsed !== bUsed) return aUsed ? 1 : -1;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      })
      .slice(0, 12);
  }, [jds, query, recommendedTargets]);

  const selectedJd = jds.find((jd) => jd.id === selectedJdId) || null;
  const recommendationText = selectedJd ? buildRepushCopy(item, selectedJd) : '';

  const handleCopy = async () => {
    if (!recommendationText) return;
    await navigator.clipboard.writeText(recommendationText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const handleConfirm = () => {
    if (!selectedJd) return;
    onConfirm({
      jdTitle: selectedJd.title,
      organization: recommendationOrganization(selectedJd),
      department: clean(selectedJd.department),
      contactPerson: clean(selectedJd.odc),
      recommendationText,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 p-4" role="dialog" aria-modal="true" aria-label="指定岗位复推">
      <div className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h3 className="flex items-center gap-2 text-base font-semibold text-slate-900">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-50 text-violet-600"><Repeat className="h-4 w-4" /></span>
              指定岗位复推
            </h3>
            <p className="mt-1 pl-10 text-xs text-slate-400">
              {displayName(item)} · 选择具体岗位后自动生成对应推荐文案
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600" title="关闭"><X className="h-5 w-5" /></button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[360px_minmax(0,1fr)]">
          <div className="flex min-h-[360px] flex-col border-b border-slate-100 bg-slate-50/60 p-4 md:min-h-0 md:border-b-0 md:border-r">
            <label className="mb-2 text-xs font-medium text-slate-500">搜索目标岗位、编制或部门</label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="如 Go、技术中心、紫宸星宇"
                className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
              />
            </div>
            <div className="mt-3 min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
              {matchingJds.map((jd) => {
                const organization = recommendationOrganization(jd);
                const alreadyRecommended = recommendedTargets.has(targetKey(jd.title, organization, jd.department));
                const active = selectedJdId === jd.id;
                return (
                  <button
                    type="button"
                    key={jd.id}
                    onClick={() => { setSelectedJdId(jd.id); setCopied(false); }}
                    className={cn(
                      'w-full rounded-lg border px-3 py-2.5 text-left transition-colors',
                      active ? 'border-violet-300 bg-white shadow-sm ring-2 ring-violet-100' : 'border-transparent bg-white/70 hover:border-slate-200 hover:bg-white',
                    )}
                  >
                    <span className="flex items-start justify-between gap-2">
                      <span className="line-clamp-2 text-sm font-medium text-slate-800">{jd.title}</span>
                      {alreadyRecommended && <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">已推荐</span>}
                    </span>
                    <span className="mt-1 block truncate text-xs text-slate-400">{organization || '未填写编制/单位'}{jd.department ? ` · ${jd.department}` : ''}</span>
                    <span className="mt-1 block text-[11px] text-emerald-600">{jd.salaryText || `${jd.salaryRange.min || 0}-${jd.salaryRange.max || 0}${jd.salaryRange.currency || ''}`}</span>
                  </button>
                );
              })}
              {matchingJds.length === 0 && <p className="py-10 text-center text-sm text-slate-400">没有找到相关岗位</p>}
            </div>
          </div>

          <div className="flex min-h-[380px] flex-col p-5 md:min-h-0">
            {selectedJd ? (
              <>
                <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-xs font-medium text-violet-600"><FileText className="h-4 w-4" />已生成推荐文案</p>
                    <h4 className="mt-1 truncate text-base font-semibold text-slate-900">{selectedJd.title}</h4>
                    <p className="mt-1 text-xs text-slate-400">{recommendationOrganization(selectedJd) || '未填写编制/单位'}{selectedJd.department ? ` · ${selectedJd.department}` : ''}</p>
                  </div>
                  <button type="button" onClick={handleCopy} className={cn('inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium', copied ? 'bg-emerald-50 text-emerald-600' : 'bg-violet-50 text-violet-600 hover:bg-violet-100')}>
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied ? '已复制' : '复制文案'}
                  </button>
                </div>
                <textarea readOnly value={recommendationText} onFocus={(event) => event.currentTarget.select()} className="min-h-[300px] flex-1 resize-none rounded-lg border border-slate-200 bg-slate-50/60 p-4 text-sm leading-7 text-slate-700 outline-none focus:border-violet-300 focus:bg-white focus:ring-2 focus:ring-violet-100" />
              </>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center text-center text-slate-400">
                <FileText className="mb-3 h-9 w-9 text-slate-300" />
                <p className="text-sm font-medium text-slate-500">先从左侧选择一个具体岗位</p>
                <p className="mt-1 text-xs">系统会自动带入目标编制、服务单位和对接 BP</p>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-4">
          <p className="text-xs text-slate-400">确认后会新增一条复推记录，原推荐记录保持不变。</p>
          <div className="flex shrink-0 gap-2">
            <button type="button" onClick={onClose} className="h-10 rounded-lg px-4 text-sm font-medium text-slate-500 hover:bg-slate-100">取消</button>
            <button type="button" onClick={handleConfirm} disabled={!selectedJd} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-violet-600 px-4 text-sm font-medium text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-slate-200">
              <Repeat className="h-4 w-4" />确认复推
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
