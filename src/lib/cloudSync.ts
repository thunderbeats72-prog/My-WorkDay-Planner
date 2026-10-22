/**
 * Optional cloud sync, over Supabase's REST API — no SDK, no build-time config.
 *
 * Why this shape: the planner must work with no account and no server, so a
 * sync backend can never be required. When one *is* connected, this module is
 * the only thing that knows about it, and it talks plain `fetch` to the two
 * endpoints it needs. The credentials the user pastes live in local storage,
 * never in the bundle, so connecting a project does not need a redeploy.
 *
 * What it does not do: it never sees the password. Supabase hashes it and hands
 * back a token; this file stores the token and nothing else.
 */

import type { BackupFile } from './db';

export interface CloudConfig {
  url: string;
  anonKey: string;
}

export interface CloudSession {
  userId: string;
  email: string;
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

export interface CloudResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

const CONFIG_KEY = 'workday.cloud.config.v1';
const SESSION_KEY = 'workday.cloud.session.v1';
const TABLE = 'planner_snapshots';

function read<T>(key: string): T | null {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode: sync simply will not survive a reload.
  }
}

export function loadCloudConfig(): CloudConfig | null {
  const config = read<CloudConfig>(CONFIG_KEY);
  if (!config || typeof config.url !== 'string' || typeof config.anonKey !== 'string') return null;
  return config.url && config.anonKey ? config : null;
}

export function saveCloudConfig(url: string, anonKey: string): CloudResult<CloudConfig> {
  const trimmedUrl = url.trim().replace(/\/+$/, '');
  const trimmedKey = anonKey.trim();
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(trimmedUrl)) {
    return {
      ok: false,
      error: 'Use the project URL from Supabase → Project Settings → API, like https://abcd1234.supabase.co',
    };
  }
  if (trimmedKey.length < 20) return { ok: false, error: 'That anon key looks too short — copy the whole "anon public" key.' };
  const config: CloudConfig = { url: trimmedUrl, anonKey: trimmedKey };
  write(CONFIG_KEY, config);
  return { ok: true, data: config };
}

export function clearCloudConfig(): void {
  try {
    localStorage.removeItem(CONFIG_KEY);
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // Nothing to clear.
  }
}

export function isCloudConfigured(): boolean {
  return loadCloudConfig() !== null;
}

export function loadCloudSession(): CloudSession | null {
  const session = read<CloudSession>(SESSION_KEY);
  if (!session || typeof session.accessToken !== 'string' || typeof session.userId !== 'string') return null;
  return session;
}

function saveCloudSession(session: CloudSession | null): void {
  if (!session) {
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {
      // Ignore.
    }
    return;
  }
  write(SESSION_KEY, session);
}

/** Same rule the local accounts use, so a user ID means one thing everywhere. */
export function cloudEmail(userId: string): string {
  return `${userId.toLowerCase()}@users.workday-planner.app`;
}

function explain(status: number, body: unknown): string {
  const record = (body ?? {}) as { msg?: string; message?: string; error_description?: string; hint?: string };
  const detail = record.msg ?? record.message ?? record.error_description ?? '';
  if (status === 400 && /already registered|already exists/i.test(detail)) return 'That user ID is already registered in this project. Sign in instead.';
  if (status === 400 && /confirm/i.test(detail)) return 'This project requires email confirmation. Turn it off in Supabase → Authentication → Providers → Email.';
  if (status === 400 || status === 401) return detail || 'That user ID and password do not match.';
  if (status === 404) return `The "${TABLE}" table is missing — run the SQL setup once in the Supabase SQL editor.`;
  if (status === 429) return 'Too many attempts. Wait a minute and try again.';
  if (status >= 500) return 'The sync project is not responding. Try again in a moment.';
  return detail || `Sync request failed (HTTP ${status}).`;
}

async function call<T>(config: CloudConfig, path: string, init: RequestInit, token?: string): Promise<CloudResult<T>> {
  try {
    const response = await fetch(`${config.url}${path}`, {
      ...init,
      headers: {
        apikey: config.anonKey,
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
    });
    const text = await response.text();
    const body: unknown = text ? JSON.parse(text) : null;
    if (!response.ok) return { ok: false, error: explain(response.status, body) };
    return { ok: true, data: body as T };
  } catch {
    return { ok: false, error: 'Could not reach the sync project. Check your connection — your tasks are still safe on this device.' };
  }
}

interface AuthPayload {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  user?: { id?: string; email?: string };
}

function sessionFrom(payload: AuthPayload | null, userId: string): CloudResult<CloudSession> {
  if (!payload?.access_token || !payload.refresh_token || !payload.user?.id) {
    return {
      ok: false,
      error: 'This project has email confirmation switched on, so it cannot verify a user ID directly. Turn it off in Supabase → Authentication → Providers → Email.',
    };
  }
  const session: CloudSession = {
    userId: payload.user.id,
    email: payload.user.email ?? cloudEmail(userId),
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000,
  };
  saveCloudSession(session);
  return { ok: true, data: session };
}

export async function cloudSignUp(userId: string, password: string): Promise<CloudResult<CloudSession>> {
  const config = loadCloudConfig();
  if (!config) return { ok: false, error: 'No sync project is connected yet.' };
  const result = await call<AuthPayload>(config, '/auth/v1/signup', {
    method: 'POST',
    body: JSON.stringify({ email: cloudEmail(userId), password }),
  });
  if (!result.ok) {
    // "Already registered" is a fine outcome here: the same credentials may
    // already exist because the account was created on the other device.
    if (result.error?.includes('already registered')) return cloudSignIn(userId, password);
    return { ok: false, error: result.error };
  }
  return sessionFrom(result.data ?? null, userId);
}

export async function cloudSignIn(userId: string, password: string): Promise<CloudResult<CloudSession>> {
  const config = loadCloudConfig();
  if (!config) return { ok: false, error: 'No sync project is connected yet.' };
  const result = await call<AuthPayload>(config, '/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: JSON.stringify({ email: cloudEmail(userId), password }),
  });
  if (!result.ok) return { ok: false, error: result.error };
  return sessionFrom(result.data ?? null, userId);
}

export async function cloudSignOut(): Promise<void> {
  const config = loadCloudConfig();
  const session = loadCloudSession();
  saveCloudSession(null);
  if (!config || !session) return;
  // Best effort: revoke the refresh token so a stolen copy is useless.
  await call(config, '/auth/v1/logout', { method: 'POST' }, session.accessToken).catch(() => undefined);
}

async function freshSession(): Promise<CloudSession | null> {
  const config = loadCloudConfig();
  const session = loadCloudSession();
  if (!config || !session) return null;
  if (session.expiresAt - Date.now() > 60_000) return session;

  const refreshed = await call<AuthPayload>(config, '/auth/v1/token?grant_type=refresh_token', {
    method: 'POST',
    body: JSON.stringify({ refresh_token: session.refreshToken }),
  });
  if (!refreshed.ok) return null;
  const next = sessionFrom(refreshed.data ?? null, '');
  return next.ok ? (next.data ?? null) : null;
}

export async function pullCloudSnapshot(): Promise<CloudResult<BackupFile | null>> {
  const config = loadCloudConfig();
  const session = await freshSession();
  if (!config) return { ok: false, error: 'No sync project is connected yet.' };
  if (!session) return { ok: false, error: 'Sign in again — the sync token has expired.' };

  const result = await call<Array<{ payload: BackupFile }>>(
    config,
    `/rest/v1/${TABLE}?user_id=eq.${session.userId}&select=payload`,
    { method: 'GET' },
    session.accessToken,
  );
  if (!result.ok) return { ok: false, error: result.error };
  const row = result.data?.[0];
  return { ok: true, data: row?.payload ?? null };
}

export async function pushCloudSnapshot(snapshot: BackupFile): Promise<CloudResult> {
  const config = loadCloudConfig();
  const session = await freshSession();
  if (!config) return { ok: false, error: 'No sync project is connected yet.' };
  if (!session) return { ok: false, error: 'Sign in again — the sync token has expired.' };

  const result = await call(
    config,
    `/rest/v1/${TABLE}?on_conflict=user_id`,
    {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([{ user_id: session.userId, payload: snapshot, updated_at: new Date().toISOString() }]),
    },
    session.accessToken,
  );
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

/** Runs a query against the project to prove the two keys work before saving. */
export async function testCloudConnection(url: string, anonKey: string): Promise<CloudResult> {
  const trimmedUrl = url.trim().replace(/\/+$/, '');
  try {
    const response = await fetch(`${trimmedUrl}/rest/v1/${TABLE}?select=updated_at&limit=1`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
    });
    if (response.status === 404) {
      return { ok: false, error: `Connected to the project, but the "${TABLE}" table is missing — run the SQL setup first.` };
    }
    if (!response.ok) return { ok: false, error: explain(response.status, null) };
    return { ok: true };
  } catch {
    return { ok: false, error: 'That URL did not answer. Copy the Project URL exactly, including https://' };
  }
}
