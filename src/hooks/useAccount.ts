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
  clearCloudConfig,
  cloudSignIn,
  cloudSignOut,
  cloudSignUp,
  ensureBackend,
  isCloudConfigured,
  neonEnabled,
  loadCloudSession,
  pullCloudSnapshot,
  pullVersion,
  pushCloudSnapshot,
  saveCloudConfig,
  testCloudConnection,
} from '../lib/cloudSync';
import { apiStatus } from '../lib/neonBackend';
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
  /**
   * Put an account that only exists on this device into the shared database,
   * with the password the person already knows. This is the one tap that makes
   * a laptop-only login work on a phone.
   */
  publishAccount: (password: string) => Promise<{ ok: boolean; error?: string }>;
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

/**
 * Turn the server's refusal into the next thing a person should try.
 *
 * "That user ID and password do not match" is deliberate — the endpoint must not
 * double as a way to discover which IDs exist — so the guidance has to be
 * generic: an account made before the database existed is the common case, and
 * `Create account` with the same pair is the fix.
 */
function signInFailure(error: string | undefined, status: number | undefined): string {
  const base = error ?? 'That user ID and password do not match.';
  if (status === 401) {
    return `${base} If this account was only ever created on one device, tap “Create account” and use the same user ID and password — that adds it to the shared database.`;
  }
  if (status === 404 || /did not deploy|not answering/i.test(base)) {
    return `${base} Nothing is wrong with your account or your password. (API 404)`;
  }
  if (status && status >= 500) return `${base} (API ${status})`;
  return base;
}

/** Why a login that only knows this device did not work. */
function noBackendReason(localError: string | undefined): string {
  const state = apiStatus();
  if (state === 'missing') {
    return 'This site is not serving its own sign-in server, so it cannot check a shared account. Your password is fine — nothing was sent. (API 404)';
  }
  if (state === 'no-database') {
    return 'This site has its sign-in server but no database attached to it. Your password is fine — nothing was sent. (API 500 · DATABASE_URL missing)';
  }
  if (state === 'unreachable') {
    return 'The connection dropped before the sign-in server answered. Your tasks are still safe on this device.';
  }
  return localError ?? 'That user ID and password do not match.';
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
   * Find out whether this deployment has a database behind it.
   *
   * Runs once, before anyone tries to sign in, so the form knows which sentence
   * is true. It is the difference between "your password is wrong" and "this
   * copy has no shared database", and those are very different sentences for
   * someone signing in on a phone.
   */
  useEffect(() => {
    if (cloudConfigured) return;
    let cancelled = false;
    void ensureBackend().then(() => {
      if (!cancelled) setCloudConfigured(isCloudConfigured());
    });
    return () => {
      cancelled = true;
    };
  }, [cloudConfigured]);

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

  /**
   * `cloudConfigured` is in the dependency list below on purpose.
   *
   * The database can be discovered *after* mount — a deployment without the
   * build flag asks `/api/health` on the first effect. Without the dependency
   * this loop ran once, judged the deployment local-only, returned, and never
   * came back: edits uploaded, and nothing was ever pulled down. That is the
   * "added it on my phone and my laptop never saw it" bug.
   */
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
  }, [accountId, cloudConfigured, noteActivity, syncNow]);

  // A pending debounce must not fire after the component goes away.
  useEffect(
    () => () => {
      if (pushTimer.current !== null) window.clearTimeout(pushTimer.current);
    },
    [],
  );

  /**
   * One planner, one account per device — but only to protect data that exists.
   *
   * A phone someone experimented on, with nothing in it, refused the account
   * that actually holds everything, and the message read like a wrong password.
   * An empty device has nothing to protect, so it simply changes hands.
   */
  const guardDevice = useCallback(async (userId: string): Promise<string | null> => {
    const owner = getDeviceOwner();
    if (!owner || owner.userId === userId) return null;

    const [tasks, sessions, reminderRows, events] = await Promise.all([
      listTasks(),
      listSessions(),
      listReminders(),
      listAllEvents(),
    ]);
    if (tasks.length === 0 && sessions.length === 0 && reminderRows.length === 0 && events.length === 0) {
      bindDevice(userId);
      return null;
    }
    return `This device's tasks belong to @${owner.userId}. Sign in as @${owner.userId}, or reset data in Settings before using another account.`;
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
      const blocked = await guardDevice(id);
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
      const blocked = await guardDevice(id);
      if (blocked) return { ok: false, error: blocked };
      setBusy(true);
      try {
        // Ask the deployment before judging the password. A phone that has never
        // seen this planner is exactly where a build without the flag used to
        // fail, silently, as "no account on this device".
        await ensureBackend();
        if (isCloudConfigured()) {
          setCloudConfigured(true);
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
            const already = local.account;
            // The password is right for this device, but the shared database has
            // no such account — the state a laptop reaches when it made the
            // account before the database existed. Put it in the database with
            // the password just proved here, and the phone will find it.
            const published = await cloudSignUp(id, password, already.displayName);
            if (published.ok) {
              const adopted = await adoptVerifiedAccount({ userId: id, password });
              bindDevice((adopted.account ?? already).id);
              setCloudConnected(true);
              const result = await syncNow({ quiet: true });
              return {
                ok: true,
                error: result.ok
                  ? 'Signed in. This account is now in the shared database, so the same user ID works on your phone.'
                  : result.message,
              };
            }
            bindDevice(already.id);
            return {
              ok: true,
              error:
                'Signed in on this device only. The shared database does not have this account yet — open Settings → Account and tap “Add to the shared database”.',
            };
          }
          return { ok: false, error: signInFailure(remote.error, remote.status) };
        }

        const local = await signInLocal(id, password);
        if (!local.ok || !local.account) return { ok: false, error: noBackendReason(local.error) };
        bindDevice(local.account.id);
        return {
          ok: true,
          error:
            'No shared database is attached to this copy, so there was nothing to fetch from your other device. The login works here; the tasks stay here too.',
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

  const publishAccount = useCallback(
    async (password: string) => {
      if (!account) return { ok: false, error: 'Sign in first.' };
      await ensureBackend();
      if (!isCloudConfigured()) {
        return { ok: false, error: 'This copy has no shared database, so there is nowhere to add it yet.' };
      }
      setBusy(true);
      try {
        // Prove the password on this device before using it to create a server
        // account: otherwise a typo here would create a second identity.
        const proof = await signInLocal(account.id, password);
        if (!proof.ok || !proof.account) return { ok: false, error: 'That password does not match this device.' };

        let remote = await cloudSignUp(account.id, password, account.displayName);
        if (!remote.ok) {
          // It may already exist remotely with the same password — then this is
          // simply a sign-in, and the local copy gets adopted properly.
          remote = await cloudSignIn(account.id, password);
          if (!remote.ok) return { ok: false, error: signInFailure(remote.error, remote.status) };
        }
        setCloudConnected(true);
        setCloudConfigured(true);
        const result = await syncNow({ quiet: true });
        return { ok: true, error: result.ok ? undefined : result.message };
      } finally {
        setBusy(false);
      }
    },
    [account, syncNow],
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
    syncBuiltIn: neonEnabled(),
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
    publishAccount,
  };
}
