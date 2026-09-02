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
const VALID_STATUSES = new Set<FeedbackConfirmedStatus>([
  'pending',
  'screening_failed',
  'interview_pending',
  'interview_passed',
  'interview_failed',
  'closed',
]);

async function readState(): Promise<FeedbackCenterState> {
  const raw = await kvGetRaw(KEY);
  if (!raw) return EMPTY_STATE;
  try {
    const parsed = JSON.parse(raw) as FeedbackCenterState;
    return parsed?.version === 1 && Array.isArray(parsed.items) ? parsed : EMPTY_STATE;
  } catch {
    return EMPTY_STATE;
  }
}

function eventId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export async function GET() {
  const state = await readState();
  return NextResponse.json({ ok: true, ...state }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json() as {
      id?: string;
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
    return NextResponse.json({ ok: true, item: next });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : '更新反馈失败',
    }, { status: 500 });
  }
}
