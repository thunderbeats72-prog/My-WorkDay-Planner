/**
 * Calendar feed — export the plan as a real `.ics` file.
 *
 * The planner knows when work is meant to happen; calendars are where people
 * actually look. This writes a standards-shaped VCALENDAR from the same
 * tasks, with no server and no subscription URL — a download you import or
 * subscribe to once in Google/Outlook/Apple calendar.
 *
 * Two honesty notes baked into the format choices:
 *   · **Floating times.** Events carry local wall-clock times with no
 *     timezone attached, because that is what the planner itself uses — your
 *     workday is 09:00 wherever you are. A viewer shows them in its own
 *     timezone, which matches how the planner reads to the person who set it.
 *   · **Only dated work ships.** A task with neither a plan date nor a
 *     deadline has no moment to put on a calendar; inventing one would be a
 *     lie the calendar keeps showing.
 *
 * Everything is folded to the RFC 5545 line limit and CRLF-terminated, so
 * the strictest importers accept it too.
 */

import type { Task } from './types';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface IcsOptions {
  /** Stamp for DTSTAMP; injectable so tests are deterministic. */
  now?: Date;
  calendarName?: string;
}

/** The dated, not-deleted tasks that deserve a moment on a calendar. */
export function calendarTasks(tasks: Task[]): Task[] {
  return tasks.filter(
    (task) =>
      task.deletedAt === null &&
      ((task.suggestedDate !== null && DATE_PATTERN.test(task.suggestedDate)) ||
        (task.dueDate !== null && DATE_PATTERN.test(task.dueDate))),
  );
}

export function buildIcs(tasks: Task[], options: IcsOptions = {}): string {
  const now = options.now ?? new Date();
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//My Workday Planner//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(options.calendarName ?? 'My Workday Planner')}`,
  ];

  for (const task of calendarTasks(tasks)) {
    lines.push(...vevent(task, now));
  }

  lines.push('END:VCALENDAR');
  // RFC 5545: CRLF between every content line.
  return `${lines.join('\r\n')}\r\n`;
}

function vevent(task: Task, now: Date): string[] {
  // The plan's slot wins over the raw deadline: an event at the time you
  // intend to do the work is the event that is useful.
  const date = (task.suggestedDate && DATE_PATTERN.test(task.suggestedDate) ? task.suggestedDate : task.dueDate) as string;
  const time =
    task.suggestedDate && TIME_PATTERN.test(task.suggestedStart ?? '')
      ? (task.suggestedStart as string)
      : TIME_PATTERN.test(task.dueTime)
        ? task.dueTime
        : '';

  const completed = task.status === 'completed';
  const summary = `${completed ? '✓ ' : ''}${task.title}`;
  const description = [
    task.client ? `Client: ${task.client}` : '',
    `Category: ${task.category}`,
    `Priority: ${task.priority}`,
    task.estimatedMinutes > 0 ? `Estimate: ${task.estimatedMinutes}m` : '',
    task.dueDate && task.dueDate !== date ? `Due: ${task.dueDate}${task.dueTime ? ` ${task.dueTime}` : ''}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const out = ['BEGIN:VEVENT'];
  out.push(`UID:${task.id}@my-workday-planner`);
  out.push(`DTSTAMP:${utcStamp(now)}`);
  if (time) {
    const start = floatingStamp(date, time);
    out.push(`DTSTART:${start}`);
    out.push(`DTEND:${floatingStamp(date, addMinutes(time, Math.max(5, task.estimatedMinutes || 30)))}`);
  } else {
    // All-day: VALUE=DATE start, exclusive end = the next day.
    out.push(`DTSTART;VALUE=DATE:${date.replace(/-/g, '')}`);
    out.push(`DTEND;VALUE=DATE:${nextDay(date)}`);
  }
  out.push(`SUMMARY:${escapeText(summary)}`);
  if (description) out.push(`DESCRIPTION:${escapeText(description)}`);
  out.push(completed ? 'STATUS:COMPLETED' : 'STATUS:NEEDS-ACTION');
  out.push('END:VEVENT');
  return out;
}

/** `2026-10-24T14:30:00` — floating, no Z, no offset. */
export function floatingStamp(date: string, time: string): string {
  return `${date.replace(/-/g, '')}T${time.replace(':', '')}00`;
}

/** `20261024T085959Z` — DTSTAMP is always UTC. */
export function utcStamp(now: Date): string {
  return `${now.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;
}

export function addMinutes(time: string, minutes: number): string {
  const [hours, mins] = time.split(':').map(Number);
  const total = Math.min(24 * 60 - 1, (hours ?? 0) * 60 + (mins ?? 0) + minutes);
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function nextDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const next = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + 1));
  return next.toISOString().slice(0, 10).replace(/-/g, '');
}

/** RFC 5545 TEXT escaping: backslash, semicolon, comma, newline. */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Fold content lines longer than 75 octets: continue on the next line with a
 * single leading space. (ASCII-first: this planner's titles are text, and the
 * fold limit is measured in octets — multi-byte titles fold conservatively
 * once, which every importer accepts.)
 */
export function foldLine(line: string): string {
  if (line.length <= 74) return line;
  const parts: string[] = [];
  let rest = line;
  parts.push(rest.slice(0, 74));
  rest = rest.slice(74);
  while (rest.length > 73) {
    parts.push(` ${rest.slice(0, 73)}`);
    rest = rest.slice(73);
  }
  if (rest) parts.push(` ${rest}`);
  return parts.join('\r\n');
}

/** buildIcs with folding applied — the exported file's actual shape. */
export function buildFoldedIcs(tasks: Task[], options: IcsOptions = {}): string {
  return buildIcs(tasks, options)
    .split('\r\n')
    .map(foldLine)
    .join('\r\n');
}
