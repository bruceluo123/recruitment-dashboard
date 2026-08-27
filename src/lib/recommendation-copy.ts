import type { RepushColumnId } from '@/store/repush-store';
import type { JD } from '@/types/jd';

const OWNER_RECOMMENDER: Record<RepushColumnId, string> = {
  a: '麦满分 @bruceluo123',
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
  contact: string;
  resumeSource: string;
}

export function recommendationOrganization(jd: JD): string {
  const parts = [jd.organization, jd.serviceUnit]
    .map((value) => value?.trim())
    .filter((value): value is string => !!value);
  return Array.from(new Set(parts)).join('/');
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
    ...(owner === 'b' ? [] : [`候选人联系方式：${candidate.contact || '/'}`]),
    `简历对接BP：${jd.odc?.trim() || ''}`,
  ].join('\n');
}
