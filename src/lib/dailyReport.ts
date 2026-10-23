/**
 * Daily report — the end-of-day update, built from what is actually saved.
 *
 * The planner already knows every task, every status and every note. This
 * module turns that into the paragraph a person pastes into their work group:
 * completed titles struck through, pending titles left alone, and each note
 * sitting right after the task it belongs to.
 *
 * Three rules shape everything here:
 *
 *   · Derived, never stored twice. The report is computed from `Task` records
 *     on every render, so editing a note changes the next preview with no
 *     copy step and no chance of the two drifting apart.
 *   · Honest dates. A task appears on a day because something happened to it
 *     that day — it was completed, due, added, or its note was edited. Nothing
 *     is carried into a report it does not belong to.
 *   · The user's words. Titles and notes are emitted as written. The only
 *     change made to a title is the strikethrough the format asks for.
 *
 * The example this was built against:
 *
 *   Priorities -
 *
 *   ~~Meet with Akshay Surgical - 12 PM.~~
 *   Align a meeting with Narayani Group - Didn't connect.
 *
 *   BizConnect Leads Follow-ups -
 *
 *   - ~~Mystery Bakers - Align a demo.~~
 *   - Narayani Group - Align a meeting. (Meeting could not be aligned today.)
 */

import { toISODate } from './dates';
import type { ReportFormat, Task } from './types';
import { completionNoteOf, noteOf } from './types';

/** Why a task is on this day's report. */
export type ReportReason = 'completed' | 'due' | 'added' | 'note' | 'completion-note';

export interface ReportLine {
  task: Task;
  completed: boolean;
  /** The note shown after the title — completion note first, task note second. */
  note: string;
  /** Short suffix from the task itself, e.g. “12 PM” or a client name. */
  detail: string;
}

export interface ReportSection {
  /** Heading as the user wrote it. Empty only when the whole report is one list. */
  title: string;
  lines: ReportLine[];
}

export interface DailyReportModel {
  dateISO: string;
  sections: ReportSection[];
  completedCount: number;
  pendingCount: number;
  noteCount: number;
  hasTasks: boolean;
  /** Every task on the report, with the reason it qualified. */
  included: Array<{ task: Task; reasons: ReportReason[] }>;
}

export interface DailyReportOptions {
  /** Tasks under no heading are listed here. Defaults to “Priorities”. */
  defaultSectionTitle?: string;
  /** Drop completed tasks whose completion date is a different day. */
  keepForeignCompletions?: boolean;
}

const PRIORITY_SECTION = 'Priorities';

function dateOf(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return toISODate(parsed);
}

/**
 * Is this task part of the given day?
 *
 * A task is in scope when something happened to it that day. A task completed
 * on another day is *not* dragged into this one even if it is still due:
 * reporting it twice would make two days claim the same work.
 */
export function reportReasons(task: Task, dateISO: string): ReportReason[] {
  if (task.deletedAt !== null) return [];
  const completedOn = dateOf(task.completedAt);
  if (task.status === 'completed') {
    return completedOn === dateISO ? ['completed'] : [];
  }
  const reasons: ReportReason[] = [];
  if (task.dueDate === dateISO) reasons.push('due');
  if (dateOf(task.createdAt) === dateISO) reasons.push('added');
  if (dateOf(task.notesUpdatedAt) === dateISO) reasons.push('note');
  if (dateOf(task.completionNoteAt) === dateISO) reasons.push('completion-note');
  return reasons;
}

/** The one note that belongs next to a title. */
export function reportNoteOf(task: Task): string {
  return completionNoteOf(task) || noteOf(task);
}

/**
 * The short suffix the planner itself adds to a title: the due time when it
 * has one, otherwise nothing. Client names already tend to be in the title and
 * repeating them was the main way this report grew noisy.
 */
function detailOf(task: Task): string {
  return task.dueTime ? formatDueTime(task.dueTime) : '';
}

function formatDueTime(time: string): string {
  const [hoursRaw, minutesRaw] = time.split(':').map(Number);
  if (!Number.isFinite(hoursRaw) || !Number.isFinite(minutesRaw)) return time;
  const suffix = hoursRaw >= 12 ? 'PM' : 'AM';
  const hours = hoursRaw % 12 === 0 ? 12 : hoursRaw % 12;
  return minutesRaw === 0 ? `${hours} ${suffix}` : `${hours}:${String(minutesRaw).padStart(2, '0')} ${suffix}`;
}

/**
 * Build the day's report model.
 *
 * Order is deliberately the order things were added — that is the order the
 * user wrote them in, and re-sorting by priority or deadline would quietly
 * rewrite their own list.
 */
export function buildDailyReport(
  tasks: Task[],
  dateISO: string,
  options: DailyReportOptions = {},
): DailyReportModel {
  const defaultTitle = options.defaultSectionTitle ?? PRIORITY_SECTION;
  const included: Array<{ task: Task; reasons: ReportReason[] }> = [];

  for (const task of tasks) {
    if (options.keepForeignCompletions && task.status === 'completed' && task.deletedAt === null) {
      included.push({ task, reasons: ['completed'] });
      continue;
    }
    const reasons = reportReasons(task, dateISO);
    if (reasons.length > 0) included.push({ task, reasons });
  }

  /* Stable by creation time: imports and quick adds keep the order they were
     entered in, and a task edited later does not jump to the bottom. */
  included.sort((a, b) => a.task.createdAt.localeCompare(b.task.createdAt));

  const groups = new Map<string, ReportLine[]>();
  for (const entry of included) {
    const heading = (entry.task.section ?? '').trim() || defaultTitle;
    const note = reportNoteOf(entry.task);
    const line: ReportLine = {
      task: entry.task,
      completed: entry.task.status === 'completed',
      note,
      detail: detailOf(entry.task),
    };
    const bucket = groups.get(heading);
    if (bucket) bucket.push(line);
    else groups.set(heading, [line]);
  }

  /* The ungrouped list comes first, exactly as it reads in the example; named
     sections follow in the order their tasks were first added. */
  const sections: ReportSection[] = [];
  const defaultLines = groups.get(defaultTitle);
  if (defaultLines) sections.push({ title: defaultTitle, lines: defaultLines });
  for (const [title, lines] of groups) {
    if (title === defaultTitle) continue;
    sections.push({ title, lines });
  }

  const allLines = sections.flatMap((section) => section.lines);
  return {
    dateISO,
    sections,
    completedCount: allLines.filter((line) => line.completed).length,
    pendingCount: allLines.filter((line) => !line.completed).length,
    noteCount: allLines.filter((line) => line.note.length > 0).length,
    hasTasks: allLines.length > 0,
    included,
  };
}

/**
 * The markers each destination understands.
 *
 *   whatsapp — a single tilde strikes text through in WhatsApp.
 *   markdown — a double tilde, for Slack, Teams, GitHub and every Markdown
 *              renderer.
 *   plain    — no markup at all, because some destinations would print the
 *              tildes literally; a written marker is unambiguous instead.
 */
export function strikethrough(text: string, format: ReportFormat): string {
  if (format === 'whatsapp') return `~${text}~`;
  if (format === 'markdown') return `~~${text}~~`;
  return `[COMPLETED] ${text}`;
}

export interface RenderOptions {
  /**
   * A first line such as “Daily Update — Fri, 23 Oct 2026”. Off by default:
   * the example report has no date line, and the group already knows what day
   * it is.
   */
  heading?: string;
  /** Prefix named sections with “- ” bullets, as the example does. */
  bullets?: boolean;
  /** What to output when the day has nothing on it. */
  emptyText?: string;
}

function indentContinuation(text: string, prefix: string): string {
  return text
    .split('\n')
    .map((line, index) => (index === 0 ? line : `${prefix}${line}`))
    .join('\n');
}

/**
 * Render the model as text ready to paste.
 *
 * Notes keep their line breaks and are indented under their bullet, so a
 * multi-line update still reads as one item in WhatsApp.
 */
export function renderDailyReport(
  model: DailyReportModel,
  format: ReportFormat,
  options: RenderOptions = {},
): string {
  const heading = (options.heading ?? '').trim();
  const blocks: string[] = [];
  if (heading) blocks.push(heading);

  const bulletFor = (title: string) => Boolean(options.bullets ?? true) && title !== PRIORITY_SECTION;

  for (const section of model.sections) {
    const bulleted = bulletFor(section.title);
    const continuation = bulleted ? '  ' : '   ';
    const lines = section.lines.map((line) => {
      const bare = `${line.task.title}${line.detail ? ` - ${line.detail}` : ''}`;
      const title = line.completed ? strikethrough(bare, format) : bare;
      const withNote = line.note ? `${title} - ${indentContinuation(line.note, continuation)}` : title;
      return bulleted ? `- ${withNote}` : withNote;
    });
    blocks.push(lines.length > 0 ? `${section.title} -\n\n${lines.join('\n')}` : `${section.title} -`);
  }

  if (blocks.length === 0) return options.emptyText ?? '';
  return blocks.join('\n\n');
}

/** Convenience: build and render in one call. */
export function dailyReportText(
  tasks: Task[],
  dateISO: string,
  format: ReportFormat,
  options: DailyReportOptions & RenderOptions = {},
): string {
  const model = buildDailyReport(tasks, dateISO, options);
  return renderDailyReport(model, format, {
    ...options,
    emptyText: options.emptyText ?? `No tasks recorded for ${dateISO}.`,
  });
}

/** The formats offered in the UI, with the words used to describe them. */
export const REPORT_FORMATS: Array<{ value: ReportFormat; label: string; short: string; hint: string }> = [
  {
    value: 'whatsapp',
    label: 'WhatsApp',
    short: '~done~',
    hint: 'Single tildes — WhatsApp strikes the title through and keeps the note readable.',
  },
  {
    value: 'markdown',
    label: 'Markdown',
    short: '~~done~~',
    hint: 'Double tildes — Slack, Teams, GitHub and Markdown editors all understand them.',
  },
  {
    value: 'plain',
    label: 'Plain text',
    short: '[COMPLETED]',
    hint: 'No markup at all: completed titles are marked in words, for destinations that would print the tildes.',
  },
];

export function reportFormatLabel(format: ReportFormat): string {
  return REPORT_FORMATS.find((entry) => entry.value === format)?.label ?? format;
}
