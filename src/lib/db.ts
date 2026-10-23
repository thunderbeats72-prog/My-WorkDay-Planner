import Dexie, { type Table } from 'dexie';
import type { ReminderRecord, Settings, Task, TaskEvent, TimeSession } from './types';
import type { AttachmentRecord } from './attachments';
import { DEFAULT_SETTINGS } from './types';

export const DB_NAME = 'bd-command-center';

export class PlannerDB extends Dexie {
  tasks!: Table<Task, string>;
  timeSessions!: Table<TimeSession, string>;
  reminderRecords!: Table<ReminderRecord, string>;
  taskEvents!: Table<TaskEvent, string>;
  settings!: Table<Settings, string>;
  attachments!: Table<AttachmentRecord, string>;

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

export async function clearAllData(): Promise<void> {
  // The array form of Dexie's transaction: seven tables is one past what the
  // flat (mode, table, table, …) signature accepts.
  await db.transaction(
    'rw',
    [db.tasks, db.timeSessions, db.reminderRecords, db.taskEvents, db.settings, db.attachments],
    async () => {
      await db.tasks.clear();
      await db.timeSessions.clear();
      await db.reminderRecords.clear();
      await db.taskEvents.clear();
      await db.settings.clear();
      // Local reset, local semantics: rows go without tombstones, exactly as
      // tasks do — if a sync account is connected, the next pull restores what
      // the server still holds, for records and for files alike.
      await db.attachments.clear();
    },
  );
}

export interface BackupFile {
  app: string;
  version: number;
  exportedAt: string;
  settings: Settings;
  tasks: Task[];
  timeSessions: TimeSession[];
  reminderRecords: ReminderRecord[];
  taskEvents: TaskEvent[];
}

export function createBackupPayload(
  settings: Settings,
  tasks: Task[],
  timeSessions: TimeSession[],
  reminderRecords: ReminderRecord[],
  taskEvents: TaskEvent[],
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
    },
  };
}

export async function restoreBackup(data: BackupFile, mode: 'merge' | 'replace'): Promise<void> {
  await db.transaction(
    'rw',
    db.tasks,
    db.timeSessions,
    db.reminderRecords,
    db.taskEvents,
    db.settings,
    async () => {
      if (mode === 'replace') {
        await db.tasks.clear();
        await db.timeSessions.clear();
        await db.reminderRecords.clear();
        await db.taskEvents.clear();
      }
      await db.tasks.bulkPut(data.tasks);
      if (data.timeSessions.length > 0) await db.timeSessions.bulkPut(data.timeSessions);
      if (data.reminderRecords.length > 0) await db.reminderRecords.bulkPut(data.reminderRecords);
      if (data.taskEvents.length > 0) await db.taskEvents.bulkPut(data.taskEvents);
      await db.settings.put({ ...DEFAULT_SETTINGS, ...data.settings, id: 'app' });
    },
  );
}
