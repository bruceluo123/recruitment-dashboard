'use client';
import { useRef, useState } from 'react';
import { Download, Upload, ShieldCheck, AlertTriangle } from 'lucide-react';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { downloadBackup, parseBackup, restoreBackup, type BackupFile } from '@/lib/backup';

type Pending = { file: BackupFile; keys: number } | null;

/** 设置页：全量数据导出/导入面板，兜底 localStorage 数据丢失。 */
export function BackupPanel() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState('');
  const [pending, setPending] = useState<Pending>(null);
  const [err, setErr] = useState('');

  const handleExport = () => {
    setErr('');
    try {
      const { keys } = downloadBackup();
      setMsg(`已导出备份（${keys} 项数据），请妥善保存到网盘或 U 盘`);
    } catch {
      setErr('导出失败，请重试');
    }
  };

  const handlePick = () => fileInput.current?.click();

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setErr('');
    setMsg('');
    const file = e.target.files?.[0];
    e.target.value = ''; // 允许重复选同一文件
    if (!file) return;
    try {
      const text = await file.text();
      const backup = parseBackup(text);
      setPending({ file: backup, keys: Object.keys(backup.data).length });
    } catch (error: unknown) {
      setErr(error instanceof Error ? error.message : '读取文件失败');
    }
  };

  const confirmRestore = () => {
    if (!pending) return;
    try {
      restoreBackup(pending.file);
      setPending(null);
      setMsg('恢复成功，正在刷新…');
      setTimeout(() => window.location.reload(), 600);
    } catch {
      setErr('恢复失败，请重试');
    }
  };

  return (
    <GlassPanel>
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
          <ShieldCheck className="w-5 h-5 text-emerald-500" />
        </div>
        <div>
          <h3 className="text-base font-semibold text-gray-800">数据备份与恢复</h3>
          <p className="text-sm text-gray-500">导出 JD库 / 推荐 / 面试 / 人才库 全部数据为离线文件</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          onClick={handleExport}
          className="flex items-center gap-2 px-4 h-10 rounded-xl bg-indigo-500 text-white text-sm font-medium hover:bg-indigo-600"
        >
          <Download className="w-4 h-4" />导出备份
        </button>
        <button
          onClick={handlePick}
          className="flex items-center gap-2 px-4 h-10 rounded-xl border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50"
        >
          <Upload className="w-4 h-4" />导入恢复
        </button>
        <input ref={fileInput} type="file" accept="application/json,.json" className="hidden" onChange={handleFile} />
      </div>

      <p className="mt-3 text-xs text-gray-400">
        建议每天或每次大量录入后导出一次。文件本地保存，不依赖任何服务器，换电脑/清缓存后可一键还原。
      </p>

      {msg && <div className="mt-3 text-sm text-emerald-600">{msg}</div>}
      {err && <div className="mt-3 text-sm text-red-500">{err}</div>}

      {pending && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-start gap-2 text-amber-700">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <div className="text-sm">
              即将用备份文件覆盖当前数据（{pending.keys} 项），<b>当前未导出的改动将丢失</b>。确定恢复吗？
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              onClick={confirmRestore}
              className="px-4 h-9 rounded-xl bg-amber-500 text-white text-sm font-medium hover:bg-amber-600"
            >
              确认覆盖恢复
            </button>
            <button
              onClick={() => setPending(null)}
              className="px-4 h-9 rounded-xl border border-gray-200 text-gray-600 text-sm hover:bg-white"
            >
              取消
            </button>
          </div>
        </div>
      )}
    </GlassPanel>
  );
}
