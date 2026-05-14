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
  frontend: 'bg-blue-100 text-blue-700 border-blue-200',
  devops: 'bg-orange-100 text-orange-700 border-orange-200',
  administration: 'bg-stone-100 text-stone-600 border-stone-200',
  advertising: 'bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200',
  gaming: 'bg-purple-100 text-purple-700 border-purple-200',
  backend: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  operations: 'bg-cyan-100 text-cyan-700 border-cyan-200',
  'product-design': 'bg-indigo-100 text-indigo-700 border-indigo-200',
  finance: 'bg-amber-100 text-amber-700 border-amber-200',
  algorithm: 'bg-slate-700 text-white border-slate-700',
  'customer-service': 'bg-teal-100 text-teal-700 border-teal-200',
  project: 'bg-rose-100 text-rose-700 border-rose-200',
  ai: 'bg-green-100 text-green-700 border-green-200',
  testing: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  hr: 'bg-lime-100 text-lime-700 border-lime-200',
  bd: 'bg-pink-100 text-pink-700 border-pink-200',
  seo: 'bg-sky-100 text-sky-700 border-sky-200',
  director: 'bg-red-100 text-red-700 border-red-200',
};

export const ALL_CATEGORIES: JDCategory[] = [
  'frontend', 'devops', 'administration', 'advertising', 'gaming',
  'backend', 'operations', 'product-design', 'finance', 'algorithm',
  'customer-service', 'project', 'ai', 'testing', 'hr', 'bd', 'seo', 'director',
];
