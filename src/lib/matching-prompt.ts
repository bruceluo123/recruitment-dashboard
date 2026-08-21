import type { JD } from '@/types/jd';

/** 裁剪过长字段，控制 prompt 体积以提速 */
function clip(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '…' : text;
}

/** 评分维度与原则，来自编码推荐与面试记录审计，批量/流式/单条共用。 */
const SCORING_RUBRIC = `## 判断顺序（必须执行）
1. 先确定候选人的主岗位身份：最近两份正式工作的岗位名称、持续时间、主要职责占比和真实产出最重要；更早经历次之。求职意向、应聘岗位、目标岗位不属于能力证据，不加分。
2. 再确定JD的核心职能闭环，不要只看标题。区分内容/社媒/社群/产品/用户/活动运营、广告投放、产品经理、项目经理、开发、测试等不同职能。
3. 只用简历里的事实比对：本人做了什么、承担什么责任、用了什么能力、产出什么结果。协助、参与、对接、工具清单、业务场景词只能算辅助证据。
4. 最后判断层级和行业。行业相同只能增加 domainMatch，不能覆盖主职能不匹配；高级、负责人、架构师必须有决策范围、复杂度、带人或结果责任。

## 五维评分（总分100）
- 主岗位身份与核心技能 35分：最近岗位、职责占比、持续时间、跨工作一致性，对应 skillsMatch。
- 核心职责闭环 30分：是否实际完成JD最关键的工作链路，对应 experienceMatch。
- 硬技能与真实产出 20分：工具是否由本人用于真实交付，是否有项目/数据/上线结果，同样计入 skillsMatch 与 experienceMatch。
- 层级匹配 10分：Owner、架构、带人、决策和复杂度，对应 seniorityMatch。
- 行业/业务场景 5分：只对应 domainMatch，不能决定主职。
overallFit 按上述权重综合，不是四个 breakdown 的简单平均；score 与 overallFit 相差不得超过3分。

## 业务词与岗位身份必须分离
- 后端做过直播、内容创作团队、广告系统、KOL结算，仍是后端，不因此成为直播/内容/广告/KOL运营。
- 测试过APP、钱包、产品功能，仍是测试，不因此成为产品、运营或前端。
- 运营参加Hackathon、参与产品策略或使用技术工具，不因此成为开发工程师。
- 参与KOL合作不等于广告投放；投放必须有账户、预算、素材、出价、归因、成本或ROI证据。
- 使用ChatGPT/Claude/Cursor/Manus不等于AI岗位经验；AI工程需有模型/RAG/Agent接入、服务化、评估、部署或生产落地。
- 使用剪映/PS/AI生图不等于高级剪辑或视觉设计；使用Selenium/Playwright不等于搭建自动化测试体系。

## 岗位闭环校验
- 内容运营：策略/选题→生产→发布分发→数据复盘→迭代。
- 社媒/社群运营：平台或社区→内容与活动→增长互动→留存/转化结果。
- 广告投放：账户素材→预算出价→监控归因→成本/ROI优化。
- 产品运营：用户/产品问题→运营机制→功能协作→数据验证。
- 后端开发：业务建模→编码实现→数据/中间件→部署治理→稳定性结果。
- 自动化测试：框架/脚本→覆盖→CI执行→报告回归→质量结果。
- AI工程：模型/RAG/Agent→工程接入→评估监控→生产部署。
- 产品经理：需求发现→方案与优先级→研发协同→上线→指标验证。

## 分数封顶（scoreCap必须从 50/55/59/69/100 中选择）
- 50：只有求职意向、技能清单或自我评价命中。
- 55：只有一处孤立关键词，或只有工具使用，没有职责和项目支撑。
- 59：主岗位职能不同，只是行业、业务场景或协作事项相同。
- 69：同职能但缺少核心闭环；只有参与/协助而岗位要求独立负责；跨技术栈但无目标栈生产经验；层级明显不足。
- 100：没有触发以上封顶。
最终 score 不得高于 scoreCap。岗位急招、缺口、P0/P1、集团优先只影响展示排序，绝不能提高原始匹配分或突破封顶。

## 输出证据
- highlights 必须给2至4条“简历事实→JD要求”，具体到职责、项目或结果；找不到两条事实时 scoreCap 不得为100。
- concerns 写缺失的核心闭环、主职冲突、层级、薪资或真实性风险；触发封顶时 capReason 必须说明唯一最主要原因。
- 学历仅在JD明确硬性要求时影响分数。垂类不同但核心职能一致时，只适度扣 domainMatch。`;

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
      "scoreCap": 100,
      "capReason": "",
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
{"jdIndex":1,"score":88,"scoreCap":100,"capReason":"","breakdown":{"skillsMatch":85,"experienceMatch":90,"domainMatch":92,"seniorityMatch":80,"overallFit":88},"reasoning":"AI产品方向高度对口","highlights":["有Agent架构经验，对应Multi-Agent要求","主导生产部署，对应落地要求"],"concerns":["薪资期望略高"]}`;
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
  "scoreCap": 100,
  "capReason": "",
  "breakdown": {"skillsMatch": 80, "experienceMatch": 85, "domainMatch": 88, "seniorityMatch": 78, "overallFit": 84},
  "reasoning": "分析理由（25字内）",
  "highlights": ["简历证据→对应要求"],
  "concerns": ["真实短板"]
}`;
}
