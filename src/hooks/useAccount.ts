import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  accountSnapshot,
  adoptVerifiedAccount,
  bindDevice,
  changePassword as changeLocalPassword,
  deleteAccount as deleteLocalAccount,
  getDeviceOwner,
  signIn as signInLocal,
  signOut as signOutLocal,
  signUp as signUpLocal,
  subscribeToAccount,
  type StoredAccount,
} from '../lib/accounts';
import {
  IS_NEON,
  clearCloudConfig,
  cloudSignIn,
  cloudSignOut,
  cloudSignUp,
  isCloudConfigured,
  loadCloudSession,
  pullCloudSnapshot,
  pullVersion,
  pushCloudSnapshot,
  saveCloudConfig,
  testCloudConnection,
} from '../lib/cloudSync';
import {
  createBackupPayload,
  listAllEvents,
  listReminders,
  listSessions,
  listTasks,
  loadSettings,
  restoreBackup,
} from '../lib/db';
import { describeMerge, mergeIsQuiet, mergeSnapshots } from '../lib/snapshot';
import type { BackupFile } from '../lib/db';

export interface AccountState {
  account: StoredAccount | null;
  cloudConfigured: boolean;
  cloudConnected: boolean;
  lastSyncedAt: string | null;
  /** True when the deployment supplies a backend, so there is nothing to paste. */
  syncBuiltIn: boolean;
}

export interface AccountApi extends AccountState {
  busy: boolean;
  syncNow: () => Promise<{ ok: boolean; message: string }>;
  /** Call after a local edit. Debounced, so a burst of typing is one push. */
  schedulePush: () => void;
  signUp: (userId: string, password: string, displayName?: string) => Promise<{ ok: boolean; error?: string }>;
  signIn: (userId: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  signOut: () => void;
  changePassword: (current: string, next: string) => Promise<{ ok: boolean; error?: string }>;
  removeAccount: (password: string) => Promise<{ ok: boolean; error?: string }>;
  connectCloud: (url: string, anonKey: string) => Promise<{ ok: boolean; error?: string }>;
  disconnectCloud: () => void;
}

const LAST_SYNC_KEY = 'workday.cloud.last-sync.v1';
const CHANGED_KEY = 'workday.cloud.changed-at.v1';

/** A change anywhere reaches the other device within roughly a poll interval. */
const POLL_ACTIVE_MS = 4_000;
/** After a couple of minutes without anyone touching this device, slow down. */
const POLL_IDLE_MS = 30_000;
const IDLE_AFTER_MS = 120_000;
/** How long to wait after an edit before pushing, so typing is not a storm. */
const PUSH_DEBOUNCE_MS = 2_500;
/** Local tabs announce writes to each other on this channel. */
const CHANNEL = 'workday-sync';

function readLastSync(): string | null {
  try {
    return localStorage.getItem(LAST_SYNC_KEY);
  } catch {
    return null;
  }
}

function readChangedAt(): string {
  try {
    return localStorage.getItem(CHANGED_KEY) ?? '1970-01-01T00:00:00.000Z';
  } catch {
    return '1970-01-01T00:00:00.000Z';
  }
}

function markChanged(): string {
  const at = new Date().toISOString();
  try {
    localStorage.setItem(CHANGED_KEY, at);
  } catch {
    // Cosmetic: worst case a settings change loses a tie-break.
  }
  return at;
}

function writeLastSync(): void {
  try {
    localStorage.setItem(LAST_SYNC_KEY, new Date().toISOString());
  } catch {
    // Cosmetic only.
  }
}

/** Everything on this device, in the shape the backup format already uses. */
export async function buildLocalSnapshot(exportedAt?: string): Promise<BackupFile> {
  const [settings, tasks, sessions, reminders, events] = await Promise.all([
    loadSettings(),
    listTasks(),
    listSessions(),
    listReminders(),
    listAllEvents(),
  ]);
  const snapshot = createBackupPayload(settings, tasks, sessions, reminders, events);
  // `exportedAt` doubles as "when this device's data last changed". Stamping the
  // moment of the snapshot instead would make every device look like the newest
  // writer and send settings ping-ponging between them.
  return exportedAt ? { ...snapshot, exportedAt } : snapshot;
}

export function useAccount({
  onDataChanged,
  onNotice,
}: {
  onDataChanged: () => void;
  onNotice: (message: string, tone: 'success' | 'info' | 'warning' | 'danger') => void;
}): AccountApi {
  const account = useSyncExternalStore(subscribeToAccount, accountSnapshot, accountSnapshot);
  const [busy, setBusy] = useState(false);
  const [cloudConfigured, setCloudConfigured] = useState(() => isCloudConfigured());
  const [cloudConnected, setCloudConnected] = useState(() => loadCloudSession() !== null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(() => readLastSync());
  const syncing = useRef(false);
  const notice = useRef(onNotice);
  const refreshData = useRef(onDataChanged);
  useEffect(() => {
    notice.current = onNotice;
  }, [onNotice]);
  useEffect(() => {
    refreshData.current = onDataChanged;
  }, [onDataChanged]);

  /**
   * Full round trip: read local, read remote, merge, write back if — and only
   * if — the server is missing something this device has.
   */
  const syncNow = useCallback(
    async (options: { quiet?: boolean } = {}): Promise<{ ok: boolean; message: string }> => {
      if (syncing.current) return { ok: false, message: 'A sync is already running.' };
      if (!isCloudConfigured()) {
        return { ok: false, message: 'Sync is off in this copy, so there is nothing to sync to yet.' };
      }
      if (!loadCloudSession()) return { ok: false, message: 'Sign in again to resume syncing.' };

      syncing.current = true;
      if (!options.quiet) setBusy(true);
      try {
        const local = await buildLocalSnapshot(readChangedAt());
        const pulled = await pullCloudSnapshot();
        if (!pulled.ok) return { ok: false, message: pulled.error ?? 'Could not reach the sync project.' };

        if (!pulled.data) {
          const pushed = await pushCloudSnapshot(local);
          if (!pushed.ok) return { ok: false, message: pushed.error ?? 'Upload failed.' };
          writeLastSync();
          setLastSyncedAt(readLastSync());
          return { ok: true, message: 'This device uploaded its first snapshot — your other device will pick it up.' };
        }

        const { merged, stats } = mergeSnapshots(local, pulled.data);
        if (!mergeIsQuiet(stats)) {
          await restoreBackup(merged, 'replace');
          refreshData.current();
        }
        // No write means no new timestamp, which means the other device stops
        // seeing a change. Without this the two devices trade updates forever.
        if (stats.needsPush) {
          const pushed = await pushCloudSnapshot(merged);
          if (!pushed.ok) return { ok: false, message: pushed.error ?? 'Upload failed.' };
        }
        writeLastSync();
        setLastSyncedAt(readLastSync());
        return { ok: true, message: describeMerge(stats) };
      } finally {
        syncing.current = false;
        if (!options.quiet) setBusy(false);
      }
    },
    [],
  );

  const syncNowPublic = useCallback(() => syncNow(), [syncNow]);

  /**
   * The real-time engine.
   *
   * Three things keep two devices in step:
   *   1. an edit here pushes after a short debounce (`schedulePush`);
   *   2. a cheap `/api/version` poll asks "did anything change?" every few
   *      seconds while this tab is visible, and only then does a full sync;
   *   3. tabs on the same device announce writes to each other over a
   *      BroadcastChannel, so a second window updates without waiting.
   *
   * The poll slows to one every 30s when nobody has touched the device for two
   * minutes, and stops entirely while the tab is hidden — a background tab
   * should not keep a database awake.
   */
  const accountId = account?.id ?? null;
  const lastActivity = useRef(0);
  const remoteVersion = useRef<string | null>(null);
  const pushTimer = useRef<number | null>(null);
  const channel = useRef<BroadcastChannel | null>(null);

  const noteActivity = useCallback(() => {
    lastActivity.current = Date.now();
  }, []);

  // Start the idle clock once mounted, not during render.
  useEffect(() => {
    lastActivity.current = Date.now();
  }, []);

  const schedulePush = useCallback(() => {
    markChanged();
    noteActivity();
    if (!isCloudConfigured() || !loadCloudSession()) return;
    if (pushTimer.current !== null) window.clearTimeout(pushTimer.current);
    pushTimer.current = window.setTimeout(() => {
      pushTimer.current = null;
      void (async () => {
        const result = await syncNow({ quiet: true });
        if (result.ok) {
          // This device just wrote; take the new timestamp as the baseline so
          // its own change does not look like somebody else's.
          remoteVersion.current = null;
          channel.current?.postMessage({ type: 'synced', at: Date.now() });
        }
      })();
    }, PUSH_DEBOUNCE_MS);
  }, [noteActivity, syncNow]);

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const bus = new BroadcastChannel(CHANNEL);
    channel.current = bus;
    bus.onmessage = () => {
      // Another tab wrote. Its write is already in IndexedDB, so re-read it
      // rather than syncing again over the network.
      void (async () => {
        await refreshData.current();
        remoteVersion.current = null;
      })();
    };
    return () => {
      channel.current = null;
      bus.close();
    };
  }, []);

  useEffect(() => {
    if (!accountId || !isCloudConfigured() || !loadCloudSession()) return;
    let cancelled = false;
    let timer: number | undefined;

    const schedule = () => {
      if (cancelled) return;
      const idle = Date.now() - lastActivity.current > IDLE_AFTER_MS;
      const delay = document.visibilityState === 'hidden' ? POLL_IDLE_MS * 4 : idle ? POLL_IDLE_MS : POLL_ACTIVE_MS;
      timer = window.setTimeout(() => void tick(), delay);
    };

    const tick = async () => {
      if (cancelled) return;
      if (document.visibilityState === 'hidden') {
        schedule();
        return;
      }
      const version = await pullVersion();
      if (cancelled) return;
      if (version.ok) {
        if (version.data === null) {
          // This backend cannot answer cheaply; fall back to an ordinary sync
          // on a slow beat rather than pretending to be real-time.
          if (Date.now() - lastActivity.current < IDLE_AFTER_MS) await syncNow({ quiet: true });
        } else if (remoteVersion.current !== null && version.data !== remoteVersion.current) {
          const result = await syncNow({ quiet: true });
          if (result.ok && !/already match/.test(result.message)) notice.current(result.message, 'info');
        }
        remoteVersion.current = version.data ?? null;
      }
      schedule();
    };

    // Something already reached us; start from the current server state.
    void (async () => {
      const version = await pullVersion();
      if (!cancelled && version.ok) remoteVersion.current = version.data ?? null;
      if (!cancelled) await syncNow({ quiet: true });
      schedule();
    })();

    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      noteActivity();
      if (timer !== undefined) window.clearTimeout(timer);
      void tick();
    };
    const onActivity = () => noteActivity();

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pointerdown', onActivity, { passive: true });
    window.addEventListener('keydown', onActivity);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pointerdown', onActivity);
      window.removeEventListener('keydown', onActivity);
    };
  }, [accountId, noteActivity, syncNow]);

  // A pending debounce must not fire after the component goes away.
  useEffect(
    () => () => {
      if (pushTimer.current !== null) window.clearTimeout(pushTimer.current);
    },
    [],
  );

  const guardDevice = useCallback((userId: string): string | null => {
    const owner = getDeviceOwner();
    if (owner && owner.userId !== userId) {
      return `This device's tasks belong to @${owner.userId}. Sign in as @${owner.userId}, or reset data in Settings before using another account.`;
    }
    return null;
  }, []);

  /**
   * Creating an account where a backend exists creates it *there* first.
   *
   * The old order (local, then remote) meant a phone could hold a half-account:
   * locally created, remotely rejected, and now permanently unable to sign in
   * with the password the laptop accepted.
   */
  const signUp = useCallback(
    async (userId: string, password: string, displayName?: string) => {
      const id = userId.trim().replace(/^@+/, '').toLowerCase();
      const blocked = guardDevice(id);
      if (blocked) return { ok: false, error: blocked };
      setBusy(true);
      try {
        if (isCloudConfigured()) {
          let remote = await cloudSignUp(id, password, displayName);
          if (!remote.ok) {
            // The account may already exist because it was created on the other
            // device; in that case this is really a sign-in.
            remote = await cloudSignIn(id, password);
            if (!remote.ok) return { ok: false, error: remote.error };
          }
          const adopted = await adoptVerifiedAccount({ userId: id, password, displayName });
          if (!adopted.ok || !adopted.account) return { ok: false, error: adopted.error };
          bindDevice(adopted.account.id);
          setCloudConnected(true);
          const result = await syncNow({ quiet: true });
          return { ok: true, error: result.ok ? undefined : result.message };
        }

        const local = await signUpLocal({ userId: id, password, displayName });
        if (!local.ok || !local.account) return { ok: false, error: local.error };
        bindDevice(local.account.id);
        return {
          ok: true,
          error:
            'No sync database is deployed with this copy yet, so this account lives on this device. It starts following you to other devices the moment the site is deployed with its database.',
        };
      } finally {
        setBusy(false);
      }
    },
    [guardDevice, syncNow],
  );

  /**
   * Signing in checks the shared backend first.
   *
   * The previous order checked the local device first, so a phone that had never
   * seen this planner could never sign in at all: "no account on this device"
   * came back before the server was ever asked. That is the bug behind "the same
   * password works on my laptop but not on my phone".
   *
   * If the backend is unreachable, a real local account still gets you in — an
   * offline laptop should not become a locked laptop.
   */
  const signIn = useCallback(
    async (userId: string, password: string) => {
      const id = userId.trim().replace(/^@+/, '').toLowerCase();
      const blocked = guardDevice(id);
      if (blocked) return { ok: false, error: blocked };
      setBusy(true);
      try {
        if (isCloudConfigured()) {
          const remote = await cloudSignIn(id, password);
          if (remote.ok) {
            const adopted = await adoptVerifiedAccount({ userId: id, password });
            if (!adopted.ok || !adopted.account) return { ok: false, error: adopted.error };
            bindDevice(adopted.account.id);
            setCloudConnected(true);
            const result = await syncNow({ quiet: true });
            return { ok: true, error: result.ok ? undefined : result.message };
          }

          const local = await signInLocal(id, password);
          if (local.ok && local.account) {
            bindDevice(local.account.id);
            return { ok: true, error: `Signed in on this device only — ${remote.error}` };
          }
          return { ok: false, error: remote.error };
        }

        const local = await signInLocal(id, password);
        if (!local.ok || !local.account) return { ok: false, error: local.error };
        bindDevice(local.account.id);
        return {
          ok: true,
          error:
            'No sync database is deployed with this copy, so there was nothing to fetch from your other device. The login works here; the tasks stay here too.',
        };
      } finally {
        setBusy(false);
      }
    },
    [guardDevice, syncNow],
  );

  const signOut = useCallback(() => {
    void cloudSignOut();
    signOutLocal();
    setCloudConnected(false);
    notice.current('Signed out. Your tasks stay on this device.', 'info');
  }, []);

  const changePassword = useCallback(async (current: string, next: string) => {
    if (!account) return { ok: false, error: 'Sign in first.' };
    const result = await changeLocalPassword(account.id, current, next);
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true };
  }, [account]);

  const removeAccount = useCallback(
    async (password: string) => {
      if (!account) return { ok: false, error: 'Sign in first.' };
      const result = await deleteLocalAccount(account.id, password);
      if (!result.ok) return { ok: false, error: result.error };
      setCloudConnected(false);
      notice.current('Account deleted from this device. Your tasks are untouched.', 'info');
      return { ok: true };
    },
    [account],
  );

  const connectCloud = useCallback(
    async (url: string, anonKey: string) => {
      setBusy(true);
      try {
        const saved = saveCloudConfig(url, anonKey);
        if (!saved.ok || !saved.data) return { ok: false, error: saved.error };
        const tested = await testCloudConnection(saved.data.url, saved.data.anonKey);
        if (!tested.ok) {
          clearCloudConfig();
          return { ok: false, error: tested.error };
        }
        setCloudConfigured(true);
        return { ok: true };
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const disconnectCloud = useCallback(() => {
    void cloudSignOut();
    clearCloudConfig();
    setCloudConfigured(false);
    setCloudConnected(false);
    notice.current('Sync disconnected. The planner is local-only again.', 'info');
  }, []);

  return {
    account,
    cloudConfigured,
    cloudConnected,
    lastSyncedAt,
    syncBuiltIn: IS_NEON,
    busy,
    syncNow: syncNowPublic,
    schedulePush,
    signUp,
    signIn,
    signOut,
    changePassword,
    removeAccount,
    connectCloud,
    disconnectCloud,
  };
}
