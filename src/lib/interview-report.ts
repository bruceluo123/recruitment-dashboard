// 面试约面数据的「汇报表格」双向转换：
// 1) buildInterviewReport：把候选人导出为可粘贴到 Excel/文档的制表符表格
// 2) parseInterviewReport：把同样格式的文本反解析为候选人草稿（用于粘贴导入）

import type { Candidate, CandidateStatus } from '@/types/interview';

// 列顺序固定，导出与导入共用同一套表头
const HEADERS = ['日期', '时间', '姓名', '岗位', '编制', '部门', '面试官', '阶段'] as const;

const STAGE_LABELS: Record<CandidateStatus, string> = {
  'interview-1': '一面',
  'interview-2': '二面',
  offer: 'Offer',
};

const LABEL_TO_STAGE: Record<string, CandidateStatus> = {
  一面: 'interview-1', 面试一面: 'interview-1', '1面': 'interview-1',
  二面: 'interview-2', '2面': 'interview-2',
  offer: 'offer', Offer: 'offer', OFFER: 'offer',
};

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** 把候选人导出为制表符分隔的汇报表格（含表头）。仅含有面试时间的候选人。 */
export function buildInterviewReport(candidates: Candidate[]): string {
  const rows = candidates
    .filter((c) => c.interviewDate)
    .sort((a, b) => new Date(a.interviewDate!).getTime() - new Date(b.interviewDate!).getTime())
    .map((c) => {
      const d = new Date(c.interviewDate!);
      const date = `${d.getMonth() + 1}.${d.getDate()}`;
      const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
      return [date, time, c.name, c.jdTitle, c.organization || '', c.department || '', c.interviewer || '', STAGE_LABELS[c.stage]].join('\t');
    });
  return [HEADERS.join('\t'), ...rows].join('\n');
}

// 「今日约面」进度表：模仿用户进度表截图，制表符分隔，可直接粘贴 Excel。
// 列：人选姓名 岗位 面试进度 面试时间 [面试详情] [薪资方案] 入职部门 入职地区 招聘渠道
// 不含表头行；面试详情/薪资方案/入职地区/招聘渠道暂无字段来源，留空由用户补充。
// 面试进度按截图写法：一面→1面、二面→2面、offer→Offer
const PROGRESS_LABELS: Record<CandidateStatus, string> = {
  'interview-1': '1面',
  'interview-2': '2面',
  offer: 'Offer',
};

function isSameDay(iso: string, ref: Date): boolean {
  const d = new Date(iso);
  return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth() && d.getDate() === ref.getDate();
}

/**
 * 导出「今日约面」进度表（仅今天有面试时间的候选人）。
 * 入职地区、招聘渠道暂无字段来源，留空由用户在 Excel 中补充。
 */
export function buildTodayScheduleTable(candidates: Candidate[], ref: Date = new Date()): string {
  return candidates
    .filter((c) => c.interviewDate && isSameDay(c.interviewDate!, ref))
    .sort((a, b) => new Date(a.interviewDate!).getTime() - new Date(b.interviewDate!).getTime())
    .map((c) => {
      const d = new Date(c.interviewDate!);
      // 面试时间按截图写法：月.日 + 轮次，如「6.7一面」
      const time = `${d.getMonth() + 1}.${d.getDate()}${STAGE_LABELS[c.stage]}`;
      const dept = c.department || c.organization || '';
      // 面试时间与入职部门之间留两个空列（对应截图的「面试详情」「薪资方案」）
      return [c.name, c.jdTitle, PROGRESS_LABELS[c.stage], time, '', '', dept, '', ''].join('\t');
    })
    .join('\n');
}

/** 导入草稿：可直接喂给 addCandidate（已含必填默认值） */
export type ImportedCandidate = Omit<Candidate, 'id' | 'appliedAt' | 'updatedAt'>;

/**
 * 反解析汇报表格文本为候选人草稿。
 * - 容错：表头行（含「姓名」）自动跳过；制表符或多空格皆可作分隔；日期默认当年。
 * - 至少要有「姓名」才算有效行。
 */
export function parseInterviewReport(text: string): ImportedCandidate[] {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const out: ImportedCandidate[] = [];
  const year = new Date().getFullYear();

  for (const line of lines) {
    if (line.includes('姓名') && line.includes('岗位')) continue; // 表头
    const cols = line.split(/\t|\s{2,}/).map((c) => c.trim());
    if (cols.length < 3) continue;
    const [dateStr, timeStr, name, jdTitle = '', organization = '', department = '', interviewer = '', stageStr = ''] = cols;
    if (!name) continue;

    let interviewDate: string | undefined;
    const dm = dateStr.match(/(\d{1,2})[.\-/月](\d{1,2})/);
    const tm = timeStr.match(/(\d{1,2})[:：点]?(\d{1,2})?/);
    if (dm) {
      const month = parseInt(dm[1], 10) - 1;
      const day = parseInt(dm[2], 10);
      const hour = tm ? parseInt(tm[1], 10) : 0;
      const minute = tm && tm[2] ? parseInt(tm[2], 10) : 0;
      const d = new Date(year, month, day, hour, minute);
      if (!Number.isNaN(d.getTime())) interviewDate = d.toISOString();
    }

    const stage = LABEL_TO_STAGE[stageStr.trim()] || 'interview-1';

    out.push({
      name,
      resumeId: '',
      jdId: '',
      jdTitle,
      organization: organization || undefined,
      department: department || undefined,
      stage,
      score: 0,
      interviewDate,
      interviewer: interviewer || undefined,
    });
  }
  return out;
}
