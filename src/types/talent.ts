import type { JDCategory } from '@/types/jd';

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
