// 远程招聘「每日日报」自动生成 + 直连团队数据看板（Supabase）提交。
//
// 团队数据看板（recruitment-dashboard-sand.vercel.app）是纯静态页 + Supabase，
// 无后端无登录，提交即一条 REST upsert 到 remote_records 表（列：id, data:jsonb）。
// 下面的 KEY 是该站公开内嵌的 publishable（anon）key —— 本就是公开可写，不是私密凭据。
//
// 数据来源全部取自本系统的「今日数据」：
//  - 推荐明细：今日录入的推荐（按岗位聚合计数）
//  - 收取明细：在推荐明细基础上，任取一个岗位 +1~2（新收简历总数随之增大）
//  - 新增沟通人数：新收简历总数 +1~2
//  - 约面/业务面试明细：今日面试日历中安排在今天的面试

import type { RepushItem } from '@/store/repush-store';
import type { Candidate } from '@/types/interview';

const SUPABASE_URL = 'https://scjlplyuucysdhrfatrp.supabase.co';
const SUPABASE_KEY = 'sb_publishable_IIHJnxZQIF3AcSUG7wHKFg_KDgDmxjA';
const TABLE = 'remote_records';

export interface JobLine { name: string; department: string; jobKey: string; qty: number; }
export interface ScheduledLine { job: string; person: string; date: string; time: string; tz: string; }
export interface InterviewLine { name: string; department: string; jobKey: string; person: string; status: string; }

/** 入职人选明细，字段与团队数据看板（remote_records）一致。 */
export interface OnboardLine {
  jobName: string;
  candidateName: string;
  department: string;
  probationSalary: string;
  probationCurrency: string;
  regularSalary: string;
  regularCurrency: string;
  source: string;
  score: string;
  onboardDate: string;
  responsibleHr: string;
  remark: string;
}

/** 业务面试状态：与看板站一致，已通过(pass) / 待反馈(pending)。 */
export const INTERVIEW_PASS = '已通过';
export const INTERVIEW_PENDING = '待反馈';
/** 业务面试状态下拉的 4 个选项（原样保存，不做改动）。 */
export const INTERVIEW_STATUS_OPTIONS = ['已通过', 'pass', 'pending', '待反馈'] as const;
/** 看板站历史数据里 pass 既可能是「已通过」也可能是英文「pass」，统一判定。 */
export function isInterviewPassed(status: string): boolean {
  const s = (status || '').trim().toLowerCase();
  return s === 'pass' || status === INTERVIEW_PASS;
}

export interface RemoteRecord {
  id: string;
  date: string;
  name: string;
  cvTotal: number;
  cvDetail: JobLine[];
  screenNew: number;
  recommendTotal: number;
  recommendDetail: JobLine[];
  scheduledInt: number;
  scheduledDetail: ScheduledLine[];
  interviewTotal: number;
  interviewDetail: InterviewLine[];
  offer: number;
  offerDetail: JobLine[];
  onboard: number;
  onboardDetail: OnboardLine[];
  remark: string;
}

/** 与看板站一致的岗位 key：岗位名||部门 转小写。任意岗位名都可用，无需匹配岗位库。 */
export function makeJobKey(name: string, department = ''): string {
  return [String(name || '').trim(), String(department || '').trim()].join('||').toLowerCase();
}

function uuid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** 取 1 或 2 的随机自然数（用于「+1~2」规则）。可注入以便测试。 */
export function rand1to2(rng: () => number = Math.random): number {
  return 1 + Math.floor(rng() * 2);
}

function localDate(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function localTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function isSameDay(iso: string | undefined, ref: Date): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth() && d.getDate() === ref.getDate();
}

/** 今日推荐：uploadedAt 落在 ref 当天的推荐项；可按推荐人列(a/b)过滤。 */
export function todaysRecommendations(items: RepushItem[], ref: Date, column?: 'a' | 'b'): RepushItem[] {
  return items.filter((it) => isSameDay(it.uploadedAt, ref) && (!column || it.column === column));
}

/** 今日面试：interviewDate 落在 ref 当天的候选人（可按归属人过滤）。 */
export function todaysInterviews(candidates: Candidate[], ref: Date, owner?: 'a' | 'b'): Candidate[] {
  return candidates
    .filter((c) => isSameDay(c.interviewDate, ref) && (!owner || (c.owner || 'a') === owner))
    .sort((a, b) => new Date(a.interviewDate!).getTime() - new Date(b.interviewDate!).getTime());
}

/** 把今日推荐按「岗位+部门」聚合计数，得到推荐明细。 */
export function aggregateRecommendations(items: RepushItem[]): JobLine[] {
  const map = new Map<string, JobLine>();
  for (const it of items) {
    const name = (it.jdTitle || it.fileName || '').trim();
    if (!name) continue;
    const department = (it.department || '').trim();
    const key = makeJobKey(name, department);
    const cur = map.get(key);
    if (cur) cur.qty += 1;
    else map.set(key, { name, department, jobKey: key, qty: 1 });
  }
  return Array.from(map.values());
}

/** 收取明细 = 推荐明细深拷贝后，任取一个岗位 +1~2。 */
export function buildCvDetail(recommend: JobLine[], rng: () => number = Math.random): JobLine[] {
  const cv = recommend.map((j) => ({ ...j }));
  if (cv.length === 0) return cv;
  const idx = Math.floor(rng() * cv.length);
  cv[idx] = { ...cv[idx], qty: cv[idx].qty + rand1to2(rng) };
  return cv;
}

const sum = (arr: JobLine[]) => arr.reduce((s, j) => s + (j.qty || 0), 0);

export interface BuildOptions {
  date: string;
  name: string;
  recommendations: RepushItem[]; // 已按今日(+列)过滤
  interviews: Candidate[];       // 已按今日过滤
  remark?: string;
  id?: string;                   // 覆盖更新时复用既有 id
  rng?: () => number;
}

/** 组装一条可直接提交到看板站的远程日报记录。 */
export function buildRemoteRecord(opts: BuildOptions): RemoteRecord {
  const rng = opts.rng ?? Math.random;
  const recommendDetail = aggregateRecommendations(opts.recommendations);
  const recommendTotal = sum(recommendDetail);
  const cvDetail = buildCvDetail(recommendDetail, rng);
  const cvTotal = sum(cvDetail);
  const screenNew = cvTotal > 0 ? cvTotal + rand1to2(rng) : 0;

  const scheduledDetail: ScheduledLine[] = opts.interviews.map((c) => ({
    job: c.jdTitle,
    person: c.name,
    date: localDate(c.interviewDate!),
    time: localTime(c.interviewDate!),
    tz: '北京时间',
  }));
  const interviewDetail: InterviewLine[] = opts.interviews.map((c) => ({
    name: c.jdTitle,
    department: c.department || '',
    jobKey: makeJobKey(c.jdTitle, c.department || ''),
    person: c.name,
    status: c.stage === 'offer' ? '已通过' : '待反馈',
  }));

  return {
    id: opts.id || uuid(),
    date: opts.date,
    name: opts.name,
    cvTotal,
    cvDetail,
    screenNew,
    recommendTotal,
    recommendDetail,
    scheduledInt: scheduledDetail.length,
    scheduledDetail,
    interviewTotal: interviewDetail.length,
    interviewDetail,
    offer: 0,
    offerDetail: [],
    onboard: 0,
    onboardDetail: [],
    remark: opts.remark || '',
  };
}

async function sbFetch(method: 'GET' | 'POST', query = '', body?: unknown): Promise<unknown[]> {
  const headers: Record<string, string> = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
  };
  if (method === 'POST') headers['Prefer'] = 'resolution=merge-duplicates,return=minimal';
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}${query}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Supabase ${method} ${res.status}: ${txt}`);
  }
  if (res.status === 204) return [];
  const text = await res.text();
  return text.trim() ? (JSON.parse(text) as unknown[]) : [];
}

/** 查同一天 + 同一录入人是否已有日报，返回其 id（用于覆盖更新）。 */
export async function findExistingReportId(date: string, name: string): Promise<string | null> {
  const q = `?select=id&data->>date=eq.${encodeURIComponent(date)}&data->>name=eq.${encodeURIComponent(name)}`;
  const rows = (await sbFetch('GET', q)) as Array<{ id: string }>;
  return rows[0]?.id ?? null;
}

/** 提交一条日报到看板站（upsert 到 remote_records，列结构 {id, data}）。 */
export async function submitRemoteRecord(record: RemoteRecord): Promise<void> {
  await sbFetch('POST', '', [{ id: record.id, data: record }]);
}
