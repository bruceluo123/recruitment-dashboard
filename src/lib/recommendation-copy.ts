import type { RepushColumnId } from '@/store/repush-store';
import type { JD } from '@/types/jd';
import { redactCompromisedTelegram } from '@/lib/security-redaction';

const OWNER_RECOMMENDER: Record<RepushColumnId, string> = {
  a: '麦满分',
  b: 'BOBO @bobomiepucha',
};

export interface RecommendationCandidateFields {
  candidateCode: string;
  candidateName: string;
  workYears: string;
  currentSalary: string;
  expectedSalary: string;
  location: string;
  arrivalTime: string;
  resumeSource: string;
}

export function recommendationOrganization(jd: JD): string {
  const parts = [jd.organization, jd.serviceUnit]
    .map((value) => value?.trim())
    .filter((value): value is string => !!value);
  return Array.from(new Set(parts)).join('/');
}

function formatContactPerson(value?: string): string {
  return redactCompromisedTelegram(value)
    .trim()
    .replace(/([^\s])\s*(@[A-Za-z0-9_]{2,})/g, '$1 $2');
}

export function stripCandidateContactLine(text: string): string {
  return text.split(/\r?\n/).filter(line => !/^\s*(?:候选人)?联系方式\s*[:：]/.test(line)).join('\n');
}

const REQUIRED_REPUSH_FIELDS = ['工作年限', '当前薪资', '期望薪资', '目前所在地', '预计可到岗时间'];

export function missingRepushFields(text: string): string[] {
  const lines = text.split(/\r?\n/);
  return REQUIRED_REPUSH_FIELDS.filter((label) => !lines.some((line) => {
    const prefix = `${label}：`;
    if (!line.startsWith(prefix)) return false;
    const value = line.slice(prefix.length).trim();
    return !!value && !['/', '-', '未填写', '未提供'].includes(value);
  }));
}

/** 首次推荐和复推共用的唯一推荐文案模板。 */
export function buildRecommendationText(
  owner: RepushColumnId,
  jd: JD,
  candidate: RecommendationCandidateFields,
): string {
  return [
    `候选人编码：${candidate.candidateCode}`,
    `${owner === 'b' ? '候选人姓名' : '候选人姓名（英文名）'}：${candidate.candidateName}`,
    `应聘岗位：${jd.title}`,
    `工作年限：${candidate.workYears}`,
    `当前薪资：${candidate.currentSalary}`,
    `期望薪资：${candidate.expectedSalary}`,
    `目前所在地：${candidate.location}`,
    `预计可到岗时间：${candidate.arrivalTime}`,
    '是否已沟通工作地点：是',
    '是否已沟通行业背景要求：是',
    `推荐编制组织/序列/服务单位：${recommendationOrganization(jd)}`,
    '招聘渠道：寻英',
    `简历推荐人：${OWNER_RECOMMENDER[owner]}`,
    `简历来源：${candidate.resumeSource || 'boss'}`,
    `简历对接BP：${formatContactPerson(jd.odc)}`,
  ].join('\n');
}
