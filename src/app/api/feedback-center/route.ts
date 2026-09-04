import { NextRequest, NextResponse } from 'next/server';
import { kvGetRaw, kvSetRaw } from '@/lib/kv-server';
import type {
  FeedbackCenterState,
  FeedbackConfirmedStatus,
  FeedbackTimelineEvent,
} from '@/types/feedback-center';

export const dynamic = 'force-dynamic';

const KEY = 'recruit:feedback-inbox';
const EMPTY_STATE: FeedbackCenterState = { version: 1, generatedAt: '', items: [] };
const STATE_CACHE_MS = 30_000;
let stateCache: { expiresAt: number; state: FeedbackCenterState } | null = null;
const VALID_STATUSES = new Set<FeedbackConfirmedStatus>([
  'pending',
  'screening_failed',
  'interview_pending',
  'interview_passed',
  'interview_failed',
  'closed',
]);

async function readState(force = false): Promise<FeedbackCenterState> {
  if (!force && stateCache && stateCache.expiresAt > Date.now()) return stateCache.state;
  const raw = await kvGetRaw(KEY);
  if (!raw) return EMPTY_STATE;
  try {
    const parsed = JSON.parse(raw) as FeedbackCenterState;
    const state = parsed?.version === 1 && Array.isArray(parsed.items) ? parsed : EMPTY_STATE;
    stateCache = { expiresAt: Date.now() + STATE_CACHE_MS, state };
    return state;
  } catch {
    return EMPTY_STATE;
  }
}

function recentDateKeys(days: number): Set<string> {
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
  now.setUTCHours(0, 0, 0, 0);
  return new Set(Array.from({ length: days }, (_, index) => {
    const date = new Date(now);
    date.setUTCDate(now.getUTCDate() - index);
    return date.toISOString().slice(0, 10);
  }));
}

function belongsToOwner(item: FeedbackCenterState['items'][number], owner: 'a' | 'b'): boolean {
  if (item.owner !== owner) return false;
  const code = String(item.candidateCode || '').trim().toUpperCase();
  if (owner === 'a' && code.startsWith('XYBB')) return false;
  if (owner === 'b' && code.startsWith('XYMMF')) return false;
  return true;
}

function summaryItem(item: FeedbackCenterState['items'][number]) {
  const { sourceSummary, sourceEvidence, timeline, ...summary } = item;
  void sourceSummary;
  void sourceEvidence;
  void timeline;
  return { ...summary, timeline: [] };
}

function eventId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const ownerParam = params.get('owner');
  const owner = ownerParam === 'a' || ownerParam === 'b' ? ownerParam : null;
  const detail = params.get('detail') === '1';
  const force = params.get('refresh') === '1';
  const days = Math.min(31, Math.max(1, Number.parseInt(params.get('days') || '7', 10) || 7));
  const ids = new Set(params.getAll('id').map((id) => id.trim()).filter(Boolean));
  const state = await readState(force);

  if (!owner) {
    return NextResponse.json({ ok: true, ...state }, { headers: { 'Cache-Control': 'no-store' } });
  }

  const dateKeys = recentDateKeys(days);
  const items = state.items
    .filter((item) => belongsToOwner(item, owner))
    .filter((item) => dateKeys.has(String(item.recommendedAt || '').slice(0, 10)))
    .filter((item) => ids.size === 0 || ids.has(item.id))
    .map((item) => detail ? item : summaryItem(item));

  return NextResponse.json(
    { ok: true, version: 1, generatedAt: state.generatedAt, items },
    { headers: { 'Cache-Control': force || detail ? 'no-store' : 'private, max-age=30, stale-while-revalidate=120' } },
  );
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json() as {
      id?: string;
      owner?: 'a' | 'b';
      action?: 'follow_up' | 'status_update' | 'repush' | 'close';
      status?: FeedbackConfirmedStatus;
      note?: string;
    };
    const id = String(body.id || '').trim();
    if (!id || !body.action) {
      return NextResponse.json({ ok: false, error: '缺少反馈记录或操作类型' }, { status: 400 });
    }
    if (body.action === 'status_update' && (!body.status || !VALID_STATUSES.has(body.status))) {
      return NextResponse.json({ ok: false, error: '反馈状态无效' }, { status: 400 });
    }

    const state = await readState();
    const index = state.items.findIndex((item) => item.id === id);
    if (index < 0) {
      return NextResponse.json({ ok: false, error: '反馈记录不存在，请刷新后重试' }, { status: 404 });
    }

    const now = new Date().toISOString();
    const current = state.items[index];
    if (body.owner && current.owner !== body.owner) {
      return NextResponse.json({ ok: false, error: '反馈记录不属于当前推荐人' }, { status: 403 });
    }
    const event: FeedbackTimelineEvent = {
      id: eventId(),
      type: body.action,
      at: now,
      note: String(body.note || '').trim() || undefined,
      status: body.action === 'status_update'
        ? body.status
        : body.action === 'close'
          ? 'closed'
          : undefined,
    };
    const confirmedStatus: FeedbackConfirmedStatus | undefined = body.action === 'status_update'
      ? body.status
      : body.action === 'close'
        ? 'closed'
        : current.confirmedStatus;
    const next = {
      ...current,
      confirmedStatus,
      followUpCount: body.action === 'follow_up'
        ? (current.followUpCount || 0) + 1
        : current.followUpCount || 0,
      lastFollowUpAt: body.action === 'follow_up' ? now : current.lastFollowUpAt,
      repushReady: body.action === 'repush' ? true : current.repushReady,
      timeline: [...(current.timeline || []), event].slice(-30),
      updatedAt: now,
    };
    state.items[index] = next;
    state.generatedAt = state.generatedAt || now;
    const saved = await kvSetRaw(KEY, JSON.stringify(state));
    if (!saved) {
      return NextResponse.json({ ok: false, error: '反馈状态保存失败' }, { status: 503 });
    }
    stateCache = { expiresAt: Date.now() + STATE_CACHE_MS, state };
    return NextResponse.json({ ok: true, item: next });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : '更新反馈失败',
    }, { status: 500 });
  }
}
