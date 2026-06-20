import type { JDCategory } from '@/types/jd';

/** 公司研究信息源（带可点击/可复制验证的原始 URL） */
export interface CompanySource {
  title: string;
  url: string;
}

/** 公司研究的单个维度（11 维之一） */
export interface CompanyDimension {
  key: number;            // 1..11
  title: string;          // 维度名，如 "公司基本盘"
  body: string;           // 维度正文（保留换行）
  sources: CompanySource[];
}

/** 公司库记录 — 张振 11 维度公司研究的结构化承载 */
export interface Company {
  id: string;
  name: string;                 // 公司全称/简称
  industry?: string;            // 行业（如 "AI"、"医疗健康"）
  categories?: JDCategory[];    // 关联岗位分类，便于按方向筛选
  dims: CompanyDimension[];     // 11 个维度
  summary?: string;             // 一句话备注（非投资判断）
  researchedBy?: string;        // 研究人（花名）
  relatedReqKeys?: string[];    // 关联 JD 的 reqKey，详情页可回链
  createdAt: string;
  updatedAt: string;
}

export interface CompanyFilter {
  search: string;
  category: JDCategory | 'all';
}

/** 11 个维度的固定标题，顺序与 company-research skill 一致 */
export const COMPANY_DIMENSION_TITLES: readonly string[] = [
  '公司基本盘',
  '团队和老板',
  '赛道和市场',
  '时机和产业周期',
  '客户痛点',
  '产品/服务/业务闭环和近一年动作',
  '商业模式',
  '增长状态',
  '竞争位置',
  '护城河',
  '风险和负面',
];

/** 生成 11 个空维度骨架，供手动新建公司时填充 */
export function emptyDimensions(): CompanyDimension[] {
  return COMPANY_DIMENSION_TITLES.map((title, i) => ({
    key: i + 1,
    title,
    body: '',
    sources: [],
  }));
}

/** 是否已有实质研究内容（至少一个维度有正文） */
export function hasResearch(company: Pick<Company, 'dims'>): boolean {
  return (company.dims || []).some((d) => d.body.trim().length > 0);
}

export interface CompanyImportResult { success: number; failed: number; errors: string[]; }
