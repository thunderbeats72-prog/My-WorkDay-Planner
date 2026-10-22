import { sql } from './store';

/**
 * Creates the three tables on first use.
 *
 * The alternative was asking a non-technical owner to paste SQL into Neon's
 * editor and get it exactly right — the single most error-prone step in setup.
 * These statements are idempotent (`if not exists`), contain no user input, and
 * run once per warm serverless instance, so the cost is one round trip after a
 * cold start and nothing after that.
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
