import { addDays, startOfDay } from 'date-fns';
import { formatDateShort, toISODate } from './dates';
import type { Category, Task, TimeSession } from './types';
import { CATEGORIES, CATEGORY_ORDER } from './types';
import { collectActualMinutes } from './ml';

export interface CategoryBreakdown {
  category: Category;
  label: string;
  completed: number;
  estimatedMinutes: number;
  actualMinutes: number;
}

export interface DayBucket {
  dateISO: string;
  label: string;
  completed: number;
  focusMinutes: number;
}

export interface WeeklyReport {
  fromISO: string;
  toISO: string;
  rangeLabel: string;
  createdCount: number;
  completedCount: number;
  openCount: number;
  overdueCount: number;
  estimatedMinutes: number;
  actualMinutes: number;
  followUps: number;
  proposals: number;
  sessionsCount: number;
  focusMinutes: number;
  byCategory: CategoryBreakdown[];
  byDay: DayBucket[];
  hasData: boolean;
}

function withinWindow(iso: string | null, fromMs: number, toMs: number): boolean {
  if (!iso) return false;
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return false;
  return time >= fromMs && time <= toMs;
}

export function buildWeeklyReport(tasks: Task[], sessions: TimeSession[], now: Date = new Date()): WeeklyReport {
  const end = startOfDay(now);
  end.setHours(23, 59, 59, 999);
  const start = startOfDay(addDays(end, -6));
  const fromMs = start.getTime();
  const toMs = end.getTime();
  const dateISO = toISODate(now);

  const liveTasks = tasks.filter((task) => task.deletedAt === null);
  const completedInWindow = liveTasks.filter(
    (task) => task.status === 'completed' && withinWindow(task.completedAt, fromMs, toMs),
  );
  const createdInWindow = liveTasks.filter((task) => withinWindow(task.createdAt, fromMs, toMs));
  const openTasks = liveTasks.filter((task) => task.status !== 'completed');
  const overdue = openTasks.filter(
    (task) => task.dueDate !== null && task.dueDate < dateISO,
  );

  const actuals = collectActualMinutes(liveTasks, sessions);
  const windowSessions = sessions.filter((session) => withinWindow(session.startedAt, fromMs, toMs));
  const focusMinutes = Math.round(
    windowSessions.reduce((sum, session) => sum + Math.max(0, session.durationMs), 0) / 60000,
  );

  const byCategory: CategoryBreakdown[] = CATEGORY_ORDER.map((category) => {
    const categoryTasks = completedInWindow.filter((task) => task.category === category);
    const estimated = categoryTasks.reduce((sum, task) => sum + task.estimatedMinutes, 0);
    const actual = categoryTasks.reduce((sum, task) => sum + (actuals.get(task.id) ?? 0), 0);
    return {
      category,
      label: CATEGORIES[category].label,
      completed: categoryTasks.length,
      estimatedMinutes: Math.round(estimated),
      actualMinutes: Math.round(actual),
    };
  }).filter((entry) => entry.completed > 0);

  const byDay: DayBucket[] = [];
  for (let index = 0; index < 7; index += 1) {
    const day = addDays(start, index);
    const iso = toISODate(day);
    byDay.push({
      dateISO: iso,
      label: formatDateShort(iso),
      completed: completedInWindow.filter((task) => task.completedAt && toISODate(new Date(task.completedAt)) === iso).length,
      focusMinutes: Math.round(
        windowSessions
          .filter((session) => toISODate(new Date(session.startedAt)) === iso)
          .reduce((sum, session) => sum + Math.max(0, session.durationMs), 0) / 60000,
      ),
    });
  }

  const estimatedMinutes = completedInWindow.reduce((sum, task) => sum + task.estimatedMinutes, 0);
  const actualMinutes = completedInWindow.reduce((sum, task) => sum + (actuals.get(task.id) ?? 0), 0);

  return {
    fromISO: toISODate(start),
    toISO: toISODate(now),
    rangeLabel: `${formatDateShort(toISODate(start))} – ${formatDateShort(toISODate(now))}`,
    createdCount: createdInWindow.length,
    completedCount: completedInWindow.length,
    openCount: openTasks.length,
    overdueCount: overdue.length,
    estimatedMinutes: Math.round(estimatedMinutes),
    actualMinutes: Math.round(actualMinutes),
    followUps: completedInWindow.filter((task) => task.category === 'follow_up').length,
    proposals: completedInWindow.filter((task) => task.category === 'proposal').length,
    sessionsCount: windowSessions.length,
    focusMinutes,
    byCategory,
    byDay,
    hasData: completedInWindow.length > 0 || windowSessions.length > 0,
  };
}

function csvCell(value: string | number | null): string {
  const text = value === null ? '' : String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function tasksToCsv(tasks: Task[]): string {
  const header = [
    'Title',
    'Client',
    'Category',
    'Priority',
    'Status',
    'Estimated minutes',
    'Actual minutes',
    'Due date',
    'Due time',
    'Created',
    'Completed',
    'Blocked',
  ];
  const rows = tasks
    .filter((task) => task.deletedAt === null)
    .map((task) => [
      csvCell(task.title),
      csvCell(task.client),
      csvCell(CATEGORIES[task.category].label),
      csvCell(task.priority),
      csvCell(task.status),
      csvCell(task.estimatedMinutes),
      csvCell(Math.round(task.actualMinutes)),
      csvCell(task.dueDate),
      csvCell(task.dueTime),
      csvCell(task.createdAt),
      csvCell(task.completedAt),
      csvCell(task.blocked ? 'yes' : 'no'),
    ]);
  return [header.join(','), ...rows.map((row) => row.join(','))].join('\n');
}

export function weeklyReportToText(report: WeeklyReport): string {
  const lines = [
    `Weekly report ${report.rangeLabel}`,
    `Completed: ${report.completedCount} · Created: ${report.createdCount} · Open: ${report.openCount} · Overdue: ${report.overdueCount}`,
    `Estimated: ${report.estimatedMinutes}m · Actual: ${report.actualMinutes}m · Tracked: ${report.sessionsCount} sessions`,
    `Follow-ups completed: ${report.followUps} · Proposals completed: ${report.proposals}`,
  ];
  for (const entry of report.byCategory) {
    lines.push(`${entry.label}: ${entry.completed} done, ${entry.estimatedMinutes}m est vs ${entry.actualMinutes}m actual`);
  }
  return lines.join('\n');
}
