/**
 * Pure, shared reminder rules. The server runs these against the *existing*
 * synced planner snapshot; no second copy of task data is maintained.
 *
 * A cron invocation considers only the most relevant current stage. This both
 * catches up after an outage and avoids replaying every missed nudge. Keys are
 * deterministic and include the deadline and reopen cycle for idempotency.
 */
import { Temporal } from '@js-temporal/polyfill';
import type { ReminderRecord, Settings, Task } from './types.js';

export type ReminderCategory = 'upcoming' | 'due' | 'overdue' | 'completed' | 'summary' | 'test';
export interface ReminderCandidate {
  key: string;
  taskId: string | null;
  category: ReminderCategory;
  title: string;
  body: string;
  dueAt: string | null;
  deadlineKey: string | null;
  silent: boolean;
}
export interface ServerSnooze {
  taskId: string;
  deadlineKey: string;
  until: string;
}
export interface ReminderSnapshot {
  tasks: Task[];
  settings: Settings;
  reminderRecords?: ReminderRecord[];
}

const MINUTE = 60_000;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function validTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone }).format();
    return Boolean(zone);
  } catch {
    return false;
  }
}

export function reminderZone(settings: Partial<Settings>): string {
  const zone = settings.reminderTimeZone || 'UTC';
  return validTimeZone(zone) ? zone : 'UTC';
}

/** Interpret a wall-clock date in the chosen zone, including DST gaps/folds. */
export function wallTimeToInstant(date: string, time: string, zone: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !timePattern.test(time) || !validTimeZone(zone)) return null;
  try {
    const local = Temporal.PlainDate.from(date).toPlainDateTime(Temporal.PlainTime.from(time));
    // Compatible: a nonexistent spring-forward time moves forward by the gap;
    // an ambiguous fall-back time chooses the earlier occurrence, like JS Date.
    return new Date(local.toZonedDateTime(zone, { disambiguation: 'compatible' }).epochMilliseconds);
  } catch {
    return null;
  }
}

/** Keep task edits ordered even when two clicks share a millisecond or a
 * notification action used a slightly newer server timestamp. */
export function prepareReminderTaskEdit(task: Task, before?: Task, now = Date.now()): Task {
  if (!before) return task;
  const previous = Date.parse(before.updatedAt);
  const incoming = Date.parse(task.updatedAt);
  const adjusted = Number.isFinite(previous) && (!Number.isFinite(incoming) || incoming <= previous)
    ? { ...task, updatedAt: new Date(Math.max(now, previous + 1)).toISOString() } : task;
  if (before.dueDate !== adjusted.dueDate || before.dueTime !== adjusted.dueTime ||
      (before.status === 'completed' && adjusted.status !== 'completed')) {
    return { ...adjusted, reminderCycle: adjusted.updatedAt };
  }
  return adjusted;
}

export function nextReminderRecordTimestamp(task: Task, previous?: ReminderRecord, now = Date.now()): string {
  const cycle = Date.parse(task.reminderCycle ?? '');
  const prior = Date.parse(previous?.updatedAt ?? previous?.createdAt ?? '');
  return new Date(Math.max(now, Number.isFinite(cycle) ? cycle + 1 : 0, Number.isFinite(prior) ? prior + 1 : 0)).toISOString();
}

export function taskDeadline(task: Task, settings: Partial<Settings>): Date | null {
  if (!task.dueDate) return null;
  return wallTimeToInstant(task.dueDate, task.dueTime || settings.digestTime || '09:30', reminderZone(settings));
}

export function deadlineKey(task: Task, settings: Partial<Settings>): string | null {
  const due = taskDeadline(task, settings);
  if (!due) return null;
  return JSON.stringify([due.toISOString(), task.reminderCycle || task.createdAt || 'original']);
}

function localNow(now: Date, zone: string) {
  return Temporal.Instant.fromEpochMilliseconds(now.getTime()).toZonedDateTimeISO(zone);
}

export function quietAt(settings: Partial<Settings>, now: Date): boolean {
  if (!settings.quietHoursEnabled) return false;
  const start = settings.quietStart || '20:00';
  const end = settings.quietEnd || '08:00';
  if (!timePattern.test(start) || !timePattern.test(end) || start === end) return false;
  const current = localNow(now, reminderZone(settings)).toPlainTime().toString().slice(0, 5);
  return start < end ? current >= start && current < end : current >= start || current < end;
}

function isOpen(task: Task): boolean {
  const extra = task as Task & { archivedAt?: string | null; archived?: boolean };
  return task.status !== 'completed' && !task.deletedAt && !extra.archivedAt && !extra.archived;
}

function eventKey(task: Task, deadline: string, stage: string): string {
  return JSON.stringify(['task', task.id, deadline, stage]);
}

function makeCandidate(
  task: Task,
  settings: Partial<Settings>,
  now: Date,
  snoozes: ServerSnooze[],
  reminders: ReminderRecord[],
): ReminderCandidate | null {
  const due = taskDeadline(task, settings);
  const deadline = deadlineKey(task, settings);
  if (!due || !deadline) return null;
  const dueAt = due.toISOString();
  const legacy = reminders.find((row) => row.taskId === task.id && row.dueAt === dueAt);
  // A dismissal belongs to the current deadline only. Reopening creates a new
  // cycle; the UI clears its local dismissal when it reopens the task.
  const legacyIsCurrent = Boolean(legacy && (!task.reminderCycle || task.reminderCycle <= (legacy.updatedAt || legacy.createdAt)));
  if (legacyIsCurrent && (legacy?.status === 'dismissed' || legacy?.status === 'done')) return null;
  const saved = snoozes.find((row) => row.taskId === task.id && row.deadlineKey === deadline);
  const untilValue = saved?.until || (legacyIsCurrent ? legacy?.snoozedUntil : null) || null;
  const until = untilValue ? Date.parse(untilValue) : NaN;
  const nowMs = now.getTime();
  if (Number.isFinite(until) && nowMs < until) return null;

  const elapsed = nowMs - due.getTime();
  const repeat = Number.isFinite(settings.reminderRepeatMinutes)
    ? Math.max(0, Math.min(480, Number(settings.reminderRepeatMinutes)))
    : 30;
  let stage: string;
  let category: ReminderCategory;
  let title: string;
  let body: string;
  const taskTitle = (task.title || 'Untitled task').slice(0, 180);

  const resumed = Number.isFinite(until) && until <= nowMs;
  const resumedAfterDue = resumed && until >= due.getTime();
  if (elapsed < 0) {
    const remaining = -elapsed;
    let upcomingStage: string | null = null;
    let upcomingStart = 0;
    if (settings.reminderFiveMinutes !== false && remaining <= 5 * MINUTE) {
      upcomingStage = 'before:5';
      upcomingStart = due.getTime() - 5 * MINUTE;
    } else if (settings.reminderThirtyMinutes !== false && remaining <= 30 * MINUTE) {
      upcomingStage = 'before:30';
      upcomingStart = due.getTime() - 30 * MINUTE;
    }
    // An expired snooze produces one prompt until the next configured stage.
    // A snooze that ends before the 30/5-minute boundary must not suppress that
    // later stage (or the due-now event).
    const showResumed = resumed && (!upcomingStage || until > upcomingStart);
    if (showResumed) {
      stage = `snooze:${new Date(until).toISOString()}`;
      category = 'upcoming';
      title = 'Snoozed task';
      body = `“${taskTitle}” is still incomplete. Please update its status.`;
    } else {
      if (!upcomingStage) return null;
      stage = upcomingStage;
      category = 'upcoming';
      title = 'Upcoming task';
      const minutes = Math.max(1, Math.ceil(remaining / MINUTE));
      body = `Your task “${taskTitle}” is due in ${minutes} minute${minutes === 1 ? '' : 's'}.`;
    }
  } else if (elapsed < MINUTE && !resumedAfterDue) {
    stage = 'due';
    category = 'due';
    title = 'Task due now';
    body = `“${taskTitle}” is due now.`;
  } else {
    category = 'overdue';
    title = 'Overdue task';
    body = `“${taskTitle}” is still incomplete. Please update its status.`;
    if (resumedAfterDue) {
      if (repeat === 0 || nowMs - until < repeat * MINUTE) {
        // With repeats off, keep this one key eligible after an outage or
        // quiet hours; the delivery ledger still prevents repeated banners.
        stage = `snooze:${new Date(until).toISOString()}`;
      } else {
        stage = `snooze:${new Date(until).toISOString()}:repeat:${Math.floor((nowMs - until) / (repeat * MINUTE))}`;
      }
    } else {
      const slot = repeat > 0 ? Math.floor(elapsed / (repeat * MINUTE)) : 0;
      stage = `overdue:${slot}`;
    }
  }
  if (task.client) body = `${task.client.slice(0, 80)} · ${body}`;
  return {
    key: eventKey(task, deadline, stage), taskId: task.id, category, title, body,
    dueAt, deadlineKey: deadline, silent: settings.notificationSound === false,
  };
}

/** Current logical notifications, never a backlog of stale slots. */
export function reminderCandidates(snapshot: ReminderSnapshot, now: Date, snoozes: ServerSnooze[] = []): ReminderCandidate[] {
  const { settings } = snapshot;
  if (!settings?.notificationsEnabled || !Array.isArray(snapshot.tasks) || quietAt(settings, now)) return [];
  const tasks = snapshot.tasks.filter((task) => task && typeof task.id === 'string');
  const open = tasks.filter(isOpen);
  const reminders = Array.isArray(snapshot.reminderRecords) ? snapshot.reminderRecords : [];
  const candidates = open.map((task) => makeCandidate(task, settings, now, snoozes, reminders))
    .filter((item): item is ReminderCandidate => item !== null);

  // Only recent completion transitions are confirmations, not a replay of an
  // imported history. Reopens/reschedules immediately make them ineligible.
  for (const task of tasks) {
    if (task.deletedAt || task.status !== 'completed' || !task.completedAt) continue;
    const at = Date.parse(task.completedAt);
    if (!Number.isFinite(at) || at > now.getTime() || now.getTime() - at > 10 * MINUTE) continue;
    candidates.push({
      key: JSON.stringify(['completed', task.id, task.completedAt]), taskId: task.id,
      category: 'completed', title: 'Task completed',
      body: `“${(task.title || 'Untitled task').slice(0, 180)}” is complete. Great work!`,
      dueAt: null, deadlineKey: null, silent: settings.notificationSound === false,
    });
  }

  if (settings.dailyDigestEnabled !== false && open.length > 0) {
    const zone = reminderZone(settings);
    const local = localNow(now, zone);
    const date = local.toPlainDate().toString();
    const digestTime = timePattern.test(settings.digestTime || '') ? settings.digestTime : '09:30';
    const digestAt = wallTimeToInstant(date, digestTime, zone);
    if (digestAt && now.getTime() >= digestAt.getTime()) {
      const overdue = open.filter((task) => {
        const due = taskDeadline(task, settings);
        return due && due.getTime() < now.getTime();
      });
      const undated = open.filter((task) => !task.dueDate);
      const named = undated.slice(0, 2).map((task) => `“${(task.title || 'Untitled task').slice(0, 45)}”`).join(', ');
      const suffix = undated.length ? `, ${undated.length} with no date (without a due date${named ? `: ${named}` : ''})` : '';
      candidates.push({
        key: JSON.stringify(['summary', date, zone]), taskId: null, category: 'summary',
        title: 'Daily pending-task summary',
        body: `${open.length} task${open.length === 1 ? '' : 's'} still open — ${overdue.length} overdue${suffix}.`,
        dueAt: null, deadlineKey: null, silent: settings.notificationSound === false,
      });
    }
  }
  return candidates;
}
