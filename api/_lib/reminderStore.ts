import { randomUUID } from 'node:crypto';
import { deadlineKey, reminderCandidates, type ReminderCandidate, type ReminderCategory, type ReminderSnapshot, type ServerSnooze } from '../../src/lib/reminderSchedule.js';
import type { Task } from '../../src/lib/types.js';
import { sql } from './store.js';
import type { PushSubscriptionInput } from './push.js';

async function rows<T>(query: PromiseLike<unknown>): Promise<T[]> {
  return await query as T[];
}
function iso(value: string | Date | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export async function saveSubscription(userId: string, sub: PushSubscriptionInput): Promise<boolean> {
  // Browser-provided expiration times can pass without a 410 response because
  // expired endpoints are not scheduled. Remove them before enforcing the cap.
  await sql()`
    with removed as (
      delete from planner_push_subscriptions where user_id=${userId} and expiration_time <= now() returning endpoint
    )
    update planner_notification_deliveries set state='failed', lease_until=null
      where user_id=${userId} and state in ('pending','sending') and endpoint in (select endpoint from removed)
  `;
  const found = await rows<{ endpoint: string }>(sql()`
    insert into planner_push_subscriptions (user_id, endpoint, p256dh, auth, expiration_time)
    select ${userId}, ${sub.endpoint}, ${sub.keys.p256dh}, ${sub.keys.auth},
           ${sub.expirationTime ? new Date(sub.expirationTime).toISOString() : null}::timestamptz
    where (select count(*) from planner_push_subscriptions where user_id = ${userId}) < 10
       or exists (select 1 from planner_push_subscriptions where endpoint = ${sub.endpoint} and user_id = ${userId})
    on conflict (endpoint) do update set
      p256dh = excluded.p256dh, auth = excluded.auth,
      expiration_time = excluded.expiration_time, updated_at = now()
    where planner_push_subscriptions.user_id = excluded.user_id
    returning endpoint
  `);
  if (found.length) {
    // An explicit re-enable can recover deliveries that failed permanently
    // before the owner repaired credentials or device settings.
    await sql()`update planner_notification_deliveries set state='pending', attempts=0, next_attempt_at=now(), lease_until=null
      where user_id=${userId} and endpoint=${sub.endpoint} and state='failed'`;
  }
  return found.length > 0;
}

/** Atomic replacement makes a renewal capability single-use when the endpoint changes. */
export async function replaceSubscription(userId: string, previous: string, sub: PushSubscriptionInput): Promise<boolean> {
  const changed = await rows<{ endpoint: string }>(sql()`
    update planner_push_subscriptions set endpoint=${sub.endpoint}, p256dh=${sub.keys.p256dh}, auth=${sub.keys.auth},
      expiration_time=${sub.expirationTime ? new Date(sub.expirationTime).toISOString() : null}::timestamptz, updated_at=now()
    where user_id=${userId} and endpoint=${previous} returning endpoint
  `);
  if (changed.length && previous !== sub.endpoint) {
    await sql()`update planner_notification_deliveries set state='failed', lease_until=null
      where user_id=${userId} and endpoint=${previous} and state in ('pending','sending')`;
  }
  return changed.length > 0;
}

export async function removeSubscription(userId: string, endpoint: string): Promise<void> {
  await sql()`delete from planner_push_subscriptions where user_id = ${userId} and endpoint = ${endpoint}`;
  await sql()`update planner_notification_deliveries set state = 'failed', lease_until = null
    where user_id = ${userId} and endpoint = ${endpoint} and state in ('pending', 'sending')`;
}

export async function subscriptionExists(userId: string, endpoint: string, includeExpired = false): Promise<boolean> {
  const found = await rows<{ exists: boolean }>(sql()`select exists (
    select 1 from planner_push_subscriptions where user_id = ${userId} and endpoint = ${endpoint}
      and (${includeExpired} or expiration_time is null or expiration_time > now())
  ) as exists`);
  return Boolean(found[0]?.exists);
}

export async function workerStatus(): Promise<{ lastStarted: string | null; lastSuccess: string | null }> {
  const found = await rows<{ last_started_at: string | Date | null; last_success_at: string | Date | null }>(sql()`
    select last_started_at, last_success_at from planner_reminder_worker where id = 'primary'
  `);
  return { lastStarted: iso(found[0]?.last_started_at ?? null), lastSuccess: iso(found[0]?.last_success_at ?? null) };
}

interface StoredEvent {
  user_id: string;
  event_key: string;
  task_id: string | null;
  category: ReminderCategory;
  title: string;
  body: string;
  due_at: string | Date | null;
  deadline_key: string | null;
  silent: boolean;
  created_at: string | Date;
  read_at: string | Date | null;
  cleared_at: string | Date | null;
  action_at: string | Date | null;
}

function candidateFromEvent(event: StoredEvent): ReminderCandidate {
  return { key: event.event_key, taskId: event.task_id, category: event.category, title: event.title,
    body: event.body, dueAt: iso(event.due_at), deadlineKey: event.deadline_key, silent: event.silent };
}

export async function notificationHistory(userId: string) {
  const found = await rows<StoredEvent & { delivery: string }>(sql()`
    select e.*, case
      when exists (select 1 from planner_notification_deliveries d where d.user_id=e.user_id and d.event_key=e.event_key and d.state='sent') then 'accepted'
      when exists (select 1 from planner_notification_deliveries d where d.user_id=e.user_id and d.event_key=e.event_key and d.state in ('pending','sending')) then 'pending'
      else 'failed' end as delivery
    from planner_notification_events e
    where e.user_id = ${userId} and e.cleared_at is null
      and exists (select 1 from planner_notification_deliveries d where d.user_id=e.user_id and d.event_key=e.event_key and d.state <> 'obsolete')
    order by e.created_at desc limit 100
  `);
  return found.map((e) => ({
    id: `cloud:${e.event_key}`, taskId: e.task_id, title: e.title, body: e.body,
    createdAt: iso(e.created_at), dueAt: iso(e.due_at), read: Boolean(e.read_at),
    kind: e.category, delivery: e.delivery,
  }));
}

export async function changeHistory(userId: string, operation: 'read' | 'readAll' | 'clear' | 'clearAll', key?: string): Promise<void> {
  if (operation === 'read') await sql()`update planner_notification_events set read_at = coalesce(read_at, now()) where user_id = ${userId} and event_key = ${key ?? ''}`;
  if (operation === 'readAll') await sql()`update planner_notification_events set read_at = coalesce(read_at, now()) where user_id = ${userId} and cleared_at is null`;
  if (operation === 'clear') await sql()`update planner_notification_events set cleared_at = coalesce(cleared_at, now()) where user_id = ${userId} and event_key = ${key ?? ''}`;
  if (operation === 'clearAll') await sql()`update planner_notification_events set cleared_at = coalesce(cleared_at, now()) where user_id = ${userId} and cleared_at is null`;
}

async function getEvent(userId: string, key: string): Promise<StoredEvent | null> {
  const found = await rows<StoredEvent>(sql()`select * from planner_notification_events where user_id = ${userId} and event_key = ${key} limit 1`);
  return found[0] ?? null;
}

interface SnapshotRow { payload: ReminderSnapshot & Record<string, unknown>; version: string }
async function getSnapshot(userId: string): Promise<SnapshotRow | null> {
  const found = await rows<SnapshotRow>(sql()`select payload, updated_at::text as version from planner_snapshots where user_id = ${userId} limit 1`);
  return found[0] ?? null;
}

export async function getSnoozes(userId: string): Promise<ServerSnooze[]> {
  const found = await rows<{ task_id: string; deadline_key: string; snoozed_until: string | Date }>(sql()`
    select task_id, deadline_key, snoozed_until from planner_notification_snoozes where user_id = ${userId}
  `);
  return found.map((row) => ({ taskId: row.task_id, deadlineKey: row.deadline_key, until: iso(row.snoozed_until) as string }));
}

/** Fetch the current snapshot again just before *each* send and before display. */
export async function eligibleEvent(userId: string, key: string, now = new Date()): Promise<ReminderCandidate | null> {
  const event = await getEvent(userId, key);
  if (!event || event.action_at) return null;
  if (event.category === 'test') {
    return now.getTime() - new Date(event.created_at).getTime() <= 10 * 60_000 ? candidateFromEvent(event) : null;
  }
  const snapshot = await getSnapshot(userId);
  if (!snapshot) return null;
  const snoozes = await getSnoozes(userId);
  return reminderCandidates(snapshot.payload, now, snoozes).find((candidate) => candidate.key === key) ?? null;
}

/**
 * Native action: token scopes the request to one account and one notification.
 * Completion changes only that task in the authoritative snapshot with a CAS;
 * concurrent syncs cannot overwrite unrelated fields or silently undo it.
 */
export async function applyNotificationAction(userId: string, key: string, action: string): Promise<'ok' | 'stale' | 'invalid'> {
  const event = await getEvent(userId, key);
  if (!event || !event.task_id || !event.deadline_key) return 'invalid';
  if (event.action_at) return 'ok';
  const minutes = action === 'snooze10' ? 10 : action === 'snooze30' ? 30 : action === 'snooze60' ? 60 : 0;
  if (action !== 'complete' && !minutes) return 'invalid';

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const snapshot = await getSnapshot(userId);
    if (!snapshot || !Array.isArray(snapshot.payload.tasks)) return 'stale';
    const task = snapshot.payload.tasks.find((item) => item.id === event.task_id);
    const extra = task as (Task & { archivedAt?: string | null; archived?: boolean }) | undefined;
    if (!task || task.status === 'completed' || task.deletedAt || extra?.archivedAt || extra?.archived ||
        deadlineKey(task, snapshot.payload.settings) !== event.deadline_key) return 'stale';
    if (minutes) {
      const until = new Date(Date.now() + minutes * 60_000).toISOString();
      await sql()`
        insert into planner_notification_snoozes (user_id, task_id, deadline_key, origin_event_key, snoozed_until)
        values (${userId}, ${task.id}, ${event.deadline_key}, ${key}, ${until}::timestamptz)
        on conflict (user_id, task_id) do update set deadline_key=excluded.deadline_key,
          origin_event_key=excluded.origin_event_key, snoozed_until=excluded.snoozed_until
        where planner_notification_snoozes.origin_event_key <> excluded.origin_event_key
      `;
    } else {
      const previousUpdate = Date.parse(task.updatedAt);
      const at = new Date(Math.max(Date.now(), Number.isFinite(previousUpdate) ? previousUpdate + 1 : 0)).toISOString();
      const next = { ...snapshot.payload, tasks: snapshot.payload.tasks.map((item) => item.id === task.id
        ? { ...item, status: 'completed', completedAt: at, updatedAt: at } : item) };
      const updated = await rows<{ user_id: string }>(sql()`
        update planner_snapshots set payload = ${JSON.stringify(next)}::jsonb, updated_at = now()
        where user_id = ${userId} and updated_at = ${snapshot.version}::timestamptz returning user_id
      `);
      if (!updated.length) continue;
    }
    await sql()`update planner_notification_events set action_at = coalesce(action_at, now()), read_at = coalesce(read_at, now())
      where user_id = ${userId} and event_key = ${key}`;
    // Deliberately no task title, endpoint or capability in diagnostics.
    console.info('[reminders] notification action applied', { action });
    return 'ok';
  }
  throw new Error('The planner changed during the action; please retry.');
}

/** One invocation owns the cursor/lease; overlapping cron calls do not compete. */
export async function acquireWorker(): Promise<{ token: string; cursor: string | null } | null> {
  const token = randomUUID();
  const found = await rows<{ cursor: string | null }>(sql()`
    insert into planner_reminder_worker (id, lease_token, lease_until, last_started_at)
    values ('primary', ${token}, now() + interval '60 seconds', now())
    on conflict (id) do update set lease_token=excluded.lease_token, lease_until=excluded.lease_until, last_started_at=now()
      where planner_reminder_worker.lease_until is null or planner_reminder_worker.lease_until < now()
    returning cursor
  `);
  return found.length ? { token, cursor: found[0].cursor } : null;
}

export async function finishWorker(token: string, cursor: string | null, success: boolean): Promise<void> {
  await sql()`update planner_reminder_worker set cursor = ${cursor}, lease_token = null, lease_until = null,
    last_success_at = case when ${success} then now() else last_success_at end
    where id = 'primary' and lease_token = ${token}`;
}

export async function scheduledAccounts(cursor: string | null, limit = 100): Promise<Array<{ userId: string; snapshot: ReminderSnapshot }>> {
  const found = await rows<{ user_id: string; payload: ReminderSnapshot }>(sql()`
    select p.user_id, p.payload from planner_snapshots p
    where (${cursor}::text is null or p.user_id > ${cursor})
      and exists (select 1 from planner_push_subscriptions s where s.user_id = p.user_id
        and (s.expiration_time is null or s.expiration_time > now()))
    order by p.user_id limit ${limit}
  `);
  return found.map((row) => ({ userId: row.user_id, snapshot: row.payload }));
}

/** Unique (account,event,endpoint) keys ensure overlapping/repeated jobs enqueue once. */
export async function enqueueCandidates(userId: string, candidates: ReminderCandidate[]): Promise<number> {
  if (!candidates.length) return 0;
  const found = await rows<{ event_key: string }>(sql()`
    with choices as (
      select value as item from jsonb_array_elements(${JSON.stringify(candidates)}::jsonb)
      where not exists (
        select 1 from planner_notification_ledger l where l.user_id=${userId}
          and l.event_hash=encode(sha256(convert_to(value->>'key','UTF8')),'hex')
      ) and exists (
        select 1 from planner_push_subscriptions s where s.user_id = ${userId}
          and (s.expiration_time is null or s.expiration_time > now())
          and not exists (select 1 from planner_notification_deliveries d
            where d.user_id = ${userId} and d.event_key = value->>'key' and d.endpoint = s.endpoint)
      )
      limit 20
    ), inserted as (
      insert into planner_notification_events (user_id,event_key,task_id,category,title,body,due_at,deadline_key,silent)
      select ${userId}, item->>'key', item->>'taskId', item->>'category', item->>'title', item->>'body',
        nullif(item->>'dueAt','')::timestamptz, item->>'deadlineKey', coalesce((item->>'silent')::boolean,false)
      from choices on conflict (user_id,event_key) do nothing returning user_id,event_key
    ), targets as (
      select user_id,event_key from inserted
      union all
      select e.user_id,e.event_key from planner_notification_events e
        join choices c on e.user_id=${userId} and e.event_key=c.item->>'key'
    )
    insert into planner_notification_deliveries (user_id,event_key,endpoint)
    select i.user_id,i.event_key,s.endpoint from targets i join planner_push_subscriptions s on s.user_id=i.user_id
      and (s.expiration_time is null or s.expiration_time > now())
    on conflict (user_id,event_key,endpoint) do nothing returning event_key
  `);
  return found.length;
}

export async function enqueueTest(userId: string, endpoint: string): Promise<string | null> {
  const key = JSON.stringify(['test', randomUUID()]);
  const found = await rows<{ event_key: string }>(sql()`
    with inserted as (
      insert into planner_notification_events (user_id,event_key,category,title,body)
      select ${userId}, ${key}, 'test', 'Workday Planner test', 'This is a test of background Web Push on this device.'
      where exists (select 1 from planner_push_subscriptions where user_id=${userId} and endpoint=${endpoint})
      returning user_id,event_key
    )
    insert into planner_notification_deliveries (user_id,event_key,endpoint)
    select user_id,event_key,${endpoint} from inserted returning event_key
  `);
  return found[0]?.event_key ?? null;
}

export interface Delivery {
  userId: string; key: string; endpoint: string; p256dh: string; auth: string; attempts: number;
}

export async function claimDeliveries(limit = 30): Promise<Delivery[]> {
  const found = await rows<{ user_id: string; event_key: string; endpoint: string; p256dh: string; auth: string; attempts: number }>(sql()`
    with chosen as (
      select d.user_id,d.event_key,d.endpoint from planner_notification_deliveries d
      join planner_push_subscriptions s on s.user_id=d.user_id and s.endpoint=d.endpoint
      where ((d.state='pending' and d.next_attempt_at <= now()) or (d.state='sending' and d.lease_until < now()))
        and (s.expiration_time is null or s.expiration_time > now())
      order by d.next_attempt_at for update of d skip locked limit ${limit}
    ), claimed as (
      update planner_notification_deliveries d set state='sending', attempts=d.attempts+1, lease_until=now()+interval '45 seconds'
      from chosen c where d.user_id=c.user_id and d.event_key=c.event_key and d.endpoint=c.endpoint
      returning d.user_id,d.event_key,d.endpoint,d.attempts
    )
    select c.*, s.p256dh,s.auth from claimed c join planner_push_subscriptions s on s.user_id=c.user_id and s.endpoint=c.endpoint
  `);
  return found.map((row) => ({ userId: row.user_id, key: row.event_key, endpoint: row.endpoint,
    p256dh: row.p256dh, auth: row.auth, attempts: Number(row.attempts) }));
}

export async function finishDelivery(delivery: Delivery, state: 'sent' | 'pending' | 'failed' | 'obsolete', status: number | null = null): Promise<void> {
  const retrySeconds = Math.min(900, 60 * 2 ** Math.max(0, delivery.attempts - 1));
  await sql()`update planner_notification_deliveries set state=${state}, lease_until=null, last_status=${status},
    next_attempt_at=now()+(${retrySeconds} * interval '1 second')
    where user_id=${delivery.userId} and event_key=${delivery.key} and endpoint=${delivery.endpoint} and state='sending' and attempts=${delivery.attempts}`;
}

export async function updateEventContent(userId: string, candidate: ReminderCandidate): Promise<void> {
  await sql()`update planner_notification_events set title=${candidate.title}, body=${candidate.body}, silent=${candidate.silent}
    where user_id=${userId} and event_key=${candidate.key}`;
}

export async function pruneNotificationHistory(): Promise<void> {
  // Most old stages can never be generated again. The initial overdue and
  // post-snooze one-off keys can remain current indefinitely when repeats are
  // disabled, so retain only their SHA-256 hashes while deleting their content.
  await sql()`
    with removed as (
      delete from planner_notification_events where created_at < now() - interval '30 days'
      returning user_id,event_key,category
    )
    insert into planner_notification_ledger (user_id,event_hash)
    select user_id,encode(sha256(convert_to(event_key,'UTF8')),'hex') from removed
    where category='overdue' and (
      event_key like '%"overdue:0"]' or
      (event_key like '%"snooze:%' and event_key not like '%:repeat:%')
    )
    on conflict do nothing
  `;
}

/** Account-authenticated snooze from an open planner, using the same durable state. */
export async function snoozeAccountTask(userId: string, taskId: string, minutes: number): Promise<boolean> {
  if (![10, 15, 30, 60].includes(minutes)) return false;
  const snapshot = await getSnapshot(userId);
  const task = snapshot?.payload.tasks?.find((item) => item.id === taskId);
  if (!snapshot || !task || task.status === 'completed' || task.deletedAt) return false;
  const deadline = deadlineKey(task, snapshot.payload.settings);
  if (!deadline) return false;
  const until = new Date(Date.now() + minutes * 60_000).toISOString();
  await sql()`insert into planner_notification_snoozes (user_id, task_id, deadline_key, origin_event_key, snoozed_until)
    values (${userId}, ${taskId}, ${deadline}, ${`manual:${randomUUID()}`}, ${until}::timestamptz)
    on conflict (user_id, task_id) do update set deadline_key=excluded.deadline_key,
      origin_event_key=excluded.origin_event_key, snoozed_until=excluded.snoozed_until`;
  return true;
}
