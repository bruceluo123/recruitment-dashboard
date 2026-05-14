'use client';
import { Upload, FileText, Loader2, Check, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Resume } from '@/types/resume';

interface ResumeUploaderProps {
  onFileSelected: (file: File) => void; isUploading: boolean;
  resumes: Resume[]; activeResumeId: string | null; onSelectResume: (id: string) => void;
}

export function ResumeUploader({ onFileSelected, isUploading, resumes, activeResumeId, onSelectResume }: ResumeUploaderProps) {
  return (
    <div className="space-y-4">
      <label className="flex flex-col items-center justify-center gap-3 p-8 border-2 border-dashed border-gray-200 rounded-xl cursor-pointer hover:border-indigo-300 transition-all bg-gray-50 group">
        <div className="w-12 h-12 rounded-xl bg-indigo-100 flex items-center justify-center group-hover:bg-indigo-200 transition-all"><Upload className="w-6 h-6 text-indigo-500" /></div>
        <div className="text-center"><p className="text-sm text-gray-600">拖拽或点击上传简历</p><p className="text-xs text-gray-400 mt-1">支持 PDF / DOCX 格式</p></div>
        <input type="file" accept=".pdf,.docx" className="hidden" disabled={isUploading} onChange={(e) => { const f = e.target.files?.[0]; if (f) onFileSelected(f); }} />
      </label>
      {resumes.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-gray-400 uppercase">已上传简历</p>
          {resumes.map((r) => (
            <button key={r.id} onClick={() => onSelectResume(r.id)} className={cn('w-full flex items-center gap-3 p-3 rounded-xl text-left transition-all border', activeResumeId === r.id ? 'bg-indigo-50 border-indigo-200' : 'bg-white border-gray-100 hover:bg-gray-50')}>
              <FileText className="w-5 h-5 text-gray-400 shrink-0" />
              <div className="flex-1 min-w-0"><p className="text-sm text-gray-700 truncate">{r.fileName}</p><p className="text-xs text-gray-400">{r.parsingStatus === 'parsing' ? '解析中...' : r.parsingStatus === 'completed' ? `${r.rawText.length} 字符` : r.parsingStatus === 'failed' ? '解析失败' : '等待解析'}</p></div>
              {r.parsingStatus === 'parsing' && <Loader2 className="w-4 h-4 text-indigo-500 animate-spin" />}
              {r.parsingStatus === 'completed' && <Check className="w-4 h-4 text-green-500" />}
              {r.parsingStatus === 'failed' && <AlertCircle className="w-4 h-4 text-red-500" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
