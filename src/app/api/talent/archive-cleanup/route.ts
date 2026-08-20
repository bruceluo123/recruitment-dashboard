import { del, list } from '@vercel/blob';
import { NextRequest, NextResponse } from 'next/server';
import { guardApi } from '@/lib/api-guard';
import { kvGet, kvSet } from '@/lib/kv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DAY_MS = 24 * 60 * 60 * 1000;
const ALLOWED_DAYS = new Set([30, 60, 90]);

interface TalentRecord {
  id: string;
  name?: string;
  archived?: boolean;
  archivedAt?: string;
  updatedAt?: string;
  createdAt?: string;
  resumeUrl?: string;
  resumeFileName?: string;
  resumeFileArchivedAt?: string;
  [key: string]: unknown;
}

function parseArray<T>(value: T[] | string | null): T[] {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function normalizeBlobUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (!url.hostname.endsWith('.blob.vercel-storage.com')) return '';
    return `${url.origin}${url.pathname}`;
  } catch {
    return '';
  }
}

function collectBlobUrls(value: unknown, result = new Set<string>()): Set<string> {
  if (typeof value === 'string') {
    const normalized = normalizeBlobUrl(value);
    if (normalized) result.add(normalized);
    return result;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectBlobUrls(item, result));
    return result;
  }
  if (value && typeof value === 'object') {
    Object.values(value).forEach((item) => collectBlobUrls(item, result));
  }
  return result;
}

function retentionDate(talent: TalentRecord): number {
  const raw = talent.archivedAt || talent.updatedAt || talent.createdAt || '';
  const time = new Date(raw).getTime();
  return Number.isFinite(time) ? time : Date.now();
}

async function allBlobs() {
  const blobs: Awaited<ReturnType<typeof list>>['blobs'] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ limit: 1000, cursor });
    blobs.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return blobs;
}

async function buildPlan(days: number) {
  const [talentValue, repushValue, candidateValue, blobs] = await Promise.all([
    kvGet<TalentRecord[] | string>('recruit:talents'),
    kvGet<unknown[] | string>('recruit:repush'),
    kvGet<unknown[] | string>('recruit:candidates'),
    allBlobs(),
  ]);
  const talents = parseArray<TalentRecord>(talentValue);
  const repush = parseArray<unknown>(repushValue);
  const candidates = parseArray<unknown>(candidateValue);
  const cutoff = Date.now() - days * DAY_MS;
  const eligible = talents.filter((talent) => (
    talent.archived === true
    && Boolean(talent.resumeUrl)
    && retentionDate(talent) <= cutoff
  ));
  const eligibleIds = new Set(eligible.map((talent) => talent.id));
  const protectedUrls = collectBlobUrls([repush, candidates]);
  talents.forEach((talent) => {
    if (!eligibleIds.has(talent.id) && talent.resumeUrl) {
      const normalized = normalizeBlobUrl(talent.resumeUrl);
      if (normalized) protectedUrls.add(normalized);
    }
  });

  const blobMap = new Map<string, { url: string; size: number }>();
  blobs.forEach((blob) => {
    const entry = { url: blob.url, size: blob.size };
    const url = normalizeBlobUrl(blob.url);
    const downloadUrl = normalizeBlobUrl(blob.downloadUrl || '');
    if (url) blobMap.set(url, entry);
    if (downloadUrl) blobMap.set(downloadUrl, entry);
  });

  const safeByUrl = new Map<string, TalentRecord[]>();
  eligible.forEach((talent) => {
    const normalized = normalizeBlobUrl(talent.resumeUrl || '');
    if (!normalized || protectedUrls.has(normalized) || !blobMap.has(normalized)) return;
    const records = safeByUrl.get(normalized) || [];
    records.push(talent);
    safeByUrl.set(normalized, records);
  });
  const safeRecords = Array.from(safeByUrl.values()).flat();
  const bytes = Array.from(safeByUrl.keys()).reduce((sum, url) => sum + (blobMap.get(url)?.size || 0), 0);

  return {
    talents,
    safeByUrl,
    blobMap,
    summary: {
      days,
      archivedWithResume: talents.filter((talent) => talent.archived && talent.resumeUrl).length,
      eligibleRecords: eligible.length,
      safeRecords: safeRecords.length,
      safeFiles: safeByUrl.size,
      protectedRecords: eligible.length - safeRecords.length,
      bytes,
      sampleNames: safeRecords.slice(0, 6).map((talent) => talent.name || talent.resumeFileName || '未命名人才'),
    },
  };
}

function requestedDays(request: NextRequest, bodyDays?: unknown): number {
  const value = Number(bodyDays ?? request.nextUrl.searchParams.get('days') ?? 30);
  return ALLOWED_DAYS.has(value) ? value : 30;
}

export async function GET(request: NextRequest) {
  const blocked = guardApi(request, 'talent-archive-cleanup-preview', 12, 60_000);
  if (blocked) return blocked;
  try {
    const plan = await buildPlan(requestedDays(request));
    return NextResponse.json({ ok: true, ...plan.summary });
  } catch (error) {
    return NextResponse.json({ ok: false, error: (error as Error).message || '读取云端文件失败' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const blocked = guardApi(request, 'talent-archive-cleanup-run', 3, 60_000);
  if (blocked) return blocked;
  try {
    const body = await request.json().catch(() => ({}));
    if (body.confirm !== true) {
      return NextResponse.json({ ok: false, error: '请先确认清理' }, { status: 400 });
    }
    const plan = await buildPlan(requestedDays(request, body.days));
    const blobUrls = Array.from(plan.safeByUrl.keys())
      .map((url) => plan.blobMap.get(url)?.url)
      .filter((url): url is string => Boolean(url));
    for (let index = 0; index < blobUrls.length; index += 100) {
      await del(blobUrls.slice(index, index + 100));
    }

    const cleanedAt = new Date().toISOString();
    const cleanedIds = Array.from(plan.safeByUrl.values()).flat().map((talent) => talent.id);
    const cleanedIdSet = new Set(cleanedIds);
    const nextTalents = plan.talents.map((talent) => cleanedIdSet.has(talent.id)
      ? {
        ...talent,
        resumeUrl: undefined,
        resumeFileName: undefined,
        resumeFileArchivedAt: cleanedAt,
        updatedAt: cleanedAt,
      }
      : talent);
    if (cleanedIds.length) {
      await kvSet('recruit:talents', nextTalents);
      const currentVersion = Number(await kvGet<number | string>('recruit:version')) || 0;
      await kvSet('recruit:version', currentVersion + 1);
    }
    return NextResponse.json({
      ok: true,
      cleanedAt,
      cleanedIds,
      cleanedFiles: blobUrls.length,
      cleanedRecords: cleanedIds.length,
      bytes: plan.summary.bytes,
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: (error as Error).message || '清理失败' }, { status: 500 });
  }
}
