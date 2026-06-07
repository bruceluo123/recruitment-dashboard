'use client';
import { useEffect, useMemo, useState } from 'react';
import { CalendarPlus, X } from 'lucide-react';
import { RepushColumn } from './RepushColumn';
import { ResumeIntake } from './ResumeIntake';
import { useRepushStore, type RepushColumnId, type RepushItem } from '@/store/repush-store';
import { useJDStore } from '@/store/jd-store';
import { useInterviewStore } from '@/store/interview-store';
import { matchJDByTitle } from '@/lib/recommendation';
import { cn } from '@/lib/utils';

type DayFilter = 'today' | 'yesterday' | 'before' | 'week';

const DAY_FILTERS: { id: DayFilter; label: string }[] = [
  { id: 'today', label: '今天' },
  { id: 'yesterday', label: '昨天' },
  { id: 'before', label: '前天' },
  { id: 'week', label: '本周' },
];

/** 把日期归零到当天 00:00 的时间戳 */
function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** 判断 ISO 时间是否落在所选日期范围内 */
function inDayRange(iso: string, filter: DayFilter): boolean {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  const today = startOfDay(new Date());
  const DAY = 24 * 60 * 60 * 1000;
  if (filter === 'today') return t >= today && t < today + DAY;
  if (filter === 'yesterday') return t >= today - DAY && t < today;
  if (filter === 'before') return t >= today - 2 * DAY && t < today - DAY;
  // 本周：从本周一 00:00 到现在（周一为一周起点）
  const dow = (new Date().getDay() + 6) % 7; // 周一=0
  const monday = today - dow * DAY;
  return t >= monday;
}

export function RepushPoolPage() {
  const [mounted, setMounted] = useState(false);

  const items = useRepushStore((s) => s.items);
  const columnNames = useRepushStore((s) => s.columnNames);
  const addItem = useRepushStore((s) => s.addItem);
  const addRecommendation = useRepushStore((s) => s.addRecommendation);
  const updateItem = useRepushStore((s) => s.updateItem);
  const removeItem = useRepushStore((s) => s.removeItem);
  const setFeedback = useRepushStore((s) => s.setFeedback);
  const setOrganization = useRepushStore((s) => s.setOrganization);
  const setDepartment = useRepushStore((s) => s.setDepartment);
  const renameColumn = useRepushStore((s) => s.renameColumn);

  const addCandidate = useInterviewStore((s) => s.addCandidate);

  // 约面弹窗状态
  const [scheduling, setScheduling] = useState<RepushItem | null>(null);
  const [interviewAt, setInterviewAt] = useState('');
  const [interviewer, setInterviewer] = useState('');

  // 日期筛选：今天 / 昨天 / 前天 / 本周
  const [dayFilter, setDayFilter] = useState<DayFilter>('today');

  // 编制组织 / 部门下拉选项：取 JD 库中所有去重、非空的对应字段
  const jds = useJDStore((s) => s.jds);
  const orgOptions = useMemo(() => {
    const set = new Set<string>();
    for (const jd of jds) {
      const org = jd.organization?.trim();
      if (org) set.add(org);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }, [jds]);
  const deptOptions = useMemo(() => {
    const set = new Set<string>();
    for (const jd of jds) {
      const dept = jd.department?.trim();
      if (dept) set.add(dept);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }, [jds]);

  useEffect(() => setMounted(true), []);

  if (!mounted) return null;

  // 只识别文件名加入清单，不上传文件本体
  const handleAddFile = (column: RepushColumnId, file: File) => {
    addItem(column, file.name);
  };

  // 打开约面弹窗：默认时间取今天 14:00（本地时区）
  const openSchedule = (item: RepushItem) => {
    const d = new Date();
    d.setHours(14, 0, 0, 0);
    const pad = (n: number) => String(n).padStart(2, '0');
    const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    setInterviewAt(local);
    setInterviewer('');
    setScheduling(item);
  };

  const closeSchedule = () => { setScheduling(null); setInterviewAt(''); setInterviewer(''); };

  // 确认约面：在面试日历创建候选人，并把关联信息写回推荐记录
  const confirmSchedule = () => {
    if (!scheduling || !interviewAt) return;
    const it = scheduling;
    const name = it.candidateName || it.fileName.replace(/\.(pdf|docx?)$/i, '').trim();
    const jdTitle = it.jdTitle || '';
    const jd = jdTitle ? matchJDByTitle(jdTitle, jds) : null;
    const isoAt = new Date(interviewAt).toISOString();
    const candidateId = addCandidate({
      name,
      resumeId: '',
      jdId: jd?.id || '',
      jdTitle,
      organization: it.organization || jd?.organization?.trim() || undefined,
      department: it.department || jd?.department?.trim() || undefined,
      stage: 'interview-1',
      score: 0,
      interviewDate: isoAt,
      interviewer: interviewer.trim() || undefined,
      contactPhone: it.contact || undefined,
    });
    updateItem(it.id, { interviewStatus: 'scheduled', candidateId, interviewAt: isoAt });
    closeSchedule();
  };

  const dayItems = items.filter((it) => inDayRange(it.uploadedAt, dayFilter));
  const itemsA = dayItems.filter((it) => it.column === 'a');
  const itemsB = dayItems.filter((it) => it.column === 'b');

  return (
    <div className="flex flex-col h-full">
      <div className="mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">推荐中心</h1>
          <p className="text-sm text-gray-400 mt-1">粘贴简历一键解析录入推荐人，自动回填编制/部门；两人各自维护清单，可直接约面并同步面试日历。</p>
        </div>
        <div className="flex rounded-xl border border-gray-200 overflow-hidden text-sm shrink-0">
          {DAY_FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setDayFilter(f.id)}
              className={cn(
                'px-4 h-9 font-medium transition-colors',
                dayFilter === f.id ? 'bg-indigo-500 text-white' : 'bg-white text-gray-500 hover:bg-indigo-50',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-6">
        <ResumeIntake
          columnNames={columnNames}
          orgOptions={orgOptions}
          deptOptions={deptOptions}
          jds={jds}
          onAdd={addRecommendation}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 flex-1 min-h-0">
        <RepushColumn
          columnId="a"
          name={columnNames.a}
          items={itemsA}
          orgOptions={orgOptions}
          deptOptions={deptOptions}
          onAddFile={handleAddFile}
          onRemove={removeItem}
          onSetFeedback={setFeedback}
          onSetOrganization={setOrganization}
          onSetDepartment={setDepartment}
          onRename={renameColumn}
          onSchedule={openSchedule}
        />
        <RepushColumn
          columnId="b"
          name={columnNames.b}
          items={itemsB}
          orgOptions={orgOptions}
          deptOptions={deptOptions}
          onAddFile={handleAddFile}
          onRemove={removeItem}
          onSetFeedback={setFeedback}
          onSetOrganization={setOrganization}
          onSetDepartment={setDepartment}
          onRename={renameColumn}
          onSchedule={openSchedule}
        />
      </div>

      {/* 约面弹窗 */}
      {scheduling && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/30" onClick={closeSchedule} />
          <div className="relative w-full max-w-md bg-white border border-gray-200 rounded-2xl shadow-2xl p-6 animate-fade-in">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-gray-800 flex items-center gap-2">
                <span className="w-7 h-7 rounded-lg bg-indigo-500 flex items-center justify-center"><CalendarPlus className="w-4 h-4 text-white" /></span>
                约面
              </h3>
              <button onClick={closeSchedule} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100" title="关闭"><X className="w-4 h-4" /></button>
            </div>

            <p className="text-sm text-gray-500 mb-4">
              候选人：<span className="font-medium text-gray-800">{scheduling.candidateName || scheduling.fileName.replace(/\.(pdf|docx?)$/i, '')}</span>
              {scheduling.jdTitle ? <span className="text-gray-400"> · {scheduling.jdTitle}</span> : null}
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">面试时间 *</label>
                <input
                  type="datetime-local"
                  value={interviewAt}
                  onChange={(e) => setInterviewAt(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl bg-white border border-gray-200 text-sm outline-none focus:border-indigo-300"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">面试官</label>
                <input
                  value={interviewer}
                  onChange={(e) => setInterviewer(e.target.value)}
                  placeholder="选填"
                  className="w-full h-10 px-3 rounded-xl bg-white border border-gray-200 text-sm outline-none focus:border-indigo-300"
                />
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button onClick={closeSchedule} className="h-10 px-4 rounded-xl text-sm font-medium text-gray-500 hover:bg-gray-100">取消</button>
              <button
                onClick={confirmSchedule}
                disabled={!interviewAt}
                className={cn(
                  'h-10 px-5 rounded-xl text-sm font-medium text-white transition-colors',
                  interviewAt ? 'bg-indigo-500 hover:bg-indigo-600' : 'bg-gray-200 cursor-not-allowed',
                )}
              >
                确认约面
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
