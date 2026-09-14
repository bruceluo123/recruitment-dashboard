import 'server-only';
import { kvCommandStrict } from '@/lib/kv-server';

export async function kvGet<T>(key: string): Promise<T | null> {
  try {
    const value = await kvCommandStrict<unknown>('GET', key);
    if (value == null) return null;
    if (typeof value !== 'string') return value as T;
    try { return JSON.parse(value) as T; }
    catch { return value as T; }
  } catch { return null; }
}

export async function kvSet(key: string, value: unknown): Promise<boolean> {
  try { await kvCommandStrict('SET', key, JSON.stringify(value)); return true; }
  catch { return false; }
}

export async function kvRPush(key: string, value: string): Promise<boolean> {
  try { return typeof await kvCommandStrict<number>('RPUSH', key, value) === 'number'; }
  catch { return false; }
}

export async function kvDel(key: string): Promise<boolean> {
  try { await kvCommandStrict('DEL', key); return true; }
  catch { return false; }
}

// Sync keys
export const SYNC_KEYS = {
  jds: 'recruit:jds',
  candidates: 'recruit:candidates',
  version: 'recruit:version',
};
