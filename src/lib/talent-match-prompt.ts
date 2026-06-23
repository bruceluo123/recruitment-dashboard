import type { MatchJDInput } from '@/types/talent-match';

/** 裁剪过长字段，控制 prompt 体积以提速 */
function clip(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '…' : text;
}

/** 候选人精简档案：喂给 AI 的单条候选人 */
export interface CandidateBrief {
  index: number;       // 1-based，对应返回的 candIndex
  name: string;
  jobTitle: string;
  resumeText: string;  // 已扫描的简历正文（可能为空）
  // 结构化字段（无简历正文时作为主要匹配依据）
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

const SCORING_RUBRIC = `## 评分维度（0-100）
- skillsMatch 技能/工具匹配：候选人掌握的技能、工具是否覆盖岗位要求
- experienceMatch 经验/项目匹配：相关年限、项目深度、0-1经历是否匹配
- domainMatch 行业/方向匹配：所在赛道与岗位方向是否一致
- seniorityMatch 职级/薪资匹配：候选人级别与岗位定级、薪资是否合理（过高/过低都扣分）
- overallFit 综合：以上的整体判断，不是简单平均

## 评分原则（重要）
1. 优先看 技能、经验、方向 三项，这三项才是核心竞争力。
2. 学历对多数岗位非硬性门槛，仅当岗位明确要求时才影响分数。
3. 方向不对口要明确扣 domainMatch（如开发岗配运营简历）。
4. 职级错配要在 seniorityMatch 体现并在 concerns 里说明。
5. highlights 用"简历证据→对应要求"的形式，具体到简历事实。
6. concerns 写真实短板或风险，没有就给空数组。
7. 简历正文为空的候选人，仅凭岗位名称粗判，分数应保守并在 concerns 注明"无简历正文"。`;

function buildJDBlock(jd: MatchJDInput): string {
  return `- 职位：${jd.title}
- 部门：${jd.department || '不限'}
- 地点：${jd.location || '不限'}
- 薪资：${jd.salaryText || '面议'}
- 职责：${clip(jd.responsibilities.join('；'), 400)}
- 要求：${clip(jd.requirements.join('；'), 500)}`;
}

function buildCandidateList(cands: CandidateBrief[]): string {
  return cands.map((c) => {
    const lines: string[] = [
      `### 候选人-${c.index}`,
      `- 姓名：${c.name || '未知'}`,
      `- 当前岗位：${c.jobTitle || '未知'}`,
    ];
    // 有结构化字段时展示，无论是否有简历正文
    if (c.company) lines.push(`- 当前公司：${c.company}`);
    if (c.prevCompanies?.length) lines.push(`- 历史公司：${c.prevCompanies.join('、')}`);
    if (c.techDirection) lines.push(`- 技术方向：${c.techDirection}`);
    if (c.level) lines.push(`- 职级：${c.level}`);
    const edu = [c.eduLevel, c.school, c.major].filter(Boolean).join(' · ');
    if (edu) lines.push(`- 学历：${edu}`);
    if (c.location) lines.push(`- 所在地：${c.location}`);
    if (c.workIntent) lines.push(`- 求职意向：${c.workIntent}`);
    if (c.monthlySalary) lines.push(`- 薪资期望：${c.monthlySalary}`);

    if (c.resumeText) {
      lines.push(`- 简历摘要：${clip(c.resumeText, 1000)}`);
    } else {
      lines.push('- 简历：（无简历正文，以上结构化信息为匹配依据）');
    }
    return lines.join('\n');
  }).join('\n\n');
}

/** 一个 JD vs N 个候选人，输出每个候选人的匹配评分 */
export function buildTalentMatchPrompt(jd: MatchJDInput, cands: CandidateBrief[]): string {
  return `你是资深猎头顾问。请评估以下${cands.length}位候选人与该岗位的匹配度。

## 岗位
${buildJDBlock(jd)}

## 候选人列表
${buildCandidateList(cands)}

${SCORING_RUBRIC}

reasoning 控制在25字内。按 score 降序排列。返回严格JSON（不要markdown代码块）：
{
  "results": [
    {
      "candIndex": 1,
      "score": 88,
      "breakdown": {"skillsMatch": 85, "experienceMatch": 90, "domainMatch": 92, "seniorityMatch": 80, "overallFit": 88},
      "reasoning": "AI产品方向高度对口，0-1经验扎实",
      "highlights": ["有Agent架构设计经验，对应Multi-Agent要求"],
      "concerns": ["薪资期望略高于岗位区间"]
    }
  ]
}`;
}
