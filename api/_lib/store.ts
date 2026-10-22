import { neon } from '@neondatabase/serverless';

/**
 * The whole server side of Neon sync: three tables, no ORM.
 *
 * Rows are scoped by `user_id`, and every route derives that id from the
 * session token — never from the request body — so a caller cannot ask for
 * someone else's snapshot by naming them.
 */

export interface ApiRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
}

export interface ApiResponse {
  status(code: number): ApiResponse;
  json(payload: unknown): void;
  setHeader(name: string, value: string): void;
}

export interface UserRow {
  id: string;
  display_name: string;
  salt: string;
  hash: string;
  iterations: number;
}

let client: ReturnType<typeof neon> | null = null;

/** Rows come back as objects for the tagged-template form; keep the typing honest. */
async function rows<T>(query: ReturnType<ReturnType<typeof neon>>): Promise<T[]> {
  return (await query) as unknown as T[];
}

export function sql() {
  const url = process.env.DATABASE_URL ?? process.env.NEON_DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Copy the connection string from Neon → Connection Details and add it to the deployment.',
    );
  }
  if (!client) client = neon(url);
  return client;
}

export const TABLES = {
  users: 'app_users',
  sessions: 'app_sessions',
  snapshots: 'planner_snapshots',
} as const;

/* ------------------------------------------------------------ responses */

export function bodyOf(req: ApiRequest): Record<string, unknown> {
  const raw = req.body;
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
}

export function fail(res: ApiResponse, status: number, error: string): void {
  res.status(status).json({ error });
}

/** Turns a thrown error into a message a person can act on, never a stack. */
export function explain(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/DATABASE_URL is not set/i.test(message)) return message;
  if (/relation .* does not exist/i.test(message)) {
    return 'The database tables are missing. Run db/neon-schema.sql once in the Neon SQL editor.';
  }
  if (/password authentication failed|invalid_password|does not exist/i.test(message) && /role|database/i.test(message)) {
    return 'Neon rejected the connection string. Copy it again from Neon → Connection Details.';
  }
  return 'The sync API could not reach the database. Try again in a moment.';
}

export function bearerToken(req: ApiRequest): string | null {
  const header = req.headers.authorization ?? req.headers.Authorization;
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return null;
  const match = /^Bearer\s+(.+)$/i.exec(value);
  return match ? match[1].trim() : null;
}

export function noStore(res: ApiResponse): void {
  res.setHeader('Cache-Control', 'no-store');
}

/* ---------------------------------------------------------------- users */

export async function findUser(id: string): Promise<UserRow | null> {
  const found = await rows<UserRow>(sql()`
    select id, display_name, salt, hash, iterations
    from app_users
    where id = ${id}
    limit 1
  `);
  return found[0] ?? null;
}

export async function insertUser(row: UserRow): Promise<void> {
  await sql()`
    insert into app_users (id, display_name, salt, hash, iterations)
    values (${row.id}, ${row.display_name}, ${row.salt}, ${row.hash}, ${row.iterations})
  `;
}

/* ------------------------------------------------------------- sessions */

export async function createSession(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
  await sql()`
    insert into app_sessions (token_hash, user_id, expires_at)
    values (${tokenHash}, ${userId}, ${expiresAt.toISOString()})
  `;
}

export async function sessionUser(tokenHash: string): Promise<string | null> {
  const found = await rows<{ user_id: string }>(sql()`
    select user_id
    from app_sessions
    where token_hash = ${tokenHash} and expires_at > now()
    limit 1
  `);
  return found[0]?.user_id ?? null;
}

export async function deleteSession(tokenHash: string): Promise<void> {
  await sql()`delete from app_sessions where token_hash = ${tokenHash}`;
}

/* ------------------------------------------------------------ snapshots */

export async function readSnapshot(userId: string): Promise<unknown | null> {
  const found = await rows<{ payload: unknown }>(sql()`
    select payload from planner_snapshots where user_id = ${userId} limit 1
  `);
  return found[0]?.payload ?? null;
}

export async function writeSnapshot(userId: string, payload: unknown): Promise<void> {
  await sql()`
    insert into planner_snapshots (user_id, payload, updated_at)
    values (${userId}, ${JSON.stringify(payload)}::jsonb, now())
    on conflict (user_id) do update
      set payload = excluded.payload, updated_at = now()
  `;
}
