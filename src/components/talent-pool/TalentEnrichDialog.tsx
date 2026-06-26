'use client';
import { useState, useCallback, useRef } from 'react';
import {
  X, Upload, CheckCircle2, XCircle, AlertCircle, Loader2, FileText, PlusCircle,
} from 'lucide-react';
import { useTalentStore } from '@/store/talent-store';
import { generateId } from '@/lib/utils';
import {
  parseEnrichFileName, findTalentMatch, enrichResumeText, type EnrichFields,
} from '@/lib/resume-enrich';

// ─── Types ────────────────────────────────────────────────────────────────────

type RowStatus = 'pending' | 'uploading' | 'parsing' | 'enriching' | 'done' | 'created' | 'failed';

interface EnrichRow {
  fileName: string;
  parsedName: string;
  status: RowStatus;
  talentId?: string;
  talentName?: string;
  error?: string;
  fields?: EnrichFields;
}

const STATUS_LABEL: Record<RowStatus, string> = {
  pending: '等待中',
  uploading: '上传中',
  parsing: '提取文字',
  enriching: 'AI 解析',
  done: '已回填',
  created: '已新建',
  failed: '失败',
};

const CONCURRENCY = 3;
const UPLOAD_TIMEOUT = 60_000;

/** 检查提取出的名字是否有效（含至少一个汉字或字母）。 */
function isValidName(name: string): boolean {
  return /[\u4e00-\u9fff\u0041-\u005a\u0061-\u007a]/i.test(name);
}

/** 从文件名提取显示用名称；若解析结果无效则回退到去扩展名的文件名。 */
function displayNameFromFile(file: File): string {
  const { name } = parseEnrichFileName(file.name);
  if (isValidName(name)) return name;
  return file.name.replace(/\.(pdf|docx?)$/i, '').trim() || file.name;
}

// ─── Upload helper (mirrors talent-store logic) ───────────────────────────────

async function uploadFile(
  file: File,
  signal: AbortSignal,
): Promise<{ resumeUrl: string; resumeFileName: string } | null> {
  const timer = new AbortController();
  const timeout = setTimeout(() => timer.abort(), UPLOAD_TIMEOUT);
  const onStop = () => timer.abort();
  signal.addEventListener('abort', onStop);
  try {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/talent/upload', { method: 'POST', body: fd, signal: timer.signal });
    if (!res.ok) return null;
    const data = (await res.json()) as { url?: string; downloadUrl?: string; fileName?: string };
    if (!data?.url) return null;
    return {
      resumeUrl: data.downloadUrl || data.url,
      resumeFileName: data.fileName || file.name,
    };
  } catch { return null; }
  finally { clearTimeout(timeout); signal.removeEventListener('abort', onStop); }
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props { isOpen: boolean; onClose: () => void; }

export function TalentEnrichDialog({ isOpen, onClose }: Props) {
  const { talents, updateTalent, addTalent } = useTalentStore();
  const [files, setFiles] = useState<File[]>([]);
  const [rows, setRows] = useState<EnrichRow[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const patchRow = useCallback((i: number, patch: Partial<EnrichRow>) => {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }, []);

  const handleFiles = useCallback((incoming: File[]) => {
    const valid = incoming.filter((f) => /\.(pdf|docx?)$/i.test(f.name));
    setFiles(valid);
    setRows([]);
    setIsDone(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => { e.preventDefault(); handleFiles(Array.from(e.dataTransfer.files)); },
    [handleFiles],
  );

  const handleStart = useCallback(async () => {
    if (!files.length) return;
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;

    const initial: EnrichRow[] = files.map((f) => ({
      fileName: f.name,
      parsedName: displayNameFromFile(f),
      status: 'pending' as RowStatus,
    }));
    setRows(initial);
    setIsRunning(true);
    setIsDone(false);

    let cursor = 0;

    const processOne = async (i: number) => {
      if (signal.aborted) return;
      const file = files[i];
      const { name: rawName, jobTitle } = parseEnrichFileName(file.name);
      // 若解析出的姓名无汉字或字母（如 "."），回退到文件名本身
      const name = isValidName(rawName)
        ? rawName
        : file.name.replace(/\.(pdf|docx?)$/i, '').trim() || file.name;

      // 1. 按「姓名+岗位」匹配人才库，决定是更新还是新建
      const match = findTalentMatch(talents, name, jobTitle);
      const targetId = match.action === 'update' && match.talent ? match.talent.id : generateId();
      const targetName = match.talent?.name ?? name;

      patchRow(i, { status: 'uploading', talentId: targetId, talentName: targetName });

      try {
        // 2. 上传文件
        const uploaded = await uploadFile(file, signal);
        if (signal.aborted) return;
        if (!uploaded) throw new Error('文件上传失败');
        const { resumeUrl, resumeFileName } = uploaded;

        // 3. 提取文字
        patchRow(i, { status: 'parsing' });
        const parseRes = await fetch('/api/resume/parse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: resumeUrl, fileName: resumeFileName }),
          signal,
        });
        if (signal.aborted) return;
        const parseData = (await parseRes.json()) as { text?: string; error?: string };
        if (parseData.error) throw new Error(parseData.error);
        const text = parseData.text || '';
        if (!text) throw new Error('简历文字提取为空');

        // 4. 存入 KV（供后续 JD 匹配使用）
        await fetch('/api/talent/text', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: targetId, text }),
          signal,
        }).catch(() => { /* KV 存储失败不阻塞流程 */ });

        // 5. AI 结构化提取
        patchRow(i, { status: 'enriching' });
        const fields = await enrichResumeText(text, signal);
        if (signal.aborted) return;

        const enriched = {
          resumeUrl,
          resumeFileName,
          hasResumeText: true,
          resumeChars: text.replace(/\s+/g, '').length,
          ...(fields.company ? { company: fields.company } : {}),
          ...(fields.prevCompanies?.length ? { prevCompanies: fields.prevCompanies } : {}),
          ...(fields.techDirection ? { techDirection: fields.techDirection } : {}),
          ...(fields.eduLevel ? { eduLevel: fields.eduLevel } : {}),
          ...(fields.school ? { school: fields.school } : {}),
          ...(fields.gradYear ? { gradYear: fields.gradYear } : {}),
          ...(fields.categories?.length ? { categories: fields.categories } : {}),
        };

        if (match.action === 'update' && match.talent) {
          // 规则1/3：同名同岗 或 仅姓名匹配 → 更新现有档案
          updateTalent(match.talent.id, enriched);
          patchRow(i, { status: 'done', fields });
        } else {
          // 规则2/4：同名不同岗 或 完全无匹配 → 新建档案
          addTalent({
            id: targetId,
            name,
            jobTitle: jobTitle || fields.company || '',
            categories: fields.categories ?? [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            ...enriched,
          });
          patchRow(i, { status: 'created', fields });
        }
      } catch (err) {
        if (signal.aborted) return;
        patchRow(i, { status: 'failed', error: (err as Error).message });
      }
    };

    const worker = async () => {
      while (!signal.aborted) {
        const i = cursor++;
        if (i >= files.length) return;
        await processOne(i);
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, files.length) }, () => worker()),
    );

    if (!signal.aborted) {
      setIsRunning(false);
      setIsDone(true);
    }
    abortRef.current = null;
  }, [files, talents, updateTalent, patchRow]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    setIsRunning(false);
    setIsDone(true);
  }, []);

  const handleClose = useCallback(() => {
    if (isRunning) abortRef.current?.abort();
    setFiles([]);
    setRows([]);
    setIsDone(false);
    setIsRunning(false);
    onClose();
  }, [isRunning, onClose]);

  if (!isOpen) return null;

  // ─── Derived counts ──────────────────────────────────────────────────────
  const doneCount = rows.filter((r) => r.status === 'done').length;
  const createdCount = rows.filter((r) => r.status === 'created').length;
  const failedCount = rows.filter((r) => r.status === 'failed').length;
  const processedCount = rows.filter((r) => r.status !== 'pending').length;
  const progress = rows.length ? Math.round((processedCount / rows.length) * 100) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/30" onClick={isRunning ? undefined : handleClose} />
      <div className="relative w-full max-w-2xl bg-white border border-gray-200 rounded-2xl shadow-xl flex flex-col max-h-[85vh]">

        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-100 shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-gray-800">批量充实档案</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              上传简历 PDF / DOCX → AI 提取技能、学历、经历 → 按姓名回填到对应人选档案
            </p>
          </div>
          {!isRunning && (
            <button onClick={handleClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">

          {/* File picker */}
          {!isRunning && !isDone && (
            <label
              className="flex flex-col items-center justify-center gap-3 p-8 border-2 border-dashed border-gray-200 rounded-xl cursor-pointer hover:border-indigo-300 transition-all bg-gray-50"
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
            >
              <Upload className="w-8 h-8 text-gray-400" />
              <div className="text-center space-y-1">
                <p className="text-sm text-gray-600">点击或拖拽选择简历文件（可多选）</p>
                <p className="text-xs text-gray-400">支持 PDF / DOCX · 文件命名：姓名-岗位.pdf 或 姓名  岗位.pdf</p>
                <p className="text-xs text-gray-400">按姓名与人才库匹配，AI 提取技能/学历/经历后自动回填</p>
              </div>
              {files.length > 0 && (
                <span className="text-sm font-medium text-indigo-600">已选 {files.length} 份文件</span>
              )}
              <input
                type="file" accept=".pdf,.docx" multiple className="hidden"
                onChange={(e) => handleFiles(Array.from(e.target.files || []))}
              />
            </label>
          )}

          {/* Progress bar */}
          {(isRunning || isDone) && rows.length > 0 && (
            <div>
              <div className="flex items-center justify-between text-sm mb-2">
                <span className="text-gray-600">
                  {isRunning
                    ? `处理中… ${processedCount} / ${rows.length}`
                    : `完成：回填 ${doneCount}${createdCount ? ` · 新建 ${createdCount}` : ''}${failedCount ? ` · 失败 ${failedCount}` : ''}`}
                </span>
                <span className="text-gray-400 text-xs">{progress}%</span>
              </div>
              <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    isDone && failedCount === 0
                      ? 'bg-emerald-500'
                      : 'bg-gradient-to-r from-indigo-500 to-cyan-500'
                  }`}
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {/* Per-file list */}
          {rows.length > 0 && (
            <div className="space-y-1 max-h-72 overflow-y-auto pr-1">
              {rows.map((row, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-gray-50 text-sm"
                >
                  {row.status === 'done' && <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />}
                  {row.status === 'created' && <PlusCircle className="w-4 h-4 text-blue-500 shrink-0" />}
                  {row.status === 'failed' && <XCircle className="w-4 h-4 text-red-400 shrink-0" />}
                  {row.status === 'pending' && <FileText className="w-4 h-4 text-gray-300 shrink-0" />}
                  {(['uploading', 'parsing', 'enriching'] as RowStatus[]).includes(row.status) && (
                    <Loader2 className="w-4 h-4 text-indigo-500 animate-spin shrink-0" />
                  )}

                  <span className="flex-1 truncate text-gray-700">
                    {row.parsedName || row.fileName}
                  </span>

                  <span className={`text-xs shrink-0 ${
                    row.status === 'done' ? 'text-emerald-600' :
                    row.status === 'created' ? 'text-blue-500' :
                    row.status === 'failed' ? 'text-red-500' :
                    (['uploading', 'parsing', 'enriching'] as RowStatus[]).includes(row.status)
                      ? 'text-indigo-500' : 'text-gray-400'
                  }`}>
                    {(row.status === 'done' || row.status === 'created') && row.fields?.company
                      ? `${row.status === 'created' ? '+ ' : '✓ '}${row.fields.company}`
                      : row.status === 'failed'
                      ? (row.error?.slice(0, 28) ?? '失败')
                      : STATUS_LABEL[row.status]}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* New talent hint */}
          {isDone && createdCount > 0 && (
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
              <p className="text-xs font-medium text-blue-700">
                已为 {createdCount} 份简历新建人选档案（无同名同岗匹配）
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-gray-100 shrink-0">
          {isRunning ? (
            <>
              <span className="text-xs text-gray-400">每份简历约需 10–20 秒，并发 {CONCURRENCY} 份处理中…</span>
              <button
                onClick={handleStop}
                className="h-9 px-4 rounded-xl border border-red-200 text-red-500 text-sm font-medium hover:bg-red-50 transition-all"
              >停止</button>
            </>
          ) : isDone ? (
            <>
              <span className="text-xs text-gray-400">档案已充实，可前往人才库查看各人选详情</span>
              <button
                onClick={handleClose}
                className="h-9 px-4 rounded-xl bg-indigo-500 text-white text-sm font-medium hover:bg-indigo-600 transition-all"
              >完成</button>
            </>
          ) : (
            <>
              <span className="text-xs text-gray-400">
                {files.length > 0
                  ? `${files.length} 份文件已选，AI 解析约 ${Math.ceil(files.length / CONCURRENCY * 15)} 秒`
                  : '请先选择简历文件'}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={handleClose}
                  className="h-9 px-4 rounded-xl border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-50 transition-all"
                >取消</button>
                <button
                  onClick={handleStart}
                  disabled={!files.length}
                  className="h-9 px-4 rounded-xl bg-indigo-500 text-white text-sm font-medium hover:bg-indigo-600 transition-all disabled:opacity-50"
                >开始充实</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
