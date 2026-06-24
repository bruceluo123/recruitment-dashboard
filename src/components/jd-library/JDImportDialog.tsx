'use client';
import { useState } from 'react';
import { X, Upload, Link, FileSpreadsheet, AlertCircle, Check, Loader2, FileText, ClipboardPaste } from 'lucide-react';
import { useJDStore } from '@/store/jd-store';
import type { JDImportResult } from '@/types/jd';
import { parsePastedTable, pastedRowsToFile } from '@/lib/panel-paste';

interface JDImportDialogProps { isOpen: boolean; onClose: () => void; }

export function JDImportDialog({ isOpen, onClose }: JDImportDialogProps) {
  const [tab, setTab] = useState<'excel' | 'sheet' | 'paste'>('excel');
  const [file, setFile] = useState<File | null>(null);
  const [sheetUrl, setSheetUrl] = useState('');
  const [pasteText, setPasteText] = useState('');
  // 覆盖模式：用本次导入替换整个岗位库（适合每天粘贴完整面板做同步）。默认关闭=增量合并。
  const [replaceMode, setReplaceMode] = useState(false);
  const [result, setResult] = useState<JDImportResult | null>(null);
  const isImporting = useJDStore((s) => s.isImporting);
  const progress = useJDStore((s) => s.importProgress);
  const importFromExcel = useJDStore((s) => s.importFromExcel);
  const cancelImport = useJDStore((s) => s.cancelImport);

  if (!isOpen) return null;

  const mode = replaceMode ? 'replace' : 'merge';

  const handleFileImport = async () => {
    if (!file) return;
    setResult(null);
    setResult(await importFromExcel(file, mode));
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
        setResult(await importFromExcel(new File([buffer], 'google-doc.xlsx'), mode));
      } else {
        setResult(await importFromExcel(new File([blob], 'google-sheet.xlsx'), mode));
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
      setResult(await importFromExcel(await pastedRowsToFile(rows), mode));
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
                  自动识别需求面板的竖排复制格式，提取 岗位名称 / 编制组织 / 服务单位 / 部门 / HC / 缺口 / 优先级 / 对接人 / 薪资 / JD，按需求Key(REQ-xxx)查重
                </p>
              </div>
              <label className="flex items-start gap-2.5 px-3.5 py-3 rounded-xl border border-gray-200 bg-gray-50 cursor-pointer hover:border-indigo-300 transition-all">
                <input type="checkbox" checked={replaceMode} onChange={(e) => setReplaceMode(e.target.checked)} className="mt-0.5 w-4 h-4 accent-indigo-500" />
                <span className="text-xs leading-relaxed">
                  <span className="font-medium text-gray-700">覆盖模式（每日同步推荐）</span>
                  <span className="block text-gray-400 mt-0.5">用这一次粘贴<b className="text-gray-600">替换整个岗位库</b>：新增 / 更新 / 删除一步到位，面板里没有的岗位会被移除。请<b className="text-gray-600">一次性粘贴完整面板</b>，不要分页粘。关闭则为增量合并（只新增、不删不改）。</span>
                </span>
              </label>
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
                <span className="text-sm font-medium text-gray-800">
                  {result.replaced !== undefined
                    ? `已覆盖：岗位库现为 ${result.replaced} 个岗位`
                    : `新增 ${result.success} 条`}
                  {result.failed > 0 && `，失败 ${result.failed} 条`}
                  {result.skipped ? `，跳过 ${result.skipped} 条已存在` : ''}
                </span>
              </div>
              {result.errors.length > 0 && (
                <ul className="space-y-0.5 mt-2">{result.errors.slice(0, 5).map((e, i) => <li key={i} className={`text-xs ${result.failed > 0 ? 'text-red-500' : 'text-gray-500'}`}>{e}</li>)}</ul>
              )}
              {/* Diff summary — only shown in replace mode */}
              {(result.added?.length || result.removed?.length || result.changed?.length) ? (
                <div className="mt-3 pt-3 border-t border-green-200 space-y-2.5">
                  {result.added && result.added.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-green-700 mb-1">🟢 新增 {result.added.length} 个岗位</p>
                      <ul className="space-y-0.5 pl-2">
                        {result.added.slice(0, 5).map((d, i) => (
                          <li key={i} className="text-xs text-gray-600">· {d.title}{(d.organization || d.department) ? <span className="text-gray-400 ml-1">{[d.organization, d.department].filter(Boolean).join(' · ')}</span> : null}</li>
                        ))}
                        {result.added.length > 5 && <li className="text-xs text-gray-400">...还有 {result.added.length - 5} 个</li>}
                      </ul>
                    </div>
                  )}
                  {result.removed && result.removed.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-red-600 mb-1">🔴 移除 {result.removed.length} 个岗位</p>
                      <ul className="space-y-0.5 pl-2">
                        {result.removed.slice(0, 5).map((d, i) => (
                          <li key={i} className="text-xs text-gray-600">· {d.title}{(d.organization || d.department) ? <span className="text-gray-400 ml-1">{[d.organization, d.department].filter(Boolean).join(' · ')}</span> : null}</li>
                        ))}
                        {result.removed.length > 5 && <li className="text-xs text-gray-400">...还有 {result.removed.length - 5} 个</li>}
                      </ul>
                    </div>
                  )}
                  {result.changed && result.changed.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-amber-600 mb-1">🟡 异动 {result.changed.length} 个岗位</p>
                      <ul className="space-y-0.5 pl-2">
                        {result.changed.slice(0, 8).map((d, i) => (
                          <li key={i} className="text-xs text-gray-600">
                            · {d.title}
                            {d.changes && d.changes.length > 0 && (
                              <span className="text-amber-600 ml-1">— {d.changes.join('，')}</span>
                            )}
                          </li>
                        ))}
                        {result.changed.length > 8 && <li className="text-xs text-gray-400">...还有 {result.changed.length - 8} 个</li>}
                      </ul>
                    </div>
                  )}
                </div>
              ) : result.replaced !== undefined && (
                <p className="mt-2 text-xs text-gray-400">与上次相比无岗位新增、移除或异动。</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
