'use client';

import { useState } from 'react';
import { BriefcaseBusiness, X } from 'lucide-react';
import type { Candidate } from '@/types/interview';
import type { RepushItem } from '@/store/repush-store';
import { useEscapeClose } from '@/hooks/useEscapeClose';
import { getOfferGrade } from '@/lib/offer-compensation';

export interface OfferFormValues {
  probationSalary: string;
  regularSalary: string;
}

interface OfferModalProps {
  item: RepushItem;
  candidate?: Candidate;
  onClose: () => void;
  onConfirm: (values: OfferFormValues) => void;
}

export function OfferModal({ item, candidate, onClose, onConfirm }: OfferModalProps) {
  const [form, setForm] = useState<OfferFormValues>({
    probationSalary: candidate?.probationSalary || '',
    regularSalary: candidate?.regularSalary || '',
  });

  useEscapeClose(onClose, true);

  const patch = (partial: Partial<OfferFormValues>) => setForm((current) => ({ ...current, ...partial }));
  const grade = getOfferGrade(form.regularSalary);
  const canConfirm = Boolean(form.probationSalary.trim() && form.regularSalary.trim() && grade);

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

        <div className="mt-4 flex items-center justify-between rounded-xl border border-emerald-100 bg-emerald-50/70 px-4 py-3">
          <span className="text-xs font-medium text-emerald-700">转正薪资自动匹配</span>
          {grade ? (
            <span className="flex items-baseline gap-2 text-emerald-700">
              <span className="text-sm font-semibold">{grade.level}</span>
              <span className="text-lg font-bold tabular-nums">{grade.score}<span className="ml-0.5 text-xs font-medium">分</span></span>
            </span>
          ) : (
            <span className="text-xs text-gray-400">填写后显示等级和分数</span>
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
