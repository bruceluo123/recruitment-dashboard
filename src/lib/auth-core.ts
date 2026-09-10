export const SESSION_COOKIE = 'penguin_session';
export const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;
export const REMEMBER_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export type OwnerId = 'a' | 'b';

export interface SessionUser {
  sub: string;
  name: string;
  owners: OwnerId[];
  iat: number;
  exp: number;
}

export interface PasswordUser {
  id: string;
  username: string;
  name: string;
  salt: string;
  hash: string;
  iterations: number;
  owners?: OwnerId[];
}

export function normalizeOwners(value: unknown): OwnerId[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((owner): owner is OwnerId => owner === 'a' || owner === 'b')));
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index++) binary += String.fromCharCode(bytes[index]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value: string): Uint8Array | null {
  try {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
    const binary = atob(base64);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

function encodeJson(value: unknown): string {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

async function hmac(value: string, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
}

export async function createSessionToken(
  user: Pick<SessionUser, 'sub' | 'name' | 'owners'>,
  secret: string,
  maxAgeSeconds = SESSION_MAX_AGE_SECONDS,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload = encodeJson({ ...user, iat: now, exp: now + maxAgeSeconds });
  const signature = bytesToBase64Url(await hmac(payload, secret));
  return `${payload}.${signature}`;
}

export async function verifySessionToken(token: string, secrets: string[]): Promise<SessionUser | null> {
  const [payload, signature] = token.split('.');
  if (!payload || !signature || token.split('.').length !== 2) return null;
  const signatureBytes = base64UrlToBytes(signature);
  if (!signatureBytes) return null;

  let verified = false;
  for (const secret of secrets.filter(Boolean)) {
    const expected = await hmac(payload, secret);
    if (expected.length !== signatureBytes.length) continue;
    let difference = 0;
    for (let index = 0; index < expected.length; index++) difference |= expected[index] ^ signatureBytes[index];
    if (difference === 0) verified = true;
  }
  if (!verified) return null;

  const payloadBytes = base64UrlToBytes(payload);
  if (!payloadBytes) return null;
  try {
    const user = JSON.parse(new TextDecoder().decode(payloadBytes)) as SessionUser;
    const now = Math.floor(Date.now() / 1000);
    if (!user.sub || !user.name || !Number.isFinite(user.iat) || !Number.isFinite(user.exp) || user.exp <= now
      || !Array.isArray(user.owners)) return null;
    const owners = normalizeOwners(user.owners);
    if (!owners.length) return null;
    user.owners = owners;
    return user;
  } catch {
    return null;
  }
}

export function sessionSecrets(): string[] {
  return [process.env.APP_SESSION_SECRET || '', process.env.APP_SESSION_SECRET_PREVIOUS || ''].filter(Boolean);
}

export function passwordUsers(): PasswordUser[] {
  try {
    const parsed = JSON.parse(process.env.APP_AUTH_USERS_JSON || '[]') as PasswordUser[];
    return Array.isArray(parsed) ? parsed.filter((user) => (
      !!user?.id && !!user.username && !!user.name && !!user.salt && !!user.hash && Number.isInteger(user.iterations)
    )) : [];
  } catch {
    return [];
  }
}

export async function verifyPassword(password: string, user: PasswordUser): Promise<boolean> {
  const salt = base64UrlToBytes(user.salt);
  const expected = base64UrlToBytes(user.hash);
  if (!salt || !expected || user.iterations < 100_000) return false;
  const saltBuffer = new ArrayBuffer(salt.byteLength);
  new Uint8Array(saltBuffer).set(salt);
  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const derived = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: saltBuffer, iterations: user.iterations },
    keyMaterial,
    expected.length * 8,
  ));
  if (derived.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < derived.length; index++) difference |= derived[index] ^ expected[index];
  return difference === 0;
}

export function secureStringEqual(left: string, right: string): boolean {
  const max = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < max; index++) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}
