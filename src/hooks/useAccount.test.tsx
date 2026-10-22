import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { adoptVerifiedAccount, bindDevice, signIn as signInLocal, signOut } from '../lib/accounts';

const cloud = vi.hoisted(() => ({
  isCloudConfigured: true,
  cloudSignIn: vi.fn(),
  cloudSignUp: vi.fn(),
  cloudSignOut: vi.fn(),
  loadCloudSession: vi.fn(),
  pullCloudSnapshot: vi.fn(),
  pushCloudSnapshot: vi.fn(),
  pullVersion: vi.fn(),
  saveCloudConfig: vi.fn(),
  testCloudConnection: vi.fn(),
  clearCloudConfig: vi.fn(),
}));

vi.mock('../lib/cloudSync', () => ({
  neonEnabled: () => true,
  ensureBackend: async () => cloud.isCloudConfigured,
  isCloudConfigured: () => cloud.isCloudConfigured,
  cloudSignIn: cloud.cloudSignIn,
  cloudSignUp: cloud.cloudSignUp,
  cloudSignOut: cloud.cloudSignOut,
  loadCloudSession: cloud.loadCloudSession,
  pullCloudSnapshot: cloud.pullCloudSnapshot,
  pushCloudSnapshot: cloud.pushCloudSnapshot,
  pullVersion: cloud.pullVersion,
  saveCloudConfig: cloud.saveCloudConfig,
  testCloudConnection: cloud.testCloudConnection,
  clearCloudConfig: cloud.clearCloudConfig,
}));

const { useAccount } = await import('./useAccount');

const notice = vi.fn();
const changed = vi.fn();

function renderAccount() {
  return renderHook(() => useAccount({ onDataChanged: changed, onNotice: notice }));
}

beforeEach(() => {
  // accounts.ts caches the session in memory, so clearing storage is not enough.
  signOut();
  localStorage.clear();
  vi.clearAllMocks();
  cloud.isCloudConfigured = true;
  cloud.loadCloudSession.mockReturnValue({ userId: 'u1', accessToken: 't', expiresAt: Date.now() + 60_000 });
  cloud.cloudSignIn.mockResolvedValue({ ok: true, data: { userId: 'lakshit', accessToken: 'token' } });
  cloud.cloudSignUp.mockResolvedValue({ ok: true, data: { userId: 'lakshit', accessToken: 'token' } });
  cloud.pullCloudSnapshot.mockResolvedValue({ ok: true, data: null });
  cloud.pullVersion.mockResolvedValue({ ok: true, data: null });
  cloud.pushCloudSnapshot.mockResolvedValue({ ok: true });
});

describe('signing in on a device that has never seen this planner', () => {
  it('asks the shared backend even though no account exists locally', async () => {
    // The bug: the old order checked local first, found nothing, and gave up.
    const { result } = renderAccount();

    let outcome: { ok: boolean; error?: string } = { ok: false };
    await act(async () => {
      outcome = await result.current.signIn('lakshit', 'open sesame 72');
    });

    expect(cloud.cloudSignIn).toHaveBeenCalledWith('lakshit', 'open sesame 72');
    expect(outcome.ok).toBe(true);
  });

  it('leaves a working local account behind, so the next sign-in works offline', async () => {
    const { result } = renderAccount();
    await act(async () => {
      await result.current.signIn('lakshit', 'open sesame 72');
    });

    expect(result.current.account?.id).toBe('lakshit');
    // Straight local verification, no network involved.
    const offline = await signInLocal('lakshit', 'open sesame 72');
    expect(offline.ok).toBe(true);
  });

  it('reports the backend’s message when the password is genuinely wrong', async () => {
    cloud.cloudSignIn.mockResolvedValue({ ok: false, error: 'That user ID and password do not match.' });
    const { result } = renderAccount();

    let outcome: { ok: boolean; error?: string } = { ok: false };
    await act(async () => {
      outcome = await result.current.signIn('lakshit', 'wrong password');
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain('do not match');
    expect(result.current.account).toBeNull();
  });

  it('still lets you in offline when this device already holds the account', async () => {
    await adoptVerifiedAccount({ userId: 'lakshit', password: 'open sesame 72' });
    const { result } = renderAccount();
    // Offline means the create attempt fails too, not just the sign-in.
    cloud.cloudSignIn.mockResolvedValue({ ok: false, error: 'Could not reach the sync API.' });
    cloud.cloudSignUp.mockResolvedValue({ ok: false, error: 'Could not reach the sync API.' });

    let outcome: { ok: boolean; error?: string } = { ok: false };
    await act(async () => {
      outcome = await result.current.signIn('lakshit', 'open sesame 72');
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.error).toContain('this device only');
  });

  it('puts an account that only exists on this device into the shared database', async () => {
    // The laptop made the account before the API deployed; the phone has never
    // heard of it. Signing in here should fix that instead of dead-ending.
    await adoptVerifiedAccount({ userId: 'lakshit', password: 'open sesame 72' });
    const { result } = renderAccount();
    cloud.cloudSignIn.mockResolvedValue({ ok: false, error: 'That user ID and password do not match.', status: 401 });

    let outcome: { ok: boolean; error?: string } = { ok: false };
    await act(async () => {
      outcome = await result.current.signIn('lakshit', 'open sesame 72');
    });

    expect(cloud.cloudSignUp).toHaveBeenCalledWith('lakshit', 'open sesame 72', expect.anything());
    expect(outcome.ok).toBe(true);
    expect(outcome.error).toContain('works on your phone');
    expect(result.current.cloudConnected).toBe(true);
  });

  it('never invents a remote account from a wrong password', async () => {
    await adoptVerifiedAccount({ userId: 'lakshit', password: 'open sesame 72' });
    const { result } = renderAccount();
    cloud.cloudSignIn.mockResolvedValue({ ok: false, error: 'That user ID and password do not match.', status: 401 });

    let outcome: { ok: boolean; error?: string } = { ok: false };
    await act(async () => {
      outcome = await result.current.signIn('lakshit', 'not the password');
    });

    expect(outcome.ok).toBe(false);
    expect(cloud.cloudSignUp).not.toHaveBeenCalled();
  });

  it('lets an empty device change hands instead of dead-ending', async () => {
    // Someone tried a different ID on this phone and left nothing behind. The
    // old guard refused the account that actually holds the tasks, and the
    // message read like a rejected password.
    bindDevice('someone-else');
    const { result } = renderAccount();

    let outcome: { ok: boolean; error?: string } = { ok: false };
    await act(async () => {
      outcome = await result.current.signIn('lakshit', 'open sesame 72');
    });

    expect(outcome.ok).toBe(true);
    expect(result.current.account?.id).toBe('lakshit');
  });

  it('creates the account on the backend first when signing up', async () => {
    const { result } = renderAccount();
    await act(async () => {
      await result.current.signUp('lakshit', 'open sesame 72', 'Lakshit');
    });

    expect(cloud.cloudSignUp).toHaveBeenCalledWith('lakshit', 'open sesame 72', 'Lakshit');
    await waitFor(() => expect(result.current.account?.id).toBe('lakshit'));
  });

  it('treats "already exists" as a sign-in rather than a dead end', async () => {
    cloud.cloudSignUp.mockResolvedValue({ ok: false, error: 'That user ID already exists. Sign in instead.' });
    const { result } = renderAccount();

    let outcome: { ok: boolean; error?: string } = { ok: false };
    await act(async () => {
      outcome = await result.current.signUp('lakshit', 'open sesame 72');
    });

    expect(cloud.cloudSignIn).toHaveBeenCalled();
    expect(outcome.ok).toBe(true);
  });
});
