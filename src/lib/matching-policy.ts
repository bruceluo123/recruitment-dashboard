import type { JD } from '@/types/jd';
import { extractCandidateTagProfile, extractJDTagProfile, normalizeMatchingText } from './tag-system';

export interface OrganizationMatchPolicy {
  scoreAdjustment: number;
  scoreCap: number;
  directBlocked: boolean;
  eligibleForDefaultPrescreen: boolean;
  strongEvidenceCount: number;
  matched: string[];
  concerns: string[];
}

const WEB3_SIGNAL = /\bweb\s*3\b|区块链|交易所|数字货币|加密货币|\bcrypto\b|\bblockchain\b|\bdefi\b|\bdex\b|公链|链上/gi;
const GAME_SIGNAL = /游戏|手游|端游|gaming|game publishing|game operation/i;
const OVERSEAS_GAME_SIGNAL = /(?:海外|出海|国际市场|全球市场|海外发行|海外运营).{0,40}(?:游戏|手游|端游|gaming)|(?:游戏|手游|端游|gaming).{0,40}(?:海外|出海|国际市场|全球市场|海外发行|海外运营)/i;
const NEGATIVE_SIGNAL = /没有|从未|未做|未曾|不具备|不涉及|无.{0,12}经验|\b(?:no|never|without)\b/i;

function organizationText(jd: JD): string {
  return [jd.organization, jd.serviceUnit, jd.department].filter(Boolean).join('/');
}

function jdText(jd: JD): string {
  return [jd.title, ...jd.responsibilities, ...jd.requirements, ...(jd.preferredQualifications || []), jd.notes || ''].join('\n');
}

function factualResumeText(resumeText: string): string {
  return normalizeMatchingText(resumeText)
    .replace(/^\s*(?:求职意向|应聘岗位|目标岗位|期望岗位)[：:].*$/gim, '')
    .split(/[\n。；;]+/)
    .filter((clause) => !NEGATIVE_SIGNAL.test(clause))
    .join('\n');
}

function hasDominantWeb3Experience(resumeText: string): boolean {
  const factualText = factualResumeText(resumeText);
  const mentions = factualText.match(WEB3_SIGNAL)?.length || 0;
  WEB3_SIGNAL.lastIndex = 0;
  const dominantDescription = /(?:近.{0,6}年|近年|长期|主要|核心|主线|专注|一直).{0,30}(?:web\s*3|区块链|交易所|crypto|blockchain|defi|公链|链上)|(?:web\s*3|区块链|交易所|crypto|blockchain|defi|公链|链上).{0,30}(?:近.{0,6}年|近年|长期|主要|核心|主线|专注|一直)/i.test(factualText);
  // A summary of years in the industry is stronger than repeating one keyword.
  const industrySummary = /(?:拥有|具备|累计|从事).{0,12}\d+\s*年.{0,15}(?:web\s*3|加密货币|区块链|交易所)/i.test(factualText.slice(0, 1200));
  return dominantDescription || industrySummary || mentions >= 4;
}

/** Keep preferred experience out of mandatory checks, including legacy mixed JD fields. */
function requiredJobText(jd: JD): string {
  return normalizeMatchingText([jd.title, ...jd.requirements, ...jd.responsibilities, jd.notes || '']
    .map((block) => block.split(/加分(?:项|条件)|优先(?:条件|加分)|preferred qualifications/i)[0])
    .join('\n'))
    .replace(/\s+\d+[.、]\s*/g, '\n')
    .split(/[\n。；;]+/)
    .filter((clause) => !/优先|更佳|加分|非必须|可选|nice.to.have/i.test(clause))
    .join('\n');
}

interface CriticalCheck {
  label: string;
  required: boolean;
  supported: boolean;
}

function criticalExperienceChecks(jd: JD, factualText: string): CriticalCheck[] {
  const text = requiredJobText(jd);
  const candidateIds = new Set(extractCandidateTagProfile({ resumeText: factualText, currentJob: '', highlights: '' }).tags.map((tag) => tag.id));
  const domainChecks: CriticalCheck[] = extractJDTagProfile(jd).tags
    .filter((tag) => tag.required && tag.dimension === 'scenario')
    .map((tag) => ({ label: `${tag.label}业务经历`, required: true, supported: candidateIds.has(tag.id) }));
  const requiredYears = Array.from(text.matchAll(/(\d+)\s*年以上.{0,14}(?:工作|从业|运营|开发|管理)?经验/g))
    .map((match) => ({ years: Number(match[1]), quote: match[0] }));
  const supportedYears = Math.max(0, ...Array.from(factualText.matchAll(/(?:拥有|具备|累计|近|从事)\s*(\d+)\s*年/g))
    .map((match) => Number(match[1])));
  // A missing duration is uncertainty; do not manufacture tenure from education dates.
  domainChecks.push(...requiredYears.filter(({ years }) => years >= 5).map(({ years, quote }) => ({
    label: quote, required: true, supported: supportedYears >= years,
  })));
  const operations = jd.categories.some((category) => ['operations', 'bd', 'marketing', 'content'].includes(category));
  if (!operations) return domainChecks;
  const botRole = /机器人|\bbot\b/i.test(jd.title);
  const contentRole = /社媒|自媒体|新媒体|内容增长/.test(jd.title);
  return [
    ...domainChecks,
    { label: '国内平台精准获客实战', required: /国内精准获客|国内打色粉|打色粉/.test(text),
      supported: /抖音|小红书|快手|视频号|贴吧/.test(factualText) && /获客|引流|起号|出粉/.test(factualText) },
    { label: 'TG机器人维护与脚本操作', required: botRole,
      supported: /(?:tg|telegram|搜索|群管|资源).{0,12}(?:机器人|bot)/i.test(factualText)
        && /脚本|编程|python|node\.js|shell|webhook|bot api/i.test(factualText) },
    { label: '订阅人数1万以上的TG机器人案例', required: botRole && /1w\+|1万|10000/i.test(text),
      supported: /(?:机器人|bot).{0,35}(?:\d+\s*万|[1-9]\d*\s*w|[1-9]\d{4,})|(?:\d+\s*万|[1-9]\d*\s*w|[1-9]\d{4,}).{0,35}(?:机器人|bot)/i.test(factualText) },
    { label: '网站后台/CMS实际操作', required: /网站后台|\bcms\b|页面配置/i.test(text),
      supported: /网站后台|\bcms\b|页面配置|栏目维护|站点运营/i.test(factualText) },
    { label: '独立视频制作/剪辑', required: contentRole && /独立.{0,45}(?:剪辑|视频制作)|(?:完成|负责).{0,25}短视频剪辑/.test(text),
      supported: /视频剪辑|短视频制作|capcut|premiere|剪映|剪辑.{0,12}(?:视频|素材)/i.test(factualText) },
    { label: '国内社媒运营案例', required: contentRole && (/国内媒体|国内社媒|国内新媒体/.test(jd.title) || /国内.{0,10}(?:均有|实际运营|平台.{0,8}经验)/.test(text)),
      supported: /抖音|小红书|快手|视频号|b站/i.test(factualText) },
    { label: '创作者/主播供给侧招募签约', required: /资源供给|供给增长/.test(jd.title),
      supported: /(?:创作者|达人|主播|mcn|公会).{0,25}(?:招募|签约|引入)|(?:招募|签约|引入).{0,25}(?:创作者|达人|主播|mcn|公会)/i.test(factualText) },
    { label: '英国本地社群活动经验', required: /在英国有.{0,20}(?:home bar|局头|娱乐经验)/i.test(text),
      supported: /(?:英国|uk|united kingdom).{0,35}(?:home bar|局头|组织活动|社群活动)/i.test(factualText) },
    { label: '会员订阅/工具/内容平台运营经历', required: /运营经理/.test(jd.title) && /vpn/i.test(text) && /订阅/.test(text),
      supported: /(?:订阅|工具类|内容平台|vpn).{0,20}(?:运营|增长|续费)|(?:运营|负责).{0,20}(?:订阅|工具类|内容平台|vpn)/i.test(factualText) },
  ];
}

function isMijingGamingJob(jd: JD): boolean {
  return /迷境/.test(organizationText(jd))
    && (jd.categories.includes('gaming') || GAME_SIGNAL.test(jdText(jd)));
}

function needsWeb3Deprioritization(jd: JD): boolean {
  return /瑞升|效能/.test(organizationText(jd));
}

/** Centralized organization knowledge used by resume matching and same-job repush. */
export function evaluateOrganizationMatchPolicy(jd: JD, resumeText: string): OrganizationMatchPolicy {
  const matched: string[] = [];
  const concerns: string[] = [];
  let scoreAdjustment = 0;
  let scoreCap = 100;
  let directBlocked = false;
  let eligibleForDefaultPrescreen = true;
  let strongEvidenceCount = 0;
  const factualText = factualResumeText(resumeText);

  if (isMijingGamingJob(jd)) {
    const hasCombinedExperience = OVERSEAS_GAME_SIGNAL.test(factualText);
    if (hasCombinedExperience) {
      scoreAdjustment += 6;
      strongEvidenceCount += 1;
      matched.push('组织偏好：海外游戏经验');
    } else {
      scoreAdjustment -= 15;
      scoreCap = Math.min(scoreCap, 69);
      directBlocked = true;
      eligibleForDefaultPrescreen = false;
      concerns.push('组织要求待确认：迷境游戏岗未见海外游戏经验');
    }
  }

  const explicitlyExcludesWeb3 = /(?:不要|不考虑|不接受|不看|排除)[^。；;\n]{0,65}(?:web\s*3|区块链|交易所)|(?:web\s*3|区块链|交易所)[^。；;\n]{0,20}(?:不考虑|不接受|不要)/i.test(jdText(jd));
  if ((needsWeb3Deprioritization(jd) || explicitlyExcludesWeb3) && hasDominantWeb3Experience(factualText)) {
    scoreAdjustment -= 25;
    scoreCap = Math.min(scoreCap, 59);
    directBlocked = true;
    eligibleForDefaultPrescreen = false;
    concerns.push(explicitlyExcludesWeb3
      ? 'JD明确排除条件：当前主要经历为 Web3、区块链或交易所'
      : '组织近期偏好：瑞升/效能暂不优先考虑主要经历为 Web3、区块链或交易所的人选');
  }

  for (const check of criticalExperienceChecks(jd, factualText)) {
    if (!check.required) continue;
    if (check.supported) {
      matched.push(`关键经历已匹配：${check.label}`);
    } else {
      scoreCap = Math.min(scoreCap, 69);
      directBlocked = true;
      eligibleForDefaultPrescreen = false;
      concerns.push(`关键经历待确认：${check.label}`);
    }
  }

  return {
    scoreAdjustment,
    scoreCap,
    directBlocked,
    eligibleForDefaultPrescreen,
    strongEvidenceCount,
    matched,
    concerns,
  };
}

export function organizationMatchPolicyPrompt(jd: JD): string {
  const rules: string[] = ['JD中的不要、不考虑、不接受属于排除条件，不能提取为正向标签。通用增长、内容、数据经验不能替代指定平台、业务场景、独立交付或管理职责；缺少证据标待确认。'];
  if (isMijingGamingJob(jd)) {
    rules.push('迷境游戏相关岗位把海外游戏经历作为关键条件；未见直接经历时不得高于69分，不能用普通海外或普通游戏经历单独替代。');
  }
  if (needsWeb3Deprioritization(jd)) {
    rules.push('瑞升/效能近期不优先考虑主要经历为Web3、区块链或交易所的人选；近期主线明确时不得高于59分，但零散或早期提及不能直接淘汰。');
  }
  return rules.join(' ');
}
