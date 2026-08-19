import { NextRequest, NextResponse } from 'next/server';
import { guardApi } from '@/lib/api-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';
const TARGET_COUNT = 16;

interface SmartJob {
  id: string;
  title: string;
  categories: string[];
  priority?: string;
  gap?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  department?: string;
  organization?: string;
  salary?: string;
}

interface SmartSelection {
  maimanfen: string[];
  bobo: string[];
  reasons?: string[];
}

function parseGap(value?: string): number {
  const match = String(value || '').match(/\d+/);
  return match ? Number.parseInt(match[0], 10) : 0;
}

function ageDays(value?: string): number {
  if (!value) return 999;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? Math.max(0, (Date.now() - time) / 86_400_000) : 999;
}

function jobScore(job: SmartJob): number {
  const categories = job.categories || [];
  const createdDays = ageDays(job.createdAt);
  const updatedDays = ageDays(job.updatedAt);
  let score = 0;
  if (createdDays <= 2) score += 42;
  else if (createdDays <= 7) score += 30;
  else if (createdDays <= 14) score += 12;
  if (updatedDays <= 3) score += 9;
  if (job.priority === 'P0') score += 34;
  else if (job.priority === 'P1') score += 25;
  else if (job.priority === 'P2') score += 10;
  if (job.status === 'urgent') score += 16;
  else if (job.status === 'active') score += 5;
  score += Math.min(24, parseGap(job.gap) * 4);
  if (categories.includes('operations')) score += 18;
  if (categories.includes('backend')) score += 16;
  if (categories.includes('frontend')) score += 14;
  if (categories.includes('ai')) score += 8;
  if (/运营|后端|前端|golang|\bgo\b|flutter|测试/i.test(job.title)) score += 6;
  return score;
}

function uniqueValid(ids: unknown, valid: Set<string>): string[] {
  if (!Array.isArray(ids)) return [];
  return Array.from(new Set(ids.map(String).filter((id) => valid.has(id))));
}

function fallbackSelection(jobs: SmartJob[]): SmartSelection {
  const ranked = [...jobs].sort((a, b) => jobScore(b) - jobScore(a));
  const common = ranked.slice(0, Math.min(3, ranked.length));
  const rest = ranked.slice(common.length);
  const maimanfen = [...common];
  const bobo = [...common];
  for (let index = 0; index < rest.length && (maimanfen.length < TARGET_COUNT || bobo.length < TARGET_COUNT); index += 1) {
    const target = index % 2 === 0 ? maimanfen : bobo;
    const other = index % 2 === 0 ? bobo : maimanfen;
    if (target.length < TARGET_COUNT) target.push(rest[index]);
    else if (other.length < TARGET_COUNT) other.push(rest[index]);
  }
  return {
    maimanfen: maimanfen.map((job) => job.id),
    bobo: bobo.map((job) => job.id),
    reasons: ['优先本周新增与高优先级岗位', '主推运营、后端和前端岗位', '两版仅保留少量高复推价值岗位重合'],
  };
}

function parseModelJson(content: string): unknown {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('AI 未返回有效选岗结果');
  return JSON.parse(trimmed.slice(start, end + 1));
}

export async function POST(request: NextRequest) {
  const blocked = guardApi(request, 'hot-hiring-recommend', 8, 60_000);
  if (blocked) return blocked;

  let body: { jobs?: SmartJob[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: '请求格式错误' }, { status: 400 });
  }

  const jobs = (Array.isArray(body.jobs) ? body.jobs : [])
    .filter((job) => job?.id && job?.title && job.status !== 'paused')
    .slice(0, 500);
  if (!jobs.length) return NextResponse.json({ ok: false, error: '当前没有可推荐的活跃岗位' }, { status: 400 });

  const ranked = [...jobs].sort((a, b) => jobScore(b) - jobScore(a)).slice(0, 90);
  const fallback = fallbackSelection(ranked);
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return NextResponse.json({ ok: true, source: 'rules', ...fallback });

  const compactJobs = ranked.map((job) => ({
    id: job.id,
    title: job.title,
    category: job.categories?.join(','),
    priority: job.priority || '',
    gap: parseGap(job.gap),
    status: job.status,
    createdDays: Math.round(ageDays(job.createdAt)),
    updatedDays: Math.round(ageDays(job.updatedAt)),
    department: job.department || job.organization || '',
    salary: job.salary || '',
    baseScore: jobScore(job),
  }));

  const prompt = `你是猎头团队的每日广告选岗助手。请从候选岗位中分别为“麦满分”和“啵啵”选择今天最值得发布的岗位。
规则：
1. 每版选择 12-18 个，优先本周新增、P0/P1、缺口大、最近更新的岗位；新岗位可能较快关闭，应提高优先级。
2. 重点覆盖运营、后端、前端，并兼顾少量 AI、产品、测试等高价值岗位。
3. 两版只允许 2-4 个适合长期复推的岗位重合，其余岗位必须不同，避免两人广告高度雷同。
4. 同标题或高度相似岗位不要在同一版重复；选择要兼顾岗位吸引力和可投递人群广度。
5. 只返回 JSON，不要 markdown：{"maimanfen":["岗位id"],"bobo":["岗位id"],"reasons":["理由1","理由2","理由3"]}

候选岗位：${JSON.stringify(compactJobs)}`;

  try {
    const upstream = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.25,
        max_tokens: 1800,
        response_format: { type: 'json_object' },
      }),
    });
    if (!upstream.ok) throw new Error(`AI 请求失败：${upstream.status}`);
    const data = await upstream.json();
    const parsed = parseModelJson(data?.choices?.[0]?.message?.content || '') as Partial<SmartSelection>;
    const valid = new Set(ranked.map((job) => job.id));
    const maimanfen = uniqueValid(parsed.maimanfen, valid).slice(0, 18);
    const bobo = uniqueValid(parsed.bobo, valid).slice(0, 18);
    if (maimanfen.length < 8 || bobo.length < 8) throw new Error('AI 选岗数量不足');
    return NextResponse.json({
      ok: true,
      source: 'ai',
      maimanfen,
      bobo,
      reasons: Array.isArray(parsed.reasons) ? parsed.reasons.map(String).slice(0, 4) : fallback.reasons,
    });
  } catch {
    return NextResponse.json({ ok: true, source: 'rules', ...fallback });
  }
}
