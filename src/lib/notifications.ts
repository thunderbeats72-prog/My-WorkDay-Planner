/**
 * Notifications, in two layers.
 *
 * 1. In-app: a durable list (localStorage) that the bell in the utility bar
 *    reads. It is the source of truth — nothing is lost if the OS refuses to
 *    show a banner.
 * 2. Native: the OS notification, sent through the service worker when one is
 *    available (this is the only way that works on Android) and through the
 *    `Notification` constructor otherwise.
 *
 * Everything is local. There is no push server and no account: alerts are
 * computed on this device from the tasks already in IndexedDB.
 */

export type AppNotificationKind = 'reminder' | 'test' | 'system';

export interface AppNotification {
  id: string;
  taskId: string | null;
  title: string;
  body: string;
  createdAt: string;
  /** ISO deadline this notification is about, when it is about one. */
  dueAt: string | null;
  read: boolean;
  kind: AppNotificationKind;
}

export type NativePermission = 'granted' | 'denied' | 'default' | 'unsupported';

const LIST_KEY = 'workday.notifications.v1';
const DELIVERED_KEY = 'workday.notifications.delivered.v1';
const MAX_ITEMS = 60;
const DELIVERED_TTL_MS = 14 * 24 * 60 * 60 * 1000;

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or a full quota must never break a reminder.
  }
}

export function newNotificationId(): string {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') return `n_${cryptoObj.randomUUID()}`;
  return `n_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function loadNotifications(): AppNotification[] {
  const list = readJSON<AppNotification[]>(LIST_KEY, []);
  if (!Array.isArray(list)) return [];
  return list.filter((item) => item && typeof item.id === 'string' && typeof item.title === 'string');
}

export function saveNotifications(list: AppNotification[]): AppNotification[] {
  const trimmed = [...list]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, MAX_ITEMS);
  writeJSON(LIST_KEY, trimmed);
  return trimmed;
}

/** Adds one notification, collapsing an older unread duplicate for the same task. */
export function addNotification(list: AppNotification[], item: AppNotification): AppNotification[] {
  const withoutStale = list.filter(
    (existing) => !(existing.taskId && existing.taskId === item.taskId && existing.dueAt === item.dueAt),
  );
  return saveNotifications([item, ...withoutStale]);
}

export function markNotificationRead(list: AppNotification[], id: string): AppNotification[] {
  return saveNotifications(list.map((item) => (item.id === id ? { ...item, read: true } : item)));
}

export function markAllNotificationsRead(list: AppNotification[]): AppNotification[] {
  return saveNotifications(list.map((item) => (item.read ? item : { ...item, read: true })));
}

export function clearNotifications(): AppNotification[] {
  return saveNotifications([]);
}

export function unreadCount(list: AppNotification[]): number {
  return list.reduce((total, item) => total + (item.read ? 0 : 1), 0);
}

/* ------------------------------------------------------------------ */
/* Delivery de-duplication                                             */
/* ------------------------------------------------------------------ */

type DeliveredMap = Record<string, number>;

function loadDelivered(): DeliveredMap {
  const map = readJSON<DeliveredMap>(DELIVERED_KEY, {});
  if (!map || typeof map !== 'object') return {};
  const cutoff = Date.now() - DELIVERED_TTL_MS;
  const pruned: DeliveredMap = {};
  for (const [key, at] of Object.entries(map)) {
    if (typeof at === 'number' && at > cutoff) pruned[key] = at;
  }
  return pruned;
}

export function wasDelivered(key: string): boolean {
  return Boolean(loadDelivered()[key]);
}

export function markDelivered(key: string): void {
  const map = loadDelivered();
  map[key] = Date.now();
  writeJSON(DELIVERED_KEY, map);
}

export function resetDelivered(): void {
  writeJSON(DELIVERED_KEY, {});
}

/** Snoozing means "tell me again" — forget what was delivered for this task. */
export function forgetDelivered(taskId: string): void {
  const map = loadDelivered();
  let changed = false;
  for (const key of Object.keys(map)) {
    if (key.startsWith(`${taskId}|`)) {
      delete map[key];
      changed = true;
    }
  }
  if (changed) writeJSON(DELIVERED_KEY, map);
}

/* ------------------------------------------------------------------ */
/* Native delivery                                                     */
/* ------------------------------------------------------------------ */

export function readPermission(): NativePermission {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

export async function requestPermission(): Promise<NativePermission> {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') return 'unsupported';
  try {
    const next = await Notification.requestPermission();
    return next;
  } catch {
    return readPermission();
  }
}

/** Chrome on Android only accepts notifications shown by a service worker. */
async function activeRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    return (await navigator.serviceWorker.getRegistration()) ?? null;
  } catch {
    return null;
  }
}

export interface NativeNotificationPayload {
  title: string;
  body: string;
  tag: string;
  taskId?: string | null;
  /** Hash the app should open when the notification is clicked. */
  page?: string;
}

/**
 * Shows an OS notification. Returns true when the OS accepted it — the caller
 * keeps the in-app copy either way.
 */
export async function deliverNative(payload: NativeNotificationPayload): Promise<boolean> {
  if (readPermission() !== 'granted') return false;
  const url = `/#${payload.page ?? 'tasks'}`;
  const options: NotificationOptions & { renotify?: boolean; vibrate?: number[] } = {
    body: payload.body,
    tag: payload.tag,
    icon: '/icon-192.png?v=5',
    badge: '/favicon-32.png?v=5',
    data: { url, taskId: payload.taskId ?? null },
    renotify: false,
    // A short, single pulse on Android; silently ignored elsewhere.
    vibrate: [90, 40, 90],
  };

  const registration = await activeRegistration();
  if (registration) {
    try {
      // showNotification is the only path that works in a mobile PWA.
      await registration.showNotification(payload.title, options);
      return true;
    } catch {
      // Fall through to the constructor below.
    }
  }

  try {
    new Notification(payload.title, options);
    return true;
  } catch {
    return false;
  }
}

/** A one-tap proof that the whole chain works on this device. */
export async function sendTestNotification(): Promise<boolean> {
  return deliverNative({
    title: 'Workday Planner',
    body: 'Notifications are on. This is what a deadline alert will look like.',
    tag: 'workday-test',
    page: 'today',
  });
}

/**
 * Asks the installed PWA to check reminders in the background (Android
 * Chrome only, installed app, after some engagement). Best-effort: the page
 * pipeline still runs whenever the app is open.
 */
export async function registerBackgroundChecks(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false;
  const registration = await activeRegistration();
  if (!registration) return false;
  const periodic = (registration as ServiceWorkerRegistration & {
    periodicSync?: { register: (tag: string, opts: { minInterval: number }) => Promise<void> };
  }).periodicSync;
  if (!periodic) return false;
  try {
    await periodic.register('workday-reminders', { minInterval: 15 * 60 * 1000 });
    return true;
  } catch {
    return false;
  }
}
