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
  frontend: 'bg-blue-100 text-blue-700',
  devops: 'bg-orange-100 text-orange-700',
  administration: 'bg-gray-100 text-gray-700',
  advertising: 'bg-pink-100 text-pink-700',
  gaming: 'bg-purple-100 text-purple-700',
  backend: 'bg-green-100 text-green-700',
  operations: 'bg-cyan-100 text-cyan-700',
  'product-design': 'bg-indigo-100 text-indigo-700',
  finance: 'bg-amber-100 text-amber-700',
  algorithm: 'bg-violet-100 text-violet-700',
  'customer-service': 'bg-teal-100 text-teal-700',
  project: 'bg-rose-100 text-rose-700',
  ai: 'bg-sky-100 text-sky-700',
  testing: 'bg-yellow-100 text-yellow-700',
  hr: 'bg-lime-100 text-lime-700',
  bd: 'bg-fuchsia-100 text-fuchsia-700',
  seo: 'bg-emerald-100 text-emerald-700',
  director: 'bg-red-100 text-red-700',
};

export const ALL_CATEGORIES: JDCategory[] = [
  'frontend', 'devops', 'administration', 'advertising', 'gaming',
  'backend', 'operations', 'product-design', 'finance', 'algorithm',
  'customer-service', 'project', 'ai', 'testing', 'hr', 'bd', 'seo', 'director',
];
