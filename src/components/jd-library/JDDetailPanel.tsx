'use client';
import { cn, formatSalary, formatDate } from '@/lib/utils';
import { JD_CATEGORY_LABELS, JD_CATEGORY_COLORS, JD_STATUS_LABELS, JD_STATUS_COLORS, type JD, type JDCategory, type JDStatus, ALL_CATEGORIES } from '@/types/jd';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { X, MapPin, Clock, Briefcase, ListChecks, AlertCircle, Copy, Download, Check, Trash2, Pencil, Sparkles, Loader2, Building2, Users, ArrowRight, StickyNote } from 'lucide-react';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useJDStore } from '@/store/jd-store';
import { useCompanyStore } from '@/store/company-store';
import { hasResearch } from '@/types/company';
import { TalentQueryDialog } from '@/components/talent-pool/TalentQueryDialog';
import { useEscapeClose } from '@/hooks/useEscapeClose';
import { normalizeJDCount, normalizeJDSalary, sanitizeJDSalaryText } from '@/lib/jd-parse-core';

interface JDDetailPanelProps { jd: JD | null; isOpen: boolean; onClose: () => void; }

export function JDDetailPanel({ jd, isOpen, onClose }: JDDetailPanelProps) {
  const deleteJD = useJDStore((s) => s.deleteJD);
  const updateJD = useJDStore((s) => s.updateJD);
  const companies = useCompanyStore((s) => s.companies);
  const createBlankCompany = useCompanyStore((s) => s.createBlankCompany);
  const updateCompany = useCompanyStore((s) => s.updateCompany);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResults, setAiResults] = useState<Record<string, string>>({});
  const [showAI, setShowAI] = useState(false);
  const [talentMatchOpen, setTalentMatchOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const jdId = jd?.id || '';
  const aiResult = aiResults[jdId] || null;
  useEscapeClose(onClose, isOpen && !!jd);

  // Reset editing when JD changes
  useEffect(() => { setEditing(false); setConfirmingDelete(false); }, [jdId]);
  const [form, setForm] = useState({
    title: '', department: '', location: '', salary: '',
    categories: [] as JDCategory[], status: 'active' as JDStatus,
    responsibilities: '', requirements: '',
    headcount: '', gap: '',
  });

  if (!jd) return null;

  // 关联公司：用编制组织 / 服务单位 / 部门名去公司库匹配（同名即认定为同一家）
  const orgName = (jd.organization || jd.serviceUnit || jd.department || '').trim();
  const matchedCompany = orgName
    ? companies.find((c) => c.name.trim() === orgName) || null
    : null;
  const talentQuery = [
    (jd.categories || []).includes('ai') || /ai|aigc|agent|openai|claude|gpt|大模型|智能体/i.test(`${jd.title} ${jd.responsibilities.join(' ')}`) ? 'AI' : '',
    /\bgo\b|golang|go语言/i.test(`${jd.title} ${jd.responsibilities.join(' ')}`) ? 'Go' : '',
    /后端|backend|服务端/i.test(jd.title) ? '后端' : '',
    /架构|architect|architecture/i.test(`${jd.title} ${jd.responsibilities.join(' ')}`) ? '架构' : '',
  ].filter(Boolean).join(' + ') || jd.title;

  const handleCreateCompany = () => {
    if (!orgName) return;
    const id = createBlankCompany();
    updateCompany(id, { name: orgName, relatedReqKeys: jd.reqKey ? [jd.reqKey] : [] });
  };

  const startEdit = () => {
    setForm({
      title: jd.title,
      department: jd.department,
      location: jd.location || 'remote',
      salary: sanitizeJDSalaryText(jd.salaryText) || (jd.salaryRange.min ? `${jd.salaryRange.min}K-${jd.salaryRange.max}K` : ''),
      categories: jd.categories.length > 0 ? jd.categories : ['operations'], status: jd.status,
      responsibilities: jd.responsibilities.join('；'),
      requirements: jd.requirements.join('；'),
      headcount: normalizeJDCount(jd.headcount),
      gap: normalizeJDCount(jd.gap),
    });
    setEditing(true);
  };

  const saveEdit = () => {
    if (!form.title.trim()) return;
    const salaryText = form.salary.trim();
    const normalizedSalary = normalizeJDSalary(salaryText);
    updateJD(jd.id, {
      title: form.title.trim(),
      department: form.department.trim(),
      location: form.location.trim() || 'remote',
      categories: form.categories.length > 0 ? form.categories : ['operations'],
      responsibilities: form.responsibilities.split(/[；;。\n\r]+/).map((s) => s.trim()).filter(Boolean),
      requirements: form.requirements.split(/[；;。\n\r]+/).map((s) => s.trim()).filter(Boolean),
      salaryRange: normalizedSalary.salaryRange,
      salaryText: normalizedSalary.salaryText,
      status: form.status,
      headcount: normalizeJDCount(form.headcount) || undefined,
      gap: normalizeJDCount(form.gap) || undefined,
    });
    setEditing(false);
  };

  const handleCopy = async () => {
    const salaryStr = sanitizeJDSalaryText(jd.salaryText) || (jd.salaryRange.min ? formatSalary(jd.salaryRange) : '');
    const sections = [
      jd.responsibilities.length
        ? `岗位职责：\n${jd.responsibilities.map((r, i) => `${i + 1}. ${r}`).join('\n')}`
        : '',
      jd.requirements.length
        ? `任职要求：\n${jd.requirements.map((r, i) => `${i + 1}. ${r}`).join('\n')}`
        : '',
    ].filter(Boolean);
    const text = `${jd.title}${salaryStr ? `\n薪资：${salaryStr}` : ''}${sections.length ? `\n\n${sections.join('\n\n')}` : ''}`;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleAnalyze = async () => {
    setAiLoading(true);
    setShowAI(true);
    try {
      const prompt = `你是资深猎头顾问。请从猎头招聘视角分析以下岗位，提炼 JD 要点。

岗位：${jd.title}
部门：${jd.department || '不限'}
薪资：${sanitizeJDSalaryText(jd.salaryText) || formatSalary(jd.salaryRange)}
${jd.responsibilities.length ? '职责：\n' + jd.responsibilities.map((r, i) => `${i + 1}. ${r}`).join('\n') : ''}
${jd.requirements.length ? '要求：\n' + jd.requirements.map((r, i) => `${i + 1}. ${r}`).join('\n') : ''}

请用中文输出以下内容：
1. **核心技能关键词**（必搜，5-8个）
2. **加分技能**（优先，3-5个）
3. **经验硬指标**
4. **软性要求**
5. **搜索建议**

每项用简洁要点列出，不要大段文字。`;
      const res = await fetch('/api/match', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: prompt }], temperature: 0.3, max_tokens: 1200 }) });
      const data = await res.json();
      if (data?.choices?.[0]?.message?.content) {
        setAiResults((prev) => ({ ...prev, [jdId]: data.choices[0].message.content }));
      } else {
        setAiResults((prev) => ({ ...prev, [jdId]: 'AI 分析暂时不可用，请稍后重试' }));
      }
    } catch {
      setAiResults((prev) => ({ ...prev, [jdId]: '请求失败，请检查网络' }));
    }
    setAiLoading(false);
  };

  const handleDownloadWord = () => {
    const salaryStr = sanitizeJDSalaryText(jd.salaryText) || formatSalary(jd.salaryRange);
    const content = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>${jd.title}</title></head><body><h1>${jd.title}</h1><p><strong>部门：</strong>${jd.department} &nbsp; <strong>地点：</strong>${jd.location || '不限'} &nbsp; <strong>薪资：</strong>${salaryStr}</p><h2>岗位职责</h2><ol>${jd.responsibilities.map((r) => `<li>${r}</li>`).join('')}</ol><h2>岗位要求</h2><ol>${jd.requirements.map((r) => `<li>${r}</li>`).join('')}</ol></body></html>`;
    const blob = new Blob([content], { type: 'application/msword' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${jd.title}.doc`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <>
      {isOpen && <div className="fixed inset-0 bg-black/20 z-40" />}
      <div className={cn(
        'fixed right-0 top-0 h-full w-full max-w-lg bg-white border-l border-gray-200 z-50 transition-transform duration-300 overflow-y-auto shadow-2xl',
        isOpen ? 'translate-x-0' : 'translate-x-full',
      )}>
        <div className="p-6 space-y-6 animate-fade-in">
          {/* Header */}
          <div className="flex items-start justify-between">
            <div className="space-y-2 flex-1">
              {editing ? (
                <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="w-full text-xl font-bold text-gray-900 px-3 py-1.5 rounded-lg border border-gray-200 focus:outline-none focus:border-indigo-300" />
              ) : (
                <h2 className="text-xl font-bold text-gray-900">{jd.title}</h2>
              )}
              <div className="flex items-center gap-2">
                {editing ? (
                  <div className="flex flex-wrap gap-1 max-w-[360px]">
                    {ALL_CATEGORIES.map((cat) => {
                      const selected = form.categories.includes(cat);
                      return (
                        <button key={cat} type="button"
                          onClick={() => setForm({
                            ...form,
                            categories: selected ? form.categories.filter((item) => item !== cat) : [...form.categories, cat],
                          })}
                          className={cn(
                            'px-2 py-0.5 rounded-md text-xs font-medium border transition-all',
                            selected ? JD_CATEGORY_COLORS[cat] : 'bg-white text-gray-400 border-gray-200 hover:border-gray-300',
                          )}
                        >
                          {JD_CATEGORY_LABELS[cat]}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <>{jd.categories.map((cat: JDCategory) => (
                    <span key={cat} className={cn('px-2 py-0.5 rounded-md text-xs font-medium', JD_CATEGORY_COLORS[cat])}>
                      {JD_CATEGORY_LABELS[cat]}
                    </span>
                  ))}</>
                )}
                {editing ? (
                  <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as JDStatus })}
                    className="px-2 py-0.5 rounded-md text-xs font-medium border border-gray-200 bg-white">
                    {(['active', 'urgent', 'paused'] as JDStatus[]).map((s) => (
                      <option key={s} value={s}>{JD_STATUS_LABELS[s]}</option>
                    ))}
                  </select>
                ) : (
                  <span className={cn('inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs', JD_STATUS_COLORS[jd.status])}>
                    <span className={cn('w-1.5 h-1.5 rounded-full', jd.status === 'urgent' ? 'bg-red-500' : jd.status === 'active' ? 'bg-green-500' : 'bg-gray-400')} />
                    {JD_STATUS_LABELS[jd.status]}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1">
              {editing ? (
                <>
                  <button onClick={saveEdit} className="px-3 py-1.5 rounded-lg bg-indigo-500 text-white text-xs font-medium hover:bg-indigo-600">
                    <Check className="w-3.5 h-3.5 inline mr-1" />保存
                  </button>
                  <button onClick={() => setEditing(false)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400">
                    <X className="w-5 h-5" />
                  </button>
                </>
              ) : (
                <>
                  <button onClick={() => setTalentMatchOpen(true)}
                    className="h-9 px-3 rounded-lg bg-indigo-50 text-indigo-600 text-xs font-medium hover:bg-indigo-100 transition-all flex items-center gap-1.5" title="从人才库匹配该岗位">
                    <Users className="w-4 h-4" />找人才
                  </button>
                  <button onClick={() => { if (aiResult) { setShowAI(!showAI); } else if (!aiLoading) { handleAnalyze(); } }}
                    className={`p-2 rounded-lg transition-all ${showAI ? 'bg-indigo-50 text-indigo-500' : 'hover:bg-gray-100 text-gray-400 hover:text-indigo-500'}`} title="JD要点">
                    <Sparkles className="w-5 h-5" />
                  </button>
                  <button onClick={startEdit} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-indigo-500" title="编辑">
                    <Pencil className="w-5 h-5" />
                  </button>
                  <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400"><X className="w-5 h-5" /></button>
                </>
              )}
            </div>
          </div>

          {/* Meta */}
          <div className="grid grid-cols-2 gap-3">
            {editing ? (
              <>
                <InfoTileEdit icon={Briefcase} label="部门" value={form.department} onChange={(v) => setForm({ ...form, department: v })} />
                <InfoTileEdit icon={MapPin} label="地点" value={form.location} onChange={(v) => setForm({ ...form, location: v })} />
                <InfoTileEdit icon={AlertCircle} label="薪资" value={form.salary} onChange={(v) => setForm({ ...form, salary: v })} placeholder="20K-40K" />
                <InfoTileEdit icon={Users} label="HC" value={form.headcount} onChange={(v) => setForm({ ...form, headcount: v })} placeholder="1" />
                <InfoTileEdit icon={AlertCircle} label="缺口" value={form.gap} onChange={(v) => setForm({ ...form, gap: v })} placeholder="1" />
              </>
            ) : (
              <>
                <InfoTile icon={Briefcase} label="服务单位" value={jd.serviceUnit || jd.department || '-'} />
                <InfoTile icon={MapPin} label="地点" value={jd.location || 'remote'} />
                <InfoTile icon={AlertCircle} label="薪资" value={sanitizeJDSalaryText(jd.salaryText) || (jd.salaryRange.min ? formatSalary(jd.salaryRange) : '-')} />
              </>
            )}
            <InfoTile icon={Clock} label="更新" value={formatDate(jd.updatedAt)} />
            {(jd.organization || normalizeJDCount(jd.headcount) || normalizeJDCount(jd.gap)) && (
              <>
                {jd.organization && <InfoTile icon={Building2} label="编制组织" value={jd.organization} />}
                {normalizeJDCount(jd.headcount) && <InfoTile icon={Users} label="HC" value={normalizeJDCount(jd.headcount)} />}
                {normalizeJDCount(jd.gap) && <InfoTile icon={AlertCircle} label="缺口" value={normalizeJDCount(jd.gap)} />}
              </>
            )}
          </div>

          {/* 备注说明 */}
          {jd.notes && (
            <GlassPanel padding="md">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-800 mb-2">
                <StickyNote className="w-4 h-4 text-amber-500" />备注说明
              </h3>
              <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-line">{jd.notes}</p>
            </GlassPanel>
          )}

          {/* AI Analysis */}
          {showAI && (
            <GlassPanel padding="md">
              <div className="flex items-center justify-between mb-3">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-800">
                  <Sparkles className="w-4 h-4 text-indigo-500" />JD 要点（猎头视角）
                </h3>
                <button onClick={() => setShowAI(false)} className="text-xs text-gray-400 hover:text-gray-600">收起</button>
              </div>
              {aiLoading ? (
                <div className="flex items-center gap-3 py-4 text-gray-500">
                  <Loader2 className="w-5 h-5 animate-spin text-indigo-500" />
                  <span className="text-sm">AI 正在分析 JD 要点...</span>
                </div>
              ) : aiResult ? (
                <div className="text-sm text-gray-600 leading-relaxed whitespace-pre-line">{aiResult}</div>
              ) : null}
            </GlassPanel>
          )}

          {/* Responsibilities */}
          <GlassPanel padding="md">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-800 mb-3">
              <ListChecks className="w-4 h-4 text-indigo-500" />岗位职责
            </h3>
            {editing ? (
              <textarea value={form.responsibilities} onChange={(e) => setForm({ ...form, responsibilities: e.target.value })}
                rows={5} placeholder="用分号；分隔多条职责" className="w-full px-4 py-2 rounded-xl bg-white border border-gray-200 text-sm focus:outline-none focus:border-indigo-300 resize-none" />
            ) : (
              jd.responsibilities.length ? (
                <ul className="space-y-2">
                  {jd.responsibilities.map((r, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                      <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-600 text-xs flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>{r}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className={cn(
                  'flex items-center gap-2 rounded-lg px-3 py-2 text-sm',
                  jd.requirements.length ? 'bg-gray-50 text-gray-500' : 'bg-amber-50 text-amber-700',
                )}>
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {jd.requirements.length ? '该岗位未单列职责，请查看下方任职要求。' : '该岗位源数据暂未提供 JD，请点击右上角编辑补充。'}
                </div>
              )
            )}
          </GlassPanel>

          {(editing || jd.requirements.length > 0) && (
            <GlassPanel padding="md">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-800 mb-3">
                <AlertCircle className="w-4 h-4 text-indigo-500" />任职要求
              </h3>
              {editing ? (
                <textarea value={form.requirements} onChange={(e) => setForm({ ...form, requirements: e.target.value })}
                  rows={5} placeholder="用分号；分隔多条要求" className="w-full px-4 py-2 rounded-xl bg-white border border-gray-200 text-sm focus:outline-none focus:border-indigo-300 resize-none" />
              ) : (
                <ul className="space-y-2">
                  {jd.requirements.map((r, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                      <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-600 text-xs flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>{r}
                    </li>
                  ))}
                </ul>
              )}
            </GlassPanel>
          )}

          {/* 关联公司研究 */}
          {!editing && orgName && (
            <GlassPanel padding="md">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-800 mb-3">
                <Building2 className="w-4 h-4 text-indigo-500" />公司研究
                <span className="text-xs font-normal text-gray-400">{orgName}</span>
              </h3>
              {matchedCompany ? (
                <div className="space-y-3">
                  {hasResearch(matchedCompany) ? (
                    <div className="space-y-2">
                      {matchedCompany.dims.filter((d) => d.body.trim()).slice(0, 3).map((d) => (
                        <div key={d.key} className="text-sm">
                          <p className="text-xs font-medium text-gray-500 mb-0.5">{d.key}. {d.title}</p>
                          <p className="text-gray-600 line-clamp-2 whitespace-pre-line">{d.body}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-400">该公司已建档，但还没有研究内容。</p>
                  )}
                  <Link href="/companies" className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-700 font-medium">
                    在公司库查看完整 11 维度<ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm text-gray-400">公司库暂无「{orgName}」。</p>
                  <button onClick={handleCreateCompany}
                    className="h-9 px-3 rounded-lg bg-indigo-500 text-white text-xs font-medium hover:bg-indigo-600 transition-all whitespace-nowrap">
                    建档到公司库
                  </button>
                </div>
              )}
            </GlassPanel>
          )}

          {/* Action Buttons */}
          {!editing && (
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
              {confirmingDelete ? (
                <>
                  <button onClick={() => { deleteJD(jd.id); setConfirmingDelete(false); onClose(); }}
                    className="h-11 px-4 rounded-xl bg-red-500 text-white text-sm font-medium hover:bg-red-600 transition-all flex items-center justify-center gap-1.5">
                    <Trash2 className="w-4 h-4" />确认删除
                  </button>
                  <button onClick={() => setConfirmingDelete(false)}
                    className="h-11 px-4 rounded-xl bg-white border border-gray-200 text-gray-500 text-sm font-medium hover:bg-gray-50 transition-all">
                    取消
                  </button>
                </>
              ) : (
                <button onClick={() => setConfirmingDelete(true)}
                  className="h-11 px-4 rounded-xl bg-white border border-red-200 text-red-500 text-sm font-medium hover:bg-red-50 transition-all flex items-center justify-center gap-1.5">
                  <Trash2 className="w-4 h-4" />删除
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      <TalentQueryDialog isOpen={talentMatchOpen} onClose={() => setTalentMatchOpen(false)} initialQuery={talentQuery} />
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

function InfoTileEdit({ icon: Icon, label, value, onChange, placeholder }: { icon: React.ElementType; label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="p-3 rounded-xl bg-gray-50">
      <div className="flex items-center gap-1.5 mb-1"><Icon className="w-3.5 h-3.5 text-gray-400" /><span className="text-xs text-gray-500">{label}</span></div>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="w-full text-sm font-medium text-gray-800 bg-transparent border-b border-gray-200 focus:outline-none focus:border-indigo-300" />
    </div>
  );
}
