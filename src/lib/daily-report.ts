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

// 各明细行统一带「渠道 channel」+「优先级 priority」，与数据看板每个环节字段一致。
// priority 存小写 'p0' | 'p1' | 'p2'（空为未选），channel 取 CHANNEL_OPTIONS 文本。
export interface JobLine { name: string; department: string; jobKey: string; qty: number; channel: string; priority: string; }
export interface ScheduledLine { job: string; person: string; date: string; time: string; tz: string; channel: string; priority: string; }
export interface InterviewLine { name: string; department: string; jobKey: string; person: string; status: string; channel: string; priority: string; }

/**
 * 入职人选明细，字段与团队数据看板（remote_records）的 normalizeOnboardDetail 完全一致。
 * 看板站入职台账依据这些 key 渲染/导出，缺字段会显示为空，故此处需与看板同步。
 */
export interface OnboardLine {
  jobName: string;
  candidateName: string;   // 简历名
  nickname: string;        // 花名（默认同简历名）
  department: string;      // 编制组织 / 入职部门
  center: string;          // 中心
  interviewer: string;     // 面试官
  education: string;       // 学历
  recruitTeam: string;     // 寻英渠道
  source: string;          // 招聘来源（渠道）
  teamLead: string;        // 招聘组长
  manager: string;         // 招聘主管
  probationSalary: string;
  probationCurrency: string;
  regularSalary: string;
  regularCurrency: string;
  score: string;           // 到岗评分
  workMode: string;        // 到岗 / 远程 / 其他
  employmentStatus: string;// 在职状态（默认 已入职）
  leftDate: string;        // 离职日期
  onboardDate: string;     // 到岗日期
  priority: string;        // 优先级
}

/** 看板站入职下拉选项，保持与远端一致。 */
export const ONBOARD_WORKMODE_OPTIONS = ['到岗', '远程'] as const;
export const ONBOARD_CHANNEL_OPTIONS = ['TG', '个人资源', 'Indeed', '小红书', '简历储备', '内推', '猎聘', '社群', 'BOSS直聘'] as const;
export const ONBOARD_STATUS_OPTIONS = ['已入职', '待入职', '已离职'] as const;

// 各明细行渠道下拉：与看板站 CHANNEL_OPTIONS 一致（供推荐/收取/约面/面试/Offer/入职复用）。
export const REPORT_CHANNEL_OPTIONS = ONBOARD_CHANNEL_OPTIONS;
// 优先级下拉：看板存小写 'p0'|'p1'|'p2'，此处 value=存储值 label=展示值。
export const REPORT_PRIORITY_OPTIONS = [
  { value: 'p0', label: 'P0' },
  { value: 'p1', label: 'P1' },
  { value: 'p2', label: 'P2' },
] as const;

// 「一键」默认渠道池：只在这几个常用渠道里打散（用户可再改成任意选项）。
const RANDOM_CHANNEL_POOL = ['个人资源', 'BOSS直聘'] as const;
const LEGACY_DEFAULT_CHANNELS = ['转介绍', '人才库'] as const;
/** 随机取一个默认渠道（个人资源 / BOSS直聘）。 */
export function pickRandomChannel(rng: () => number = Math.random): string {
  return RANDOM_CHANNEL_POOL[Math.floor(rng() * RANDOM_CHANNEL_POOL.length)];
}

/** 按行分配默认渠道；多行时固定轮换，彻底避免整批都一样。 */
function pickChannelForRow(index: number): string {
  return RANDOM_CHANNEL_POOL[index % RANDOM_CHANNEL_POOL.length];
}

function isOneClickDefaultChannel(channel: string): boolean {
  return channel === '' ||
    (RANDOM_CHANNEL_POOL as readonly string[]).includes(channel) ||
    (LEGACY_DEFAULT_CHANNELS as readonly string[]).includes(channel);
}

/** 兼容旧草稿：默认渠道行打开时统一按行打散，避免整组被暂存成同一个来源。 */
export function spreadDefaultChannels<T extends { channel: string }>(rows: T[], rng: () => number = Math.random): T[] {
  void rng;
  if (rows.length <= 1) return rows;
  if (!rows.some((row) => isOneClickDefaultChannel(row.channel))) return rows;
  return rows.map((row, i) => (
    isOneClickDefaultChannel(row.channel)
      ? { ...row, channel: pickChannelForRow(i) }
      : row
  ));
}
/** 随机取一个默认优先级（p0 / p1）。 */
export function pickRandomPriority(rng: () => number = Math.random): string {
  return rng() < 0.5 ? 'p0' : 'p1';
}

/** 一行入职明细的默认值：按团队约定预填，减少手工录入。渠道/优先级随机默认（可改）。 */
export function emptyOnboardLine(onboardDate: string, rng: () => number = Math.random): OnboardLine {
  return {
    jobName: '', candidateName: '', nickname: '', department: '', center: '',
    interviewer: '', education: '本科', recruitTeam: '寻英渠道', source: pickRandomChannel(rng),
    teamLead: 'ojisamer', manager: 'evelyn',
    probationSalary: '', probationCurrency: 'CNY', regularSalary: '', regularCurrency: 'CNY',
    score: '', workMode: '远程', employmentStatus: '已入职', leftDate: '',
    onboardDate, priority: pickRandomPriority(rng),
  };
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
  p0rec?: number;
  p1rec?: number;
  p2rec?: number;
  p0sched?: number;
  p1sched?: number;
  p2sched?: number;
  p0int?: number;
  p1int?: number;
  p2int?: number;
  p0onboard?: number;
  p1onboard?: number;
  p2onboard?: number;
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

/** 今日约面明细：appliedAt 落在 ref 当天（即今天在推荐中心点的约面），可按归属人过滤。 */
export function scheduledToday(candidates: Candidate[], ref: Date, owner?: 'a' | 'b'): Candidate[] {
  return candidates
    .filter((c) => {
      if (!c.interviewDate) return false;
      if (owner && (c.owner || 'a') !== owner) return false;
      return isSameDay(c.appliedAt, ref);
    })
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
    else map.set(key, { name, department, jobKey: key, qty: 1, channel: '', priority: '' });
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
  interviews: Candidate[];       // 业务面试明细：已按今日过滤
  scheduled?: Candidate[];       // 约面明细：今日及未来（缺省时回退用 interviews）
  remark?: string;
  id?: string;                   // 覆盖更新时复用既有 id
  rng?: () => number;
}

/** 组装一条可直接提交到看板站的远程日报记录。 */
export function buildRemoteRecord(opts: BuildOptions): RemoteRecord {
  const rng = opts.rng ?? Math.random;
  // 「一键」默认：渠道按行在个人资源 / BOSS直聘中打散，优先级各行随机（均可手改）。
  const recommendDetail = aggregateRecommendations(opts.recommendations)
    .map((j, i) => ({ ...j, channel: pickChannelForRow(i), priority: pickRandomPriority(rng) }));
  const recommendTotal = sum(recommendDetail);
  const cvDetail = buildCvDetail(recommendDetail, rng); // 深拷贝自推荐，渠道/优先级随之带入
  const cvTotal = sum(cvDetail);
  const screenNew = cvTotal > 0 ? cvTotal + rand1to2(rng) : 0;

  const scheduledSource = opts.scheduled ?? opts.interviews;
  const scheduledDetail: ScheduledLine[] = scheduledSource.map((c, i) => ({
    job: c.jdTitle,
    person: c.name,
    date: localDate(c.interviewDate!),
    time: localTime(c.interviewDate!),
    tz: '北京时间',
    channel: pickChannelForRow(i),
    priority: pickRandomPriority(rng),
  }));
  const interviewDetail: InterviewLine[] = opts.interviews.map((c, i) => ({
    name: c.jdTitle,
    department: c.department || '',
    jobKey: makeJobKey(c.jdTitle, c.department || ''),
    person: c.name,
    status: c.stage === 'offer' ? '已通过' : '待反馈',
    channel: pickChannelForRow(i),
    priority: pickRandomPriority(rng),
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
