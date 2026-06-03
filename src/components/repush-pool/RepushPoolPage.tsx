'use client';
import { useEffect, useMemo, useState } from 'react';
import { RepushColumn } from './RepushColumn';
import { useRepushStore, type RepushColumnId } from '@/store/repush-store';
import { useJDStore } from '@/store/jd-store';

export function RepushPoolPage() {
  const [mounted, setMounted] = useState(false);

  const items = useRepushStore((s) => s.items);
  const columnNames = useRepushStore((s) => s.columnNames);
  const addItem = useRepushStore((s) => s.addItem);
  const removeItem = useRepushStore((s) => s.removeItem);
  const setFeedback = useRepushStore((s) => s.setFeedback);
  const setOrganization = useRepushStore((s) => s.setOrganization);
  const setDepartment = useRepushStore((s) => s.setDepartment);
  const renameColumn = useRepushStore((s) => s.renameColumn);

  // 编制组织 / 部门下拉选项：取 JD 库中所有去重、非空的对应字段
  const jds = useJDStore((s) => s.jds);
  const orgOptions = useMemo(() => {
    const set = new Set<string>();
    for (const jd of jds) {
      const org = jd.organization?.trim();
      if (org) set.add(org);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }, [jds]);
  const deptOptions = useMemo(() => {
    const set = new Set<string>();
    for (const jd of jds) {
      const dept = jd.department?.trim();
      if (dept) set.add(dept);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }, [jds]);

  useEffect(() => setMounted(true), []);

  if (!mounted) return null;

  // 只识别文件名加入清单，不上传文件本体
  const handleAddFile = (column: RepushColumnId, file: File) => {
    addItem(column, file.name);
  };

  const itemsA = items.filter((it) => it.column === 'a');
  const itemsB = items.filter((it) => it.column === 'b');

  return (
    <div className="flex flex-col h-full">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">今日复推池</h1>
        <p className="text-sm text-gray-400 mt-1">两人各自维护当天要复推的简历清单，仅记录文件名与编制/部门/反馈状态，本地保存、刷新不丢。</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 flex-1 min-h-0">
        <RepushColumn
          columnId="a"
          name={columnNames.a}
          items={itemsA}
          orgOptions={orgOptions}
          deptOptions={deptOptions}
          onAddFile={handleAddFile}
          onRemove={removeItem}
          onSetFeedback={setFeedback}
          onSetOrganization={setOrganization}
          onSetDepartment={setDepartment}
          onRename={renameColumn}
        />
        <RepushColumn
          columnId="b"
          name={columnNames.b}
          items={itemsB}
          orgOptions={orgOptions}
          deptOptions={deptOptions}
          onAddFile={handleAddFile}
          onRemove={removeItem}
          onSetFeedback={setFeedback}
          onSetOrganization={setOrganization}
          onSetDepartment={setDepartment}
          onRename={renameColumn}
        />
      </div>
    </div>
  );
}
