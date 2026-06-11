// 服务端数据防丢：每日把 KV 里的同步数据快照到带日期的备份键。
// 关键保护：若某类型当前为空、但已有非空 latest 备份，则跳过（绝不让"清空"传播进备份）。
import { kvConfigured, kvGetRaw, kvSetRaw } from '@/lib/kv-server';

type BackupType = 'jds' | 'candidates' | 'talents' | 'repush' | 'todos';

const LIVE_KEYS: Record<BackupType, string> = {
  jds: 'recruit:jds',
  candidates: 'recruit:candidates',
  talents: 'recruit:talents',
  repush: 'recruit:repush',
  todos: 'recruit:todos',
};

const ALL_TYPES: BackupType[] = ['jds', 'candidates', 'talents', 'repush', 'todos'];
const KEEP_DAYS = 30; // 保留最近 30 天的每日快照
const INDEX_KEY = 'recruit:backup:index';

const dayKey = (type: BackupType, date: string): string => `recruit:backup:${type}:${date}`;
const latestKey = (type: BackupType): string => `recruit:backup:${type}:latest`;

function countItems(raw: string | null): number {
  if (!raw) return 0;
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.length : 0;
  } catch {
    return 0;
  }
}

/** 北京时间日期串 YYYY-MM-DD（备份按 GMT+8 自然日归档） */
function beijingDate(now: Date): string {
  const t = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return t.toISOString().slice(0, 10);
}

export interface BackupTypeResult {
  type: BackupType;
  live: number;
  prevLatest: number;
  action: 'saved' | 'skipped-empty' | 'no-data';
}

export interface BackupSummary {
  ok: boolean;
  date: string;
  results: BackupTypeResult[];
  pruned: number;
  error?: string;
}

async function readIndex(): Promise<string[]> {
  const idxRaw = await kvGetRaw(INDEX_KEY);
  try {
    const parsed: unknown = idxRaw ? JSON.parse(idxRaw) : [];
    return Array.isArray(parsed) ? parsed.filter((d): d is string => typeof d === 'string') : [];
  } catch {
    return [];
  }
}

async function pruneOld(date: string): Promise<number> {
  const dates = await readIndex();
  if (!dates.includes(date)) dates.push(date);
  dates.sort();

  let pruned = 0;
  while (dates.length > KEEP_DAYS) {
    const old = dates.shift();
    if (!old) break;
    for (const type of ALL_TYPES) await kvSetRaw(dayKey(type, old), '');
    pruned++;
  }
  await kvSetRaw(INDEX_KEY, JSON.stringify(dates));
  return pruned;
}

/**
 * 执行一次全量备份。
 * 对每个类型：读 live → 若为空且已有非空 latest 则跳过（防丢）→ 否则写当日快照 + latest。
 */
export async function runBackup(now: Date = new Date()): Promise<BackupSummary> {
  const date = beijingDate(now);
  if (!kvConfigured()) {
    return { ok: false, date, results: [], pruned: 0, error: 'KV 未配置' };
  }

  const results: BackupTypeResult[] = [];
  for (const type of ALL_TYPES) {
    const liveRaw = await kvGetRaw(LIVE_KEYS[type]);
    const liveCount = countItems(liveRaw);
    const prevLatest = countItems(await kvGetRaw(latestKey(type)));

    if (liveCount === 0 && prevLatest > 0) {
      // 当前为空但历史有数据：判定为异常清空，保留旧备份，不覆盖。
      results.push({ type, live: 0, prevLatest, action: 'skipped-empty' });
      continue;
    }
    if (liveCount === 0 && prevLatest === 0) {
      results.push({ type, live: 0, prevLatest, action: 'no-data' });
      continue;
    }
    const payload = liveRaw ?? '[]';
    await kvSetRaw(dayKey(type, date), payload);
    await kvSetRaw(latestKey(type), payload);
    results.push({ type, live: liveCount, prevLatest, action: 'saved' });
  }

  const pruned = await pruneOld(date);
  return { ok: true, date, results, pruned };
}
