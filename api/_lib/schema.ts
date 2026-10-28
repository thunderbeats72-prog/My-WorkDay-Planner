import { sql } from './store.js';

/**
 * Creates the additive planner and reminder tables on first use.
 *
 * The alternative was asking a non-technical owner to paste SQL into Neon's
 * editor and get it exactly right — the single most error-prone step in setup.
 * These statements are idempotent (`if not exists`), contain no user input, and
 * run once per warm serverless instance, so cold starts may make several
 * database round trips; warm invocations reuse the initialization.
 */
let ready: Promise<void> | null = null;

async function run(): Promise<void> {
  await sql()`
    create table if not exists app_users (
      id            text primary key,
      display_name  text not null default '',
      salt          text not null,
      hash          text not null,
      iterations    integer not null default 210000,
      created_at    timestamptz not null default now()
    )
  `;
  await sql()`
    create table if not exists app_sessions (
      token_hash  text primary key,
      user_id     text not null references app_users (id) on delete cascade,
      expires_at  timestamptz not null,
      created_at  timestamptz not null default now()
    )
  `;
  await sql()`create index if not exists app_sessions_user on app_sessions (user_id)`;
  await sql()`create index if not exists app_sessions_expiry on app_sessions (expires_at)`;
  await sql()`
    create table if not exists planner_snapshots (
      user_id     text primary key references app_users (id) on delete cascade,
      payload     jsonb not null,
      updated_at  timestamptz not null default now()
    )
  `;
  // Photos and voice memos live in their own rows, never inside the snapshot:
  // one camera photo in a jsonb payload would blow past the request-body cap
  // and take every device's sync down with it. One file, one row, one request.
  await sql()`
    create table if not exists planner_attachments (
      user_id     text not null references app_users (id) on delete cascade,
      id          text not null,
      task_id     text not null,
      kind        text not null,
      mime        text not null,
      size        integer not null,
      duration_ms integer,
      created_at  timestamptz not null default now(),
      updated_at  timestamptz not null default now(),
      data        bytea not null,
      primary key (user_id, id)
    )
  `;
  await sql()`create index if not exists planner_attachments_user on planner_attachments (user_id, updated_at)`;

  // Additive only: snapshots remain the authoritative task database. These
  // rows hold device endpoints, delivery state and notification history.
  await sql()`
    create table if not exists planner_push_subscriptions (
      endpoint text primary key,
      user_id text not null references app_users(id) on delete cascade,
      p256dh text not null,
      auth text not null,
      expiration_time timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `;
  await sql()`create index if not exists planner_push_user on planner_push_subscriptions (user_id)`;
  await sql()`
    create table if not exists planner_notification_events (
      user_id text not null references app_users(id) on delete cascade,
      event_key text not null,
      task_id text,
      category text not null,
      title text not null,
      body text not null,
      due_at timestamptz,
      deadline_key text,
      silent boolean not null default false,
      created_at timestamptz not null default now(),
      read_at timestamptz,
      cleared_at timestamptz,
      action_at timestamptz,
      primary key (user_id, event_key)
    )
  `;
  await sql()`create index if not exists planner_notification_history on planner_notification_events (user_id, created_at desc)`;
  // Minimal long-lived hashes keep a no-repeat overdue event from reappearing
  // after its 30-day, content-bearing history row is pruned.
  await sql()`
    create table if not exists planner_notification_ledger (
      user_id text not null references app_users(id) on delete cascade,
      event_hash text not null,
      primary key (user_id, event_hash)
    )
  `;
  await sql()`
    create table if not exists planner_notification_deliveries (
      user_id text not null,
      event_key text not null,
      endpoint text not null,
      state text not null default 'pending',
      attempts integer not null default 0,
      next_attempt_at timestamptz not null default now(),
      lease_until timestamptz,
      last_status integer,
      primary key (user_id, event_key, endpoint),
      foreign key (user_id, event_key) references planner_notification_events(user_id, event_key) on delete cascade
    )
  `;
  await sql()`create index if not exists planner_notification_pending on planner_notification_deliveries (state, next_attempt_at)`;
  await sql()`
    create table if not exists planner_notification_snoozes (
      user_id text not null references app_users(id) on delete cascade,
      task_id text not null,
      deadline_key text not null,
      origin_event_key text not null default '',
      snoozed_until timestamptz not null,
      primary key (user_id, task_id)
    )
  `;
  await sql()`
    create table if not exists planner_reminder_worker (
      id text primary key,
      cursor text,
      lease_token text,
      lease_until timestamptz,
      last_started_at timestamptz,
      last_success_at timestamptz
    )
  `;
}

/**
 * Resolves once the schema exists. A failure clears the memo so the next
 * request retries instead of failing forever on one bad connection.
 */
export function ensureSchema(): Promise<void> {
  if (!ready) {
    ready = run().catch((error: unknown) => {
      ready = null;
      throw error;
    });
  }
  return ready;
}
