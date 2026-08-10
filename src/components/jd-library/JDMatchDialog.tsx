'use client';
import { useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, Upload, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { JD } from '@/types/jd';
import type { MatchingResult } from '@/types/matching';
import { matchResumeToJDs } from '@/lib/deepseek';
import { useEscapeClose } from '@/hooks/useEscapeClose';

interface JDMatchDialogProps {
  jd: JD | null;
  isOpen: boolean;
  onClose: () => void;
}

const ACCEPTED_EXT = /\.(pdf|docx?)$/i;
const LARGE_FILE_BYTES = 4 * 1024 * 1024;

async function parseResumeFile(file: File): Promise<string> {
  let res: Response;
  if (file.size > LARGE_FILE_BYTES) {
    const { upload } = await import('@vercel/blob/client');
    const blob = await upload(file.name, file, {
      access: 'public',
      handleUploadUrl: '/api/resume/blob-upload',
      contentType: file.type || 'application/octet-stream',
    });
    res = await fetch('/api/resume/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: blob.url, fileName: file.name }),
    });
  } else {
    const fd = new FormData();
    fd.append('file', file);
    res = await fetch('/api/resume/parse', { method: 'POST', body: fd });
  }

  const data = await res.json().catch(() => ({} as { text?: string; error?: string }));
  if (!res.ok || data.error || !data.text) throw new Error(data.error || '简历解析失败');
  return data.text;
}

function scoreTone(score: number): string {
  if (score >= 80) return 'text-emerald-600 bg-emerald-50 border-emerald-100';
  if (score >= 60) return 'text-amber-600 bg-amber-50 border-amber-100';
  return 'text-red-600 bg-red-50 border-red-100';
}

export function JDMatchDialog({ jd, isOpen, onClose }: JDMatchDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<MatchingResult | null>(null);
  useEscapeClose(onClose, isOpen && !loading);

  if (!isOpen || !jd) return null;

  const handleFile = async (file: File | undefined) => {
    if (!file || loading) return;
    if (!ACCEPTED_EXT.test(file.name)) {
      setError('请上传 PDF / DOC / DOCX 简历文件');
      return;
    }
    setLoading(true);
    setError('');
    setResult(null);
    setFileName(file.name);
    try {
      const text = await parseResumeFile(file);
      const results = await matchResumeToJDs(text, [jd], `jd-detail-${Date.now()}`);
      if (!results.length) throw new Error('该岗位按当前匹配规则暂无可用结果，请确认岗位不是暂停状态且缺口大于 0');
      setResult(results[0]);
    } catch (err) {
      setError((err as Error).message || '匹配失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const highlights = result?.highlights || [];
  const concerns = result?.concerns || [];

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/30" />
      <div className="relative w-full max-w-2xl max-h-[88vh] overflow-y-auto bg-white rounded-2xl shadow-2xl border border-gray-200 p-6 animate-fade-in">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">匹配岗位</h3>
            <p className="text-sm text-gray-500 mt-1 truncate max-w-[520px]">{jd.title}</p>
          </div>
          <button onClick={onClose} disabled={loading} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 disabled:opacity-40">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div
          onClick={() => !loading && inputRef.current?.click()}
          onDragEnter={(e) => { e.preventDefault(); setDragging(true); }}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={(e) => { e.preventDefault(); setDragging(false); }}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            handleFile(e.dataTransfer.files?.[0]);
          }}
          className={cn(
            'min-h-[220px] rounded-2xl border-2 border-dashed flex flex-col items-center justify-center gap-3 cursor-pointer transition-all',
            dragging ? 'border-indigo-300 bg-indigo-50/70' : 'border-gray-200 bg-gray-50 hover:border-indigo-300',
            loading && 'opacity-70 cursor-not-allowed',
          )}
        >
          {loading ? <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" /> : <Upload className="w-8 h-8 text-gray-300" />}
          <div className="text-center">
            <p className="text-sm text-gray-500">{loading ? '解析并匹配中...' : '上传简历文件'}</p>
            <p className="text-xs text-gray-400 mt-1">PDF / DOC / DOCX</p>
            {fileName && <p className="text-xs text-indigo-500 mt-2">{fileName}</p>}
          </div>
          <input ref={inputRef} type="file" accept=".pdf,.docx,.doc" className="hidden" disabled={loading}
            onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ''; }} />
        </div>

        {error && (
          <div className="mt-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />{error}
          </div>
        )}

        {result && (
          <div className="mt-5 rounded-2xl border border-gray-100 bg-white shadow-sm p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />匹配结果
              </div>
              <div className={cn('px-3 py-1 rounded-xl border text-lg font-bold', scoreTone(result.score))}>
                {result.score}<span className="text-xs font-medium ml-0.5">分</span>
              </div>
            </div>

            {result.reasoning && <p className="text-sm text-gray-600 leading-relaxed">{result.reasoning}</p>}

            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              {([
                ['技能', result.breakdown.skillsMatch],
                ['经验', result.breakdown.experienceMatch],
                ['方向', result.breakdown.domainMatch],
                ['级别', result.breakdown.seniorityMatch],
                ['整体', result.breakdown.overallFit],
              ] as const).map(([label, value]) => (
                <div key={label} className="rounded-xl bg-gray-50 px-3 py-2">
                  <p className="text-xs text-gray-400">{label}</p>
                  <p className="text-sm font-semibold text-gray-700 mt-0.5">{value}</p>
                </div>
              ))}
            </div>

            {highlights.length > 0 && (
              <div>
                <p className="text-xs font-medium text-emerald-600 mb-1.5">匹配亮点</p>
                <div className="space-y-1">
                  {highlights.map((item, i) => <p key={i} className="text-sm text-gray-600">• {item}</p>)}
                </div>
              </div>
            )}

            {concerns.length > 0 && (
              <div>
                <p className="text-xs font-medium text-amber-600 mb-1.5">风险关注</p>
                <div className="space-y-1">
                  {concerns.map((item, i) => <p key={i} className="text-sm text-gray-600">• {item}</p>)}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
