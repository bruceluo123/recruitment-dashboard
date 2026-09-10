import type { FeedbackCenterState } from '@/types/feedback-center';
const cache = new Map<string, { expiresAt: number; state: FeedbackCenterState }>();
const requests = new Map<string, Promise<FeedbackCenterState>>();
export function invalidateFeedback(owner: 'a' | 'b') {
  for (const key of Array.from(cache.keys())) if (key.startsWith(`${owner}:`)) cache.delete(key);
  window.dispatchEvent(new Event('feedback-updated'));
}
export async function fetchFeedback(owner: 'a' | 'b', force = false, all = false): Promise<FeedbackCenterState> {
  const key = `${owner}:${all ? 'all' : '7'}`;
  const cached = cache.get(key);
  if (!force && cached && cached.expiresAt > Date.now()) return cached.state;
  const pending = requests.get(key);
  if (pending) return pending;
  const params = new URLSearchParams({ owner, days: '7' });
  if (all) params.set('scope', 'all');
  if (force) params.set('refresh', '1');
  const request = fetch(`/api/feedback-center?${params}`, { cache: 'no-store', signal: AbortSignal.timeout(20_000) })
    .then(async (response) => {
      const data = await response.json();
      if (!response.ok || data.ok === false || !Array.isArray(data.items)) throw new Error('反馈读取失败，已保留上次结果');
      const state: FeedbackCenterState = { version: 1, generatedAt: data.generatedAt || '', items: data.items };
      cache.set(key, { expiresAt: Date.now() + 60_000, state });
      return state;
    }).finally(() => requests.delete(key));
  requests.set(key, request);
  return request;
}
