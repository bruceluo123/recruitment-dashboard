import { NextRequest, NextResponse } from 'next/server';
import type { JD } from '@/types/jd';
import { fetchGoogleExport } from '@/lib/google-sheet';
import { analyzeColumns, getJDKey, normalizeExcelRows, rowToColumnJD } from '@/lib/jd-parse-core';
import { kvGet, kvSet, SYNC_KEYS } from '@/lib/kv';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// 默认同步的共享表格（可用 GOOGLE_SYNC_SHEET_URL 环境变量覆盖）
const DEFAULT_SHEET_URL =
  'https://docs.google.com/spreadsheets/d/1PCnqi6OiX4HmWZ1EcTnNXraYhkyDwvRo4oGxLDUOnBo/edit?gid=0#gid=0';

// mock 示例数据 ID 前缀，永不参与自动删除
const MOCK_ID_PREFIX = 'jd-00';

interface SyncSummary {
  ok: boolean;
  added: number;
  deleted: number;
  adopted?: number;
  kept: number;
  total: number;
  version?: number;
  error?: string;
}

export async function GET(req: NextRequest): Promise<NextResponse<SyncSummary>> {
  // Vercel Cron 会带上 Authorization: Bearer ${CRON_SECRET}（若已配置）
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json(
      { ok: false, added: 0, deleted: 0, kept: 0, total: 0, error: 'Unauthorized' },
      { status: 401 },
    );
  }

  try {
    const sheetUrl = process.env.GOOGLE_SYNC_SHEET_URL || DEFAULT_SHEET_URL;

    // 1. 拉取表格
    const { buffer, type } = await fetchGoogleExport(sheetUrl);
    if (type !== 'sheet') {
      throw new Error('同步源必须是 Google Sheets 表格');
    }

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

    const sheetKeys = new Set(sheetJDs.map(getJDKey));

    // 4. 读取当前 KV 数据
    const rawJds = await kvGet<string>(SYNC_KEYS.jds);
    const existing: JD[] = safeParseArray(rawJds);
    const existingKeys = new Set(existing.map(getJDKey));

    // 5. diff
    //  - mock 示例（jd-00*）：永远保持原样，不删不改
    //  - 在表格中存在的已有岗位：保留并"认领"为 google-sync（让其纳入同步管理）
    //  - 来源为 google-sync 但已不在表格中的岗位：自动删除
    //  - 手动添加且从不在表格中的岗位：保留为 manual，永不自动删除
    //  - 新增：表格中存在、KV 中不存在的岗位
    let deleted = 0;
    let adopted = 0;
    const kept: JD[] = [];
    for (const jd of existing) {
      const isMock = jd.id.startsWith(MOCK_ID_PREFIX);
      const inSheet = sheetKeys.has(getJDKey(jd));

      if (isMock) {
        kept.push(jd);
        continue;
      }
      if (inSheet) {
        // 认领：补充 source 标记（不覆盖任何内容字段）
        if (jd.source !== 'google-sync') {
          adopted++;
          kept.push({ ...jd, source: 'google-sync' });
        } else {
          kept.push(jd);
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

    // 无任何变化（含认领）则跳过写入，避免无谓地 bump version
    if (additions.length === 0 && deleted === 0 && adopted === 0) {
      return NextResponse.json({
        ok: true, added: 0, deleted: 0, kept: kept.length, total: merged.length,
      });
    }

    // 6. 写回 KV 并自增版本号（触发浏览器端轮询拉取）
    const wrote = await kvSet(SYNC_KEYS.jds, merged);
    if (!wrote) throw new Error('写入 KV 失败');

    const rawVer = await kvGet<string>(SYNC_KEYS.version);
    const version = (parseInt(rawVer || '0') || 0) + 1;
    await kvSet(SYNC_KEYS.version, version);

    return NextResponse.json({
      ok: true,
      added: additions.length,
      deleted,
      adopted,
      kept: kept.length,
      total: merged.length,
      version,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, added: 0, deleted: 0, kept: 0, total: 0, error: (err as Error).message || '同步失败' },
      { status: 500 },
    );
  }
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
