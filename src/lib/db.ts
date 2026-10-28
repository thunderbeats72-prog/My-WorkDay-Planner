import Dexie, { type Table } from 'dexie';
import type { ReminderRecord, SavedReport, Settings, Task, TaskEvent, TimeSession } from './types';
import type { AttachmentRecord } from './attachments';
import { DEFAULT_SETTINGS } from './types';
import type { BackupFile } from './backupTypes';
import { mergeIsQuiet, mergeSnapshots } from './snapshot';

export const DB_NAME = 'bd-command-center';

export class PlannerDB extends Dexie {
  tasks!: Table<Task, string>;
  timeSessions!: Table<TimeSession, string>;
  reminderRecords!: Table<ReminderRecord, string>;
  taskEvents!: Table<TaskEvent, string>;
  settings!: Table<Settings, string>;
  attachments!: Table<AttachmentRecord, string>;
  reports!: Table<SavedReport, string>;

  constructor() {
    super(DB_NAME);
    this.version(1).stores({
      tasks: 'id, status, priority, dueDate, scheduledFor, createdAt, deletedAt, client, category, source',
      timeSessions: 'id, taskId, state, startedAt',
      reminderRecords: 'id, taskId, status, dueAt',
      taskEvents: 'id, taskId, at',
      settings: 'id',
    });
    // v2 adds one table and touches nothing else, so existing tasks, sessions
    // and reminders carry over untouched — the same upgrade path this database
    // has taken before.
    this.version(2).stores({
      attachments: 'id, taskId, createdAt, deletedAt',
    });
    // v3 is one more table, again additive only: tasks, sessions, reminders and
    // attachments are not touched by the upgrade, so an existing planner opens
    // exactly as it was with a new, empty shelf for saved daily reports.
    this.version(3).stores({
      reports: 'id, dateISO, updatedAt',
    });
  }
}

export const db = new PlannerDB();

export function uniqueId(prefix: string): string {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return `${prefix}_${cryptoObj.randomUUID()}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function loadSettings(): Promise<Settings> {
  const stored = await db.settings.get('app');
  if (!stored) return { ...DEFAULT_SETTINGS };
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await db.settings.put(settings);
}

export async function listTasks(): Promise<Task[]> {
  return db.tasks.toArray();
}

export async function getTask(id: string): Promise<Task | undefined> {
  return db.tasks.get(id);
}

export async function saveTask(task: Task): Promise<void> {
  await db.tasks.put(task);
}

export async function saveTasks(tasks: Task[]): Promise<void> {
  await db.tasks.bulkPut(tasks);
}

export async function removeTaskPermanently(id: string): Promise<void> {
  await db.transaction('rw', db.tasks, db.timeSessions, db.reminderRecords, db.taskEvents, db.attachments, async () => {
    await db.tasks.delete(id);
    await db.timeSessions.where('taskId').equals(id).delete();
    await db.reminderRecords.where('taskId').equals(id).delete();
    await db.taskEvents.where('taskId').equals(id).delete();
    // Attachments become tombstones, not vanishments: the id stays (without
    // its bytes) until sync has told the server to delete the file too,
    // otherwise a copy would live on in the database forever with nothing
    // local pointing at it.
    const attachments = await db.attachments.where('taskId').equals(id).toArray();
    const at = new Date().toISOString();
    const keep = attachments.filter((row) => row.deletedAt === null);
    if (keep.length > 0) {
      await db.attachments.bulkPut(keep.map((row) => ({ ...row, deletedAt: at, blob: null })));
    }
    const tombstoned = attachments.filter((row) => row.deletedAt !== null && row.synced === false);
    if (tombstoned.length > 0) await db.attachments.bulkDelete(tombstoned.map((row) => row.id));
  });
}

export async function logEvent(taskId: string, type: TaskEvent['type'], detail: string, at = new Date().toISOString()): Promise<void> {
  await db.taskEvents.add({ id: uniqueId('evt'), taskId, at, type, detail });
}

export async function listEvents(taskId: string): Promise<TaskEvent[]> {
  const events = await db.taskEvents.where('taskId').equals(taskId).toArray();
  return events.sort((a, b) => a.at.localeCompare(b.at));
}

export async function listAllEvents(): Promise<TaskEvent[]> {
  return db.taskEvents.toArray();
}

export async function listSessions(): Promise<TimeSession[]> {
  return db.timeSessions.toArray();
}

export async function saveSession(session: TimeSession): Promise<void> {
  await db.timeSessions.put(session);
}

export async function listSessionsForTask(taskId: string): Promise<TimeSession[]> {
  const sessions = await db.timeSessions.where('taskId').equals(taskId).toArray();
  return sessions.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

export async function activeSession(): Promise<TimeSession | null> {
  const running = await db.timeSessions.where('state').equals('running').toArray();
  if (running.length === 0) return null;
  running.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return running[0];
}

export async function pauseStraySessions(keepId: string | null): Promise<TimeSession[]> {
  const running = await db.timeSessions.where('state').equals('running').toArray();
  const changed: TimeSession[] = [];
  for (const session of running) {
    if (session.id === keepId) continue;
    const ended: TimeSession = { ...session, state: 'paused', endedAt: new Date().toISOString() };
    await db.timeSessions.put(ended);
    changed.push(ended);
  }
  return changed;
}

export async function listReminders(): Promise<ReminderRecord[]> {
  return db.reminderRecords.toArray();
}

export async function saveReminders(records: ReminderRecord[]): Promise<void> {
  await db.reminderRecords.bulkPut(records);
}

/**
 * One saved report per day.
 *
 * `dateISO` is the key: saving today's update can never overwrite yesterday's,
 * because yesterday's row is a different date. Re-saving the same day replaces
 * that day's text on purpose — a day has one official update.
 */
export async function saveReport(report: SavedReport): Promise<void> {
  const existing = await db.reports.where('dateISO').equals(report.dateISO).first();
  if (existing) {
    await db.reports.put({ ...report, id: existing.id });
    return;
  }
  await db.reports.put(report);
}

export async function getReport(dateISO: string): Promise<SavedReport | null> {
  const row = await db.reports.where('dateISO').equals(dateISO).first();
  return row ?? null;
}

export async function listReports(): Promise<SavedReport[]> {
  const rows = await db.reports.toArray();
  return rows.sort((a, b) => b.dateISO.localeCompare(a.dateISO));
}

export async function deleteReport(dateISO: string): Promise<void> {
  await db.reports.where('dateISO').equals(dateISO).delete();
}

export async function clearAllData(): Promise<void> {
  // The array form of Dexie's transaction: seven tables is one past what the
  // flat (mode, table, table, …) signature accepts.
  await db.transaction(
    'rw',
    [db.tasks, db.timeSessions, db.reminderRecords, db.taskEvents, db.settings, db.attachments, db.reports],
    async () => {
      await db.tasks.clear();
      await db.timeSessions.clear();
      await db.reminderRecords.clear();
      await db.taskEvents.clear();
      await db.settings.clear();
      await db.reports.clear();
      // Local reset, local semantics: rows go without tombstones, exactly as
      // tasks do — if a sync account is connected, the next pull restores what
      // the server still holds, for records and for files alike.
      await db.attachments.clear();
    },
  );
}

export type { BackupFile } from './backupTypes';


export function createBackupPayload(
  settings: Settings,
  tasks: Task[],
  timeSessions: TimeSession[],
  reminderRecords: ReminderRecord[],
  taskEvents: TaskEvent[],
  reports: SavedReport[] = [],
): BackupFile {
  return {
    app: 'my-workday-planner',
    version: 1,
    exportedAt: new Date().toISOString(),
    settings,
    tasks,
    timeSessions,
    reminderRecords,
    taskEvents,
    reports,
  };
}

export function validateBackup(input: unknown): { ok: true; data: BackupFile } | { ok: false; error: string } {
  if (typeof input !== 'object' || input === null) return { ok: false, error: 'Backup must be a JSON object.' };
  const raw = input as Partial<BackupFile>;
  if (raw.app !== 'my-workday-planner') return { ok: false, error: 'This file was not exported by My Workday Planner.' };
  if (typeof raw.version !== 'number') return { ok: false, error: 'Backup version is missing.' };
  if (!Array.isArray(raw.tasks)) return { ok: false, error: 'Backup does not contain a task list.' };
  const invalid = raw.tasks.find(
    (task) => typeof task !== 'object' || task === null || typeof (task as Task).title !== 'string' || typeof (task as Task).id !== 'string',
  );
  if (invalid) return { ok: false, error: 'A task in the backup is malformed (missing id or title).' };
  return {
    ok: true,
    data: {
      app: 'my-workday-planner',
      version: raw.version,
      exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : new Date().toISOString(),
      settings: { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) },
      tasks: raw.tasks as Task[],
      timeSessions: Array.isArray(raw.timeSessions) ? raw.timeSessions : [],
      reminderRecords: Array.isArray(raw.reminderRecords) ? raw.reminderRecords : [],
      taskEvents: Array.isArray(raw.taskEvents) ? raw.taskEvents : [],
      // Saved daily updates are text a person wrote by hand, so they are worth
      // keeping. A malformed row is dropped rather than failing the whole file.
      reports: Array.isArray(raw.reports)
        ? (raw.reports as SavedReport[]).filter(
            (report) => typeof report?.dateISO === 'string' && typeof report?.text === 'string',
          )
        : [],
    },
  };
}

/** Merge a pulled snapshot with the latest local data under one IndexedDB
 * transaction. An edit made while the network request was in flight must not
 * be cleared by restoring a stale copy. No task or log store is cleared. */
export async function mergeCloudSnapshot(remote: BackupFile, changedAt: () => string): Promise<ReturnType<typeof mergeSnapshots>> {
  return db.transaction('rw', [db.tasks, db.timeSessions, db.reminderRecords, db.taskEvents, db.settings, db.reports], async () => {
    const [settings, tasks, sessions, reminders, events, reports] = await Promise.all([
      loadSettings(), listTasks(), listSessions(), listReminders(), listAllEvents(), listReports(),
    ]);
    const local = createBackupPayload(settings, tasks, sessions, reminders, events, reports);
    local.exportedAt = changedAt();
    const result = mergeSnapshots(local, remote);
    if (!mergeIsQuiet(result.stats)) {
      await db.tasks.bulkPut(result.merged.tasks);
      await db.timeSessions.bulkPut(result.merged.timeSessions);
      await db.reminderRecords.bulkPut(result.merged.reminderRecords);
      await db.taskEvents.bulkPut(result.merged.taskEvents);
      // Reports have one row per date, including when devices created different IDs.
      const chosen = new Map((result.merged.reports ?? []).map((row) => [row.dateISO, row.id]));
      const superseded = reports.filter((row) => chosen.has(row.dateISO) && chosen.get(row.dateISO) !== row.id);
      if (superseded.length) await db.reports.bulkDelete(superseded.map((row) => row.id));
      await db.reports.bulkPut(result.merged.reports ?? []);
      await db.settings.put({ ...DEFAULT_SETTINGS, ...result.merged.settings, id: 'app' });
    }
    return result;
  });
}

export async function restoreBackup(data: BackupFile, mode: 'merge' | 'replace'): Promise<void> {
  await db.transaction(
    'rw',
    // Array form: six tables is past what the flat (mode, table, …) signature takes.
    [db.tasks, db.timeSessions, db.reminderRecords, db.taskEvents, db.settings, db.reports],
    async () => {
      if (mode === 'replace') {
        await db.tasks.clear();
        await db.timeSessions.clear();
        await db.reminderRecords.clear();
        await db.taskEvents.clear();
        await db.reports.clear();
      }
      await db.tasks.bulkPut(data.tasks);
      if (data.timeSessions.length > 0) await db.timeSessions.bulkPut(data.timeSessions);
      if (data.reminderRecords.length > 0) await db.reminderRecords.bulkPut(data.reminderRecords);
      if (data.taskEvents.length > 0) await db.taskEvents.bulkPut(data.taskEvents);
      if (data.reports && data.reports.length > 0) {
        // A day owns one update, so a restored row takes the existing id for its
        // date instead of adding a second row the day would never show.
        const byDate = new Map([...await db.reports.toArray()].map((row) => [row.dateISO, row]));
        await db.reports.bulkPut(
          data.reports.map((report) => ({ ...report, id: byDate.get(report.dateISO)?.id ?? report.id })),
        );
      }
      await db.settings.put({ ...DEFAULT_SETTINGS, ...data.settings, id: 'app' });
    },
  );
}
