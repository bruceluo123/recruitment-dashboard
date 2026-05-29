import type { JD } from '@/types/jd';

/** 裁剪过长字段，控制 prompt 体积以提速 */
function clip(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '…' : text;
}

/** 评分维度与原则，批量/流式/单条共用，避免口径漂移 */
const SCORING_RUBRIC = `## 评分维度（0-100）
- skillsMatch 技能/工具匹配：候选人掌握的技能、工具是否覆盖岗位要求
- experienceMatch 经验/项目匹配：相关年限、项目深度、0-1经历是否匹配
- domainMatch 行业/方向匹配：所在赛道与岗位方向是否一致（如AI产品、Web3、运营等）
- seniorityMatch 职级/薪资匹配：候选人级别与岗位定级、薪资区间是否合理（过高/过低都扣分）
- overallFit 综合：以上的整体判断，不是简单平均

## 评分原则（重要）
1. 优先看 技能、经验、方向 三项，这三项才是核心竞争力。
2. 学历对多数岗位非硬性门槛，仅当岗位明确要求时才影响分数，不要因学历普通而大幅压低。
3. 方向不对口要明确扣 domainMatch（如开发岗配运营简历）。
4. 职级错配要在 seniorityMatch 体现并在 concerns 里说明（如"level偏低/薪资期望不符"）。
5. highlights 用"证据→对应要求"的形式，具体到简历事实（如"社区0到280K粉丝，对口流量增长要求"）。
6. concerns 写真实短板或风险，没有就给空数组。`;

function buildJDList(jds: JD[]): string {
  return jds.map((jd, i) => {
    return `### JD-${i + 1}
- 职位：${jd.title}
- 部门：${jd.department}
- 地点：${jd.location || '不限'}
- 薪资：${jd.salaryRange.min}K-${jd.salaryRange.max}K
- 职责：${clip(jd.responsibilities.join('；'), 200)}
- 要求：${clip(jd.requirements.join('；'), 250)}`;
  }).join('\n\n');
}

export function buildBatchMatchingPrompt(resumeText: string, jds: JD[]): string {
  return `你是资深猎头顾问。请评估以下简历与${jds.length}个岗位的匹配度。

## 简历
${resumeText}

## 岗位列表
${buildJDList(jds)}

${SCORING_RUBRIC}

reasoning 控制在25字内。按 score 降序排列。返回严格JSON（不要markdown代码块）：
{
  "results": [
    {
      "jdIndex": 1,
      "score": 88,
      "breakdown": {"skillsMatch": 85, "experienceMatch": 90, "domainMatch": 92, "seniorityMatch": 80, "overallFit": 88},
      "reasoning": "AI产品方向高度对口，0-1经验扎实",
      "highlights": ["有Agent架构设计经验，对应Multi-Agent要求"],
      "concerns": ["薪资期望略高于岗位区间"]
    }
  ]
}`;
}

/** 流式匹配：要求模型逐行输出（JSONL），便于边生成边解析、结果逐条蹦出 */
export function buildStreamMatchingPrompt(resumeText: string, jds: JD[]): string {
  return `你是资深猎头顾问。请评估以下简历与${jds.length}个岗位的匹配度。

## 简历
${resumeText}

## 岗位列表
${buildJDList(jds)}

${SCORING_RUBRIC}

reasoning 控制在25字内。**按 score 从高到低**逐个岗位输出。
输出格式：每行一个独立的 JSON 对象（JSONL），不要数组、不要markdown代码块、不要任何额外说明文字。每行示例：
{"jdIndex":1,"score":88,"breakdown":{"skillsMatch":85,"experienceMatch":90,"domainMatch":92,"seniorityMatch":80,"overallFit":88},"reasoning":"AI产品方向高度对口","highlights":["有Agent架构经验，对应Multi-Agent要求"],"concerns":["薪资期望略高"]}`;
}

export function buildMatchingPrompt(resumeText: string, jd: JD): string {
  return `你是资深猎头顾问。分析以下简历与岗位的匹配度。

## 岗位：${jd.title} | ${jd.department} | ${jd.location || '不限'}
薪资：${jd.salaryRange.min}K-${jd.salaryRange.max}K
职责：${clip(jd.responsibilities.join('；'), 300)}
要求：${clip(jd.requirements.join('；'), 350)}

## 简历
${resumeText}

## 评分维度（0-100）
- skillsMatch 技能/工具匹配
- experienceMatch 经验/项目匹配
- domainMatch 行业/方向匹配
- seniorityMatch 职级/薪资匹配
- overallFit 综合（非简单平均）

原则：优先看技能/经验/方向；学历非硬门槛（除非岗位明确要求）；方向不对口扣domainMatch；职级错配扣seniorityMatch并在concerns说明。highlights用"简历证据→对应要求"形式。

返回严格JSON（不要markdown代码块）：
{
  "score": 85,
  "breakdown": {"skillsMatch": 80, "experienceMatch": 85, "domainMatch": 88, "seniorityMatch": 78, "overallFit": 84},
  "reasoning": "分析理由（25字内）",
  "highlights": ["简历证据→对应要求"],
  "concerns": ["真实短板"]
}`;
}
