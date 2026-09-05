'use client';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Users, CalendarCheck, FileUp, FileText, Loader2, MessageSquareText } from 'lucide-react';
import { ResumeIntake } from '@/components/repush-pool/ResumeIntake';
import { EmptyState } from '@/components/ui/EmptyState';
import { ScheduleModal } from '@/components/repush-pool/ScheduleModal';
import { RecommendationBar } from './RecommendationBar';
import { EditRecommendationModal } from './EditRecommendationModal';
import { RepushModal, type RepushArgs } from './RepushModal';
import { OfferModal, type OfferFormValues } from './OfferModal';
import { DailyReportModal } from './DailyReportModal';
import { RecommendationSearchBar, filterRecommendations, EMPTY_FILTERS, type RecommendationFilters } from './RecommendationSearchBar';
import { useRepushStore, type RepushColumnId, type RepushItem, type InterviewRound } from '@/store/repush-store';
import { usePrefStore } from '@/store/pref-store';
import { useJDStore } from '@/store/jd-store';
import { useInterviewStore } from '@/store/interview-store';
import { scheduleRecommendation } from '@/lib/schedule';
import { matchJDByTitle } from '@/lib/recommendation';
import { getOfferGrade } from '@/lib/offer-compensation';
import { exportDailyReportExcel } from '@/lib/daily-report-excel';
import { formatDayHeader, startOfDay, displayName } from '@/lib/repush-format';
import { cn } from '@/lib/utils';
import type { FeedbackCenterItem } from '@/types/feedback-center';

function normalizeFeedbackKey(value?: string): string {
  return String(value || '').trim().toLowerCase().replace(/[\s/·・()（）\-_—–]+/g, '');
}

function feedbackTargetKey(item: Pick<RepushItem, 'candidateCode' | 'jdTitle' | 'organization' | 'department'>): string {
  const code = String(item.candidateCode || '').trim().toUpperCase();
  if (!code || !item.jdTitle || (!item.organization && !item.department)) return '';
  return [code, item.jdTitle, item.organization, item.department].map(normalizeFeedbackKey).join('|');
}

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

function groupByCandidate(items: RepushItem[]): { key: string; items: RepushItem[] }[] {
  const groups = new Map<string, RepushItem[]>();
  for (const item of items) {
    const candidateCode = item.candidateCode?.trim().toUpperCase();
    const key = candidateCode
      ? `code:${candidateCode}`
      : item.candidateId
        ? `candidate:${item.candidateId}`
        : `item:${item.id}`;
    const matches = groups.get(key) || [];
    matches.push(item);
    groups.set(key, matches);
  }
  return Array.from(groups.entries()).map(([key, groupedItems]) => ({ key, items: groupedItems }));
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
  const updateCandidate = useInterviewStore((s) => s.updateCandidate);
  const candidates = useInterviewStore((s) => s.candidates);

  // 推荐人视图跟随全局持久化偏好（usePrefStore.activeOwner）：
  // 用户切到「啵啵」(b) 后，本页及其他所有页面、刷新/下次打开都保持啵啵，
  // 直到主动切回「麦满分」(a)。与面试日历/复推池/待办板共用同一份偏好。
  const view = usePrefStore((s) => s.activeOwner);
  const setView = usePrefStore((s) => s.setActiveOwner);
  const [scheduling, setScheduling] = useState<RepushItem | null>(null);
  const [editing, setEditing] = useState<RepushItem | null>(null);
  const [repushing, setRepushing] = useState<RepushItem | null>(null);
  const [offering, setOffering] = useState<RepushItem | null>(null);
  const [reporting, setReporting] = useState(false);
  const [exportingToday, setExportingToday] = useState(false);
  const [filters, setFilters] = useState<RecommendationFilters>(EMPTY_FILTERS);
  const [feedbackItems, setFeedbackItems] = useState<FeedbackCenterItem[]>([]);
  const [expandedCandidateGroups, setExpandedCandidateGroups] = useState<Set<string>>(() => new Set());
  const [contactRefreshTick, setContactRefreshTick] = useState(0);
  const attemptedContactLookups = useRef(new Set<string>());
  const contactRefreshGeneration = useRef(-1);

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

  // 推荐中心只读取反馈中心已经生成的 7 天摘要，不触发 OCR 重算。
  // 每次切换推荐人只发一个请求，接口本身继续执行麦满分/啵啵隔离。
  useEffect(() => {
    if (!mounted) return;
    const controller = new AbortController();
    setFeedbackItems([]);
    void fetch(`/api/feedback-center?owner=${view}&scope=all`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('反馈摘要读取失败');
        return response.json();
      })
      .then((data) => {
        if (!controller.signal.aborted) setFeedbackItems(Array.isArray(data.items) ? data.items : []);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFeedbackItems([]);
      });
    return () => controller.abort();
  }, [mounted, view]);

  const feedbackByRecommendation = useMemo(() => {
    const result = new Map<string, FeedbackCenterItem>();
    const fallback = new Map<string, FeedbackCenterItem[]>();

    for (const feedback of feedbackItems) {
      if (feedback.owner !== view) continue;
      const recommendationId = String(feedback.recommendationId || feedback.id || '').trim();
      if (recommendationId) result.set(recommendationId, feedback);

      const key = feedbackTargetKey({
        candidateCode: feedback.candidateCode,
        jdTitle: feedback.jobTitle,
        organization: feedback.organization,
        department: feedback.department,
      });
      if (!key) continue;
      const matches = fallback.get(key) || [];
      matches.push(feedback);
      fallback.set(key, matches);
    }

    for (const item of items) {
      if (item.column !== view || result.has(item.id)) continue;
      const key = feedbackTargetKey(item);
      const matches = key ? fallback.get(key) : undefined;
      // 只有候选人编码、岗位、编制和部门唯一一致时才允许兼容旧记录，避免跨岗位串反馈。
      if (matches?.length === 1) result.set(item.id, matches[0]);
    }
    return result;
  }, [feedbackItems, items, view]);

  useEffect(() => {
    const timer = window.setInterval(() => setContactRefreshTick((value) => value + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    if (contactRefreshGeneration.current !== contactRefreshTick) {
      attemptedContactLookups.current.clear();
      contactRefreshGeneration.current = contactRefreshTick;
    }

    const targets = items.filter((item) => item.column === 'a' && !item.contact && (item.candidateName || displayName(item)));
    const contactsByCandidateCode = new Map<string, Set<string>>();
    for (const item of items) {
      const code = item.candidateCode?.trim();
      const contact = item.contact?.trim();
      if (item.column !== 'a' || !code || !contact) continue;
      const contacts = contactsByCandidateCode.get(code) || new Set<string>();
      contacts.add(contact);
      contactsByCandidateCode.set(code, contacts);
    }
    const inheritedContacts = new Map<string, string>();
    for (const item of targets) {
      const contacts = item.candidateCode ? contactsByCandidateCode.get(item.candidateCode.trim()) : undefined;
      if (contacts?.size === 1) inheritedContacts.set(item.id, Array.from(contacts)[0]);
    }
    const pending = targets.filter((item) => {
      if (inheritedContacts.has(item.id)) return false;
      const lookupKey = `${item.candidateCode || item.candidateName || item.id}|${item.jdTitle || ''}`;
      if (attemptedContactLookups.current.has(lookupKey)) return false;
      attemptedContactLookups.current.add(lookupKey);
      return true;
    });
    if (!inheritedContacts.size && !pending.length) return;

    const controller = new AbortController();
    const run = async () => {
      try {
        inheritedContacts.forEach((contact, id) => updateItem(id, { contact }));

        const targetById = new Map(pending.map((item) => [item.id, item]));
        const bestByCandidate = new Map<string, { contact: string; score: number }>();
        for (let index = 0; index < pending.length; index += 250) {
          const batch = pending.slice(index, index + 250);
          const response = await fetch('/api/tg/robin-contact', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              candidates: batch.map((item) => ({
                key: item.id,
                name: item.candidateName || displayName(item).split('-')[0].trim(),
                job: item.jdTitle || '',
              })),
            }),
            cache: 'no-store',
            signal: controller.signal,
          });
          const data = await response.json();
          if (!response.ok || !Array.isArray(data.results)) continue;

          for (const result of data.results) {
            if (result.status !== 'found' || !result.contact) continue;
            const target = targetById.get(String(result.key));
            if (!target) continue;
            const candidateKey = target.candidateCode
              ? `code:${target.candidateCode}`
              : `name:${String(target.candidateName || displayName(target)).trim().toLowerCase()}`;
            const score = Number(result.match?.score) || 0;
            const current = bestByCandidate.get(candidateKey);
            if (!current || score > current.score) bestByCandidate.set(candidateKey, { contact: String(result.contact).trim(), score });
          }
        }

        for (const item of items) {
          if (item.column !== 'a' || item.contact) continue;
          const candidateKey = item.candidateCode
            ? `code:${item.candidateCode}`
            : `name:${String(item.candidateName || displayName(item)).trim().toLowerCase()}`;
          const resolved = bestByCandidate.get(candidateKey);
          if (resolved?.contact) updateItem(item.id, { contact: resolved.contact });
        }
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          for (const item of pending) {
            attemptedContactLookups.current.delete(`${item.candidateCode || item.candidateName || item.id}|${item.jdTitle || ''}`);
          }
        }
      }
    };

    void run();
    return () => controller.abort();
  }, [contactRefreshTick, items, mounted, updateItem]);

  if (!mounted) return null;

  const viewItems = items.filter((it) => it.column === view);
  const filteredItems = filterRecommendations(viewItems, filters);
  const groups = groupByDay(filteredItems).map((group) => ({
    ...group,
    candidateGroups: groupByCandidate(group.items),
  }));

  const toggleCandidateGroup = (key: string) => {
    setExpandedCandidateGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const scheduledCount = viewItems.filter((it) => it.interviewStatus === 'scheduled').length;
  const hasFilter = Object.values(filters).some((v) => v.trim());

  const updateRecommendationContact = (id: string, contact?: string) => {
    const current = items.find((item) => item.id === id);
    if (!current?.candidateCode) {
      updateItem(id, { contact });
      return;
    }
    for (const item of items) {
      if (item.column === current.column && item.candidateCode === current.candidateCode) {
        updateItem(item.id, { contact });
      }
    }
  };

  const confirmSchedule = (args: { interviewAt: string; interviewer: string; round: InterviewRound }) => {
    if (!scheduling) return;
    scheduleRecommendation(scheduling, args, { jds, candidates, addCandidate, updateCandidate, updateItem });
    setScheduling(null);
  };

  // 复推：基于原记录新建一条独立推荐（换岗位/编制/部门），原记录保持不变
  const confirmRepush = (args: RepushArgs) => {
    if (!repushing) return;
    addRecommendation({
      column: repushing.column,
      candidateCode: repushing.candidateCode,
      candidateName: repushing.candidateName || displayName(repushing),
      jdTitle: args.jdTitle || undefined,
      contact: repushing.contact,
      contactPerson: args.contactPerson || undefined,
      rawText: args.recommendationText,
      organization: args.organization || undefined,
      department: args.department || undefined,
      highlights: repushing.highlights,
      resumeUrl: repushing.resumeUrl,
      resumeFileName: repushing.resumeFileName,
      source: 'repush',
      repushSourceId: repushing.id,
    });
    setRepushing(null);
  };

  const confirmOffer = (values: OfferFormValues) => {
    if (!offering) return;
    const offerAppliedAt = new Date().toISOString();
    const name = offering.candidateName || offering.fileName.replace(/\.(pdf|docx?)$/i, '').trim();
    const linkedCandidate = candidates.find((candidate) => candidate.id === offering.candidateId)
      || candidates.find((candidate) => (
        (candidate.owner || 'a') === offering.column
        && candidate.name === name
        && candidate.jdTitle === (offering.jdTitle || '')
        && (!offering.organization || (candidate.organization || '') === offering.organization)
        && (!offering.department || (candidate.department || '') === offering.department)
      ));
    const jd = offering.jdTitle ? matchJDByTitle(offering.jdTitle, jds) : null;
    const probationSalary = values.probationSalary.trim();
    const regularSalary = values.regularSalary.trim();
    const onboardDate = values.onboardDate ? new Date(values.onboardDate).toISOString() : undefined;
    const grade = getOfferGrade(regularSalary);
    const salary = [probationSalary && `试用期 ${probationSalary}`, regularSalary && `转正 ${regularSalary}`].filter(Boolean).join(' / ');
    const partial = {
      stage: 'offer' as const,
      owner: offering.column,
      candidateCode: offering.candidateCode || linkedCandidate?.candidateCode,
      score: grade?.score || 0,
      probationSalary: probationSalary || undefined,
      regularSalary: regularSalary || undefined,
      probationMonths: '2',
      onboardDate,
      jobLevel: grade?.level,
      salary: salary || undefined,
      offerAppliedAt,
      organization: offering.organization || linkedCandidate?.organization || jd?.organization?.trim() || undefined,
      department: offering.department || linkedCandidate?.department || jd?.department?.trim() || undefined,
      workMode: linkedCandidate?.workMode || (jd?.location?.trim() && !/remote|远程|居家/i.test(jd.location) ? '到岗' : '远程'),
      recommendationSource: offering.source || linkedCandidate?.recommendationSource || 'intake',
    };

    if (linkedCandidate) {
      updateCandidate(linkedCandidate.id, partial);
      updateItem(offering.id, { candidateId: linkedCandidate.id, offerAppliedAt });
    } else {
      const candidateId = addCandidate({
        name,
        resumeId: '',
        jdId: jd?.id || '',
        jdTitle: offering.jdTitle || '',
        resumeUrl: offering.resumeUrl || undefined,
        resumeFileName: offering.resumeFileName || undefined,
        talentId: offering.talentId || undefined,
        contactPhone: offering.contact || undefined,
        ...partial,
      });
      updateItem(offering.id, { candidateId, offerAppliedAt });
    }
    setOffering(null);
  };

  const handleExportTodayReport = async () => {
    setExportingToday(true);
    try {
      await exportDailyReportExcel({ column: view, name: columnNames[view], items, candidates });
    } catch (error) {
      alert(error instanceof Error ? error.message : '导出今日日报失败，请重试');
    } finally {
      setExportingToday(false);
    }
  };

  return (
    <div className="workspace-page max-w-6xl">
      <div>
        <h2 className="page-title">推荐中心</h2>
        <p className="page-subtitle">粘贴简历一键解析录入推荐人，自动回填编制/部门，可直接约面同步面试日历。</p>
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
      <div className="rounded-lg border border-slate-200/90 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.035)]">
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <h3 className="text-base font-semibold text-gray-800 flex items-center gap-2">
            <Users className="w-4 h-4 text-indigo-500" />推荐数据
            <span className="text-sm font-normal text-gray-400">
              {hasFilter ? `${filteredItems.length} / ${viewItems.length} 人` : `${viewItems.length} 人`}
              {scheduledCount > 0 ? ` · ${scheduledCount} 已约面` : ''}
            </span>
          </h3>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
            <Link
              href="/repush-pool"
              className="flex items-center gap-1.5 px-3 h-9 rounded-xl border border-amber-200 bg-amber-50 text-amber-700 text-sm font-medium hover:bg-amber-100 transition-colors"
            >
              <MessageSquareText className="w-4 h-4" />反馈中心
            </Link>
            {/* 一键看板：把当前推荐人今日数据提交到团队数据看板 */}
            <button
              onClick={() => setReporting(true)}
              className="flex items-center gap-1.5 px-3 h-9 rounded-xl border border-indigo-200 bg-indigo-50 text-indigo-600 text-sm font-medium hover:bg-indigo-100 transition-colors"
            >
              <FileUp className="w-4 h-4" />一键看板
            </button>
            {/* 今日日报：直接套用 Excel 模板导出，便于截图提交 */}
            <button
              data-report-action="export-today"
              onClick={handleExportTodayReport}
              disabled={exportingToday}
              className="flex items-center gap-1.5 px-3 h-9 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-600 text-sm font-medium hover:bg-emerald-100 transition-colors"
            >
              {exportingToday ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}今日日报
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
                  <span className="text-xs text-gray-300">{g.candidateGroups.length} 人</span>
                  <div className="flex-1 h-px bg-gray-100" />
                </div>
                <div className="space-y-2">
                  {g.candidateGroups.map((candidateGroup) => {
                    const groupKey = `${g.key}:${candidateGroup.key}`;
                    const expanded = expandedCandidateGroups.has(groupKey);
                    const visibleItems = expanded ? candidateGroup.items : candidateGroup.items.slice(0, 1);
                    return (
                      <div key={groupKey} className="space-y-2">
                        {visibleItems.map((it, index) => (
                          <RecommendationBar
                            key={it.id}
                            item={it}
                            feedbackItem={feedbackByRecommendation.get(it.id)}
                            candidateGroupCount={index === 0 ? candidateGroup.items.length : undefined}
                            candidateGroupExpanded={expanded}
                            candidateGroupFeedbackItems={index === 0
                              ? candidateGroup.items.map((groupItem) => feedbackByRecommendation.get(groupItem.id))
                              : undefined}
                            onToggleCandidateGroup={() => toggleCandidateGroup(groupKey)}
                            onSchedule={setScheduling}
                            onEdit={setEditing}
                            onRepush={setRepushing}
                            onOffer={setOffering}
                            offerRecorded={candidates.some((candidate) => candidate.id === it.candidateId && candidate.stage === 'offer')}
                            interviewFailed={candidates.some((candidate) => candidate.id === it.candidateId && candidate.outcome === 'failed')}
                            onRemove={removeItem}
                            onUpdateContact={updateRecommendationContact}
                          />
                        ))}
                      </div>
                    );
                  })}
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
          existingItems={items}
          jds={jds}
          onClose={() => setRepushing(null)}
          onConfirm={confirmRepush}
        />
      )}
      {offering && (
        <OfferModal
          item={offering}
          candidate={candidates.find((candidate) => candidate.id === offering.candidateId)}
          onClose={() => setOffering(null)}
          onConfirm={confirmOffer}
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
    </div>
  );
}
