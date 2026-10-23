-- Neon schema for My Workday Planner.
--
-- Run once, in the Neon console → SQL Editor. Three tables, no extensions.
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
