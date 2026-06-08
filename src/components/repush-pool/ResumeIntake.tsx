'use client';
import { useEffect, useMemo, useState } from 'react';
import { Sparkles, Loader2, Check, UserPlus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { JD } from '@/types/jd';
import type { RepushColumnId, NewRecommendation } from '@/store/repush-store';
import { extractRecommendationInfo, matchJDByTitle } from '@/lib/recommendation';

interface ResumeIntakeProps {
  columnNames: Record<RepushColumnId, string>;
  orgOptions: string[];
  deptOptions: string[];
  jds: JD[];
  defaultOwner?: RepushColumnId;
  onAdd: (rec: NewRecommendation) => void;
  onOwnerChange?: (owner: RepushColumnId) => void;
}

export function ResumeIntake({ columnNames, orgOptions, deptOptions, jds, defaultOwner = 'a', onAdd, onOwnerChange }: ResumeIntakeProps) {
  const [rawText, setRawText] = useState('');
  const [owner, setOwner] = useState<RepushColumnId>(defaultOwner);
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState(false);
  const [name, setName] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [contact, setContact] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [organization, setOrganization] = useState('');
  const [department, setDepartment] = useState('');
  const [justAdded, setJustAdded] = useState(false);

  // 外部偏好（活跃推荐人）变化时同步本地选择
  useEffect(() => { setOwner(defaultOwner); }, [defaultOwner]);

  const handleOwnerChange = (c: RepushColumnId) => {
    setOwner(c);
    onOwnerChange?.(c);
  };

  // 岗位下拉选项：JD 库中去重、非空的岗位名
  const jdTitleOptions = useMemo(() => {
    const set = new Set<string>();
    for (const jd of jds) { const t = jd.title?.trim(); if (t) set.add(t); }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }, [jds]);

  // 选/改岗位时按 JD 库自动回填编制/部门
  const handleJobTitleChange = (title: string) => {
    setJobTitle(title);
    const jd = title ? matchJDByTitle(title, jds) : null;
    if (jd) {
      setOrganization(jd.organization?.trim() || '');
      setDepartment(jd.department?.trim() || '');
    }
  };

  const resetFields = () => {
    setRawText(''); setParsed(false);
    setName(''); setJobTitle(''); setContact(''); setContactPerson('');
    setOrganization(''); setDepartment('');
  };

  const handleParse = async () => {
    if (!rawText.trim() || parsing) return;
    setParsing(true);
    try {
      const info = await extractRecommendationInfo(rawText);
      setName(info.name);
      setJobTitle(info.jobTitle);
      setContact(info.contact);
      setContactPerson(info.contactPerson);
      // 优先用简历中明写的编制/部门；缺失时再按岗位名匹配 JD 库回填
      const jd = info.jobTitle ? matchJDByTitle(info.jobTitle, jds) : null;
      setOrganization(info.organization || jd?.organization?.trim() || '');
      setDepartment(info.department || jd?.department?.trim() || '');
      setParsed(true);
    } finally {
      setParsing(false);
    }
  };

  const handleAdd = () => {
    if (!name.trim()) return;
    onAdd({
      column: owner,
      candidateName: name.trim(),
      jdTitle: jobTitle.trim() || undefined,
      contact: contact.trim() || undefined,
      contactPerson: contactPerson.trim() || undefined,
      rawText: rawText.trim() || undefined,
      organization: organization || undefined,
      department: department || undefined,
    });
    resetFields();
    setJustAdded(true);
    setTimeout(() => setJustAdded(false), 1800);
  };

  return (
    <div className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50/80 to-cyan-50/50 p-5 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-semibold text-gray-800 flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-indigo-500 flex items-center justify-center"><Sparkles className="w-4 h-4 text-white" /></span>
          简历入口
        </h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">推荐人</span>
          <div className="flex rounded-lg border border-indigo-200 overflow-hidden text-xs">
            {(['a', 'b'] as RepushColumnId[]).map((c) => (
              <button
                key={c}
                onClick={() => handleOwnerChange(c)}
                className={cn('px-3 h-7 font-medium transition-colors', owner === c ? 'bg-indigo-500 text-white' : 'bg-white text-gray-500 hover:bg-indigo-50')}
              >
                {columnNames[c]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex gap-3">
        <textarea
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
          placeholder="粘贴整段简历内容到此处，点击「智能解析」自动提取姓名 / 岗位 / 联系方式…"
          className="flex-1 min-h-[96px] max-h-48 px-4 py-3 rounded-xl bg-white border border-gray-200 text-sm resize-y focus:outline-none focus:border-indigo-300"
        />
        <button
          onClick={handleParse}
          disabled={!rawText.trim() || parsing}
          className={cn(
            'shrink-0 w-28 rounded-xl text-sm font-medium flex flex-col items-center justify-center gap-1.5 transition-all',
            !rawText.trim() || parsing ? 'bg-gray-100 text-gray-300 cursor-not-allowed' : 'bg-indigo-500 text-white hover:bg-indigo-600',
          )}
        >
          {parsing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
          {parsing ? '解析中' : '智能解析'}
        </button>
      </div>

      {parsed && (
        <div className="mt-4 grid grid-cols-2 md:grid-cols-6 gap-3 items-end animate-fade-in">
          <Field label="姓名 *">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="姓名" className="intake-input" />
          </Field>
          <Field label="岗位">
            <select value={jobTitle} onChange={(e) => handleJobTitleChange(e.target.value)} className="intake-input cursor-pointer">
              <option value="">未选岗位</option>
              {jdTitleOptions.map((t) => <option key={t} value={t}>{t}</option>)}
              {jobTitle && !jdTitleOptions.includes(jobTitle) && <option value={jobTitle}>{jobTitle}（自定义）</option>}
            </select>
          </Field>
          <Field label="编制">
            <select value={organization} onChange={(e) => setOrganization(e.target.value)} className="intake-input cursor-pointer">
              <option value="">未选编制</option>
              {orgOptions.map((o) => <option key={o} value={o}>{o}</option>)}
              {organization && !orgOptions.includes(organization) && <option value={organization}>{organization}</option>}
            </select>
          </Field>
          <Field label="部门">
            <select value={department} onChange={(e) => setDepartment(e.target.value)} className="intake-input cursor-pointer">
              <option value="">未选部门</option>
              {deptOptions.map((d) => <option key={d} value={d}>{d}</option>)}
              {department && !deptOptions.includes(department) && <option value={department}>{department}</option>}
            </select>
          </Field>
          <Field label="联系方式">
            <input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="手机/邮箱/微信" className="intake-input" />
          </Field>
          <Field label="简历对接人">
            <input value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} placeholder="对接人" className="intake-input" />
          </Field>
          <div className="col-span-2 md:col-span-6 flex justify-end">
            <button
              onClick={handleAdd}
              disabled={!name.trim()}
              className={cn(
                'h-10 px-6 rounded-xl text-sm font-medium flex items-center gap-2 transition-all',
                !name.trim() ? 'bg-gray-100 text-gray-300 cursor-not-allowed'
                  : justAdded ? 'bg-green-500 text-white' : 'bg-indigo-500 text-white hover:bg-indigo-600',
              )}
            >
              {justAdded ? <Check className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
              {justAdded ? '已录入' : '录入推荐'}
            </button>
          </div>
        </div>
      )}

      {justAdded && !parsed && (
        <p className="mt-3 text-xs text-green-600 flex items-center gap-1"><Check className="w-3.5 h-3.5" />已录入到 {columnNames[owner]}</p>
      )}

      <style jsx>{`
        :global(.intake-input) {
          width: 100%;
          height: 2.5rem;
          padding: 0 0.75rem;
          border-radius: 0.75rem;
          background: #fff;
          border: 1px solid #e5e7eb;
          font-size: 0.875rem;
          outline: none;
        }
        :global(.intake-input:focus) { border-color: #a5b4fc; }
      `}</style>
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
