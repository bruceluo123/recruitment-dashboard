import { JD_CATEGORY_LABELS, type JD, type JDCategory } from '@/types/jd';
import { compareTagProfiles, extractCandidateTagProfile, extractJDTagProfile, visibleProfileTags } from '@/lib/tag-system';
import { detectResumeCategories } from '@/lib/jd-prefilter';
import { evaluateOrganizationMatchPolicy, organizationMatchPolicyPrompt } from '@/lib/matching-policy';

export const MAX_SAME_JOB_MATCH_CANDIDATES = 24;

export interface CoreTagRule {
  id: string;
  label: string;
  tagIds: string[];
  defaultSelected: boolean;
  kind?: 'attribute' | 'core';
  categories?: JDCategory[];
}

/** Suggested core tags are editable; alternatives in one rule count as one condition. */
export function sameJobCoreRules(jd: JD): CoreTagRule[] {
  const profile = extractJDTagProfile(jd);
  const groups = profile.requiredAnyGroups || [];
  const grouped = new Set(groups.flatMap((group) => group.tagIds));
  const tags = profile.tags.filter((tag) => !grouped.has(tag.id));
  const targetLevel = sameJobTargetLevel(jd);
  const priority = (tag: typeof tags[number]) => {
    const isTargetLevel = (tag.id === 'level:manager' && targetLevel === 'manager')
      || (tag.id === 'level:architect' && targetLevel === 'architect');
    const dimensionScore = tag.dimension === 'level'
      ? (isTargetLevel ? 130 : -100)
      : ['stack', 'specialty', 'operations', 'product', 'design', 'business', 'data-ai', 'hardware', 'creative'].includes(tag.dimension) ? 70 : 50;
    return dimensionScore
      + (tag.evidence.some((item) => item.source === 'title') ? 120 : 0)
      + (tag.evidence.some((item) => item.source === 'requirements') ? 40 : 0)
      + (tag.required ? 15 : 0) + tag.score;
  };
  tags.sort((a, b) => priority(b) - priority(a));
  const targetCategories = jd.categories.slice(0, 1);
  const attributeRule: CoreTagRule | null = targetCategories.length ? {
    id: `attribute:${targetCategories.join('|')}`,
    label: `岗位属性：${targetCategories.map((category) => JD_CATEGORY_LABELS[category]).join(' / ')}`,
    tagIds: [], defaultSelected: true, kind: 'attribute', categories: targetCategories,
  } : null;
  const rules: CoreTagRule[] = [
    ...groups.map((group) => ({ id: group.id, label: group.labels.join(' 或 '), tagIds: group.tagIds, defaultSelected: true })),
    ...tags.map((tag) => ({ id: tag.id, label: tag.label, tagIds: [tag.id], defaultSelected: false })),
  ];
  const tagById = new Map(profile.tags.map((tag) => [tag.id, tag]));
  const rulePriority = (rule: CoreTagRule) => Math.max(...rule.tagIds.map((id) => priority(tagById.get(id)!)));
  rules.sort((a, b) => rulePriority(b) - rulePriority(a));
  // Select a few differentiators, not every keyword mentioned in a long JD.
  const coreTagIds = new Set(tags.filter((tag) => tag.required || tag.evidence.some((item) =>
    item.source === 'responsibilities' && !/优先|加分|了解|非必须|可选|preferred|nice.to.have/i.test(item.snippet))).map((tag) => tag.id));
  const eligible = rules.filter((rule) => (rule.defaultSelected || rule.tagIds.some((id) => coreTagIds.has(id))) && rulePriority(rule) > 0);
  const defaults = eligible.slice(0, 3);
  const selected = new Set(defaults.map((rule) => rule.id));
  const coreRules = rules.map((rule) => ({ ...rule, kind: 'core' as const, defaultSelected: selected.has(rule.id) }));
  return attributeRule ? [attributeRule, ...coreRules] : coreRules;
}

export interface CoreTagHit {
  ruleId: string;
  label: string;
  confirmed: boolean;
  evidence: string;
}

export interface CorePrescreenResult {
  candidateKey: string;
  hits: CoreTagHit[];
  categories: JDCategory[];
  policyScoreAdjustment: number;
  policyEligible: boolean;
  policyNotes: string[];
}

/** Scan the whole pool locally, yielding regularly so switching tags stays responsive. */
export async function prescreenSameJobCandidates(
  rules: CoreTagRule[], candidates: SameJobCandidateInput[], signal: AbortSignal, jd?: JD,
): Promise<CorePrescreenResult[]> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  const results: CorePrescreenResult[] = [];
  let chunkStarted = performance.now();
  for (const candidate of candidates) {
    signal.throwIfAborted();
    const profile = extractCandidateTagProfile(candidate);
    const byId = new Map(profile.tags.map((tag) => [tag.id, tag]));
    const categories = candidate.categories?.length
      ? candidate.categories
      : detectResumeCategories([candidate.currentJob, candidate.resumeText].join('\n'));
    const hits: CoreTagHit[] = [];
    for (const rule of rules) {
      if (rule.kind === 'attribute') {
        const matched = (rule.categories || []).filter((category) => categories.includes(category));
        if (matched.length) hits.push({
          ruleId: rule.id, label: rule.label, confirmed: Boolean(candidate.categories?.some((category) => matched.includes(category))),
          evidence: matched.map((category) => JD_CATEGORY_LABELS[category]).join(' / '),
        });
        continue;
      }
      const evidence = rule.tagIds.flatMap((id) => byId.get(id)?.evidence || []);
      if (!evidence.length) continue;
      const fact = candidate.resumeSource === 'full_resume' && evidence.find((item) => item.quality === 'fact');
      hits.push({ ruleId: rule.id, label: rule.label, confirmed: Boolean(fact), evidence: (fact || evidence[0]).snippet });
    }
    const policy = jd ? evaluateOrganizationMatchPolicy(jd, candidate.resumeText) : null;
    results.push({
      candidateKey: candidate.key,
      hits,
      categories,
      policyScoreAdjustment: policy?.scoreAdjustment || 0,
      policyEligible: policy?.eligibleForDefaultPrescreen ?? true,
      policyNotes: [...(policy?.matched || []), ...(policy?.concerns || [])],
    });
    if (performance.now() - chunkStarted >= 8) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      chunkStarted = performance.now();
    }
  }
  signal.throwIfAborted();
  return results;
}

export function meetsCoreRules(result: CorePrescreenResult | undefined, selectedIds: string[], mode: 'all' | 'any'): boolean {
  const hitIds = new Set(result?.hits.map((hit) => hit.ruleId) || []);
  const attributeIds = selectedIds.filter((id) => id.startsWith('attribute:'));
  if (!attributeIds.every((id) => hitIds.has(id))) return false;
  const coreIds = selectedIds.filter((id) => !id.startsWith('attribute:'));
  if (!coreIds.length) return true;
  return mode === 'all' ? coreIds.every((id) => hitIds.has(id)) : coreIds.some((id) => hitIds.has(id));
}

export interface SameJobCandidateInput {
  key: string;
  currentJob: string;
  resumeText: string;
  resumeSource?: 'full_resume' | 'recommendation_copy';
  highlights: string;
  uploadedAt: string;
  categories?: JDCategory[];
}

export interface SameJobMatchResult {
  assessmentSource?: 'ai' | 'local';
  candidateKey: string;
  score: number;
  level: 'high' | 'medium' | 'low';
  candidateLevel: 'manager' | 'architect' | 'engineer' | 'specialist' | 'unclear';
  candidateLevels: Array<'manager' | 'architect' | 'engineer' | 'specialist'>;
  reasoning: string;
  matched: string[];
  technicalEvidence: string[];
  matchedTags: string[];
  tentativeTags: string[];
  pendingCoreTags: string[];
  managementEvidence: string[];
  architectureEvidence: string[];
  hardSkillStatus: 'met' | 'unknown' | 'not_met';
  missing: string[];
}

export type SameJobTargetLevel = 'manager' | 'architect' | 'engineer' | 'specialist';

const MATCH_TERMS = [
  'Golang', 'Go', 'Java', 'Python', 'Node.js', 'C++', 'PHP',
  'React', 'Vue', 'Vue3', 'Vite', 'Next.js', 'Nuxt', 'TypeScript', 'JavaScript',
  'SSR', 'SSG', 'SEO', 'TDK', 'Meta', 'sitemap', 'robots.txt', 'Canonical',
  'FCP', 'LCP', 'CLS', 'TTFB', 'Core Web Vitals',
  'Flutter', 'Dart', 'Swift', 'Kotlin', 'Android', 'iOS',
  '后端', '架构', '技术管理', '团队管理', '带人',
  '直播', '短视频', '视频内容', '音视频', '视频', '流媒体', '泛娱乐', '娱乐',
  'HLS', 'WebRTC', 'FFmpeg', 'FLV', 'CDN', 'IM', 'RTC',
  '同构渲染', '页面可索引性', '语义化', '结构化数据', '播放器内核', '播放链路', '弱网', '弹幕', '直播互动',
  '状态管理', '内存泄漏', 'Widget', '代码审计', '质量基线', 'Code Review',
  '高并发', '高可用', '分布式', '微服务', '云原生', '性能优化', '稳定性',
  'Kubernetes', 'K8s', 'Docker', 'MySQL', 'PostgreSQL', 'Redis', 'Kafka', 'Elasticsearch',
  '游戏', '社交', '内容', '电商', '支付', '广告', '推荐', '搜索', '风控', '安全', '代码审计',
];

const GENERIC_TERMS = new Set([
  '岗位', '职位', '工作', '负责', '要求', '经验', '能力', '相关', '优先', '熟悉', '掌握', '以上',
  '开发', '工程师', '经理', '高级', '技术', '业务', '系统', '项目', '团队', '方向',
]);

function normalized(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '');
}

function targetText(jd: JD): string {
  return [
    jd.title,
    ...jd.responsibilities,
    ...jd.requirements,
    ...(jd.preferredQualifications || []),
    jd.notes || '',
  ].join('\n');
}

export function sameJobTargetLevel(jd: JD): SameJobTargetLevel {
  if (/架构师|architect/i.test(jd.title)) return 'architect';
  if (/管理方向/.test(jd.title)) return 'manager';
  const text = [ ...jd.responsibilities, ...jd.requirements ].join('\n')
    .split(/[\n。；;]+/).filter((clause) => !/优先|加分|更佳|协助|参与|配合/.test(clause)).join('\n');
  if (/总监|负责人|经理|主管|组长|team\s*lead|tech\s*lead|engineering\s*manager/i.test(jd.title)
    && !/产品经理|项目经理|客户经理/.test(jd.title)) return 'manager';
  if (/管理方向|团队管理|人员管理|团队搭建|绩效管理|招聘培养|带领.{0,8}团队|负责.{0,8}团队.{0,8}(管理|交付)/i.test(text)) return 'manager';
  if (/工程师|开发|测试|运维|算法|研发|程序员/i.test(jd.title)) return 'engineer';
  return 'specialist';
}

function targetTerms(jd: JD): string[] {
  const text = targetText(jd);
  const lower = text.toLowerCase();
  const terms = MATCH_TERMS.filter((term) => {
    const normalizedTerm = term.toLowerCase();
    if (/^[a-z0-9.+#-]+$/i.test(normalizedTerm)) {
      const escaped = normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(lower);
    }
    return lower.includes(normalizedTerm);
  });
  const englishTerms = text
    .match(/[A-Za-z][A-Za-z0-9.+#-]{1,24}/g)
    ?.filter((term) => !GENERIC_TERMS.has(term.toLowerCase())) || [];
  return Array.from(new Set([...terms, ...englishTerms]));
}

function candidateScorer(jd: JD) {
  const terms = targetTerms(jd).map(normalized);
  const title = normalized(jd.title);
  const jdProfile = extractJDTagProfile(jd);
  return (candidate: SameJobCandidateInput, index: number) => {
      const evidence = normalized([candidate.currentJob, candidate.highlights, candidate.resumeText].join('\n'));
      const termHits = terms.reduce((score, term) => score + (evidence.includes(term) ? 1 : 0), 0);
      const tagComparison = compareTagProfiles(jdProfile, extractCandidateTagProfile(candidate));
      const organizationPolicy = evaluateOrganizationMatchPolicy(jd, candidate.resumeText);
      const titleHit = candidate.currentJob && (
        title.includes(normalized(candidate.currentJob)) || normalized(candidate.currentJob).includes(title)
      ) ? 3 : 0;
      return {
        candidate,
        index,
        score: tagComparison.score * 2 + termHits + titleHit + organizationPolicy.scoreAdjustment,
      };
  };
}

function sortedCandidates(scored: Array<ReturnType<ReturnType<typeof candidateScorer>>>, limit: number) {
  return scored.sort((a, b) => b.score - a.score
      || new Date(b.candidate.uploadedAt).getTime() - new Date(a.candidate.uploadedAt).getTime()
      || a.index - b.index)
    .slice(0, limit)
    .map(({ candidate }) => candidate);
}

/** 本地粗排只决定哪些人进入 AI 精排，不作为最终匹配结论。 */
export function prefilterSameJobCandidates(
  jd: JD,
  candidates: SameJobCandidateInput[],
  limit = MAX_SAME_JOB_MATCH_CANDIDATES,
): SameJobCandidateInput[] {
  return sortedCandidates(candidates.map(candidateScorer(jd)), limit);
}

function clip(value: string, max: number): string {
  const clean = value.trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

/** Yield between small chunks so first-time indexing does not block clicks or painting. */
export async function prefilterSameJobCandidatesAsync(
  jd: JD,
  candidates: SameJobCandidateInput[],
  signal: AbortSignal,
): Promise<SameJobCandidateInput[]> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  const scoreCandidate = candidateScorer(jd);
  const scored: Array<ReturnType<typeof scoreCandidate>> = [];
  let chunkStarted = performance.now();
  for (let index = 0; index < candidates.length; index += 1) {
    signal.throwIfAborted();
    scored.push(scoreCandidate(candidates[index], index));
    if (performance.now() - chunkStarted >= 8) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      chunkStarted = performance.now();
    }
  }
  signal.throwIfAborted();
  return sortedCandidates(scored, candidates.length);
}

function clampScore(value: unknown): number {
  return Math.min(100, Math.max(0, Math.round(Number(value) || 0)));
}

function cleanList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(String).map((item) => item.trim()).filter(Boolean).slice(0, max);
}

function extractJson(value: string): Record<string, unknown> {
  const cleaned = value.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('智能筛选结果格式异常');
  return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
}

function localTagFallback(jd: JD, candidates: SameJobCandidateInput[]): SameJobMatchResult[] {
  const jdProfile = extractJDTagProfile(jd);
  return candidates.map<SameJobMatchResult>((candidate) => {
    const candidateProfile = extractCandidateTagProfile(candidate);
    const comparison = compareTagProfiles(jdProfile, candidateProfile);
    const organizationPolicy = evaluateOrganizationMatchPolicy(jd, candidate.resumeText);
    const score = clampScore(Math.min(69, organizationPolicy.scoreCap, comparison.score + organizationPolicy.scoreAdjustment));
    return {
      assessmentSource: 'local',
      candidateKey: candidate.key,
      score,
      level: score >= 60 ? 'medium' : 'low',
      candidateLevel: 'unclear',
      candidateLevels: [],
      reasoning: organizationPolicy.concerns[0] || '暂按已有标签排序，AI 评估尚未完成，层级和核心要求需人工复核。',
      matched: [...organizationPolicy.matched, ...comparison.matched.map((tag) => tag.label)].slice(0, 4),
      technicalEvidence: comparison.matched.map((tag) => `标签命中：${tag.label}`).slice(0, 4),
      matchedTags: comparison.matched.map((tag) => tag.label).slice(0, 8),
      tentativeTags: comparison.tentative.map((tag) => tag.label).slice(0, 5),
      pendingCoreTags: comparison.missingRequired.map((tag) => tag.label).slice(0, 5),
      managementEvidence: [],
      architectureEvidence: [],
      hardSkillStatus: 'unknown',
      missing: [...organizationPolicy.concerns, ...comparison.missingRequired.map((tag) => `待确认：${tag.label}`)].slice(0, 3),
    };
  }).sort((a, b) => b.score - a.score);
}

function buildPrompt(jd: JD, candidates: SameJobCandidateInput[]): string {
  const targetLevel = sameJobTargetLevel(jd);
  const jdProfile = extractJDTagProfile(jd);
  const jdTags = visibleProfileTags(jdProfile, 16)
    .map((tag) => `${tag.label}${tag.required ? '（核心信号，待核实条件级别）' : ''}`)
    .join('、');
  const candidateList = candidates.map((candidate, index) => {
    const profile = extractCandidateTagProfile(candidate);
    const factTags = profile.tags
      .filter((tag) => tag.evidence.some((evidence) => evidence.quality === 'fact'))
      .slice(0, 16)
      .map((tag) => tag.label)
      .join('、');
    const tentativeTags = profile.tags
      .filter((tag) => !tag.evidence.some((evidence) => evidence.quality === 'fact'))
      .slice(0, 8)
      .map((tag) => tag.label)
      .join('、');
    return `### 人选-${index + 1}
- 原推荐岗位：${candidate.currentJob || '未记录'}
- 匹配材料来源：${candidate.resumeSource === 'full_resume' ? '人才库完整简历正文' : '历史推荐资料（可能不完整）'}
- 简历事实标签：${factTags || '未提取到'}
- 待核实召回标签：${tentativeTags || '无'}
- 已提取亮点：${clip(candidate.highlights, 900) || '未记录'}
- 简历事实：${clip(candidate.resumeText, 5000) || '未记录'}`;
  }).join('\n\n');

  return `你是资深招聘匹配顾问。请针对一个明确的目标岗位，在历史候选人中做同岗复推精排。

## 目标岗位
- 职位：${jd.title}
- 部门：${jd.department || '未记录'}
- 组织：${jd.organization || jd.serviceUnit || '未记录'}
- 职责：${clip(jd.responsibilities.join('；'), 5000)}
- 要求：${clip(jd.requirements.join('；'), 5000)}
- 加分项：${clip((jd.preferredQualifications || []).join('；'), 1500) || '未记录'}
- 备注：${clip(jd.notes || '', 500) || '未记录'}
- 组织匹配规则：${organizationMatchPolicyPrompt(jd) || '无额外规则'}
- 自动提取目标标签：${jdTags || '未提取到（以JD原文为准）'}

## 历史候选人
${candidateList}

## 判断规则
1. 先判断岗位核心技术与层级，再区分业务场景；不要因为都叫 Go 或后端就给高分。
   自动标签只负责辅助召回和对齐术语，JD原文与简历事实始终优先；待核实召回标签不能作为能力证据。
2. 直播、视频内容、音视频、泛娱乐等场景，只有简历工作或项目中有直接事实才算命中；AI亮点、求职意向和原推荐岗位名称只能做召回信号。
3. matched 必须写候选人材料中可核对的短证据，例如“直播间高并发后端”“短视频内容平台”；不得补造经历。
4. missing 写目标 JD 的关键缺口。证据不足时必须降分，并明确写“未见相关证据”。
5. candidateLevel 必须区分：manager=有直接的带团队、人员分工、招聘绩效或团队交付负责证据；architect=有跨系统架构决策、技术选型、容量/稳定性设计、架构治理及落地结果；engineer=以个人编码和技术交付为主；specialist=非技术岗位的专业执行或专家型人选；unclear=材料不足。头衔不能代替事实证据。
6. managementEvidence 只填写直接管理事实；没有就返回空数组，不得把“参与项目、跨部门协作、架构设计”当作人员管理。
7. architectureEvidence 只填写架构师层面的直接事实；仅有“参与架构设计”、使用微服务或普通模块设计不算，没有就返回空数组。
8. 当前目标是${targetLevel === 'manager'
    ? '管理岗：没有直接管理证据的人选只能标为待核实，总分不得超过69分；技术深度不能替代团队管理责任'
    : targetLevel === 'architect'
      ? '架构师岗：没有跨系统架构决策与落地证据的人选只能标为待核实，总分不得超过69分；普通开发或模块设计不能冒充架构经验'
      : targetLevel === 'engineer'
        ? '工程师岗：重点评价近期亲自编码、技术实现和交付深度；仅有管理或架构头衔但缺少动手证据不能高分'
        : '非技术专业岗：按岗位方向评价实际运营/产品/内容等职责闭环，不使用“工程师级”标签'}。
9. 技术维度必须拆开核对，不能只判断“都是前端/后端”：
   - 核心语言与框架：如 React、Vue/Vue3、Go、Flutter/Dart，邻近技术只算可迁移，不算已具备。
   - 平台与渲染：Web、SSR/SSG、SEO、Flutter、iOS/Android 原生。
   - 专项领域：流媒体、播放器、HLS/WebRTC/FLV/CDN、直播互动、搜索增长等。
   - 工程能力：性能指标、弱网、稳定性、代码审计、自动化、架构复杂度。
   technicalEvidence 用“维度：简历事实”的形式返回最多4条，例如“渲染：主导Next.js SSR落地”。
10. hardSkillStatus 必须使用三态：met=有直接事实证据；unknown=材料未写或证据不足；not_met=材料存在明确反证。unknown 不能写成“不具备”，但不得进入高匹配；not_met 总分不得超过59，unknown 总分不得超过69。“了解/优先”缺失不算核心条件。React不能替代Vue，普通Web不能替代Flutter，普通视频页面不能替代流媒体播放链路。
11. 技术岗按核心技术与职责50、业务场景30、层级与复杂度20评分；运营岗重点评价增长/用户/产品运营方向与结果闭环；产品岗重点评价产品类型、用户场景、0-1与数据结果；设计、内容及职能岗按对应专业事实评价，不强行套用技术证据。
12. level：score>=75 为 high，60-74 为 medium，低于60为 low。
13. 必须返回全部 ${candidates.length} 位，每个 candidateIndex 只出现一次。

返回严格 JSON，不要 Markdown，不要额外说明：
{"results":[{"candidateIndex":1,"score":86,"level":"high","candidateLevel":"architect","reasoning":"Go高并发基础扎实，且有跨系统架构落地","matched":["直播间高并发"],"technicalEvidence":["语言：Go生产开发5年","流媒体：负责HLS播放链路优化"],"managementEvidence":[],"architectureEvidence":["主导直播平台服务拆分与容量设计并完成上线"],"hardSkillStatus":"met","missing":["未见视频内容平台证据"]}]}`;
}

async function matchCandidateBatch(
  jd: JD,
  candidates: SameJobCandidateInput[],
  signal?: AbortSignal,
): Promise<SameJobMatchResult[]> {
  if (candidates.length === 0) return [];
  let response: Response;
  try {
    response = await fetch('/api/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'deepseek-v4-flash',
        messages: [{ role: 'user', content: buildPrompt(jd, candidates) }],
        thinking: { type: 'disabled' },
        temperature: 0,
        max_tokens: Math.min(6500, Math.max(2600, candidates.length * 650)),
      }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error('智能筛选连接超时，请稍后重试');
  }

  const data = await response.json().catch(() => ({})) as {
    error?: string;
    choices?: Array<{ message?: { content?: string } }>;
  };
  if (!response.ok) throw new Error(data.error || '智能筛选服务暂不可用');
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error(data.error || '智能筛选没有返回结果');

  let parsed: Record<string, unknown>;
  try {
    parsed = extractJson(content);
  } catch {
    return localTagFallback(jd, candidates);
  }
  const rows = Array.isArray(parsed?.results) ? parsed.results as Array<Record<string, unknown>> : [];
  const seen = new Set<number>();
  const jdProfile = extractJDTagProfile(jd);
  const results = rows.flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const index = Number(row.candidateIndex);
    const candidate = candidates[index - 1];
    if (!Number.isInteger(index) || !candidate || seen.has(index)) return [];
    seen.add(index);
    const tagComparison = compareTagProfiles(jdProfile, extractCandidateTagProfile(candidate));
    const managementEvidence = cleanList(row.managementEvidence, 3)
      .filter((evidence) => !/未见|没有|无明确|无直接|未体现|不详|待确认/.test(evidence));
    const architectureEvidence = cleanList(row.architectureEvidence, 3)
      .filter((evidence) => !/未见|没有|无明确|无直接|未体现|不详|待确认/.test(evidence));
    const matched = cleanList(row.matched, 4);
    const technicalEvidence = cleanList(row.technicalEvidence, 4);
    const statedCandidateLevel = row.candidateLevel;
    const targetLevel = sameJobTargetLevel(jd);
    const candidateLevel: SameJobMatchResult['candidateLevel'] = targetLevel === 'manager' && managementEvidence.length > 0
      ? 'manager'
      : targetLevel === 'architect' && architectureEvidence.length > 0
        ? 'architect'
      : managementEvidence.length > 0
          ? 'manager'
          : architectureEvidence.length > 0
            ? 'architect'
            : statedCandidateLevel === 'engineer' || statedCandidateLevel === 'specialist' ? statedCandidateLevel : 'unclear';
    const candidateLevels: SameJobMatchResult['candidateLevels'] = [];
    if (managementEvidence.length > 0) candidateLevels.push('manager');
    if (architectureEvidence.length > 0) candidateLevels.push('architect');
    if (statedCandidateLevel === 'engineer' || technicalEvidence.length > 0) candidateLevels.push('engineer');
    if (statedCandidateLevel === 'specialist') candidateLevels.push('specialist');
    const rawScore = clampScore(row.score);
    const organizationPolicy = evaluateOrganizationMatchPolicy(jd, candidate.resumeText);
    const lacksTargetLevelEvidence = (targetLevel === 'manager' && managementEvidence.length === 0)
      || (targetLevel === 'architect' && architectureEvidence.length === 0);
    const statedHardSkillStatus = String(row.hardSkillStatus || '').toLowerCase();
    const hardSkillStatus: SameJobMatchResult['hardSkillStatus'] = statedHardSkillStatus === 'met' || statedHardSkillStatus === 'not_met'
      ? statedHardSkillStatus
      : 'unknown';
    const lacksGroundedEvidence = matched.length === 0
      || (targetLevel === 'engineer' && technicalEvidence.length === 0);
    const evidenceCappedScore = hardSkillStatus === 'not_met'
      ? Math.min(rawScore, 59)
      : lacksTargetLevelEvidence || hardSkillStatus === 'unknown' || lacksGroundedEvidence ? Math.min(rawScore, 69) : rawScore;
    const score = clampScore(Math.min(
      organizationPolicy.scoreCap,
      evidenceCappedScore + organizationPolicy.scoreAdjustment,
    ));
    const level: SameJobMatchResult['level'] = score >= 75 ? 'high' : score >= 60 ? 'medium' : 'low';
    return [{
      assessmentSource: 'ai' as const,
      candidateKey: candidate.key,
      score,
      level,
      candidateLevel,
      candidateLevels,
      reasoning: organizationPolicy.concerns[0] || String(row.reasoning || '').trim() || '请结合简历原文复核',
      matched: [...organizationPolicy.matched, ...matched].slice(0, 4),
      technicalEvidence,
      matchedTags: tagComparison.matched.map((tag) => tag.label).slice(0, 8),
      tentativeTags: tagComparison.tentative.map((tag) => tag.label).slice(0, 5),
      pendingCoreTags: tagComparison.missingRequired.map((tag) => tag.label).slice(0, 5),
      managementEvidence,
      architectureEvidence,
      hardSkillStatus,
      missing: [...organizationPolicy.concerns, ...cleanList(row.missing, 3)].slice(0, 3),
    }];
  });

  const missingCandidates = candidates.filter((_, index) => !seen.has(index + 1));
  return [...results, ...localTagFallback(jd, missingCandidates)].sort((a, b) => b.score - a.score);
}

export async function matchCandidatesToSameJob(
  jd: JD,
  candidates: SameJobCandidateInput[],
  signal?: AbortSignal,
  onProgress?: (results: SameJobMatchResult[], completed: number, total: number) => void,
): Promise<SameJobMatchResult[]> {
  const results: SameJobMatchResult[] = [];
  let next = 0;
  const batchSize = 6;
  const worker = async () => {
    while (next < candidates.length) {
      signal?.throwIfAborted();
      const batch = candidates.slice(next, next + batchSize);
      next += batchSize;
      let batchResults: SameJobMatchResult[];
      try {
        batchResults = await matchCandidateBatch(jd, batch, signal);
      } catch (error) {
        if (signal?.aborted) throw error;
        batchResults = localTagFallback(jd, batch);
      }
      signal?.throwIfAborted();
      results.push(...batchResults);
      onProgress?.([...results].sort((a, b) => b.score - a.score), results.length, candidates.length);
    }
  };
  await Promise.all([worker(), worker()]);
  return results.sort((a, b) => b.score - a.score);
}
