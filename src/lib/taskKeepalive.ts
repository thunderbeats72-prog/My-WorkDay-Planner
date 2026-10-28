import { loadCloudSession, neonEnabled } from './cloudSync';
import type { Task } from './types';

/**
 * A small, authenticated keepalive write gives deadline/status changes a chance
 * to finish even when the tab closes immediately. Full snapshot sync remains
 * authoritative for initial upload, retries, settings and all other data.
 */
export async function syncChangedTasksKeepalive(tasks: Task[]): Promise<boolean> {
  const session = loadCloudSession();
  if (!neonEnabled() || !session || session.expiresAt <= Date.now() || !tasks.length) return false;
  // Browsers cap the aggregate keepalive body. Skip oversized edits rather than
  // silently truncating data; the normal snapshot sync will retry them.
  const body = JSON.stringify({ changedTasks: tasks });
  if (new TextEncoder().encode(body).length > 60_000 || tasks.length > 200) return false;
  try {
    const response = await fetch('/api/snapshot', {
      method: 'POST', keepalive: true, cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.accessToken}` }, body,
    });
    if (!response.ok) console.warn('[reminders] immediate task sync deferred', { status: response.status });
    return response.ok;
  } catch {
    console.warn('[reminders] immediate task sync deferred', { status: 'network' });
    return false;
  }
}
