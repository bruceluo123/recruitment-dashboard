import type { OwnerId } from '@/lib/auth-core';

const OWNER_SCOPED_TYPES = new Set(['candidates', 'repush', 'todos']);

export function recordOwner(type: string, value: unknown): OwnerId | null | undefined {
  if (!OWNER_SCOPED_TYPES.has(type)) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (type === 'repush') return record.column === 'a' || record.column === 'b' ? record.column : undefined;
  if (type === 'todos') {
    if (record.owner === 'both') return null;
    return record.owner === 'a' || record.owner === 'b' ? record.owner : undefined;
  }
  return record.owner === 'b' ? 'b' : 'a';
}

export function canAccessRecord(type: string, value: unknown, owners: OwnerId[]): boolean {
  const owner = recordOwner(type, value);
  return owner === null || (owner !== undefined && owners.includes(owner));
}

export function filterAccessibleRecords(type: string, value: unknown, owners: OwnerId[]): unknown {
  if (!OWNER_SCOPED_TYPES.has(type)) return value;
  if (!Array.isArray(value)) return [];
  return value.filter((record) => canAccessRecord(type, record, owners));
}
