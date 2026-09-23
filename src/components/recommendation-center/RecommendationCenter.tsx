'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Users, CalendarCheck, CalendarRange, FileUp, FileText, Loader2, MessageSquareText, Repeat2 } from 'lucide-react';
import { ResumeIntake } from '@/components/repush-pool/ResumeIntake';
import { EmptyState } from '@/components/ui/EmptyState';
import { ScheduleModal } from '@/components/repush-pool/ScheduleModal';
import { RecommendationBar } from './RecommendationBar';
import { UnfeedbackModal } from './UnfeedbackModal';
import { EditRecommendationModal } from './EditRecommendationModal';
import { RepushModal, type RepushArgs } from './RepushModal';
import { BulkRepushModal, type BulkRepushCandidate } from './BulkRepushModal';
import { OfferModal, type OfferFormValues } from './OfferModal';
import { DailyReportModal } from './DailyReportModal';
import { WeeklyReportModal } from './WeeklyReportModal';
import { RecommendationSearchBar, filterRecommendations, EMPTY_FILTERS, type RecommendationFilters } from './RecommendationSearchBar';
import { useRepushStore, type RepushColumnId, type RepushItem, type InterviewRound } from '@/store/repush-store';
import { usePrefStore } from '@/store/pref-store';
import { useJDStore } from '@/store/jd-store';
import { useInterviewStore } from '@/store/interview-store';
import { useTalentStore } from '@/store/talent-store';
import { scheduleRecommendation, findRecommendationCandidate } from '@/lib/schedule';
import { matchJDByTitle } from '@/lib/recommendation';
import { exportDailyReportExcel } from '@/lib/daily-report-excel';
import { formatDayHeader, startOfDay, displayName } from '@/lib/repush-format';
import { cn } from '@/lib/utils';
import { isFeedbackEligibleDelivery, projectFeedbackStatus } from '@/lib/feedback-status';
import type { FeedbackCenterItem, FeedbackCenterState } from '@/types/feedback-center';
import { fetchFeedback } from '@/lib/feedback-client';
import { applyRemoteStoreUpdate, refreshSyncedData } from '@/lib/sync';
import { recommendationOrganization } from '@/lib/recommendation-copy';
import type { JD } from '@/types/jd';
import type { Talent } from '@/types/talent';
import type { Candidate } from '@/types/interview';

const EMPTY_FEEDBACK_ITEMS: FeedbackCenterItem[] = [];

function normalizeFeedbackKey(value?: string): string {
  return String(value || '').trim().toLowerCase().replace(/[\s/·・()（）\-_—–]+/g, '');
}

function feedbackTargetKey(item: Pick<RepushItem, 'candidateCode' | 'jdTitle' | 'organization' | 'department'>): string {
  const code = String(item.candidateCode || '').trim().toUpperCase();
  if (!code || !item.jdTitle || (!item.organization && !item.department)) return '';
  return [code, item.jdTitle, item.organization, item.department].map(normalizeFeedbackKey).join('|');
}

function feedbackMatchesRecommendation(feedback: FeedbackCenterItem, item: RepushItem): boolean {
  if (feedback.owner !== item.column) return false;

  const feedbackCode = normalizeFeedbackKey(feedback.candidateCode);
  const itemCode = normalizeFeedbackKey(item.candidateCode);
  const feedbackName = normalizeFeedbackKey(feedback.candidateName);
  const itemName = normalizeFeedbackKey(item.candidateName || displayName(item).split('-')[0]);
  const candidateMatches = feedbackCode || itemCode
    ? Boolean(feedbackCode && itemCode && feedbackCode === itemCode)
    : Boolean(feedbackName && itemName && feedbackName === itemName);
  if (!candidateMatches) return false;

  const feedbackJob = normalizeFeedbackKey(feedback.jobTitle);
  const itemJob = normalizeFeedbackKey(item.jdTitle);
  if (!feedbackJob || !itemJob || feedbackJob !== itemJob) return false;

  return [
    [feedback.organization, item.organization],
    [feedback.department, item.department],
  ].every(([feedbackValue, itemValue]) => {
    const normalizedFeedback = normalizeFeedbackKey(feedbackValue);
    const normalizedItem = normalizeFeedbackKey(itemValue);
    return (!normalizedFeedback && !normalizedItem)
      || Boolean(normalizedFeedback && normalizedItem && normalizedFeedback === normalizedItem);
  });
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

function sameJobCandidateKey(item: RepushItem): string {
  const identity = String(item.candidateIdentityId || '').trim().toLowerCase();
  if (identity) return `identity:${identity}`;
  const code = String(item.candidateCode || '').trim().toUpperCase();
  if (code) return `code:${code}`;
  if (item.candidateId) return `candidate:${item.candidateId}`;
  const name = normalizeFeedbackKey(item.candidateName || displayName(item).split('-')[0]);
  return name ? `name:${name}` : `item:${item.id}`;
}

function indexUniqueTalents(
  talents: Talent[],
  value: (talent: Talent) => string,
): Map<string, Talent> {
  const index = new Map<string, Talent>();
  const duplicates = new Set<string>();
  for (const talent of talents) {
    const key = value(talent);
    if (!key) continue;
    if (index.has(key)) duplicates.add(key);
    else index.set(key, talent);
  }
  duplicates.forEach((key) => index.delete(key));
  return index;
}

function sameJobCandidateOptions(
  items: RepushItem[],
  talents: Talent[],
  interviewCandidates: Candidate[],
  feedbackByRecommendation: Map<string, FeedbackCenterItem>,
): BulkRepushCandidate[] {
  const activeTalents = talents.filter((talent) => !talent.archived);
  const talentById = new Map(activeTalents.map((talent) => [talent.id, talent]));
  const talentByIdentity = indexUniqueTalents(activeTalents, (talent) => String(talent.candidateIdentityId || '').trim().toLowerCase());
  const talentByCode = indexUniqueTalents(activeTalents, (talent) => String(talent.candidateCode || '').trim().toUpperCase());
  const interviewCandidateById = new Map(interviewCandidates.map((candidate) => [candidate.id, candidate]));
  const options = new Map<string, BulkRepushCandidate>();
  const newestFirst = items
    .filter((item) => Boolean(item.resumeUrl))
    .slice()
    .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
  for (const item of newestFirst) {
    const key = sameJobCandidateKey(item);
    const talent = (item.talentId ? talentById.get(item.talentId) : undefined)
      || talentByIdentity.get(String(item.candidateIdentityId || '').trim().toLowerCase())
      || talentByCode.get(String(item.candidateCode || '').trim().toUpperCase());
    const interviewCandidate = item.candidateId ? interviewCandidateById.get(item.candidateId) : undefined;
    const feedbackStatus = projectFeedbackStatus(feedbackByRecommendation.get(item.id));
    const hasInterview = item.interviewStatus === 'scheduled' || Boolean(interviewCandidate?.interviewDate || interviewCandidate?.interviewHistory?.length);
    const interviewFailed = interviewCandidate?.outcome === 'failed'
      || feedbackStatus === 'screening_failed'
      || feedbackStatus === 'interview_failed'
      || feedbackStatus === 'closed';
    const existing = options.get(key);
    if (existing) {
      if ((!existing.item.rawText && item.rawText) || (!existing.item.highlights && item.highlights) || (hasInterview && !existing.hasInterview) || (interviewFailed && !existing.interviewFailed)) {
        options.set(key, {
          ...existing,
          hasInterview: existing.hasInterview || hasInterview,
          interviewFailed: existing.interviewFailed || interviewFailed,
          item: {
            ...existing.item,
            rawText: existing.item.rawText || item.rawText,
            highlights: existing.item.highlights || item.highlights,
          },
        });
      }
      continue;
    }
    options.set(key, {
      key,
      candidateCode: String(item.candidateCode || '').trim(),
      candidateName: String(item.candidateName || displayName(item).split('-')[0] || '未命名人选').trim(),
      talentId: talent?.id,
      hasResumeText: talent?.hasResumeText,
      hasInterview,
      interviewFailed,
      item,
    });
  }
  return Array.from(options.values());
}

function isSameJobTarget(item: RepushItem, jd: JD): boolean {
  if (item.jdId && item.jdId === jd.id) return true;
  return [item.jdTitle, item.organization, item.department].map(normalizeFeedbackKey).join('|')
    === [jd.title, recommendationOrganization(jd), jd.department].map(normalizeFeedbackKey).join('|');
}

export function RecommendationCenter() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const items = useRepushStore((s) => s.items);
  const columnNames = useRepushStore((s) => s.columnNames);
  const addRecommendation = useRepushStore((s) => s.addRecommendation);
  const upsertDeliveryRecommendation = useRepushStore((s) => s.upsertDeliveryRecommendation);
  const updateItem = useRepushStore((s) => s.updateItem);
  const removeItem = useRepushStore((s) => s.removeItem);

  const jds = useJDStore((s) => s.jds);
  const addCandidate = useInterviewStore((s) => s.addCandidate);
  const updateCandidate = useInterviewStore((s) => s.updateCandidate);
  const candidates = useInterviewStore((s) => s.candidates);
  const talents = useTalentStore((s) => s.talents);

  // 推荐人视图跟随全局持久化偏好（usePrefStore.activeOwner）：
  // 用户切到「啵啵」(b) 后，本页及其他所有页面、刷新/下次打开都保持啵啵，
  // 直到主动切回「麦满分」(a)。与面试日历/复推池/待办板共用同一份偏好。
  const view = usePrefStore((s) => s.activeOwner);
  const setView = usePrefStore((s) => s.setActiveOwner);
  const [scheduling, setScheduling] = useState<RepushItem | null>(null);
  const [editing, setEditing] = useState<RepushItem | null>(null);
  const [repushing, setRepushing] = useState<RepushItem | null>(null);
  const [sameJobRepushOpen, setSameJobRepushOpen] = useState(false);
  const [offering, setOffering] = useState<RepushItem | null>(null);
  const [reporting, setReporting] = useState(false);
  const [weeklyReporting, setWeeklyReporting] = useState(false);
  const [preparingBoard, setPreparingBoard] = useState(false);
  const [preparingWeekly, setPreparingWeekly] = useState(false);
  const [showingUnfeedback, setShowingUnfeedback] = useState(false);
  const [exportingToday, setExportingToday] = useState(false);
  const [filters, setFilters] = useState<RecommendationFilters>(EMPTY_FILTERS);
  const [feedbackSnapshots, setFeedbackSnapshots] = useState<Partial<Record<RepushColumnId, FeedbackCenterState>>>({});
  const [feedbackError, setFeedbackError] = useState('');
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

  // Refresh precomputed summaries only; failures never erase trusted feedback.
  useEffect(() => {
    if (!mounted) return;
    let active = true;
    const load = async () => {
      if (document.hidden) return;
      if (active) setFeedbackError('');
      try {
        const data = await fetchFeedback(view, false, true);
        if (active) {
          setFeedbackSnapshots((current) => ({ ...current, [view]: data }));
          setFeedbackError('');
        }
      } catch { if (active) setFeedbackError('反馈读取失败，请稍后重试'); }
    };
    void load();
    const timer = setInterval(() => void load(), 60_000);
    window.addEventListener('feedback-updated', load);
    document.addEventListener('visibilitychange', load);
    return () => { active = false; clearInterval(timer); window.removeEventListener('feedback-updated', load); document.removeEventListener('visibilitychange', load); };
  }, [mounted, view]);

  const feedbackSnapshot = feedbackSnapshots[view];
  const feedbackItems = feedbackSnapshot?.items ?? EMPTY_FEEDBACK_ITEMS;
  const feedbackReady = feedbackSnapshot !== undefined;

  const feedbackByRecommendation = useMemo(() => {
    const result = new Map<string, FeedbackCenterItem>();
    const fallback = new Map<string, FeedbackCenterItem[]>();
    const recommendationsById = new Map(
      items.filter((item) => item.column === view).map((item) => [item.id, item]),
    );

    for (const feedback of feedbackItems) {
      if (feedback.owner !== view) continue;
      const recommendationId = String(feedback.recommendationId || feedback.id || '').trim();
      const directRecommendation = recommendationId ? recommendationsById.get(recommendationId) : undefined;
      if (directRecommendation && feedbackMatchesRecommendation(feedback, directRecommendation)) {
        result.set(directRecommendation.id, feedback);
        continue;
      }

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

    const fallbackTargets = new Map<string, RepushItem[]>();
    for (const item of items) {
      if (item.column !== view || result.has(item.id)) continue;
      const key = feedbackTargetKey(item);
      if (!key) continue;
      const targets = fallbackTargets.get(key) || [];
      targets.push(item);
      fallbackTargets.set(key, targets);
    }
    for (const [key, targets] of Array.from(fallbackTargets.entries())) {
      const matches = fallback.get(key);
      // 旧记录和投递目标都必须唯一，重复投递不能共享同一条反馈。
      if (targets.length === 1 && matches?.length === 1) result.set(targets[0].id, matches[0]);
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
  const sameJobCandidates = sameJobCandidateOptions(viewItems, talents, candidates, feedbackByRecommendation);
  const unfeedbackItems = feedbackReady
    ? viewItems.filter((item) => (
      isFeedbackEligibleDelivery(item.deliveryStatus)
      && projectFeedbackStatus(feedbackByRecommendation.get(item.id)) === 'pending'
    ))
    : [];
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

  const openRematch = (item: RepushItem) => {
    if (!item.resumeUrl) return;
    setView(item.column);
    router.push(`/resume-matching?rematch=${encodeURIComponent(item.id)}`);
  };

  const confirmSchedule = (args: { interviewAt: string; interviewer: string; round: InterviewRound }) => {
    if (!scheduling) return;
    scheduleRecommendation(scheduling, args, { jds, candidates, addCandidate, updateCandidate, updateItem });
    setScheduling(null);
  };

  // 复推：基于原记录新建一条独立推荐（换岗位/编制/部门），原记录保持不变
  const confirmRepush = (selections: RepushArgs[]) => {
    if (!repushing || selections.length === 0) return;
    const authoritative = selections.flatMap((args) => args.record ? [args.record] : []);
    if (authoritative.length > 0) {
      applyRemoteStoreUpdate('repush', () => {
        for (const record of authoritative) upsertDeliveryRecommendation(record);
        return useRepushStore.getState().items;
      });
    }
    for (const args of selections) {
      if (args.record) continue;
      addRecommendation({
        applicationId: args.applicationId,
        column: repushing.column,
        candidateCode: repushing.candidateCode,
        candidateIdentityId: repushing.candidateIdentityId,
        candidateName: repushing.candidateName || displayName(repushing),
        jdId: args.jdId,
        jdTitle: args.jdTitle || undefined,
        contact: repushing.contact,
        contactPerson: args.contactPerson || undefined,
        rawText: args.recommendationText,
        organization: args.organization || undefined,
        department: args.department || undefined,
        highlights: repushing.highlights,
        resumeUrl: repushing.resumeUrl,
        resumeFileName: repushing.resumeFileName,
        source: args.source,
        repushSourceId: args.repushSourceId,
        deliveryId: args.deliveryId,
        deliveryIndex: args.deliveryIndex,
        deliveryStatus: args.deliveryStatus,
        deliveryUpdatedAt: args.deliveryUpdatedAt,
        telegramMessageId: args.telegramMessageId,
        deliveredAt: args.deliveredAt,
        uploadedAt: args.uploadedAt,
        updatedAt: args.updatedAt,
      });
    }
  };

  const syncSameJobRecords = (records: RepushItem[]) => {
    if (records.length === 0) return;
    applyRemoteStoreUpdate('repush', () => {
      for (const record of records) upsertDeliveryRecommendation(record);
      return useRepushStore.getState().items;
    });
  };

  const hasRecommendedSameJob = (candidate: BulkRepushCandidate, jd: JD) => viewItems.some((item) => (
    sameJobCandidateKey(item) === candidate.key && isSameJobTarget(item, jd)
  ));

  const confirmOffer = (values: OfferFormValues) => {
    if (!offering) return;
    const offerAppliedAt = new Date().toISOString();
    const name = offering.candidateName || offering.fileName.replace(/\.(pdf|docx?)$/i, '').trim();
    const linkedCandidate = findRecommendationCandidate(offering, candidates);
    const jd = offering.jdTitle ? matchJDByTitle(offering.jdTitle, jds) : null;
    const probationSalary = values.probationSalary.trim();
    const regularSalary = values.regularSalary.trim();
    const onboardDate = values.onboardDate ? new Date(values.onboardDate).toISOString() : undefined;
    const salary = [probationSalary && `试用期 ${probationSalary}`, regularSalary && `转正 ${regularSalary}`].filter(Boolean).join(' / ');
    const partial = {
      stage: 'offer' as const,
      owner: offering.column,
      candidateCode: offering.candidateCode || linkedCandidate?.candidateCode,
      score: 0,
      probationSalary: probationSalary || undefined,
      regularSalary: regularSalary || undefined,
      probationMonths: '2',
      commissionTenureMonths: linkedCandidate?.commissionTenureMonths ?? 0,
      onboardDate,
      jobLevel: undefined,
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
      await refreshSyncedData();
      await exportDailyReportExcel({
        column: view,
        name: columnNames[view],
        items: useRepushStore.getState().items,
        candidates: useInterviewStore.getState().candidates,
      });
    } catch (error) {
      alert(error instanceof Error ? error.message : '导出今日日报失败，请重试');
    } finally {
      setExportingToday(false);
    }
  };

  const handleOpenDailyReport = async () => {
    setPreparingBoard(true);
    try {
      await refreshSyncedData();
      setReporting(true);
    } finally {
      setPreparingBoard(false);
    }
  };

  const handleOpenWeeklyReport = async () => {
    setPreparingWeekly(true);
    try {
      await refreshSyncedData();
      setWeeklyReporting(true);
    } catch (error) {
      alert(error instanceof Error ? error.message : '生成周报失败，请重试');
    } finally {
      setPreparingWeekly(false);
    }
  };

  return (
    <div className="workspace-page max-w-[1480px]">
      <div className="recommendation-hero relative overflow-hidden rounded-[26px] px-6 py-7 text-white sm:px-8 sm:py-8">
        <div className="relative z-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <p className="mb-4 text-[11px] font-bold uppercase tracking-[0.22em] text-[#a9c4ff]">PENGUIN ISLAND / RECOMMENDATIONS</p>
            <h2 className="text-[32px] font-bold leading-none tracking-[-0.055em] sm:text-[40px]">推荐中心</h2>
            <p className="mt-4 max-w-xl text-sm leading-6 text-[#c4d3ed]">从简历录入到推荐、复推与约面，在这里完成一整条工作流。</p>
            <div className="mt-6 flex flex-wrap items-center gap-2 text-[11px] font-medium text-[#b5c9ec]">
              <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1.5">01 收集简历</span>
              <span className="text-[#6e8dbd]">/</span>
              <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1.5">02 匹配岗位</span>
              <span className="text-[#6e8dbd]">/</span>
              <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1.5">03 推荐复推</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
            <div className="min-w-[118px] rounded-2xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur-sm">
              <span className="block text-[11px] text-[#b5c9ec]">当前视图</span>
              <span className="mt-2 block truncate text-lg font-semibold">{columnNames[view]}</span>
            </div>
            <div className="min-w-[118px] rounded-2xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur-sm">
              <span className="block text-[11px] text-[#b5c9ec]">累计推荐</span>
              <span className="mt-1 block text-[27px] font-semibold tabular-nums tracking-[-0.05em]">{viewItems.length}<small className="ml-1 text-xs font-medium text-[#b5c9ec]">人</small></span>
            </div>
          </div>
        </div>
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
      <div className="workspace-surface p-4 sm:p-6">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-4 border-b border-[#edf1f6] pb-5">
          <h3 className="flex items-center gap-3 text-[17px] font-semibold tracking-[-0.02em] text-slate-900">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#edf3ff] text-[#3159d8]"><Users className="h-[18px] w-[18px]" /></span>
            推荐数据
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500">
              {hasFilter ? `${filteredItems.length} / ${viewItems.length} 人` : `${viewItems.length} 人`}
              {scheduledCount > 0 ? ` · ${scheduledCount} 已约面` : ''}
            </span>
          </h3>
          <div className="recommendation-actions flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
            <button
              type="button"
              onClick={() => setSameJobRepushOpen(true)}
              disabled={sameJobCandidates.length === 0}
              title={sameJobCandidates.length > 0 ? '选择多位人选复推到同一个岗位' : '暂无带原简历的可复推人选'}
              className="flex h-9 items-center gap-1.5 rounded-xl bg-[#3159d8] px-3 text-sm font-semibold text-white shadow-[0_5px_12px_rgba(49,89,216,0.18)] hover:bg-[#254bc2] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Repeat2 className="h-4 w-4" />同岗复推
            </button>
            <button
              type="button"
              onClick={() => setShowingUnfeedback(true)}
              disabled={!feedbackReady}
              title={!feedbackReady ? '正在读取反馈，请稍候' : feedbackError ? '使用上次成功读取的反馈结果' : '复制未反馈岗位'}
              className="flex h-9 items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 text-sm font-medium text-amber-700 hover:bg-amber-100 disabled:cursor-wait disabled:opacity-60"
            >
              <MessageSquareText className="w-4 h-4" />未反馈
            </button>
            {/* 一键看板：把当前推荐人今日数据提交到团队数据看板 */}
            <button
              onClick={handleOpenDailyReport}
              disabled={preparingBoard}
              className="flex h-9 items-center gap-1.5 rounded-xl border border-[#e2e8f2] bg-white px-3 text-sm font-medium text-slate-600 hover:border-[#b7c9ef] hover:bg-[#f7faff]"
            >
              {preparingBoard ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileUp className="w-4 h-4" />}一键看板
            </button>
            {/* 今日日报：直接套用 Excel 模板导出，便于截图提交 */}
            <button
              data-report-action="export-today"
              onClick={handleExportTodayReport}
              disabled={exportingToday}
              className="flex h-9 items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 text-sm font-medium text-emerald-700 hover:bg-emerald-100"
            >
              {exportingToday ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}今日日报
            </button>
            <button
              type="button"
              onClick={handleOpenWeeklyReport}
              disabled={preparingWeekly}
              className="flex h-9 items-center gap-1.5 rounded-xl border border-[#e2e8f2] bg-white px-3 text-sm font-medium text-slate-600 hover:border-[#b7c9ef] hover:bg-[#f7faff] disabled:cursor-wait disabled:opacity-60"
            >
              {preparingWeekly ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarRange className="h-4 w-4" />}周报
            </button>
            {/* 两个推荐人切换（非并排） */}
            <div className="flex overflow-hidden rounded-xl border border-[#e2e8f2] bg-[#f5f7fb] p-0.5 text-sm">
              {(['a', 'b'] as RepushColumnId[]).map((c) => (
                <button
                  key={c}
                  onClick={() => setView(c)}
                  className={cn('h-8 rounded-[9px] px-3.5 font-medium transition-all', view === c ? 'bg-white text-[#3159d8] shadow-[0_2px_7px_rgba(30,54,99,0.1)]' : 'text-slate-500 hover:text-slate-700')}
                >
                  {columnNames[c]}
                </button>
              ))}
            </div>
          </div>
        </div>

        <RecommendationSearchBar filters={filters} onChange={setFilters} />
        {feedbackError && (
          <p role="status" className="mb-3 text-xs text-amber-700">
            {feedbackReady ? '反馈更新失败，继续显示上次成功读取的结果；请稍后重试' : feedbackError}
            {feedbackSnapshot?.generatedAt ? `（当前结果更新于 ${new Date(feedbackSnapshot.generatedAt).toLocaleString('zh-CN')}）` : ''}
          </p>
        )}

        {groups.length > 0 ? (
          <div className="space-y-5">
            {groups.map((g) => (
              <div key={g.key}>
                {/* 日期分隔 */}
                <div className="mb-2.5 flex items-center gap-3">
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                    <CalendarCheck className="h-3.5 w-3.5 text-[#8ea6dc]" />{g.label}
                  </span>
                  <span className="text-xs text-slate-400">{g.candidateGroups.length} 人</span>
                  <div className="h-px flex-1 bg-[#e9eef5]" />
                </div>
                <div className="space-y-1.5">
                  {g.candidateGroups.map((candidateGroup) => {
                    const groupKey = `${g.key}:${candidateGroup.key}`;
                    const expanded = expandedCandidateGroups.has(groupKey);
                    const visibleItems = expanded ? candidateGroup.items : candidateGroup.items.slice(0, 1);
                    return (
                      <div
                        key={groupKey}
                        className={cn('space-y-1.5 transition-all', expanded && candidateGroup.items.length > 1 && 'border-l-2 border-indigo-100 pl-2')}
                      >
                        {visibleItems.map((it, index) => (
                          <RecommendationBar
                            key={it.id}
                            item={it}
                            feedbackItem={feedbackByRecommendation.get(it.id)}
                            feedbackReady={feedbackReady}
                            feedbackUnavailable={!feedbackReady && Boolean(feedbackError)}
                            candidateGroupCount={index === 0 ? candidateGroup.items.length : undefined}
                            candidateGroupExpanded={expanded}
                            candidateGroupItems={index === 0 ? candidateGroup.items : undefined}
                            candidateGroupFeedbackItems={index === 0
                              ? candidateGroup.items.map((groupItem) => feedbackByRecommendation.get(groupItem.id))
                              : undefined}
                            onToggleCandidateGroup={() => toggleCandidateGroup(groupKey)}
                            onSchedule={setScheduling}
                            onEdit={setEditing}
                            onRepush={setRepushing}
                            onRematch={openRematch}
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
      {sameJobRepushOpen && (
        <BulkRepushModal
          owner={view}
          candidateOptions={sameJobCandidates}
          jds={jds}
          isAlreadyRecommended={hasRecommendedSameJob}
          onRecords={syncSameJobRecords}
          onClose={() => setSameJobRepushOpen(false)}
        />
      )}
      {offering && (
        <OfferModal
          item={offering}
          candidate={findRecommendationCandidate(offering, candidates)}
          candidates={candidates}
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
      {weeklyReporting && (
        <WeeklyReportModal
          column={view}
          name={columnNames[view]}
          items={items}
          candidates={candidates}
          jds={jds}
          onClose={() => setWeeklyReporting(false)}
        />
      )}
      {showingUnfeedback && (
        <UnfeedbackModal
          ownerName={columnNames[view]}
          items={unfeedbackItems}
          onClose={() => setShowingUnfeedback(false)}
        />
      )}
    </div>
  );
}
