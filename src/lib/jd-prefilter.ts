import type { JD, JDCategory } from '@/types/jd';
import { hasCategory } from '@/types/jd';

/**
 * 本地预筛：用「关键词重叠 + 候选人主职能分类」为 JD 粗排，避免把全部岗位塞给 AI。
 * 纯本地计算，0 网络成本，毫秒级。
 *
 * 关键改进：词面重叠（bag-of-words）会误杀"语义相关但用词不同"的岗位
 * （如候选人写"注册转化留存"、JD 写"直播运营"——同属运营却零重叠）。
 * 因此对「命中候选人主职能分类」的岗位加一个大额加权，保证这些岗位优先进入
 * AI 候选集，由 AI 做语义层面的精排判断，而不是被哑过滤提前删掉。
 */

// 命中候选人主分类的加权：远大于任何词面分，确保同类岗位优先入选 AI 候选集
const CATEGORY_BOOST = 10000;

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
  const boostSet = new Set(boostCategories);
  const inBoost = (jd: JD) => boostSet.size > 0 && boostCategories.some((c) => hasCategory(jd, c));

  const ranked = jds
    .map((jd) => ({
      jd,
      s: scoreJD(jd, resumeLower, resumeTerms) + (inBoost(jd) ? CATEGORY_BOOST : 0),
    }))
    .sort((a, b) => b.s - a.s);

  return ranked.slice(0, limit).map((r) => r.jd);
}
