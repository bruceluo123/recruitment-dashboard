'use client';
import { useEffect, useMemo, useState } from 'react';
import { RepushColumn } from './RepushColumn';
import { useRepushStore, type RepushColumnId } from '@/store/repush-store';
import { useJDStore } from '@/store/jd-store';

const MAX_FILE_BYTES = 8 * 1024 * 1024; // 单份简历上限 8MB（base64 存 localStorage）

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function RepushPoolPage() {
  const [mounted, setMounted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const items = useRepushStore((s) => s.items);
  const columnNames = useRepushStore((s) => s.columnNames);
  const addItem = useRepushStore((s) => s.addItem);
  const removeItem = useRepushStore((s) => s.removeItem);
  const setFeedback = useRepushStore((s) => s.setFeedback);
  const setOrganization = useRepushStore((s) => s.setOrganization);
  const renameColumn = useRepushStore((s) => s.renameColumn);

  // 编制组织下拉选项：取 JD 库中所有去重、非空的编制组织
  const jds = useJDStore((s) => s.jds);
  const orgOptions = useMemo(() => {
    const set = new Set<string>();
    for (const jd of jds) {
      const org = jd.organization?.trim();
      if (org) set.add(org);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }, [jds]);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(t);
  }, [error]);

  if (!mounted) return null;

  const handleAddFile = async (column: RepushColumnId, file: File) => {
    if (file.size > MAX_FILE_BYTES) {
      setError(`「${file.name}」超过 8MB，无法保存`);
      return;
    }
    try {
      const dataUrl = await fileToDataUrl(file);
      addItem(column, { fileName: file.name, fileType: file.type || 'application/octet-stream', dataUrl });
    } catch {
      setError(`「${file.name}」读取失败，请重试`);
    }
  };

  const itemsA = items.filter((it) => it.column === 'a');
  const itemsB = items.filter((it) => it.column === 'b');

  return (
    <div className="flex flex-col h-full">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">今日复推池</h1>
        <p className="text-sm text-gray-400 mt-1">两人各自维护当天要复推的简历清单，上传后本地保存、刷新不丢，逐份标记反馈状态。</p>
      </div>

      {error && (
        <div className="mb-4 px-4 py-2.5 rounded-xl bg-red-50 border border-red-100 text-sm text-red-600">{error}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 flex-1 min-h-0">
        <RepushColumn
          columnId="a"
          name={columnNames.a}
          items={itemsA}
          orgOptions={orgOptions}
          onAddFile={handleAddFile}
          onRemove={removeItem}
          onSetFeedback={setFeedback}
          onSetOrganization={setOrganization}
          onRename={renameColumn}
        />
        <RepushColumn
          columnId="b"
          name={columnNames.b}
          items={itemsB}
          orgOptions={orgOptions}
          onAddFile={handleAddFile}
          onRemove={removeItem}
          onSetFeedback={setFeedback}
          onSetOrganization={setOrganization}
          onRename={renameColumn}
        />
      </div>
    </div>
  );
}
