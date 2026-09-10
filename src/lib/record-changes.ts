export type SyncRecord = { id: string; [key: string]: unknown };
export interface RecordChange { id: string; before: SyncRecord | null; after: SyncRecord | null }
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => [key, canonical(v)]));
  return value;
}
export function recordsEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
export function diffRecords(before: SyncRecord[], after: SyncRecord[]): RecordChange[] {
  const old = new Map(before.map((item) => [item.id, item]));
  const next = new Map(after.map((item) => [item.id, item]));
  return Array.from(new Set([...Array.from(old.keys()), ...Array.from(next.keys())])).flatMap((id) => {
    const a = old.get(id) || null, b = next.get(id) || null;
    return recordsEqual(a, b) ? [] : [{ id, before: a, after: b }];
  });
}
/** Apply only edited fields; conflicting edits are never silently overwritten. */
export function applyRecordChanges(current: SyncRecord[], changes: RecordChange[]): { records: SyncRecord[]; conflicts: string[] } {
  const records = new Map(current.map((item) => [item.id, item]));
  const conflicts: string[] = [];
  for (const change of changes) {
    const now = records.get(change.id);
    if (!change.before) {
      if (now && !recordsEqual(now, change.after)) conflicts.push(change.id);
      else if (change.after) records.set(change.id, change.after);
      continue;
    }
    if (!change.after) {
      if (now && !recordsEqual(now, change.before)) conflicts.push(change.id);
      else records.delete(change.id);
      continue;
    }
    if (!now) { conflicts.push(change.id); continue; }
    const next = { ...now };
    for (const key of Array.from(new Set([...Object.keys(change.before), ...Object.keys(change.after)]))) {
      if (key === 'id' || recordsEqual(change.before[key], change.after[key])) continue;
      if (key === 'updatedAt' && String(now[key] || '') > String(change.after[key] || '')) continue;
      if (key !== 'updatedAt' && !recordsEqual(now[key], change.before[key]) && !recordsEqual(now[key], change.after[key])) {
        conflicts.push(change.id); break;
      }
      if (change.after[key] === undefined) delete next[key];
      else next[key] = change.after[key];
    }
    records.set(change.id, next);
  }
  return { records: Array.from(records.values()), conflicts: Array.from(new Set(conflicts)) };
}
