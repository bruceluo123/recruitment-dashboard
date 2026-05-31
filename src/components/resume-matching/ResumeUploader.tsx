'use client';
import { Upload, FileText, Loader2, Check, AlertCircle, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import type { Resume } from '@/types/resume';

interface ResumeUploaderProps {
  onFileSelected: (file: File) => void; isUploading: boolean;
  resumes: Resume[]; activeResumeId: string | null; onSelectResume: (id: string) => void;
  onRemoveResume?: (id: string) => void;
}

const ACCEPTED_EXT = /\.(pdf|docx?)$/i;

export function ResumeUploader({ onFileSelected, isUploading, resumes, activeResumeId, onSelectResume, onRemoveResume }: ResumeUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

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
        onClick={() => { if (!isUploading) inputRef.current?.click(); }}
        onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); }}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); }}
        onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(false); }}
        onDrop={handleDrop}
        className={cn(
          'flex flex-col items-center justify-center gap-3 p-10 min-h-[220px] border-2 border-dashed rounded-xl cursor-pointer transition-all group',
          isDragging ? 'border-indigo-400 bg-indigo-50/70' : 'border-gray-200 bg-gray-50 hover:border-indigo-300',
          isUploading && 'opacity-60 cursor-not-allowed',
        )}
      >
        <div className={cn('w-12 h-12 rounded-xl flex items-center justify-center transition-all', isDragging ? 'bg-indigo-200' : 'bg-indigo-100 group-hover:bg-indigo-200')}>
          <Upload className="w-6 h-6 text-indigo-500" />
        </div>
        <div className="text-center">
          <p className="text-sm text-gray-600">{isDragging ? '松开鼠标即可上传' : '拖拽简历到此处，或点击上传'}</p>
          <p className="text-xs text-gray-400 mt-1">支持 PDF / DOCX 格式</p>
        </div>
        <input ref={inputRef} type="file" accept=".pdf,.docx,.doc" className="hidden" disabled={isUploading}
          onChange={(e) => { pickFile(e.target.files); e.target.value = ''; }} />
      </div>
      {resumes.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-gray-400 uppercase">已上传简历</p>
          {resumes.map((r) => (
            <div key={r.id} onClick={() => onSelectResume(r.id)} className={cn('group w-full flex items-center gap-3 p-3 rounded-xl text-left transition-all border cursor-pointer', activeResumeId === r.id ? 'bg-indigo-50 border-indigo-200' : 'bg-white border-gray-100 hover:bg-gray-50')}>
              <FileText className="w-5 h-5 text-gray-400 shrink-0" />
              <div className="flex-1 min-w-0"><p className="text-sm text-gray-700 truncate">{r.fileName}</p><p className={cn('text-xs truncate', r.parsingStatus === 'failed' ? 'text-red-500' : 'text-gray-400')} title={r.parsingStatus === 'failed' ? r.parseError : undefined}>{r.parsingStatus === 'parsing' ? '解析中...' : r.parsingStatus === 'completed' ? `${r.rawText.length} 字符` : r.parsingStatus === 'failed' ? (r.parseError || '解析失败') : '等待解析'}</p></div>
              {r.parsingStatus === 'parsing' && <Loader2 className="w-4 h-4 text-indigo-500 animate-spin shrink-0" />}
              {r.parsingStatus === 'completed' && <Check className="w-4 h-4 text-green-500 shrink-0" />}
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
        </div>
      )}
    </div>
  );
}
