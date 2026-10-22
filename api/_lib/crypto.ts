/**
 * Password and token primitives shared by the Neon API routes.
 *
 * Deliberately identical in shape to `src/lib/accounts.ts`: the same 210k
 * PBKDF2-SHA256 rounds and the same user-ID rules, so a user ID means the same
 * thing whether the account lives in this browser or in Postgres.
 */

export const PBKDF2_ITERATIONS = 210_000;

const USER_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{2,31})$/;
const RESERVED_IDS = new Set(['admin', 'root', 'system', 'support', 'workday', 'anonymous']);

export function normaliseUserId(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().replace(/^@+/, '').toLowerCase() : '';
}

export function checkUserId(raw: unknown): { ok: boolean; error?: string; id: string } {
  const id = normaliseUserId(raw);
  if (id.length < 3) return { ok: false, error: 'A user ID needs at least 3 characters.', id };
  if (id.length > 32) return { ok: false, error: 'A user ID can be at most 32 characters.', id };
  if (!USER_ID_PATTERN.test(id)) {
    return { ok: false, error: 'Use letters, numbers, dots, dashes or underscores, starting with a letter or number.', id };
  }
  if (RESERVED_IDS.has(id)) return { ok: false, error: `"${id}" is reserved — pick another.`, id };
  return { ok: true, id };
}

export function checkPassword(password: unknown): { ok: boolean; error?: string } {
  if (typeof password !== 'string') return { ok: false, error: 'Password is required.' };
  if (password.length < 8) return { ok: false, error: 'Use at least 8 characters.' };
  if (password.length > 200) return { ok: false, error: 'That is longer than a password needs to be.' };
  return { ok: true };
}

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

export function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(bytes);
  return toHex(bytes);
}

export async function deriveHash(password: string, saltHex: string, iterations = PBKDF2_ITERATIONS): Promise<string> {
  const encoder = new TextEncoder();
  const keyMaterial = await globalThis.crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await globalThis.crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: encoder.encode(saltHex), iterations, hash: 'SHA-256' },
    keyMaterial,
    256,
  );
  return toHex(new Uint8Array(bits));
}

/** Sessions store the digest, so a database leak does not hand over live tokens. */
export async function hashToken(token: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return toHex(new Uint8Array(digest));
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}
