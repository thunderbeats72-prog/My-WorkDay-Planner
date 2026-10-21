import type { LearnedDurations } from './engine';
import type { Settings, Task } from './types';
import { dayOffset } from './dates';
import { isDependencyMet, orderCandidates } from './engine';

/**
 * "What should I do right now?"
 *
 * The scheduler already scores tasks. This module turns that score into a
 * single, explainable suggestion: the best open task that is actually startable
 * and, when there is little time left, one that still fits. No hidden magic —
 * every suggestion carries the reasons a person can check.
 */

export type FocusKind = 'resume' | 'overdue' | 'today' | 'quick-win' | 'steady';

export interface FocusOption {
  task: Task;
  estimateMinutes: number;
  score: number;
}

export interface FocusPick {
  task: Task;
  estimateMinutes: number;
  score: number;
  kind: FocusKind;
  reason: string;
  /** True when the estimate fits the time left in the workday. */
  fits: boolean;
  options: FocusOption[];
  alternatives: FocusOption[];
}

export interface FocusOptions {
  learned?: LearnedDurations | null;
  freeMinutes?: number;
  runningTaskId?: string | null;
  /** Lets the UI ask for “another one” without reordering the whole board. */
  skip?: number;
}

function toOption(candidate: { task: Task; estimateMinutes: number; score: number }): FocusOption {
  return { task: candidate.task, estimateMinutes: candidate.estimateMinutes, score: candidate.score };
}

function dueReason(task: Task, now: Date): string | null {
  if (!task.dueDate) return null;
  const offset = dayOffset(task.dueDate, now);
  const time = task.dueTime ? ` at ${task.dueTime}` : '';
  if (offset < 0) {
    const days = Math.abs(offset);
    return `Overdue by ${days} day${days === 1 ? '' : 's'}`;
  }
  if (offset === 0) return `Due today${time}`;
  if (offset === 1) return `Due tomorrow${time}`;
  if (offset <= 7) return `Due in ${offset} days`;
  return null;
}

function buildReason(task: Task, now: Date, estimateMinutes: number): { reason: string; kind: FocusKind } {
  const bits: string[] = [];
  const due = dueReason(task, now);
  const overdue = task.dueDate !== null && dayOffset(task.dueDate, now) < 0;
  const dueToday = task.dueDate !== null && dayOffset(task.dueDate, now) === 0;

  if (due) bits.push(due);
  if (task.deferrals > 0) bits.push(`Deferred ${task.deferrals}×`);
  if (estimateMinutes <= 15 && !overdue) bits.push('Quick win');
  if (bits.length === 0) {
    bits.push(task.priority === 'critical' || task.priority === 'high' ? 'Highest priority open task' : 'Next in line');
  }

  const kind: FocusKind = overdue ? 'overdue' : dueToday ? 'today' : estimateMinutes <= 15 ? 'quick-win' : 'steady';
  return { reason: bits.slice(0, 3).join(' · '), kind };
}

export function suggestFocus(
  tasks: Task[],
  settings: Settings,
  now: Date = new Date(),
  options: FocusOptions = {},
): FocusPick | null {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const open = tasks.filter((task) => task.deletedAt === null && task.status !== 'completed');
  if (open.length === 0) return null;

  const scored = orderCandidates(open, settings, now, options.learned ?? null);
  const startable = scored.filter((candidate) => !candidate.task.blocked && isDependencyMet(candidate.task, byId));
  if (startable.length === 0) return null;

  const fits = (candidate: { estimateMinutes: number }) =>
    typeof options.freeMinutes !== 'number' || options.freeMinutes <= 0 || candidate.estimateMinutes <= options.freeMinutes;

  const fitting = startable.filter(fits);
  const pool = fitting.length > 0 ? fitting : startable;

  // A running timer always wins: finishing beats starting something new.
  const running = options.runningTaskId
    ? startable.find((candidate) => candidate.task.id === options.runningTaskId)
    : undefined;

  const skip = Math.max(0, Math.floor(options.skip ?? 0));
  const chosen = running ?? pool[skip % pool.length];

  const fitsFreeTime = typeof options.freeMinutes === 'number' && options.freeMinutes > 0
    ? chosen.estimateMinutes <= options.freeMinutes
    : false;
  const reasons = buildReason(chosen.task, now, chosen.estimateMinutes);

  const alternatives = pool
    .filter((candidate) => candidate.task.id !== chosen.task.id)
    .slice(0, 2)
    .map(toOption);

  return {
    task: chosen.task,
    estimateMinutes: chosen.estimateMinutes,
    score: chosen.score,
    kind: running ? 'resume' : reasons.kind,
    reason: running ? 'A timer is already running on this task' : reasons.reason,
    fits: fitsFreeTime,
    options: pool.map(toOption),
    alternatives,
  };
}
