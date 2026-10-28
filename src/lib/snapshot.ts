import type { ReminderRecord, Task, TaskEvent, TimeSession } from './types';
import type { BackupFile } from './backupTypes.js';

/**
 * Three-way-free merge of two snapshots of the same planner.
 *
 * Rule, in one line: per record, the most recently edited copy wins. Tasks
 * carry `updatedAt` and are merged individually, so editing a task on the
 * phone and a different task on the laptop keeps both. Everything else is keyed
 * by `id`. Mutable sessions and reminder records use their own timestamps;
 * task events are append-mostly.
 *
 * Settings have no per-field timestamp, so the whole settings block follows the
 * snapshot that was written most recently.
 */

export interface MergeStats {
  tasksAdded: number;
  tasksUpdated: number;
  tasksKeptLocal: number;
  sessionsAdded: number;
  sessionsUpdated: number;
  remindersAdded: number;
  remindersUpdated: number;
  eventsAdded: number;
  reportsChanged: boolean;
  settings: 'local' | 'remote';
  /**
   * True when the merged result differs from what the server already holds.
   *
   * This is the gate for writing back. Without it, two synced devices bounce a
   * new `updated_at` at each other forever: each pull bumps the timestamp, the
   * other device sees a change, pulls, writes identical bytes, and so on.
   */
  needsPush: boolean;
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

/** Time sessions change in place: pause, resume and heartbeat must not be
 * overwritten by an older snapshot merely because the ID already exists. */
function mergeSessions(local: TimeSession[], remote: TimeSession[]): { rows: TimeSession[]; added: number; updated: number } {
  const byId = new Map(local.map((session) => [session.id, session]));
  let added = 0;
  let updated = 0;
  const stamp = (session: TimeSession) => [session.startedAt, session.endedAt ?? '', session.lastHeartbeatAt ?? ''].sort().at(-1) ?? '';
  const rank = (session: TimeSession) => session.state === 'completed' ? 2 : session.state === 'paused' ? 1 : 0;
  for (const incoming of remote) {
    const mine = byId.get(incoming.id);
    if (!mine) { byId.set(incoming.id, incoming); added += 1; continue; }
    const mineAt = stamp(mine);
    const incomingAt = stamp(incoming);
    if (incomingAt > mineAt || (incomingAt === mineAt &&
      (incoming.durationMs > mine.durationMs || (incoming.durationMs === mine.durationMs && rank(incoming) > rank(mine))))) {
      byId.set(incoming.id, incoming); updated += 1;
    }
  }
  return { rows: [...byId.values()], added, updated };
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

function sameRecordSet<T extends { id: string }>(left: T[], right: T[]): boolean {
  if (left.length !== right.length) return false;
  const byId = new Map(right.map((row) => [row.id, row]));
  for (const row of left) {
    const other = byId.get(row.id);
    if (!other) return false;
    if (JSON.stringify(row) !== JSON.stringify(other)) return false;
  }
  return true;
}

/** Everything the server would receive, compared against what it already has. */
function differs(merged: BackupFile, remote: BackupFile): boolean {
  if (!sameRecordSet(merged.tasks, remote.tasks)) return true;
  if (!sameRecordSet(merged.timeSessions, remote.timeSessions)) return true;
  if (!sameRecordSet(merged.reminderRecords, remote.reminderRecords)) return true;
  if (!sameRecordSet(merged.taskEvents, remote.taskEvents)) return true;
  if (!sameRecordSet(merged.reports ?? [], remote.reports ?? [])) return true;
  return JSON.stringify(merged.settings) !== JSON.stringify(remote.settings);
}

export function mergeSnapshots(local: BackupFile, remote: BackupFile): { merged: BackupFile; stats: MergeStats } {
  const tasks = mergeTasks(local.tasks, remote.tasks);
  const sessions = mergeSessions(local.timeSessions, remote.timeSessions);
  const events = mergeById<TaskEvent>(local.taskEvents, remote.taskEvents);

  // Reminders are the one place where "terminal state wins" matters more than
  // recency: a reminder dismissed on the phone should not pop back up because
  // the laptop still has it queued.
  const reminderMap = new Map<string, ReminderRecord>();
  for (const record of local.reminderRecords) reminderMap.set(record.id, record);
  let remindersAdded = 0;
  let remindersUpdated = 0;
  for (const record of remote.reminderRecords) {
    const mine = reminderMap.get(record.id);
    if (!mine) {
      reminderMap.set(record.id, record);
      remindersAdded += 1;
      continue;
    }
    if (mine.updatedAt || record.updatedAt) {
      if (newer(record.updatedAt ?? record.createdAt, mine.updatedAt ?? mine.createdAt)) {
        reminderMap.set(record.id, record); remindersUpdated += 1;
      }
      continue;
    }
    const terminal = (value: ReminderRecord) => value.status === 'done' || value.status === 'dismissed';
    if (!terminal(mine) && terminal(record)) { reminderMap.set(record.id, record); remindersUpdated += 1; }
  }

  const remoteIsNewer = newer(remote.exportedAt, local.exportedAt);
  const reports = new Map((local.reports ?? []).map((report) => [report.dateISO, report]));
  let reportsChanged = false;
  for (const report of remote.reports ?? []) {
    const mine = reports.get(report.dateISO);
    if (!mine || newer(report.updatedAt, mine.updatedAt)) {
      reports.set(report.dateISO, report);
      reportsChanged = true;
    }
  }

  const merged: BackupFile = {
    app: 'my-workday-planner',
    version: Math.max(local.version, remote.version),
    // Keep the newest *real* change time. Stamping "now" here would make every
    // snapshot look newer than the server's copy and defeat the settings rule.
    exportedAt: remoteIsNewer ? remote.exportedAt : local.exportedAt,
    settings: remoteIsNewer ? remote.settings : local.settings,
    tasks: tasks.tasks,
    timeSessions: sessions.rows,
    reminderRecords: [...reminderMap.values()],
    taskEvents: events.rows,
    reports: [...reports.values()],
  };

  return {
    merged,
    stats: {
      tasksAdded: tasks.added,
      tasksUpdated: tasks.updated,
      tasksKeptLocal: tasks.keptLocal,
      sessionsAdded: sessions.added,
      sessionsUpdated: sessions.updated,
      remindersAdded,
      remindersUpdated,
      eventsAdded: events.added,
      reportsChanged,
      settings: remoteIsNewer ? 'remote' : 'local',
      needsPush: differs(merged, remote),
    },
  };
}

/** True when a merge produced nothing worth writing back. */
export function mergeIsQuiet(stats: MergeStats): boolean {
  return (
    stats.tasksAdded === 0 &&
    stats.tasksUpdated === 0 &&
    stats.sessionsAdded === 0 &&
    stats.sessionsUpdated === 0 &&
    stats.remindersAdded === 0 &&
    stats.remindersUpdated === 0 &&
    stats.eventsAdded === 0 &&
    !stats.reportsChanged &&
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
