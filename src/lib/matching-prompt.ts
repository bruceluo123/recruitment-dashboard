import type { JD } from '@/types/jd';

/** 裁剪过长字段，控制 prompt 体积以提速 */
function clip(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '…' : text;
}

export function buildBatchMatchingPrompt(resumeText: string, jds: JD[]): string {
  const jdList = jds.map((jd, i) => {
    return `### JD-${i + 1}
- 职位：${jd.title}
- 部门：${jd.department}
- 地点：${jd.location || '不限'}
- 薪资：${jd.salaryRange.min}K-${jd.salaryRange.max}K
- 职责：${clip(jd.responsibilities.join('；'), 200)}
- 要求：${clip(jd.requirements.join('；'), 250)}`;
  }).join('\n\n');

  return `你是资深招聘专家。请评估以下简历与${jds.length}个岗位的匹配度。

## 简历
${resumeText}

## 岗位列表
${jdList}

请对每个岗位给出0-100的综合评分和简要理由（reasoning字段20字以内），按评分降序排列。返回严格JSON：
{
  "results": [
    {
      "jdIndex": 1,
      "score": 85,
      "breakdown": {"skillsMatch": 80, "experienceMatch": 85, "educationMatch": 90, "overallFit": 84},
      "reasoning": "技能和经验高度匹配",
      "highlights": ["亮点"],
      "concerns": ["顾虑"]
    }
  ]
}`;
}

export function buildMatchingPrompt(resumeText: string, jd: JD): string {
  return `你是资深招聘专家。分析以下简历与岗位的匹配度。

## 岗位：${jd.title} | ${jd.department} | ${jd.location || '不限'}
薪资：${jd.salaryRange.min}K-${jd.salaryRange.max}K
职责：${jd.responsibilities.join('；')}
要求：${jd.requirements.join('；')}

## 简历
${resumeText}

返回严格JSON（不要markdown代码块）：
{
  "score": 85,
  "breakdown": {"skillsMatch": 80, "experienceMatch": 85, "educationMatch": 90, "overallFit": 84},
  "reasoning": "分析理由",
  "highlights": ["亮点"],
  "concerns": ["顾虑"]
}`;
}
