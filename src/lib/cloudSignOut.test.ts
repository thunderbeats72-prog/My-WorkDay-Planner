import { describe, expect, it, vi } from 'vitest';

const backend = vi.hoisted(() => ({ signOut: vi.fn(async () => undefined) }));
vi.mock('./neonBackend', () => ({ apiStatus: () => 'ready', neonSignOut: backend.signOut }));
import { cloudSignOut, loadCloudSession, type CloudSession } from './cloudSync';

const session = (accessToken: string): CloudSession => ({
  userId: 'alice', email: 'alice', accessToken, refreshToken: accessToken, expiresAt: Date.now() + 60_000,
});
function save(value: CloudSession) { localStorage.setItem('workday.cloud.session.v1', JSON.stringify(value)); }

describe('sign-out cleanup', () => {
  it('detaches immediately, revokes the old token after cleanup, and never signs out a new session', async () => {
    save(session('old-token'));
    let resume!: () => void;
    const pending = cloudSignOut(async (old) => {
      expect(old.accessToken).toBe('old-token');
      expect(loadCloudSession()).toBeNull();
      await new Promise<void>((resolve) => { resume = resolve; });
    });
    expect(loadCloudSession()).toBeNull();
    save(session('new-token'));
    resume();
    await pending;
    expect(loadCloudSession()?.accessToken).toBe('new-token');
    expect(backend.signOut).toHaveBeenCalledWith('old-token');
  });
});
