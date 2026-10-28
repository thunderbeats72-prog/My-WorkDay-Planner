import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ enabled: true, session: { userId: 'alice', accessToken: 'session', expiresAt: Date.now() + 86_400_000 } }));
vi.mock('./cloudSync', () => ({ neonEnabled: () => auth.enabled, loadCloudSession: () => auth.session }));
import { enableBackgroundPush, inspectBackgroundPush, queuePushTest } from './pushClient';
import { saveWorkerRenewal } from './workerRenewal';

const publicKey = btoa(String.fromCharCode(4, ...Array(64).fill(1))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
class FakeNotification {
  static permission: NotificationPermission = 'granted';
  static requestPermission = vi.fn(async () => 'granted');
}
let local: any;
let registered: boolean;
let configured: boolean;
let lastRun: string | null;
let failNetwork: boolean;
let queued: number;
let worker: any;
const makeSubscription = (endpoint: string) => ({
  endpoint, options: { applicationServerKey: null }, unsubscribe: vi.fn(async () => { local = null; return true; }),
  toJSON: () => ({ endpoint, keys: { p256dh: 'fake', auth: 'fake' } }),
});

beforeEach(async () => {
  auth.enabled = true; auth.session.expiresAt = Date.now() + 86_400_000;
  local = null; registered = false; configured = true; lastRun = new Date().toISOString(); failNetwork = false; queued = 0;
  FakeNotification.permission = 'granted'; FakeNotification.requestPermission.mockClear();
  worker = { active: {}, periodicSync: { unregister: vi.fn(async () => undefined) }, pushManager: {
    getSubscription: vi.fn(async () => local),
    subscribe: vi.fn(async () => { local = makeSubscription('https://fcm.googleapis.com/new'); return local; }),
  } };
  vi.stubGlobal('Notification', FakeNotification);
  vi.stubGlobal('PushManager', class {});
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: {
    getRegistration: vi.fn(async () => worker), register: vi.fn(async () => worker), ready: Promise.resolve(worker),
  } });
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    if (failNetwork) throw new Error('offline');
    const body = init.body ? JSON.parse(String(init.body)) : null;
    let result: unknown;
    if (!body) result = { configured, publicKey, schedulerLastSuccess: lastRun, history: [] };
    else if (body.operation === 'status') result = { subscribed: registered, schedulerLastSuccess: lastRun, publicKey, renewalToken: 'renewal' };
    else if (body.operation === 'subscribe') { registered = true; result = { ok: true, renewalToken: 'renewal' }; }
    else if (body.operation === 'test') { queued += 1; result = { ok: true, queued: true }; }
    else result = { ok: true };
    return { ok: true, json: async () => result };
  }));
  await saveWorkerRenewal(null);
});
afterEach(() => { vi.unstubAllGlobals(); delete (navigator as any).serviceWorker; });

describe('device notification setup', () => {
  it('registers a real browser subscription, checks the server heartbeat and queues a push test', async () => {
    const status = await enableBackgroundPush();
    expect(status.state).toBe('active');
    expect(status.subscribed).toBe(true);
    expect(worker.pushManager.subscribe).toHaveBeenCalledOnce();
    expect(worker.periodicSync.unregister).toHaveBeenCalledWith('workday-reminders');
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled();
    await queuePushTest();
    expect(queued).toBe(1);
  });

  it('creates the browser subscription before syncing, but registers it on the server only after sync succeeds', async () => {
    const beforeRegister = vi.fn(async () => {
      expect(worker.pushManager.subscribe).toHaveBeenCalledOnce();
      expect(registered).toBe(false);
    });
    expect((await enableBackgroundPush(beforeRegister)).state).toBe('active');
    expect(beforeRegister).toHaveBeenCalledOnce();
    expect(registered).toBe(true);
  });

  it('does not register the device with a stale server snapshot when sync fails', async () => {
    const status = await enableBackgroundPush(async () => { throw new Error('Sync failed'); });
    expect(status.state).toBe('error');
    expect(status.message).toBe('Sync failed');
    expect(registered).toBe(false);
  });

  it('does not report a healthy background setup merely because permission was granted', async () => {
    local = makeSubscription('https://fcm.googleapis.com/old'); registered = true; lastRun = null;
    expect((await inspectBackgroundPush()).state).toBe('scheduler-offline');
    configured = false;
    expect((await inspectBackgroundPush()).state).toBe('unconfigured');
  });

  it('repairs an expired server subscription only through the enable flow', async () => {
    const expired = makeSubscription('https://fcm.googleapis.com/expired'); local = expired;
    expect((await inspectBackgroundPush()).state).toBe('not-enabled');
    const status = await enableBackgroundPush();
    expect(expired.unsubscribe).toHaveBeenCalledOnce();
    expect(status.state).toBe('active');
  });

  it('never prompts on denied permission and does not claim push is enabled', async () => {
    FakeNotification.permission = 'denied';
    expect((await enableBackgroundPush()).state).toBe('not-enabled');
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled();
    expect(worker.pushManager.subscribe).not.toHaveBeenCalled();
  });

  it('retains knowledge of a local subscription on network errors to avoid duplicate fallbacks', async () => {
    local = makeSubscription('https://fcm.googleapis.com/existing'); failNetwork = true;
    const status = await inspectBackgroundPush();
    expect(status.state).toBe('error');
    expect(status.subscribed).toBe(true);
  });

  it('explains unsupported browsers, but still fetches a synced inbox', async () => {
    vi.stubGlobal('PushManager', undefined);
    // `in` is the browser feature check: remove the property, not merely its value.
    delete (window as any).PushManager;
    const status = await inspectBackgroundPush();
    expect(status.state).toBe('unsupported');
    expect(status.history).toEqual([]);
  });
});
