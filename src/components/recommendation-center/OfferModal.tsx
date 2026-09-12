'use client';

import { useState } from 'react';
import { BriefcaseBusiness, X } from 'lucide-react';
import type { Candidate } from '@/types/interview';
import type { RepushItem } from '@/store/repush-store';
import { useEscapeClose } from '@/hooks/useEscapeClose';
import { calculateOfferCommission, countEffectiveOnboards, formatCommissionAmount, isEffectiveOnboard } from '@/lib/offer-compensation';

export interface OfferFormValues {
  probationSalary: string;
  regularSalary: string;
  onboardDate: string;
}

interface OfferModalProps {
  item: RepushItem;
  candidate?: Candidate;
  candidates: Candidate[];
  onClose: () => void;
  onConfirm: (values: OfferFormValues) => void;
}

export function OfferModal({ item, candidate, candidates, onClose, onConfirm }: OfferModalProps) {
  const [form, setForm] = useState<OfferFormValues>({
    probationSalary: candidate?.probationSalary || '',
    regularSalary: candidate?.regularSalary || '',
    onboardDate: candidate?.onboardDate?.slice(0, 10) || '',
  });

  useEscapeClose(onClose, true);

  const patch = (partial: Partial<OfferFormValues>) => setForm((current) => ({ ...current, ...partial }));
  const onboardIso = form.onboardDate ? new Date(form.onboardDate).toISOString() : undefined;
  const currentCount = countEffectiveOnboards(candidates, onboardIso, item.column);
  const candidateAlreadyCounted = Boolean(
    candidate
    && isEffectiveOnboard(candidate)
    && candidate.onboardDate?.slice(0, 7) === onboardIso?.slice(0, 7),
  );
  const projectedCount = currentCount + (onboardIso && !candidateAlreadyCounted ? 1 : 0);
  const commission = calculateOfferCommission({
    regularSalary: form.regularSalary,
    jobTitle: item.jdTitle || candidate?.jdTitle || '',
    onboardCount: projectedCount,
    hasOnboardDate: Boolean(onboardIso),
  });
  const canConfirm = Boolean(form.probationSalary.trim() && form.regularSalary.trim() && commission);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button className="fixed inset-0 bg-black/20" onClick={onClose} aria-label="关闭" />
      <div className="relative w-full max-w-lg rounded-2xl border border-gray-200 bg-white p-6 shadow-xl animate-fade-in">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-800">
              <BriefcaseBusiness className="h-5 w-5 text-emerald-500" />记录 Offer
            </h3>
            <p className="mt-1 text-sm text-gray-500">{item.candidateName || item.fileName} · {item.jdTitle || '未填写岗位'}</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100" title="关闭">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="试用期薪资">
            <input value={form.probationSalary} onChange={(event) => patch({ probationSalary: event.target.value })} placeholder="如 28K" className={inputClass} />
          </Field>
          <Field label="转正薪资">
            <input value={form.regularSalary} onChange={(event) => patch({ regularSalary: event.target.value })} placeholder="如 30000 或 30K" className={inputClass} />
          </Field>
        </div>

        <div className="mt-4">
          <Field label="入职日期（可选）">
            <input
              type="date"
              value={form.onboardDate}
              onChange={(event) => patch({ onboardDate: event.target.value })}
              className={inputClass}
            />
          </Field>
        </div>

        <div className="mt-4 rounded-xl border border-emerald-100 bg-emerald-50/70 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-medium text-emerald-700">新提成制度自动核算</span>
            {commission ? (
              <span className="text-lg font-bold tabular-nums text-emerald-700">
                {commission.eligible ? `¥${formatCommissionAmount(commission.commissionAmount)}` : '暂不计提'}
              </span>
            ) : (
              <span className="text-xs text-gray-400">填写转正薪资后核算</span>
            )}
          </div>
          {commission && (
            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-600 sm:grid-cols-4">
              <span>{commission.jobCategory}</span>
              <span>{commission.salaryTier}</span>
              <span>难度系数 {commission.difficultyCoefficient}</span>
              <span>{onboardIso ? `本月 ${projectedCount} 人 · ${commission.commissionRate * 100}%` : '待填写入职日期'}</span>
            </div>
          )}
          {commission?.eligible && (
            <p className="mt-2 text-[11px] text-emerald-700/80">
              满 3 个月后按 70% / 20% / 10% 分三个月发放，单人封顶 ¥8,000。
            </p>
          )}
          {commission?.status === 'below-minimum' && (
            <p className="mt-2 text-[11px] text-amber-700">本月有效入职不足 3 人，达到门槛后会自动联动重算。</p>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="h-10 rounded-xl px-4 text-sm font-medium text-gray-500 hover:bg-gray-100">取消</button>
          <button disabled={!canConfirm} onClick={() => onConfirm(form)} className="h-10 rounded-xl bg-emerald-500 px-5 text-sm font-medium text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400">确认 Offer</button>
        </div>
      </div>
    </div>
  );
}

const inputClass = 'h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm outline-none focus:border-emerald-300 focus:ring-2 focus:ring-emerald-50';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-gray-500">{label}</span>
      {children}
    </label>
  );
}
