/**
 * Tomorrow rehearsal — fix tomorrow while today is still quiet.
 *
 * After the workday ends, the planner looks at the next working day the way
 * a person would the night before: what is due, what is planned, and whether
 * those two numbers agree. The answer is numbers plus reasons, and the
 * actions are the rescheduler the rest of the app already uses — nothing is
 * moved without a tap, and a deadline is never touched by the suggestion.
 *
 * Everything here is pure: `buildDayPlan` already knows how to plan any
 * date, so rehearsal is that, plus the demand the plan could not fit.
 */

import type { Settings, Task } from './types';
import type { LearnedDurations } from './engine';
import { buildDayPlan, estimateForTask, isWorkingDaySettings } from './engine';
import { fromISODate, toISODate } from './dates';

/** The first working day strictly after `from`'s date (default: today). */
export function nextWorkingISO(settings: Settings, from: Date = new Date()): string {
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  cursor.setDate(cursor.getDate() + 1);
  let guard = 0;
  while (!isWorkingDaySettings(settings, cursor) && guard < 60) {
    cursor.setDate(cursor.getDate() + 1);
    guard += 1;
  }
  return toISODate(cursor);
}

export interface RehearsalItem {
  task: Task;
  estimateMinutes: number;
}

export interface Rehearsal {
  /** The next working day being rehearsed. */
  date: string;
  working: boolean;
  capacityMinutes: number;
  /** Everything dated that day, at calibrated durations. */
  demandMinutes: number;
  /** Positive when the day asks for more hours than it has. */
  overflowMinutes: number;
  /** Deadlines that day with no slot left for them. */
  atRisk: RehearsalItem[];
  /** Safe to push back: dated work whose deadline is after that day. */
  suggestedDefers: RehearsalItem[];
  /** Everything dated that day, whether slotted or not. */
  dated: RehearsalItem[];
}

export function rehearsalFor(
  tasks: Task[],
  settings: Settings,
  now: Date,
  learned: LearnedDurations | null = null,
): Rehearsal | null {
  const date = nextWorkingISO(settings, now);
  const dateDate = fromISODate(date);
  const open = tasks.filter((task) => task.status !== 'completed' && task.deletedAt === null);

  const dated: RehearsalItem[] = open
    .filter((task) => task.suggestedDate === date || task.dueDate === date)
    .map((task) => ({ task, estimateMinutes: estimateForTask(task, settings, learned) }));

  if (dated.length === 0 && !isWorkingDaySettings(settings, dateDate)) return null;

  const plan = buildDayPlan(tasks, settings, dateDate, { learned, date: dateDate });
  const slotted = new Set(plan.blocks.map((block) => block.taskId));
  const demandMinutes = dated.reduce((sum, item) => sum + item.estimateMinutes, 0);
  const overflowMinutes = Math.max(0, demandMinutes - plan.capacityMinutes);

  const atRisk: RehearsalItem[] = dated.filter(
    (item) => item.task.dueDate === date && !slotted.has(item.task.id),
  );

  // Safe moves: work dated for that day whose deadline is later (or absent),
  // ordered least-urgent first — push those until the day fits again.
  const pressure = [...dated]
    .filter((item) => !atRisk.some((risk) => risk.task.id === item.task.id))
    .sort((a, b) => {
      const priority = weight(a.task) - weight(b.task);
      if (priority !== 0) return priority;
      return (a.task.dueDate ?? '9999-12-31').localeCompare(b.task.dueDate ?? '9999-12-31');
    });

  const suggestedDefers: RehearsalItem[] = [];
  let remaining = overflowMinutes;
  for (const item of pressure) {
    if (remaining <= 0) break;
    // Never suggest pushing work whose deadline is that same day — that is
    // the person's call, not a plan's.
    if (item.task.dueDate && item.task.dueDate <= date) continue;
    suggestedDefers.push(item);
    remaining -= item.estimateMinutes;
  }

  if (dated.length === 0) return null;
  return {
    date,
    working: plan.isWorkingDay,
    capacityMinutes: plan.capacityMinutes,
    demandMinutes,
    overflowMinutes,
    atRisk,
    suggestedDefers,
    dated,
  };
}

const PRIORITY_WEIGHT: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };

function weight(task: Task): number {
  return PRIORITY_WEIGHT[task.priority] ?? 1;
}
