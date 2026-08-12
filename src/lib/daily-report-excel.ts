'use client';
import type { Candidate } from '@/types/interview';
import type { RepushColumnId, RepushItem } from '@/store/repush-store';
import type { WorkSheet } from 'xlsx';
import {
  aggregateRecommendations,
  isSameDay,
  scheduledToday,
  todaysInterviews,
  todaysRecommendations,
} from '@/lib/daily-report';

const TEMPLATE_URL = '/templates/daily-report-cloud.xls';

interface ExportDailyReportArgs {
  column: RepushColumnId;
  items: RepushItem[];
  candidates: Candidate[];
  date?: Date;
}

type XLSXModule = typeof import('xlsx');

const WORK_START = 4;      // row 5, 0-based
const WORK_CAPACITY = 3;
const INTERVIEW_START = 9; // row 10
const INTERVIEW_CAPACITY = 8;
const OFFER_START = 19;    // row 20
const OFFER_CAPACITY = 5;
const DIFFICULTY_HEADER = 24;

function localDateKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function dateText(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

function timeText(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function isOnOrAfterToday(iso: string | undefined, ref: Date): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return startOfDay(d).getTime() >= startOfDay(ref).getTime();
}

function byJob<T extends { jdTitle: string }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const key = (row.jdTitle || '未命名岗位').trim();
    map.set(key, [...(map.get(key) || []), row]);
  }
  return map;
}

function countWithNames(rows: Candidate[]): string | number {
  if (!rows.length) return 0;
  const names = rows.map((row) => row.name).filter(Boolean);
  return names.length ? `${rows.length}（${names.join('、')}）` : rows.length;
}

function getOfferRows(candidates: Candidate[], ref: Date, column: RepushColumnId): Candidate[] {
  return candidates
    .filter((candidate) => {
      if ((candidate.owner || 'a') !== column) return false;
      if (candidate.stage === 'offer' && isSameDay(candidate.updatedAt, ref)) return true;
      if (candidate.outcome && isSameDay(candidate.outcomeAt, ref)) return true;
      if (candidate.onboardDate && isSameDay(candidate.onboardDate, ref)) return true;
      return false;
    })
    .sort((a, b) => (a.onboardDate || a.updatedAt).localeCompare(b.onboardDate || b.updatedAt));
}

function buildWorkRows(items: RepushItem[], candidates: Candidate[], ref: Date, column: RepushColumnId) {
  const recommendations = todaysRecommendations(items, ref, column);
  const invites = scheduledToday(candidates, ref, column);
  const interviews = todaysInterviews(candidates, ref, column);
  const offers = getOfferRows(candidates, ref, column);
  const recLines = aggregateRecommendations(recommendations);
  const inviteByJob = byJob(invites);
  const interviewByJob = byJob(interviews);
  const offerByJob = byJob(offers);
  const names = new Set<string>();
  recLines.forEach((row) => names.add(row.name));
  inviteByJob.forEach((_, key) => names.add(key));
  interviewByJob.forEach((_, key) => names.add(key));
  offerByJob.forEach((_, key) => names.add(key));

  return Array.from(names).sort((a, b) => a.localeCompare(b, 'zh-CN')).map((name, index) => {
    const rec = recLines.find((row) => row.name === name);
    const offerRows = offerByJob.get(name) || [];
    return [
      index + 1,
      name,
      rec?.qty || 0,
      inviteByJob.get(name)?.length || 0,
      interviewByJob.get(name)?.length || 0,
      countWithNames(offerRows),
    ];
  });
}

function buildPendingInterviewRows(candidates: Candidate[], ref: Date, column: RepushColumnId) {
  return candidates
    .filter((candidate) => {
      if ((candidate.owner || 'a') !== column) return false;
      if (candidate.outcome || candidate.stage === 'offer') return false;
      return isOnOrAfterToday(candidate.interviewDate, ref);
    })
    .sort((a, b) => new Date(a.interviewDate!).getTime() - new Date(b.interviewDate!).getTime())
    .map((candidate, index) => [
      index + 1,
      'boss',
      dateText(candidate.interviewDate),
      timeText(candidate.interviewDate),
      candidate.name,
      candidate.jdTitle,
    ]);
}

function buildOfferRows(candidates: Candidate[], ref: Date, column: RepushColumnId) {
  return getOfferRows(candidates, ref, column).map((candidate, index) => {
    const onboarded = candidate.outcome === 'onboarded';
    const rejected = candidate.outcome === 'offer-rejected' || candidate.outcome === 'failed' || candidate.outcome === 'withdrawn';
    return [
      index + 1,
      candidate.jdTitle,
      candidate.name,
      dateText(candidate.onboardDate),
      onboarded ? '是' : rejected ? '否' : '',
      onboarded ? dateText(candidate.onboardDate) : candidate.outcomeReason || '',
    ];
  });
}

function cloneCell(cell: unknown): unknown {
  return cell ? JSON.parse(JSON.stringify(cell)) : undefined;
}

function shiftRows(ws: WorkSheet, XLSX: XLSXModule, startRow: number, count: number): void {
  if (count <= 0 || !ws['!ref']) return;
  const range = XLSX.utils.decode_range(ws['!ref']);
  for (let r = range.e.r; r >= startRow; r--) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const from = XLSX.utils.encode_cell({ r, c });
      const to = XLSX.utils.encode_cell({ r: r + count, c });
      if (ws[from]) ws[to] = ws[from];
      else delete ws[to];
    }
  }
  for (let r = startRow; r < startRow + count; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) delete ws[XLSX.utils.encode_cell({ r, c })];
  }
  if (ws['!merges']) {
    ws['!merges'] = ws['!merges'].map((merge) => ({
      s: { ...merge.s, r: merge.s.r >= startRow ? merge.s.r + count : merge.s.r },
      e: { ...merge.e, r: merge.e.r >= startRow ? merge.e.r + count : merge.e.r },
    }));
  }
  range.e.r += count;
  ws['!ref'] = XLSX.utils.encode_range(range);
}

function applyRowStyle(ws: WorkSheet, XLSX: XLSXModule, sourceRow: number, targetRow: number): void {
  for (let c = 1; c <= 6; c++) {
    const source = ws[XLSX.utils.encode_cell({ r: sourceRow, c })];
    const targetAddr = XLSX.utils.encode_cell({ r: targetRow, c });
    const target = ws[targetAddr] || { t: 's', v: '' };
    const styleSource = cloneCell(source) as { s?: unknown; z?: unknown } | undefined;
    ws[targetAddr] = { ...target, s: styleSource?.s, z: styleSource?.z };
  }
}

function clearRows(ws: WorkSheet, XLSX: XLSXModule, startRow: number, capacity: number): void {
  for (let r = startRow; r < startRow + capacity; r++) {
    for (let c = 1; c <= 6; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const prev = ws[addr] as ({ s?: unknown; z?: unknown } & Record<string, unknown>) | undefined;
      ws[addr] = { t: 's', v: '', s: prev?.s, z: prev?.z };
    }
  }
}

function writeRows(ws: WorkSheet, XLSX: XLSXModule, startRow: number, capacity: number, rows: Array<Array<string | number>>): void {
  clearRows(ws, XLSX, startRow, Math.max(capacity, rows.length));
  rows.forEach((row, index) => {
    XLSX.utils.sheet_add_aoa(ws, [row], { origin: { r: startRow + index, c: 1 } });
    applyRowStyle(ws, XLSX, startRow, startRow + index);
  });
}

function ensureRows(ws: WorkSheet, XLSX: XLSXModule, sectionStart: number, capacity: number, required: number): number {
  const extra = Math.max(0, required - capacity);
  if (extra) shiftRows(ws, XLSX, sectionStart + capacity, extra);
  return extra;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function exportDailyReportExcel({ column, items, candidates, date = new Date() }: ExportDailyReportArgs): Promise<void> {
  const XLSX = await import('xlsx');
  const res = await fetch(TEMPLATE_URL);
  if (!res.ok) throw new Error('日报模板下载失败');
  const buffer = await res.arrayBuffer();
  const wb = XLSX.read(buffer, { type: 'array', cellStyles: true, cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];

  const workRows = buildWorkRows(items, candidates, date, column);
  const interviewRows = buildPendingInterviewRows(candidates, date, column);
  const offerRows = buildOfferRows(candidates, date, column);

  let interviewStart = INTERVIEW_START;
  let offerStart = OFFER_START;
  let difficultyHeader = DIFFICULTY_HEADER;

  const workExtra = ensureRows(ws, XLSX, WORK_START, WORK_CAPACITY, workRows.length);
  interviewStart += workExtra;
  offerStart += workExtra;
  difficultyHeader += workExtra;

  const interviewExtra = ensureRows(ws, XLSX, interviewStart, INTERVIEW_CAPACITY, interviewRows.length);
  offerStart += interviewExtra;
  difficultyHeader += interviewExtra;

  const offerExtra = ensureRows(ws, XLSX, offerStart, OFFER_CAPACITY, offerRows.length);
  difficultyHeader += offerExtra;

  XLSX.utils.sheet_add_aoa(ws, [[`木云--工作日报表（${date.getMonth() + 1}月${date.getDate()}日）`]], { origin: 'B2' });
  writeRows(ws, XLSX, WORK_START, WORK_CAPACITY, workRows);
  writeRows(ws, XLSX, interviewStart, INTERVIEW_CAPACITY, interviewRows);
  writeRows(ws, XLSX, offerStart, OFFER_CAPACITY, offerRows);

  XLSX.utils.sheet_add_aoa(ws, [['四、有无困难点']], { origin: { r: difficultyHeader, c: 1 } });
  XLSX.utils.sheet_add_aoa(ws, [['']], { origin: { r: difficultyHeader + 1, c: 1 } });

  const output = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true });
  const filename = `木云-工作日报-${localDateKey(date)}.xlsx`;
  downloadBlob(new Blob([output], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
}
