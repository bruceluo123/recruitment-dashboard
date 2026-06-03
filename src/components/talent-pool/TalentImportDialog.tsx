'use client';
import { useState } from 'react';
import { X, Upload, AlertCircle, Check, Loader2, FileText } from 'lucide-react';
import { useTalentStore } from '@/store/talent-store';
import type { TalentImportResult } from '@/types/talent';

interface TalentImportDialogProps { isOpen: boolean; onClose: () => void; }

export function TalentImportDialog({ isOpen, onClose }: TalentImportDialogProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [result, setResult] = useState<TalentImportResult | null>(null);
  const isImporting = useTalentStore((s) => s.isImporting);
  const progress = useTalentStore((s) => s.importProgress);
  const importFromFiles = useTalentStore((s) => s.importFromFiles);
  const cancelImport = useTalentStore((s) => s.cancelImport);

  if (!isOpen) return null;

  const handleImport = async () => {
    if (!files.length) return;
    setResult(null);
    const res = await importFromFiles(files);
    setResult(res);
    setFiles([]);
  };

  const statusLabel = '上传简历中...';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/30" onClick={isImporting ? undefined : onClose} />
      <div className="relative w-full max-w-lg bg-white border border-gray-200 rounded-2xl shadow-xl animate-fade-in">
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-800">批量导入简历</h2>
          {!isImporting && <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>}
        </div>

        <div className="p-6 space-y-4">
          {isImporting && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600 flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />{statusLabel}
                </span>
                <span className="text-gray-400">{progress.current}/{progress.total}</span>
              </div>
              <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-indigo-500 to-cyan-500 rounded-full transition-all duration-150" style={{ width: `${progress.percent}%` }} />
              </div>
              <button onClick={cancelImport} className="w-full h-9 rounded-xl border border-red-200 text-red-500 text-sm font-medium hover:bg-red-50 transition-all">
                取消导入
              </button>
            </div>
          )}

          {!isImporting && (
            <>
              <label className="flex flex-col items-center justify-center gap-3 p-8 border-2 border-dashed border-gray-200 rounded-xl cursor-pointer hover:border-indigo-300 transition-all bg-gray-50">
                <Upload className="w-8 h-8 text-gray-400" />
                <div className="text-center">
                  <p className="text-sm text-gray-600">点击选择多个简历文件批量上传</p>
                  <p className="text-xs text-gray-400 mt-1">支持 PDF / DOCX，单次最多 2000 份，先快速上传，AI 精准分类在「扫描识别简历」时进行</p>
                </div>
                <input type="file" accept=".pdf,.docx" multiple className="hidden"
                  onChange={(e) => setFiles(Array.from(e.target.files || []))} />
              </label>
              {files.length > 0 && (
                <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-3 max-h-32 overflow-y-auto">
                  <p className="text-xs font-medium text-indigo-700 mb-1.5">已选择 {files.length} 个文件</p>
                  <ul className="space-y-0.5">
                    {files.slice(0, 8).map((f, i) => (
                      <li key={i} className="text-xs text-gray-600 flex items-center gap-1.5 truncate"><FileText className="w-3 h-3 shrink-0" />{f.name}</li>
                    ))}
                    {files.length > 8 && <li className="text-xs text-gray-400">…等共 {files.length} 个</li>}
                  </ul>
                </div>
              )}
              <button onClick={handleImport} disabled={!files.length}
                className="w-full h-10 rounded-xl bg-indigo-500 text-white text-sm font-medium hover:bg-indigo-600 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                <Upload className="w-4 h-4" />开始导入 {files.length > 0 ? `(${files.length})` : ''}
              </button>
            </>
          )}

          {result && !isImporting && (
            <div className={`p-4 rounded-xl border ${result.failed === 0 ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
              <div className="flex items-center gap-2 mb-2">
                {result.failed === 0 ? <Check className="w-5 h-5 text-green-500" /> : <AlertCircle className="w-5 h-5 text-amber-500" />}
                <span className="text-sm font-medium text-gray-800">成功 {result.success} 份{result.failed > 0 && `，失败 ${result.failed} 份`}</span>
              </div>
              {result.errors.length > 0 && (
                <ul className="space-y-0.5 mt-2">{result.errors.slice(0, 5).map((e, i) => <li key={i} className="text-xs text-red-500">{e}</li>)}</ul>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
