import { loadCloudSession, neonEnabled, type CloudSession } from './cloudSync';
import type { AppNotification } from './notifications';
import { clearWorkerRenewalForEndpoint, saveWorkerRenewal } from './workerRenewal';

export type BackgroundPushState = 'unsupported' | 'sign-in' | 'unconfigured' | 'not-enabled' | 'scheduler-offline' | 'active' | 'error' | 'checking';
export interface BackgroundPushStatus {
  state: BackgroundPushState;
  message: string;
  subscribed: boolean;
  schedulerLastSuccess: string | null;
  history: AppNotification[];
}

// Public only, and short-lived: prefetching avoids a network round trip in the
// user-gesture-sensitive PushManager.subscribe path (notably on iOS).
let cachedKey: { value: string; at: number } | null = null;

const base = (state: BackgroundPushState, message: string): BackgroundPushStatus => ({
  state, message, subscribed: false, schedulerLastSuccess: null, history: [],
});

function supported(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext !== false &&
    'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

async function call<T>(operation?: Record<string, unknown>, detachedSession?: CloudSession): Promise<T> {
  const session = detachedSession ?? loadCloudSession();
  if ((!detachedSession && !neonEnabled()) || !session || session.expiresAt <= Date.now()) throw new Error('Sign in to a synced Neon account first.');
  const response = await fetch('/api/notifications', {
    method: operation ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${session.accessToken}`, 'Content-Type': 'application/json' },
    ...(operation ? { body: JSON.stringify(operation) } : {}),
    cache: 'no-store',
  });
  let body: unknown;
  try { body = await response.json(); } catch { throw new Error('The notification API is not available on this deployment.'); }
  if (!response.ok) throw new Error((body as { error?: string })?.error || 'The notification service could not be reached.');
  return body as T;
}

async function registration(create = false): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  let found = await navigator.serviceWorker.getRegistration('/');
  if (!found && create) found = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  if (!found) return null;
  if (create && !found.active) {
    // ready resolves only after the worker has activated, which PushManager needs.
    found = await navigator.serviceWorker.ready;
  }
  return found;
}

function keyBytes(value: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const raw = atob((value + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function sameKey(existing: ArrayBuffer | null, expected: Uint8Array): boolean {
  if (!existing) return true; // Some browsers do not expose options.
  const bytes = new Uint8Array(existing);
  return bytes.length === expected.length && bytes.every((byte, index) => byte === expected[index]);
}

export async function inspectBackgroundPush(): Promise<BackgroundPushStatus> {
  const canPush = supported();
  const session = loadCloudSession();
  if (!neonEnabled() || !session || session.expiresAt <= Date.now()) {
    return canPush ? base('sign-in', 'Sign in to a synced Neon account for reminders with the planner closed.')
      : base('unsupported', 'Web Push is unavailable here. On iPhone/iPad, install the app to the Home Screen and open it there.');
  }
  let localSubscription = false;
  try {
    const existingWorker = canPush ? await registration() : null;
    const existingSubscription = await existingWorker?.pushManager?.getSubscription();
    localSubscription = Boolean(existingSubscription);
    const info = await call<{ configured: boolean; publicKey: string | null; schedulerLastSuccess: string | null; history: AppNotification[] }>();
    const history = Array.isArray(info.history) ? info.history : [];
    cachedKey = info.configured && info.publicKey ? { value: info.publicKey, at: Date.now() } : null;
    if (!canPush) return { ...base('unsupported', 'Web Push is unavailable here. On iPhone/iPad, install the app to the Home Screen and open it there.'), history };
    if (!info.configured || !info.publicKey) return { ...base('unconfigured', 'The deployment owner must configure Web Push and a minute-by-minute scheduler.'), history };
    const subscription = existingSubscription;
    if (!subscription) return { ...base('not-enabled', 'Enable system notifications on this device to register it for background reminders.'), history, schedulerLastSuccess: info.schedulerLastSuccess };
    const status = await call<{ subscribed: boolean; schedulerLastSuccess: string | null; renewalToken?: string; publicKey?: string }>({ operation: 'status', endpoint: subscription.endpoint });
    if (!status.subscribed) return { ...base('not-enabled', 'This device’s push subscription expired or was removed. Select Enable system notifications again.'), history, schedulerLastSuccess: status.schedulerLastSuccess };
    if (status.renewalToken && status.publicKey) {
      await saveWorkerRenewal({ token: status.renewalToken, endpoint: subscription.endpoint, publicKey: status.publicKey }).catch(() => undefined);
    }
    const last = status.schedulerLastSuccess;
    const age = last ? Date.now() - Date.parse(last) : NaN;
    const healthy = Number.isFinite(age) && age >= -60_000 && age < 5 * 60_000;
    return {
      state: healthy ? 'active' : 'scheduler-offline',
      message: healthy ? 'Background Web Push is registered and the scheduler has run recently.' : 'This device is registered, but the scheduler has not run recently. Ask the deployment owner to check the scheduled job.',
      subscribed: true, schedulerLastSuccess: last, history,
    };
  } catch (error) {
    return { ...base('error', error instanceof Error ? error.message : 'Could not check background reminders.'), subscribed: localSubscription };
  }
}

/** Must be called from the user-initiated enable flow, after permission. */
export async function enableBackgroundPush(beforeRegister?: () => Promise<void>): Promise<BackgroundPushStatus> {
  if (!supported()) return base('unsupported', 'Web Push is unavailable in this browser.');
  if (Notification.permission !== 'granted') return base('not-enabled', 'Allow notifications before registering this device.');
  const session = loadCloudSession();
  if (!neonEnabled() || !session || session.expiresAt <= Date.now()) return base('sign-in', 'Sign in to a synced Neon account first.');
  try {
    const info = cachedKey && Date.now() - cachedKey.at < 60_000
      ? { configured: true, publicKey: cachedKey.value }
      : await call<{ configured: boolean; publicKey: string | null }>();
    if (!info.configured || !info.publicKey) return base('unconfigured', 'The deployment owner must configure Web Push and the scheduler secret.');
    const worker = await registration(true);
    if (!worker?.pushManager) return base('unsupported', 'This browser cannot register a Web Push subscription.');
    const key = keyBytes(info.publicKey);
    let subscription = await worker.pushManager.getSubscription();
    if (subscription) {
      const status = await call<{ subscribed: boolean }>({ operation: 'status', endpoint: subscription.endpoint });
      if (!status.subscribed || !sameKey(subscription.options?.applicationServerKey ?? null, key)) {
        await subscription.unsubscribe();
        subscription = null;
      }
    }
    subscription ??= await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    // Keep browser subscription close to the click, but do not register this
    // device server-side until existing tasks/settings have synced successfully.
    if (beforeRegister) await beforeRegister();
    const saved = await call<{ renewalToken: string }>({ operation: 'subscribe', subscription: subscription.toJSON() });
    if (saved.renewalToken) await saveWorkerRenewal({ token: saved.renewalToken, endpoint: subscription.endpoint, publicKey: info.publicKey }).catch(() => undefined);
    // The old Android periodic fallback must not duplicate server-delivered push.
    const periodic = (worker as ServiceWorkerRegistration & { periodicSync?: { unregister: (tag: string) => Promise<void> } }).periodicSync;
    if (periodic) await periodic.unregister('workday-reminders').catch(() => undefined);
    console.info('[reminders] push subscription registered');
    return await inspectBackgroundPush();
  } catch (error) {
    console.warn('[reminders] device setup failed');
    return base('error', error instanceof Error ? error.message : 'Could not register this device for Web Push.');
  }
}

export async function disableBackgroundPush(detachedSession?: CloudSession): Promise<void> {
  const worker = await registration();
  const subscription = await worker?.pushManager?.getSubscription();
  if (!subscription) {
    await saveWorkerRenewal(null).catch(() => undefined);
    return;
  }
  try { await call({ operation: 'unsubscribe', endpoint: subscription.endpoint }, detachedSession); }
  finally {
    await subscription.unsubscribe();
    await clearWorkerRenewalForEndpoint(subscription.endpoint).catch(() => undefined);
  }
}

export async function queuePushTest(): Promise<void> {
  const worker = await registration();
  const subscription = await worker?.pushManager?.getSubscription();
  if (!subscription) throw new Error('Enable system notifications on this device first.');
  await call({ operation: 'test', endpoint: subscription.endpoint });
}

export async function updateCloudHistory(change: 'read' | 'readAll' | 'clear' | 'clearAll', id?: string): Promise<void> {
  await call({ operation: 'history', change, ...(id?.startsWith('cloud:') ? { key: id.slice(6) } : {}) });
}

export async function snoozeCloudTask(taskId: string, minutes: number): Promise<void> {
  await call({ operation: 'snooze', taskId, minutes });
}
