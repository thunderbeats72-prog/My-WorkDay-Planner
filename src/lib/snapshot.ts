import type { ReminderRecord, Task, TaskEvent, TimeSession } from './types';
import type { BackupFile } from './db';

/**
 * Three-way-free merge of two snapshots of the same planner.
 *
 * Rule, in one line: per record, the most recently edited copy wins. Tasks
 * carry `updatedAt` and are merged individually, so editing a task on the
 * phone and a different task on the laptop keeps both. Everything else is keyed
 * by `id` and only ever grows, which is the safe direction for an append-mostly
 * log of sessions, reminders and events.
 *
 * Settings have no per-field timestamp, so the whole settings block follows the
 * snapshot that was written most recently.
 */

export interface MergeStats {
  tasksAdded: number;
  tasksUpdated: number;
  tasksKeptLocal: number;
  sessionsAdded: number;
  remindersAdded: number;
  eventsAdded: number;
  settings: 'local' | 'remote';
}

function newer(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? '') > (b ?? '');
}

function mergeById<T extends { id: string }>(local: T[], remote: T[]): { rows: T[]; added: number } {
  const byId = new Map<string, T>();
  for (const row of local) byId.set(row.id, row);
  let added = 0;
  for (const row of remote) {
    if (!byId.has(row.id)) added += 1;
    byId.set(row.id, row);
  }
  return { rows: [...byId.values()], added };
}

export function mergeTasks(local: Task[], remote: Task[]): { tasks: Task[]; added: number; updated: number; keptLocal: number } {
  const byId = new Map<string, Task>();
  for (const task of local) byId.set(task.id, task);

  let added = 0;
  let updated = 0;
  let keptLocal = 0;

  for (const incoming of remote) {
    const mine = byId.get(incoming.id);
    if (!mine) {
      byId.set(incoming.id, incoming);
      added += 1;
      continue;
    }
    if (newer(incoming.updatedAt, mine.updatedAt)) {
      byId.set(incoming.id, incoming);
      updated += 1;
    } else if (newer(mine.updatedAt, incoming.updatedAt)) {
      // Only a genuine conflict is worth reporting: identical timestamps are
      // two devices agreeing, not a choice the user needs to hear about.
      keptLocal += 1;
    }
  }

  return { tasks: [...byId.values()], added, updated, keptLocal };
}

export function mergeSnapshots(local: BackupFile, remote: BackupFile): { merged: BackupFile; stats: MergeStats } {
  const tasks = mergeTasks(local.tasks, remote.tasks);
  const sessions = mergeById<TimeSession>(local.timeSessions, remote.timeSessions);
  const events = mergeById<TaskEvent>(local.taskEvents, remote.taskEvents);

  // Reminders are the one place where "terminal state wins" matters more than
  // recency: a reminder dismissed on the phone should not pop back up because
  // the laptop still has it queued.
  const reminderMap = new Map<string, ReminderRecord>();
  for (const record of local.reminderRecords) reminderMap.set(record.id, record);
  let remindersAdded = 0;
  for (const record of remote.reminderRecords) {
    const mine = reminderMap.get(record.id);
    if (!mine) {
      reminderMap.set(record.id, record);
      remindersAdded += 1;
      continue;
    }
    const terminal = (value: ReminderRecord) => value.status === 'done' || value.status === 'dismissed';
    if (!terminal(mine) && terminal(record)) reminderMap.set(record.id, record);
  }

  const remoteIsNewer = newer(remote.exportedAt, local.exportedAt);

  return {
    merged: {
      app: 'my-workday-planner',
      version: Math.max(local.version, remote.version),
      exportedAt: new Date().toISOString(),
      settings: remoteIsNewer ? remote.settings : local.settings,
      tasks: tasks.tasks,
      timeSessions: sessions.rows,
      reminderRecords: [...reminderMap.values()],
      taskEvents: events.rows,
    },
    stats: {
      tasksAdded: tasks.added,
      tasksUpdated: tasks.updated,
      tasksKeptLocal: tasks.keptLocal,
      sessionsAdded: sessions.added,
      remindersAdded,
      eventsAdded: events.added,
      settings: remoteIsNewer ? 'remote' : 'local',
    },
  };
}

/** True when a merge produced nothing worth writing back. */
export function mergeIsQuiet(stats: MergeStats): boolean {
  return (
    stats.tasksAdded === 0 &&
    stats.tasksUpdated === 0 &&
    stats.sessionsAdded === 0 &&
    stats.remindersAdded === 0 &&
    stats.eventsAdded === 0 &&
    stats.settings === 'local'
  );
}

export function describeMerge(stats: MergeStats): string {
  const parts: string[] = [];
  if (stats.tasksAdded > 0) parts.push(`${stats.tasksAdded} new task${stats.tasksAdded === 1 ? '' : 's'}`);
  if (stats.tasksUpdated > 0) parts.push(`${stats.tasksUpdated} updated`);
  if (stats.tasksKeptLocal > 0) parts.push(`${stats.tasksKeptLocal} kept local`);
  if (parts.length === 0) return 'Nothing new — both devices already match.';
  return parts.join(' · ');
}
