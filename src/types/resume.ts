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
}
