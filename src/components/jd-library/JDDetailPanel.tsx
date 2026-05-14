'use client';
import { cn, formatSalary, formatDate } from '@/lib/utils';
import { JD_CATEGORY_LABELS, JD_CATEGORY_COLORS, type JD } from '@/types/jd';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { X, MapPin, Clock, Briefcase, ListChecks, AlertCircle, Copy, Download, Check, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useJDStore } from '@/store/jd-store';

interface JDDetailPanelProps { jd: JD | null; isOpen: boolean; onClose: () => void; }

export function JDDetailPanel({ jd, isOpen, onClose }: JDDetailPanelProps) {
  const deleteJD = useJDStore((s) => s.deleteJD);
  const [copied, setCopied] = useState(false);

  if (!jd) return null;

  const handleCopy = async () => {
    const text = `${jd.title}\n\n岗位职责：\n${jd.responsibilities.map((r, i) => `${i + 1}. ${r}`).join('\n')}\n\n岗位需求：\n${jd.requirements.map((r, i) => `${i + 1}. ${r}`).join('\n')}`;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadWord = () => {
    const content = `
      <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
      <head><meta charset="utf-8"><title>${jd.title}</title></head>
      <body>
        <h1>${jd.title}</h1>
        <p><strong>部门：</strong>${jd.department} &nbsp; <strong>地点：</strong>${jd.location || '不限'} &nbsp; <strong>薪资：</strong>${formatSalary(jd.salaryRange)}</p>
        <h2>岗位职责</h2><ol>${jd.responsibilities.map((r) => `<li>${r}</li>`).join('')}</ol>
        <h2>岗位需求</h2><ol>${jd.requirements.map((r) => `<li>${r}</li>`).join('')}</ol>
      </body></html>`;
    const blob = new Blob([content], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${jd.title}.doc`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      {isOpen && <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />}
      <div className={cn(
        'fixed right-0 top-0 h-full w-full max-w-lg bg-white border-l border-gray-200 z-50 transition-transform duration-300 overflow-y-auto shadow-2xl',
        isOpen ? 'translate-x-0' : 'translate-x-full',
      )}>
        <div className="p-6 space-y-6 animate-fade-in">
          <div className="flex items-start justify-between">
            <div className="space-y-2 flex-1">
              <h2 className="text-xl font-bold text-gray-900">{jd.title}</h2>
              <div className="flex items-center gap-2 flex-wrap">
                <span className={cn('px-2 py-0.5 rounded-md text-xs font-medium', JD_CATEGORY_COLORS[jd.category])}>
                  {JD_CATEGORY_LABELS[jd.category]}
                </span>
                <span className={cn('inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs', jd.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500')}>
                  <span className={cn('w-1.5 h-1.5 rounded-full', jd.isActive ? 'bg-green-500' : 'bg-gray-400')} />
                  {jd.isActive ? '招聘中' : '已关闭'}
                </span>
              </div>
            </div>
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-all"><X className="w-5 h-5" /></button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <InfoTile icon={Briefcase} label="部门" value={jd.department} />
            <InfoTile icon={MapPin} label="地点" value={jd.location || '不限'} />
            <InfoTile icon={AlertCircle} label="薪资" value={formatSalary(jd.salaryRange)} />
            <InfoTile icon={Clock} label="发布" value={formatDate(jd.createdAt)} />
          </div>

          <GlassPanel padding="md">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-800 mb-3"><ListChecks className="w-4 h-4 text-indigo-500" />岗位职责</h3>
            <ul className="space-y-2">
              {jd.responsibilities.map((r, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                  <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-600 text-xs flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                  {r}
                </li>
              ))}
            </ul>
          </GlassPanel>

          <GlassPanel padding="md">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-800 mb-3"><AlertCircle className="w-4 h-4 text-amber-500" />岗位要求</h3>
            <ul className="space-y-2">
              {jd.requirements.map((r, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                  <span className="w-5 h-5 rounded-full bg-amber-100 text-amber-600 text-xs flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                  {r}
                </li>
              ))}
            </ul>
          </GlassPanel>

          {/* Action Buttons */}
          <div className="flex gap-3 pt-2">
            <button onClick={handleCopy} className={cn(
              'flex-1 h-11 rounded-xl text-sm font-medium transition-all flex items-center justify-center gap-2',
              copied ? 'bg-green-500 text-white' : 'bg-indigo-500 text-white hover:bg-indigo-600',
            )}>
              {copied ? <><Check className="w-4 h-4" />已复制</> : <><Copy className="w-4 h-4" />一键复制</>}
            </button>
            <button onClick={handleDownloadWord} className="flex-1 h-11 rounded-xl bg-white border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-all flex items-center justify-center gap-2">
              <Download className="w-4 h-4" />下载 Word
            </button>
            <button onClick={() => { deleteJD(jd.id); onClose(); }}
              className="h-11 px-4 rounded-xl bg-white border border-red-200 text-red-500 text-sm font-medium hover:bg-red-50 transition-all flex items-center justify-center gap-1.5">
              <Trash2 className="w-4 h-4" />删除
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function InfoTile({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="p-3 rounded-xl bg-gray-50">
      <div className="flex items-center gap-1.5 mb-1"><Icon className="w-3.5 h-3.5 text-gray-400" /><span className="text-xs text-gray-500">{label}</span></div>
      <p className="text-sm font-medium text-gray-800">{value}</p>
    </div>
  );
}
