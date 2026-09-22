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
  const [candidateCode, setCandidateCode] = useState('');
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
    setCandidateCode(''); setName(''); setJobTitle(''); setContact(''); setContactPerson('');
    setOrganization(''); setDepartment(''); setHighlights(''); setHighlightsLoading(false);
    setFileStatus('idle'); setUploadedFileName(''); setFileError('');
    setResumeUrl(''); setResumeFileName('');
  };

  /** 公共：把提取好的文字喂给 AI 解析联系信息，回填表单 */
  const applyParsedInfo = async (text: string) => {
    const info = await extractRecommendationInfo(text);
    setCandidateCode(info.candidateCode);
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
      // 1) 大文件（>4MB）经 @vercel/blob/client 从浏览器直传 Blob，绕过 Serverless 4.5MB 请求体上限；
      //    小文件走更快的 FormData 直传路径。直传失败不阻断——静默回退到 FormData 解析。
      const LARGE_FILE_BYTES = 4 * 1024 * 1024;
      let blobUrl = '';
      if (file.size > LARGE_FILE_BYTES) {
        try {
          const { upload } = await import('@vercel/blob/client');
          const blob = await upload(file.name, file, {
            access: 'public',
            handleUploadUrl: '/api/resume/blob-upload',
            contentType: file.type || 'application/octet-stream',
          });
          blobUrl = blob.url || '';
        } catch { /* 直传不可用时静默回退到 FormData */ }
      }
      if (blobUrl) { setResumeUrl(blobUrl); setResumeFileName(file.name); }

      // 2) 提取文字：已入 Blob 则让服务端从 Blob 拉取（免二次上传），否则 FormData 直传解析。
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
      // 服务端在文件过大(413)等场景返回纯文本(如 "Request Entity Too Large")，
      // 直接 res.json() 会抛 "Unexpected token 'R'"。先读文本再安全解析。
      const raw = await res.text();
      let data: { text?: string; error?: string } = {};
      try {
        data = raw ? (JSON.parse(raw) as { text?: string; error?: string }) : {};
      } catch {
        data = { error: res.status === 413 ? '简历文件过大，请压缩后重试（建议 < 4MB）' : (raw.slice(0, 120) || '文件解析失败') };
      }
      if (!res.ok || data.error) {
        setFileStatus('error');
        setFileError(data.error || (res.status === 413 ? '简历文件过大，请压缩后重试（建议 < 4MB）' : '文件解析失败'));
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
      candidateCode: candidateCode.trim() || undefined,
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
    <div className="workspace-surface overflow-hidden p-4 sm:p-6">
      {/* 顶栏 */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#edf3ff] text-[#3159d8]"><Sparkles className="h-[18px] w-[18px]" /></span>
          <div>
            <h2 className="text-[17px] font-semibold tracking-[-0.02em] text-slate-900">简历入口</h2>
            <p className="mt-0.5 text-xs text-slate-500">粘贴推荐语或上传原始文件，解析后再录入</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-slate-500">推荐人</span>
          <div className="flex overflow-hidden rounded-xl border border-[#e2e8f2] bg-[#f5f7fb] p-0.5 text-xs">
            {(['a', 'b'] as RepushColumnId[]).map((c) => (
              <button key={c} onClick={() => handleOwnerChange(c)}
                className={cn('h-7 rounded-[9px] px-3 font-medium transition-all', owner === c ? 'bg-white text-[#3159d8] shadow-[0_2px_7px_rgba(30,54,99,0.1)]' : 'text-slate-500 hover:text-slate-700')}>
                {columnNames[c]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 一体化简历入口：左侧文字框 + 右侧上传（上传后自动填入左侧） */}
      <div className="flex flex-col gap-3 lg:flex-row">
        {/* ── 左：文字输入区（主区域） ── */}
        <div className="flex min-w-0 flex-1 gap-2" style={{ height: 180 }}>
          <textarea
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder="粘贴整段简历内容，或从右侧上传文件自动提取…"
            aria-label="粘贴简历或推荐语"
            className="h-full flex-1 resize-none rounded-2xl border border-[#dce5f1] bg-[#fafcff] px-4 py-3.5 text-sm leading-6 text-slate-700 placeholder:text-slate-400 focus:border-[#88a4ec] focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#eaf0ff]"
          />
          <button
            onClick={handleParse}
            disabled={!rawText.trim() || parsing}
            className={cn(
              'workspace-action flex w-20 shrink-0 flex-col items-center justify-center gap-1 rounded-2xl text-xs font-semibold',
              !rawText.trim() || parsing ? 'cursor-not-allowed bg-slate-100 text-slate-400' : 'bg-[#3159d8] text-white shadow-[0_5px_12px_rgba(49,89,216,0.16)] hover:bg-[#254bc2]',
            )}
          >
            {parsing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {parsing ? '解析中' : '智能解析'}
          </button>
        </div>

        {/* ── 右：上传简历（提取文字后填入左侧） ── */}
        <div className="w-full shrink-0 lg:w-[360px]">
          <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx" className="hidden" onChange={onFileInput} />

          {fileStatus === 'idle' || fileStatus === 'error' ? (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              className={cn(
                'workspace-action flex h-[180px] w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border border-dashed text-xs',
                dragOver ? 'border-[#6285e9] bg-[#edf3ff]' : 'border-[#cbd8ec] bg-[#f8faff] hover:border-[#8ea6e8] hover:bg-[#f0f5ff]',
                fileStatus === 'error' && 'border-red-300',
              )}
            >
              <span className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl border border-[#dce6f6] bg-white shadow-[0_3px_8px_rgba(31,56,108,0.05)]"><Upload className={cn('h-4 w-4', fileStatus === 'error' ? 'text-red-400' : 'text-[#3159d8]')} /></span>
              {fileStatus === 'error' ? (
                <span className="text-red-500 text-center px-2 leading-tight">{fileError}</span>
              ) : (
                <>
                  <span className="font-semibold text-slate-700">上传简历文件</span>
                  <span className="text-[11px] text-slate-400">PDF / DOC / DOCX</span>
                </>
              )}
            </button>
          ) : fileIsBusy ? (
            <div className="flex h-[180px] w-full flex-col items-center justify-center gap-1.5 rounded-2xl border border-[#dce5f1] bg-[#f8faff] text-xs text-slate-500">
              <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
              <span className="text-center px-2 leading-tight">{fileLabel}</span>
            </div>
          ) : (
            <div className="relative flex h-[180px] w-full flex-col items-center justify-center gap-1 rounded-2xl border border-green-200 bg-green-50 px-3">
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
        <div className="mt-4 grid grid-cols-2 md:grid-cols-7 gap-3 items-end animate-fade-in">
          <Field label="编码">
            <input value={candidateCode} onChange={(e) => setCandidateCode(e.target.value)} placeholder="候选人编码" className="intake-input" />
          </Field>
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
          <div className="col-span-2 md:col-span-7 flex items-center justify-end gap-3">
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
                  : justAdded ? 'bg-green-500 text-white' : 'bg-[#3159d8] text-white hover:bg-[#254bc2]',
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
          background: #fbfcff;
          border: 1px solid #dce5f1;
          font-size: 0.875rem;
          outline: none;
        }
        :global(.intake-input:focus) { border-color: #88a4ec; box-shadow: 0 0 0 3px #eaf0ff; }
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
