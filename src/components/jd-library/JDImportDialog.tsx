'use client';
import { useState } from 'react';
import { X, Upload, Link, FileSpreadsheet, AlertCircle, Check, Loader2, FileText, ClipboardPaste } from 'lucide-react';
import { useJDStore } from '@/store/jd-store';
import type { JDImportResult } from '@/types/jd';

interface JDImportDialogProps { isOpen: boolean; onClose: () => void; }

// ─── 需求面板「竖排复制」格式还原 ───
// 该面板禁用导出，复制下来是「每个单元格独占一行、空行分隔」的竖排文本：
//   - 每个非空单元格值占一行，后跟 1 个空行作分隔
//   - 空单元格 = 多一个空行（连续 N 个空行 = 1 个分隔符 + (N-1) 个空单元格）
//   - 锚点：需求Key 列恒以「REQ-」开头（记录起点），最后一列恒为字面文字「最近更新」（记录终点）
// 一条记录在 REQ- 与「最近更新」之间还原出固定 20 个字段：
//   [0]需求Key [1]岗位名称 [2]编制组织 [3]服务单位 [4]部门 [5]HC [6]已到岗 [7]缺口
//   [8]已发offer待入职 [9]提需日期 [10]期望到岗日期 [11]优先级 [12]简历对接人 [13]JD
//   [14]薪资范围 [15]备注说明 [16]来源表格 [17]对应ODC [18]对应SSC [19]更新时间
// JD 正文可能自带换行导致中间列变多，故用「前 13 列 + 后 6 列固定、中间全部并入 JD」兜底。
const PANEL_HEADERS = [
  '岗位名称', '编制组织', '服务单位', '部门', 'HC', '缺口', '优先级',
  '简历对接人 (花名 & @TG)', '薪资范围', 'JD 岗位职责与任职要求',
];

function reconstructCells(seg: string[]): string[] {
  const cells = [seg[0].trim()];
  let i = 1;
  const n = seg.length;
  while (i < n) {
    if (seg[i].trim() === '') {
      let blanks = 0;
      while (i < n && seg[i].trim() === '') { blanks++; i++; }
      for (let k = 0; k < blanks - 1; k++) cells.push('');
      if (i >= n) break;
    } else {
      cells.push(seg[i].trim());
      i++;
    }
  }
  return cells;
}

function reconstructPanelVertical(text: string): string[][] | null {
  // 竖排面板格式特征：存在以 REQ- 开头的行（记录起点）和 “最近更新” 行（记录终点）。
  // 注意：序号分隔行可能含制表符，但都落在记录块之外，不影响还原。
  const lines = text.split(/\r?\n/);
  const reqIdx: number[] = [];
  let hasEnd = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith('REQ-')) reqIdx.push(i);
    if (lines[i].trim() === '最近更新') hasEnd = true;
  }
  if (!reqIdx.length || !hasEnd) return null;

  const rows: string[][] = [PANEL_HEADERS];
  for (const ri of reqIdx) {
    let j = ri + 1;
    while (j < lines.length && lines[j].trim() !== '最近更新') j++;
    const cells = reconstructCells(lines.slice(ri, j));
    if (cells.length < 20) continue; // 异常记录，跳过

    const front = cells.slice(0, 13);
    const back = cells.slice(cells.length - 6);
    const jd = cells.slice(13, cells.length - 6).filter(Boolean).join('\n');
    const full = [...front, jd, ...back]; // 恒为 20 列
    rows.push([
      full[1], full[2], full[3], full[4], full[5], // 岗位名称/编制组织/服务单位/部门/HC
      full[7], full[11], full[12], full[14], full[13], // 缺口/优先级/简历对接人/薪资范围/JD
    ]);
  }
  return rows.length > 1 ? rows : null;
}

/** 把粘贴的表格文本解析为二维数组。优先级：
 *  1) 需求面板竖排格式（含 REQ- 锚点、无制表符）→ 专用还原
 *  2) 复制带的 HTML 表格 → DOM 解析（能正确处理含换行的单元格）
 *  3) 退回 TSV（制表符分列、换行分行） */
function parsePastedTable(plain: string, html?: string): string[][] {
  const panel = reconstructPanelVertical(plain);
  if (panel) return panel;

  if (html && /<table/i.test(html)) {
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const rows = Array.from(doc.querySelectorAll('tr'))
        .map((tr) => Array.from(tr.querySelectorAll('th,td')).map((c) => (c.textContent || '').trim()))
        .filter((r) => r.some(Boolean));
      if (rows.length) return rows;
    } catch { /* 退回 TSV */ }
  }
  return plain
    .split(/\r?\n/)
    .map((line) => line.split('\t').map((c) => c.trim()))
    .filter((r) => r.some(Boolean));
}

export function JDImportDialog({ isOpen, onClose }: JDImportDialogProps) {
  const [tab, setTab] = useState<'excel' | 'sheet' | 'paste'>('excel');
  const [file, setFile] = useState<File | null>(null);
  const [sheetUrl, setSheetUrl] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [result, setResult] = useState<JDImportResult | null>(null);
  const isImporting = useJDStore((s) => s.isImporting);
  const progress = useJDStore((s) => s.importProgress);
  const importFromExcel = useJDStore((s) => s.importFromExcel);
  const cancelImport = useJDStore((s) => s.cancelImport);

  if (!isOpen) return null;

  const handleFileImport = async () => {
    if (!file) return;
    setResult(null);
    setResult(await importFromExcel(file));
  };

  const handleSheetImport = async () => {
    if (!sheetUrl) return;
    setResult(null);
    try {
      const res = await fetch('/api/import/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: sheetUrl }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || '无法访问链接');
      }

      const blob = await res.blob();
      if (blob.type.startsWith('text/')) {
        const text = await blob.text();
        const XLSX = await import('xlsx');
        const ws = XLSX.utils.json_to_sheet([{ '岗位名称': '', '岗位内容': text }]);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
        const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        setResult(await importFromExcel(new File([buffer], 'google-doc.xlsx')));
      } else {
        setResult(await importFromExcel(new File([blob], 'google-sheet.xlsx')));
      }
    } catch (err) {
      setResult({ success: 0, failed: 1, errors: [(err as Error).message || '无法访问链接，请确认 Google 文档已开放查看权限'] });
    }
  };

  const handlePasteImport = async (rows: string[][]) => {
    setResult(null);
    if (rows.length < 2) {
      setResult({ success: 0, failed: 1, errors: ['没有可识别的表格数据，请先选中表格再复制粘贴（需包含表头行）'] });
      return;
    }
    try {
      const XLSX = await import('xlsx');
      const ws = XLSX.utils.aoa_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
      const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      setResult(await importFromExcel(new File([buffer], 'pasted-table.xlsx')));
    } catch (err) {
      setResult({ success: 0, failed: 1, errors: [(err as Error).message || '粘贴内容解析失败'] });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/30" onClick={isImporting ? undefined : onClose} />
      <div className="relative w-full max-w-lg bg-white border border-gray-200 rounded-2xl shadow-xl animate-fade-in">
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-800">导入 JD 数据</h2>
          {!isImporting && <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>}
        </div>

        <div className="flex border-b border-gray-100 mx-6 mt-4">
          {[
            { id: 'excel' as const, label: 'Excel 文件', icon: FileSpreadsheet },
            { id: 'paste' as const, label: '粘贴表格', icon: ClipboardPaste },
            { id: 'sheet' as const, label: 'Google 文档', icon: Link },
          ].map((t) => (
            <button key={t.id} onClick={() => { if (!isImporting) { setTab(t.id); setResult(null); } }}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-all ${tab === t.id ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-gray-400 hover:text-gray-600'} ${isImporting ? 'opacity-50 cursor-not-allowed' : ''}`}>
              <t.icon className="w-4 h-4" />{t.label}
            </button>
          ))}
        </div>

        <div className="p-6 space-y-4">
          {/* Progress bar */}
          {isImporting && progress.status === 'parsing' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600 flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />
                  正在解析...
                </span>
                <span className="text-gray-400">{progress.current}/{progress.total} 行</span>
              </div>
              <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-indigo-500 to-cyan-500 rounded-full transition-all duration-150" style={{ width: `${progress.percent}%` }} />
              </div>
              <button onClick={cancelImport} className="w-full h-9 rounded-xl border border-red-200 text-red-500 text-sm font-medium hover:bg-red-50 transition-all">
                取消导入
              </button>
            </div>
          )}

          {isImporting && progress.status === 'reading' && (
            <div className="space-y-2">
              <div className="flex items-center gap-3 py-4 justify-center text-gray-500">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="text-sm">读取文件中...</span>
              </div>
              <button onClick={cancelImport} className="w-full h-9 rounded-xl border border-red-200 text-red-500 text-sm font-medium hover:bg-red-50 transition-all">
                取消导入
              </button>
            </div>
          )}

          {/* Upload area (hidden during import) */}
          {!isImporting && tab === 'excel' && (
            <>
              <label className="flex flex-col items-center justify-center gap-3 p-8 border-2 border-dashed border-gray-200 rounded-xl cursor-pointer hover:border-indigo-300 transition-all bg-gray-50">
                <Upload className="w-8 h-8 text-gray-400" />
                <div className="text-center">
                  <p className="text-sm text-gray-600">拖拽或点击上传 Excel 文件</p>
                  <p className="text-xs text-gray-400 mt-1">支持 .xlsx / .xls 格式</p>
                </div>
                {file && <p className="text-sm text-indigo-600 font-medium flex items-center gap-1.5"><FileText className="w-3.5 h-3.5" />{file.name}</p>}
                <input type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
              </label>
              <button onClick={handleFileImport} disabled={!file} className="w-full h-10 rounded-xl bg-indigo-500 text-white text-sm font-medium hover:bg-indigo-600 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                <Upload className="w-4 h-4" />开始导入
              </button>
            </>
          )}

          {!isImporting && tab === 'paste' && (
            <>
              <div>
                <label className="block text-sm text-gray-600 mb-1.5">粘贴表格内容</label>
                <textarea
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  onPaste={(e) => {
                    const html = e.clipboardData.getData('text/html');
                    const plain = e.clipboardData.getData('text/plain');
                    if (html && /<table/i.test(html)) {
                      e.preventDefault();
                      const rows = parsePastedTable(plain, html);
                      setPasteText(rows.map((r) => r.join('\t')).join('\n'));
                    }
                  }}
                  rows={8}
                  placeholder="在需求汇总面板里全选（Ctrl+A）整页表格，Ctrl+C 复制，然后在此处 Ctrl+V 粘贴。每页粘一次、可多页累加，重复内容自动去重。"
                  className="w-full px-4 py-3 rounded-xl bg-white border border-gray-200 text-xs font-mono leading-relaxed focus:outline-none focus:border-indigo-300 transition-all resize-y"
                />
                <p className="text-xs text-gray-400 mt-1.5">
                  自动识别需求面板的竖排复制格式，提取 岗位名称 / 编制组织 / 服务单位 / 部门 / HC / 缺口 / 优先级 / 对接人 / 薪资 / JD，按岗位名称+部门查重去重
                </p>
              </div>
              <button
                onClick={() => handlePasteImport(parsePastedTable(pasteText))}
                disabled={!pasteText.trim()}
                className="w-full h-10 rounded-xl bg-indigo-500 text-white text-sm font-medium hover:bg-indigo-600 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <ClipboardPaste className="w-4 h-4" />解析并导入
              </button>
            </>
          )}

          {!isImporting && tab === 'sheet' && (
            <>
              <div>
                <label className="block text-sm text-gray-600 mb-1.5">Google Sheets / Docs 分享链接</label>
                <input value={sheetUrl} onChange={(e) => setSheetUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/... 或 /document/d/..." className="w-full h-10 px-4 rounded-xl bg-white border border-gray-200 text-sm focus:outline-none focus:border-indigo-300 transition-all" />
                <p className="text-xs text-gray-400 mt-1.5">支持开放查看的 Google 表格/文档，每次点击都会读取最新内容并自动查重</p>
              </div>
              <button onClick={handleSheetImport} disabled={!sheetUrl} className="w-full h-10 rounded-xl bg-indigo-500 text-white text-sm font-medium hover:bg-indigo-600 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                <Link className="w-4 h-4" />从 Google 导入最新 JD
              </button>
            </>
          )}

          {/* Result summary */}
          {result && !isImporting && (
            <div className={`p-4 rounded-xl border ${result.failed === 0 ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
              <div className="flex items-center gap-2 mb-2">
                {result.failed === 0 ? <Check className="w-5 h-5 text-green-500" /> : <AlertCircle className="w-5 h-5 text-amber-500" />}
                <span className="text-sm font-medium text-gray-800">成功 {result.success} 条{result.failed > 0 && `，失败 ${result.failed} 条`}</span>
              </div>
              {result.errors.length > 0 && (
                <ul className="space-y-0.5 mt-2">{result.errors.slice(0, 5).map((e, i) => <li key={i} className="text-xs text-red-500">{e}</li>)}</ul>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
