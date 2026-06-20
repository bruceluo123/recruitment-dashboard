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
 * 判断一行是否为「维度标题」（如 "1. 公司基本盘："）。
 * 关键：必须把维度标题和「信息源」下的编号列表项（"1. 标题 - https://..."）区分开，
 * 否则源行会被当成维度 1/2/... 覆盖掉真正的维度正文。
 * 规则：顶格（最多 2 个前导空格）、编号 1..11、且本行不含 URL。
 */
function matchDimHeader(line: string): { key: number; rest: string } | null {
  if (/https?:\/\//.test(line)) return null; // 带链接 → 是信息源行，不是维度标题
  const m = line.match(/^[ \t]{0,2}(1[01]|[1-9])[.)、]\s*(.*)$/);
  if (!m) return null;
  const key = Number(m[1]);
  if (key < 1 || key > 11) return null;
  return { key, rest: m[2].trim() };
}

/**
 * 解析 Gemini 按 skill 格式产出的纯文本，拆成结构化的 11 维 + 头部字段。
 * 头部支持「行业：」「方向：」「一句话：/备注：」；正文按「N. 维度名」逐行分组，
 * 「信息源」之后的行解析为 sources（编号列表项不会被误判为维度）。
 * 容错：缺失维度补「未找到公开信息」。
 */
export function parseResearchText(name: string, text: string): CompanyResearchDraft {
  const lines = text.replace(/\r\n/g, '\n').split('\n');

  let industry: string | undefined;
  let summary: string | undefined;
  let categories: JDCategory[] = [];

  // 找到第一个维度标题的位置，之前都视作头部
  let firstDimIdx = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (matchDimHeader(lines[i])) { firstDimIdx = i; break; }
  }

  for (let i = 0; i < firstDimIdx; i++) {
    const l = lines[i].trim();
    const indM = l.match(/^行业[:：]\s*(.+)$/);
    if (indM) industry = indM[1].trim();
    const dirM = l.match(/^(?:方向|分类)[:：]\s*(.+)$/);
    if (dirM) categories = coerceCategories(dirM[1]);
    const sumM = l.match(/^(?:一句话|概述|备注)[:：]\s*(.+)$/);
    if (sumM) summary = sumM[1].trim();
  }

  // 逐行分组：维度标题开启新组；组内遇到「信息源」后切到 sources 模式
  interface Group { body: string[]; sources: CompanySource[] }
  const parsedByKey = new Map<number, Group>();
  let cur: Group | null = null;
  let inSrc = false;

  for (let i = firstDimIdx; i < lines.length; i++) {
    const line = lines[i];
    const header = matchDimHeader(line);
    if (header) {
      cur = { body: [], sources: [] };
      parsedByKey.set(header.key, cur);
      inSrc = false;
      if (header.rest && !/信息源/.test(header.rest)) cur.body.push(header.rest);
      continue;
    }
    if (!cur) continue;

    if (/信息源/.test(line)) {
      inSrc = true;
      const inline = line.replace(/^.*信息源[:：]?/, '').trim();
      const p = inline ? parseSourceLine(inline) : null;
      if (p) cur.sources.push(p);
      continue;
    }

    if (inSrc) {
      const p = parseSourceLine(line);
      if (p) cur.sources.push(p);
    } else {
      cur.body.push(line);
    }
  }

  const dims = emptyDimensions().map((d) => {
    const got = parsedByKey.get(d.key);
    const body = got ? got.body.join('\n').replace(/\n{3,}/g, '\n\n').trim() : '';
    return {
      key: d.key,
      title: d.title,
      body: body || '未找到公开信息',
      sources: got ? got.sources.slice(0, 5) : [],
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
