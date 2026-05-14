export type JDCategory =
  | 'frontend'
  | 'devops'
  | 'administration'
  | 'advertising'
  | 'gaming'
  | 'backend'
  | 'operations'
  | 'product-design'
  | 'finance'
  | 'algorithm'
  | 'customer-service'
  | 'project'
  | 'ai'
  | 'testing'
  | 'hr'
  | 'bd'
  | 'seo'
  | 'director';

export interface SalaryRange { min: number; max: number; currency: string; }

export interface JD {
  id: string;
  title: string;
  department: string;
  category: JDCategory;
  responsibilities: string[];
  requirements: string[];
  preferredQualifications?: string[];
  salaryRange: SalaryRange;
  location?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface JDFilter { search: string; category: JDCategory | 'all'; department?: string; isActive?: boolean; }
export interface JDImportResult { success: number; failed: number; errors: string[]; }

export const JD_CATEGORY_LABELS: Record<JDCategory, string> = {
  frontend: '前端',
  devops: '运维',
  administration: '行政',
  advertising: '广告',
  gaming: '游戏',
  backend: '后端',
  operations: '运营',
  'product-design': '产品设计',
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
};

export const JD_CATEGORY_COLORS: Record<JDCategory, string> = {
  frontend: 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200',
  devops: 'bg-orange-50 text-orange-700 ring-1 ring-inset ring-orange-200',
  administration: 'bg-stone-50 text-stone-600 ring-1 ring-inset ring-stone-200',
  advertising: 'bg-fuchsia-50 text-fuchsia-700 ring-1 ring-inset ring-fuchsia-200',
  gaming: 'bg-purple-50 text-purple-700 ring-1 ring-inset ring-purple-200',
  backend: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200',
  operations: 'bg-cyan-50 text-cyan-700 ring-1 ring-inset ring-cyan-200',
  'product-design': 'bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-200',
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
};

export const ALL_CATEGORIES: JDCategory[] = [
  'frontend', 'devops', 'administration', 'advertising', 'gaming',
  'backend', 'operations', 'product-design', 'finance', 'algorithm',
  'customer-service', 'project', 'ai', 'testing', 'hr', 'bd', 'seo', 'director',
];
