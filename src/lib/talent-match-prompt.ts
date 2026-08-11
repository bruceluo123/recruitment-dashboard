import type { MatchJDInput } from '@/types/talent-match';

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

export interface CandidateBrief {
  index: number;
  name: string;
  jobTitle: string;
  resumeText: string;
  company?: string;
  prevCompanies?: string[];
  techDirection?: string;
  level?: string;
  eduLevel?: string;
  school?: string;
  major?: string;
  location?: string;
  workIntent?: string;
  monthlySalary?: string;
}

const JSON_SHAPE = `{
  "results": [
    {
      "candIndex": 1,
      "score": 88,
      "breakdown": {"skillsMatch": 90, "experienceMatch": 80, "domainMatch": 85, "seniorityMatch": 75, "overallFit": 88},
      "reasoning": "AI 和 Go 两个核心要素均命中",
      "highlights": ["简历证据：Go 后端经验，对应 Go 要素", "简历证据：AI Agent/大模型落地，对应 AI 要素"],
      "concerns": ["未看到完整 AI 架构 owner 经历"]
    }
  ]
}`;

function buildNeedBlock(jd: MatchJDInput): string {
  if (jd.mode === 'query') {
    return `## 查询需求
- 搜索意图：${jd.searchIntent || jd.title}
- 核心要素：${(jd.coreTerms || []).join('、') || jd.title}
- 判断原则：这是找人查询，不是完整 JD 匹配。优先判断候选人是否命中核心要素；薪资、部门、行业、地点等未提到的信息不要扣分。`;
  }

  return `## 岗位
- 职位：${jd.title}
- 部门：${jd.department || '不限'}
- 地点：${jd.location || '不限'}
- 薪资：${jd.salaryText || '面议'}
- 职责：${clip(jd.responsibilities.join('；'), 400)}
- 要求：${clip(jd.requirements.join('；'), 500)}
- 判断原则：先看岗位最核心的技能和方向，避免被细碎职责、软性要求、薪资等次要信息过度干扰。`;
}

function buildCandidateList(cands: CandidateBrief[]): string {
  return cands.map((c) => {
    const lines: string[] = [
      `### 候选人-${c.index}`,
      `- 姓名：${c.name || '未知'}`,
      `- 当前岗位：${c.jobTitle || '未知'}`,
    ];
    if (c.company) lines.push(`- 当前公司：${c.company}`);
    if (c.prevCompanies?.length) lines.push(`- 历史公司：${c.prevCompanies.join('、')}`);
    if (c.techDirection) lines.push(`- 技术方向：${c.techDirection}`);
    if (c.level) lines.push(`- 职级：${c.level}`);
    const edu = [c.eduLevel, c.school, c.major].filter(Boolean).join(' · ');
    if (edu) lines.push(`- 学历：${edu}`);
    if (c.location) lines.push(`- 所在地：${c.location}`);
    if (c.workIntent) lines.push(`- 求职意向：${c.workIntent}`);
    if (c.monthlySalary) lines.push(`- 薪资期望：${c.monthlySalary}`);
    lines.push(c.resumeText ? `- 简历摘要：${clip(c.resumeText, 1100)}` : '- 简历：无简历正文，仅可参考结构化字段');
    return lines.join('\n');
  }).join('\n\n');
}

export function buildTalentMatchPrompt(jd: MatchJDInput, cands: CandidateBrief[]): string {
  const queryMode = jd.mode === 'query';
  return `你是资深猎头顾问。请评估以下 ${cands.length} 位候选人。

${buildNeedBlock(jd)}

## 候选人列表
${buildCandidateList(cands)}

## 评分规则
- 0-100 分，按推荐优先级排序。
- skillsMatch：核心技能/工具命中度。
- experienceMatch：相关项目、落地经验、owner 深度。
- domainMatch：方向相关度。
- seniorityMatch：职级、年限、薪资合理度。
- overallFit：综合可推荐程度。
${queryMode ? '- 查询模式下，如果候选人同时命中核心要素，可以高分；不要因为没有覆盖完整 JD 的其它内容而重扣。' : '- JD 模式下，核心技能和业务方向优先，次要 JD 条件只作为微调。'}
- highlights 必须写“简历证据 -> 对应要素”，不要泛泛而谈。
- concerns 只写真风险；没有就给空数组。
- 无简历正文的候选人分数要保守，并在 concerns 说明。

reasoning 控制在 35 字以内。只返回严格 JSON，不要 markdown 代码块：
${JSON_SHAPE}`;
}
