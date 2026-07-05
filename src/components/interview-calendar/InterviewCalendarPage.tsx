'use client';
import { useEffect, useMemo, useState } from 'react';
import { StageKanbanBoard } from './StageKanbanBoard';
import { WeekGridView } from './WeekGridView';
import { useInterviewStore } from '@/store/interview-store';
import { useJDStore } from '@/store/jd-store';
import { useRepushStore } from '@/store/repush-store';
import { usePrefStore } from '@/store/pref-store';
import type { CandidateStatus, CandidateOwner, CandidateOutcome } from '@/types/interview';
import { OUTCOME_LABELS, OUTCOME_COLORS, ALL_OUTCOMES } from '@/types/interview';
import { X, Check, Pencil, Copy, LayoutGrid, CalendarRange, ClipboardPaste, FileSpreadsheet } from 'lucide-react';
import { formatInterviewDate, cn } from '@/lib/utils';
import { formatOrgDept } from '@/lib/repush-format';
import { buildTodayScheduleTable, parseInterviewReport } from '@/lib/interview-report';

export function InterviewCalendarPage() {
  const [mounted, setMounted] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addStage, setAddStage] = useState<string>('');
  const [form, setForm] = useState({ name: '', jdTitle: '', organization: '', department: '', interviewDate: '', salary: '' });
  const [copyMsg, setCopyMsg] = useState<string | null>(null);
  const [view, setView] = useState<'kanban' | 'week'>('kanban');
  const [todayOnly, setTodayOnly] = useState(false);
  const ownerTab = usePrefStore((s) => s.activeOwner) as CandidateOwner;
  const setOwnerTab = usePrefStore((s) => s.setActiveOwner);
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    name: '', jdTitle: '', organization: '', department: '', score: '', interviewDate: '',
    interviewer: '', contactEmail: '', notes: '', salary: '', onboardDate: '',
  });

  const candidates = useInterviewStore((s) => s.candidates);
  const moveCandidate = useInterviewStore((s) => s.moveCandidate);
  const addCandidate = useInterviewStore((s) => s.addCandidate);
  const updateCandidate = useInterviewStore((s) => s.updateCandidate);
  const removeCandidate = useInterviewStore((s) => s.removeCandidate);
  const undoDeleteCandidate = useInterviewStore((s) => s.undoDeleteCandidate);
  const lastDeletedCandidate = useInterviewStore((s) => s.lastDeletedCandidate);
  const columnNames = useRepushStore((s) => s.columnNames);

  // 编制组织 / 部门下拉选项：取 JD 库中所有去重、非空的对应字段（与人才复推池一致）
  const jds = useJDStore((s) => s.jds);
  const orgOptions = useMemo(() => {
    const set = new Set<string>();
    for (const jd of jds) { const v = jd.organization?.trim(); if (v) set.add(v); }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }, [jds]);
  const deptOptions = useMemo(() => {
    const set = new Set<string>();
    for (const jd of jds) { const v = jd.department?.trim(); if (v) set.add(v); }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }, [jds]);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!lastDeletedCandidate) return;
    const t = setTimeout(() => useInterviewStore.setState({ lastDeletedCandidate: null }), 10000);
    return () => clearTimeout(t);
  }, [lastDeletedCandidate]);

  // 面试提醒逻辑已上移到全局 <InterviewReminder />（根布局），任意页面都生效并发浏览器系统通知。

  useEffect(() => {
    if (copyMsg) { const t = setTimeout(() => setCopyMsg(null), 3000); return () => clearTimeout(t); }
  }, [copyMsg]);

  const startEdit = (c: typeof candidates[0]) => {
    setEditingId(c.id);
    setEditForm({
      name: c.name, jdTitle: c.jdTitle, organization: c.organization || '', department: c.department || '',
      score: String(c.score ?? ''),
      interviewDate: c.interviewDate ? toLocalDatetime(c.interviewDate) : '',
      interviewer: c.interviewer || '', contactEmail: c.contactEmail || '', notes: c.notes || '',
      salary: c.salary || '', onboardDate: c.onboardDate ? toLocalDatetime(c.onboardDate).slice(0, 10) : '',
    });
  };

  const saveEdit = () => {
    if (!editingId) return;
    updateCandidate(editingId, {
      name: editForm.name,
      jdTitle: editForm.jdTitle,
      organization: editForm.organization || undefined,
      department: editForm.department || undefined,
      score: editForm.score.trim() === '' ? 0 : Number(editForm.score),
      interviewDate: editForm.interviewDate ? new Date(editForm.interviewDate).toISOString() : undefined,
      interviewer: editForm.interviewer || undefined,
      contactEmail: editForm.contactEmail || undefined,
      notes: editForm.notes || undefined,
      salary: editForm.salary || undefined,
      onboardDate: editForm.onboardDate ? new Date(editForm.onboardDate).toISOString() : undefined,
    });
    setEditingId(null);
  };

  // 标记候选人最终结果（Offer 之后的闭环）。淘汰/退出时可填原因，供复推决策参考。
  const handleSetOutcome = (id: string, outcome: CandidateOutcome | null) => {
    if (outcome === null) {
      updateCandidate(id, { outcome: undefined, outcomeReason: undefined, outcomeAt: undefined });
      return;
    }
    let reason: string | undefined;
    if (outcome === 'failed' || outcome === 'withdrawn' || outcome === 'offer-rejected') {
      reason = window.prompt(`标记为「${OUTCOME_LABELS[outcome]}」，可填原因（供复推决策参考，可留空）：`) || undefined;
    }
    updateCandidate(id, { outcome, outcomeReason: reason, outcomeAt: new Date().toISOString() });
  };

  const handleCopyToday = async () => {
    const now = new Date();
    const isToday = (iso: string) => {
      const d = new Date(iso);
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    };
    const todays = ownerCandidates
      .filter((c) => c.interviewDate && isToday(c.interviewDate))
      .sort((a, b) => new Date(a.interviewDate!).getTime() - new Date(b.interviewDate!).getTime());
    if (todays.length === 0) { setCopyMsg('今日暂无面试安排'); return; }
    const header = `${now.getMonth() + 1}.${now.getDate()} ${columnNames[ownerTab]}`;
    const lines = todays.map((c) => {
      const d = new Date(c.interviewDate!);
      const h = d.getHours();
      const m = d.getMinutes();
      const time = m === 0 ? `北京时间${h}点` : `北京时间${h}点${m}分`;
      // 编制与部门之间用 / 间隔（如「万帧公司/智影」），重叠时只保留更完整的一方，其余字段用 - 间隔
      const orgDept = formatOrgDept(c.organization, c.department, '/');
      const parts = [c.name, c.jdTitle, orgDept].filter(Boolean);
      return `${parts.join('-')}-${time}`;
    });
    const text = [header, ...lines].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopyMsg(`已复制今日 ${todays.length} 场面试`);
    } catch {
      setCopyMsg('复制失败，请重试');
    }
  };

  // Excel看板：导出今天的面试为进度表（7 列，可直接粘贴 Excel 进度表）
  const handleCopyTodaySchedule = async () => {
    const now = new Date();
    const todays = ownerCandidates.filter((c) => {
      if (!c.interviewDate) return false;
      const d = new Date(c.interviewDate);
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    });
    if (todays.length === 0) { setCopyMsg('今日暂无约面安排'); return; }
    const text = buildTodayScheduleTable(ownerCandidates, now);
    try {
      await navigator.clipboard.writeText(text);
      setCopyMsg(`已复制今日Excel看板（${todays.length} 条）`);
    } catch {
      setCopyMsg('复制失败，请重试');
    }
  };

  // 粘贴导入：把汇报表格反解析为候选人并批量加入
  const handleImport = () => {
    const drafts = parseInterviewReport(importText);
    if (drafts.length === 0) { setCopyMsg('未识别到有效行，请检查格式'); return; }
    drafts.forEach((d) => addCandidate({ ...d, owner: ownerTab }));
    setShowImport(false);
    setImportText('');
    setCopyMsg(`已导入 ${drafts.length} 条约面数据`);
  };

  const handleAdd = () => {
    if (!form.name || !form.jdTitle) return;
    addCandidate({
      name: form.name, jdTitle: form.jdTitle, score: 0,
      organization: form.organization || undefined,
      department: form.department || undefined,
      contactEmail: '', notes: '', resumeId: '', jdId: '',
      owner: ownerTab,
      stage: addStage as CandidateStatus,
      interviewDate: form.interviewDate ? new Date(form.interviewDate).toISOString() : undefined,
      interviewer: undefined,
      salary: form.salary || undefined,
    });
    setForm({ name: '', jdTitle: '', organization: '', department: '', interviewDate: '', salary: '' });
    setShowAddForm(false);
  };

  // 按推荐人列过滤（未设置 owner 的候选人归入麦满分/a 列）
  const ownerCandidates = useMemo(
    () => candidates.filter((c) => (c.owner || 'a') === ownerTab),
    [candidates, ownerTab],
  );

  // 看板「当天面试」开关：开启时只保留面试日期在今天的候选人
  const boardCandidates = useMemo(() => {
    if (!todayOnly) return ownerCandidates;
    const now = new Date();
    return ownerCandidates.filter((c) => {
      if (!c.interviewDate) return false;
      const d = new Date(c.interviewDate);
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    });
  }, [ownerCandidates, todayOnly]);

  const selected = candidates.find((c) => c.id === selectedId);
  const firstInterviewCount = ownerCandidates.filter((c) => c.stage === 'interview-1').length;
  const secondInterviewCount = ownerCandidates.filter((c) => c.stage === 'interview-2').length;
  const offerCount = ownerCandidates.filter((c) => c.stage === 'offer').length;
  const isEditing = editingId === selectedId;

  if (!mounted) return null;

  return (
    <div className="animate-fade-in space-y-6 max-w-7xl mx-auto">
      <datalist id="org-options">{orgOptions.map((o) => <option key={o} value={o} />)}</datalist>
      <datalist id="dept-options">{deptOptions.map((d) => <option key={d} value={d} />)}</datalist>

      {copyMsg && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-fade-in">
          <div className="bg-gray-800 text-white rounded-xl shadow-lg px-5 py-3 flex items-center gap-2">
            <Check className="w-4 h-4 text-green-400" />
            <span className="text-sm">{copyMsg}</span>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">面试日历</h2>
          <p className="text-sm text-gray-500 mt-1">
            {columnNames[ownerTab]} 共 {ownerCandidates.length} 个候选人，一面 {firstInterviewCount} 个，二面 {secondInterviewCount} 个，Offer {offerCount} 个
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* 麦满分/啵啵 推荐人切换 */}
          <div className="flex rounded-xl border border-gray-200 overflow-hidden text-sm">
            {(['a', 'b'] as CandidateOwner[]).map((o) => (
              <button key={o} onClick={() => setOwnerTab(o)} className={cn('px-3 h-9 font-medium transition-colors', ownerTab === o ? 'bg-emerald-500 text-white' : 'bg-white text-gray-500 hover:bg-emerald-50')}>
                {columnNames[o]}
              </button>
            ))}
          </div>
          {/* 看板/周历切换 */}
          <div className="flex rounded-xl border border-gray-200 overflow-hidden text-sm">
            <button onClick={() => setView('kanban')} className={cn('px-3 h-9 font-medium flex items-center gap-1.5 transition-colors', view === 'kanban' ? 'bg-indigo-500 text-white' : 'bg-white text-gray-500 hover:bg-indigo-50')}>
              <LayoutGrid className="w-3.5 h-3.5" />看板
            </button>
            <button onClick={() => setView('week')} className={cn('px-3 h-9 font-medium flex items-center gap-1.5 transition-colors', view === 'week' ? 'bg-indigo-500 text-white' : 'bg-white text-gray-500 hover:bg-indigo-50')}>
              <CalendarRange className="w-3.5 h-3.5" />周历
            </button>
          </div>
          {view === 'kanban' && (
            <button onClick={() => setTodayOnly((v) => !v)} className={cn('px-3 h-9 rounded-xl text-sm font-medium transition-all flex items-center gap-1.5', todayOnly ? 'bg-amber-500 text-white hover:bg-amber-600 shadow-sm' : 'bg-white border border-gray-200 text-gray-600 hover:bg-amber-50')}>
              <CalendarRange className="w-4 h-4" />{todayOnly ? '全部面试' : '当天面试'}
            </button>
          )}
          <button onClick={handleCopyToday} className="px-3 h-9 rounded-xl bg-indigo-500 text-white text-sm font-medium hover:bg-indigo-600 transition-all flex items-center gap-1.5 shadow-sm">
            <Copy className="w-4 h-4" />今日面试
          </button>
          <button onClick={handleCopyTodaySchedule} className="px-3 h-9 rounded-xl bg-white border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-50 transition-all flex items-center gap-1.5">
            <FileSpreadsheet className="w-4 h-4" />Excel看板
          </button>
          <button onClick={() => setShowImport(true)} className="px-3 h-9 rounded-xl bg-white border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-50 transition-all flex items-center gap-1.5">
            <ClipboardPaste className="w-4 h-4" />导入
          </button>
        </div>
      </div>

      {view === 'kanban' ? (
        <StageKanbanBoard candidates={boardCandidates} onCandidateMove={(id, to) => moveCandidate(id, to)} onCandidateClick={setSelectedId} onDeleteCandidate={removeCandidate} onAddCandidate={(stage) => { setAddStage(stage); setShowAddForm(true); }} />
      ) : (
        <WeekGridView candidates={ownerCandidates} onCandidateClick={setSelectedId} />
      )}

      {lastDeletedCandidate && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-fade-in">
          <div className="bg-gray-800 text-white rounded-xl shadow-lg px-5 py-3 flex items-center gap-4">
            <span className="text-sm">已删除「{lastDeletedCandidate.name}」</span>
            <button onClick={() => undoDeleteCandidate()} className="text-sm font-medium text-indigo-300 hover:text-indigo-200 whitespace-nowrap">撤销</button>
          </div>
        </div>
      )}

      {showImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/20" onClick={() => setShowImport(false)} />
          <div className="relative w-full max-w-lg bg-white border border-gray-200 rounded-2xl shadow-xl p-6 animate-fade-in">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2"><ClipboardPaste className="w-5 h-5 text-indigo-500" />导入约面数据</h3>
              <button onClick={() => setShowImport(false)} className="p-1.5 rounded-lg hover:bg-gray-100"><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <p className="text-xs text-gray-500 mb-2">粘贴汇报表格（与「复制约面表」同格式，制表符或多空格分隔）。列顺序：日期 时间 姓名 岗位 编制 部门 面试官 阶段。表头行会自动跳过。</p>
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder={'6.4\t17:00\tMark\tAI产品经理\t技术中心\t鼎丰\t张三\t一面'}
              className="w-full h-44 px-3 py-2 rounded-xl bg-white border border-gray-200 text-sm font-mono resize-y focus:outline-none focus:border-indigo-300"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setShowImport(false)} className="h-10 px-4 rounded-xl text-sm font-medium text-gray-500 hover:bg-gray-100">取消</button>
              <button onClick={handleImport} disabled={!importText.trim()} className={cn('h-10 px-5 rounded-xl text-sm font-medium text-white transition-colors', importText.trim() ? 'bg-indigo-500 hover:bg-indigo-600' : 'bg-gray-200 cursor-not-allowed')}>确认导入</button>
            </div>
          </div>
        </div>
      )}

      {showAddForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/20" onClick={() => setShowAddForm(false)} />
          <div className="relative w-full max-w-sm bg-white border border-gray-200 rounded-2xl shadow-xl p-6 animate-fade-in">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-800">添加候选人</h3>
              <button onClick={() => setShowAddForm(false)} className="p-1.5 rounded-lg hover:bg-gray-100"><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="space-y-3">
              <div><label className="block text-xs text-gray-500 mb-1">姓名 *</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="候选人姓名" className="w-full h-10 px-4 rounded-xl bg-white border border-gray-200 text-sm focus:outline-none focus:border-indigo-300" /></div>
              <div><label className="block text-xs text-gray-500 mb-1">岗位 *</label><input value={form.jdTitle} onChange={(e) => setForm({ ...form, jdTitle: e.target.value })} placeholder="应聘岗位" className="w-full h-10 px-4 rounded-xl bg-white border border-gray-200 text-sm focus:outline-none focus:border-indigo-300" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">编制</label>
                  <input list="org-options" value={form.organization} onChange={(e) => setForm({ ...form, organization: e.target.value })} placeholder="选择或输入编制" className="w-full h-10 px-3 rounded-xl bg-white border border-gray-200 text-sm focus:outline-none focus:border-indigo-300" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">部门</label>
                  <input list="dept-options" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} placeholder="选择或输入部门" className="w-full h-10 px-3 rounded-xl bg-white border border-gray-200 text-sm focus:outline-none focus:border-indigo-300" />
                </div>
              </div>
              <div><label className="block text-xs text-gray-500 mb-1">面试时间</label><input type="datetime-local" value={form.interviewDate} onChange={(e) => setForm({ ...form, interviewDate: e.target.value })} className="w-full h-10 px-4 rounded-xl bg-white border border-gray-200 text-sm focus:outline-none focus:border-indigo-300" /></div>
              <div><label className="block text-xs text-gray-500 mb-1">薪资</label><input value={form.salary} onChange={(e) => setForm({ ...form, salary: e.target.value })} placeholder="如 20K-35K" className="w-full h-10 px-4 rounded-xl bg-white border border-gray-200 text-sm focus:outline-none focus:border-indigo-300" /></div>
              <button onClick={handleAdd} className="w-full h-10 rounded-xl bg-indigo-500 text-white text-sm font-medium hover:bg-indigo-600 transition-all">确认添加</button>
            </div>
          </div>
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/30" onClick={() => { setSelectedId(null); setEditingId(null); }} />
          <div className="relative w-full max-w-2xl max-h-[85vh] overflow-y-auto bg-white border border-gray-200 rounded-2xl shadow-2xl p-6 animate-fade-in">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold text-gray-800">
              {isEditing ? '编辑候选人' : `${selected.name} - 详情`}
            </h3>
            <div className="flex items-center gap-2">
              {isEditing ? (
                <button onClick={saveEdit} className="px-3 py-1.5 rounded-lg bg-indigo-500 text-white text-xs font-medium hover:bg-indigo-600 flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5" />保存
                </button>
              ) : (
                <button onClick={() => startEdit(selected)} className="px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-gray-600 text-xs font-medium hover:bg-gray-50 flex items-center gap-1.5">
                  <Pencil className="w-3.5 h-3.5" />编辑
                </button>
              )}
              <button onClick={() => { setSelectedId(null); setEditingId(null); }} className="p-1.5 rounded-lg hover:bg-gray-100"><X className="w-5 h-5 text-gray-400" /></button>
            </div>
          </div>

          {isEditing ? (
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-xs text-gray-500 mb-1">姓名</label><input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="w-full h-10 px-4 rounded-xl bg-white border border-gray-200 text-sm focus:outline-none focus:border-indigo-300" /></div>
              <div><label className="block text-xs text-gray-500 mb-1">岗位</label><input value={editForm.jdTitle} onChange={(e) => setEditForm({ ...editForm, jdTitle: e.target.value })} className="w-full h-10 px-4 rounded-xl bg-white border border-gray-200 text-sm focus:outline-none focus:border-indigo-300" /></div>
              <div><label className="block text-xs text-gray-500 mb-1">编制</label><input list="org-options" value={editForm.organization} onChange={(e) => setEditForm({ ...editForm, organization: e.target.value })} placeholder="选择或输入编制" className="w-full h-10 px-3 rounded-xl bg-white border border-gray-200 text-sm focus:outline-none focus:border-indigo-300" /></div>
              <div><label className="block text-xs text-gray-500 mb-1">部门</label><input list="dept-options" value={editForm.department} onChange={(e) => setEditForm({ ...editForm, department: e.target.value })} placeholder="选择或输入部门" className="w-full h-10 px-3 rounded-xl bg-white border border-gray-200 text-sm focus:outline-none focus:border-indigo-300" /></div>
              <div><label className="block text-xs text-gray-500 mb-1">分数</label><input type="text" inputMode="decimal" value={editForm.score} onChange={(e) => { const v = e.target.value; if (/^\d*\.?\d*$/.test(v)) setEditForm({ ...editForm, score: v }); }} className="w-full h-10 px-4 rounded-xl bg-white border border-gray-200 text-sm focus:outline-none focus:border-indigo-300" /></div>
              <div><label className="block text-xs text-gray-500 mb-1">薪资</label><input value={editForm.salary || ''} onChange={(e) => setEditForm({ ...editForm, salary: e.target.value })} placeholder="如 20K-35K" className="w-full h-10 px-4 rounded-xl bg-white border border-gray-200 text-sm focus:outline-none focus:border-indigo-300" /></div>
              <div><label className="block text-xs text-gray-500 mb-1">面试时间</label><input type="datetime-local" value={editForm.interviewDate} onChange={(e) => setEditForm({ ...editForm, interviewDate: e.target.value })} className="w-full h-10 px-4 rounded-xl bg-white border border-gray-200 text-sm focus:outline-none focus:border-indigo-300" /></div>
              <div><label className="block text-xs text-gray-500 mb-1">面试官</label><input value={editForm.interviewer} onChange={(e) => setEditForm({ ...editForm, interviewer: e.target.value })} placeholder="面试官姓名" className="w-full h-10 px-4 rounded-xl bg-white border border-gray-200 text-sm focus:outline-none focus:border-indigo-300" /></div>
              <div><label className="block text-xs text-gray-500 mb-1">入职时间</label><input type="date" value={editForm.onboardDate} onChange={(e) => setEditForm({ ...editForm, onboardDate: e.target.value })} className="w-full h-10 px-4 rounded-xl bg-white border border-gray-200 text-sm focus:outline-none focus:border-indigo-300" /></div>
              <div><label className="block text-xs text-gray-500 mb-1">备注</label><input value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} placeholder="备注信息" className="w-full h-10 px-4 rounded-xl bg-white border border-gray-200 text-sm focus:outline-none focus:border-indigo-300" /></div>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Stat label="岗位" value={selected.jdTitle} />
              <Stat label="编制" value={selected.organization || '-'} />
              <Stat label="部门" value={selected.department || '-'} />
              <Stat label="薪资" value={selected.salary || '-'} />
              <Stat label="分数" value={`${selected.score} 分`} />
              <div className="p-3 rounded-lg bg-gray-50"><p className="text-xs text-gray-400 mb-0.5">面试时间</p><p className="text-base font-bold text-gray-800">{selected.interviewDate ? formatInterviewDate(selected.interviewDate) : '未安排'}</p></div>
              <Stat label="面试官" value={selected.interviewer || '待定'} />
              <Stat label="投递时间" value={new Date(selected.appliedAt).toLocaleDateString('zh-CN')} />
              <Stat label="入职时间" value={selected.onboardDate ? new Date(selected.onboardDate).toLocaleDateString('zh-CN') : '-'} />
              <Stat label="备注" value={selected.notes || '-'} />
              {selected.resumeUrl && (
                <div className="p-3 rounded-lg bg-indigo-50/60">
                  <p className="text-xs text-gray-400 mb-0.5">简历</p>
                  <a href={selected.resumeUrl} target="_blank" rel="noreferrer"
                    className="text-sm text-indigo-600 hover:text-indigo-700 underline truncate block">
                    {selected.resumeFileName || '下载简历'}
                  </a>
                </div>
              )}
            </div>
          )}

          {/* 结果闭环：Offer 之后标记入职/淘汰/拒Offer/退出，替代「删除即丢历史」 */}
          {!isEditing && (
            <div className="mt-5 pt-4 border-t border-gray-100">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium text-gray-500">最终结果</p>
                {selected.outcome && (
                  <button onClick={() => handleSetOutcome(selected.id, null)} className="text-xs text-gray-400 hover:text-gray-600">清除结果</button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {ALL_OUTCOMES.map((o) => {
                  const active = selected.outcome === o;
                  return (
                    <button key={o} onClick={() => handleSetOutcome(selected.id, o)}
                      className={cn('px-3 h-8 rounded-lg text-xs font-medium transition-all', active ? OUTCOME_COLORS[o] : 'bg-white border border-gray-200 text-gray-500 hover:bg-gray-50')}>
                      {OUTCOME_LABELS[o]}
                    </button>
                  );
                })}
              </div>
              {selected.outcome && selected.outcomeReason && (
                <p className="mt-2 text-xs text-gray-500">原因：{selected.outcomeReason}</p>
              )}
            </div>
          )}
          </div>
        </div>
      )}
    </div>
  );
}

function toLocalDatetime(isoStr: string): string {
  const d = new Date(isoStr);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="p-3 rounded-lg bg-gray-50"><p className="text-xs text-gray-400 mb-0.5">{label}</p><p className="text-sm text-gray-700">{value}</p></div>;
}
