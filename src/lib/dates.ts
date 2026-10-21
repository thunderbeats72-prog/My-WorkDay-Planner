import {
  addDays,
  differenceInCalendarDays,
  differenceInMinutes,
  format,
  isSameDay,
  parse,
  startOfDay,
  startOfWeek,
} from 'date-fns';
import type { Settings, Task } from './types';

export const MINUTES_IN_DAY = 24 * 60;

export function toISODate(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

export function fromISODate(iso: string): Date {
  return startOfDay(parse(iso, 'yyyy-MM-dd', new Date()));
}

export function todayISO(now: Date = new Date()): string {
  return toISODate(now);
}

export function combineDateTime(dateISO: string, time: string): Date {
  const minutes = parseTimeToMinutes(time);
  const base = fromISODate(dateISO);
  base.setMinutes(minutes);
  return base;
}

export function parseTimeToMinutes(value: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return 0;
  const hours = Math.min(23, Math.max(0, Number(match[1])));
  const minutes = Math.min(59, Math.max(0, Number(match[2])));
  return hours * 60 + minutes;
}

export function minutesToTime(minutes: number): string {
  const clamped = Math.max(0, Math.min(MINUTES_IN_DAY - 1, Math.round(minutes)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function formatDuration(minutes: number): string {
  const rounded = Math.max(0, Math.round(minutes));
  if (rounded < 60) return `${rounded}m`;
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function formatSecondsLabel(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function formatDateShort(iso: string): string {
  return format(fromISODate(iso), 'd MMM');
}

export function formatDateLong(iso: string): string {
  return format(fromISODate(iso), 'EEE d MMM yyyy');
}

export function formatWeekday(iso: string): string {
  return format(fromISODate(iso), 'EEE');
}

export function formatDayNumber(iso: string): string {
  return format(fromISODate(iso), 'd');
}

export function formatMonthShort(iso: string): string {
  return format(fromISODate(iso), 'MMM');
}

export function formatClock(date: Date): string {
  return format(date, 'HH:mm');
}

export function formatTimeAgo(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';
  const diff = Math.max(0, differenceInMinutes(now, then));
  if (diff < 1) return 'just now';
  if (diff < 60) return `${diff}m ago`;
  if (diff < 60 * 24) return `${Math.floor(diff / 60)}h ago`;
  return `${Math.floor(diff / (60 * 24))}d ago`;
}

export function dayOffset(iso: string, now: Date = new Date()): number {
  return differenceInCalendarDays(fromISODate(iso), startOfDay(now));
}

export function relativeDayLabel(iso: string, now: Date = new Date()): string {
  const offset = dayOffset(iso, now);
  if (offset === 0) return 'Today';
  if (offset === 1) return 'Tomorrow';
  if (offset === -1) return 'Yesterday';
  return format(fromISODate(iso), 'EEE d MMM');
}

export function dueLabel(task: Task, now: Date = new Date()): string {
  if (!task.dueDate) return 'No deadline';
  const offset = dayOffset(task.dueDate, now);
  if (offset < 0) return `Overdue by ${Math.abs(offset)}d`;
  if (offset === 0) return task.dueTime ? `Due today · ${task.dueTime}` : 'Due today';
  if (offset === 1) return 'Due tomorrow';
  return `Due ${format(fromISODate(task.dueDate), 'EEE d MMM')}`;
}

export function dueTone(task: Task, now: Date = new Date()): 'danger' | 'warning' | 'neutral' {
  if (!task.dueDate) return 'neutral';
  const offset = dayOffset(task.dueDate, now);
  if (offset < 0) return 'danger';
  if (offset === 0) return 'warning';
  return 'neutral';
}

export function isTaskOverdue(task: Task, now: Date = new Date()): boolean {
  return task.dueDate !== null && dayOffset(task.dueDate, now) < 0 && task.status !== 'completed' && task.deletedAt === null;
}

export function taskDueAt(task: Task): Date | null {
  if (!task.dueDate) return null;
  return combineDateTime(task.dueDate, task.dueTime || '17:00');
}

export function startOfWeekMonday(date: Date = new Date()): Date {
  return startOfWeek(date, { weekStartsOn: 1 });
}

export function weekDays(anchor: Date = new Date()): Date[] {
  const start = startOfWeekMonday(anchor);
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

export function weekLabel(anchor: Date): string {
  const start = startOfWeekMonday(anchor);
  const end = addDays(start, 6);
  return `${format(start, 'd MMM')} – ${format(end, 'd MMM yyyy')}`;
}

export function sameISODate(a: string, b: string): boolean {
  return a === b;
}

export function isSameDate(a: Date, b: Date): boolean {
  return isSameDay(a, b);
}

export function daysFromNow(days: number, now: Date = new Date()): string {
  return toISODate(addDays(startOfDay(now), days));
}

export function nextWeekdayISO(targetDay: number, now: Date = new Date()): string {
  const base = startOfDay(now);
  for (let offset = 1; offset <= 7; offset += 1) {
    const candidate = addDays(base, offset);
    if (candidate.getDay() === targetDay) return toISODate(candidate);
  }
  return toISODate(addDays(base, 1));
}

export function isQuietNow(settings: Settings, now: Date = new Date()): boolean {
  if (!settings.quietHoursEnabled) return false;
  const current = now.getHours() * 60 + now.getMinutes();
  const start = parseTimeToMinutes(settings.quietStart);
  const end = parseTimeToMinutes(settings.quietEnd);
  if (start === end) return false;
  if (start < end) return current >= start && current < end;
  return current >= start || current < end;
}

export function greetingForHour(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export function humanDateRange(startISO: string, endISO: string): string {
  return `${formatDateShort(startISO)} – ${formatDateShort(endISO)}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function percent(part: number, total: number): number {
  if (total <= 0) return 0;
  return clamp(Math.round((part / total) * 100), 0, 100);
}
