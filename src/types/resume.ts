export interface Experience {
  company: string;
  title: string;
  startDate: string;
  endDate: string | null;
  description: string[];
}

export interface Education {
  institution: string;
  degree: string;
  field: string;
  startDate: string;
  endDate: string;
}

export interface ResumeParsedData {
  name?: string;
  email?: string;
  phone?: string;
  skills: string[];
  experience: Experience[];
  education: Education[];
  summary?: string;
}

export interface Resume {
  id: string;
  fileName: string;
  fileType: 'pdf' | 'docx';
  rawText: string;
  parsedData: ResumeParsedData;
  uploadedAt: string;
  parsingStatus: 'pending' | 'parsing' | 'completed' | 'failed';
  parseError?: string;
  file?: File;      // 原始文件（仅内存保留，resume-store 不持久化），供「存入人才库/录入推荐」上传 Blob
  blobUrl?: string; // 已上传的 Blob 链接（懒上传，只传一次后复用）
}
