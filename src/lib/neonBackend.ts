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
import type { AttachmentKind, AttachmentMeta } from './attachmentLimits';

const BASE = '/api';

/**
 * What this deployment's own API looks like from the browser.
 *
 * The build-time flag `VITE_SYNC_MODE=neon` was the only way to switch sync on,
 * so a deployment that forgot it behaved as if it had no database at all: the
 * phone fell back to local accounts and said "no account with that user ID",
 * while the laptop — which had created one locally — kept working. The API is
 * now asked directly. If `/api/version` answers like our own server, sync is
 * on, flag or no flag.
 */
export type ApiStatus = 'unknown' | 'ready' | 'no-database' | 'missing' | 'unreachable';

let status: ApiStatus = 'unknown';

/** Last known state, without waiting for a round trip. */
export function apiStatus(): ApiStatus {
  return status;
}

/** Only a real deployment can answer; dev servers and tests use the local path. */
function canProbe(): boolean {
  return Boolean(import.meta.env.PROD) && typeof fetch === 'function';
}

/**
 * Ask the site whether it is serving its own API.
 *
 * A static host answers an unknown path with its 404 page (or, with a rewrite,
 * with index.html and a 200), and neither is JSON — that is what "the functions
 * did not deploy" looks like from here. A 401 with a JSON body is a pass: the
 * function ran and only wants a token. A 500 that names DATABASE_URL means the
 * functions are alive but the database is not attached, which is a different
 * sentence and deserves a different message.
 */
export async function detectApi(force = false): Promise<ApiStatus> {
  if (!force && !canProbe()) return status;
  // A definite answer is cached for the life of the page. "Unreachable" is not
  // definite — someone who opened the app on a bad train signal should be able
  // to sign in once the signal returns, without reloading.
  if (!force && (status === 'ready' || status === 'no-database' || status === 'missing')) return status;
  try {
    const response = await fetch(`${BASE}/health`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (!body || typeof body !== 'object') {
      // A web page came back, so this host is static: the functions did not
      // deploy, or they were never part of this project.
      status = 'missing';
      return status;
    }
    const record = body as { database?: unknown };
    if (record.database === 'ready') status = 'ready';
    else if (record.database === 'absent' || record.database === 'error') status = 'no-database';
    else status = response.status === 404 ? 'missing' : 'ready';
  } catch {
    status = 'unreachable';
  }
  return status;
}

/** Test-only: forget the cached answer. */
export function resetApiStatus(): void {
  status = 'unknown';
}

export interface NeonSessionPayload {
  userId: string;
  token: string;
  expiresAt: string;
}

export interface NeonResult<T> {
  ok: boolean;
  error?: string;
  /** HTTP status when the server answered at all. */
  status?: number;
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
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (!body || typeof body !== 'object') {
      // A web page came back where data should have been: the site is static.
      status = 'missing';
      return {
        ok: false,
        status: response.status,
        error: `This site is not answering on ${BASE} — the sign-in server did not deploy.`,
      };
    }
    if (!response.ok) {
      const record = body as { error?: string };
      const error = record.error ?? `Sync request failed (HTTP ${response.status}).`;
      if (response.status === 500 && /DATABASE_URL/i.test(error)) status = 'no-database';
      return { ok: false, status: response.status, error };
    }
    status = 'ready';
    return { ok: true, data: body as T };
  } catch {
    if (status === 'unknown') status = 'unreachable';
    return {
      ok: false,
      error: 'Could not reach the sync API — check the connection. Your tasks are still safe on this device.',
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

/* ---------------------------------------------------------- attachments */

export interface NeonAttachmentUsage {
  count: number;
  bytes: number;
}

export interface NeonAttachmentList {
  attachments: AttachmentMeta[];
  usage: NeonAttachmentUsage;
}

export interface NeonAttachmentEnvelope extends AttachmentMeta {
  data: string;
}

/** Metadata for every attachment this account holds — no bytes. */
export async function neonAttachmentList(
  token: string,
): Promise<NeonResult<NeonAttachmentList>> {
  return call<NeonAttachmentList>('/attachments', { method: 'GET' }, token);
}

/** One file, base64-encoded — a few hundred kilobytes, never the camera roll. */
export async function neonAttachmentGet(
  token: string,
  id: string,
): Promise<NeonResult<{ attachment: NeonAttachmentEnvelope }>> {
  return call<{ attachment: NeonAttachmentEnvelope }>(
    `/attachments?id=${encodeURIComponent(id)}`,
    { method: 'GET' },
    token,
  );
}

export interface NeonAttachmentPut {
  id: string;
  taskId: string;
  kind: AttachmentKind;
  mime: string;
  size: number;
  durationMs: number | null;
  createdAt: string;
  data: string;
}

export async function neonAttachmentPut(
  token: string,
  attachment: NeonAttachmentPut,
): Promise<NeonResult<undefined>> {
  const result = await call<{ ok: boolean }>('/attachments', {
    method: 'POST',
    body: JSON.stringify({ attachment }),
  }, token);
  return result.ok ? { ok: true } : { ok: false, error: result.error, status: result.status };
}

export async function neonAttachmentDelete(
  token: string,
  ids: string[],
): Promise<NeonResult<undefined>> {
  const result = await call<{ ok: boolean }>('/attachments', {
    method: 'DELETE',
    body: JSON.stringify({ ids }),
  }, token);
  return result.ok ? { ok: true } : { ok: false, error: result.error, status: result.status };
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
