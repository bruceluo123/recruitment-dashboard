import type { Company, CompanySource } from '@/types/company';
import { COMPANY_DIMENSION_TITLES, emptyDimensions } from '@/types/company';
import type { JDCategory } from '@/types/jd';
import { ALL_CATEGORIES } from '@/types/jd';

/** 调研结果：可直接 upsert 进公司库的结构化字段（不含 id/时间戳） */
export type CompanyResearchDraft = Pick<
  Company,
  'name' | 'industry' | 'categories' | 'summary' | 'dims'
>;

const VALID_CATEGORIES = new Set<string>(ALL_CATEGORIES);

/** 清掉行首的树状符号、列表序号、竖线缩进，便于解析 */
function stripBullet(line: string): string {
  return line
    .replace(/^[\s│|]*[├└]──\s*/, '')
    .replace(/^[\s│|]+/, '')
    .replace(/^\d+[.)、]\s*/, '')
    .trim();
}

/** 解析单行信息源「标题 - https://...」或裸 URL */
function parseSourceLine(line: string): CompanySource | null {
  const clean = stripBullet(line);
  if (!clean) return null;
  const m = clean.match(/^(.*?)\s*[-—:：]\s*(https?:\/\/\S+)\s*$/);
  if (m) return { title: m[1].trim() || m[2].trim(), url: m[2].trim() };
  const u = clean.match(/https?:\/\/\S+/);
  if (u) return { title: clean.replace(u[0], '').replace(/[-—:：\s]+$/, '').trim() || u[0], url: u[0] };
  return null;
}

function coerceCategories(raw: string): JDCategory[] {
  return raw
    .split(/[,，、\s/]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is JDCategory => VALID_CATEGORIES.has(s))
    .slice(0, 3);
}

/**
 * 解析 Gemini 按 skill 格式产出的纯文本，拆成结构化的 11 维 + 头部字段。
 * 头部支持「行业：」「方向：」「一句话：/备注：」；正文按「N. 维度名」分块，
 * 每块内「信息源」之后的行解析为 sources。容错：缺失维度补「未找到公开信息」。
 */
export function parseResearchText(name: string, text: string): CompanyResearchDraft {
  const lines = text.replace(/\r\n/g, '\n').split('\n');

  let industry: string | undefined;
  let summary: string | undefined;
  let categories: JDCategory[] = [];

  // 头部：在第一个维度标题出现前，提取 行业/方向/一句话
  let bodyStart = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (/^\s*1[.)、]\s*公司基本盘/.test(lines[i]) || /^\s*1[.)、]\s/.test(lines[i])) { bodyStart = i; break; }
    const indM = l.match(/^行业[:：]\s*(.+)$/);
    if (indM) industry = indM[1].trim();
    const dirM = l.match(/^(?:方向|分类)[:：]\s*(.+)$/);
    if (dirM) categories = coerceCategories(dirM[1]);
    const sumM = l.match(/^(?:一句话|概述|备注)[:：]\s*(.+)$/);
    if (sumM) summary = sumM[1].trim();
    bodyStart = i + 1;
  }

  const bodyText = lines.slice(bodyStart).join('\n');

  // 按「N. 」行切块（1..11）
  const chunks = bodyText.split(/\n(?=\s*(?:1[01]|[1-9])[.)、]\s)/);

  const base = emptyDimensions();
  const parsedByKey = new Map<number, { body: string; sources: CompanySource[] }>();

  for (const chunk of chunks) {
    const cl = chunk.split('\n');
    const headerIdx = cl.findIndex((l) => /^\s*(?:1[01]|[1-9])[.)、]\s/.test(l));
    if (headerIdx === -1) continue;
    const keyM = cl[headerIdx].match(/^\s*(\d+)[.)、]/);
    const key = keyM ? Number(keyM[1]) : NaN;
    if (!Number.isInteger(key) || key < 1 || key > 11) continue;

    const after = cl.slice(headerIdx + 1);
    const srcIdx = after.findIndex((l) => /信息源/.test(l));
    const bodyLines = srcIdx === -1 ? after : after.slice(0, srcIdx);
    const body = bodyLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();

    const sources: CompanySource[] = [];
    if (srcIdx !== -1) {
      // 同行可能是 "└── 信息源：标题 - url"，先尝试解析该行剩余
      const firstSrcInline = after[srcIdx].replace(/.*信息源[:：]?/, '').trim();
      const firstParsed = firstSrcInline ? parseSourceLine(firstSrcInline) : null;
      if (firstParsed) sources.push(firstParsed);
      for (const l of after.slice(srcIdx + 1)) {
        const p = parseSourceLine(l);
        if (p) sources.push(p);
      }
    }
    parsedByKey.set(key, { body, sources: sources.slice(0, 5) });
  }

  const dims = base.map((d) => {
    const got = parsedByKey.get(d.key);
    return {
      key: d.key,
      title: d.title,
      body: got && got.body ? got.body : '未找到公开信息',
      sources: got ? got.sources : [],
    };
  });

  return {
    name: name.trim(),
    industry,
    categories,
    summary,
    dims,
  };
}

/** 11 维标题编号列表，供 prompt 固定口径 */
export const DIMENSION_NUMBERED = COMPANY_DIMENSION_TITLES.map((t, i) => `${i + 1}. ${t}`).join('\n');

/**
 * 客户端调用：把公司名交给服务端 /api/company/research（Gemini 联网调研），
 * 返回可直接 upsert 的结构化草稿。
 */
export async function researchCompany(name: string, signal?: AbortSignal): Promise<CompanyResearchDraft> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('请输入公司名');

  const response = await fetch('/api/company/research', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: trimmed }),
    signal,
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
    throw new Error(err.error || `调研失败 ${response.status}`);
  }

  const data = await response.json();
  if (data.error) throw new Error(data.error);
  if (!data.draft) throw new Error('调研返回为空，请重试');
  return data.draft as CompanyResearchDraft;
}
