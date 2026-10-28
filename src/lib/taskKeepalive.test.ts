import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Task } from './types';

const auth = vi.hoisted(() => ({ enabled: true, session: { accessToken: 'session', expiresAt: Date.now() + 60_000 } }));
vi.mock('./cloudSync', () => ({ neonEnabled: () => auth.enabled, loadCloudSession: () => auth.session }));
import { syncChangedTasksKeepalive } from './taskKeepalive';

const changed = { id: 'task', title: 'Existing', updatedAt: '2026-10-28T10:00:00.000Z' } as Task;
afterEach(() => { vi.unstubAllGlobals(); auth.enabled = true; });

describe('immediate task sync', () => {
  it('uses an authenticated relative keepalive request for changed tasks', async () => {
    const fetcher = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal('fetch', fetcher);
    expect(await syncChangedTasksKeepalive([changed])).toBe(true);
    expect(fetcher).toHaveBeenCalledWith('/api/snapshot', expect.objectContaining({
      keepalive: true, method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer session' }),
      body: JSON.stringify({ changedTasks: [changed] }),
    }));
  });

  it('leaves oversized/offline edits to the existing full snapshot retry', async () => {
    const fetcher = vi.fn(async () => { throw new Error('offline'); });
    vi.stubGlobal('fetch', fetcher);
    expect(await syncChangedTasksKeepalive([{ ...changed, notes: 'x'.repeat(70_000) }])).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
    expect(await syncChangedTasksKeepalive([changed])).toBe(false);
    auth.enabled = false;
    expect(await syncChangedTasksKeepalive([changed])).toBe(false);
  });
});
