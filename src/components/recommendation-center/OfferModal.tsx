'use client';

import { useState } from 'react';
import { BriefcaseBusiness, X } from 'lucide-react';
import type { Candidate } from '@/types/interview';
import type { OfferJobLevel } from '@/types/interview';
import type { RepushItem } from '@/store/repush-store';
import { useEscapeClose } from '@/hooks/useEscapeClose';
import { getOfferGrade } from '@/lib/offer-compensation';

export interface OfferFormValues {
  onboardDate: string;
  score: string;
  interviewer: string;
  probationSalary: string;
  regularSalary: string;
  probationMonths: string;
  jobLevel: OfferJobLevel | '';
}

interface OfferModalProps {
  item: RepushItem;
  candidate?: Candidate;
  onClose: () => void;
  onConfirm: (values: OfferFormValues) => void;
}

function dateInputValue(iso?: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function OfferModal({ item, candidate, onClose, onConfirm }: OfferModalProps) {
  const initialGrade = getOfferGrade(candidate?.regularSalary);
  const [form, setForm] = useState<OfferFormValues>({
    onboardDate: dateInputValue(candidate?.onboardDate),
    score: candidate?.score ? String(candidate.score) : initialGrade ? String(initialGrade.score) : '',
    interviewer: candidate?.interviewer || '',
    probationSalary: candidate?.probationSalary || '',
    regularSalary: candidate?.regularSalary || '',
    probationMonths: candidate?.probationMonths || '',
    jobLevel: candidate?.jobLevel || initialGrade?.level || '',
  });

  useEscapeClose(onClose, true);

  const patch = (partial: Partial<OfferFormValues>) => setForm((current) => ({ ...current, ...partial }));
  const updateRegularSalary = (regularSalary: string) => {
    const grade = getOfferGrade(regularSalary);
    patch({
      regularSalary,
      ...(grade ? { jobLevel: grade.level, score: String(grade.score) } : {}),
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button className="fixed inset-0 bg-black/20" onClick={onClose} aria-label="关闭" />
      <div className="relative w-full max-w-xl rounded-2xl border border-gray-200 bg-white p-6 shadow-xl animate-fade-in">
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
          <Field label="入职时间">
            <input type="date" value={form.onboardDate} onChange={(event) => patch({ onboardDate: event.target.value })} className={inputClass} />
          </Field>
          <Field label="分数（按转正薪资自动计算）">
            <input type="number" min="0" step="0.1" value={form.score} onChange={(event) => patch({ score: event.target.value })} placeholder="如 3.5" className={inputClass} />
          </Field>
          <Field label="岗位等级">
            <select value={form.jobLevel} onChange={(event) => patch({ jobLevel: event.target.value as OfferJobLevel | '' })} className={inputClass}>
              <option value="">请选择</option>
              {(['初级', '一级', '二级', '三级', '四级', '五级'] as OfferJobLevel[]).map((level) => <option key={level} value={level}>{level}</option>)}
            </select>
          </Field>
          <Field label="面试官（选填）">
            <input value={form.interviewer} onChange={(event) => patch({ interviewer: event.target.value })} placeholder="面试官姓名" className={inputClass} />
          </Field>
          <Field label="编制">
            <input value={item.organization || '未填写'} readOnly className={`${inputClass} bg-gray-50 text-gray-500`} />
          </Field>
          <Field label="部门">
            <input value={item.department || '未填写'} readOnly className={`${inputClass} bg-gray-50 text-gray-500`} />
          </Field>
          <Field label="试用期薪资">
            <input value={form.probationSalary} onChange={(event) => patch({ probationSalary: event.target.value })} placeholder="如 28K" className={inputClass} />
          </Field>
          <Field label="转正薪资">
            <input value={form.regularSalary} onChange={(event) => updateRegularSalary(event.target.value)} placeholder="如 30000 或 30K" className={inputClass} />
          </Field>
          <Field label="试用期（月）">
            <input type="number" min="0" step="1" value={form.probationMonths} onChange={(event) => patch({ probationMonths: event.target.value })} placeholder="如 2" className={inputClass} />
          </Field>
        </div>

        <p className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-700">
          转正月薪会按附表自动带出等级与分数，仍可按实际情况手动调整。
        </p>

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="h-10 rounded-xl px-4 text-sm font-medium text-gray-500 hover:bg-gray-100">取消</button>
          <button onClick={() => onConfirm(form)} className="h-10 rounded-xl bg-emerald-500 px-5 text-sm font-medium text-white hover:bg-emerald-600">确认 Offer</button>
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
