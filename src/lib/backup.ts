// Full local data backup/restore: export and restore raw localStorage snapshots.
// Keeping this key-based makes old backups resilient to store schema changes.
const APP_KEY_PREFIX = 'recruitai-';

const CORE_STORE_KEYS = [
  'recruitai-jd-store',
  'recruitai-repush-store',
  'recruitai-interview-store',
  'recruitai-talent-store',
  'recruitai-company-store',
  'recruitai-todo-store',
  'recruitai-recycle-store',
  'recruitai-match-history',
  'recruitai-pref-store',
] as const;

const MAGIC = 'qieqiuzhidao-backup';

export interface BackupFile {
  __app: typeof MAGIC;
  version: 1;
  exportedAt: string;
  data: Record<string, string>; // localStorage key -> raw stored string
  meta?: {
    source: 'localStorage';
    keys: string[];
  };
}

function backupKeys(): string[] {
  const keys = new Set<string>(CORE_STORE_KEYS);
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key?.startsWith(APP_KEY_PREFIX)) keys.add(key);
  }
  return Array.from(keys).sort();
}

/** Collect every Penguin Island local data key into one downloadable snapshot. */
export function collectBackup(): BackupFile {
  const data: Record<string, string> = {};
  const keys = backupKeys();
  for (const key of keys) {
    const raw = localStorage.getItem(key);
    if (raw != null) data[key] = raw;
  }
  return {
    __app: MAGIC,
    version: 1,
    exportedAt: new Date().toISOString(),
    data,
    meta: { source: 'localStorage', keys: Object.keys(data).sort() },
  };
}

/** Trigger a JSON backup download. */
export function downloadBackup(): { keys: number; fileName: string } {
  const backup = collectBackup();
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  a.href = url;
  a.download = `企鹅岛完整备份-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(url);
  return { keys: Object.keys(backup.data).length, fileName: a.download };
}

/** Validate and parse a backup file. */
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

/** Restore every Penguin Island key present in the backup. The caller should reload afterwards. */
export function restoreBackup(backup: BackupFile): { keys: number } {
  let count = 0;
  for (const [key, raw] of Object.entries(backup.data)) {
    if (!key.startsWith(APP_KEY_PREFIX) || typeof raw !== 'string') continue;
    localStorage.setItem(key, raw);
    count += 1;
  }
  return { keys: count };
}
