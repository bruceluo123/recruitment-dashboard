'use client';
import { useEffect, useState } from 'react';
import { X, Upload, Loader2, FileText, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Talent } from '@/types/talent';
import type { JDCategory } from '@/types/jd';
import { JD_CATEGORY_LABELS, JD_CATEGORY_COLORS, ALL_CATEGORIES } from '@/types/jd';
import { useTalentStore } from '@/store/talent-store';

interface TalentEditPanelProps {
  talent: Talent | null;
  isOpen: boolean;
  onClose: () => void;
}

interface EditForm {
  name: string;
  jobTitle: string;
  categories: JDCategory[];
  tg: string;
  notes: string;
  resumeUrl: string;
  resumeFileName: string;
  company: string;
  department: string;
  techDirection: string;
  eduLevel: string;
  school: string;
  major: string;
  gradYear: string;
  location: string;
  prevCompanies: string;
  email: string;
  phone: string;
  maimai: string;
  linkedin: string;
  github: string;
  scholar: string;
  openreview: string;
  homepage: string;
  // 飞书表对齐补充字段
  recruiter: string;
  firstContactAt: string;
  lastContactAt: string;
  workIntent: string;
  projectIntent: string;
  monthlySalary: string;
  annualSalary: string;
  bachelorGradYear: string;
  level: string;
  wechatStatus: string;
  outreachStatus: string;
  friendTrack: string;
  account: string;
  onboardInfo: string;
  techAccount: string;
}

const EMPTY: EditForm = {
  name: '', jobTitle: '', categories: [], tg: '', notes: '', resumeUrl: '', resumeFileName: '',
  company: '', department: '', techDirection: '', eduLevel: '', school: '', major: '', gradYear: '',
  location: '', prevCompanies: '', email: '', phone: '',
  maimai: '', linkedin: '', github: '', scholar: '', openreview: '', homepage: '',
  recruiter: '', firstContactAt: '', lastContactAt: '', workIntent: '', projectIntent: '',
  monthlySalary: '', annualSalary: '', bachelorGradYear: '', level: '', wechatStatus: '',
  outreachStatus: '', friendTrack: '', account: '', onboardInfo: '', techAccount: '',
};

export function TalentEditPanel({ talent, isOpen, onClose }: TalentEditPanelProps) {
  const updateTalent = useTalentStore((s) => s.updateTalent);
  const [form, setForm] = useState<EditForm>(EMPTY);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  useEffect(() => {
    if (talent) {
      setForm({
        name: talent.name || '',
        jobTitle: talent.jobTitle || '',
        categories: talent.categories || [],
        tg: talent.tg || '',
        notes: talent.notes || '',
        resumeUrl: talent.resumeUrl || '',
        resumeFileName: talent.resumeFileName || '',
        company: talent.company || '',
        department: talent.department || '',
        techDirection: talent.techDirection || '',
        eduLevel: talent.eduLevel || '',
        school: talent.school || '',
        major: talent.major || '',
        gradYear: talent.gradYear || '',
        location: talent.location || '',
        prevCompanies: (talent.prevCompanies || []).join('、'),
        email: talent.email || '',
        phone: talent.phone || '',
        maimai: talent.links?.maimai || '',
        linkedin: talent.links?.linkedin || '',
        github: talent.links?.github || '',
        scholar: talent.links?.scholar || '',
        openreview: talent.links?.openreview || '',
        homepage: talent.links?.homepage || '',
        recruiter: talent.recruiter || '',
        firstContactAt: talent.firstContactAt || '',
        lastContactAt: talent.lastContactAt || '',
        workIntent: talent.workIntent || '',
        projectIntent: talent.projectIntent || '',
        monthlySalary: talent.monthlySalary || '',
        annualSalary: talent.annualSalary || '',
        bachelorGradYear: talent.bachelorGradYear || '',
        level: talent.level || '',
        wechatStatus: talent.wechatStatus || '',
        outreachStatus: talent.outreachStatus || '',
        friendTrack: talent.friendTrack || '',
        account: talent.account || '',
        onboardInfo: talent.onboardInfo || '',
        techAccount: talent.techAccount || '',
      });
      setUploadError('');
    }
  }, [talent]);

  if (!isOpen || !talent) return null;

  const toggleCategory = (cat: JDCategory) => {
    setForm((f) => ({
      ...f,
      categories: f.categories.includes(cat) ? f.categories.filter((c) => c !== cat) : [...f.categories, cat],
    }));
  };

  const handleUpload = async (file: File) => {
    setUploading(true);
    setUploadError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/talent/upload', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok || !data?.url) throw new Error(data?.error || '上传失败');
      setForm((f) => ({ ...f, resumeUrl: data.downloadUrl || data.url, resumeFileName: data.fileName || file.name }));
    } catch (err) {
      setUploadError((err as Error).message || '上传失败');
    } finally {
      setUploading(false);
    }
  };

  const handleSave = () => {
    const t = (s: string) => { const v = s.trim(); return v ? v : undefined; };
    const prevCompanies = form.prevCompanies
      .split(/[、,，;；\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const links = {
      maimai: t(form.maimai),
      linkedin: t(form.linkedin),
      github: t(form.github),
      scholar: t(form.scholar),
      openreview: t(form.openreview),
      homepage: t(form.homepage),
    };
    const hasLinks = Object.values(links).some(Boolean);
    updateTalent(talent.id, {
      name: form.name.trim(),
      jobTitle: form.jobTitle.trim(),
      categories: form.categories.length > 0 ? form.categories : ['operations'],
      tg: form.tg.trim(),
      notes: form.notes.trim(),
      resumeUrl: form.resumeUrl || undefined,
      resumeFileName: form.resumeFileName || undefined,
      company: t(form.company),
      department: t(form.department),
      techDirection: t(form.techDirection),
      eduLevel: t(form.eduLevel),
      school: t(form.school),
      major: t(form.major),
      gradYear: t(form.gradYear),
      location: t(form.location),
      prevCompanies: prevCompanies.length > 0 ? prevCompanies : undefined,
      email: t(form.email),
      phone: t(form.phone),
      links: hasLinks ? links : undefined,
      recruiter: t(form.recruiter),
      firstContactAt: t(form.firstContactAt),
      lastContactAt: t(form.lastContactAt),
      workIntent: t(form.workIntent),
      projectIntent: t(form.projectIntent),
      monthlySalary: t(form.monthlySalary),
      annualSalary: t(form.annualSalary),
      bachelorGradYear: t(form.bachelorGradYear),
      level: t(form.level),
      wechatStatus: t(form.wechatStatus),
      outreachStatus: t(form.outreachStatus),
      friendTrack: t(form.friendTrack),
      account: t(form.account),
      onboardInfo: t(form.onboardInfo),
      techAccount: t(form.techAccount),
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/20" onClick={onClose} />
      <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-white border border-gray-200 rounded-2xl shadow-xl p-6 animate-fade-in">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-800">编辑人选</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100"><X className="w-5 h-5 text-gray-400" /></button>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">姓名</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full h-10 px-4 rounded-xl bg-white border border-gray-200 text-sm focus:outline-none focus:border-indigo-300" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">岗位名称</label>
              <input value={form.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })}
                className="w-full h-10 px-4 rounded-xl bg-white border border-gray-200 text-sm focus:outline-none focus:border-indigo-300" />
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">人选分类（可多选）</label>
            <div className="flex flex-wrap gap-1 max-h-28 overflow-y-auto">
              {(ALL_CATEGORIES as JDCategory[]).map((cat) => {
                const sel = form.categories.includes(cat);
                return (
                  <button key={cat} type="button" onClick={() => toggleCategory(cat)}
                    className={cn('px-2 py-0.5 rounded-md text-xs font-medium border transition-all',
                      sel ? JD_CATEGORY_COLORS[cat] : 'bg-white text-gray-400 border-gray-200 hover:border-gray-300')}>
                    {JD_CATEGORY_LABELS[cat]}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">最近公司</label>
              <input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })}
                className="w-full h-10 px-4 rounded-xl bg-white border border-gray-200 text-sm focus:outline-none focus:border-indigo-300" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">部门</label>
              <input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })}
                className="w-full h-10 px-4 rounded-xl bg-white border border-gray-200 text-sm focus:outline-none focus:border-indigo-300" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">技术方向</label>
              <input value={form.techDirection} onChange={(e) => setForm({ ...form, techDirection: e.target.value })}
                className="w-full h-10 px-4 rounded-xl bg-white border border-gray-200 text-sm focus:outline-none focus:border-indigo-300" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">所在地</label>
              <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })}
                className="w-full h-10 px-4 rounded-xl bg-white border border-gray-200 text-sm focus:outline-none focus:border-indigo-300" />
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">曾经任职公司（用 、分隔）</label>
            <input value={form.prevCompanies} onChange={(e) => setForm({ ...form, prevCompanies: e.target.value })}
              placeholder="如 字节跳动、腾讯、阿里巴巴"
              className="w-full h-10 px-4 rounded-xl bg-white border border-gray-200 text-sm focus:outline-none focus:border-indigo-300" />
          </div>

          <div className="grid grid-cols-4 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">学历</label>
              <input value={form.eduLevel} onChange={(e) => setForm({ ...form, eduLevel: e.target.value })}
                className="w-full h-10 px-3 rounded-xl bg-white border border-gray-200 text-sm focus:outline-none focus:border-indigo-300" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">毕业院校</label>
              <input value={form.school} onChange={(e) => setForm({ ...form, school: e.target.value })}
                className="w-full h-10 px-3 rounded-xl bg-white border border-gray-200 text-sm focus:outline-none focus:border-indigo-300" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">专业</label>
              <input value={form.major} onChange={(e) => setForm({ ...form, major: e.target.value })}
                className="w-full h-10 px-3 rounded-xl bg-white border border-gray-200 text-sm focus:outline-none focus:border-indigo-300" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">毕业时间</label>
              <input value={form.gradYear} onChange={(e) => setForm({ ...form, gradYear: e.target.value })}
                className="w-full h-10 px-3 rounded-xl bg-white border border-gray-200 text-sm focus:outline-none focus:border-indigo-300" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">邮箱</label>
              <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full h-10 px-4 rounded-xl bg-white border border-gray-200 text-sm focus:outline-none focus:border-indigo-300" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">电话</label>
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="w-full h-10 px-4 rounded-xl bg-white border border-gray-200 text-sm focus:outline-none focus:border-indigo-300" />
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">外部链接</label>
            <div className="grid grid-cols-2 gap-2">
              {([
                ['maimai', '脉脉'], ['linkedin', 'LinkedIn'], ['github', 'GitHub'],
                ['scholar', 'Scholar'], ['openreview', 'OpenReview'], ['homepage', '个人主页'],
              ] as [keyof EditForm, string][]).map(([key, label]) => (
                <input key={key} value={form[key] as string}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                  placeholder={label}
                  className="w-full h-9 px-3 rounded-xl bg-white border border-gray-200 text-xs focus:outline-none focus:border-indigo-300" />
              ))}
            </div>
          </div>

          <details className="rounded-xl border border-gray-200 bg-gray-50/60 px-3 py-2">
            <summary className="cursor-pointer text-xs font-medium text-gray-500 select-none">招聘流程 / 沟通信息（对齐飞书表，可选）</summary>
            <div className="mt-3 space-y-3">
              <div className="grid grid-cols-3 gap-2">
                {([
                  ['recruiter', '招聘顾问'], ['level', '级别（P8/L6…）'], ['account', '所属账号'],
                  ['firstContactAt', '首次沟通时间'], ['lastContactAt', '最新沟通时间'], ['bachelorGradYear', '本科毕业时间'],
                  ['workIntent', '工作意愿度'], ['projectIntent', '项目意愿度'], ['onboardInfo', '入职时间及公司类型'],
                  ['monthlySalary', '月薪'], ['annualSalary', '年薪'], ['techAccount', '技术账号/领英状态'],
                ] as [keyof EditForm, string][]).map(([key, label]) => (
                  <div key={key}>
                    <label className="block text-[11px] text-gray-400 mb-1">{label}</label>
                    <input value={form[key] as string}
                      onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                      className="w-full h-9 px-3 rounded-lg bg-white border border-gray-200 text-xs focus:outline-none focus:border-indigo-300" />
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-2">
                {([
                  ['wechatStatus', '批量加微信'], ['outreachStatus', '站内信/邮件'], ['friendTrack', '添加好友轨迹'],
                ] as [keyof EditForm, string][]).map(([key, label]) => (
                  <div key={key}>
                    <label className="block text-[11px] text-gray-400 mb-1">{label}</label>
                    <input value={form[key] as string}
                      onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                      className="w-full h-9 px-3 rounded-lg bg-white border border-gray-200 text-xs focus:outline-none focus:border-indigo-300" />
                  </div>
                ))}
              </div>
            </div>
          </details>

          <div>
            <label className="block text-xs text-gray-500 mb-1">简历链接</label>
            {form.resumeUrl ? (
              <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl border border-gray-200 bg-gray-50">
                <a href={form.resumeUrl} target="_blank" rel="noopener noreferrer" download={form.resumeFileName}
                  className="inline-flex items-center gap-1.5 text-sm text-indigo-600 hover:underline truncate">
                  <FileText className="w-3.5 h-3.5 shrink-0" /><span className="truncate">{form.resumeFileName || '简历'}</span>
                </a>
                <button onClick={() => setForm({ ...form, resumeUrl: '', resumeFileName: '' })}
                  className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 shrink-0" title="删除链接">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <label className={cn('flex items-center justify-center gap-2 h-10 rounded-xl border border-dashed border-gray-300 text-sm cursor-pointer hover:border-indigo-300 transition-all',
                uploading ? 'text-gray-400' : 'text-gray-500')}>
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {uploading ? '上传中...' : '上传简历文件（PDF / DOCX）'}
                <input type="file" accept=".pdf,.docx" className="hidden" disabled={uploading}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); }} />
              </label>
            )}
            {uploadError && <p className="text-xs text-red-500 mt-1">{uploadError}</p>}
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">TG 号</label>
            <input value={form.tg} onChange={(e) => setForm({ ...form, tg: e.target.value })}
              placeholder="如 @username 或 +1234567890"
              className="w-full h-10 px-4 rounded-xl bg-white border border-gray-200 text-sm focus:outline-none focus:border-indigo-300" />
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">备注</label>
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2}
              className="w-full px-4 py-2 rounded-xl bg-white border border-gray-200 text-sm focus:outline-none focus:border-indigo-300 resize-none" />
          </div>

          <button onClick={handleSave} className="w-full h-10 rounded-xl bg-indigo-500 text-white text-sm font-medium hover:bg-indigo-600 transition-all">
            保存修改
          </button>
        </div>
      </div>
    </div>
  );
}
