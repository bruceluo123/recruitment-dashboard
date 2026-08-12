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
type Style = import('exceljs').Style;
type ReportRow = Array<string | number>;
type RowTemplate = {
  height?: number;
  styles: Array<Partial<Style>>;
};

const TEMPLATE_URL = '/templates/daily-report-cloud.xlsx';
const START_COL = 2;
const END_COL = 7;
const WORK_CAPACITY = 3;
const INTERVIEW_CAPACITY = 8;
const OFFER_CAPACITY = 5;
const PENDING_INTERVIEW_CHANNELS = ['个人资源', 'boss'] as const;

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

function isAfterToday(iso: string | undefined, ref: Date): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return startOfDay(d).getTime() > startOfDay(ref).getTime();
}

function blankZero(value: string | number): string | number {
  return value === 0 ? '' : value;
}

function pendingInterviewChannel(candidate: Candidate, index: number): string {
  const seed = `${candidate.id}-${candidate.interviewDate || ''}-${index}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return PENDING_INTERVIEW_CHANNELS[hash % PENDING_INTERVIEW_CHANNELS.length];
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
  if (!rows.length) return '';
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

function getWorkOfferRows(candidates: Candidate[], ref: Date, column: RepushColumnId): Candidate[] {
  return candidates.filter((candidate) => {
    if ((candidate.owner || 'a') !== column) return false;
    if (candidate.outcome === 'onboarded') return false;
    if (candidate.stage === 'offer' && isSameDay(candidate.updatedAt, ref)) return true;
    if (candidate.outcome && isSameDay(candidate.outcomeAt, ref)) return true;
    return false;
  });
}

function buildWorkRows(items: RepushItem[], candidates: Candidate[], ref: Date, column: RepushColumnId): ReportRow[] {
  const recommendations = todaysRecommendations(items, ref, column);
  const invites = scheduledToday(candidates, ref, column);
  const interviews = todaysInterviews(candidates, ref, column);
  const offers = getWorkOfferRows(candidates, ref, column);
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
      blankZero(rec?.qty || 0),
      blankZero(inviteByJob.get(name)?.length || 0),
      blankZero(interviewByJob.get(name)?.length || 0),
      countWithNames(offerRows),
    ];
  });
}

function buildPendingInterviewRows(candidates: Candidate[], ref: Date, column: RepushColumnId): ReportRow[] {
  return candidates
    .filter((candidate) => {
      if ((candidate.owner || 'a') !== column) return false;
      if (candidate.outcome || candidate.stage === 'offer') return false;
      return isAfterToday(candidate.interviewDate, ref);
    })
    .sort((a, b) => new Date(a.interviewDate!).getTime() - new Date(b.interviewDate!).getTime())
    .map((candidate, index) => [
      index + 1,
      pendingInterviewChannel(candidate, index),
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

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? {}));
}

function captureRowTemplate(ws: Worksheet, rowNumber: number): RowTemplate {
  const row = ws.getRow(rowNumber);
  const styles: Array<Partial<Style>> = [];
  for (let col = START_COL; col <= END_COL; col++) {
    styles.push(clone(ws.getCell(rowNumber, col).style));
  }
  return { height: row.height, styles };
}

function applyRowTemplate(ws: Worksheet, rowNumber: number, template: RowTemplate): void {
  if (typeof template.height === 'number') {
    ws.getRow(rowNumber).height = template.height;
  }
  for (let col = START_COL; col <= END_COL; col++) {
    ws.getCell(rowNumber, col).style = clone(template.styles[col - START_COL]);
  }
}

function writeCells(ws: Worksheet, rowNumber: number, values: ReportRow, template: RowTemplate): void {
  applyRowTemplate(ws, rowNumber, template);
  for (let col = START_COL; col <= END_COL; col++) {
    const value = values[col - START_COL] ?? '';
    ws.getCell(rowNumber, col).value = value === 0 ? '' : value;
  }
}

function writeMergedRow(ws: Worksheet, rowNumber: number, value: string | import('exceljs').CellRichTextValue, template: RowTemplate): void {
  applyRowTemplate(ws, rowNumber, template);
  ws.mergeCells(rowNumber, START_COL, rowNumber, END_COL);
  ws.getCell(rowNumber, START_COL).value = value;
}

function writeDataRows(ws: Worksheet, startRow: number, rows: ReportRow[], capacity: number, template: RowTemplate): number {
  const count = Math.max(rows.length, capacity);
  for (let i = 0; i < count; i++) {
    writeCells(ws, startRow + i, rows[i] || ['', '', '', '', '', ''], template);
  }
  return startRow + count;
}

function clearMerges(ws: Worksheet): void {
  const merges = [...(ws.model.merges || [])];
  for (const merge of merges) {
    ws.unMergeCells(merge);
  }
}

function insertRows(ws: Worksheet, startRow: number, count: number): void {
  if (count <= 0) return;
  ws.spliceRows(startRow, 0, ...Array.from({ length: count }, () => []));
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

export async function exportDailyReportExcel({
  column,
  name = '木云',
  items,
  candidates,
  date = new Date(),
}: ExportDailyReportArgs): Promise<void> {
  const ExcelJS = await import('exceljs');
  const res = await fetch(TEMPLATE_URL);
  if (!res.ok) throw new Error('日报模板下载失败');

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await res.arrayBuffer());
  workbook.creator = '企鹅岛';
  workbook.created = date;
  const ws = workbook.worksheets[0];

  const titleTemplate = captureRowTemplate(ws, 2);
  const sectionTemplate = captureRowTemplate(ws, 3);
  const interviewSectionTemplate = captureRowTemplate(ws, 8);
  const headerTemplate = captureRowTemplate(ws, 4);
  const dataTemplate = captureRowTemplate(ws, 5);
  const offerSectionTemplate = captureRowTemplate(ws, 18);
  const offerHeaderTemplate = captureRowTemplate(ws, 19);
  const difficultySectionTemplate = captureRowTemplate(ws, 25);
  const difficultyNoteTemplate = captureRowTemplate(ws, 26);
  const offerSectionValue = clone(ws.getCell(18, START_COL).value);

  const workRows = buildWorkRows(items, candidates, date, column);
  const interviewRows = buildPendingInterviewRows(candidates, date, column);
  const offerRows = buildOfferRows(candidates, date, column);
  const workExtra = Math.max(0, workRows.length - WORK_CAPACITY);
  const interviewExtra = Math.max(0, interviewRows.length - INTERVIEW_CAPACITY);
  const offerExtra = Math.max(0, offerRows.length - OFFER_CAPACITY);

  clearMerges(ws);
  insertRows(ws, 8, workExtra);
  insertRows(ws, 18 + workExtra, interviewExtra);
  insertRows(ws, 25 + workExtra + interviewExtra, offerExtra);

  writeMergedRow(ws, 2, `${name}--工作日报表（${date.getMonth() + 1}月${date.getDate()}日）`, titleTemplate);

  let row = 3;
  writeMergedRow(ws, row++, '一、日常工作', sectionTemplate);
  writeCells(ws, row++, ['序号', '负责岗位名称', '推荐简历', '邀约', '面试', '录用'], headerTemplate);
  row = writeDataRows(ws, row, workRows, WORK_CAPACITY, dataTemplate);

  writeMergedRow(ws, row++, '二、待面试清单', interviewSectionTemplate);
  writeCells(ws, row++, ['序号', '渠道', '面试日期', '面试时间', '姓名', '岗位'], headerTemplate);
  row = writeDataRows(ws, row, interviewRows, INTERVIEW_CAPACITY, dataTemplate);

  writeMergedRow(ws, row++, offerSectionValue as import('exceljs').CellRichTextValue, offerSectionTemplate);
  writeCells(ws, row++, ['序号', '岗位名称', '候选人', '待入职时间', '是否入职', '入职时间'], offerHeaderTemplate);
  row = writeDataRows(ws, row, offerRows, OFFER_CAPACITY, dataTemplate);

  writeMergedRow(ws, row++, '四、有无困难点', difficultySectionTemplate);
  applyRowTemplate(ws, row, difficultyNoteTemplate);
  applyRowTemplate(ws, row + 1, difficultyNoteTemplate);
  ws.mergeCells(row, START_COL, row + 1, END_COL);
  ws.getCell(row, START_COL).value = '';

  const output = await workbook.xlsx.writeBuffer();
  const filename = `${name}-工作日报-${localDateKey(date)}.xlsx`;
  downloadBlob(new Blob([output], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
}
