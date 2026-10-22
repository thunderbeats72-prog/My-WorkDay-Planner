import { afterEach, describe, expect, it, vi } from 'vitest';
import { neonProbe, neonPull, neonPush, neonSignIn, neonSignOut, neonSignUp, neonVersion } from './neonBackend';

function mockFetch(handler: (url: string, init: RequestInit) => { status: number; body: unknown }) {
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const { status, body } = handler(String(input), init ?? {});
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Neon sync client', () => {
  it('signs up against this deployment’s own API, not a third-party origin', async () => {
    const spy = mockFetch(() => ({ status: 200, body: { userId: 'lakshit', token: 'tok', expiresAt: '2026-12-01T00:00:00.000Z' } }));

    const result = await neonSignUp('lakshit', 'open sesame 72', 'Lakshit');

    expect(result.ok).toBe(true);
    expect(spy.mock.calls[0][0]).toBe('/api/auth/signup');
    expect(JSON.parse(String(spy.mock.calls[0][1]?.body))).toEqual({
      userId: 'lakshit',
      password: 'open sesame 72',
      displayName: 'Lakshit',
    });
  });

  it('surfaces the API’s sentence when sign-in fails', async () => {
    mockFetch(() => ({ status: 401, body: { error: 'That user ID and password do not match.' } }));
    const result = await neonSignIn('lakshit', 'nope');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('That user ID and password do not match.');
  });

  it('sends the token as a bearer header, never in the body', async () => {
    const spy = mockFetch(() => ({ status: 200, body: { payload: null } }));
    await neonPull('secret-token');

    const init = spy.mock.calls[0][1] ?? {};
    const headers = (init.headers ?? {}) as Record<string, string>;
    expect(spy.mock.calls[0][0]).toBe('/api/snapshot');
    expect(headers.Authorization).toBe('Bearer secret-token');
    expect(String(init.body ?? '')).toBe('');
  });

  it('returns the snapshot it was given', async () => {
    mockFetch(() => ({ status: 200, body: { payload: { app: 'my-workday-planner', version: 1, tasks: [] } } }));
    const result = await neonPull('token');
    expect(result.ok).toBe(true);
    expect(result.data?.app).toBe('my-workday-planner');
  });

  it('pushes the snapshot under a payload key', async () => {
    const spy = mockFetch(() => ({ status: 200, body: { ok: true } }));
    const snapshot = { app: 'my-workday-planner', version: 1, tasks: [] } as never;
    const result = await neonPush('token', snapshot);

    expect(result.ok).toBe(true);
    expect(JSON.parse(String(spy.mock.calls[0][1]?.body))).toEqual({ payload: snapshot });
  });

  it('never throws when the network is gone', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('offline');
    }));
    const result = await neonPull('token');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('still safe on this device');
  });

  it('treats a 401 from the probe as healthy — the API answered, it just wants a token', async () => {
    mockFetch(() => ({ status: 401, body: { error: 'Sign in again — no session token was sent.' } }));
    expect((await neonProbe()).ok).toBe(true);
  });

  it('treats a 500 from the probe as broken', async () => {
    mockFetch(() => ({ status: 500, body: { error: 'The database tables are missing.' } }));
    const result = await neonProbe();
    expect(result.ok).toBe(false);
    expect(result.error).toContain('tables are missing');
  });

  it('revokes the session with DELETE on sign out', async () => {
    const spy = mockFetch(() => ({ status: 200, body: { ok: true } }));
    await neonSignOut('token');
    expect(spy.mock.calls[0][1]?.method).toBe('DELETE');
  });
});

describe('version polling — the real-time beat', () => {
  it('asks the cheap endpoint, not the whole snapshot', async () => {
    const spy = mockFetch(() => ({ status: 200, body: { updatedAt: '2026-01-02T12:00:00.000Z' } }));
    const result = await neonVersion('token');

    expect(result.ok).toBe(true);
    expect(result.data).toBe('2026-01-02T12:00:00.000Z');
    expect(spy.mock.calls[0][0]).toBe('/api/version');
  });

  it('reports null when this user has never pushed — a first-device case, not an error', async () => {
    mockFetch(() => ({ status: 200, body: { updatedAt: null } }));
    const result = await neonVersion('token');
    expect(result.ok).toBe(true);
    expect(result.data).toBeNull();
  });

  it('surfaces an expired session so the poller can stop asking', async () => {
    mockFetch(() => ({ status: 401, body: { error: 'This session has expired. Sign in again.' } }));
    const result = await neonVersion('stale');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('expired');
  });
});
