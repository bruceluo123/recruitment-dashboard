import type { RepushColumnId, RepushItem } from '@/store/repush-store';
import type { Candidate } from '@/types/interview';
import type { JD } from '@/types/jd';
import { priorityRank } from '@/types/jd';
import { isFeedbackEligibleDelivery } from '@/lib/feedback-status';
import { matchXunyingResponsibleJob } from '@/lib/xunying-responsible-jobs';

export interface WeeklyReportInput {
  column: RepushColumnId;
  name: string;
  items: RepushItem[];
  candidates: Candidate[];
  jds: JD[];
  referenceDate?: Date;
}

export interface WeeklyReportResult {
  text: string;
  start: Date;
  end: Date;
  recommendationCount: number;
  interviewCount: number;
  offerCount: number;
  onboardCount: number;
}

interface DepartmentRow {
  name: string;
  recommendationPriority: number;
  recommendations: Set<string>;
  interviews: Set<string>;
  offers: Set<string>;
  onboards: Set<string>;
}

function startOfLocalDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function endOfLocalDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 23, 59, 59, 999);
}

/** 周报口径为周一至周六；周日查看时默认生成刚结束的上一周。 */
export function weeklyReportRange(referenceDate = new Date()): { start: Date; end: Date } {
  const ref = startOfLocalDay(referenceDate);
  const weekday = ref.getDay();
  const daysFromMonday = weekday === 0 ? 6 : weekday - 1;
  const start = new Date(ref);
  start.setDate(ref.getDate() - daysFromMonday);
  const end = new Date(start);
  end.setDate(start.getDate() + 5);
  return { start, end: endOfLocalDay(end) };
}

function isInRange(value: string | undefined, start: Date, end: Date): boolean {
  if (!value) return false;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && timestamp >= start.getTime() && timestamp <= end.getTime();
}

function candidateKey(candidate: Candidate): string {
  return candidate.candidateCode?.trim().toUpperCase()
    || candidate.talentId?.trim()
    || candidate.id;
}

function recommendationKey(item: RepushItem): string {
  return item.candidateIdentityId?.trim()
    || item.candidateCode?.trim().toUpperCase()
    || item.talentId?.trim()
    || item.candidateId?.trim()
    || item.candidateName?.trim().toLowerCase()
    || item.id;
}

function isFirstRecommendation(item: RepushItem): boolean {
  return item.source !== 'repush' && !item.repushSourceId;
}

function recommendationDate(item: RepushItem): string | undefined {
  if (!isFeedbackEligibleDelivery(item.deliveryStatus)) return undefined;
  return item.deliveryStatus === 'sent'
    ? (item.deliveredAt || item.deliveryUpdatedAt || item.uploadedAt)
    : item.uploadedAt;
}

function activeOffers(candidates: Candidate[], start: Date, end: Date): Candidate[] {
  return candidates.filter((candidate) => (
    candidate.outcome !== 'failed'
    && candidate.outcome !== 'withdrawn'
    && candidate.outcome !== 'early-departure-30'
    && candidate.outcome !== 'early-departure-7'
    && (candidate.offerAppliedAt
      ? isInRange(candidate.offerAppliedAt, start, end)
      : candidate.stage === 'offer' && isInRange(candidate.updatedAt, start, end))
  ));
}

function activeOnboards(candidates: Candidate[], start: Date, end: Date): Candidate[] {
  return candidates.filter((candidate) => (
    candidate.outcome !== 'failed'
    && candidate.outcome !== 'withdrawn'
    && candidate.outcome !== 'offer-rejected'
    && isInRange(candidate.onboardDate, start, end)
  ));
}

function interviewedInRange(candidate: Candidate, start: Date, end: Date): boolean {
  if (candidate.interviewHistory?.some((event) => isInRange(event.interviewDate, start, end))) return true;
  return isInRange(candidate.interviewDate, start, end);
}

function uniqueCandidates(candidates: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = candidateKey(candidate);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function clean(value: string | undefined): string {
  return String(value || '').trim();
}

function findJD(
  jds: JD[],
  jdId: string | undefined,
  title: string | undefined,
  department?: string,
  organization?: string,
): JD | undefined {
  if (jdId) {
    const exact = jds.find((jd) => jd.id === jdId);
    if (exact) return exact;
  }
  const normalizedTitle = clean(title).toLowerCase();
  if (!normalizedTitle) return undefined;
  const titleMatches = jds.filter((jd) => jd.title.trim().toLowerCase() === normalizedTitle);
  const normalizedDepartment = clean(department).toLowerCase();
  const normalizedOrganization = clean(organization).toLowerCase();
  return titleMatches.find((jd) => (
    (!normalizedDepartment || clean(jd.department).toLowerCase() === normalizedDepartment)
    && (!normalizedOrganization || clean(jd.organization).toLowerCase() === normalizedOrganization)
  )) || titleMatches[0];
}

function departmentFor(
  activity: Pick<RepushItem, 'department' | 'organization' | 'jdId' | 'jdTitle'>
    | Pick<Candidate, 'department' | 'organization' | 'jdId' | 'jdTitle'>,
  jds: JD[],
): string {
  const jd = findJD(jds, activity.jdId, activity.jdTitle, activity.department, activity.organization);
  return clean(activity.department)
    || clean(jd?.department)
    || clean(activity.organization)
    || clean(jd?.organization)
    || '未填写部门';
}

function responsibleDepartmentFor(
  activity: Pick<RepushItem, 'department' | 'organization' | 'jdId' | 'jdTitle'>
    | Pick<Candidate, 'department' | 'organization' | 'jdId' | 'jdTitle'>,
  jds: JD[],
): string | undefined {
  const jd = findJD(jds, activity.jdId, activity.jdTitle, activity.department, activity.organization);
  const responsibleJob = matchXunyingResponsibleJob({
    title: clean(jd?.title) || clean(activity.jdTitle),
    department: clean(jd?.department) || clean(activity.department),
    organizations: [activity.organization, jd?.organization, jd?.serviceUnit],
  });
  if (!responsibleJob) return undefined;
  return clean(responsibleJob.organization)
    .replace(/^北斗\s*[-—–]?\s*/, '')
    .replace(/公司$/, '');
}

function jobTitleFor(activity: { jdTitle?: string }, fallback = '未填写岗位'): string {
  return clean(activity.jdTitle) || fallback;
}

function formatJobDetail<T>(
  activities: T[],
  keyOf: (activity: T) => string,
  titleOf: (activity: T) => string,
  departmentOf: (activity: T) => string,
): string {
  const rows = new Map<string, { title: string; department: string; people: Set<string> }>();
  for (const activity of activities) {
    const title = titleOf(activity);
    const department = departmentOf(activity);
    const rowKey = `${title.toLowerCase()}||${department.toLowerCase()}`;
    const row = rows.get(rowKey) || { title, department, people: new Set<string>() };
    row.people.add(keyOf(activity));
    rows.set(rowKey, row);
  }
  return Array.from(rows.values())
    .sort((a, b) => a.department.localeCompare(b.department, 'zh-CN') || a.title.localeCompare(b.title, 'zh-CN'))
    .map((row) => `${row.title}*${row.people.size}(${row.department})`)
    .join('，');
}

function scoreText(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, '');
}

function monthDay(value: Date): string {
  return `${value.getMonth() + 1}.${value.getDate()}`;
}

export function buildWeeklyReport(input: WeeklyReportInput): WeeklyReportResult {
  const { start, end } = weeklyReportRange(input.referenceDate);
  const ownerCandidates = input.candidates.filter((candidate) => (candidate.owner || 'a') === input.column);
  const recommendations = input.items.filter((item) => (
    item.column === input.column
    && isFirstRecommendation(item)
    && isInRange(recommendationDate(item), start, end)
  ));
  const departmentRecommendations = input.column === 'b'
    ? input.items.filter((item) => (
      item.column === input.column
      && isInRange(recommendationDate(item), start, end)
    ))
    : recommendations;
  const interviews = uniqueCandidates(ownerCandidates.filter((candidate) => interviewedInRange(candidate, start, end)));
  const offers = uniqueCandidates(activeOffers(ownerCandidates, start, end));
  const onboards = uniqueCandidates(activeOnboards(ownerCandidates, start, end));

  const recommendationKeys = new Set(recommendations.map(recommendationKey));
  const onboardDetail = formatJobDetail(
    onboards,
    candidateKey,
    (candidate) => jobTitleFor(candidate),
    (candidate) => departmentFor(candidate, input.jds),
  );
  const offerDetail = formatJobDetail(
    offers,
    candidateKey,
    (candidate) => jobTitleFor(candidate),
    (candidate) => departmentFor(candidate, input.jds),
  );

  const departments = new Map<string, DepartmentRow>();
  const departmentRow = (name: string): DepartmentRow => {
    const existing = departments.get(name);
    if (existing) return existing;
    const created: DepartmentRow = {
      name,
      recommendationPriority: 99,
      recommendations: new Set<string>(),
      interviews: new Set<string>(),
      offers: new Set<string>(),
      onboards: new Set<string>(),
    };
    departments.set(name, created);
    return created;
  };

  for (const item of departmentRecommendations) {
    const jd = findJD(input.jds, item.jdId, item.jdTitle, item.department, item.organization);
    const responsibleDepartment = responsibleDepartmentFor(item, input.jds);
    if (!responsibleDepartment) continue;
    const row = departmentRow(responsibleDepartment);
    row.recommendations.add(input.column === 'b' ? (item.applicationId || item.id) : recommendationKey(item));
    row.recommendationPriority = Math.min(row.recommendationPriority, priorityRank(jd?.priority));
  }
  for (const candidate of interviews) {
    const responsibleDepartment = responsibleDepartmentFor(candidate, input.jds);
    if (responsibleDepartment) departmentRow(responsibleDepartment).interviews.add(candidateKey(candidate));
  }
  for (const candidate of offers) {
    const responsibleDepartment = responsibleDepartmentFor(candidate, input.jds);
    if (responsibleDepartment) departmentRow(responsibleDepartment).offers.add(candidateKey(candidate));
  }
  for (const candidate of onboards) {
    const responsibleDepartment = responsibleDepartmentFor(candidate, input.jds);
    if (responsibleDepartment) departmentRow(responsibleDepartment).onboards.add(candidateKey(candidate));
  }

  const recommendedDepartments = Array.from(departments.values())
    .filter((row) => row.recommendations.size > 0);
  const departmentLines = recommendedDepartments
    .sort((a, b) => {
      if (a.recommendationPriority !== b.recommendationPriority) {
        return a.recommendationPriority - b.recommendationPriority;
      }
      const aTotal = a.recommendations.size + a.interviews.size + a.offers.size + a.onboards.size;
      const bTotal = b.recommendations.size + b.interviews.size + b.offers.size + b.onboards.size;
      return bTotal - aTotal || a.name.localeCompare(b.name, 'zh-CN');
    })
    .map((row, index) => {
      const activity = [
        `推荐${row.recommendations.size}人`,
        row.interviews.size > 0 ? `面试${row.interviews.size}人` : '',
        row.offers.size > 0 ? `Offer ${row.offers.size}人` : '',
        row.onboards.size > 0 ? `入职${row.onboards.size}人` : '',
      ].filter(Boolean).join('，');
      const sequence = input.column === 'b' ? `${index + 1}）` : `（${index + 1}）`;
      return `${sequence}${row.name}：${activity}`;
    });
  if (departmentLines.length === 0) departmentLines.push('暂无本周负责部门推荐记录');

  const dateLabel = `${monthDay(start)}-${monthDay(end)}`;
  const onboardLine = `到岗${onboards.length}${onboardDetail ? `：${onboardDetail}` : ''}`;
  const offerLine = `Offer ${offers.length}${offerDetail ? `：${offerDetail}` : ''}`;
  const text = input.column === 'b'
    ? [
      `${dateLabel} ${input.name} 周报`,
      '',
      `1.${onboardLine}`,
      '',
      `2.${offerLine}`,
      '',
      '3.负责部门简历情况：',
      ...departmentLines,
    ].join('\n')
    : [
      `${dateLabel} ${input.name} 周报`,
      '',
      `1. ${onboardLine}`,
      `2. ${offerLine.replace('Offer', 'offer')}`,
      `3. 推荐${recommendationKeys.size}人，面试${interviews.length}人，到岗${scoreText(onboards.reduce((sum, candidate) => sum + (Number(candidate.score) || 0), 0))}分`,
      '4. 负责部门情况：',
      ...departmentLines,
    ].join('\n');

  return {
    text,
    start,
    end,
    recommendationCount: recommendationKeys.size,
    interviewCount: interviews.length,
    offerCount: offers.length,
    onboardCount: onboards.length,
  };
}
