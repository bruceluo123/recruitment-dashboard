import type { JDCategory } from '@/types/jd';

// 外部主页/档案链接（由 talent-entry skill 深度检索填充）
export interface TalentLinks {
  maimai?: string;      // 脉脉
  linkedin?: string;    // LinkedIn
  github?: string;      // GitHub
  scholar?: string;     // Google Scholar
  openreview?: string;  // OpenReview
  homepage?: string;    // 个人主页/其它
}

export interface Talent {
  id: string;
  name: string;             // 姓名（中文或英文）
  jobTitle: string;         // 最近一份岗位 title
  categories: JDCategory[]; // 人选分类（复用 JD 的 28 个分类）
  resumeUrl?: string;       // 简历文件下载链接（Vercel Blob URL）
  resumeFileName?: string;  // 简历文件名（用于点击下载显示）
  tg?: string;              // TG 号（点击复制到剪贴板）
  notes?: string;           // 备注
  hasResumeText?: boolean;  // 是否已扫描提取简历文字（文字本体存 KV recruit:talent-text:<id>）
  resumeChars?: number;     // 提取到的有效正文字数

  // —— 结构化档案字段（Tier 2，均可选，由 talent-entry skill 写入）——
  company?: string;         // 最近公司
  department?: string;      // 部门
  techDirection?: string;   // 技术方向（L 分类自由文本标签）
  eduLevel?: string;        // 学历（本科/硕士/博士…）
  school?: string;          // 毕业院校
  major?: string;           // 专业
  gradYear?: string;        // 毕业时间/年份
  location?: string;        // 所在地
  prevCompanies?: string[]; // 曾经任职公司
  email?: string;           // 邮箱
  phone?: string;           // 电话
  links?: TalentLinks;      // 外部主页/档案链接

  createdAt: string;
  updatedAt: string;
}

export interface TalentFilter {
  search: string;
  category: JDCategory | 'all';
}

export interface TalentImportResult {
  success: number;
  failed: number;
  errors: string[];
}
