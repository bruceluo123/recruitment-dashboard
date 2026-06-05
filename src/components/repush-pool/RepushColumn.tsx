'use client';
import { Upload, FileText, Trash2, Check, X, Pencil, Copy } from 'lucide-react';
import { useRef, useState } from 'react';
import { cn, formatDate } from '@/lib/utils';
import type { RepushColumnId, RepushItem } from '@/store/repush-store';

interface RepushColumnProps {
  columnId: RepushColumnId;
  name: string;
  items: RepushItem[];
  orgOptions: string[];
  deptOptions: string[];
  onAddFile: (column: RepushColumnId, file: File) => void;
  onRemove: (id: string) => void;
  onSetFeedback: (id: string, feedback: 'done' | 'pending') => void;
  onSetOrganization: (id: string, organization: string) => void;
  onSetDepartment: (id: string, department: string) => void;
  onRename: (column: RepushColumnId, name: string) => void;
}

const ACCEPTED_EXT = /\.(pdf|docx?)$/i;

export function RepushColumn({ columnId, name, items, orgOptions, deptOptions, onAddFile, onRemove, onSetFeedback, onSetOrganization, onSetDepartment, onRename }: RepushColumnProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(name);
  const [copied, setCopied] = useState(false);

  const pickFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    Array.from(files)
      .filter((f) => ACCEPTED_EXT.test(f.name))
      .forEach((f) => onAddFile(columnId, f));
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    pickFiles(e.dataTransfer.files);
  };

  const doneCount = items.filter((it) => it.feedback === 'done').length;
  const pendingItems = items.filter((it) => it.feedback === 'pending');

  // 一键复制未反馈人选，格式：
  // 未反馈清单：
  // 1、名字-岗位——编制-部门
  // （文件名本身即「名字-岗位」；编制/部门未选则留空）
  const handleCopyPending = async () => {
    if (!pendingItems.length) return;
    const lines = pendingItems.map((it, i) => {
      const base = it.fileName.replace(/\.(pdf|docx?)$/i, '').trim();
      const org = it.organization || '';
      const dept = it.department || '';
      return `${i + 1}、${base}——${org}-${dept}`;
    });
    const text = ['未反馈清单：', ...lines].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // 剪贴板不可用时静默忽略
    }
  };

  return (
    <div className="flex flex-col h-full bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
      {/* 标题栏 */}
      <div className="flex items-center justify-between gap-2 px-5 py-4 border-b border-gray-100">
        {editingName ? (
          <input
            autoFocus
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={() => { onRename(columnId, nameDraft); setEditingName(false); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { onRename(columnId, nameDraft); setEditingName(false); } }}
            className="flex-1 min-w-0 text-sm font-semibold text-gray-800 border-b border-indigo-300 outline-none px-1 py-0.5"
          />
        ) : (
          <button
            onClick={() => { setNameDraft(name); setEditingName(true); }}
            className="group flex items-center gap-1.5 text-sm font-semibold text-gray-800 min-w-0"
            title="点击重命名"
          >
            <span className="truncate">{name}</span>
            <Pencil className="w-3.5 h-3.5 text-gray-300 group-hover:text-indigo-400 shrink-0" />
          </button>
        )}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleCopyPending}
            disabled={pendingItems.length === 0}
            className={cn(
              'flex items-center gap-1 px-2 h-7 rounded-lg text-xs font-medium border transition-all',
              copied
                ? 'border-green-200 bg-green-50 text-green-600'
                : pendingItems.length === 0
                  ? 'border-gray-100 text-gray-300 cursor-not-allowed'
                  : 'border-indigo-200 bg-indigo-50 text-indigo-600 hover:bg-indigo-100',
            )}
            title="复制未反馈人选（未反馈清单：序号、名字-岗位——编制-部门）"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? '已复制' : `复制未反馈 ${pendingItems.length}`}
          </button>
          <span className="text-xs text-gray-400">已反馈 {doneCount}/{items.length}</span>
        </div>
      </div>

      {/* 上传区 */}
      <div
        onClick={() => inputRef.current?.click()}
        onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); }}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); }}
        onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(false); }}
        onDrop={handleDrop}
        className={cn(
          'm-4 flex flex-col items-center justify-center gap-2 p-6 border-2 border-dashed rounded-xl cursor-pointer transition-all group',
          isDragging ? 'border-indigo-400 bg-indigo-50/70' : 'border-gray-200 bg-gray-50 hover:border-indigo-300',
        )}
      >
        <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center transition-all', isDragging ? 'bg-indigo-200' : 'bg-indigo-100 group-hover:bg-indigo-200')}>
          <Upload className="w-5 h-5 text-indigo-500" />
        </div>
        <p className="text-sm text-gray-600">{isDragging ? '松开即可添加' : '拖拽简历到此处，或点击上传'}</p>
        <p className="text-xs text-gray-400">支持 PDF / DOCX，可多选</p>
        <input ref={inputRef} type="file" multiple accept=".pdf,.docx,.doc" className="hidden"
          onChange={(e) => { pickFiles(e.target.files); e.target.value = ''; }} />
      </div>

      {/* 简历清单 */}
      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2">
        {items.length === 0 ? (
          <p className="text-center text-xs text-gray-300 py-8">今日还没有简历</p>
        ) : (
          items.map((it) => {
            const base = it.fileName.replace(/\.(pdf|docx?)$/i, '').trim();
            return (
              <div key={it.id} className="group p-3 rounded-xl border border-gray-100 bg-white hover:bg-gray-50 transition-all space-y-2.5">
                {/* 第一行：文件名（独占整行，完整可见）+ 反馈/删除 */}
                <div className="flex items-start gap-2.5">
                  <FileText className="w-5 h-5 text-gray-400 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-700 break-words leading-snug" title={it.fileName}>{base}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{formatDate(it.uploadedAt)}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => onSetFeedback(it.id, 'done')}
                      className={cn('p-1.5 rounded-lg transition-all', it.feedback === 'done' ? 'bg-green-100 text-green-600' : 'text-gray-300 hover:text-green-500 hover:bg-green-50')}
                      title="已反馈"
                    >
                      <Check className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => onSetFeedback(it.id, 'pending')}
                      className={cn('p-1.5 rounded-lg transition-all', it.feedback === 'pending' ? 'bg-red-100 text-red-500' : 'text-gray-300 hover:text-red-500 hover:bg-red-50')}
                      title="未反馈"
                    >
                      <X className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => onRemove(it.id)}
                      className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-all opacity-0 group-hover:opacity-100"
                      title="删除"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* 第二行：编制 + 部门，各占一半宽度 */}
                <div className="flex items-center gap-2 pl-7">
                  <select
                    value={it.organization || ''}
                    onChange={(e) => onSetOrganization(it.id, e.target.value)}
                    className={cn(
                      'flex-1 min-w-0 h-8 px-2 rounded-lg border text-xs outline-none transition-colors cursor-pointer',
                      it.organization ? 'border-indigo-200 bg-indigo-50 text-indigo-700' : 'border-gray-200 bg-white text-gray-400',
                    )}
                    title="选择编制组织"
                  >
                    <option value="">选择编制</option>
                    {orgOptions.map((org) => (
                      <option key={org} value={org}>{org}</option>
                    ))}
                    {it.organization && !orgOptions.includes(it.organization) && (
                      <option value={it.organization}>{it.organization}</option>
                    )}
                  </select>
                  <select
                    value={it.department || ''}
                    onChange={(e) => onSetDepartment(it.id, e.target.value)}
                    className={cn(
                      'flex-1 min-w-0 h-8 px-2 rounded-lg border text-xs outline-none transition-colors cursor-pointer',
                      it.department ? 'border-cyan-200 bg-cyan-50 text-cyan-700' : 'border-gray-200 bg-white text-gray-400',
                    )}
                    title="选择部门"
                  >
                    <option value="">选择部门</option>
                    {deptOptions.map((dept) => (
                      <option key={dept} value={dept}>{dept}</option>
                    ))}
                    {it.department && !deptOptions.includes(it.department) && (
                      <option value={it.department}>{it.department}</option>
                    )}
                  </select>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
