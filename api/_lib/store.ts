import { neon } from '@neondatabase/serverless';
import { pickDatabaseUrl } from '../../src/lib/databaseUrl.js';
import { mergeSnapshots, mergeTasks } from '../../src/lib/snapshot.js';
import type { Task } from '../../src/lib/types.js';
import type { BackupFile } from '../../src/lib/backupTypes.js';

/**
 * The server side of Neon sync: additive tables, no ORM.
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

/**
 * Environment variables, read through `globalThis`.
 *
 * Vercel type-checks each function on its own terms, and its defaults do not
 * always include `@types/node` — the real failure was `Cannot find name
 * 'process'` on this exact line, which stopped the function deploying and left
 * /api returning 404 at runtime. Reading it structurally compiles either way.
 */
function env(): Record<string, string | undefined> {
  const scope = globalThis as unknown as { process?: { env?: Record<string, string | undefined> } };
  return scope.process?.env ?? {};
}

/** True when some spelling of the connection string reached this function. */
export function databaseUrlPresent(): boolean {
  return Boolean(pickDatabaseUrl(env()));
}

export function sql() {
  const url = pickDatabaseUrl(env());
  if (!url) {
    throw new Error(
      'No database is attached to this deployment: no DATABASE_URL reached the function. In Vercel → Storage, connect the Neon database to this project (Production and Preview), then redeploy.',
    );
  }
  if (!client) client = neon(url);
  return client;
}

export const TABLES = {
  users: 'app_users',
  sessions: 'app_sessions',
  snapshots: 'planner_snapshots',
  attachments: 'planner_attachments',
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
  if (/no database is attached/i.test(message)) return message;
  if (/relation .* does not exist/i.test(message)) {
    return 'The database refused to create its tables. Check that DATABASE_URL points at a database you own and try again.';
  }
  if (/permission denied|must be owner/i.test(message)) {
    return 'The database user in DATABASE_URL cannot create tables. Use the connection string from Neon’s Connection Details unchanged.';
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

/**
 * Just the timestamp of the last write, for devices that only want to ask
 * "has anything changed?" A few dozen bytes instead of the whole snapshot.
 *
 * The answer spans both tables now: adding a photo on the laptop must change
 * the number the phone is polling, or the phone would never learn there is a
 * new attachment to fetch. The newest of snapshot and attachments wins; with
 * neither present the answer stays null, exactly as before.
 */
export async function snapshotVersion(userId: string): Promise<string | null> {
  const found = await rows<{ at: string | Date | null }>(sql()`
    select max(at) as at from (
      select (select updated_at from planner_snapshots where user_id = ${userId}) as at
      union all
      select max(updated_at) as at from planner_attachments where user_id = ${userId}
    ) versions
  `);
  const value = found[0]?.at;
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

export async function readSnapshot(userId: string): Promise<unknown | null> {
  const found = await rows<{ payload: unknown }>(sql()`
    select payload from planner_snapshots where user_id = ${userId} limit 1
  `);
  return found[0]?.payload ?? null;
}

/**
 * Optimistic merge/write. A notification action may complete a task between a
 * device's pull and push; an unconditional whole-snapshot replacement would
 * silently undo that completion (or another device's edit).
 */
export async function writeSnapshot(userId: string, payload: unknown): Promise<void> {
  const normalise = (input: unknown): BackupFile => {
    const value = input as Partial<BackupFile>;
    return {
      ...value,
      app: 'my-workday-planner',
      version: typeof value.version === 'number' ? value.version : 1,
      exportedAt: typeof value.exportedAt === 'string' ? value.exportedAt : '1970-01-01T00:00:00.000Z',
      settings: (value.settings ?? {}) as BackupFile['settings'],
      tasks: Array.isArray(value.tasks) ? value.tasks : [],
      timeSessions: Array.isArray(value.timeSessions) ? value.timeSessions : [],
      reminderRecords: Array.isArray(value.reminderRecords) ? value.reminderRecords : [],
      taskEvents: Array.isArray(value.taskEvents) ? value.taskEvents : [],
      reports: Array.isArray(value.reports) ? value.reports : [],
    };
  };
  const incoming = normalise(payload);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const current = await rows<{ payload: unknown; version: string }>(sql()`
      select payload, updated_at::text as version from planner_snapshots where user_id = ${userId} limit 1
    `);
    if (!current[0]) {
      const inserted = await rows<{ user_id: string }>(sql()`
        insert into planner_snapshots (user_id, payload, updated_at)
        values (${userId}, ${JSON.stringify(incoming)}::jsonb, now())
        on conflict (user_id) do nothing returning user_id
      `);
      if (inserted.length) return;
      continue;
    }
    const remote = normalise(current[0].payload);
    const { merged } = mergeSnapshots(incoming, remote);
    // Keep unknown fields from both versions for forwards-compatible backups.
    const combined = { ...(current[0].payload as object), ...(payload as object), ...merged };
    const updated = await rows<{ user_id: string }>(sql()`
      update planner_snapshots set payload = ${JSON.stringify(combined)}::jsonb, updated_at = now()
      where user_id = ${userId} and updated_at = ${current[0].version}::timestamptz returning user_id
    `);
    if (updated.length) return;
  }
  throw new Error('Snapshot changed too many times; retry sync.');
}

/** Apply only changed task rows to the existing snapshot, with optimistic CAS.
 * Used for a keepalive write on deadline/status changes before a tab closes. */
export async function patchSnapshotTasks(userId: string, changed: Task[]): Promise<boolean> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const current = await rows<{ payload: Record<string, unknown>; version: string }>(sql()`
      select payload, updated_at::text as version from planner_snapshots where user_id=${userId} limit 1
    `);
    if (!current[0] || !Array.isArray(current[0].payload.tasks)) return false;
    const original = current[0].payload.tasks as Task[];
    const merged = mergeTasks(original, changed).tasks;
    if (JSON.stringify(original) === JSON.stringify(merged)) return true;
    const next = { ...current[0].payload, tasks: merged };
    const updated = await rows<{ user_id: string }>(sql()`
      update planner_snapshots set payload=${JSON.stringify(next)}::jsonb, updated_at=now()
      where user_id=${userId} and updated_at=${current[0].version}::timestamptz returning user_id
    `);
    if (updated.length) return true;
  }
  throw new Error('Snapshot changed too many times; retry sync.');
}

/* ---------------------------------------------------------- attachments */

/**
 * Metadata only — the list never drags bytes across the wire, so a device can
 * work out what it is missing with a payload of a few kilobytes.
 */
export interface AttachmentMetaRow {
  id: string;
  task_id: string;
  kind: string;
  mime: string;
  size: number;
  duration_ms: number | null;
  created_at: string | Date;
}

export interface AttachmentUsage {
  count: number;
  bytes: number;
}

function metaOf(row: AttachmentMetaRow): Record<string, unknown> {
  return {
    id: row.id,
    taskId: row.task_id,
    kind: row.kind,
    mime: row.mime,
    size: row.size,
    durationMs: row.duration_ms,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}

export async function listAttachments(userId: string): Promise<{ attachments: Record<string, unknown>[]; usage: AttachmentUsage }> {
  const found = await rows<AttachmentMetaRow & { total_count: string | number; total_bytes: string | number }>(sql()`
    select id, task_id, kind, mime, size, duration_ms, created_at,
           count(*) over() as total_count,
           coalesce(sum(size) over(), 0) as total_bytes
    from planner_attachments
    where user_id = ${userId}
    order by created_at asc
  `);
  const usage: AttachmentUsage = {
    count: Number(found[0]?.total_count ?? 0),
    bytes: Number(found[0]?.total_bytes ?? 0),
  };
  return { attachments: found.map(metaOf), usage };
}

export async function getAttachment(userId: string, id: string): Promise<(Record<string, unknown> & { data: string }) | null> {
  const found = await rows<AttachmentMetaRow & { data: string }>(sql()`
    select id, task_id, kind, mime, size, duration_ms, created_at, encode(data, 'bytea') as data
    from planner_attachments
    where user_id = ${userId} and id = ${id}
    limit 1
  `);
  const row = found[0];
  if (!row) return null;
  return { ...metaOf(row), data: row.data };
}

export type PutAttachmentOutcome = 'ok' | 'too-many' | 'too-large';

/**
 * Upsert one file, enforcing both caps against the *other* rows — a re-push of
 * an id the server already holds must not double-count its own size.
 */
export async function putAttachment(
  userId: string,
  meta: { id: string; taskId: string; kind: string; mime: string; size: number; durationMs: number | null; createdAt: string },
  dataHex: string,
  limits: { maxFileBytes: number; maxUserBytes: number; maxUserCount: number },
): Promise<PutAttachmentOutcome> {
  const others = await rows<{ count: string | number; bytes: string | number }>(sql()`
    select count(*) as count, coalesce(sum(size), 0) as bytes
    from planner_attachments
    where user_id = ${userId} and id != ${meta.id}
  `);
  const count = Number(others[0]?.count ?? 0);
  const bytes = Number(others[0]?.bytes ?? 0);
  if (count + 1 > limits.maxUserCount) return 'too-many';
  if (bytes + meta.size > limits.maxUserBytes) return 'too-large';

  await sql()`
    insert into planner_attachments (user_id, id, task_id, kind, mime, size, duration_ms, created_at, updated_at, data)
    values (
      ${userId}, ${meta.id}, ${meta.taskId}, ${meta.kind}, ${meta.mime}, ${meta.size}, ${meta.durationMs},
      ${meta.createdAt}::timestamptz, now(), decode(${dataHex}, 'bytea')
    )
    on conflict (user_id, id) do update
      set updated_at = now(), data = excluded.data
  `;
  return 'ok';
}

/** How many rows actually went — ids from another account silently vanish. */
export async function deleteAttachments(userId: string, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  // The id list travels as JSON text and is expanded server-side: one scalar
  // parameter the HTTP driver definitely serialises, rather than relying on
  // array-parameter behaviour that has changed between driver versions.
  const deleted = await rows<{ id: string }>(sql()`
    delete from planner_attachments
    where user_id = ${userId}
      and id in (select jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))
    returning id
  `);
  if (deleted.length > 0) {
    // A delete must be as visible as a create. Removing a row can leave the
    // attachments max(updated_at) *lower* than the snapshot's timestamp, in
    // which case the version other devices poll would not move at all and
    // they would keep the file indefinitely. Bumping the snapshot's clock —
    // without touching its payload — changes the answer they are polling for.
    await sql()`update planner_snapshots set updated_at = now() where user_id = ${userId}`;
  }
  return deleted.length;
}
