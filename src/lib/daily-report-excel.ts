'use client';
import type { Candidate } from '@/types/interview';
import type { RepushColumnId, RepushItem } from '@/store/repush-store';
import {
  aggregateRecommendations,
  isSameDay,
  scheduledToday,
  todaysInterviews,
  todaysRecommendations,
} from '@/lib/daily-report';

interface ExportDailyReportArgs {
  column: RepushColumnId;
  name?: string;
  items: RepushItem[];
  candidates: Candidate[];
  date?: Date;
}

type Worksheet = import('exceljs').Worksheet;
type ReportRow = Array<string | number>;

const START_COL = 2;
const END_COL = 7;
const WORK_CAPACITY = 3;
const INTERVIEW_CAPACITY = 8;
const OFFER_CAPACITY = 5;
const SECTION_FILL = 'FF9999FF';
const HEADER_FILL = 'FFCCCCFF';
const BLACK = 'FF000000';

const border = {
  top: { style: 'thin' as const, color: { argb: BLACK } },
  left: { style: 'thin' as const, color: { argb: BLACK } },
  bottom: { style: 'thin' as const, color: { argb: BLACK } },
  right: { style: 'thin' as const, color: { argb: BLACK } },
};

const center = { horizontal: 'center' as const, vertical: 'middle' as const, wrapText: true };

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

function buildWorkRows(items: RepushItem[], candidates: Candidate[], ref: Date, column: RepushColumnId): ReportRow[] {
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

function buildPendingInterviewRows(candidates: Candidate[], ref: Date, column: RepushColumnId): ReportRow[] {
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

function buildOfferRows(candidates: Candidate[], ref: Date, column: RepushColumnId): ReportRow[] {
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

function fillColor(argb: string) {
  return { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } };
}

function styleRange(ws: Worksheet, row: number, fill?: string): void {
  for (let col = START_COL; col <= END_COL; col++) {
    const cell = ws.getCell(row, col);
    cell.border = border;
    cell.alignment = center;
    if (fill) cell.fill = fillColor(fill);
  }
}

function writeMergedRow(ws: Worksheet, row: number, text: string, fill: string | undefined, fontSize: number): void {
  ws.mergeCells(row, START_COL, row, END_COL);
  ws.getCell(row, START_COL).value = text;
  styleRange(ws, row, fill);
  ws.getCell(row, START_COL).font = { name: 'Microsoft YaHei', size: fontSize, bold: true, color: { argb: BLACK } };
}

function writeHeaderRow(ws: Worksheet, row: number, values: string[]): void {
  ws.getRow(row).height = 25;
  values.forEach((value, index) => {
    const cell = ws.getCell(row, START_COL + index);
    cell.value = value;
    cell.font = { name: 'Microsoft YaHei', size: 14, color: { argb: BLACK } };
  });
  styleRange(ws, row, HEADER_FILL);
}

function writeDataRows(ws: Worksheet, startRow: number, rows: ReportRow[], capacity: number): number {
  const count = Math.max(rows.length, capacity);
  for (let i = 0; i < count; i++) {
    const rowNumber = startRow + i;
    ws.getRow(rowNumber).height = 25;
    const values = rows[i] || ['', '', '', '', '', ''];
    for (let colOffset = 0; colOffset < 6; colOffset++) {
      const cell = ws.getCell(rowNumber, START_COL + colOffset);
      cell.value = values[colOffset] ?? '';
      cell.font = { name: 'Microsoft YaHei', size: 14, color: { argb: BLACK } };
    }
    styleRange(ws, rowNumber);
  }
  return startRow + count;
}

function setupSheet(ws: Worksheet): void {
  ws.getColumn(1).width = 3.5625;
  ws.getColumn(2).width = 6.0703125;
  ws.getColumn(3).width = 16.953125;
  ws.getColumn(4).width = 10.078125;
  ws.getColumn(5).width = 10.078125;
  ws.getColumn(6).width = 8.48046875;
  ws.getColumn(7).width = 29.10546875;
  ws.getColumn(8).width = 11;
  ws.getRow(1).height = 9;
  ws.views = [{ showGridLines: true }];
}

export async function exportDailyReportExcel({
  column,
  name = '木云',
  items,
  candidates,
  date = new Date(),
}: ExportDailyReportArgs): Promise<void> {
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = '企鹅岛';
  workbook.created = date;
  const ws = workbook.addWorksheet('Sheet1');
  setupSheet(ws);

  const workRows = buildWorkRows(items, candidates, date, column);
  const interviewRows = buildPendingInterviewRows(candidates, date, column);
  const offerRows = buildOfferRows(candidates, date, column);

  ws.getRow(2).height = 27;
  writeMergedRow(ws, 2, `${name}--工作日报表（${date.getMonth() + 1}月${date.getDate()}日）`, undefined, 28);

  let row = 3;
  ws.getRow(row).height = 28;
  writeMergedRow(ws, row++, '一、日常工作', SECTION_FILL, 22);
  writeHeaderRow(ws, row++, ['序号', '负责岗位名称', '推荐简历', '邀约', '面试', '录用']);
  row = writeDataRows(ws, row, workRows, WORK_CAPACITY);

  ws.getRow(row).height = 34;
  writeMergedRow(ws, row++, '二、待面试清单', SECTION_FILL, 22);
  writeHeaderRow(ws, row++, ['序号', '渠道', '面试日期', '面试时间', '姓名', '岗位']);
  row = writeDataRows(ws, row, interviewRows, INTERVIEW_CAPACITY);

  ws.getRow(row).height = 25;
  writeMergedRow(ws, row++, '三、OFFER及入职明细（写上今天入职的人明细及今天offer的人明细）', SECTION_FILL, 18);
  writeHeaderRow(ws, row++, ['序号', '岗位名称', '候选人', '待入职时间', '是否入职', '入职时间']);
  row = writeDataRows(ws, row, offerRows, OFFER_CAPACITY);

  ws.getRow(row).height = 25;
  writeMergedRow(ws, row++, '四、有无困难点', SECTION_FILL, 22);
  ws.mergeCells(row, START_COL, row + 1, END_COL);
  ws.getRow(row).height = 25;
  ws.getRow(row + 1).height = 25;
  for (let r = row; r <= row + 1; r++) styleRange(ws, r);

  const output = await workbook.xlsx.writeBuffer();
  const filename = `${name}-工作日报-${localDateKey(date)}.xlsx`;
  downloadBlob(new Blob([output], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
}
