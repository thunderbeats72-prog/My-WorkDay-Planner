# Optional Supabase sync (Stage 5 — not configured by default)

The shipped app is **local-only**. Do not claim sync works until you complete and test this.

1. Create a free Supabase project. Note free projects can pause after inactivity and have quota limits — check current pricing.
2. In SQL Editor, create tables `profiles`, `tasks`, `time_sessions`, `reminder_records`, `user_settings` with `user_id uuid references auth.users`, UUID PKs, `created_at/updated_at timestamptz`.
3. Enable RLS on every table and add SELECT/INSERT/UPDATE/DELETE policies using `(select auth.uid()) = user_id` for both `using` and `with check` where applicable. Add equivalent child-table checks so sessions can only reference your own tasks.
4. Add `.env.local` with only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (publishable key). Never put a service-role key in frontend code.
5. Test with two different user accounts on two browsers/devices and verify neither can read the other's rows before enabling sync in production.

Starter policy (tasks):

```sql
alter table public.tasks enable row level security;
create policy "read own" on public.tasks for select to authenticated using ((select auth.uid()) = user_id);
create policy "insert own" on public.tasks for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "update own" on public.tasks for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "delete own" on public.tasks for delete to authenticated using ((select auth.uid()) = user_id);
```
