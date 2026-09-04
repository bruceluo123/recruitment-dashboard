// 面试约面数据的「汇报表格」双向转换：
// 1) buildInterviewReport：把候选人导出为可粘贴到 Excel/文档的制表符表格
// 2) parseInterviewReport：把同样格式的文本反解析为候选人草稿（用于粘贴导入）

import type { Candidate, CandidateStatus } from '@/types/interview';
import type { InterviewEvent, InterviewRound } from '@/types/interview';
import { getOfferGrade } from '@/lib/offer-compensation';

// 列顺序固定，导出与导入共用同一套表头
const HEADERS = ['日期', '时间', '姓名', '岗位', '编制', '部门', '面试官', '阶段'] as const;

const STAGE_LABELS: Record<CandidateStatus, string> = {
  'interview-1': '一面',
  'interview-2': '二面',
  offer: 'Offer',
};

const LABEL_TO_STAGE: Record<string, CandidateStatus> = {
  一面: 'interview-1', 面试一面: 'interview-1', '1面': 'interview-1',
  二面: 'interview-2', '2面': 'interview-2',
  offer: 'offer', Offer: 'offer', OFFER: 'offer',
};

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** 把候选人导出为制表符分隔的汇报表格（含表头）。仅含有面试时间的候选人。 */
export function buildInterviewReport(candidates: Candidate[]): string {
  const rows = candidates
    .filter((c) => c.interviewDate)
    .sort((a, b) => new Date(a.interviewDate!).getTime() - new Date(b.interviewDate!).getTime())
    .map((c) => {
      const d = new Date(c.interviewDate!);
      const date = `${d.getMonth() + 1}.${d.getDate()}`;
      const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
      return [date, time, c.name, c.jdTitle, c.organization || '', c.department || '', c.interviewer || '', c.interviewRound || STAGE_LABELS[c.stage]].join('\t');
    });
  return [HEADERS.join('\t'), ...rows].join('\n');
}

// 「今日约面」进度表：模仿用户进度表截图，制表符分隔，可直接粘贴 Excel。
// 列：人选姓名 岗位 面试进度 面试时间 [面试详情] [薪资方案] 入职部门 入职地区 招聘渠道
// 不含表头行；面试详情/薪资方案/入职地区/招聘渠道暂无字段来源，留空由用户补充。
// 面试进度按截图写法：一面→1面、二面→2面、offer→Offer
const PROGRESS_LABELS: Record<CandidateStatus, string> = {
  'interview-1': '1面',
  'interview-2': '2面',
  offer: 'Offer',
};

function isSameDay(iso: string, ref: Date): boolean {
  const d = new Date(iso);
  return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth() && d.getDate() === ref.getDate();
}

/**
 * 导出「今日约面」进度表（仅今天有面试时间的候选人）。
 * 入职地区、招聘渠道暂无字段来源，留空由用户在 Excel 中补充。
 */
export function buildTodayScheduleTable(candidates: Candidate[], ref: Date = new Date()): string {
  return buildScheduleTable(candidates.filter((c) => c.interviewDate && isSameDay(c.interviewDate!, ref)));
}

export function buildScheduleTable(candidates: Candidate[]): string {
  return candidates
    .filter((c) => c.interviewDate)
    .sort((a, b) => new Date(a.interviewDate!).getTime() - new Date(b.interviewDate!).getTime())
    .map((c) => {
      const d = new Date(c.interviewDate!);
      // 面试时间按截图写法：月.日 + 轮次，如「6.7一面」
      const time = `${d.getMonth() + 1}.${d.getDate()}${c.interviewRound || STAGE_LABELS[c.stage]}`;
      const dept = c.department || c.organization || '';
      // 面试时间与入职部门之间留两个空列（对应截图的「面试详情」「薪资方案」）
      return [c.name, c.jdTitle, PROGRESS_LABELS[c.stage], time, '', '', dept, '', ''].join('\t');
    })
    .join('\n');
}

export interface RecruitmentReportRange {
  start: string;
  end: string;
}

export interface RecruitmentReportRow {
  key: string;
  candidateIds: string[];
  name: string;
  jdTitle: string;
  stage: InterviewRound;
  interviewDates: string;
  status: '通过' | 'pass';
  salaryPlan: string;
  department: string;
  onboardDate: string;
  workMode: string;
  jobLevel: string;
  score: string;
  source: string;
  sortAt: number;
}

export const RECRUITMENT_REPORT_HEADERS = [
  '候选人', '岗位', '面试阶段', '面试日期', '面试状态', 'Offer薪资',
  '部门', '入职日期', '远程', '等级', '分数', '来源',
] as const;

function localDateKey(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function roundRank(round: InterviewRound): number {
  return round === '三面' ? 3 : round === '二面' ? 2 : 1;
}

function candidateEvents(candidate: Candidate): InterviewEvent[] {
  if (candidate.interviewHistory?.length) return candidate.interviewHistory;
  if (!candidate.interviewDate) return [];
  return [{
    id: `legacy-${candidate.id}`,
    round: candidate.interviewRound || (candidate.stage === 'interview-1' ? '一面' : '二面'),
    interviewDate: candidate.interviewDate,
    scheduledAt: candidate.interviewScheduledAt || candidate.appliedAt,
    interviewer: candidate.interviewer,
  }];
}

function reportIdentity(candidate: Candidate): string {
  const person = candidate.candidateCode || candidate.talentId || candidate.resumeId || candidate.name.trim().toLowerCase();
  return [
    candidate.owner || 'a',
    person,
    candidate.jdTitle.trim().toLowerCase(),
    (candidate.organization || '').trim().toLowerCase(),
    (candidate.department || '').trim().toLowerCase(),
  ].join('|');
}

function formatInterviewDay(event: InterviewEvent): string {
  const date = new Date(event.interviewDate);
  if (Number.isNaN(date.getTime())) return event.interviewDate;
  return `${date.getMonth() + 1}.${date.getDate()}${event.round}`;
}

function formatOnboardDay(iso?: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getDay()];
  return `${date.getMonth() + 1}.${date.getDate()}${weekday}`;
}

function salaryPlan(candidate: Candidate): string {
  return [
    candidate.probationSalary && `试用期${candidate.probationSalary}`,
    candidate.regularSalary && `转正${candidate.regularSalary}`,
    candidate.probationMonths && `试用期${candidate.probationMonths}个月`,
  ].filter(Boolean).join('，');
}

function hasPassed(candidates: Candidate[]): boolean {
  if (candidates.some((candidate) => candidate.outcome === 'failed' || candidate.outcome === 'withdrawn' || candidate.outcome === 'offer-rejected')) return false;
  return candidates.some((candidate) => (
    candidate.stage === 'interview-2'
    || candidate.stage === 'offer'
    || candidate.outcome === 'onboarded'
  ));
}

/**
 * 按面试流程的点击日期回溯，并按「同人 + 同岗位 + 同编制/部门」合并。
 * 淘汰候选人不会被排除；不同部门永远分行。
 */
export function buildRecruitmentReportRows(candidates: Candidate[], range: RecruitmentReportRange): RecruitmentReportRow[] {
  const grouped = new Map<string, { candidates: Candidate[]; events: InterviewEvent[] }>();
  for (const candidate of candidates) {
    const events = candidateEvents(candidate).filter((event) => {
      const key = localDateKey(event.scheduledAt);
      return key >= range.start && key <= range.end;
    });
    if (!events.length) continue;
    const key = reportIdentity(candidate);
    const group = grouped.get(key) || { candidates: [], events: [] };
    group.candidates.push(candidate);
    group.events.push(...events);
    grouped.set(key, group);
  }

  return Array.from(grouped.entries()).map<RecruitmentReportRow>(([key, group]) => {
    const uniqueEvents = Array.from(new Map(
      group.events.map((event) => [`${event.round}|${event.interviewDate}`, event]),
    ).values()).sort((a, b) => new Date(a.interviewDate).getTime() - new Date(b.interviewDate).getTime());
    const latestCandidate = [...group.candidates].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    const offerCandidate = group.candidates.find((candidate) => candidate.offerAppliedAt)
      || group.candidates.find((candidate) => candidate.regularSalary || candidate.onboardDate)
      || latestCandidate;
    const stage = uniqueEvents.reduce<InterviewRound>(
      (latest, event) => roundRank(event.round) > roundRank(latest) ? event.round : latest,
      '一面',
    );
    const grade = getOfferGrade(offerCandidate.regularSalary);
    return {
      key,
      candidateIds: group.candidates.map((candidate) => candidate.id),
      name: latestCandidate.name,
      jdTitle: latestCandidate.jdTitle,
      stage,
      interviewDates: uniqueEvents.map(formatInterviewDay).join('/'),
      status: hasPassed(group.candidates) ? '通过' : 'pass',
      salaryPlan: salaryPlan(offerCandidate),
      department: latestCandidate.department || latestCandidate.organization || '',
      onboardDate: formatOnboardDay(offerCandidate.onboardDate),
      workMode: latestCandidate.workMode || '远程',
      jobLevel: offerCandidate.jobLevel || grade?.level || '',
      score: offerCandidate.score ? String(offerCandidate.score) : grade ? String(grade.score) : '',
      source: latestCandidate.recommendationSource === 'repush' ? '转推荐' : '人才库',
      sortAt: uniqueEvents.length ? new Date(uniqueEvents[0].interviewDate).getTime() : Number.MAX_SAFE_INTEGER,
    };
  }).sort((a, b) => a.sortAt - b.sortAt || a.name.localeCompare(b.name, 'zh-CN'));
}

export function buildRecruitmentReportText(rows: RecruitmentReportRow[], title?: string): string {
  const body = rows.map((row) => [
    row.name,
    row.jdTitle,
    row.stage,
    row.interviewDates,
    row.status,
    row.salaryPlan,
    row.department,
    row.onboardDate,
    row.workMode,
    row.jobLevel,
    row.score,
    row.source,
  ].join('\t'));
  return [title, RECRUITMENT_REPORT_HEADERS.join('\t'), ...body].filter(Boolean).join('\n');
}

/** 导入草稿：可直接喂给 addCandidate（已含必填默认值） */
export type ImportedCandidate = Omit<Candidate, 'id' | 'appliedAt' | 'updatedAt'>;

/**
 * 反解析汇报表格文本为候选人草稿。
 * - 容错：表头行（含「姓名」）自动跳过；制表符或多空格皆可作分隔；日期默认当年。
 * - 至少要有「姓名」才算有效行。
 */
export function parseInterviewReport(text: string): ImportedCandidate[] {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const out: ImportedCandidate[] = [];
  const year = new Date().getFullYear();

  for (const line of lines) {
    if (line.includes('姓名') && line.includes('岗位')) continue; // 表头
    const cols = line.split(/\t|\s{2,}/).map((c) => c.trim());
    if (cols.length < 3) continue;
    const [dateStr, timeStr, name, jdTitle = '', organization = '', department = '', interviewer = '', stageStr = ''] = cols;
    if (!name) continue;

    let interviewDate: string | undefined;
    const dm = dateStr.match(/(\d{1,2})[.\-/月](\d{1,2})/);
    const tm = timeStr.match(/(\d{1,2})[:：点]?(\d{1,2})?/);
    if (dm) {
      const month = parseInt(dm[1], 10) - 1;
      const day = parseInt(dm[2], 10);
      const hour = tm ? parseInt(tm[1], 10) : 0;
      const minute = tm && tm[2] ? parseInt(tm[2], 10) : 0;
      const d = new Date(year, month, day, hour, minute);
      if (!Number.isNaN(d.getTime())) interviewDate = d.toISOString();
    }

    const stage = LABEL_TO_STAGE[stageStr.trim()] || 'interview-1';

    out.push({
      name,
      resumeId: '',
      jdId: '',
      jdTitle,
      organization: organization || undefined,
      department: department || undefined,
      stage,
      score: 0,
      interviewDate,
      interviewer: interviewer || undefined,
    });
  }
  return out;
}
