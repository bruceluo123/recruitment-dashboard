import type { JD } from '@/types/jd';

/** 裁剪过长字段，控制 prompt 体积以提速 */
function clip(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '…' : text;
}

/** 评分维度与原则，批量/流式/单条共用，避免口径漂移 */
const SCORING_RUBRIC = `## 分析方法（先识别主职，再挖掘JD核心，最后打分）
对每个岗位，先在心里完成四步，再输出分数：
1. 识别候选人主职：优先看求职意向、最近两段岗位名称，以及多次重复出现的核心职责。协作事项、偶发项目和工具使用只能算辅助经历，不能替代主职。
2. 挖掘JD核心：剥离套话，先判断岗位本质是内容运营、KOL投放、社群增长、产品运营等哪一种，再提炼真正的硬性要求和加分项。岗位名称里的行业垂类通常是第二层要求，不能盖过核心职能。
3. 比对证据：在简历里找对应硬性要求的事实证据。注意语义等价——简历用词可能与JD不同（如"注册转化留存"≈"用户运营增长"、"0-1搭建"≈"从无到有"），不要因为字面不同就判为不匹配。
4. 打分：核心职能是否匹配决定主要分数；加分项决定上浮。方向跨界但核心能力可迁移的，按可迁移程度给分，不要一刀切归零。

## 评分维度（0-100）
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
6. concerns 写真实短板或风险，没有就给空数组。
7. “参与KOL合作/对接”不等于“KOL投放”：若岗位核心要求投放策略、预算、ROI或投放优化，而简历只有合作支持，overallFit 不应达到70。
8. “使用AI工具/AI增效”不等于AI主职经验；但候选人核心是内容运营时，匹配AI内容运营应先认可内容策略、生产、发布、复盘闭环，再对AI或垂类经验做适度扣分。
9. 垂类不同（如游戏、成人、BL、Web3）一般体现在 domainMatch；只要核心职能高度一致，不应把综合分直接压到低匹配。
10. score 应与 breakdown.overallFit 基本一致（相差不超过3分），禁止因岗位急招、缺口或优先级抬高匹配分。`;

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

reasoning 控制在25字内。必须返回全部${jds.length}个岗位，每个 jdIndex 只出现一次；按 score 降序排列。返回严格JSON（不要markdown代码块）：
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

reasoning 控制在25字内。必须输出全部${jds.length}个岗位，每个 jdIndex 只出现一次；优先输出明显匹配的岗位，前端会按 score 自动排序。
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

${SCORING_RUBRIC}

返回严格JSON（不要markdown代码块）：
{
  "score": 85,
  "breakdown": {"skillsMatch": 80, "experienceMatch": 85, "domainMatch": 88, "seniorityMatch": 78, "overallFit": 84},
  "reasoning": "分析理由（25字内）",
  "highlights": ["简历证据→对应要求"],
  "concerns": ["真实短板"]
}`;
}
