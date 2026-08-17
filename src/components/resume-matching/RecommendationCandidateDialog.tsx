'use client';

import { useState } from 'react';
import { FileText, Hash, Sparkles, X } from 'lucide-react';
import { useEscapeClose } from '@/hooks/useEscapeClose';

interface RecommendationCandidateDialogProps {
  jobCount: number;
  initialCandidateText: string;
  initialCodeSuffix: string;
  onClose: () => void;
  onGenerate: (candidateText: string, codeSuffix: string) => void;
}

const CANDIDATE_PLACEHOLDER = `候选人姓名（英文名）：Austin
应聘岗位：Go+AI工程化开发工程师
工作年限：9年
当前薪资：无
期望薪资：28k+
目前所在地：马来
预计可到岗时间：即可
面试是否接受开视频（主要为了验证真人和避免AI辅助面试）：接受`;

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '').slice(0, 3);
}

export function RecommendationCandidateDialog({
  jobCount,
  initialCandidateText,
  initialCodeSuffix,
  onClose,
  onGenerate,
}: RecommendationCandidateDialogProps) {
  const [candidateText, setCandidateText] = useState(initialCandidateText);
  const [codeSuffix, setCodeSuffix] = useState(initialCodeSuffix);
  useEscapeClose(onClose);

  const paddedSuffix = codeSuffix ? codeSuffix.padStart(3, '0') : '---';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="填写候选人推荐信息"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h3 className="flex items-center gap-2 text-base font-semibold text-slate-900">
              <FileText className="h-5 w-5 text-indigo-500" />填写候选人信息
              <span className="rounded-md bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-600">{jobCount} 个岗位</span>
            </h3>
            <p className="mt-1 text-xs text-slate-400">岗位、编制组织和对接 BP 使用已勾选的岗位信息。</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="关闭">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 p-5">
          <div>
            <label htmlFor="candidate-code-suffix" className="mb-2 flex items-center gap-1.5 text-sm font-medium text-slate-700">
              <Hash className="h-4 w-4 text-indigo-500" />候选人编号
            </label>
            <div className="flex h-11 max-w-sm items-center overflow-hidden rounded-lg border border-slate-200 bg-white focus-within:border-indigo-300 focus-within:ring-2 focus-within:ring-indigo-100">
              <span className="flex h-full items-center border-r border-slate-200 bg-slate-50 px-3 font-mono text-sm text-slate-500">XYMMF00</span>
              <input
                id="candidate-code-suffix"
                value={codeSuffix}
                onChange={(event) => setCodeSuffix(digitsOnly(event.target.value))}
                inputMode="numeric"
                maxLength={3}
                placeholder="062"
                className="h-full min-w-0 flex-1 px-3 font-mono text-sm text-slate-900 outline-none"
              />
              <span className="pr-3 text-xs text-slate-400">生成：XYMMF00{paddedSuffix}</span>
            </div>
          </div>

          <div>
            <label htmlFor="candidate-recommendation-info" className="mb-2 block text-sm font-medium text-slate-700">候选人信息</label>
            <textarea
              id="candidate-recommendation-info"
              value={candidateText}
              onChange={(event) => setCandidateText(event.target.value)}
              placeholder={CANDIDATE_PLACEHOLDER}
              className="h-64 w-full resize-none rounded-lg border border-slate-200 bg-slate-50/60 p-4 text-sm leading-7 text-slate-700 outline-none focus:border-indigo-300 focus:bg-white focus:ring-2 focus:ring-indigo-100"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-4">
          <button type="button" onClick={onClose} className="h-10 rounded-lg px-4 text-sm font-medium text-slate-500 hover:bg-slate-100">取消</button>
          <button
            type="button"
            onClick={() => onGenerate(candidateText.trim(), codeSuffix)}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-700"
          >
            <Sparkles className="h-4 w-4" />生成 {jobCount} 份推荐文案
          </button>
        </div>
      </div>
    </div>
  );
}
