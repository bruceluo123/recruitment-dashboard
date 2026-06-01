// TG 缺口 → KV 同步。被 cron 路由（/api/sync/tg-cron）和手动路由（/api/sync/tg-run）共用。
// 优先级（P0/P1/...）现以源表「优先级」列为准，由 google-sync 管理；
// 本同步只负责从 TG 群的「招聘需求变化通知」实时更新各 JD 的缺口（gap），不再触碰 priority。

import type { JD } from '@/types/jd';
import { fetchTgPriority, normalizeTitle } from '@/lib/tg-priority';
import { kvGet, kvSet, SYNC_KEYS } from '@/lib/kv';

export interface TgSyncSummary {
  ok: boolean;
  updated: number; // 缺口被更新的岗位数
  tgEntries: number; // TG 解析出的岗位条目数
  messages: number; // 读取的消息条数
  total: number; // JD 总数
  version?: number;
  error?: string;
}

function safeParseArray(raw: string | null): JD[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as JD[]) : [];
  } catch {
    return [];
  }
}

/**
 * 执行一次 TG → KV 缺口同步。
 *  - TG 最新一条带「缺口：x → y」的岗位：按归一化标题匹配 JD，更新其 gap
 *  - TG 最新显示已关闭：缺口置 0
 *  - 最近窗口内 TG 未提到的岗位：保持原 gap 不变
 * 仅在有实际变化时写回并自增版本号。
 */
export async function runTgSync(): Promise<TgSyncSummary> {
  // 1. 从 TG 抓取缺口映射
  const { gapMap, totalEntries, messageCount } = await fetchTgPriority();

  // 2. 读取当前 KV 数据
  const rawJds = await kvGet<string>(SYNC_KEYS.jds);
  const existing = safeParseArray(rawJds);

  // 3. 应用缺口更新
  let updated = 0;
  const next: JD[] = existing.map((jd) => {
    const key = normalizeTitle(jd.title);
    const newGap = gapMap.get(key);
    if (newGap === undefined) return jd; // TG 未提到，保持原样
    const gapStr = String(newGap);
    if ((jd.gap || '') === gapStr) return jd; // 缺口无变化
    updated++;
    return { ...jd, gap: gapStr, updatedAt: new Date().toISOString() };
  });

  // 4. 无变化则不写回
  if (updated === 0) {
    return { ok: true, updated: 0, tgEntries: totalEntries, messages: messageCount, total: next.length };
  }

  const wrote = await kvSet(SYNC_KEYS.jds, next);
  if (!wrote) throw new Error('写入 KV 失败');

  const rawVer = await kvGet<string>(SYNC_KEYS.version);
  const version = (parseInt(rawVer || '0') || 0) + 1;
  await kvSet(SYNC_KEYS.version, version);

  return { ok: true, updated, tgEntries: totalEntries, messages: messageCount, total: next.length, version };
}
