// 全量数据备份/恢复：直接导出/还原各 Zustand store 的 localStorage 原始快照。
// 不解析 store 内部结构，按原始字符串存取，最大程度避免版本/结构变化导致的恢复失败。

const STORE_KEYS = [
  'recruitai-jd-store',
  'recruitai-repush-store',
  'recruitai-interview-store',
  'recruitai-talent-store',
] as const;

const MAGIC = 'qieqiuzhidao-backup';

export interface BackupFile {
  __app: typeof MAGIC;
  version: 1;
  exportedAt: string;
  data: Record<string, string>; // localStorage key -> 原始 JSON 字符串
}

/** 收集当前浏览器里所有业务 store 的原始快照，组装成可下载的备份对象。 */
export function collectBackup(): BackupFile {
  const data: Record<string, string> = {};
  for (const key of STORE_KEYS) {
    const raw = localStorage.getItem(key);
    if (raw != null) data[key] = raw;
  }
  return { __app: MAGIC, version: 1, exportedAt: new Date().toISOString(), data };
}

/** 触发浏览器下载一个 JSON 备份文件，文件名带日期。 */
export function downloadBackup(): { keys: number } {
  const backup = collectBackup();
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  a.href = url;
  a.download = `企鹅岛备份-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(url);
  return { keys: Object.keys(backup.data).length };
}

/** 校验并解析一个备份文件文本。无效则抛出可读错误。 */
export function parseBackup(text: string): BackupFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('文件不是有效的 JSON');
  }
  const b = parsed as Partial<BackupFile>;
  if (!b || b.__app !== MAGIC || typeof b.data !== 'object' || b.data == null) {
    throw new Error('这不是企鹅岛的备份文件');
  }
  return b as BackupFile;
}

/** 用备份覆盖当前 localStorage 中的业务数据。调用方应在成功后刷新页面让 store 重新水合。 */
export function restoreBackup(backup: BackupFile): { keys: number } {
  let count = 0;
  for (const key of STORE_KEYS) {
    const raw = backup.data[key];
    if (typeof raw === 'string') {
      localStorage.setItem(key, raw);
      count += 1;
    }
  }
  return { keys: count };
}
