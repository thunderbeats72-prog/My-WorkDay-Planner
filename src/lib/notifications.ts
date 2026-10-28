/**
 * Notification inbox helpers and the local native-notification fallback.
 * Synced background Web Push and delivery state are handled by pushClient.ts,
 * /api/notifications and the service worker; provider acceptance is not proof
 * that the operating system displayed a banner.
 */

export type AppNotificationKind = 'reminder' | 'test' | 'system' | 'upcoming' | 'due' | 'overdue' | 'completed' | 'summary';

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
  /** A push service accepting a message is not proof the device displayed it. */
  delivery?: 'accepted' | 'pending' | 'failed';
  /** Owner of a cached cloud event; never display it for another session. */
  accountId?: string;
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

export function notificationsForAccount(list: AppNotification[], accountId: string | null): AppNotification[] {
  return list.filter((item) => !item.id.startsWith('cloud:') || (Boolean(accountId) && item.accountId === accountId));
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

export function unmarkDelivered(key: string): void {
  const map = loadDelivered();
  delete map[key];
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
  silent?: boolean;
  /** A summary should open the overdue filter, not an unrelated page. */
  overdue?: boolean;
}

/**
 * Shows an OS notification. Returns true when the OS accepted it — the caller
 * keeps the in-app copy either way.
 */
export async function deliverNative(payload: NativeNotificationPayload): Promise<boolean> {
  if (readPermission() !== 'granted') return false;
  const query = new URLSearchParams();
  if (payload.taskId) query.set('openTask', payload.taskId);
  if (payload.overdue) query.set('filter', 'overdue');
  const url = `/${query.toString() ? `?${query.toString()}` : ''}#/${payload.page ?? 'tasks'}`;
  const options: NotificationOptions & { renotify?: boolean; vibrate?: number[] } = {
    body: payload.body,
    tag: payload.tag,
    icon: '/icon-192.png?v=5',
    badge: '/favicon-32.png?v=5',
    data: { url, taskId: payload.taskId ?? null },
    renotify: false,
    silent: Boolean(payload.silent),
    // The OS decides whether sound/vibration is supported.
    ...(payload.silent ? {} : { vibrate: [90, 40, 90] }),
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
    const notification = new Notification(payload.title, options);
    notification.onclick = () => {
      window.focus();
      window.location.assign(url);
      notification.close();
    };
    return true;
  } catch {
    return false;
  }
}

/** A local banner test; it does not prove server-scheduled Web Push. */
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
