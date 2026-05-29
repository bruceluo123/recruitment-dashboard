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
}

const EMPTY: EditForm = { name: '', jobTitle: '', categories: [], tg: '', notes: '', resumeUrl: '', resumeFileName: '' };

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
    updateTalent(talent.id, {
      name: form.name.trim(),
      jobTitle: form.jobTitle.trim(),
      categories: form.categories.length > 0 ? form.categories : ['operations'],
      tg: form.tg.trim(),
      notes: form.notes.trim(),
      resumeUrl: form.resumeUrl || undefined,
      resumeFileName: form.resumeFileName || undefined,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/20" onClick={onClose} />
      <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto bg-white border border-gray-200 rounded-2xl shadow-xl p-6 animate-fade-in">
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
