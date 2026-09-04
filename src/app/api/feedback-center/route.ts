import { NextRequest, NextResponse } from 'next/server';
import { kvGetRaw, kvSetRaw } from '@/lib/kv-server';
import type {
  FeedbackCenterState,
  FeedbackConfirmedStatus,
  FeedbackTimelineEvent,
} from '@/types/feedback-center';

export const dynamic = 'force-dynamic';

const KEY = 'recruit:feedback-inbox';
const EMPTY_STATE: FeedbackCenterState = { version: 1, generatedAt: '', items: [], ledger: [] };
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

interface RecommendationRecord {
  id: string;
  column: 'a' | 'b';
  candidateCode?: string;
  candidateName?: string;
  jdTitle?: string;
  organization?: string;
  department?: string;
  contactPerson?: string;
  uploadedAt?: string;
}

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
  if (item.sourceStatus === 'manual_review') return true;
  const code = String(item.candidateCode || '').trim().toUpperCase();
  if (owner === 'a' && code.startsWith('XYBB')) return false;
  if (owner === 'b' && code.startsWith('XYMMF')) return false;
  return true;
}

function summaryItem(item: FeedbackCenterState['items'][number]) {
  if (item.sourceStatus === 'manual_review') return { ...item, timeline: [] };
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
  const ledger = params.get('ledger') === '1';
  const force = params.get('refresh') === '1';
  const days = Math.min(31, Math.max(1, Number.parseInt(params.get('days') || '7', 10) || 7));
  const ids = new Set(params.getAll('id').map((id) => id.trim()).filter(Boolean));
  const state = await readState(force);

  if (!owner) {
    return NextResponse.json({ ok: true, ...state }, { headers: { 'Cache-Control': 'no-store' } });
  }

  const dateKeys = recentDateKeys(days);
  if (ledger) {
    const entries = (state.ledger || [])
      .filter((item) => item.owner === owner)
      .filter((item) => dateKeys.has(String(item.sentAt || '').slice(0, 10)))
      .sort((a, b) => String(b.sentAt).localeCompare(String(a.sentAt)));
    return NextResponse.json(
      { ok: true, version: 1, generatedAt: state.generatedAt, items: [], ledger: entries },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const items = state.items
    .filter((item) => belongsToOwner(item, owner))
    .filter((item) => dateKeys.has(String(item.recommendedAt || item.feedbackAt || '').slice(0, 10)))
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
      action?: 'follow_up' | 'status_update' | 'repush' | 'close' | 'resolve_review' | 'flag_ledger';
      status?: FeedbackConfirmedStatus;
      note?: string;
      recommendationId?: string;
    };
    const id = String(body.id || '').trim();
    if (!id || !body.action) {
      return NextResponse.json({ ok: false, error: '缺少反馈记录或操作类型' }, { status: 400 });
    }
    if ((body.action === 'status_update' || body.action === 'resolve_review')
      && (!body.status || !VALID_STATUSES.has(body.status))) {
      return NextResponse.json({ ok: false, error: '反馈状态无效' }, { status: 400 });
    }

    const state = await readState();
    if (body.action === 'flag_ledger') {
      const ledgerIndex = (state.ledger || []).findIndex((item) => (
        item.id === id && (!body.owner || item.owner === body.owner)
      ));
      if (ledgerIndex < 0) {
        return NextResponse.json({ ok: false, error: '消息台账记录不存在' }, { status: 404 });
      }
      const now = new Date().toISOString();
      const ledgerItem = state.ledger![ledgerIndex];
      const reviewId = `${ledgerItem.owner}:manual_review:tg:${ledgerItem.telegramMessageId}:manual`;
      const reviewItem: FeedbackCenterState['items'][number] = {
        id: reviewId,
        owner: ledgerItem.owner,
        candidateName: '待确认',
        jobTitle: '岗位待确认',
        feedbackAt: ledgerItem.sentAt,
        sourceStatus: 'manual_review',
        sourceSummary: ledgerItem.preview,
        auditConclusion: '从逐消息台账手动标记，等待关联候选人和岗位',
        telegramMessageId: ledgerItem.telegramMessageId,
        followUpCount: 0,
        timeline: [],
        updatedAt: now,
      };
      const existingReviewIndex = state.items.findIndex((item) => item.id === reviewId && item.owner === ledgerItem.owner);
      if (existingReviewIndex >= 0) state.items[existingReviewIndex] = reviewItem;
      else state.items.push(reviewItem);
      state.ledger![ledgerIndex] = { ...ledgerItem, status: 'manual_review', note: '已手动转入人工核对' };
      state.generatedAt = state.generatedAt || now;
      const saved = await kvSetRaw(KEY, JSON.stringify(state));
      if (!saved) return NextResponse.json({ ok: false, error: '消息台账更新失败' }, { status: 503 });
      stateCache = { expiresAt: Date.now() + STATE_CACHE_MS, state };
      return NextResponse.json({ ok: true, item: reviewItem, ledgerItem: state.ledger![ledgerIndex] });
    }
    const index = state.items.findIndex((item) => item.id === id && (!body.owner || item.owner === body.owner));
    if (index < 0) {
      return NextResponse.json({ ok: false, error: '反馈记录不存在，请刷新后重试' }, { status: 404 });
    }

    const now = new Date().toISOString();
    const current = state.items[index];
    if (body.owner && current.owner !== body.owner) {
      return NextResponse.json({ ok: false, error: '反馈记录不属于当前推荐人' }, { status: 403 });
    }
    let resolvedRecommendation: RecommendationRecord | null = null;
    if (body.action === 'resolve_review') {
      const recommendationId = String(body.recommendationId || '').trim();
      const recommendationsRaw = await kvGetRaw('recruit:repush');
      const recommendations = recommendationsRaw ? JSON.parse(recommendationsRaw) as RecommendationRecord[] : [];
      resolvedRecommendation = recommendations.find((item) => item?.id === recommendationId && item.column === current.owner) || null;
      if (!resolvedRecommendation) {
        return NextResponse.json({ ok: false, error: '未找到当前推荐人的对应岗位记录' }, { status: 400 });
      }
      const code = String(resolvedRecommendation.candidateCode || '').trim().toUpperCase();
      if ((current.owner === 'a' && code.startsWith('XYBB')) || (current.owner === 'b' && code.startsWith('XYMMF'))) {
        return NextResponse.json({ ok: false, error: '候选人编码与当前推荐人不一致' }, { status: 400 });
      }
    }
    const event: FeedbackTimelineEvent = {
      id: eventId(),
      type: body.action === 'resolve_review' ? 'manual_resolve' : body.action,
      at: now,
      note: String(body.note || '').trim() || undefined,
      status: body.action === 'status_update' || body.action === 'resolve_review'
        ? body.status
        : body.action === 'close'
          ? 'closed'
          : undefined,
    };
    const confirmedStatus: FeedbackConfirmedStatus | undefined = body.action === 'status_update' || body.action === 'resolve_review'
      ? body.status
      : body.action === 'close'
        ? 'closed'
        : current.confirmedStatus;
    const sourceStatus: FeedbackCenterState['items'][number]['sourceStatus'] = body.status === 'screening_failed'
      ? 'screening_failed'
      : body.status === 'interview_failed'
        ? 'interview_failed'
        : body.status === 'interview_pending'
          ? 'scheduled'
          : 'pending';
    const next = {
      ...current,
      ...(resolvedRecommendation ? {
        id: resolvedRecommendation.id,
        recommendationId: resolvedRecommendation.id,
        candidateCode: resolvedRecommendation.candidateCode,
        candidateName: resolvedRecommendation.candidateName || current.candidateName,
        jobTitle: resolvedRecommendation.jdTitle || current.jobTitle,
        organization: resolvedRecommendation.organization,
        department: resolvedRecommendation.department,
        contactPerson: resolvedRecommendation.contactPerson,
        recommendedAt: resolvedRecommendation.uploadedAt,
        sourceStatus,
      } : {}),
      confirmedStatus,
      followUpCount: body.action === 'follow_up'
        ? (current.followUpCount || 0) + 1
        : current.followUpCount || 0,
      lastFollowUpAt: body.action === 'follow_up' ? now : current.lastFollowUpAt,
      repushReady: body.action === 'repush' ? true : current.repushReady,
      timeline: [...(current.timeline || []), event].slice(-30),
      updatedAt: now,
    };
    if (resolvedRecommendation) {
      state.items = state.items.filter((item, itemIndex) => (
        itemIndex === index || item.owner !== current.owner || item.id !== resolvedRecommendation!.id
      ));
      const resolvedIndex = state.items.findIndex((item) => item === current);
      state.items[resolvedIndex] = next;
    } else {
      state.items[index] = next;
    }
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
