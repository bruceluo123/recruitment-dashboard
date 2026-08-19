'use client';

import { useRef, useState } from 'react';
import { ChevronDown, FileCheck2, FileSearch, FileText, Hash, Sparkles, UploadCloud, X } from 'lucide-react';
import { useEscapeClose } from '@/hooks/useEscapeClose';

interface RecommendationCandidateDialogProps {
  jobCount: number;
  codePrefix: string;
  initialCandidateText: string;
  initialCodeSuffix: string;
  initialResumeFile: File | null;
  initialResumeSource: string;
  onClose: () => void;
  onGenerate: (candidateText: string, codeSuffix: string, resumeFile: File | null, resumeSource: string) => void;
}

const RESUME_SOURCE_OPTIONS = [
  'boss',
  'LinkedIn',
  'TG 私聊',
  'TG 群',
  'Indeed',
  '小红书',
  '猎聘',
  '脉脉',
  '内推',
  '个人资源',
  '简历储备',
  '社群',
];

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
  codePrefix,
  initialCandidateText,
  initialCodeSuffix,
  initialResumeFile,
  initialResumeSource,
  onClose,
  onGenerate,
}: RecommendationCandidateDialogProps) {
  const [candidateText, setCandidateText] = useState(initialCandidateText);
  const [codeSuffix, setCodeSuffix] = useState(initialCodeSuffix);
  const [resumeFile, setResumeFile] = useState<File | null>(initialResumeFile);
  const [resumeSource, setResumeSource] = useState(
    RESUME_SOURCE_OPTIONS.includes(initialResumeSource) ? initialResumeSource : 'boss',
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  useEscapeClose(onClose);

  const paddedSuffix = codeSuffix ? codeSuffix.padStart(3, '0') : '---';
  const candidatePlaceholder = codePrefix === 'XYBB00'
    ? CANDIDATE_PLACEHOLDER.replace('候选人姓名（英文名）', '候选人姓名')
    : CANDIDATE_PLACEHOLDER;

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
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
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

        <div className="space-y-5 overflow-y-auto p-5">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div>
            <label htmlFor="candidate-code-suffix" className="mb-2 flex items-center gap-1.5 text-sm font-medium text-slate-700">
              <Hash className="h-4 w-4 text-indigo-500" />候选人编号
            </label>
            <div className="flex h-11 items-center overflow-hidden rounded-lg border border-slate-200 bg-white focus-within:border-indigo-300 focus-within:ring-2 focus-within:ring-indigo-100">
              <span className="flex h-full items-center border-r border-slate-200 bg-slate-50 px-3 font-mono text-sm text-slate-500">{codePrefix}</span>
              <input
                id="candidate-code-suffix"
                value={codeSuffix}
                onChange={(event) => setCodeSuffix(digitsOnly(event.target.value))}
                inputMode="numeric"
                maxLength={3}
                placeholder="062"
                className="h-full min-w-0 flex-1 px-3 font-mono text-sm text-slate-900 outline-none"
              />
              <span className="pr-3 text-xs text-slate-400">生成：{codePrefix}{paddedSuffix}</span>
            </div>
            </div>

            <div>
              <span className="mb-2 flex items-center gap-1.5 text-sm font-medium text-slate-700">
                <UploadCloud className="h-4 w-4 text-indigo-500" />上传简历
              </span>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex h-11 w-full items-center gap-2 rounded-lg border border-dashed border-indigo-200 bg-indigo-50/40 px-3 text-left transition-colors hover:border-indigo-300 hover:bg-indigo-50"
              >
                {resumeFile ? <FileCheck2 className="h-4 w-4 shrink-0 text-emerald-500" /> : <UploadCloud className="h-4 w-4 shrink-0 text-indigo-500" />}
                <span className="min-w-0 flex-1 truncate text-sm text-slate-600">
                  {resumeFile?.name || '选择 PDF / DOC / DOCX'}
                </span>
                <span className="text-xs text-indigo-500">{resumeFile ? '更换' : '选择'}</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.doc,.docx"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0] || null;
                  if (file) setResumeFile(file);
                  event.target.value = '';
                }}
              />
            </div>
          </div>

          <div>
            <label htmlFor="recommendation-resume-source" className="mb-2 flex items-center gap-1.5 text-sm font-medium text-slate-700">
              <FileSearch className="h-4 w-4 text-indigo-500" />简历来源
            </label>
            <div className="relative">
              <select
                id="recommendation-resume-source"
                value={resumeSource}
                onChange={(event) => setResumeSource(event.target.value)}
                className="h-11 w-full appearance-none rounded-lg border border-slate-200 bg-white px-3 pr-10 text-sm text-slate-700 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
              >
                {RESUME_SOURCE_OPTIONS.map((source) => <option key={source} value={source}>{source}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            </div>
          </div>

          <div>
            <label htmlFor="candidate-recommendation-info" className="mb-2 block text-sm font-medium text-slate-700">候选人信息</label>
            <textarea
              id="candidate-recommendation-info"
              value={candidateText}
              onChange={(event) => setCandidateText(event.target.value)}
              placeholder={candidatePlaceholder}
              className="h-64 w-full resize-none rounded-lg border border-slate-200 bg-slate-50/60 p-4 text-sm leading-7 text-slate-700 outline-none focus:border-indigo-300 focus:bg-white focus:ring-2 focus:ring-indigo-100"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-4">
          <button type="button" onClick={onClose} className="h-10 rounded-lg px-4 text-sm font-medium text-slate-500 hover:bg-slate-100">取消</button>
          <button
            type="button"
            onClick={() => onGenerate(candidateText.trim(), codeSuffix, resumeFile, resumeSource.trim() || 'boss')}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-700"
          >
            <Sparkles className="h-4 w-4" />生成 {jobCount} 份推荐文案
          </button>
        </div>
      </div>
    </div>
  );
}
