import { NextRequest, NextResponse } from 'next/server';
import { guardApi } from '@/lib/api-guard';
import { kvGet } from '@/lib/kv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CONTACT_INDEX_KEY = 'recruit:tg-robin-contact-index';
const STATE_KEY = 'recruit:tg-robin-intake-state';

interface RobinContactRecord {
  candidate?: string;
  jobTitle?: string;
  username?: string;
  sender?: string;
  templateDate?: string;
}

interface RobinContactIndex {
  updatedAt?: string;
  items?: RobinContactRecord[];
  recentDetected?: RobinContactRecord[];
}

function parseCache(value: RobinContactIndex | string | null): RobinContactIndex | null {
  if (!value) return null;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value) as RobinContactIndex; } catch { return null; }
}

function normalize(value: string | undefined) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '');
}

function jobTokens(value: string | undefined) {
  return Array.from(new Set(String(value || '')
    .toLowerCase()
    .replace(/[()（）/,+_-]/g, ' ')
    .split(/\s+/)
    .map((token) => token.replace(/工程师|开发|高级|中级|初级|专家|方向/g, ''))
    .filter((token) => token.length >= 2)));
}

function jobSimilarity(left: string | undefined, right: string | undefined) {
  const a = jobTokens(left);
  const b = jobTokens(right);
  if (!a.length || !b.length) return 0;
  let overlap = 0;
  for (const token of a) {
    if (b.some((other) => token.includes(other) || other.includes(token))) overlap += 1;
  }
  return overlap / Math.max(a.length, b.length);
}

function scoreRecord(record: RobinContactRecord, candidateName: string, jobTitle: string) {
  const queryName = normalize(candidateName);
  const recordName = normalize(record.candidate);
  if (!queryName || !recordName) return 0;

  let score = 0;
  if (queryName === recordName) score += 100;
  else if (queryName.length >= 2 && recordName.length >= 2 && (queryName.includes(recordName) || recordName.includes(queryName))) score += 65;
  else return 0;

  const queryJob = normalize(jobTitle);
  const recordJob = normalize(record.jobTitle);
  if (queryJob && recordJob) {
    if (queryJob === recordJob) score += 35;
    else if (queryJob.includes(recordJob) || recordJob.includes(queryJob)) score += 22;
    else score += Math.round(jobSimilarity(jobTitle, record.jobTitle) * 18);
  }
  return score;
}

function loadMatches(records: RobinContactRecord[], candidateName: string, jobTitle: string) {
  const byUsername = new Map<string, { record: RobinContactRecord; score: number }>();
  for (const record of records) {
    const username = String(record.username || '').replace(/^@/, '').toLowerCase();
    if (!username) continue;
    const score = scoreRecord(record, candidateName, jobTitle);
    if (score < 65) continue;
    const current = byUsername.get(username);
    if (!current || score > current.score || (score === current.score && String(record.templateDate || '') > String(current.record.templateDate || ''))) {
      byUsername.set(username, { record, score });
    }
  }

  return Array.from(byUsername.entries())
    .map(([username, match]) => ({
      username: `@${username}`,
      sender: match.record.sender || '',
      candidate: match.record.candidate || '',
      jobTitle: match.record.jobTitle || '',
      templateDate: match.record.templateDate || '',
      score: match.score,
    }))
    .sort((a, b) => b.score - a.score || b.templateDate.localeCompare(a.templateDate));
}

function resolveContact(records: RobinContactRecord[], candidateName: string, jobTitle: string) {
  const matches = loadMatches(records, candidateName, jobTitle);
  if (!matches.length) return { status: 'not_found' as const };
  if (matches.length > 1 && matches[0].score - matches[1].score < 15) {
    return { status: 'ambiguous' as const, matches: matches.slice(0, 5) };
  }
  return { status: 'found' as const, contact: matches[0].username, match: matches[0] };
}

async function loadContactRecords() {
  const [indexValue, stateValue] = await Promise.all([
    kvGet<RobinContactIndex | string>(CONTACT_INDEX_KEY),
    kvGet<RobinContactIndex | string>(STATE_KEY),
  ]);
  const index = parseCache(indexValue);
  const state = parseCache(stateValue);
  const records = [...(index?.items || []), ...(state?.recentDetected || [])]
    .filter((record) => record.username && record.candidate);
  return { records, updatedAt: index?.updatedAt || state?.updatedAt || '' };
}

export async function GET(request: NextRequest) {
  const blocked = guardApi(request, 'tg-robin-contact', 30, 60_000);
  if (blocked) return blocked;

  const candidateName = request.nextUrl.searchParams.get('name')?.trim() || '';
  const jobTitle = request.nextUrl.searchParams.get('job')?.trim() || '';
  if (!candidateName) {
    return NextResponse.json({ ok: false, status: 'missing_name', message: '缺少候选人姓名' }, { status: 400 });
  }

  const { records, updatedAt } = await loadContactRecords();
  const matches = loadMatches(records, candidateName, jobTitle);

  if (!matches.length) {
    return NextResponse.json({
      ok: true,
      status: 'not_found',
      message: 'Robin 私聊中暂未找到对应用户名',
      updatedAt,
    });
  }

  if (matches.length > 1 && matches[0].score - matches[1].score < 15) {
    return NextResponse.json({
      ok: true,
      status: 'ambiguous',
      message: '找到多个同名私聊，请手动确认用户名',
      matches: matches.slice(0, 5),
    });
  }

  return NextResponse.json({ ok: true, status: 'found', contact: matches[0].username, match: matches[0] });
}

export async function POST(request: NextRequest) {
  const blocked = guardApi(request, 'tg-robin-contact-bulk', 12, 60_000);
  if (blocked) return blocked;

  let body: { candidates?: Array<{ key?: string; name?: string; job?: string }> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: 'Invalid request body' }, { status: 400 });
  }

  const candidates = Array.isArray(body.candidates) ? body.candidates.slice(0, 300) : [];
  if (!candidates.length) {
    return NextResponse.json({ ok: false, message: 'Missing candidates' }, { status: 400 });
  }

  const { records, updatedAt } = await loadContactRecords();
  const results = candidates.map((candidate) => {
    const key = String(candidate.key || '');
    const name = String(candidate.name || '').trim();
    const job = String(candidate.job || '').trim();
    if (!name) return { key, status: 'missing_name' as const };
    return { key, ...resolveContact(records, name, job) };
  });

  return NextResponse.json({ ok: true, updatedAt, results });
}
