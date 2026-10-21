import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addNotification,
  clearNotifications,
  deliverNative,
  forgetDelivered,
  loadNotifications,
  markAllNotificationsRead,
  markDelivered,
  requestPermission,
  unreadCount,
  wasDelivered,
} from './notifications';
import type { AppNotification } from './notifications';

function note(over: Partial<AppNotification> = {}): AppNotification {
  return {
    id: over.id ?? `n_${Math.random().toString(36).slice(2, 8)}`,
    taskId: 'task_1',
    title: 'Chase the invoice',
    body: 'Northwind · Due today',
    createdAt: new Date().toISOString(),
    dueAt: '2026-10-21T17:00:00.000Z',
    read: false,
    kind: 'reminder',
    ...over,
  };
}

class FakeNotification {
  static permission: NotificationPermission = 'granted';
  static requestPermission = vi.fn(async () => 'granted' as NotificationPermission);
  static instances: FakeNotification[] = [];
  title: string;
  options?: NotificationOptions;
  constructor(title: string, options?: NotificationOptions) {
    this.title = title;
    this.options = options;
    FakeNotification.instances.push(this);
  }
}

describe('notification store', () => {
  beforeEach(() => {
    window.localStorage.clear();
    FakeNotification.permission = 'granted';
    FakeNotification.instances = [];
    vi.stubGlobal('Notification', FakeNotification);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('persists the newest first and reports unread count', () => {
    let list = addNotification([], note({ id: 'a', taskId: 'task_a', dueAt: '2026-10-21T09:00:00.000Z', createdAt: '2026-10-21T08:00:00.000Z' }));
    list = addNotification(list, note({ id: 'b', taskId: 'task_b', dueAt: '2026-10-21T10:00:00.000Z', createdAt: '2026-10-21T09:00:00.000Z' }));
    expect(list.map((item) => item.id)).toEqual(['b', 'a']);
    expect(unreadCount(list)).toBe(2);
    expect(loadNotifications()).toHaveLength(2);
  });

  it('collapses an older entry for the same task and deadline', () => {
    const first = addNotification([], note({ id: 'old' }));
    const second = addNotification(first, note({ id: 'new' }));
    expect(second).toHaveLength(1);
    expect(second[0].id).toBe('new');
  });

  it('marks everything read and clears on request', () => {
    let list = addNotification([], note({ id: 'a' }));
    list = markAllNotificationsRead(list);
    expect(unreadCount(list)).toBe(0);
    expect(loadNotifications()[0].read).toBe(true);
    expect(clearNotifications()).toEqual([]);
    expect(loadNotifications()).toEqual([]);
  });

  it('remembers what was delivered and forgets it on snooze', () => {
    expect(wasDelivered('task_1|2026-10-21T17:00:00.000Z')).toBe(false);
    markDelivered('task_1|2026-10-21T17:00:00.000Z');
    expect(wasDelivered('task_1|2026-10-21T17:00:00.000Z')).toBe(true);
    forgetDelivered('task_1');
    expect(wasDelivered('task_1|2026-10-21T17:00:00.000Z')).toBe(false);
  });

  it('drops malformed entries instead of crashing', () => {
    window.localStorage.setItem('workday.notifications.v1', JSON.stringify([{ nope: true }, null]));
    expect(loadNotifications()).toEqual([]);
  });
});

describe('native delivery', () => {
  beforeEach(() => {
    window.localStorage.clear();
    FakeNotification.permission = 'granted';
    FakeNotification.instances = [];
    vi.stubGlobal('Notification', FakeNotification);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('refuses to deliver before permission is granted', async () => {
    FakeNotification.permission = 'default';
    const sent = await deliverNative({ title: 'Task', body: 'Due now', tag: 't1' });
    expect(sent).toBe(false);
    expect(FakeNotification.instances).toHaveLength(0);
  });

  it('falls back to the constructor without a service worker', async () => {
    const sent = await deliverNative({ title: 'Task', body: 'Due now', tag: 't1', taskId: 'task_1' });
    expect(sent).toBe(true);
    expect(FakeNotification.instances).toHaveLength(1);
    expect(FakeNotification.instances[0].title).toBe('Task');
  });

  it('prefers the service worker, which is the only path on Android', async () => {
    const showNotification = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { getRegistration: async () => ({ showNotification }) },
    });

    const sent = await deliverNative({ title: 'Task', body: 'Due now', tag: 't1' });
    expect(sent).toBe(true);
    expect(showNotification).toHaveBeenCalledTimes(1);
    expect(FakeNotification.instances).toHaveLength(0);

    // Clean up the stub so later tests see a worker-less navigator again.
    // @ts-expect-error — deleting a test-only property
    delete navigator.serviceWorker;
  });

  it('reports unsupported browsers honestly', async () => {
    vi.stubGlobal('Notification', undefined);
    expect(await requestPermission()).toBe('unsupported');
    expect(await deliverNative({ title: 'Task', body: 'x', tag: 't' })).toBe(false);
  });
});
