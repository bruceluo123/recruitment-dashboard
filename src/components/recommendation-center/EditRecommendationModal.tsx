'use client';
import { useMemo, useState } from 'react';
import { Pencil, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { JD } from '@/types/jd';
import type { RepushItem, RepushColumnId } from '@/store/repush-store';

interface EditRecommendationModalProps {
  item: RepushItem;
  columnNames: Record<RepushColumnId, string>;
  orgOptions: string[];
  deptOptions: string[];
  jds: JD[];
  onClose: () => void;
  onSave: (id: string, partial: Partial<RepushItem>) => void;
}

export function EditRecommendationModal({ item, columnNames, orgOptions, deptOptions, jds, onClose, onSave }: EditRecommendationModalProps) {
  const initialName = item.candidateName || item.fileName.replace(/\.(pdf|docx?)$/i, '').trim();
  const [name, setName] = useState(initialName);
  const [jobTitle, setJobTitle] = useState(item.jdTitle || '');
  const [organization, setOrganization] = useState(item.organization || '');
  const [department, setDepartment] = useState(item.department || '');
  const [contact, setContact] = useState(item.contact || '');
  const [contactPerson, setContactPerson] = useState(item.contactPerson || '');
  const [column, setColumn] = useState<RepushColumnId>(item.column);

  const jdTitleOptions = useMemo(() => {
    const set = new Set<string>();
    for (const jd of jds) { const t = jd.title?.trim(); if (t) set.add(t); }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }, [jds]);

  const handleSave = () => {
    if (!name.trim()) return;
    const jt = jobTitle.trim();
    const fileName = jt ? `${name.trim()}-${jt}` : name.trim();
    onSave(item.id, {
      fileName,
      candidateName: name.trim(),
      jdTitle: jt || undefined,
      organization: organization || undefined,
      department: department || undefined,
      contact: contact.trim() || undefined,
      contactPerson: contactPerson.trim() || undefined,
      column,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white border border-gray-200 rounded-2xl shadow-2xl p-6 animate-fade-in">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-semibold text-gray-800 flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-indigo-500 flex items-center justify-center"><Pencil className="w-4 h-4 text-white" /></span>
            编辑推荐信息
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100" title="关闭"><X className="w-4 h-4" /></button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="姓名 *">
            <input value={name} onChange={(e) => setName(e.target.value)} className="edit-input" placeholder="姓名" />
          </Field>
          <Field label="岗位">
            <select value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} className="edit-input cursor-pointer">
              <option value="">未选岗位</option>
              {jdTitleOptions.map((t) => <option key={t} value={t}>{t}</option>)}
              {jobTitle && !jdTitleOptions.includes(jobTitle) && <option value={jobTitle}>{jobTitle}（自定义）</option>}
            </select>
          </Field>
          <Field label="编制">
            <select value={organization} onChange={(e) => setOrganization(e.target.value)} className="edit-input cursor-pointer">
              <option value="">未选编制</option>
              {orgOptions.map((o) => <option key={o} value={o}>{o}</option>)}
              {organization && !orgOptions.includes(organization) && <option value={organization}>{organization}</option>}
            </select>
          </Field>
          <Field label="部门">
            <select value={department} onChange={(e) => setDepartment(e.target.value)} className="edit-input cursor-pointer">
              <option value="">未选部门</option>
              {deptOptions.map((d) => <option key={d} value={d}>{d}</option>)}
              {department && !deptOptions.includes(department) && <option value={department}>{department}</option>}
            </select>
          </Field>
          <Field label="联系方式">
            <input value={contact} onChange={(e) => setContact(e.target.value)} className="edit-input" placeholder="手机/邮箱/微信" />
          </Field>
          <Field label="简历对接人">
            <input value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} className="edit-input" placeholder="对接人" />
          </Field>
          <Field label="推荐人">
            <div className="flex rounded-xl border border-gray-200 overflow-hidden text-sm h-10">
              {(['a', 'b'] as RepushColumnId[]).map((c) => (
                <button
                  key={c}
                  onClick={() => setColumn(c)}
                  className={cn('flex-1 font-medium transition-colors', column === c ? 'bg-indigo-500 text-white' : 'bg-white text-gray-500 hover:bg-indigo-50')}
                >
                  {columnNames[c]}
                </button>
              ))}
            </div>
          </Field>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="h-10 px-4 rounded-xl text-sm font-medium text-gray-500 hover:bg-gray-100">取消</button>
          <button
            onClick={handleSave}
            disabled={!name.trim()}
            className={cn('h-10 px-5 rounded-xl text-sm font-medium text-white transition-colors', name.trim() ? 'bg-indigo-500 hover:bg-indigo-600' : 'bg-gray-200 cursor-not-allowed')}
          >
            保存
          </button>
        </div>

        <style jsx>{`
          :global(.edit-input) {
            width: 100%;
            height: 2.5rem;
            padding: 0 0.75rem;
            border-radius: 0.75rem;
            background: #fff;
            border: 1px solid #e5e7eb;
            font-size: 0.875rem;
            outline: none;
          }
          :global(.edit-input:focus) { border-color: #a5b4fc; }
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
