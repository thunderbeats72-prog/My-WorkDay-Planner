/**
 * Neon sync, through this deployment's own `/api` routes.
 *
 * Neon is a database, not a backend: a browser cannot hold a Postgres
 * connection string, and should not. So the app talks to three tiny functions
 * in `api/` that hold the connection string server-side and scope every query
 * to the token's owner.
 *
 * Enable it with `VITE_SYNC_MODE=neon` (see `.env.example`). Nothing to paste on
 * any device — which is the whole point.
 */

import type { BackupFile } from './db';

const BASE = '/api';

export interface NeonSessionPayload {
  userId: string;
  token: string;
  expiresAt: string;
}

export interface NeonResult<T> {
  ok: boolean;
  error?: string;
  data?: T;
}

async function call<T>(path: string, init: RequestInit, token?: string): Promise<NeonResult<T>> {
  try {
    const response = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
    });
    const text = await response.text();
    const body: unknown = text ? JSON.parse(text) : null;
    if (!response.ok) {
      const record = (body ?? {}) as { error?: string };
      return { ok: false, error: record.error ?? `Sync request failed (HTTP ${response.status}).` };
    }
    return { ok: true, data: body as T };
  } catch {
    return {
      ok: false,
      error: 'Could not reach the sync API. Your tasks are still safe on this device.',
    };
  }
}

export function neonSignUp(userId: string, password: string, displayName?: string) {
  return call<NeonSessionPayload>('/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ userId, password, displayName }),
  });
}

export function neonSignIn(userId: string, password: string) {
  return call<NeonSessionPayload>('/auth/signin', {
    method: 'POST',
    body: JSON.stringify({ userId, password }),
  });
}

export async function neonPull(token: string): Promise<NeonResult<BackupFile | null>> {
  const result = await call<{ payload: BackupFile | null }>('/snapshot', { method: 'GET' }, token);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, data: result.data?.payload ?? null };
}

export async function neonPush(token: string, snapshot: BackupFile): Promise<NeonResult<undefined>> {
  const result = await call<{ ok: boolean }>('/snapshot', { method: 'POST', body: JSON.stringify({ payload: snapshot }) }, token);
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

/** The cheap "has anything changed?" call. Returns an ISO timestamp or null. */
export async function neonVersion(token: string): Promise<NeonResult<string | null>> {
  const result = await call<{ updatedAt: string | null }>('/version', { method: 'GET' }, token);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, data: result.data?.updatedAt ?? null };
}

export async function neonSignOut(token: string): Promise<void> {
  await call('/snapshot', { method: 'DELETE' }, token).catch(() => undefined);
}

/** A round trip that proves the API and the database are both alive. */
export async function neonProbe(): Promise<NeonResult<undefined>> {
  const result = await call<{ payload?: unknown }>('/snapshot', { method: 'GET' });
  // 401 means the API answered correctly and just wants a token — that is a
  // pass. Anything else (404, 500, missing tables) is a real failure.
  if (result.ok) return { ok: true };
  if (/no session token|expired/i.test(result.error ?? '')) return { ok: true };
  return { ok: false, error: result.error };
}
