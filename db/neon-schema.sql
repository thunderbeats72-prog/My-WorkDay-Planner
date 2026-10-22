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
