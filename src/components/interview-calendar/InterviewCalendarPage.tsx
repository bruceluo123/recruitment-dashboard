'use client';
import { useEffect, useRef, useState } from 'react';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { StageKanbanBoard } from './StageKanbanBoard';
import { useInterviewStore } from '@/store/interview-store';
import type { CandidateStatus } from '@/types/interview';
import { ListFilter, X, Bell, Check, Pencil } from 'lucide-react';

export function InterviewCalendarPage() {
  const [mounted, setMounted] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addStage, setAddStage] = useState<string>('');
  const [form, setForm] = useState({ name: '', jdTitle: '', interviewDate: '', salary: '' });
  const [notification, setNotification] = useState<{ name: string; time: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    name: '', jdTitle: '', score: 0, interviewDate: '',
    interviewer: '', contactEmail: '', notes: '', salary: '', onboardDate: '',
  });
  const remindedRef = useRef<Set<string>>(new Set());

  const candidates = useInterviewStore((s) => s.candidates);
  const moveCandidate = useInterviewStore((s) => s.moveCandidate);
  const addCandidate = useInterviewStore((s) => s.addCandidate);
  const updateCandidate = useInterviewStore((s) => s.updateCandidate);
  const removeCandidate = useInterviewStore((s) => s.removeCandidate);
  const undoDeleteCandidate = useInterviewStore((s) => s.undoDeleteCandidate);
  const lastDeletedCandidate = useInterviewStore((s) => s.lastDeletedCandidate);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!lastDeletedCandidate) return;
    const t = setTimeout(() => useInterviewStore.setState({ lastDeletedCandidate: null }), 10000);
    return () => clearTimeout(t);
  }, [lastDeletedCandidate]);

  useEffect(() => {
    const checkReminders = () => {
      const now = new Date();
      for (const c of candidates) {
        if (c.interviewDate && !remindedRef.current.has(c.id)) {
          const diffMs = new Date(c.interviewDate).getTime() - now.getTime();
          const diffMin = Math.floor(diffMs / 60000);
          if (diffMin >= 0 && diffMin <= 15) {
            remindedRef.current.add(c.id);
            setNotification({ name: c.name, time: c.interviewDate });
          }
        }
      }
    };
    checkReminders();
    const interval = setInterval(checkReminders, 30000);
    return () => clearInterval(interval);
  }, [candidates]);

  useEffect(() => {
    if (notification) { const t = setTimeout(() => setNotification(null), 8000); return () => clearTimeout(t); }
  }, [notification]);

  const startEdit = (c: typeof candidates[0]) => {
    setEditingId(c.id);
    setEditForm({
      name: c.name, jdTitle: c.jdTitle, score: c.score,
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
      score: editForm.score,
      interviewDate: editForm.interviewDate ? new Date(editForm.interviewDate).toISOString() : undefined,
      interviewer: editForm.interviewer || undefined,
      contactEmail: editForm.contactEmail || undefined,
      notes: editForm.notes || undefined,
      salary: editForm.salary || undefined,
      onboardDate: editForm.onboardDate ? new Date(editForm.onboardDate).toISOString() : undefined,
    });
    setEditingId(null);
  };

  const handleAdd = () => {
    if (!form.name || !form.jdTitle) return;
    addCandidate({
      name: form.name, jdTitle: form.jdTitle, score: 0,
      contactEmail: '', notes: '', resumeId: '', jdId: '',
      stage: addStage as CandidateStatus,
      interviewDate: form.interviewDate ? new Date(form.interviewDate).toISOString() : undefined,
      interviewer: undefined,
      salary: form.salary || undefined,
    });
    setForm({ name: '', jdTitle: '', interviewDate: '', salary: '' });
    setShowAddForm(false);
  };

  const selected = candidates.find((c) => c.id === selectedId);
  const activeCount = candidates.filter((c) => c.stage !== 'offer').length;
  const isEditing = editingId === selectedId;

  if (!mounted) return null;

  return (
    <div className="animate-fade-in space-y-6 max-w-7xl mx-auto">
      {notification && (
        <div className="fixed top-20 right-6 z-50 animate-slide-in-right">
          <div className="bg-amber-50 border border-amber-200 rounded-2xl shadow-xl p-4 max-w-sm">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center shrink-0"><Bell className="w-5 h-5 text-amber-600" /></div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-amber-800">面试提醒</p>
                <p className="text-sm text-amber-700 mt-1"><span className="font-medium">{notification.name}</span> 的面试即将开始</p>
                <p className="text-xs text-amber-500 mt-0.5">{new Date(notification.time).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
              </div>
              <button onClick={() => setNotification(null)} className="p-1 rounded-lg hover:bg-amber-100 text-amber-400"><X className="w-4 h-4" /></button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div><h2 className="text-2xl font-bold text-gray-800">面试日历</h2><p className="text-sm text-gray-500 mt-1">{candidates.length} 个候选人，{activeCount} 个流程中</p></div>
        <span className="text-xs text-gray-400 flex items-center gap-1"><ListFilter className="w-3.5 h-3.5" />拖拽卡片切换阶段</span>
      </div>

      <StageKanbanBoard candidates={candidates} onCandidateMove={(id, to) => moveCandidate(id, to)} onCandidateClick={setSelectedId} onDeleteCandidate={removeCandidate} onAddCandidate={(stage) => { setAddStage(stage); setShowAddForm(true); }} />

      {lastDeletedCandidate && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-fade-in">
          <div className="bg-gray-800 text-white rounded-xl shadow-lg px-5 py-3 flex items-center gap-4">
            <span className="text-sm">已删除「{lastDeletedCandidate.name}」</span>
            <button onClick={() => undoDeleteCandidate()} className="text-sm font-medium text-indigo-300 hover:text-indigo-200 whitespace-nowrap">撤销</button>
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
              <div><label className="block text-xs text-gray-500 mb-1">面试时间</label><input type="datetime-local" value={form.interviewDate} onChange={(e) => setForm({ ...form, interviewDate: e.target.value })} className="w-full h-10 px-4 rounded-xl bg-white border border-gray-200 text-sm focus:outline-none focus:border-indigo-300" /></div>
              <div><label className="block text-xs text-gray-500 mb-1">薪资</label><input value={form.salary} onChange={(e) => setForm({ ...form, salary: e.target.value })} placeholder="如 20K-35K" className="w-full h-10 px-4 rounded-xl bg-white border border-gray-200 text-sm focus:outline-none focus:border-indigo-300" /></div>
              <button onClick={handleAdd} className="w-full h-10 rounded-xl bg-indigo-500 text-white text-sm font-medium hover:bg-indigo-600 transition-all">确认添加</button>
            </div>
          </div>
        </div>
      )}

      {selected && (
        <GlassPanel>
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
              <button onClick={() => { setSelectedId(null); setEditingId(null); }} className="text-xs text-gray-400 hover:text-gray-600">关闭</button>
            </div>
          </div>

          {isEditing ? (
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-xs text-gray-500 mb-1">姓名</label><input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="w-full h-10 px-4 rounded-xl bg-white border border-gray-200 text-sm focus:outline-none focus:border-indigo-300" /></div>
              <div><label className="block text-xs text-gray-500 mb-1">岗位</label><input value={editForm.jdTitle} onChange={(e) => setEditForm({ ...editForm, jdTitle: e.target.value })} className="w-full h-10 px-4 rounded-xl bg-white border border-gray-200 text-sm focus:outline-none focus:border-indigo-300" /></div>
              <div><label className="block text-xs text-gray-500 mb-1">分数</label><input type="number" value={editForm.score} onChange={(e) => setEditForm({ ...editForm, score: Number(e.target.value) })} className="w-full h-10 px-4 rounded-xl bg-white border border-gray-200 text-sm focus:outline-none focus:border-indigo-300" /></div>
              <div><label className="block text-xs text-gray-500 mb-1">薪资</label><input value={editForm.salary || ''} onChange={(e) => setEditForm({ ...editForm, salary: e.target.value })} placeholder="如 20K-35K" className="w-full h-10 px-4 rounded-xl bg-white border border-gray-200 text-sm focus:outline-none focus:border-indigo-300" /></div>
              <div><label className="block text-xs text-gray-500 mb-1">面试时间</label><input type="datetime-local" value={editForm.interviewDate} onChange={(e) => setEditForm({ ...editForm, interviewDate: e.target.value })} className="w-full h-10 px-4 rounded-xl bg-white border border-gray-200 text-sm focus:outline-none focus:border-indigo-300" /></div>
              <div><label className="block text-xs text-gray-500 mb-1">面试官</label><input value={editForm.interviewer} onChange={(e) => setEditForm({ ...editForm, interviewer: e.target.value })} placeholder="面试官姓名" className="w-full h-10 px-4 rounded-xl bg-white border border-gray-200 text-sm focus:outline-none focus:border-indigo-300" /></div>
              <div><label className="block text-xs text-gray-500 mb-1">入职时间</label><input type="date" value={editForm.onboardDate} onChange={(e) => setEditForm({ ...editForm, onboardDate: e.target.value })} className="w-full h-10 px-4 rounded-xl bg-white border border-gray-200 text-sm focus:outline-none focus:border-indigo-300" /></div>
              <div><label className="block text-xs text-gray-500 mb-1">备注</label><input value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} placeholder="备注信息" className="w-full h-10 px-4 rounded-xl bg-white border border-gray-200 text-sm focus:outline-none focus:border-indigo-300" /></div>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Stat label="岗位" value={selected.jdTitle} />
              <Stat label="薪资" value={selected.salary || '-'} />
              <Stat label="分数" value={`${selected.score} 分`} />
              <Stat label="面试时间" value={selected.interviewDate ? new Date(selected.interviewDate).toLocaleString('zh-CN') : '未安排'} />
              <Stat label="面试官" value={selected.interviewer || '待定'} />
              <Stat label="投递时间" value={new Date(selected.appliedAt).toLocaleDateString('zh-CN')} />
              <Stat label="入职时间" value={selected.onboardDate ? new Date(selected.onboardDate).toLocaleDateString('zh-CN') : '-'} />
              <Stat label="备注" value={selected.notes || '-'} />
            </div>
          )}
        </GlassPanel>
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
