import { JD_CATEGORY_LABELS, getPrimaryCategory, type JD } from '@/types/jd';
import type { MatchingResult } from '@/types/matching';
import { detectResumeCategories } from './jd-prefilter';
import { sameJobCoreRules, sameJobTargetLevel } from './same-job-match';
import { compareTagProfiles, extractCandidateTagProfile, extractJDTagProfile } from './tag-system';
import { evaluateOrganizationMatchPolicy } from './matching-policy';

const LEVEL_LABELS = {
  manager: '经理级',
  architect: '架构师级',
  engineer: '工程师级',
  specialist: '专业执行',
} as const;

const CATEGORY_WEIGHT = 0.15;
const CORE_TAG_WEIGHT = 0.45;
const TAG_PROFILE_WEIGHT = 0.15;
const FACT_EVIDENCE_WEIGHT = 0.15;
const SENIORITY_WEIGHT = 0.1;
const GENERIC_OPERATIONS = new Set(['ops:growth', 'ops:content', 'ops:data', 'ops:project', 'ops:brand']);

function directScoreCap(strongEvidenceCount: number): number {
  if (strongEvidenceCount >= 3) return 98;
  if (strongEvidenceCount === 2) return 95;
  return 86;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

/**
 * 全岗位本地快速预筛：岗位属性是进入“直接可推”的硬条件，JD 核心标签按 AND/OR 规则核对。
 * 缺少证据只进入待复核，不把“简历没写”误判成明确不符合。
 */
export function prescreenResumeToJDs(resumeText: string, jds: JD[], resumeId: string): MatchingResult[] {
  const candidateProfile = extractCandidateTagProfile({ resumeText, currentJob: '', highlights: '' });
  const candidateTags = new Map(candidateProfile.tags.map((tag) => [tag.id, tag]));
  const candidateCategories = detectResumeCategories(resumeText);
  const confirmedTagIds = new Set(candidateProfile.tags
    .filter((tag) => tag.evidence.some((item) => item.quality === 'fact'))
    .map((tag) => tag.id));

  return jds.map<MatchingResult>((jd) => {
    const targetCategory = getPrimaryCategory(jd);
    const categoryMatched = candidateCategories.includes(targetCategory);
    const organizationPolicy = evaluateOrganizationMatchPolicy(jd, resumeText);
    const jdProfile = extractJDTagProfile(jd);
    const jdTags = new Map(jdProfile.tags.map((tag) => [tag.id, tag]));
    const coreRules = sameJobCoreRules(jd)
      .filter((rule) => rule.defaultSelected && rule.kind !== 'attribute');
    const ruleEvidence = coreRules.map((rule) => {
      const evidence = rule.tagIds.flatMap((tagId) => candidateTags.get(tagId)?.evidence || [])
        .find((item) => item.quality === 'fact');
      return { rule, evidence };
    });
    const matchedRules = ruleEvidence.filter((item) => item.evidence);
    const pendingRules = ruleEvidence.filter((item) => !item.evidence);
    const targetLevel = sameJobTargetLevel(jd);
    const levelMatched = targetLevel === 'manager'
      ? confirmedTagIds.has('level:manager')
      : targetLevel === 'architect'
        ? confirmedTagIds.has('level:architect')
        : categoryMatched;
    const allCoreMatched = coreRules.length > 0 && pendingRules.length === 0;
    const differentiatingMatches = matchedRules.filter(({ rule }) => rule.tagIds.some((tagId) => {
      const dimension = jdTags.get(tagId)?.dimension;
      return dimension !== undefined && dimension !== 'level' && dimension !== 'platform';
    }));
    const targetLevelEvidenceCount = (targetLevel === 'manager' && confirmedTagIds.has('level:manager'))
      || (targetLevel === 'architect' && confirmedTagIds.has('level:architect')) ? 1 : 0;
    const distinctEvidence = new Set(differentiatingMatches
      .filter(({ rule }) => rule.tagIds.some((id) => !GENERIC_OPERATIONS.has(id)))
      .map(({ evidence }) => evidence!.snippet));
    const strongEvidenceCount = distinctEvidence.size + targetLevelEvidenceCount
      + organizationPolicy.strongEvidenceCount;
    const comparison = compareTagProfiles(jdProfile, candidateProfile);
    const unverifiedRequirements = comparison.missingRequired.filter((tag) => tag.dimension !== 'level');
    const executionRole = /初级|中级|专员|助理/.test(jd.title) && targetLevel !== 'manager';
    const levelScopePending = (executionRole || targetLevel === 'specialist') && confirmedTagIds.has('level:manager');
    const operationsRole = ['operations', 'bd', 'marketing', 'content'].includes(targetCategory);
    // Several related operations tags share transferable skills, not independent proof of business fit.
    const calibratedCap = operationsRole ? Math.min(86, directScoreCap(strongEvidenceCount)) : directScoreCap(strongEvidenceCount);

    // 岗位大类只是门槛；至少还要有一个技术栈、业务场景或专业方向的事实证据。
    const matchTier: NonNullable<MatchingResult['matchTier']> = organizationPolicy.scoreCap <= 59
      ? 'reject'
      : categoryMatched && allCoreMatched && levelMatched
        && differentiatingMatches.length > 0 && !organizationPolicy.directBlocked
        && unverifiedRequirements.length === 0 && !levelScopePending
        && (strongEvidenceCount > 0 || comparison.score >= 75)
        ? 'direct'
        : categoryMatched || matchedRules.length > 0
          ? 'review'
          : 'reject';

    const coreRatio = coreRules.length ? matchedRules.length / coreRules.length : 0;
    const skillsMatch = clamp(coreRatio * 100, 0, 100);
    const experienceMatch = clamp(matchedRules.length ? 55 + matchedRules.length * 15 : 25, 0, 100);
    const domainMatch = categoryMatched ? 100 : matchedRules.length ? 45 : 10;
    const seniorityMatch = levelMatched ? 100 : 40;
    const rawScore = domainMatch * CATEGORY_WEIGHT + skillsMatch * CORE_TAG_WEIGHT
      + comparison.score * TAG_PROFILE_WEIGHT + experienceMatch * FACT_EVIDENCE_WEIGHT
      + seniorityMatch * SENIORITY_WEIGHT + organizationPolicy.scoreAdjustment;
    const score = matchTier === 'direct'
      ? clamp(rawScore, 80, Math.min(calibratedCap, organizationPolicy.scoreCap))
      : matchTier === 'review'
        ? clamp(rawScore, 60, Math.min(79, organizationPolicy.scoreCap))
        : clamp(rawScore, 0, Math.min(59, organizationPolicy.scoreCap));

    const candidateLevels: string[] = [];
    if (confirmedTagIds.has('level:manager')) candidateLevels.push(LEVEL_LABELS.manager);
    if (confirmedTagIds.has('level:architect')) candidateLevels.push(LEVEL_LABELS.architect);
    if (!candidateLevels.length && categoryMatched) candidateLevels.push(
      /工程师|开发|程序员|engineer/i.test(resumeText) ? LEVEL_LABELS.engineer : LEVEL_LABELS.specialist,
    );

    const categoryText = candidateCategories.length
      ? candidateCategories.map((category) => JD_CATEGORY_LABELS[category]).join(' / ')
      : '暂未识别';
    const concerns = [
      ...(!categoryMatched ? [`岗位属性待确认：目标是${JD_CATEGORY_LABELS[targetCategory]}，简历当前识别为${categoryText}`] : []),
      ...(pendingRules.length ? [`待确认核心元素：${pendingRules.map((item) => item.rule.label).join('、')}`] : []),
      ...(!levelMatched && (targetLevel === 'manager' || targetLevel === 'architect')
        ? [`待确认${LEVEL_LABELS[targetLevel]}的直接职责证据`] : []),
      ...(unverifiedRequirements.length ? [`其他必备标签待确认：${unverifiedRequirements.map((tag) => tag.label).join('、')}`] : []),
      ...(levelScopePending ? ['候选人有团队管理经历，需确认是否接受本岗位的执行职责与职级'] : []),
      ...organizationPolicy.concerns,
    ];
    const reasoning = matchTier === 'direct'
      ? `岗位属性、${matchedRules.length} 个 JD 核心元素及目标层级均有简历原文依据；分数已按 ${strongEvidenceCount} 个区分性证据校准。`
      : matchTier === 'review'
        ? `大方向或部分核心元素符合，但仍有 ${concerns.length || 1} 项需要确认，已进入 AI 复核队列。`
        : organizationPolicy.concerns[0]
          ? `触发组织匹配规则：${organizationPolicy.concerns[0]}`
          : '岗位属性与核心元素均未找到可核对的简历事实，当前不建议优先推荐。';

    return {
      id: `${resumeId}-${jd.id}`,
      jdId: jd.id,
      jd,
      resumeId,
      score,
      assessmentStatus: 'completed',
      assessmentSource: 'local',
      matchTier,
      categoryMatched,
      matchedCoreTags: matchedRules.map((item) => item.rule.label),
      pendingCoreTags: Array.from(new Set([...pendingRules.map((item) => item.rule.label),
        ...unverifiedRequirements.map((tag) => tag.label), ...organizationPolicy.concerns])),
      policyScoreCap: organizationPolicy.scoreCap,
      policyMatched: organizationPolicy.matched,
      policyConcerns: organizationPolicy.concerns,
      candidateLevels,
      evidence: matchedRules.slice(0, 6).map((item) => ({
        quote: item.evidence!.snippet,
        requirement: item.rule.label,
        dimension: 'core-tag',
      })),
      breakdown: {
        skillsMatch,
        experienceMatch,
        domainMatch,
        seniorityMatch,
        overallFit: score,
      },
      reasoning,
      highlights: [
        ...matchedRules.map((item) => `${item.rule.label}：${item.evidence!.snippet}`),
        ...organizationPolicy.matched,
      ],
      concerns,
      matchedAt: new Date().toISOString(),
    } satisfies MatchingResult;
  }).sort((a, b) => b.score - a.score
    || Number(b.categoryMatched) - Number(a.categoryMatched)
    || a.concerns.length - b.concerns.length
    || (b.matchedCoreTags?.length || 0) - (a.matchedCoreTags?.length || 0));
}
