import type { Candidate, CandidateOwner } from '@/types/interview';

export type OfferSalaryTier = '初级岗位' | '中级/组长' | '高级/主管/经理' | '专家/总监' | '特殊人才/CEO';

export interface OfferCommission {
  salary: number;
  salaryTier: OfferSalaryTier;
  jobCategory: string;
  difficultyCoefficient: number;
  onboardCount: number;
  commissionRate: number;
  commissionAmount: number;
  installments: [number, number, number];
  eligible: boolean;
  status: 'estimated' | 'below-minimum' | 'missing-onboard-date' | 'cancelled';
}

type Coefficients = [number, number, number, number, number];

interface JobRule {
  label: string;
  pattern: RegExp;
  coefficients: Coefficients;
}

const STANDARD: Coefficients = [1.05, 1.15, 1.30, 1.80, 2.10];
const BASIC: Coefficients = [1.00, 1.10, 1.25, 1.70, 2.00];
const SKILLED: Coefficients = [1.15, 1.25, 1.45, 1.95, 2.30];
const DIFFICULT: Coefficients = [1.30, 1.45, 1.60, 2.20, 2.60];
const VERY_DIFFICULT: Coefficients = [1.50, 1.65, 1.90, 2.55, 3.00];

// 按《2026招聘新绩效提成（专员版）》岗位难度表由具体到通用匹配。
const JOB_RULES: JobRule[] = [
  { label: '架构/性能优化', pattern: /架构|性能优化|系统优化|技术选型/, coefficients: VERY_DIFFICULT },
  { label: '技术及业务管理', pattern: /(?:技术|研发|业务).*(?:负责人|总监|经理)|(?:负责人|总监).*(?:技术|研发|业务)/, coefficients: VERY_DIFFICULT },
  { label: 'AI算法/Agent开发', pattern: /(?:ai|人工智能).*(?:算法|大模型|机器学习)|(?:算法|大模型|机器学习).*ai|agent开发/i, coefficients: VERY_DIFFICULT },
  { label: 'AI内容创作/AI编导', pattern: /ai.*(?:内容创作|编导|导演)|(?:内容创作|编导|导演).*ai/i, coefficients: VERY_DIFFICULT },
  { label: 'AI短剧/AIGC影视制作', pattern: /ai短剧|aigc.*(?:影视|视频|短剧)|(?:影视|视频|短剧).*aigc/i, coefficients: VERY_DIFFICULT },
  { label: '广告投放', pattern: /广告投放|投放优化|媒介投放|买量|信息流/, coefficients: VERY_DIFFICULT },
  { label: '后端Agent开发', pattern: /后端.*agent|agent.*后端/i, coefficients: DIFFICULT },
  { label: 'AI应用/Agent工程', pattern: /ai应用|agent工程|工作流|mlops/i, coefficients: DIFFICULT },
  { label: '品牌/市场策划/KOL开发', pattern: /品牌|市场策划|kol|公关|媒介策划/i, coefficients: DIFFICULT },
  { label: '经营/商业/数据决策分析', pattern: /经营分析|商业分析|数据决策|策略分析/, coefficients: DIFFICULT },
  { label: '法务', pattern: /法务|律师|合规|网络安全负责人|金融合规/, coefficients: DIFFICULT },
  { label: '数据分析/大数据架构', pattern: /数据分析|大数据|数据架构|数据工程/, coefficients: DIFFICULT },
  { label: '商务/BD/渠道', pattern: /商务|\bbd\b|渠道/i, coefficients: DIFFICULT },
  { label: 'SEO', pattern: /\bseo\b|搜索引擎优化/i, coefficients: DIFFICULT },
  { label: '游戏策划', pattern: /游戏策划|数值策划|系统策划|关卡策划/, coefficients: DIFFICULT },
  { label: '游戏服务端/功能开发', pattern: /游戏.*(?:服务端|后端|功能开发)|(?:服务端|功能开发).*(?:游戏|fps)/i, coefficients: DIFFICULT },
  { label: '游戏美术/3D/绑定/MOD', pattern: /游戏美术|\b3d\b|绑定|\bmod\b/i, coefficients: DIFFICULT },
  { label: '全栈开发', pattern: /全栈/i, coefficients: SKILLED },
  { label: '项目管理', pattern: /项目经理|项目管理|\bpmo\b/i, coefficients: SKILLED },
  { label: '培训/效能/流程工程', pattern: /培训|效能|sop|流程工程|业务专家/i, coefficients: SKILLED },
  { label: '财务/风控/成本核算/定价', pattern: /财务|风控|成本核算|定价|会计|出纳|税务/, coefficients: SKILLED },
  { label: 'APP/产品运营', pattern: /app运营|产品运营/i, coefficients: [1.15, 1.25, 1.45, 1.80, 2.10] },
  { label: '产品', pattern: /产品经理|产品负责人|产品专员/, coefficients: SKILLED },
  { label: '增长运营', pattern: /增长运营|用户增长|增长经理|增长负责人/, coefficients: [1.15, 1.25, 1.55, 2.00, 2.30] },
  { label: '内容运营', pattern: /内容运营|社区运营/, coefficients: [1.15, 1.25, 1.45, 2.20, 2.40] },
  { label: '新媒体运营', pattern: /新媒体运营|社媒运营|social media/i, coefficients: [1.15, 1.25, 1.45, 2.20, 2.40] },
  { label: '游戏客户端开发', pattern: /游戏.*(?:客户端|unity|cocos|ue\d*)|(?:unity|cocos|ue\d*).*游戏/i, coefficients: SKILLED },
  { label: 'Flutter/SSR/RN前端', pattern: /flutter|\bssr\b|react native|\brn\b/i, coefficients: STANDARD },
  { label: '后端开发', pattern: /后端|服务端|\bphp\b|\bjava\b|golang|\bgo\b/i, coefficients: STANDARD },
  { label: '测试', pattern: /测试|qa|质量保障/i, coefficients: STANDARD },
  { label: '运维', pattern: /运维|devops|sre|网络工程|系统工程/i, coefficients: STANDARD },
  { label: '人事', pattern: /人事|hrbp|招聘|薪酬|员工关系|\bssc\b|\bcoe\b/i, coefficients: STANDARD },
  { label: '行政及综合', pattern: /行政|综合管理|总务|助理|秘书/, coefficients: STANDARD },
  { label: '内容审核/业务审查/舆情监测', pattern: /内容审核|业务审查|舆情|审核员/, coefficients: STANDARD },
  { label: '设计', pattern: /设计|ui|ux|ue设计/i, coefficients: STANDARD },
  { label: 'AI剪辑/视频', pattern: /ai.*(?:剪辑|视频)|(?:剪辑|视频).*ai/i, coefficients: STANDARD },
  { label: '内容编辑/文案', pattern: /内容编辑|编辑|文案|撰稿/, coefficients: STANDARD },
  { label: '前端开发', pattern: /前端|web|android|ios|c#|avalonia/i, coefficients: BASIC },
  { label: '客服', pattern: /客服|客户服务/, coefficients: BASIC },
  { label: '商务/编辑/资料', pattern: /资料|档案/, coefficients: BASIC },
  { label: '审计', pattern: /审计/, coefficients: BASIC },
];

/** 兼容 30000、30K、3万、30,000 人民币/月等常见薪资写法。 */
export function parseMonthlySalary(value?: string): number | null {
  if (!value) return null;
  const normalized = value.trim().replace(/,/g, '');
  const match = normalized.match(/(\d+(?:\.\d+)?)\s*(k|千|w|万)?/i);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  const unit = match[2]?.toLowerCase();
  if (unit === 'k' || unit === '千') return amount * 1000;
  if (unit === 'w' || unit === '万') return amount * 10000;
  return amount;
}

export function getOfferSalaryTier(salary: number): { tier: OfferSalaryTier; index: number } {
  if (salary < 15_000) return { tier: '初级岗位', index: 0 };
  if (salary <= 25_000) return { tier: '中级/组长', index: 1 };
  if (salary <= 35_000) return { tier: '高级/主管/经理', index: 2 };
  if (salary <= 45_000) return { tier: '专家/总监', index: 3 };
  return { tier: '特殊人才/CEO', index: 4 };
}

export function getMonthlyCommissionRate(onboardCount: number): number {
  if (onboardCount < 3) return 0;
  if (onboardCount <= 5) return 0.04;
  if (onboardCount <= 9) return 0.05;
  if (onboardCount <= 14) return 0.06;
  return 0.07;
}

export function getOfferJobRule(jobTitle: string, salary: number): { category: string; coefficient: number; salaryTier: OfferSalaryTier } {
  const rule = JOB_RULES.find((item) => item.pattern.test(jobTitle)) || { label: '通用岗位', coefficients: STANDARD };
  const { tier, index } = getOfferSalaryTier(salary);
  return { category: rule.label, coefficient: rule.coefficients[index], salaryTier: tier };
}

export function calculateOfferCommission(args: {
  regularSalary?: string;
  jobTitle: string;
  onboardCount: number;
  hasOnboardDate?: boolean;
  cancelled?: boolean;
}): OfferCommission | null {
  const salary = parseMonthlySalary(args.regularSalary);
  if (salary === null || salary <= 0) return null;
  const { category, coefficient, salaryTier } = getOfferJobRule(args.jobTitle, salary);
  const rate = getMonthlyCommissionRate(args.onboardCount);
  const cancelled = Boolean(args.cancelled);
  const eligible = Boolean(args.hasOnboardDate && !cancelled && rate > 0);
  const amount = eligible ? Math.min(8000, salary * rate * coefficient) : 0;
  const rounded = Math.round(amount * 100) / 100;
  return {
    salary,
    salaryTier,
    jobCategory: category,
    difficultyCoefficient: coefficient,
    onboardCount: args.onboardCount,
    commissionRate: rate,
    commissionAmount: rounded,
    installments: [0.7, 0.2, 0.1].map((ratio) => Math.round(rounded * ratio * 100) / 100) as [number, number, number],
    eligible,
    status: cancelled ? 'cancelled' : !args.hasOnboardDate ? 'missing-onboard-date' : rate === 0 ? 'below-minimum' : 'estimated',
  };
}

const CANCELLED_OUTCOMES = new Set(['offer-rejected', 'failed', 'withdrawn', 'early-departure-30', 'early-departure-7']);

function monthKey(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function isEffectiveOnboard(candidate: Candidate): boolean {
  return candidate.stage === 'offer'
    && Boolean(candidate.onboardDate)
    && !CANCELLED_OUTCOMES.has(candidate.outcome || '');
}

export function countEffectiveOnboards(candidates: Candidate[], onboardDate?: string, owner?: CandidateOwner): number {
  const targetMonth = monthKey(onboardDate);
  if (!targetMonth) return 0;
  return candidates.filter((candidate) => (
    (candidate.owner || 'a') === (owner || 'a')
    && isEffectiveOnboard(candidate)
    && monthKey(candidate.onboardDate) === targetMonth
  )).length;
}

function regularSalaryOf(candidate: Candidate): string | undefined {
  if (candidate.regularSalary) return candidate.regularSalary;
  const match = candidate.salary?.match(/转正\s*([^/]+)/);
  return match?.[1]?.trim() || candidate.salary;
}

export function getOfferCommissionForCandidate(candidate: Candidate, candidates: Candidate[]): OfferCommission | null {
  return calculateOfferCommission({
    regularSalary: regularSalaryOf(candidate),
    jobTitle: candidate.jdTitle,
    onboardCount: countEffectiveOnboards(candidates, candidate.onboardDate, candidate.owner),
    hasOnboardDate: Boolean(candidate.onboardDate),
    cancelled: CANCELLED_OUTCOMES.has(candidate.outcome || ''),
  });
}

export function formatCommissionAmount(value: number): string {
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value);
}

export const COMMISSION_TENURE_OPTIONS = [
  { value: 0, label: '未满1个月', ratio: 0 },
  { value: 1, label: '满1个月', ratio: 0.7 },
  { value: 2, label: '满2个月', ratio: 0.9 },
  { value: 3, label: '满3个月', ratio: 1 },
] as const;

export function getCommissionPayout(commission: OfferCommission | null | undefined, months = 0): { ratio: number; amount: number } {
  const option = COMMISSION_TENURE_OPTIONS.find((item) => item.value === months) || COMMISSION_TENURE_OPTIONS[0];
  return {
    ratio: option.ratio,
    amount: commission?.eligible ? Math.round(commission.commissionAmount * option.ratio * 100) / 100 : 0,
  };
}
