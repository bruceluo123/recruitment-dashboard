// Shared Google Sheet → KV sync logic. Used by both the Vercel cron route
// (/api/sync/google-cron) and the manual-trigger route (/api/sync/google-run).
// No request/auth concerns here — callers handle that.

import type { JD } from '@/types/jd';
import { fetchGoogleExport } from '@/lib/google-sheet';
import { analyzeColumns, getJDKey, normalizeExcelRows, rowToColumnJD } from '@/lib/jd-parse-core';
import { kvGet, kvSet, SYNC_KEYS } from '@/lib/kv';

// mock 示例数据 ID 前缀，永不参与自动删除/刷新
const MOCK_ID_PREFIX = 'jd-00';

// 默认同步的共享表格（可用 GOOGLE_SYNC_SHEET_URL 环境变量覆盖）
const DEFAULT_SHEET_URL =
  'https://docs.google.com/spreadsheets/d/1PCnqi6OiX4HmWZ1EcTnNXraYhkyDwvRo4oGxLDUOnBo/edit?gid=0#gid=0';

export interface SyncSummary {
  ok: boolean;
  added: number;
  deleted: number;
  updated: number;
  adopted: number;
  kept: number;
  total: number;
  version?: number;
  error?: string;
}

/** 同步管理下会从源表刷新的内容字段（id/createdAt/status/source 不在内）。
 * 用于判断已有岗位是否需要更新。
 * 注意：priority 不在此签名内——优先级由 TG 同步（/api/sync/tg-*）独占管理，
 * 源表没有优先级列，google-sync 不应触碰它。 */
function contentSignature(jd: JD): string {
  return JSON.stringify({
    title: jd.title,
    department: jd.department,
    organization: jd.organization || '',
    serviceUnit: jd.serviceUnit || '',
    headcount: jd.headcount || '',
    gap: jd.gap || '',
    categories: jd.categories,
    responsibilities: jd.responsibilities,
    requirements: jd.requirements,
    salaryRange: jd.salaryRange,
    salaryText: jd.salaryText || '',
    location: jd.location || '',
    odc: jd.odc || '',
  });
}

/** 用源表最新解析结果刷新已有岗位的内容，保留 id/createdAt/status/priority。
 * priority 由 TG 同步管理，这里原样保留 existing.priority。 */
function refreshFromSheet(existing: JD, fresh: JD): JD {
  return {
    ...existing,
    title: fresh.title,
    department: fresh.department,
    organization: fresh.organization,
    serviceUnit: fresh.serviceUnit,
    headcount: fresh.headcount,
    gap: fresh.gap,
    categories: fresh.categories,
    responsibilities: fresh.responsibilities,
    requirements: fresh.requirements,
    salaryRange: fresh.salaryRange,
    salaryText: fresh.salaryText,
    location: fresh.location,
    odc: fresh.odc,
    source: 'google-sync',
    updatedAt: new Date().toISOString(),
  };
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
 * 执行一次 Google Sheet → KV 同步。
 *  - mock 示例（jd-00*）：永远保持原样，不删不改
 *  - 表格中存在的已有岗位：刷新内容（缺口/优先级/职责/要求等），保留 id/createdAt/status，
 *    并"认领"为 google-sync
 *  - 来源为 google-sync 但已不在表格中：自动删除
 *  - 手动添加且不在表格中的岗位：保留为 manual，永不自动删除
 *  - 新增：表格存在、KV 不存在的岗位
 * 仅在有实际变化（新增/删除/刷新/认领）时写回并自增版本号。
 */
export async function runGoogleSync(): Promise<SyncSummary> {
  const sheetUrl = process.env.GOOGLE_SYNC_SHEET_URL || DEFAULT_SHEET_URL;

  // 1. 拉取表格
  const { buffer, type } = await fetchGoogleExport(sheetUrl);
  if (type !== 'sheet') throw new Error('同步源必须是 Google Sheets 表格');

  // 2. 解析为行
  const XLSX = await import('xlsx');
  const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error('表格为空');
  const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });
  const rows = normalizeExcelRows(rawRows);
  if (!rows.length) throw new Error('表格没有数据行');

  const cols = analyzeColumns(Object.keys(rows[0]));
  if (!cols) throw new Error('未找到岗位名称列，无法同步');

  // 3. 表格 → JD（列解析，标记来源）
  const sheetJDs: JD[] = [];
  for (const row of rows) {
    const jd = rowToColumnJD(row, cols);
    if (jd) sheetJDs.push({ ...jd, source: 'google-sync' });
  }
  if (!sheetJDs.length) throw new Error('表格未解析出任何岗位');

  // 同 key 取最后一条（源表后出现的覆盖前者）
  const sheetByKey = new Map<string, JD>();
  for (const jd of sheetJDs) sheetByKey.set(getJDKey(jd), jd);

  // 4. 读取当前 KV 数据
  const rawJds = await kvGet<string>(SYNC_KEYS.jds);
  const existing: JD[] = safeParseArray(rawJds);
  const existingKeys = new Set(existing.map(getJDKey));

  // 5. diff + 刷新
  let deleted = 0;
  let adopted = 0;
  let updated = 0;
  const kept: JD[] = [];
  for (const jd of existing) {
    const isMock = jd.id.startsWith(MOCK_ID_PREFIX);
    const key = getJDKey(jd);
    const fresh = sheetByKey.get(key);

    if (isMock) {
      kept.push(jd);
      continue;
    }
    if (fresh) {
      const wasAdopted = jd.source !== 'google-sync';
      const refreshed = refreshFromSheet(jd, fresh);
      const changed = contentSignature(jd) !== contentSignature(refreshed);
      if (wasAdopted) adopted++;
      if (changed) {
        updated++;
        kept.push(refreshed);
      } else {
        // 内容无变化：保留原对象（避免无意义地改 updatedAt），仅在需要认领时补 source
        kept.push(wasAdopted ? { ...jd, source: 'google-sync' } : jd);
      }
      continue;
    }
    // 不在表格中
    if (jd.source === 'google-sync') {
      deleted++; // 曾由同步管理、现已从表格移除 → 删除
      continue;
    }
    kept.push(jd); // 手动岗位，保留
  }

  const additions = sheetJDs.filter((jd) => !existingKeys.has(getJDKey(jd)));
  const merged = [...kept, ...additions];

  // 无任何变化则跳过写入，避免无谓地 bump version
  if (additions.length === 0 && deleted === 0 && adopted === 0 && updated === 0) {
    return { ok: true, added: 0, deleted: 0, updated: 0, adopted: 0, kept: kept.length, total: merged.length };
  }

  // 6. 写回 KV 并自增版本号（触发浏览器端轮询拉取）
  const wrote = await kvSet(SYNC_KEYS.jds, merged);
  if (!wrote) throw new Error('写入 KV 失败');

  const rawVer = await kvGet<string>(SYNC_KEYS.version);
  const version = (parseInt(rawVer || '0') || 0) + 1;
  await kvSet(SYNC_KEYS.version, version);

  return {
    ok: true,
    added: additions.length,
    deleted,
    updated,
    adopted,
    kept: kept.length,
    total: merged.length,
    version,
  };
}
