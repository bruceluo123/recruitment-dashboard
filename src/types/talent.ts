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
  company?: string;         // 最近公司（飞书 O）
  department?: string;      // 部门（飞书 P）
  techDirection?: string;   // 技术方向（飞书 L，L 分类自由文本标签）
  eduLevel?: string;        // 学历（飞书 R，本科985/硕士211…）
  school?: string;          // 毕业院校
  major?: string;           // 本科专业（飞书 S）
  gradYear?: string;        // 最高学历毕业时间（飞书 Q）
  location?: string;        // 所在地（飞书 U）
  prevCompanies?: string[]; // 曾经任职公司（飞书 V）
  email?: string;           // 邮箱（飞书 N）
  phone?: string;           // 电话（飞书 M）
  links?: TalentLinks;      // 外部主页/档案链接（飞书 Y/AD/AE）

  // —— 飞书表对齐补充字段（Tier 3，均可选）——
  recruiter?: string;        // 招聘顾问（飞书 D）
  firstContactAt?: string;   // 首次沟通时间（飞书 E）
  lastContactAt?: string;    // 最新沟通时间（飞书 F）
  workIntent?: string;       // 工作意愿度（飞书 G）
  projectIntent?: string;    // 项目意愿度（飞书 H）
  monthlySalary?: string;    // 月薪（飞书 I）
  annualSalary?: string;     // 年薪（飞书 J）
  bachelorGradYear?: string; // 本科毕业时间（飞书 K）
  level?: string;            // 级别，如 P8/L6（飞书 T）
  wechatStatus?: string;     // 批量加微信状态（飞书 W）
  outreachStatus?: string;   // 是否站内信和邮件（飞书 X）
  friendTrack?: string;      // 添加好友轨迹（飞书 Z）
  account?: string;          // 所属账号（飞书 AA）
  onboardInfo?: string;      // 入职时间及公司类型（飞书 AB）
  techAccount?: string;      // jerry技术账号/领英账号状态（飞书 AC）

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
