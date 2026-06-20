'use client';
import { useState, useEffect } from 'react';
import { cn, formatDate } from '@/lib/utils';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { useCompanyStore } from '@/store/company-store';
import { JD_CATEGORY_LABELS, JD_CATEGORY_COLORS, ALL_CATEGORIES, type JDCategory } from '@/types/jd';
import type { Company, CompanyDimension, CompanySource } from '@/types/company';
import { emptyDimensions } from '@/types/company';
import { X, Pencil, Check, Trash2, Copy, Link as LinkIcon, Building2, Clock, FileSearch } from 'lucide-react';

interface CompanyDetailPanelProps { company: Company | null; isOpen: boolean; onClose: () => void; }

/** 把信息源序列化成「标题 - url」每行一条，供编辑 */
function sourcesToText(sources: CompanySource[]): string {
  return sources.map((s) => (s.title ? `${s.title} - ${s.url}` : s.url)).join('\n');
}

/** 解析「标题 - url」文本回信息源数组 */
function textToSources(text: string): CompanySource[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const m = line.match(/^(.*?)\s*[-—]\s*(https?:\/\/\S+)$/);
    if (m) return { title: m[1].trim(), url: m[2].trim() };
    const urlMatch = line.match(/https?:\/\/\S+/);
    return urlMatch ? { title: line.replace(urlMatch[0], '').replace(/[-—\s]+$/, '').trim(), url: urlMatch[0] } : { title: line, url: '' };
  });
}

export function CompanyDetailPanel({ company, isOpen, onClose }: CompanyDetailPanelProps) {
  const updateCompany = useCompanyStore((s) => s.updateCompany);
  const deleteCompany = useCompanyStore((s) => s.deleteCompany);
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const companyId = company?.id || '';

  const [form, setForm] = useState({
    name: '', industry: '', summary: '',
    categories: [] as JDCategory[],
    dimBodies: [] as string[],
    dimSources: [] as string[],
  });

  useEffect(() => { setEditing(false); setConfirmingDelete(false); }, [companyId]);

  if (!company) return null;

  const dims = company.dims && company.dims.length ? company.dims : emptyDimensions();

  const startEdit = () => {
    const filled = company.dims && company.dims.length ? company.dims : emptyDimensions();
    setForm({
      name: company.name,
      industry: company.industry || '',
      summary: company.summary || '',
      categories: company.categories || [],
      dimBodies: filled.map((d) => d.body),
      dimSources: filled.map((d) => sourcesToText(d.sources || [])),
    });
    setEditing(true);
  };

  const saveEdit = () => {
    if (!form.name.trim()) return;
    const base = emptyDimensions();
    const nextDims: CompanyDimension[] = base.map((d, i) => ({
      key: d.key,
      title: d.title,
      body: (form.dimBodies[i] || '').trim(),
      sources: textToSources(form.dimSources[i] || ''),
    }));
    updateCompany(company.id, {
      name: form.name.trim(),
      industry: form.industry.trim() || undefined,
      summary: form.summary.trim() || undefined,
      categories: form.categories,
      dims: nextDims,
    });
    setEditing(false);
  };

  const handleCopy = async () => {
    const blocks = dims.filter((d) => d.body.trim()).map((d) => {
      const src = (d.sources || []).filter((s) => s.url || s.title)
        .map((s, i) => `  ${i + 1}. ${s.title ? `${s.title} - ` : ''}${s.url}`).join('\n');
      return `${d.key}. ${d.title}：\n${d.body}${src ? `\n信息源：\n${src}` : ''}`;
    });
    const text = `${company.name}${company.industry ? `（${company.industry}）` : ''}\n\n${blocks.join('\n\n')}`;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      {isOpen && <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />}
      <div className={cn(
        'fixed right-0 top-0 h-full w-full max-w-xl bg-white border-l border-gray-200 z-50 transition-transform duration-300 overflow-y-auto shadow-2xl',
        isOpen ? 'translate-x-0' : 'translate-x-full',
      )}>
        <div className="p-6 space-y-5 animate-fade-in">
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-2 flex-1 min-w-0">
              {editing ? (
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full text-xl font-bold text-gray-900 px-3 py-1.5 rounded-lg border border-gray-200 focus:outline-none focus:border-indigo-300" />
              ) : (
                <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                  <Building2 className="w-5 h-5 text-indigo-500 shrink-0" />{company.name}
                </h2>
              )}
              <div className="flex flex-wrap items-center gap-1.5">
                {editing ? (
                  <div className="flex flex-wrap gap-1 max-w-[420px]">
                    {ALL_CATEGORIES.map((cat) => {
                      const selected = form.categories.includes(cat);
                      return (
                        <button key={cat} type="button"
                          onClick={() => setForm({ ...form, categories: selected ? form.categories.filter((c) => c !== cat) : [...form.categories, cat] })}
                          className={cn('px-2 py-0.5 rounded-md text-xs font-medium border transition-all',
                            selected ? JD_CATEGORY_COLORS[cat] : 'bg-white text-gray-400 border-gray-200 hover:border-gray-300')}>
                          {JD_CATEGORY_LABELS[cat]}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  (company.categories || []).map((cat) => (
                    <span key={cat} className={cn('px-2 py-0.5 rounded-md text-xs font-medium', JD_CATEGORY_COLORS[cat])}>{JD_CATEGORY_LABELS[cat]}</span>
                  ))
                )}
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {editing ? (
                <>
                  <button onClick={saveEdit} className="px-3 py-1.5 rounded-lg bg-indigo-500 text-white text-xs font-medium hover:bg-indigo-600">
                    <Check className="w-3.5 h-3.5 inline mr-1" />保存
                  </button>
                  <button onClick={() => setEditing(false)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400"><X className="w-5 h-5" /></button>
                </>
              ) : (
                <>
                  <button onClick={startEdit} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-indigo-500" title="编辑"><Pencil className="w-5 h-5" /></button>
                  <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400"><X className="w-5 h-5" /></button>
                </>
              )}
            </div>
          </div>

          {/* Meta */}
          <div className="grid grid-cols-2 gap-3">
            {editing ? (
              <div className="p-3 rounded-xl bg-gray-50">
                <div className="flex items-center gap-1.5 mb-1"><Building2 className="w-3.5 h-3.5 text-gray-400" /><span className="text-xs text-gray-500">行业</span></div>
                <input value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} placeholder="如 AI / 医疗健康"
                  className="w-full text-sm font-medium text-gray-800 bg-transparent border-b border-gray-200 focus:outline-none focus:border-indigo-300" />
              </div>
            ) : (
              <div className="p-3 rounded-xl bg-gray-50">
                <div className="flex items-center gap-1.5 mb-1"><Building2 className="w-3.5 h-3.5 text-gray-400" /><span className="text-xs text-gray-500">行业</span></div>
                <p className="text-sm font-medium text-gray-800">{company.industry || '-'}</p>
              </div>
            )}
            <div className="p-3 rounded-xl bg-gray-50">
              <div className="flex items-center gap-1.5 mb-1"><Clock className="w-3.5 h-3.5 text-gray-400" /><span className="text-xs text-gray-500">更新</span></div>
              <p className="text-sm font-medium text-gray-800">{formatDate(company.updatedAt)}{company.researchedBy ? ` · ${company.researchedBy}` : ''}</p>
            </div>
          </div>

          {/* Summary */}
          {editing ? (
            <div className="p-3 rounded-xl bg-gray-50">
              <span className="text-xs text-gray-500">一句话备注（非投资判断）</span>
              <input value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })}
                className="w-full mt-1 text-sm text-gray-800 bg-transparent border-b border-gray-200 focus:outline-none focus:border-indigo-300" />
            </div>
          ) : company.summary ? (
            <p className="text-sm text-gray-600 px-1">{company.summary}</p>
          ) : null}

          {/* 11 Dimensions */}
          <div className="space-y-3">
            {dims.map((d, i) => (
              <GlassPanel key={d.key} padding="md">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-800 mb-2">
                  <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-600 text-xs flex items-center justify-center shrink-0">{d.key}</span>
                  {d.title}
                </h3>
                {editing ? (
                  <div className="space-y-2">
                    <textarea value={form.dimBodies[i] || ''} rows={4}
                      onChange={(e) => setForm({ ...form, dimBodies: form.dimBodies.map((b, k) => k === i ? e.target.value : b) })}
                      placeholder="该维度信息..." className="w-full px-3 py-2 rounded-lg bg-white border border-gray-200 text-sm focus:outline-none focus:border-indigo-300 resize-none" />
                    <textarea value={form.dimSources[i] || ''} rows={2}
                      onChange={(e) => setForm({ ...form, dimSources: form.dimSources.map((s, k) => k === i ? e.target.value : s) })}
                      placeholder="信息源，每行一条：标题 - https://..." className="w-full px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 text-xs focus:outline-none focus:border-indigo-300 resize-none" />
                  </div>
                ) : d.body.trim() ? (
                  <>
                    <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-line">{d.body}</p>
                    {(d.sources || []).filter((s) => s.url).length > 0 && (
                      <div className="mt-3 pt-3 border-t border-gray-100 space-y-1.5">
                        <p className="text-xs font-medium text-gray-400">信息源</p>
                        {(d.sources || []).filter((s) => s.url).map((s, k) => (
                          <a key={k} href={s.url} target="_blank" rel="noopener noreferrer"
                            className="flex items-start gap-1.5 text-xs text-indigo-600 hover:text-indigo-700 hover:underline">
                            <LinkIcon className="w-3 h-3 shrink-0 mt-0.5" /><span className="truncate">{s.title || s.url}</span>
                          </a>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-gray-300">未填写</p>
                )}
              </GlassPanel>
            ))}
          </div>

          {/* Actions */}
          {!editing && (
            <div className="flex gap-3 pt-1">
              <button onClick={handleCopy} className={cn(
                'flex-1 h-11 rounded-xl text-sm font-medium transition-all flex items-center justify-center gap-2',
                copied ? 'bg-green-500 text-white' : 'bg-indigo-500 text-white hover:bg-indigo-600')}>
                {copied ? <><Check className="w-4 h-4" />已复制</> : <><Copy className="w-4 h-4" />复制全部</>}
              </button>
              {confirmingDelete ? (
                <>
                  <button onClick={() => { deleteCompany(company.id); setConfirmingDelete(false); onClose(); }}
                    className="h-11 px-4 rounded-xl bg-red-500 text-white text-sm font-medium hover:bg-red-600 transition-all flex items-center justify-center gap-1.5">
                    <Trash2 className="w-4 h-4" />确认删除
                  </button>
                  <button onClick={() => setConfirmingDelete(false)} className="h-11 px-4 rounded-xl bg-white border border-gray-200 text-gray-500 text-sm font-medium hover:bg-gray-50 transition-all">取消</button>
                </>
              ) : (
                <button onClick={() => setConfirmingDelete(true)}
                  className="h-11 px-4 rounded-xl bg-white border border-red-200 text-red-500 text-sm font-medium hover:bg-red-50 transition-all flex items-center justify-center gap-1.5">
                  <Trash2 className="w-4 h-4" />删除
                </button>
              )}
            </div>
          )}

          {!editing && dims.every((d) => !d.body.trim()) && (
            <div className="flex flex-col items-center gap-2 py-6 text-gray-400">
              <FileSearch className="w-8 h-8" />
              <p className="text-sm">暂无研究内容，点击编辑录入，或用公司研究 skill 自动写入</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
