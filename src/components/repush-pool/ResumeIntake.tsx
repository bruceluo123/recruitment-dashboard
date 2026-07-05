'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles, Loader2, Check, UserPlus, Upload, FileText, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { JD } from '@/types/jd';
import type { RepushColumnId, NewRecommendation } from '@/store/repush-store';
import { extractRecommendationInfo, extractResumeHighlights, matchJDByTitle } from '@/lib/recommendation';

interface ResumeIntakeProps {
  columnNames: Record<RepushColumnId, string>;
  orgOptions: string[];
  deptOptions: string[];
  jds: JD[];
  defaultOwner?: RepushColumnId;
  onAdd: (rec: NewRecommendation) => void;
  onOwnerChange?: (owner: RepushColumnId) => void;
}

type FileStatus = 'idle' | 'uploading' | 'parsing' | 'done' | 'error';

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
  const [highlights, setHighlights] = useState('');
  const [highlightsLoading, setHighlightsLoading] = useState(false);
  const [justAdded, setJustAdded] = useState(false);

  // 右窗格：文件上传
  const [fileStatus, setFileStatus] = useState<FileStatus>('idle');
  const [uploadedFileName, setUploadedFileName] = useState('');
  const [fileError, setFileError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  // 简历文件 Blob 链接：上传成功后跟随推荐记录全链路（人才库/面试日历可直接下载）
  const [resumeUrl, setResumeUrl] = useState('');
  const [resumeFileName, setResumeFileName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setOwner(defaultOwner); }, [defaultOwner]);

  const handleOwnerChange = (c: RepushColumnId) => { setOwner(c); onOwnerChange?.(c); };

  const jdTitleOptions = useMemo(() => {
    const set = new Set<string>();
    for (const jd of jds) { const t = jd.title?.trim(); if (t) set.add(t); }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }, [jds]);

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
    setOrganization(''); setDepartment(''); setHighlights(''); setHighlightsLoading(false);
    setFileStatus('idle'); setUploadedFileName(''); setFileError('');
    setResumeUrl(''); setResumeFileName('');
  };

  /** 公共：把提取好的文字喂给 AI 解析联系信息，回填表单 */
  const applyParsedInfo = async (text: string) => {
    const info = await extractRecommendationInfo(text);
    setName(info.name);
    setJobTitle(info.jobTitle);
    setContact(info.contact);
    setContactPerson(info.contactPerson);
    const jd = info.jobTitle ? matchJDByTitle(info.jobTitle, jds) : null;
    setOrganization(info.organization || jd?.organization?.trim() || '');
    setDepartment(info.department || jd?.department?.trim() || '');
    setParsed(true);
    // 后台提取亮点，显示加载状态
    setHighlightsLoading(true);
    extractResumeHighlights(text)
      .then((hl) => { setHighlights(hl); })
      .catch(() => {})
      .finally(() => setHighlightsLoading(false));
  };

  // ── 左窗格：文字解析 ──────────────────────────────────────────────────────
  const handleParse = async () => {
    if (!rawText.trim() || parsing) return;
    setParsing(true);
    try {
      await applyParsedInfo(rawText);
    } finally {
      setParsing(false);
    }
  };

  // ── 右窗格：文件上传 ──────────────────────────────────────────────────────
  const handleFile = async (file: File) => {
    if (!/\.(pdf|docx?)$/i.test(file.name)) {
      setFileError('仅支持 PDF / DOC / DOCX');
      setFileStatus('error');
      return;
    }
    setUploadedFileName(file.name);
    setFileError('');
    setFileStatus('uploading');
    try {
      // 1) 先把文件本体存入 Vercel Blob（简历资产全链路的起点：文件跟随候选人，不再丢弃）。
      //    失败不阻断——回退为纯文字解析路径，录入功能照常可用。
      let blobUrl = '';
      try {
        const fd = new FormData();
        fd.append('file', file);
        const up = await fetch('/api/talent/upload', { method: 'POST', body: fd });
        if (up.ok) {
          const blob = (await up.json()) as { url?: string };
          blobUrl = blob.url || '';
        }
      } catch { /* Blob 不可用时静默回退 */ }
      if (blobUrl) { setResumeUrl(blobUrl); setResumeFileName(file.name); }

      // 2) 提取文字：已入 Blob 则让服务端从 Blob 拉取（免二次上传），否则直传解析。
      let res: Response;
      if (blobUrl) {
        res = await fetch('/api/resume/parse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: blobUrl, fileName: file.name }),
        });
      } else {
        const formData = new FormData();
        formData.append('file', file);
        res = await fetch('/api/resume/parse', { method: 'POST', body: formData });
      }
      const data = (await res.json()) as { text?: string; error?: string };
      if (!res.ok || data.error) {
        setFileStatus('error');
        setFileError(data.error || '文件解析失败');
        return;
      }
      const text = data.text || '';
      // 不覆盖已有内容：把提取文字追加到原文下方（录入推荐时一起保存）
      const prev = rawText.trim();
      const combined = prev ? `${prev}\n\n${text}` : text;
      setRawText(combined);
      setFileStatus('parsing');
      // 上传简历只负责「亮点 + 简历内容」，绝不回填左侧 6 个结构化字段。
      // 那 6 个字段只能由「推荐语 + 智能解析」填充（不论上传与解析先后顺序）。
      setHighlightsLoading(true);
      extractResumeHighlights(combined)
        .then((hl) => { setHighlights(hl); })
        .catch(() => {})
        .finally(() => setHighlightsLoading(false));
      setFileStatus('done');
    } catch (e) {
      setFileStatus('error');
      setFileError((e as Error).message || '上传失败，请重试');
    }
  };

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = '';
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
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
      highlights: highlights || undefined,
      resumeUrl: resumeUrl || undefined,
      resumeFileName: resumeFileName || undefined,
    });
    resetFields();
    setJustAdded(true);
    setTimeout(() => setJustAdded(false), 1800);
  };

  const fileIsBusy = fileStatus === 'uploading' || fileStatus === 'parsing';
  const fileLabel = fileStatus === 'uploading' ? '上传中…' : fileStatus === 'parsing' ? '解析中…' : '';

  return (
    <div className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50/80 to-cyan-50/50 p-5 shadow-sm">
      {/* 顶栏 */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-gray-800 flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-indigo-500 flex items-center justify-center"><Sparkles className="w-4 h-4 text-white" /></span>
          简历入口
        </h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">推荐人</span>
          <div className="flex rounded-lg border border-indigo-200 overflow-hidden text-xs">
            {(['a', 'b'] as RepushColumnId[]).map((c) => (
              <button key={c} onClick={() => handleOwnerChange(c)}
                className={cn('px-3 h-7 font-medium transition-colors', owner === c ? 'bg-indigo-500 text-white' : 'bg-white text-gray-500 hover:bg-indigo-50')}>
                {columnNames[c]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 一体化简历入口：左侧文字框 + 右侧上传（上传后自动填入左侧） */}
      <div className="flex gap-3">
        {/* ── 左：文字输入区（主区域） ── */}
        <div className="flex-1 min-w-0 flex gap-2" style={{ height: 100 }}>
          <textarea
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder="粘贴整段简历内容，或从右侧上传文件自动提取…"
            className="flex-1 h-full px-3 py-2.5 rounded-xl bg-white border border-gray-200 text-sm resize-none focus:outline-none focus:border-indigo-300"
          />
          <button
            onClick={handleParse}
            disabled={!rawText.trim() || parsing}
            className={cn(
              'shrink-0 w-20 rounded-xl text-xs font-medium flex flex-col items-center justify-center gap-1 transition-all',
              !rawText.trim() || parsing ? 'bg-gray-100 text-gray-300 cursor-not-allowed' : 'bg-indigo-500 text-white hover:bg-indigo-600',
            )}
          >
            {parsing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {parsing ? '解析中' : '智能解析'}
          </button>
        </div>

        {/* ── 右：上传简历（提取文字后填入左侧） ── */}
        <div className="shrink-0 w-[180px]">
          <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx" className="hidden" onChange={onFileInput} />

          {fileStatus === 'idle' || fileStatus === 'error' ? (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              className={cn(
                'w-full h-[100px] rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-1 text-xs transition-all cursor-pointer',
                dragOver ? 'border-indigo-400 bg-indigo-50' : 'border-gray-200 bg-white hover:border-indigo-300 hover:bg-indigo-50/40',
                fileStatus === 'error' && 'border-red-300',
              )}
            >
              <Upload className={cn('w-4 h-4', fileStatus === 'error' ? 'text-red-400' : 'text-gray-300')} />
              {fileStatus === 'error' ? (
                <span className="text-red-500 text-center px-2 leading-tight">{fileError}</span>
              ) : (
                <>
                  <span className="text-gray-400">上传简历文件</span>
                  <span className="text-gray-300 text-[11px]">PDF / DOC / DOCX</span>
                </>
              )}
            </button>
          ) : fileIsBusy ? (
            <div className="w-full h-[100px] rounded-xl border border-gray-200 bg-white flex flex-col items-center justify-center gap-1.5 text-xs text-gray-400">
              <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
              <span className="text-center px-2 leading-tight">{fileLabel}</span>
            </div>
          ) : (
            <div className="w-full h-[100px] rounded-xl border border-green-200 bg-green-50 flex flex-col items-center justify-center gap-1 px-3 relative">
              <FileText className="w-4 h-4 text-green-500 shrink-0" />
              <p className="text-[11px] font-medium text-gray-600 text-center truncate w-full px-1">{uploadedFileName}</p>
              <p className="text-[11px] text-green-600 flex items-center gap-0.5"><Check className="w-3 h-3" />文字已填入左侧</p>
              <button
                onClick={() => { setFileStatus('idle'); setUploadedFileName(''); setHighlights(''); setHighlightsLoading(false); setResumeUrl(''); setResumeFileName(''); }}
                className="absolute top-1.5 right-1.5 p-0.5 rounded hover:bg-green-100 text-gray-400">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 解析结果表单 */}
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
          <div className="col-span-2 md:col-span-6 flex items-center justify-end gap-3">
            {highlightsLoading && (
              <span className="flex items-center gap-1.5 text-xs text-amber-500">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />亮点提取中，稍等再录入效果更好
              </span>
            )}
            {!highlightsLoading && highlights && (
              <span className="flex items-center gap-1 text-xs text-amber-500">
                <Sparkles className="w-3.5 h-3.5" />亮点已提取
              </span>
            )}
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
