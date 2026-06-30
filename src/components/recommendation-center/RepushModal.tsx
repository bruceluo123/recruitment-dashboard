'use client';
import { useMemo, useState } from 'react';
import { Repeat, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { JD } from '@/types/jd';
import type { RepushItem } from '@/store/repush-store';
import { matchJDByTitle } from '@/lib/recommendation';
import { displayName } from '@/lib/repush-format';

export interface RepushArgs {
  jdTitle: string;
  organization: string;
  department: string;
}

interface RepushModalProps {
  item: RepushItem;
  orgOptions: string[];
  deptOptions: string[];
  jds: JD[];
  onClose: () => void;
  onConfirm: (args: RepushArgs) => void;
}

/**
 * 复推弹窗：把同一个人选再推荐到「另一个岗位」。
 * 仅重新选择 岗位/编制/部门，姓名、联系方式、对接人、亮点、简历原文都沿用原记录。
 * 确认后会新增一条独立的推荐记录（可单独约面），原记录保持不变。
 */
export function RepushModal({ item, orgOptions, deptOptions, jds, onClose, onConfirm }: RepushModalProps) {
  // 复推默认换岗位：岗位清空让用户重选；编制/部门留空待回填
  const [jobTitle, setJobTitle] = useState('');
  const [organization, setOrganization] = useState('');
  const [department, setDepartment] = useState('');

  const jdTitleOptions = useMemo(() => {
    const set = new Set<string>();
    for (const jd of jds) { const t = jd.title?.trim(); if (t) set.add(t); }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }, [jds]);

  // 选岗位时按 JD 库自动回填编制/部门，省去手选
  const handleJobTitleChange = (title: string) => {
    setJobTitle(title);
    const jd = title ? matchJDByTitle(title, jds) : null;
    if (jd) {
      setOrganization(jd.organization?.trim() || '');
      setDepartment(jd.department?.trim() || '');
    }
  };

  const handleConfirm = () => {
    if (!jobTitle.trim()) return;
    onConfirm({ jdTitle: jobTitle.trim(), organization, department });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white border border-gray-200 rounded-2xl shadow-2xl p-6 animate-fade-in">
        <div className="flex items-center justify-between mb-1.5">
          <h3 className="text-base font-semibold text-gray-800 flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-violet-500 flex items-center justify-center"><Repeat className="w-4 h-4 text-white" /></span>
            复推到其他岗位
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100" title="关闭"><X className="w-4 h-4" /></button>
        </div>
        <p className="text-xs text-gray-400 mb-5 pl-9">
          为 <span className="font-medium text-gray-600">{displayName(item)}</span> 新建一条推荐，重新选择岗位/编制/部门；联系方式、亮点等沿用原记录。
        </p>

        <div className="space-y-3">
          <Field label="岗位 *">
            <select value={jobTitle} onChange={(e) => handleJobTitleChange(e.target.value)} className="repush-input cursor-pointer">
              <option value="">请选择岗位</option>
              {jdTitleOptions.map((t) => <option key={t} value={t}>{t}</option>)}
              {jobTitle && !jdTitleOptions.includes(jobTitle) && <option value={jobTitle}>{jobTitle}（自定义）</option>}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="编制">
              <select value={organization} onChange={(e) => setOrganization(e.target.value)} className="repush-input cursor-pointer">
                <option value="">未选编制</option>
                {orgOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                {organization && !orgOptions.includes(organization) && <option value={organization}>{organization}</option>}
              </select>
            </Field>
            <Field label="部门">
              <select value={department} onChange={(e) => setDepartment(e.target.value)} className="repush-input cursor-pointer">
                <option value="">未选部门</option>
                {deptOptions.map((d) => <option key={d} value={d}>{d}</option>)}
                {department && !deptOptions.includes(department) && <option value={department}>{department}</option>}
              </select>
            </Field>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="h-10 px-4 rounded-xl text-sm font-medium text-gray-500 hover:bg-gray-100">取消</button>
          <button
            onClick={handleConfirm}
            disabled={!jobTitle.trim()}
            className={cn('h-10 px-5 rounded-xl text-sm font-medium text-white transition-colors flex items-center gap-1.5', jobTitle.trim() ? 'bg-violet-500 hover:bg-violet-600' : 'bg-gray-200 cursor-not-allowed')}
          >
            <Repeat className="w-4 h-4" />确认复推
          </button>
        </div>

        <style jsx>{`
          :global(.repush-input) {
            width: 100%;
            height: 2.5rem;
            padding: 0 0.75rem;
            border-radius: 0.75rem;
            background: #fff;
            border: 1px solid #e5e7eb;
            font-size: 0.875rem;
            outline: none;
          }
          :global(.repush-input:focus) { border-color: #c4b5fd; }
        `}</style>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      {children}
    </div>
  );
}
