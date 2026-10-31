import { todayISO, toISODate } from './dates';
import type { Task } from './types';

export interface DayMomentum {
  /** Tasks completed today, regardless of their original deadline. */
  completed: number;
  /** Open tasks whose deadline is today. */
  remaining: number;
  /** Completed-today work plus work still due today. */
  total: number;
  /** Rounded completion percentage; zero when there is no daily work. */
  percent: number;
}

function isOnDay(iso: string, day: string): boolean {
  const date = new Date(iso);
  return !Number.isNaN(date.getTime()) && toISODate(date) === day;
}

/**
 * A small, honest measure of today's follow-through.
 *
 * This is deliberately not a productivity score. It compares work actually
 * completed today with the work still dated today. Overdue tasks remain
 * visible separately instead of being silently folded into the denominator,
 * and deleted tasks never move the number.
 */
export function buildDayMomentum(tasks: Task[], now: Date = new Date()): DayMomentum {
  const day = todayISO(now);
  let completed = 0;
  let remaining = 0;

  for (const task of tasks) {
    if (task.deletedAt !== null) continue;
    if (task.status === 'completed') {
      if (task.completedAt && isOnDay(task.completedAt, day)) completed += 1;
    } else if (task.dueDate === day) {
      remaining += 1;
    }
  }

  const total = completed + remaining;
  return {
    completed,
    remaining,
    total,
    percent: total === 0 ? 0 : Math.round((completed / total) * 100),
  };
}
