export type JDCategory =
  | 'frontend'
  | 'devops'
  | 'administration'
  | 'advertising'
  | 'gaming'
  | 'backend'
  | 'operations'
  | 'product'
  | 'design'
  | 'finance'
  | 'algorithm'
  | 'customer-service'
  | 'project'
  | 'ai'
  | 'testing'
  | 'hr'
  | 'bd'
  | 'seo'
  | 'director'
  | 'data'
  | 'hardware'
  | 'art'
  | 'marketing'
  | 'video'
  | 'live'
  | 'legal'
  | 'training'
  | 'content';

export type JDStatus = 'active' | 'urgent' | 'paused';

export interface SalaryRange { min: number; max: number; currency: string; }

export interface JD {
  id: string;
  title: string;
  department: string;
  organization?: string;
  serviceUnit?: string;
  headcount?: string;
  gap?: string;
  priority?: string;             // 优先级：P0 / P1 / P2 / P3（源表"优先级"列）
  odc?: string;                  // 对接 ODC（源表"对应的ODC"列）
  reqKey?: string;               // 需求Key（源表 REQ-xxx 列）——跨导入的唯一身份，用于去重
  expedited?: boolean;           // 加急（源表 ❗ 标记）——独立于优先级，用于热招看板「加急岗位」栏
  categories: JDCategory[];
  responsibilities: string[];
  requirements: string[];
  preferredQualifications?: string[];
  salaryRange: SalaryRange;
  salaryText?: string;
  location?: string;
  status: JDStatus;
  source?: 'manual' | 'google-sync';  // 来源：手动添加 / 谷歌表格自动同步
  createdAt: string;
  updatedAt: string;
}

export const JD_STATUS_LABELS: Record<JDStatus, string> = { active: '活跃', urgent: '急招', paused: '暂缓' };
export const JD_STATUS_COLORS: Record<JDStatus, string> = {
  active: 'bg-green-100 text-green-700 ring-1 ring-inset ring-green-200',
  urgent: 'bg-red-100 text-red-700 ring-1 ring-inset ring-red-200',
  paused: 'bg-gray-100 text-gray-500 ring-1 ring-inset ring-gray-200',
};

export interface JDFilter { search: string; category: JDCategory | 'all'; department?: string; status?: JDStatus; }

/** 从原始文本中解析优先级，归一化为 P0/P1/P2/P3。无法识别返回 undefined */
export function parsePriority(raw?: string): string | undefined {
  if (!raw) return undefined;
  const m = String(raw).match(/P\s*([0-3])/i);
  return m ? `P${m[1]}` : undefined;
}

/** 是否急招优先级（P0 或 P1） */
export function isUrgentPriority(priority?: string): boolean {
  return priority === 'P0' || priority === 'P1';
}

/** 优先级排序权重：P0 最高 */
export function priorityRank(priority?: string): number {
  switch (priority) {
    case 'P0': return 0;
    case 'P1': return 1;
    case 'P2': return 2;
    case 'P3': return 3;
    default: return 99;
  }
}

export const PRIORITY_COLORS: Record<string, string> = {
  P0: 'bg-red-100 text-red-700 ring-1 ring-inset ring-red-300',
  P1: 'bg-amber-100 text-amber-700 ring-1 ring-inset ring-amber-300',
  P2: 'bg-sky-100 text-sky-700 ring-1 ring-inset ring-sky-300',
  P3: 'bg-gray-100 text-gray-600 ring-1 ring-inset ring-gray-300',
};

/** Get the primary category (first one) for backward compat */
export function getPrimaryCategory(jd: { categories?: JDCategory[]; category?: JDCategory }): JDCategory {
  if (jd.categories && jd.categories.length > 0) return jd.categories[0];
  if (jd.category) return jd.category;
  return 'operations';
}

export function hasCategory(jd: { categories?: JDCategory[]; category?: JDCategory }, cat: JDCategory): boolean {
  if (jd.categories) return jd.categories.includes(cat);
  return jd.category === cat;
}
export interface JDImportResult { success: number; failed: number; errors: string[]; skipped?: number; replaced?: number; }

export const JD_CATEGORY_LABELS: Record<JDCategory, string> = {
  frontend: '前端',
  devops: '运维',
  administration: '行政',
  advertising: '广告',
  gaming: '游戏',
  backend: '后端',
  operations: '运营',
  product: '产品',
  design: '设计',
  finance: '财务',
  algorithm: '算法',
  'customer-service': '客服',
  project: '项目',
  ai: 'AI',
  testing: '测试',
  hr: 'HR',
  bd: 'BD',
  seo: 'SEO',
  director: '总监级',
  data: '数据',
  hardware: '硬件',
  art: '美术',
  marketing: '市场',
  video: '视频',
  live: '直播',
  legal: '法务',
  training: '培训',
  content: '内容',
};

export const JD_CATEGORY_COLORS: Record<JDCategory, string> = {
  frontend: 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200',
  devops: 'bg-orange-50 text-orange-700 ring-1 ring-inset ring-orange-200',
  administration: 'bg-stone-50 text-stone-600 ring-1 ring-inset ring-stone-200',
  advertising: 'bg-fuchsia-50 text-fuchsia-700 ring-1 ring-inset ring-fuchsia-200',
  gaming: 'bg-purple-50 text-purple-700 ring-1 ring-inset ring-purple-200',
  backend: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200',
  operations: 'bg-cyan-50 text-cyan-700 ring-1 ring-inset ring-cyan-200',
  product: 'bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-200',
  design: 'bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-200',
  finance: 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200',
  algorithm: 'bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-300',
  'customer-service': 'bg-teal-50 text-teal-700 ring-1 ring-inset ring-teal-200',
  project: 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200',
  ai: 'bg-green-50 text-green-700 ring-1 ring-inset ring-green-200',
  testing: 'bg-yellow-50 text-yellow-700 ring-1 ring-inset ring-yellow-200',
  hr: 'bg-lime-50 text-lime-700 ring-1 ring-inset ring-lime-200',
  bd: 'bg-pink-50 text-pink-700 ring-1 ring-inset ring-pink-200',
  seo: 'bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200',
  director: 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-200',
  data: 'bg-zinc-100 text-zinc-700 ring-1 ring-inset ring-zinc-300',
  hardware: 'bg-neutral-100 text-neutral-700 ring-1 ring-inset ring-neutral-300',
  art: 'bg-orange-100 text-orange-800 ring-1 ring-inset ring-orange-300',
  marketing: 'bg-rose-100 text-rose-800 ring-1 ring-inset ring-rose-300',
  video: 'bg-sky-100 text-sky-800 ring-1 ring-inset ring-sky-300',
  live: 'bg-red-100 text-red-800 ring-1 ring-inset ring-red-300',
  legal: 'bg-slate-200 text-slate-800 ring-1 ring-inset ring-slate-400',
  training: 'bg-teal-100 text-teal-800 ring-1 ring-inset ring-teal-300',
  content: 'bg-emerald-100 text-emerald-800 ring-1 ring-inset ring-emerald-300',
};

export const ALL_CATEGORIES: JDCategory[] = [
  'frontend', 'devops', 'administration', 'advertising', 'gaming',
  'backend', 'operations', 'product', 'design', 'finance', 'algorithm',
  'customer-service', 'project', 'ai', 'testing', 'hr', 'bd', 'seo', 'director',
  'data', 'hardware', 'art', 'marketing', 'video', 'live', 'legal',
  'training', 'content',
];
