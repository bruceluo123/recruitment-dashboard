import type { JD } from '@/types/jd';

/**
 * 本地预筛：用关键词重叠为 JD 粗排，避免把全部岗位塞给 AI。
 * 纯字符串匹配，0 网络成本，毫秒级。
 */

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
 */
export function prefilterJDs(resumeText: string, jds: JD[], limit: number): JD[] {
  if (jds.length <= limit) return jds;

  const resumeLower = resumeText.toLowerCase();
  const resumeTerms = extractTerms(resumeText);

  const ranked = jds
    .map((jd) => ({ jd, s: scoreJD(jd, resumeLower, resumeTerms) }))
    .sort((a, b) => b.s - a.s);

  return ranked.slice(0, limit).map((r) => r.jd);
}
