-- Neon schema for My Workday Planner.
--
-- Optional: run in the Neon console → SQL Editor. Additive tables, no extensions.
-- Everything is reached through /api/*, which is the only thing holding the
-- connection string — the browser never talks to Postgres directly.

create table if not exists app_users (
  id            text primary key,
  display_name  text not null default '',
  salt          text not null,
  hash          text not null,
  iterations    integer not null default 210000,
  created_at    timestamptz not null default now()
);

create table if not exists app_sessions (
  token_hash  text primary key,
  user_id     text not null references app_users (id) on delete cascade,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);

create index if not exists app_sessions_user on app_sessions (user_id);

create table if not exists planner_snapshots (
  user_id     text primary key references app_users (id) on delete cascade,
  payload     jsonb not null,
  updated_at  timestamptz not null default now()
);

-- Expired sessions are dead weight; this keeps the table honest.
create index if not exists app_sessions_expiry on app_sessions (expires_at);

-- Photos and voice memos: one file, one row, bytea bytes.
--
-- They deliberately do NOT live inside planner_snapshots.payload: a snapshot is
-- re-sent whole whenever anything changes, and the serverless request-body cap
-- (~4.5 MB) would turn one large camera photo into an outage for every sync.
-- api/attachments.ts serves these rows one file per request, with per-file and
-- per-account caps enforced server-side. api/_lib/schema.ts creates this table
-- on first request, so running this file is optional but keeps provisioning
-- explicit.
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
);

create index if not exists planner_attachments_user on planner_attachments (user_id, updated_at);

-- Persistent Web Push state (additive; the snapshot above remains the only task database).
create table if not exists planner_push_subscriptions (
  endpoint text primary key, user_id text not null references app_users(id) on delete cascade,
  p256dh text not null, auth text not null, expiration_time timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists planner_push_user on planner_push_subscriptions (user_id);
create table if not exists planner_notification_events (
  user_id text not null references app_users(id) on delete cascade, event_key text not null,
  task_id text, category text not null, title text not null, body text not null,
  due_at timestamptz, deadline_key text, silent boolean not null default false,
  created_at timestamptz not null default now(), read_at timestamptz, cleared_at timestamptz,
  action_at timestamptz, primary key (user_id, event_key)
);
create index if not exists planner_notification_history on planner_notification_events (user_id, created_at desc);
-- Only hashes of old one-off overdue keys are retained, not notification text.
create table if not exists planner_notification_ledger (
  user_id text not null references app_users(id) on delete cascade, event_hash text not null,
  primary key (user_id, event_hash)
);
create table if not exists planner_notification_deliveries (
  user_id text not null, event_key text not null, endpoint text not null,
  state text not null default 'pending', attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(), lease_until timestamptz, last_status integer,
  primary key (user_id, event_key, endpoint),
  foreign key (user_id, event_key) references planner_notification_events(user_id, event_key) on delete cascade
);
create index if not exists planner_notification_pending on planner_notification_deliveries (state, next_attempt_at);
create table if not exists planner_notification_snoozes (
  user_id text not null references app_users(id) on delete cascade, task_id text not null,
  deadline_key text not null, origin_event_key text not null default '', snoozed_until timestamptz not null, primary key (user_id, task_id)
);
create table if not exists planner_reminder_worker (
  id text primary key, cursor text, lease_token text, lease_until timestamptz,
  last_started_at timestamptz, last_success_at timestamptz
);
