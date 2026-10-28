import { createECDH, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import webPush from 'web-push';
import { DEFAULT_SETTINGS, type Task } from './types';
import type { BackupFile } from './backupTypes';

// The actual SQL, handlers, processor, encryption and worker execute below.
// Only Neon transport is replaced by embedded PostgreSQL, and the external
// push-service HTTP request by a cryptographic capture (no vendor credentials).
const harness = vi.hoisted(() => ({
  db: null as { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> } | null,
  pushes: [] as Array<{ payload: Record<string, unknown>; ciphertext: Buffer; endpoint: string }>,
  nextStatus: 0,
}));
vi.mock('@neondatabase/serverless', () => ({
  neon: () => (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.reduce((query, part, index) => query + part + (index < values.length ? `$${index + 1}` : ''), '');
    return harness.db!.query(text, values).then((result) => result.rows);
  },
}));
vi.mock('web-push', async (importOriginal) => {
  const real = await importOriginal<typeof import('web-push')>();
  const original = (real as unknown as { default: typeof import('web-push') }).default ?? real;
  return { default: {
    ...original,
    sendNotification: async (sub: Parameters<typeof original.sendNotification>[0], payload: string, opts: Parameters<typeof original.sendNotification>[2]) => {
      if (harness.nextStatus) {
        const statusCode = harness.nextStatus; harness.nextStatus = 0;
        throw Object.assign(new Error('simulated push service failure'), { statusCode });
      }
      const request = original.generateRequestDetails(sub, payload, opts);
      harness.pushes.push({ payload: JSON.parse(payload), ciphertext: request.body, endpoint: sub.endpoint });
      return { statusCode: 201, headers: {}, body: '' };
    },
  } };
});

import { ensureSchema } from '../../api/_lib/schema';
import { sql, readSnapshot, writeSnapshot, createSession } from '../../api/_lib/store';
import { hashToken } from '../../api/_lib/crypto';
import snapshotHandler from '../../api/snapshot';
import { saveWorkerRenewal } from './workerRenewal';
import { applyNotificationAction, changeHistory, eligibleEvent, notificationHistory, pruneNotificationHistory, saveSubscription, subscriptionExists } from '../../api/_lib/reminderStore';
import { runReminderCycle } from '../../api/_lib/reminderProcessor';
import { makeActionToken, makeRenewalToken, pushConfig, readActionToken, validSubscription } from '../../api/_lib/push';
import notificationsHandler from '../../api/notifications';
import cronHandler from '../../api/cron/reminders';

const epoch = new Date('2026-10-28T10:00:00.000Z');
function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'existing-id', title: 'Send client proposal', notes: 'Existing notes', client: 'Acme', category: 'proposal', priority: 'high',
    estimatedMinutes: 30, actualMinutes: 4, dueDate: '2026-10-28', dueTime: '10:02', scheduledFor: null,
    suggestedDate: null, suggestedStart: null, status: 'todo', blocked: false, dependencyIds: [], deferrals: 0,
    createdAt: '2026-10-27T10:00:00.000Z', updatedAt: '2026-10-27T10:00:00.000Z', completedAt: null,
    deletedAt: null, source: 'manual', graphRef: null, ...overrides,
  };
}
function backup(tasks: Task[]): BackupFile {
  return {
    app: 'my-workday-planner', version: 1, exportedAt: '2026-10-28T09:00:00.000Z', tasks,
    settings: { ...DEFAULT_SETTINGS, notificationsEnabled: true, quietHoursEnabled: false, dailyDigestEnabled: false, reminderTimeZone: 'UTC' },
    timeSessions: [], reminderRecords: [], taskEvents: [], reports: [],
  };
}
function subscription(path: string) {
  const ecdh = createECDH('prime256v1'); ecdh.generateKeys();
  return { endpoint: `https://fcm.googleapis.com/fcm/send/${path}`,
    keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } };
}
async function createUser(id: string) {
  await sql()`insert into app_users (id,salt,hash) values (${id},'salt','hash')`;
}

interface WorkerNotification { title: string; options: { data: Record<string, unknown>; actions?: Array<{ action: string }> } }
function worker(pushManager?: unknown) {
  const listeners: Record<string, (event: any) => void> = {};
  const shown: WorkerNotification[] = [];
  const windows: string[] = [];
  const self = {
    addEventListener: (name: string, fn: (event: any) => void) => { listeners[name] = fn; },
    location: { origin: 'https://planner.test' },
    registration: { showNotification: async (title: string, options: WorkerNotification['options']) => { shown.push({ title, options }); }, pushManager },
    clients: { claim: async () => undefined, matchAll: async () => [], openWindow: async (url: string) => { windows.push(url); } },
  };
  const apiFetch = async (_url: string, init: RequestInit) => {
    let status = 200; let body: unknown;
    const response = { status(code: number) { status = code; return this; }, json(value: unknown) { body = value; }, setHeader() {} };
    await notificationsHandler({ method: init.method, headers: {}, body: JSON.parse(String(init.body)) }, response);
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  const source = readFileSync(resolve('public/sw.js'), 'utf8');
  new Function('self', 'caches', 'clients', 'Notification', 'indexedDB', 'fetch', `${source}\nreturn self.__workdayInternals;`)(
    self, undefined, self.clients, undefined, globalThis.indexedDB, apiFetch,
  );
  const dispatch = async (name: string, event: Record<string, unknown>) => {
    let work: Promise<unknown> | undefined;
    listeners[name]({ ...event, waitUntil(promise: Promise<unknown>) { work = promise; } });
    await work;
  };
  return { shown, windows, dispatch };
}

async function apiRequest(handler: typeof notificationsHandler, method: string, body: unknown, token = '') {
  let status = 200; let payload: any;
  const response = { status(code: number) { status = code; return this; }, json(value: unknown) { payload = value; }, setHeader() {} };
  await handler({ method, headers: token ? { authorization: `Bearer ${token}` } : {}, body }, response);
  return { status, body: payload };
}

beforeAll(async () => {
  const db = new PGlite();
  await db.waitReady;
  harness.db = db;
  const keys = webPush.generateVAPIDKeys();
  process.env.DATABASE_URL = 'postgres://user:pass@localhost/planner';
  process.env.VAPID_PUBLIC_KEY = keys.publicKey;
  process.env.VAPID_PRIVATE_KEY = keys.privateKey;
  process.env.VAPID_SUBJECT = 'mailto:owner@example.com';
  process.env.CRON_SECRET = 'a-secure-test-secret-at-least-32-characters';
  await ensureSchema();
});
afterAll(async () => {
  vi.useRealTimers();
  await (harness.db as unknown as PGlite).close();
  delete process.env.DATABASE_URL;
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  delete process.env.VAPID_SUBJECT;
  delete process.env.CRON_SECRET;
});

describe('real reminder pipeline against PostgreSQL', () => {
  it('schedules a two-minute task, delivers through the worker with no open tab, completes, reopens, reschedules and deletes safely', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(epoch);
    await createUser('alice');
    const sub = subscription('alice-device');
    expect(validSubscription(sub)).toBe(true);
    expect(await saveSubscription('alice', sub)).toBe(true);
    const original = backup([task()]);
    await writeSnapshot('alice', original);

    harness.pushes.length = 0;
    const [first, overlapping] = await Promise.all([runReminderCycle(), runReminderCycle()]);
    expect([first.locked, overlapping.locked].filter(Boolean)).toHaveLength(1);
    expect(harness.pushes).toHaveLength(1);
    expect(harness.pushes[0].payload.category).toBe('upcoming');
    expect(harness.pushes[0].ciphertext.length).toBeGreaterThan(30); // actual Web Push encryption
    expect(harness.pushes[0].ciphertext.toString()).not.toContain('client proposal');
    await runReminderCycle();
    expect(harness.pushes).toHaveLength(1); // duplicate scheduler call

    const sw = worker();
    await sw.dispatch('push', { data: { json: () => harness.pushes[0].payload } });
    expect(sw.shown[0].title).toBe('Upcoming task');
    expect(sw.shown[0].options.actions?.map((item) => item.action)).toContain('complete');
    await sw.dispatch('notificationclick', { action: 'overdue', notification: { data: { category: 'summary' }, close() {} } });
    expect(sw.windows.at(-1)).toBe('/?filter=overdue#/tasks');

    vi.setSystemTime(new Date('2026-10-28T10:02:00.000Z'));
    await runReminderCycle();
    expect(harness.pushes.at(-1)?.payload.category).toBe('due');
    vi.setSystemTime(new Date('2026-10-28T10:03:00.000Z'));
    await runReminderCycle();
    expect(harness.pushes.at(-1)?.payload.category).toBe('overdue');
    vi.setSystemTime(new Date('2026-10-28T10:32:00.000Z'));
    await runReminderCycle();
    expect(harness.pushes.at(-1)?.payload.category).toBe('overdue');
    const previousCount = harness.pushes.length;
    await runReminderCycle();
    expect(harness.pushes).toHaveLength(previousCount);

    // A stale queued push is checked again before the OS sees it.
    const oldPayload = harness.pushes[0].payload;
    await sw.dispatch('push', { data: { json: () => oldPayload } });
    expect(sw.shown).toHaveLength(1);
    await sw.dispatch('push', { data: { json: () => harness.pushes.at(-1)!.payload } });
    expect(sw.shown).toHaveLength(2);
    await sw.dispatch('notificationclick', { action: 'complete', notification: { data: sw.shown[1].options.data, close() {} } });
    const afterAction = await readSnapshot('alice') as BackupFile;
    expect(afterAction.tasks[0]).toMatchObject({ id: 'existing-id', status: 'completed', notes: 'Existing notes', client: 'Acme', priority: 'high' });
    await writeSnapshot('alice', original); // a stale in-flight sync must not undo the action
    expect((await readSnapshot('alice') as BackupFile).tasks[0].status).toBe('completed');
    await runReminderCycle();
    expect(harness.pushes.at(-1)?.payload.category).toBe('completed');

    vi.setSystemTime(new Date('2026-10-28T10:35:00.000Z'));
    const reopened = { ...afterAction.tasks[0], status: 'todo' as const, completedAt: null,
      reminderCycle: '2026-10-28T10:35:00.000Z', updatedAt: '2026-10-28T10:35:00.000Z' };
    await writeSnapshot('alice', backup([reopened]));
    await runReminderCycle();
    expect(harness.pushes.at(-1)?.payload.category).toBe('overdue');
    const reopenedToken = harness.pushes.at(-1)!.payload.token as string;
    const claims = readActionToken(reopenedToken, pushConfig()!)!;
    const moved = { ...reopened, dueDate: '2026-10-29', reminderCycle: '2026-10-28T10:36:00.000Z', updatedAt: '2026-10-28T10:36:00.000Z' };
    await writeSnapshot('alice', backup([moved]));
    expect(await eligibleEvent('alice', claims.e)).toBeNull();
    expect(await applyNotificationAction('alice', claims.e, 'complete')).toBe('stale');
    const beforeMoveRun = harness.pushes.length;
    await runReminderCycle();
    expect(harness.pushes).toHaveLength(beforeMoveRun);
    const deleted = { ...moved, deletedAt: '2026-10-28T10:37:00.000Z', updatedAt: '2026-10-28T10:37:00.000Z' };
    await writeSnapshot('alice', backup([deleted]));
    vi.setSystemTime(new Date('2026-10-29T10:03:00.000Z'));
    await runReminderCycle();
    expect(harness.pushes).toHaveLength(beforeMoveRun);
    expect((await readSnapshot('alice') as BackupFile).tasks[0]).toMatchObject({ deletedAt: deleted.deletedAt, notes: 'Existing notes' });

    const history = await notificationHistory('alice');
    expect(history.length).toBeGreaterThan(0);
    await changeHistory('alice', 'readAll');
    expect((await notificationHistory('alice')).every((entry) => entry.read)).toBe(true);
    await changeHistory('alice', 'clearAll');
    expect(await notificationHistory('alice')).toEqual([]);
    vi.useRealTimers();
  }, 30000);

  it('retries transient failures and removes expired subscriptions', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(epoch);
    await createUser('bob');
    const sub = subscription('bob-device');
    await saveSubscription('bob', sub);
    await writeSnapshot('bob', backup([task({ id: 'bob-task' })]));
    harness.pushes.length = 0;
    harness.nextStatus = 503;
    const failed = await runReminderCycle();
    expect(failed.retry).toBe(1);
    expect(harness.pushes).toHaveLength(0);
    await sql()`update planner_notification_deliveries set next_attempt_at=now()-interval '1 second' where user_id='bob'`;
    await runReminderCycle();
    expect(harness.pushes).toHaveLength(1);
    vi.setSystemTime(new Date('2026-10-28T10:02:00.000Z'));
    harness.nextStatus = 410;
    await runReminderCycle();
    expect(await subscriptionExists('bob', sub.endpoint)).toBe(false);
    vi.useRealTimers();
  }, 30000);

  it('renews an expired browser subscription from the worker without an open page and tests the real authenticated routes', async () => {
    await createUser('carol');
    const session = 'carol-session-token';
    await createSession('carol', await hashToken(session), new Date(Date.now() + 86_400_000));
    const old = subscription('carol-old');
    const denied = await apiRequest(notificationsHandler, 'POST', { operation: 'subscribe', subscription: old });
    expect(denied.status).toBe(401);
    const enrolled = await apiRequest(notificationsHandler, 'POST', { operation: 'subscribe', subscription: old }, session);
    expect(enrolled.status).toBe(200);
    expect(enrolled.body.renewalToken).toBeTruthy();
    const config = pushConfig()!;
    await saveWorkerRenewal({ token: enrolled.body.renewalToken, endpoint: old.endpoint, publicKey: config.publicKey });
    const replacement = subscription('carol-new');
    const next = { endpoint: replacement.endpoint, toJSON: () => replacement };
    const sw = worker({ getSubscription: async () => null, subscribe: async () => next });
    await sw.dispatch('pushsubscriptionchange', { newSubscription: next });
    expect(await subscriptionExists('carol', old.endpoint)).toBe(false);
    expect(await subscriptionExists('carol', replacement.endpoint)).toBe(true);
    const replay = await apiRequest(notificationsHandler, 'POST', { operation: 'renew', token: enrolled.body.renewalToken, previousEndpoint: old.endpoint, subscription: replacement });
    expect(replay.status).toBe(409);
    const wrong = await apiRequest(notificationsHandler, 'POST', { operation: 'renew', token: makeRenewalToken('carol', old.endpoint, config), previousEndpoint: replacement.endpoint, subscription: old });
    expect(wrong.status).toBe(401);

    const saved = await apiRequest(snapshotHandler, 'POST', { payload: backup([]) }, session);
    expect(saved.status).toBe(200);
    const test = await apiRequest(notificationsHandler, 'POST', { operation: 'test', endpoint: replacement.endpoint }, session);
    expect(test.body.queued).toBe(true);
    harness.pushes.length = 0;
    await runReminderCycle();
    const pushed = harness.pushes.find((entry) => entry.endpoint === replacement.endpoint);
    expect(pushed?.payload.category).toBe('test');
    await sw.dispatch('push', { data: { json: () => pushed!.payload } });
    expect(sw.shown.at(-1)?.title).toBe('Workday Planner test');
    const list = await apiRequest(notificationsHandler, 'GET', undefined, session);
    expect(list.body.history.some((entry: { kind: string }) => entry.kind === 'test')).toBe(true);
    await saveWorkerRenewal(null);
  }, 30000);

  it('persists snoozes, does not extend them on replay, and resumes the overdue cadence', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-28T10:01:00.000Z'));
    await createUser('dave');
    const sub = subscription('dave-device');
    await saveSubscription('dave', sub);
    await writeSnapshot('dave', backup([task({ id: 'dave-task', dueTime: '10:00' })]));
    harness.pushes.length = 0;
    await runReminderCycle();
    const payload = harness.pushes.find((item) => item.endpoint === sub.endpoint)!.payload;
    const claims = readActionToken(payload.token, pushConfig()!)!;
    expect(await applyNotificationAction('dave', claims.e, 'snooze30')).toBe('ok');
    const snoozes = await sql()`select snoozed_until::text as at from planner_notification_snoozes where user_id='dave'` as Array<{ at: string }>;
    vi.setSystemTime(new Date('2026-10-28T10:10:00.000Z'));
    expect(await applyNotificationAction('dave', claims.e, 'snooze30')).toBe('ok');
    const again = await sql()`select snoozed_until::text as at from planner_notification_snoozes where user_id='dave'` as Array<{ at: string }>;
    expect(again[0].at).toBe(snoozes[0].at);
    expect(await eligibleEvent('dave', claims.e)).toBeNull();
    const count = harness.pushes.length;
    await runReminderCycle();
    expect(harness.pushes).toHaveLength(count);
    vi.setSystemTime(new Date('2026-10-28T10:31:00.000Z'));
    await runReminderCycle();
    expect(harness.pushes.at(-1)?.payload.category).toBe('overdue');
    vi.useRealTimers();
  }, 30000);

  it('delivers the current slot once to a device subscribed after the first device', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(epoch);
    await createUser('frank');
    const first = subscription('frank-phone');
    const second = subscription('frank-laptop');
    await saveSubscription('frank', first);
    await writeSnapshot('frank', backup([task({ id: 'frank-task' })]));
    harness.pushes.length = 0;
    await runReminderCycle();
    expect(harness.pushes.filter((push) => push.endpoint === first.endpoint)).toHaveLength(1);
    await saveSubscription('frank', second);
    await runReminderCycle();
    expect(harness.pushes.filter((push) => push.endpoint === first.endpoint)).toHaveLength(1);
    expect(harness.pushes.filter((push) => push.endpoint === second.endpoint)).toHaveLength(1);
    await runReminderCycle();
    expect(harness.pushes.filter((push) => push.endpoint === second.endpoint)).toHaveLength(1);
    vi.useRealTimers();
  }, 30000);

  it('retries a permanently failed delivery after the same device is explicitly re-enabled', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(epoch);
    await createUser('heidi');
    const device = subscription('heidi-device');
    await saveSubscription('heidi', device);
    await writeSnapshot('heidi', backup([task({ id: 'heidi-task' })]));
    harness.pushes.length = 0;
    harness.nextStatus = 403;
    await runReminderCycle();
    expect(harness.pushes.filter((push) => push.endpoint === device.endpoint)).toHaveLength(0);
    expect((await notificationHistory('heidi'))[0].delivery).toBe('failed');
    await saveSubscription('heidi', device);
    await runReminderCycle();
    expect(harness.pushes.filter((push) => push.endpoint === device.endpoint)).toHaveLength(1);
    vi.useRealTimers();
  }, 30000);

  it('prunes old content without replaying a no-repeat overdue notification', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(epoch);
    await createUser('grace');
    const device = subscription('grace-device');
    await saveSubscription('grace', device);
    const source = backup([task({ id: 'grace-task', dueDate: '2026-10-27', dueTime: '10:00' })]);
    source.settings.reminderRepeatMinutes = 0;
    await writeSnapshot('grace', source);
    harness.pushes.length = 0;
    await runReminderCycle();
    expect(harness.pushes.filter((push) => push.endpoint === device.endpoint)).toHaveLength(1);
    await sql()`update planner_notification_events set created_at=now()-interval '31 days' where user_id='grace'`;
    await pruneNotificationHistory();
    expect(await notificationHistory('grace')).toHaveLength(0);
    const ledger = await sql()`select event_hash from planner_notification_ledger where user_id='grace'` as Array<{ event_hash: string }>;
    expect(ledger).toHaveLength(1);
    expect(ledger[0].event_hash).toMatch(/^[0-9a-f]{64}$/);
    await runReminderCycle();
    expect(harness.pushes.filter((push) => push.endpoint === device.endpoint)).toHaveLength(1);
    vi.useRealTimers();
  }, 30000);

  it('authenticates keepalive task updates and merges them without overwriting unrelated snapshot data', async () => {
    await createUser('edith');
    const session = 'edith-session';
    await createSession('edith', await hashToken(session), new Date(Date.now() + 86_400_000));
    const existing = task({ id: 'edith-task' });
    const other = task({ id: 'other-task', title: 'Keep me' });
    const original = { ...backup([existing, other]), customFutureField: { preserved: true } };
    await writeSnapshot('edith', original);
    const completed = { ...existing, status: 'completed' as const, completedAt: '2026-10-28T11:00:00.000Z', updatedAt: '2026-10-28T11:00:00.000Z' };
    expect((await apiRequest(snapshotHandler, 'POST', { changedTasks: [completed] })).status).toBe(401);
    expect((await apiRequest(snapshotHandler, 'POST', { changedTasks: [{ id: 'bad' }] }, session)).status).toBe(400);
    expect((await apiRequest(snapshotHandler, 'POST', { changedTasks: [completed] }, session)).status).toBe(200);
    const changed = await readSnapshot('edith') as typeof original;
    expect(changed.tasks).toHaveLength(2);
    expect(changed.tasks.find((item) => item.id === 'edith-task')).toMatchObject({ status: 'completed', notes: 'Existing notes', client: 'Acme' });
    expect(changed.tasks.find((item) => item.id === 'other-task')?.title).toBe('Keep me');
    expect(changed.customFutureField).toEqual({ preserved: true });
    await apiRequest(snapshotHandler, 'POST', { changedTasks: [existing] }, session); // stale retry
    expect((await readSnapshot('edith') as BackupFile).tasks[0].status).toBe('completed');
  });

  it('rejects unsafe endpoints, tampered capabilities and unauthorized cron calls', async () => {
    const sub = subscription('safe');
    expect(await saveSubscription('alice', sub)).toBe(true);
    expect(await saveSubscription('bob', sub)).toBe(false); // endpoints cannot be taken over by another account
    expect(await subscriptionExists('alice', sub.endpoint)).toBe(true);
    const originalPrivateKey = process.env.VAPID_PRIVATE_KEY;
    process.env.VAPID_PRIVATE_KEY = webPush.generateVAPIDKeys().privateKey;
    expect(pushConfig()).toBeNull(); // reject mismatched, but well-formed, keys
    process.env.VAPID_PRIVATE_KEY = originalPrivateKey;
    expect(validSubscription({ ...sub, endpoint: 'https://localhost/private' })).toBe(false);
    expect(validSubscription({ ...sub, endpoint: 'https://fcm.googleapis.com.evil.example/path' })).toBe(false);
    const config = pushConfig()!;
    const token = makeActionToken('alice', 'event', config);
    expect(readActionToken(token, config)?.u).toBe('alice');
    expect(readActionToken(`${token}x`, config)).toBeNull();
    let status = 0;
    const res = { status(code: number) { status = code; return this; }, json() {}, setHeader() {} };
    await cronHandler({ method: 'GET', headers: { authorization: 'Bearer wrong' } }, res);
    expect(status).toBe(401);
  });
});
