import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'artifacts');
const RUN_DATE = new Date().toISOString().slice(0, 10);

function parseEnv(text) {
  const values = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index < 1) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

async function loadEnvironment() {
  let fileValues = {};
  try {
    fileValues = parseEnv(await fs.readFile(path.join(ROOT, '.env.local'), 'utf8'));
  } catch {
    // CI and production environments may provide variables directly.
  }
  return { ...fileValues, ...process.env };
}

function parseStoredJson(value, fallback = []) {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeCode(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function normalizeText(value) {
  return String(value || '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function normalizeName(value) {
  return normalizeText(value).replace(/(简历|resume|cv)$/i, '');
}

function isCandidateCode(value) {
  return /^XY(?:MMF|BB)\d{2,}$/i.test(normalizeCode(value));
}

function ownerFromCode(code, fallback) {
  if (code.startsWith('XYBB')) return 'b';
  if (code.startsWith('XYMMF')) return 'a';
  return fallback || 'a';
}

function buildCandidateStatus(candidate) {
  if (!candidate) return 'none';
  if (candidate.outcome === 'failed') return 'failed';
  if (candidate.outcome === 'withdrawn') return 'withdrawn';
  if (candidate.outcome === 'onboarded') return 'onboarded';
  if (candidate.stage === 'offer') return 'offer';
  if (candidate.stage === 'interview-2') return 'interview-2';
  if (candidate.stage === 'interview-1') return 'interview-1';
  return candidate.stage || 'unknown';
}

function pickMostRecent(items, dateKey) {
  return [...items].sort((a, b) => Date.parse(b?.[dateKey] || 0) - Date.parse(a?.[dateKey] || 0))[0];
}

function countBy(values) {
  const result = {};
  for (const value of values) result[value] = (result[value] || 0) + 1;
  return Object.fromEntries(Object.entries(result).sort((a, b) => b[1] - a[1]));
}

function csvEscape(value) {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

async function mapLimit(items, limit, mapper) {
  const output = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      output[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return output;
}

async function main() {
  const env = await loadEnvironment();
  const kvUrl = (env.KV_REST_API_URL || env.NEXT_PUBLIC_KV_URL || '').replace(/\/$/, '');
  const kvToken = env.KV_REST_API_READ_ONLY_TOKEN || env.NEXT_PUBLIC_KV_READONLY_TOKEN || env.KV_REST_API_TOKEN;
  if (!kvUrl || !kvToken) throw new Error('Missing Upstash read configuration in .env.local');

  async function kvGet(key) {
    const response = await fetch(`${kvUrl}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${kvToken}` },
    });
    if (!response.ok) throw new Error(`Unable to read ${key}: HTTP ${response.status}`);
    const data = await response.json();
    return data.result ?? null;
  }

  const [talentsRaw, recommendationsRaw, candidatesRaw, jdsRaw] = await Promise.all([
    kvGet('recruit:talents'),
    kvGet('recruit:repush'),
    kvGet('recruit:candidates'),
    kvGet('recruit:jds'),
  ]);
  const talents = parseStoredJson(talentsRaw);
  const recommendations = parseStoredJson(recommendationsRaw);
  const candidates = parseStoredJson(candidatesRaw);
  const jds = parseStoredJson(jdsRaw);

  const codedRecommendations = recommendations.filter((item) => isCandidateCode(item.candidateCode));
  const talentById = new Map(talents.map((item) => [item.id, item]));
  const talentByCode = new Map();
  const talentsByName = new Map();
  for (const talent of talents) {
    const code = normalizeCode(talent.candidateCode);
    if (isCandidateCode(code) && !talentByCode.has(code)) talentByCode.set(code, talent);
    const name = normalizeName(talent.name);
    if (!name) continue;
    const bucket = talentsByName.get(name) || [];
    bucket.push(talent);
    talentsByName.set(name, bucket);
  }
  const candidateById = new Map(candidates.map((item) => [item.id, item]));
  const jdById = new Map(jds.map((item) => [item.id, item]));

  const linkedRows = codedRecommendations.map((recommendation) => {
    const code = normalizeCode(recommendation.candidateCode);
    let talent = recommendation.talentId ? talentById.get(recommendation.talentId) : null;
    let talentLink = talent ? 'talentId' : '';
    if (!talent) {
      talent = talentByCode.get(code);
      if (talent) talentLink = 'candidateCode';
    }
    if (!talent) {
      const nameMatches = talentsByName.get(normalizeName(recommendation.candidateName)) || [];
      if (nameMatches.length === 1) {
        talent = nameMatches[0];
        talentLink = 'uniqueName';
      }
    }

    let candidate = recommendation.candidateId ? candidateById.get(recommendation.candidateId) : null;
    let candidateLink = candidate ? 'candidateId' : '';
    if (!candidate && talent?.id) {
      const matches = candidates.filter((item) => item.talentId === talent.id
        && normalizeText(item.jdTitle) === normalizeText(recommendation.jdTitle));
      if (matches.length) {
        candidate = pickMostRecent(matches, 'updatedAt');
        candidateLink = 'talentId+job';
      }
    }
    if (!candidate) {
      const matches = candidates.filter((item) => (item.owner || ownerFromCode(code)) === recommendation.column
        && normalizeName(item.name) === normalizeName(recommendation.candidateName)
        && normalizeText(item.jdTitle) === normalizeText(recommendation.jdTitle));
      if (matches.length) {
        candidate = pickMostRecent(matches, 'updatedAt');
        candidateLink = 'owner+name+job';
      }
    }

    const jd = candidate?.jdId ? jdById.get(candidate.jdId) : null;
    return { recommendation, code, talent, talentLink, candidate, candidateLink, jd };
  });

  const uniqueTalents = [...new Map(linkedRows
    .filter((row) => row.talent?.id && row.talent.hasResumeText)
    .map((row) => [row.talent.id, row.talent])).values()];
  const resumeEntries = await mapLimit(uniqueTalents, 8, async (talent) => {
    try {
      const value = await kvGet(`recruit:talent-text:${talent.id}`);
      return [talent.id, typeof value === 'string' ? value : ''];
    } catch {
      return [talent.id, ''];
    }
  });
  const resumeTextByTalentId = new Map(resumeEntries);

  const rows = linkedRows.map(({ recommendation, code, talent, talentLink, candidate, candidateLink, jd }) => ({
    candidateCode: code,
    owner: recommendation.column || ownerFromCode(code),
    recommendationId: recommendation.id,
    recommendationSource: recommendation.source || 'intake',
    repushSourceId: recommendation.repushSourceId || null,
    recommendedAt: recommendation.uploadedAt || null,
    recommendedJob: recommendation.jdTitle || '',
    recommendedOrganization: recommendation.organization || candidate?.organization || jd?.organization || '',
    recommendedDepartment: recommendation.department || candidate?.department || jd?.department || '',
    recommendationFeedback: recommendation.feedback || 'pending',
    interviewStatus: recommendation.interviewStatus || 'none',
    interviewRound: recommendation.interviewRound || candidate?.interviewRound || '',
    offerAppliedAt: recommendation.offerAppliedAt || candidate?.offerAppliedAt || null,
    talentId: talent?.id || null,
    talentLink,
    talentJobTitle: talent?.jobTitle || '',
    talentCategories: Array.isArray(talent?.categories) ? talent.categories : [],
    talentArchived: Boolean(talent?.archived),
    candidateId: candidate?.id || null,
    candidateLink,
    candidateStatus: buildCandidateStatus(candidate),
    interviewAt: candidate?.interviewDate || recommendation.interviewAt || null,
    outcome: candidate?.outcome || null,
    outcomeReason: candidate?.outcomeReason || null,
    score: candidate?.score ?? null,
    hasResumeText: Boolean(talent?.id && resumeTextByTalentId.get(talent.id)),
    resumeText: talent?.id ? (resumeTextByTalentId.get(talent.id) || '') : '',
  }));

  const byCode = new Map();
  for (const row of rows) {
    const bucket = byCode.get(row.candidateCode) || [];
    bucket.push(row);
    byCode.set(row.candidateCode, bucket);
  }

  const cases = [...byCode.entries()].map(([candidateCode, caseRows]) => {
    const withResume = caseRows.find((row) => row.hasResumeText);
    const exactTalentLinks = caseRows.filter((row) => ['talentId', 'candidateCode'].includes(row.talentLink)).length;
    const exactCandidateLinks = caseRows.filter((row) => ['candidateId', 'talentId+job'].includes(row.candidateLink)).length;
    const statuses = [...new Set(caseRows.map((row) => row.candidateStatus).filter((value) => value !== 'none'))];
    const jobs = [...new Set(caseRows.map((row) => row.recommendedJob).filter(Boolean))];
    const priority = (withResume ? 40 : 0)
      + Math.min(caseRows.length, 5) * 5
      + Math.min(exactTalentLinks, 3) * 4
      + Math.min(exactCandidateLinks, 3) * 5
      + (caseRows.some((row) => row.recommendationSource === 'repush') ? 12 : 0)
      + (statuses.some((status) => ['failed', 'withdrawn', 'onboarded', 'offer'].includes(status)) ? 15 : 0)
      + (jobs.length > 1 ? 10 : 0);
    return {
      candidateCode,
      owner: caseRows[0].owner,
      recommendationCount: caseRows.length,
      repushCount: caseRows.filter((row) => row.recommendationSource === 'repush').length,
      jobs,
      statuses,
      categories: [...new Set(caseRows.flatMap((row) => row.talentCategories))],
      hasResumeText: Boolean(withResume),
      priority,
      rows: caseRows,
    };
  }).sort((a, b) => b.priority - a.priority || b.recommendationCount - a.recommendationCount);

  const selectedCases = cases.filter((item) => item.hasResumeText).slice(0, 150);
  const selectedRows = selectedCases.flatMap((item) => item.rows);
  const summary = {
    generatedAt: new Date().toISOString(),
    sourceCounts: {
      talents: talents.length,
      recommendations: recommendations.length,
      candidates: candidates.length,
      jds: jds.length,
    },
    codedRecommendations: codedRecommendations.length,
    codedCandidates: cases.length,
    linkedTalent: rows.filter((row) => row.talentId).length,
    linkedTalentExact: rows.filter((row) => ['talentId', 'candidateCode'].includes(row.talentLink)).length,
    linkedCandidate: rows.filter((row) => row.candidateId).length,
    linkedCandidateExact: rows.filter((row) => ['candidateId', 'talentId+job'].includes(row.candidateLink)).length,
    rowsWithResumeText: rows.filter((row) => row.hasResumeText).length,
    selectedCases: selectedCases.length,
    selectedRecommendationRows: selectedRows.length,
    selectedRepushRows: selectedRows.filter((row) => row.recommendationSource === 'repush').length,
    selectedStatusCounts: countBy(selectedRows.map((row) => row.candidateStatus)),
    selectedCategoryCounts: countBy(selectedCases.flatMap((item) => item.categories)),
  };

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const datasetPath = path.join(OUTPUT_DIR, `matching-evidence-${RUN_DATE}.json`);
  const csvPath = path.join(OUTPUT_DIR, `matching-evidence-${RUN_DATE}.csv`);
  const reportPath = path.join(OUTPUT_DIR, `matching-evidence-${RUN_DATE}.md`);
  await fs.writeFile(datasetPath, JSON.stringify({ summary, cases: selectedCases }, null, 2), 'utf8');

  const csvHeaders = [
    'candidateCode', 'owner', 'recommendedAt', 'recommendationSource', 'recommendedJob',
    'recommendedOrganization', 'recommendedDepartment', 'candidateStatus', 'interviewRound',
    'outcome', 'outcomeReason', 'talentLink', 'candidateLink', 'talentJobTitle', 'talentCategories',
  ];
  const csvRows = selectedRows.map((row) => csvHeaders.map((key) => csvEscape(
    key === 'talentCategories' ? row.talentCategories.join('|') : row[key],
  )).join(','));
  await fs.writeFile(csvPath, `\uFEFF${csvHeaders.join(',')}\r\n${csvRows.join('\r\n')}\r\n`, 'utf8');

  const md = `# 匹配证据抽取报告（${RUN_DATE}）

## 数据覆盖

- 推荐记录：${summary.sourceCounts.recommendations} 条，其中带候选人编码 ${summary.codedRecommendations} 条
- 编码候选人：${summary.codedCandidates} 位
- 已关联人才库：${summary.linkedTalent} 条（精确关联 ${summary.linkedTalentExact} 条）
- 已关联面试日历：${summary.linkedCandidate} 条（精确关联 ${summary.linkedCandidateExact} 条）
- 有可分析简历正文：${summary.rowsWithResumeText} 条

## 本轮审计样本

- 候选人：${summary.selectedCases} 位
- 推荐岗位关系：${summary.selectedRecommendationRows} 条
- 其中复推：${summary.selectedRepushRows} 条
- 面试/结果分布：${Object.entries(summary.selectedStatusCounts).map(([key, value]) => `${key} ${value}`).join('、') || '暂无'}
- 主要简历分类：${Object.entries(summary.selectedCategoryCounts).slice(0, 12).map(([key, value]) => `${key} ${value}`).join('、') || '暂无'}

## 使用说明

1. JSON 文件包含本轮本地审计所需的简历正文，不应提交到 Git 或发送到外部服务。
2. CSV 文件不含简历正文，可用于人工核对“候选人编码—岗位—部门—面试结果”。
3. 优先级按“有正文、精确关联、复推、多岗位、明确结果”综合排序，不代表候选人质量分。
`;
  await fs.writeFile(reportPath, md, 'utf8');

  console.log(JSON.stringify({ summary, files: { datasetPath, csvPath, reportPath } }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
