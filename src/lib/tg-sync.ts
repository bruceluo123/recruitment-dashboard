// TG 优先级 → KV 同步。被 cron 路由（/api/sync/tg-cron）和手动路由（/api/sync/tg-run）共用。
// 优先级（P0/P1/...）由本同步独占管理：从 TG 群抓取，写回 KV 中各 JD 的 priority 字段。

import type { JD } from '@/types/jd';
import { fetchTgPriority, normalizeTitle } from '@/lib/tg-priority';
import { kvGet, kvSet, SYNC_KEYS } from '@/lib/kv';

export interface TgSyncSummary {
  ok: boolean;
  matched: number; // 命中并设置/更新优先级的岗位数
  cleared: number; // 因已关闭而清除优先级的岗位数
  p0: number; // 写回后 P0 岗位数
  p1: number; // 写回后 P1 岗位数
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
 * 执行一次 TG → KV 优先级同步。
 *  - TG 最新显示在招的岗位：按归一化标题匹配 JD，设置/更新其 priority
 *  - TG 最新显示已关闭/缺口0 的岗位：清除其 priority
 *  - 最近窗口内 TG 未提到的岗位：保持原 priority 不变
 * 仅在有实际变化时写回并自增版本号。
 */
export async function runTgSync(): Promise<TgSyncSummary> {
  // 1. 从 TG 抓取优先级映射
  const { priorityMap, closedTitles, totalEntries, messageCount } = await fetchTgPriority();

  // 2. 读取当前 KV 数据
  const rawJds = await kvGet<string>(SYNC_KEYS.jds);
  const existing = safeParseArray(rawJds);

  // 3. 应用映射
  let matched = 0;
  let cleared = 0;
  const next: JD[] = existing.map((jd) => {
    const key = normalizeTitle(jd.title);
    const newPriority = priorityMap.get(key);
    if (newPriority) {
      if (jd.priority !== newPriority) {
        matched++;
        return { ...jd, priority: newPriority };
      }
      return jd;
    }
    if (closedTitles.has(key)) {
      if (jd.priority) {
        cleared++;
        return { ...jd, priority: undefined };
      }
      return jd;
    }
    return jd; // 未提到，保持原样
  });

  const p0 = next.filter((j) => j.priority === 'P0').length;
  const p1 = next.filter((j) => j.priority === 'P1').length;

  // 4. 无变化则不写回
  if (matched === 0 && cleared === 0) {
    return {
      ok: true, matched: 0, cleared: 0, p0, p1,
      tgEntries: totalEntries, messages: messageCount, total: next.length,
    };
  }

  const wrote = await kvSet(SYNC_KEYS.jds, next);
  if (!wrote) throw new Error('写入 KV 失败');

  const rawVer = await kvGet<string>(SYNC_KEYS.version);
  const version = (parseInt(rawVer || '0') || 0) + 1;
  await kvSet(SYNC_KEYS.version, version);

  return {
    ok: true, matched, cleared, p0, p1,
    tgEntries: totalEntries, messages: messageCount, total: next.length, version,
  };
}
