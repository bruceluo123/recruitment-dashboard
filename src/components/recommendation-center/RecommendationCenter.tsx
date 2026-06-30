'use client';
import { useEffect, useMemo, useState } from 'react';
import { Users, CalendarCheck, FileUp, FileText } from 'lucide-react';
import { ResumeIntake } from '@/components/repush-pool/ResumeIntake';
import { EmptyState } from '@/components/ui/EmptyState';
import { ScheduleModal } from '@/components/repush-pool/ScheduleModal';
import { RecommendationBar } from './RecommendationBar';
import { EditRecommendationModal } from './EditRecommendationModal';
import { RepushModal, type RepushArgs } from './RepushModal';
import { DailyReportModal } from './DailyReportModal';
import { TodayReportModal } from './TodayReportModal';
import { RecommendationSearchBar, filterRecommendations, EMPTY_FILTERS, type RecommendationFilters } from './RecommendationSearchBar';
import { useRepushStore, type RepushColumnId, type RepushItem, type InterviewRound } from '@/store/repush-store';
import { useJDStore } from '@/store/jd-store';
import { useInterviewStore } from '@/store/interview-store';
import { scheduleRecommendation } from '@/lib/schedule';
import { formatDayHeader, startOfDay, displayName } from '@/lib/repush-format';
import { cn } from '@/lib/utils';

/** 把推荐记录按「天」分组，组与组按时间由近到远排序 */
function groupByDay(items: RepushItem[]): { key: number; label: string; items: RepushItem[] }[] {
  const map = new Map<number, RepushItem[]>();
  for (const it of items) {
    const t = new Date(it.uploadedAt).getTime();
    if (Number.isNaN(t)) continue;
    const dayKey = startOfDay(new Date(t)).getTime();
    const arr = map.get(dayKey) || [];
    arr.push(it);
    map.set(dayKey, arr);
  }
  return Array.from(map.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([key, arr]) => ({
      key,
      label: formatDayHeader(new Date(key).toISOString()),
      items: arr.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()),
    }));
}

export function RecommendationCenter() {
  const [mounted, setMounted] = useState(false);
  const items = useRepushStore((s) => s.items);
  const columnNames = useRepushStore((s) => s.columnNames);
  const addRecommendation = useRepushStore((s) => s.addRecommendation);
  const updateItem = useRepushStore((s) => s.updateItem);
  const removeItem = useRepushStore((s) => s.removeItem);

  const jds = useJDStore((s) => s.jds);
  const addCandidate = useInterviewStore((s) => s.addCandidate);
  const candidates = useInterviewStore((s) => s.candidates);

  // 推荐人视图为本页会话状态：每次进入默认「麦满分」(a)，切换不写全局、不影响其他页面，
  // 避免多人共用一台设备时被上一个人选的「啵啵」一直占用。
  const [view, setView] = useState<RepushColumnId>('a');
  const [scheduling, setScheduling] = useState<RepushItem | null>(null);
  const [editing, setEditing] = useState<RepushItem | null>(null);
  const [repushing, setRepushing] = useState<RepushItem | null>(null);
  const [reporting, setReporting] = useState(false);
  const [todayReporting, setTodayReporting] = useState(false);
  const [filters, setFilters] = useState<RecommendationFilters>(EMPTY_FILTERS);

  const orgOptions = useMemo(() => {
    const set = new Set<string>();
    for (const jd of jds) { const o = jd.organization?.trim(); if (o) set.add(o); }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }, [jds]);
  const deptOptions = useMemo(() => {
    const set = new Set<string>();
    for (const jd of jds) { const d = jd.department?.trim(); if (d) set.add(d); }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }, [jds]);

  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  const viewItems = items.filter((it) => it.column === view);
  const filteredItems = filterRecommendations(viewItems, filters);
  const groups = groupByDay(filteredItems);
  const scheduledCount = viewItems.filter((it) => it.interviewStatus === 'scheduled').length;
  const hasFilter = Object.values(filters).some((v) => v.trim());

  const confirmSchedule = (args: { interviewAt: string; interviewer: string; round: InterviewRound }) => {
    if (!scheduling) return;
    scheduleRecommendation(scheduling, args, { jds, addCandidate, updateItem });
    setScheduling(null);
  };

  // 复推：基于原记录新建一条独立推荐（换岗位/编制/部门），原记录保持不变
  const confirmRepush = (args: RepushArgs) => {
    if (!repushing) return;
    addRecommendation({
      column: repushing.column,
      candidateName: repushing.candidateName || displayName(repushing),
      jdTitle: args.jdTitle || undefined,
      contact: repushing.contact,
      contactPerson: repushing.contactPerson,
      rawText: repushing.rawText,
      organization: args.organization || undefined,
      department: args.department || undefined,
      highlights: repushing.highlights,
    });
    setRepushing(null);
  };

  return (
    <div className="animate-fade-in space-y-6 max-w-5xl mx-auto">
      <div>
        <h2 className="text-2xl font-bold text-gray-800">推荐中心</h2>
        <p className="text-sm text-gray-500 mt-1">粘贴简历一键解析录入推荐人，自动回填编制/部门，可直接约面同步面试日历。</p>
      </div>

      {/* 简历入口 */}
      <ResumeIntake
        columnNames={columnNames}
        orgOptions={orgOptions}
        deptOptions={deptOptions}
        jds={jds}
        defaultOwner={view}
        onAdd={addRecommendation}
        onOwnerChange={setView}
      />

      {/* 推荐数据列表 */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <h3 className="text-base font-semibold text-gray-800 flex items-center gap-2">
            <Users className="w-4 h-4 text-indigo-500" />推荐数据
            <span className="text-sm font-normal text-gray-400">
              {hasFilter ? `${filteredItems.length} / ${viewItems.length} 人` : `${viewItems.length} 人`}
              {scheduledCount > 0 ? ` · ${scheduledCount} 已约面` : ''}
            </span>
          </h3>
          <div className="flex items-center gap-2 shrink-0">
            {/* 一键看板：把当前推荐人今日数据提交到团队数据看板 */}
            <button
              onClick={() => setReporting(true)}
              className="flex items-center gap-1.5 px-3 h-9 rounded-xl border border-indigo-200 bg-indigo-50 text-indigo-600 text-sm font-medium hover:bg-indigo-100 transition-colors"
            >
              <FileUp className="w-4 h-4" />一键看板
            </button>
            {/* 今日日报：AI 按真人模板生成一份文字日报 */}
            <button
              onClick={() => setTodayReporting(true)}
              className="flex items-center gap-1.5 px-3 h-9 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-600 text-sm font-medium hover:bg-emerald-100 transition-colors"
            >
              <FileText className="w-4 h-4" />今日日报
            </button>
            {/* 两个推荐人切换（非并排） */}
            <div className="flex rounded-xl border border-gray-200 overflow-hidden text-sm">
              {(['a', 'b'] as RepushColumnId[]).map((c) => (
                <button
                  key={c}
                  onClick={() => setView(c)}
                  className={cn('px-4 h-9 font-medium transition-colors', view === c ? 'bg-indigo-500 text-white' : 'bg-white text-gray-500 hover:bg-indigo-50')}
                >
                  {columnNames[c]}
                </button>
              ))}
            </div>
          </div>
        </div>

        <RecommendationSearchBar items={viewItems} filters={filters} onChange={setFilters} />

        {groups.length > 0 ? (
          <div className="space-y-5">
            {groups.map((g) => (
              <div key={g.key}>
                {/* 日期分隔 */}
                <div className="flex items-center gap-3 mb-2.5">
                  <span className="flex items-center gap-1.5 text-xs font-medium text-gray-500">
                    <CalendarCheck className="w-3.5 h-3.5 text-gray-300" />{g.label}
                  </span>
                  <span className="text-xs text-gray-300">{g.items.length} 人</span>
                  <div className="flex-1 h-px bg-gray-100" />
                </div>
                <div className="space-y-2">
                  {g.items.map((it) => (
                    <RecommendationBar
                      key={it.id}
                      item={it}
                      onSchedule={setScheduling}
                      onEdit={setEditing}
                      onRepush={setRepushing}
                      onRemove={removeItem}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : hasFilter ? (
          <EmptyState icon={Users} title="没有匹配的推荐" description="试试放宽或清空查找条件" />
        ) : (
          <EmptyState icon={Users} title={`${columnNames[view]} 暂无推荐`} description="在上方简历入口粘贴简历一键录入推荐人" />
        )}
      </div>

      {scheduling && (
        <ScheduleModal item={scheduling} onClose={() => setScheduling(null)} onConfirm={confirmSchedule} />
      )}
      {editing && (
        <EditRecommendationModal
          item={editing}
          columnNames={columnNames}
          orgOptions={orgOptions}
          deptOptions={deptOptions}
          jds={jds}
          onClose={() => setEditing(null)}
          onSave={updateItem}
        />
      )}
      {repushing && (
        <RepushModal
          item={repushing}
          orgOptions={orgOptions}
          deptOptions={deptOptions}
          jds={jds}
          onClose={() => setRepushing(null)}
          onConfirm={confirmRepush}
        />
      )}
      {reporting && (
        <DailyReportModal
          column={view}
          name={columnNames[view]}
          items={items}
          candidates={candidates}
          onClose={() => setReporting(false)}
        />
      )}
      {todayReporting && (
        <TodayReportModal
          column={view}
          name={columnNames[view]}
          items={items}
          candidates={candidates}
          onClose={() => setTodayReporting(false)}
        />
      )}
    </div>
  );
}
