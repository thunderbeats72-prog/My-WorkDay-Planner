import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  accountSnapshot,
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
  clearCloudConfig,
  cloudSignIn,
  cloudSignOut,
  cloudSignUp,
  isCloudConfigured,
  loadCloudSession,
  pullCloudSnapshot,
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
}

export interface AccountApi extends AccountState {
  busy: boolean;
  syncNow: () => Promise<{ ok: boolean; message: string }>;
  signUp: (userId: string, password: string, displayName?: string) => Promise<{ ok: boolean; error?: string }>;
  signIn: (userId: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  signOut: () => void;
  changePassword: (current: string, next: string) => Promise<{ ok: boolean; error?: string }>;
  removeAccount: (password: string) => Promise<{ ok: boolean; error?: string }>;
  connectCloud: (url: string, anonKey: string) => Promise<{ ok: boolean; error?: string }>;
  disconnectCloud: () => void;
}

const LAST_SYNC_KEY = 'workday.cloud.last-sync.v1';

function readLastSync(): string | null {
  try {
    return localStorage.getItem(LAST_SYNC_KEY);
  } catch {
    return null;
  }
}

function writeLastSync(): void {
  try {
    localStorage.setItem(LAST_SYNC_KEY, new Date().toISOString());
  } catch {
    // Cosmetic only.
  }
}

/** Everything on this device, in the shape the backup format already uses. */
export async function buildLocalSnapshot(): Promise<BackupFile> {
  const [settings, tasks, sessions, reminders, events] = await Promise.all([
    loadSettings(),
    listTasks(),
    listSessions(),
    listReminders(),
    listAllEvents(),
  ]);
  return createBackupPayload(settings, tasks, sessions, reminders, events);
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

  const syncNow = useCallback(async (): Promise<{ ok: boolean; message: string }> => {
    if (syncing.current) return { ok: false, message: 'A sync is already running.' };
    if (!isCloudConfigured()) return { ok: false, message: 'Connect a sync project first — see "Use on phone and laptop".' };
    if (!loadCloudSession()) return { ok: false, message: 'Sign in again to resume syncing.' };

    syncing.current = true;
    setBusy(true);
    try {
      const local = await buildLocalSnapshot();
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
      const pushed = await pushCloudSnapshot(merged);
      if (!pushed.ok) return { ok: false, message: pushed.error ?? 'Upload failed.' };
      writeLastSync();
      setLastSyncedAt(readLastSync());
      return { ok: true, message: describeMerge(stats) };
    } finally {
      syncing.current = false;
      setBusy(false);
    }
  }, []);

  /** Background refresh: quiet, never nags, never blocks the UI. */
  const accountId = account?.id ?? null;
  useEffect(() => {
    if (!accountId || !isCloudConfigured()) return;
    if (!loadCloudSession()) return;
    let cancelled = false;

    const tick = async () => {
      if (cancelled || document.visibilityState === 'hidden') return;
      const result = await syncNow();
      if (!cancelled && result.ok && !/already match/.test(result.message)) {
        notice.current(result.message, 'info');
      }
    };

    void tick();
    const interval = window.setInterval(() => void tick(), 120_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [accountId, syncNow]);

  const guardDevice = useCallback((userId: string): string | null => {
    const owner = getDeviceOwner();
    if (owner && owner.userId !== userId) {
      return `This device's tasks belong to @${owner.userId}. Sign in as @${owner.userId}, or reset data in Settings before using another account.`;
    }
    return null;
  }, []);

  const signUp = useCallback(
    async (userId: string, password: string, displayName?: string) => {
      const blocked = guardDevice(userId.trim().toLowerCase().replace(/^@+/, ''));
      if (blocked) return { ok: false, error: blocked };
      setBusy(true);
      try {
        const local = await signUpLocal({ userId, password, displayName });
        if (!local.ok || !local.account) return { ok: false, error: local.error };
        bindDevice(local.account.id);
        if (isCloudConfigured()) {
          const remote = await cloudSignUp(local.account.id, password);
          if (remote.ok) setCloudConnected(true);
          else return { ok: true, error: remote.error };
        }
        return { ok: true };
      } finally {
        setBusy(false);
      }
    },
    [guardDevice],
  );

  const signIn = useCallback(
    async (userId: string, password: string) => {
      const blocked = guardDevice(userId.trim().toLowerCase().replace(/^@+/, ''));
      if (blocked) return { ok: false, error: blocked };
      setBusy(true);
      try {
        const local = await signInLocal(userId, password);
        if (!local.ok || !local.account) return { ok: false, error: local.error };
        bindDevice(local.account.id);
        if (isCloudConfigured()) {
          const remote = await cloudSignIn(local.account.id, password);
          if (remote.ok) {
            setCloudConnected(true);
            const result = await syncNow();
            return { ok: true, error: result.ok ? undefined : result.message };
          }
          return { ok: true, error: remote.error };
        }
        return { ok: true };
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
    busy,
    syncNow,
    signUp,
    signIn,
    signOut,
    changePassword,
    removeAccount,
    connectCloud,
    disconnectCloud,
  };
}
