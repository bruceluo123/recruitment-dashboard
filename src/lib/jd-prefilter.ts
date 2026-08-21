import type { JD, JDCategory } from '@/types/jd';
import { hasCategory } from '@/types/jd';
import { detectCategories } from './jd-parse-core';

/**
 * 本地预筛：用「关键词重叠 + 候选人主职能分类」为 JD 粗排，避免把全部岗位塞给 AI。
 * 纯本地计算，0 网络成本，毫秒级。
 *
 * 关键改进：词面重叠（bag-of-words）会误杀"语义相关但用词不同"的岗位
 * （如候选人写"注册转化留存"、JD 写"直播运营"——同属运营却零重叠）。
 * 因此对「命中候选人主职能分类」的岗位加一个大额加权，保证这些岗位优先进入
 * AI 候选集，由 AI 做语义层面的精排判断，而不是被哑过滤提前删掉。
 */

// 主职方向必须优先于相邻方向；辅助经历只用于补充候选，不能与主职同权。
const CATEGORY_BOOSTS = [12000, 9000, 3000];

const RESUME_ROLE_SIGNALS: Array<[JDCategory, RegExp, number]> = [
  ['seo', /seo(?:运营|优化|专员|经理)?|搜索引擎优化/gi, 14],
  ['advertising', /(?:广告|信息流|媒介|kol|koc)(?:投放|优化|增长)|投手|sem/gi, 16],
  ['gaming', /游戏(?:运营|策划|开发|制作)|unity|unreal|cocos/gi, 14],
  ['ai', /ai(?:产品|运营|内容|工程师|研发|应用)|人工智能|大模型|llm|aigc/gi, 12],
  ['algorithm', /算法(?:工程师|研发)|机器学习|深度学习|计算机视觉|nlp/gi, 14],
  ['frontend', /前端(?:开发|工程师|负责人)|react|vue|flutter|android|ios/gi, 14],
  ['backend', /后端(?:开发|工程师|负责人)|golang|java(?:开发|工程师)|php(?:开发|工程师)|服务端/gi, 14],
  ['devops', /运维(?:开发|工程师|负责人)|devops|sre|kubernetes|k8s/gi, 14],
  ['testing', /测试(?:开发|工程师|负责人)|质量保证|qa工程师/gi, 14],
  ['training', /培训(?:师|经理|负责人)|课程开发|教学设计|学习发展/gi, 14],
  ['product', /产品(?:经理|运营|负责人|总监|助理)/gi, 14],
  ['design', /(?:ui|ux|视觉|平面|交互|品牌)设计(?:师|负责人)?/gi, 14],
  ['art', /美术(?:设计|负责人|总监)|原画师|插画师|3d(?:角色|动画|建模)/gi, 14],
  ['marketing', /市场(?:运营|营销|推广|经理|总监)|品牌(?:运营|营销|推广)|公关(?:经理|运营)/gi, 14],
  ['video', /视频(?:运营|剪辑|制作|编导)|短视频(?:运营|制作)|剪辑师|编导/gi, 14],
  ['live', /直播(?:运营|策划|负责人)|主播|场控|中控/gi, 14],
  ['legal', /法务|律师|法律顾问|合规(?:专员|经理)|知识产权/gi, 14],
  ['finance', /财务|会计|出纳|审计|税务/gi, 14],
  ['data', /数据(?:分析师|运营|工程师|增长|产品)|商业分析|bi分析/gi, 14],
  ['hardware', /硬件(?:工程师|开发)|嵌入式|芯片|固件|gpu|cuda/gi, 14],
  ['hr', /招聘(?:专员|经理|负责人)|人力资源|hrbp|薪酬绩效|员工关系/gi, 14],
  ['bd', /商务(?:拓展|经理|负责人)|渠道(?:拓展|经理)|\bbd\b|销售(?:经理|负责人)/gi, 14],
  ['customer-service', /客服(?:专员|经理|负责人)|客户服务|售后服务/gi, 14],
  ['content', /内容(?:策略|生产|创作|编辑|策划|运营)|品牌pr|官网文案|白皮书|文案(?:策划|编辑)/gi, 10],
  ['operations', /内容运营|社媒运营|新媒体运营|社区运营|社群运营|用户运营|活动运营|上币运营|增长运营|电商运营|直播运营/gi, 18],
  ['project', /项目(?:经理|管理|负责人)|pmo|scrum master/gi, 14],
  ['director', /总监|负责人|组长|vp|cto|ceo/gi, 10],
  ['administration', /行政(?:专员|经理|负责人)|督导专员|办公室主任|秘书|前台/gi, 14],
];

const RESUME_SUPPORT_SIGNALS: Array<[JDCategory, RegExp, number]> = [
  ['marketing', /kol(?:\/koc)?合作|品牌pr|公关稿|品牌文案/gi, 2],
  ['data', /数据复盘|数据监测|数据看板|阅读量|互动率|转化率/gi, 2],
  ['ai', /ai增效|ai工具|使用ai|借助ai/gi, 1],
  ['project', /项目支持|项目协作|跨部门协作/gi, 1],
];

function matchCount(text: string, re: RegExp, cap = 5): number {
  re.lastIndex = 0;
  return Math.min(cap, text.match(re)?.length || 0);
}

function extractSection(text: string, start: RegExp, end: RegExp, maxChars: number): string {
  start.lastIndex = 0;
  const startMatch = start.exec(text);
  if (!startMatch) return '';
  const sectionStart = startMatch.index + startMatch[0].length;
  const rest = text.slice(sectionStart);
  end.lastIndex = 0;
  const endMatch = end.exec(rest);
  return rest.slice(0, endMatch?.index ?? maxChars).slice(0, maxChars);
}

/**
 * 从简历中识别有优先级的主职方向。
 * 最近工作经历、明确岗位名、实际职责和自我评价权重最高；求职意向不参与判断。
 * 协作、复盘、工具使用等只算辅助证据。
 */
export function detectResumeCategories(resumeText: string): JDCategory[] {
  const scores = new Map<JDCategory, number>();
  const add = (category: JDCategory, score: number) => {
    scores.set(category, (scores.get(category) || 0) + score);
  };

  // 求职意向经常是临时填写的投递目标，不作为能力或职业方向证据。
  const factualResumeText = resumeText.replace(
    /^\s*(?:求职意向|应聘岗位|目标岗位|期望岗位)[：:].*$/gim,
    '',
  );
  const recentWork = extractSection(
    factualResumeText,
    /(?:工作经历|工作经验|职业经历|任职经历)\s*[：:]?/gi,
    /\n\s*(?:项目经历|项目经验|教育经历|教育背景|自我评价|个人评价|个人总结|专业技能|技能清单|证书|获奖)\s*[：:]?/gi,
    5000,
  );
  const selfEvaluation = extractSection(
    factualResumeText,
    /(?:自我评价|个人评价|个人总结|职业概述|个人简介)\s*[：:]?/gi,
    /\n\s*(?:工作经历|工作经验|项目经历|项目经验|教育经历|教育背景|专业技能|技能清单|证书|获奖)\s*[：:]?/gi,
    2000,
  );
  const primaryEvidence = `${recentWork || factualResumeText.slice(0, 5000)}\n${selfEvaluation}`;
  const roleTitleLines = primaryEvidence
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line.length <= 50)
    .join('\n');

  for (const [category, re, points] of RESUME_ROLE_SIGNALS) {
    const fullCount = matchCount(factualResumeText, re);
    const primaryCount = matchCount(primaryEvidence, re, 4);
    const titleCount = matchCount(roleTitleLines, re, 3);
    if (fullCount) add(category, fullCount * points);
    if (primaryCount) add(category, primaryCount * Math.max(4, Math.round(points * 0.5)));
    if (titleCount) add(category, titleCount * Math.max(6, Math.round(points * 0.75)));
  }
  for (const [category, re, points] of RESUME_SUPPORT_SIGNALS) {
    const count = matchCount(factualResumeText, re, 3);
    if (count) add(category, count * points);
  }

  // 宽口径分类只作为很弱的兜底，避免一次“AI增效”“数据复盘”抢走主方向。
  detectCategories(factualResumeText).forEach((category, index) => add(category, 3 - index));

  return Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([category]) => category);
}

const STOP_TERMS = new Set([
  '负责', '要求', '岗位', '工作', '相关', '能力', '经验', '优先', '熟悉', '了解',
  '具备', '良好', '以上', '以及', '能够', '团队', '公司', '业务', '项目', '完成',
  '及时', '其他', '一定', '具有', '我们', '你的', '可以', '使用', '进行', '通过',
]);

const EN_TOKEN = /[a-zA-Z][a-zA-Z0-9+.#]{1,}/g;
const SPLIT = /[\s,，;；、。()（）/|:：\-—·•\n\t]+/;

/** 从一段文本抽取信号词：英文 token + 中文 2-gram */
function extractTerms(text: string): Set<string> {
  const terms = new Set<string>();
  const lower = text.toLowerCase();

  const enMatches = lower.match(EN_TOKEN);
  if (enMatches) for (const t of enMatches) if (t.length >= 2) terms.add(t);

  for (const seg of text.split(SPLIT)) {
    const zh = seg.replace(/[^\u4e00-\u9fa5]/g, '');
    for (let i = 0; i + 2 <= zh.length; i++) {
      const gram = zh.slice(i, i + 2);
      if (!STOP_TERMS.has(gram)) terms.add(gram);
    }
  }
  return terms;
}

/** 给单个 JD 计算与简历的重叠分（重要字段加权） */
function scoreJD(jd: JD, resumeLower: string, resumeTerms: Set<string>): number {
  const titleTerms = extractTerms(jd.title);
  const reqTerms = extractTerms(jd.requirements.join(' '));
  const respTerms = extractTerms(jd.responsibilities.join(' '));

  let score = 0;
  const hit = (t: string) => resumeTerms.has(t) || resumeLower.includes(t);
  titleTerms.forEach((t) => { if (hit(t)) score += 3; });
  reqTerms.forEach((t) => { if (hit(t)) score += 2; });
  respTerms.forEach((t) => { if (hit(t)) score += 1; });
  return score;
}

/**
 * 预筛 JD：返回与简历最相关的前 limit 个。
 * 若总数不超过 limit，直接原样返回（无需筛）。
 *
 * @param boostCategories 候选人主职能分类。命中其中任一分类的岗位获得大额加权，
 *   优先纳入 AI 候选集（解决跨用词的同类岗位被词面预筛误杀的问题）。
 */
export function prefilterJDs(
  resumeText: string,
  jds: JD[],
  limit: number,
  boostCategories: JDCategory[] = [],
): JD[] {
  if (jds.length <= limit) return jds;

  const resumeLower = resumeText.toLowerCase();
  const resumeTerms = extractTerms(resumeText);
  const categoryBoost = (jd: JD) => boostCategories.reduce((best, category, index) => (
    hasCategory(jd, category) ? Math.max(best, CATEGORY_BOOSTS[index] || 0) : best
  ), 0);

  const ranked = jds
    .map((jd) => ({
      jd,
      s: scoreJD(jd, resumeLower, resumeTerms) + categoryBoost(jd),
    }))
    .sort((a, b) => b.s - a.s);

  const seen = new Set<string>();
  return ranked
    .filter(({ jd }) => {
      const key = jd.reqKey?.trim() || [jd.title, jd.organization, jd.department, jd.serviceUnit].join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit)
    .map((r) => r.jd);
}
