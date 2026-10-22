-- Sync for My Workday Planner.
--
-- Run this once in the Supabase SQL editor, then paste the project URL and the
-- anon public key into Settings → Account → "Use on phone and laptop".
--
-- What this creates: one row per user, holding that user's planner snapshot as
-- JSON. Row-level security means the anon key in the browser cannot read anyone
-- else's row, which is the whole point of doing this in Postgres rather than in
-- a bucket of files.

create table if not exists public.planner_snapshots (
  user_id uuid primary key references auth.users (id) on delete cascade,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.planner_snapshots enable row level security;

drop policy if exists "read own snapshot" on public.planner_snapshots;
create policy "read own snapshot"
  on public.planner_snapshots for select
  using (auth.uid() = user_id);

drop policy if exists "insert own snapshot" on public.planner_snapshots;
create policy "insert own snapshot"
  on public.planner_snapshots for insert
  with check (auth.uid() = user_id);

drop policy if exists "update own snapshot" on public.planner_snapshots;
create policy "update own snapshot"
  on public.planner_snapshots for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- The app signs in with a user ID, not an email. It maps `lakshit` to
-- `lakshit@users.workday-planner.app` and never sends mail there, so email
-- confirmation must be off:
--
--   Authentication → Providers → Email → Confirm email: OFF
--
-- If your project requires confirmation, sign-up returns a user with no
-- session and the app will tell you to switch it off rather than silently
-- failing to sync.
