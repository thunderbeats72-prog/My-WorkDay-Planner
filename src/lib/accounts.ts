/**
 * Accounts — a user ID and a password, hashed on this device.
 *
 * The planner is local-first, so the account system is too: nothing is sent
 * anywhere to create an account. Credentials are stretched with PBKDF2-SHA256
 * and kept in local storage; the plain password is never stored, and the
 * derived key is never used to encrypt anything else.
 *
 * An account is what makes the same login work on a phone and a laptop, but
 * that only becomes true once a sync backend is connected (see `cloudSync.ts`).
 * Without one, the account is honest about being device-local.
 */

export interface StoredAccount {
  /** Normalised user ID. Lower-cased, so `Lakshit` and `lakshit` are one person. */
  id: string;
  displayName: string;
  /** Hex. 16 random bytes, one per account. */
  salt: string;
  /** Hex. PBKDF2-SHA256(password, salt, iterations). */
  hash: string;
  iterations: number;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface Session {
  userId: string;
  since: string;
}

export interface AuthResult {
  ok: boolean;
  error?: string;
  account?: StoredAccount;
}

/** OWASP's floor for PBKDF2-SHA256 is 600k; 210k keeps login under ~150ms on a phone. */
export const PBKDF2_ITERATIONS = 210_000;

const ACCOUNTS_KEY = 'workday.accounts.v1';
const SESSION_KEY = 'workday.session.v1';
const THROTTLE_KEY = 'workday.auth-throttle.v1';
const OWNER_KEY = 'workday.data.owner.v1';

const USER_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{2,31})$/;

const RESERVED_IDS = new Set(['admin', 'root', 'system', 'support', 'workday', 'anonymous']);

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function readJson<T>(key: string, fallback: T): T {
  const store = storage();
  if (!store) return fallback;
  try {
    const raw = store.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked (private mode). The caller shows the error.
  }
}

/* ------------------------------------------------------------------ ids */

export function normaliseUserId(raw: string): string {
  return raw.trim().replace(/^@+/, '').toLowerCase();
}

/** Friendly ID validation, with error copy written for a human, not a log. */
export function checkUserId(raw: string): { ok: boolean; error?: string; id: string } {
  const id = normaliseUserId(raw);
  if (id.length === 0) return { ok: false, error: 'Choose a user ID — you will type it to sign in.', id };
  if (id.length < 3) return { ok: false, error: 'A user ID needs at least 3 characters.', id };
  if (id.length > 32) return { ok: false, error: 'A user ID can be at most 32 characters.', id };
  if (!USER_ID_PATTERN.test(id)) {
    return { ok: false, error: 'Use letters, numbers, dots, dashes or underscores, starting with a letter or number.', id };
  }
  if (RESERVED_IDS.has(id)) return { ok: false, error: `"${id}" is reserved — pick another.`, id };
  return { ok: true, id };
}

export function checkPassword(password: string): { ok: boolean; error?: string } {
  if (password.length < 8) return { ok: false, error: 'Use at least 8 characters.' };
  if (password.length > 200) return { ok: false, error: 'That is longer than a password needs to be.' };
  if (/^(.)\1+$/.test(password)) return { ok: false, error: 'That is the same character repeated — guess one more time.' };
  if (['password', '12345678', 'qwertyui'].includes(password.toLowerCase())) {
    return { ok: false, error: 'That is the most-guessed password there is. Choose another.' };
  }
  return { ok: true };
}

/* ------------------------------------------------------------ crypto bits */

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

/** Compares two hex digests without leaking where they first differ. */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}

/* --------------------------------------------------------------- records */

export function listAccounts(): StoredAccount[] {
  const accounts = readJson<StoredAccount[]>(ACCOUNTS_KEY, []);
  return Array.isArray(accounts) ? accounts.filter((account) => account && typeof account.id === 'string') : [];
}

function writeAccounts(accounts: StoredAccount[]): void {
  writeJson(ACCOUNTS_KEY, accounts);
  invalidateSnapshot();
}

export function findAccount(userId: string): StoredAccount | null {
  const id = normaliseUserId(userId);
  return listAccounts().find((account) => account.id === id) ?? null;
}

export function accountExists(userId: string): boolean {
  return findAccount(userId) !== null;
}

/* ------------------------------------------------------------- throttling */

interface Throttle {
  failures: number;
  lockedUntil: number;
}

function readThrottle(userId: string): Throttle {
  const all = readJson<Record<string, Throttle>>(THROTTLE_KEY, {});
  return all[normaliseUserId(userId)] ?? { failures: 0, lockedUntil: 0 };
}

function writeThrottle(userId: string, value: Throttle): void {
  const all = readJson<Record<string, Throttle>>(THROTTLE_KEY, {});
  all[normaliseUserId(userId)] = value;
  writeJson(THROTTLE_KEY, all);
}

/**
 * Five wrong passwords starts a 30-second pause, doubling each time. This is a
 * local planner, not a bank, but a six-digit guess-storm should still cost
 * something.
 */
export function lockoutRemaining(userId: string, now = Date.now()): number {
  const throttle = readThrottle(userId);
  return Math.max(0, throttle.lockedUntil - now);
}

function registerFailure(userId: string): void {
  const throttle = readThrottle(userId);
  const failures = throttle.failures + 1;
  const penalty = failures >= 5 ? Math.min(30_000 * 2 ** (failures - 5), 15 * 60_000) : 0;
  writeThrottle(userId, { failures, lockedUntil: Date.now() + penalty });
}

function clearFailures(userId: string): void {
  writeThrottle(userId, { failures: 0, lockedUntil: 0 });
}

/* --------------------------------------------------------------- actions */

export async function signUp(input: {
  userId: string;
  password: string;
  displayName?: string;
}): Promise<AuthResult> {
  const idCheck = checkUserId(input.userId);
  if (!idCheck.ok) return { ok: false, error: idCheck.error };
  const passwordCheck = checkPassword(input.password);
  if (!passwordCheck.ok) return { ok: false, error: passwordCheck.error };
  if (accountExists(idCheck.id)) {
    return { ok: false, error: 'That user ID is taken on this device. Sign in instead — or pick another ID.' };
  }

  const salt = randomHex(16);
  const hash = await deriveHash(input.password, salt);
  const account: StoredAccount = {
    id: idCheck.id,
    displayName: input.displayName?.trim() || idCheck.id,
    salt,
    hash,
    iterations: PBKDF2_ITERATIONS,
    createdAt: new Date().toISOString(),
    lastLoginAt: new Date().toISOString(),
  };
  writeAccounts([...listAccounts(), account]);
  setSession(account.id);
  return { ok: true, account };
}

export async function signIn(userId: string, password: string): Promise<AuthResult> {
  const id = normaliseUserId(userId);
  const locked = lockoutRemaining(id);
  if (locked > 0) {
    const seconds = Math.ceil(locked / 1000);
    return { ok: false, error: `Too many attempts. Try again in ${seconds}s.` };
  }

  const account = findAccount(id);
  if (!account) {
    // Same message shape as a bad password: never confirm which IDs exist.
    return { ok: false, error: 'That user ID and password do not match an account on this device.' };
  }

  const hash = await deriveHash(password, account.salt, account.iterations);
  if (!constantTimeEqual(hash, account.hash)) {
    registerFailure(id);
    return { ok: false, error: 'That user ID and password do not match an account on this device.' };
  }

  clearFailures(id);
  const next: StoredAccount = { ...account, lastLoginAt: new Date().toISOString() };
  writeAccounts(listAccounts().map((entry) => (entry.id === account.id ? next : entry)));
  setSession(next.id);
  return { ok: true, account: next };
}

/**
 * Record an account that has already been verified somewhere else.
 *
 * A phone that has never seen this planner has no local account, so a purely
 * local sign-in check fails before it ever asks the server — which is exactly
 * why "the same password works on my laptop but not my phone". After the server
 * accepts the password, this writes the matching local record so later sign-ins
 * work offline too.
 *
 * Only ever called with a password the backend has already verified. It
 * overwrites an existing record, because the server is the source of truth when
 * the two disagree.
 */
export async function adoptVerifiedAccount(input: {
  userId: string;
  password: string;
  displayName?: string;
}): Promise<AuthResult> {
  const idCheck = checkUserId(input.userId);
  if (!idCheck.ok) return { ok: false, error: idCheck.error };

  const salt = randomHex(16);
  const hash = await deriveHash(input.password, salt);
  const existing = findAccount(idCheck.id);
  const account: StoredAccount = {
    id: idCheck.id,
    displayName: input.displayName?.trim() || existing?.displayName || idCheck.id,
    salt,
    hash,
    iterations: PBKDF2_ITERATIONS,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    lastLoginAt: new Date().toISOString(),
  };

  writeAccounts([...listAccounts().filter((entry) => entry.id !== account.id), account]);
  clearFailures(account.id);
  setSession(account.id);
  return { ok: true, account };
}

export async function changePassword(userId: string, currentPassword: string, nextPassword: string): Promise<AuthResult> {
  const check = await signIn(userId, currentPassword);
  if (!check.ok || !check.account) return check;
  const passwordCheck = checkPassword(nextPassword);
  if (!passwordCheck.ok) return { ok: false, error: passwordCheck.error };
  if (currentPassword === nextPassword) return { ok: false, error: 'That is the same password you already use.' };

  const salt = randomHex(16);
  const hash = await deriveHash(nextPassword, salt);
  const updated: StoredAccount = { ...check.account, salt, hash, iterations: PBKDF2_ITERATIONS };
  writeAccounts(listAccounts().map((entry) => (entry.id === updated.id ? updated : entry)));
  return { ok: true, account: updated };
}

export async function deleteAccount(userId: string, password: string): Promise<AuthResult> {
  const check = await signIn(userId, password);
  if (!check.ok) return check;
  const id = normaliseUserId(userId);
  writeAccounts(listAccounts().filter((entry) => entry.id !== id));
  if (getSession()?.userId === id) signOut();
  return { ok: true };
}

/* --------------------------------------------------------------- session */

let sessionCache: Session | null | undefined;
/** `useSyncExternalStore` compares snapshots by identity — rebuild only on change. */
let accountCache: StoredAccount | null | undefined;
const listeners = new Set<() => void>();

function invalidateSnapshot(): void {
  accountCache = undefined;
}

function emit(): void {
  invalidateSnapshot();
  for (const listener of listeners) listener();
}

export function getSession(): Session | null {
  if (sessionCache !== undefined) return sessionCache;
  const stored = readJson<Session | null>(SESSION_KEY, null);
  sessionCache = stored && typeof stored.userId === 'string' ? stored : null;
  return sessionCache;
}

function setSession(userId: string): void {
  sessionCache = { userId, since: new Date().toISOString() };
  writeJson(SESSION_KEY, sessionCache);
  emit();
}

export function signOut(): void {
  sessionCache = null;
  invalidateSnapshot();
  const store = storage();
  store?.removeItem(SESSION_KEY);
  emit();
}

export function currentAccount(): StoredAccount | null {
  const session = getSession();
  return session ? findAccount(session.userId) : null;
}

export function subscribeToAccount(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Snapshot for `useSyncExternalStore` — identical reference until something changes. */
export function accountSnapshot(): StoredAccount | null {
  if (accountCache === undefined) accountCache = currentAccount();
  return accountCache;
}

/* ------------------------------------------------------- device binding */

/**
 * Which account this device's task data belongs to.
 *
 * The planner keeps one dataset per device. Binding it to an account is what
 * stops one person's tasks from appearing under another's login, and it is
 * what the sync engine reads to decide whose snapshot to push.
 */
export type DeviceOwner = { userId: string; boundAt: string; deviceId: string } | null;

export function getDeviceOwner(): DeviceOwner {
  const stored = readJson<DeviceOwner>(OWNER_KEY, null);
  if (!stored || typeof stored.userId !== 'string') return null;
  return stored;
}

export function bindDevice(userId: string): void {
  const existing = getDeviceOwner();
  const deviceId = existing?.deviceId ?? randomHex(8);
  writeJson(OWNER_KEY, { userId: normaliseUserId(userId), boundAt: new Date().toISOString(), deviceId });
  emit();
}

export function unbindDevice(): void {
  const store = storage();
  store?.removeItem(OWNER_KEY);
  emit();
}

/** A stable per-device id, for telling "last written by the laptop" apart. */
export function deviceId(): string {
  return getDeviceOwner()?.deviceId ?? randomHex(8);
}
