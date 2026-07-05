'use client';
import { Upload, FileText, Loader2, Check, AlertCircle, Trash2, UserPlus } from 'lucide-react';
import { useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import type { Resume } from '@/types/resume';
import { MAX_RESUMES } from '@/store/resume-store';
import { saveResumeToTalentPool } from '@/lib/resume-to-talent';

interface ResumeUploaderProps {
  onFileSelected: (file: File) => void; isUploading: boolean;
  resumes: Resume[]; activeResumeId: string | null; onSelectResume: (id: string) => void;
  onRemoveResume?: (id: string) => void;
  /** 每份简历当前已有的匹配结果数量，用于显示角标 */
  resultCounts?: Record<string, number>;
}

const ACCEPTED_EXT = /\.(pdf|docx?)$/i;

export function ResumeUploader({ onFileSelected, isUploading, resumes, activeResumeId, onSelectResume, onRemoveResume, resultCounts }: ResumeUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  // 存入人才库：simple state machine per resume（idle→saving→saved/error）
  const [saveState, setSaveState] = useState<Record<string, 'saving' | 'saved' | 'error'>>({});
  const [saveMsg, setSaveMsg] = useState('');
  const atCapacity = resumes.length >= MAX_RESUMES;

  const handleSaveToTalent = async (resume: Resume) => {
    if (saveState[resume.id] === 'saving' || saveState[resume.id] === 'saved') return;
    setSaveState((s) => ({ ...s, [resume.id]: 'saving' }));
    const r = await saveResumeToTalentPool(resume);
    if (r.ok) {
      setSaveState((s) => ({ ...s, [resume.id]: 'saved' }));
      setSaveMsg(`${r.name} 已${r.existed ? '更新到' : '存入'}人才库（简历文件+全文已随附）`);
    } else {
      setSaveState((s) => ({ ...s, [resume.id]: 'error' }));
      setSaveMsg(r.error || '存入失败');
    }
    setTimeout(() => setSaveMsg(''), 5000);
  };

  const pickFile = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    const file = list.find((f) => ACCEPTED_EXT.test(f.name)) || list[0];
    if (file) onFileSelected(file);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (isUploading) return;
    pickFile(e.dataTransfer.files);
  };

  return (
    <div className="space-y-4">
      <div
        onClick={() => { if (!isUploading && !atCapacity) inputRef.current?.click(); }}
        onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); if (!atCapacity) setIsDragging(true); }}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); if (!atCapacity) setIsDragging(true); }}
        onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(false); }}
        onDrop={handleDrop}
        className={cn(
          'flex flex-col items-center justify-center gap-3 p-10 min-h-[220px] border-2 border-dashed rounded-xl cursor-pointer transition-all group',
          isDragging ? 'border-indigo-400 bg-indigo-50/70' : 'border-gray-200 bg-gray-50 hover:border-indigo-300',
          (isUploading || atCapacity) && 'opacity-60 cursor-not-allowed',
        )}
      >
        <div className={cn('w-12 h-12 rounded-xl flex items-center justify-center transition-all', isDragging ? 'bg-indigo-200' : 'bg-indigo-100 group-hover:bg-indigo-200')}>
          <Upload className="w-6 h-6 text-indigo-500" />
        </div>
        <div className="text-center">
          <p className="text-sm text-gray-600">{atCapacity ? `已达上限（${MAX_RESUMES} 份），请先删除` : isDragging ? '松开鼠标即可上传' : '拖拽简历到此处，或点击上传'}</p>
          <p className="text-xs text-gray-400 mt-1">支持 PDF / DOC / DOCX 格式</p>
        </div>
        <input ref={inputRef} type="file" accept=".pdf,.docx,.doc" className="hidden" disabled={isUploading || atCapacity}
          onChange={(e) => { pickFile(e.target.files); e.target.value = ''; }} />
      </div>
      {resumes.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-gray-400 uppercase">已上传简历</p>
            <span className={cn('text-xs font-medium', atCapacity ? 'text-amber-500' : 'text-gray-400')}>{resumes.length}/{MAX_RESUMES}</span>
          </div>
          {resumes.map((r) => (
            <div key={r.id} onClick={() => onSelectResume(r.id)} className={cn('group w-full flex items-center gap-3 p-3 rounded-xl text-left transition-all border cursor-pointer', activeResumeId === r.id ? 'bg-indigo-50 border-indigo-200' : 'bg-white border-gray-100 hover:bg-gray-50')}>
              <FileText className="w-5 h-5 text-gray-400 shrink-0" />
              <div className="flex-1 min-w-0"><p className="text-sm text-gray-700 truncate">{r.fileName}</p><p className={cn('text-xs truncate', r.parsingStatus === 'failed' ? 'text-red-500' : 'text-gray-400')} title={r.parsingStatus === 'failed' ? r.parseError : undefined}>{r.parsingStatus === 'parsing' ? '解析中...' : r.parsingStatus === 'completed' ? `${r.rawText.length} 字符` : r.parsingStatus === 'failed' ? (r.parseError || '解析失败') : '等待解析'}</p></div>
              {resultCounts && resultCounts[r.id] > 0 && (
                <span className="px-1.5 py-0.5 rounded-md bg-indigo-100 text-indigo-600 text-[10px] font-semibold shrink-0" title="已有匹配结果">{resultCounts[r.id]} 条结果</span>
              )}
              {r.parsingStatus === 'parsing' && <Loader2 className="w-4 h-4 text-indigo-500 animate-spin shrink-0" />}
              {r.parsingStatus === 'completed' && (
                <button
                  onClick={(e) => { e.stopPropagation(); handleSaveToTalent(r); }}
                  disabled={saveState[r.id] === 'saving' || saveState[r.id] === 'saved'}
                  className={cn(
                    'shrink-0 flex items-center gap-1 px-2 h-7 rounded-lg text-[11px] font-medium transition-all',
                    saveState[r.id] === 'saved' ? 'bg-green-50 text-green-600'
                      : saveState[r.id] === 'saving' ? 'bg-gray-100 text-gray-400'
                      : 'bg-amber-50 text-amber-600 hover:bg-amber-100',
                  )}
                  title="识别姓名并沉淀到人才库（简历文件+全文一并随附）"
                >
                  {saveState[r.id] === 'saving' ? <Loader2 className="w-3 h-3 animate-spin" />
                    : saveState[r.id] === 'saved' ? <Check className="w-3 h-3" />
                    : <UserPlus className="w-3 h-3" />}
                  {saveState[r.id] === 'saved' ? '已入库' : '存入人才库'}
                </button>
              )}
              {r.parsingStatus === 'failed' && <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />}
              {onRemoveResume && (
                <button
                  onClick={(e) => { e.stopPropagation(); onRemoveResume(r.id); }}
                  className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-all opacity-0 group-hover:opacity-100 shrink-0"
                  title="删除简历"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
          {saveMsg && <p className="text-xs text-amber-600 animate-fade-in">{saveMsg}</p>}
        </div>
      )}
    </div>
  );
}
