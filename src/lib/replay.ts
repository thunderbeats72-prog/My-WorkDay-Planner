/**
 * Day replay — watch yesterday unfold, minute by minute.
 *
 * The planner already stores the truth: timer sessions with real start and
 * end moments, and the completion stamps on tasks. This assembles them into
 * one timeline for a chosen day so a person can scrub it and see where the
 * hours actually went — the retrospective that makes tomorrow's plan honest.
 *
 * Pure assembly, no rendering, no clock: sessions that straddle midnight are
 * clipped to the day, overlapping sessions are kept as they are (the timer
 * allows only one active, but history can contain anything), and nothing is
 * invented where no session ran.
 */

import type { Settings, Task, TimeSession } from './types';
import { fromISODate, parseTimeToMinutes, toISODate } from './dates';

export interface ReplaySpan {
  startMs: number;
  endMs: number;
  taskId: string;
  title: string;
  /** Work minutes inside this day, after clipping. */
  minutes: number;
}

export interface ReplayMark {
  atMs: number;
  title: string;
}

export interface DayReplay {
  date: string;
  /** The scrub window: the working day if known, else the data's own range. */
  startMs: number;
  endMs: number;
  spans: ReplaySpan[];
  marks: ReplayMark[];
  workMinutes: number;
}

/** Sessions and completions for one date, ordered and clipped. */
export function buildDayReplay(
  dateISO: string,
  tasks: Task[],
  sessions: TimeSession[],
  settings?: Settings,
): DayReplay {
  const dayStart = fromISODate(dateISO);
  const midnightEnd = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate() + 1);

  const titles = new Map(tasks.map((task) => [task.id, task.title]));
  const spans: ReplaySpan[] = [];
  for (const session of sessions) {
    if (session.state === 'running') continue;
    const start = new Date(session.startedAt);
    const end = session.endedAt ? new Date(session.endedAt) : new Date(start.getTime() + Math.max(0, session.durationMs));
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) continue;
    if (end <= dayStart || start >= midnightEnd) continue;
    const clippedStart = start < dayStart ? dayStart : start;
    const clippedEnd = end > midnightEnd ? midnightEnd : end;
    spans.push({
      startMs: clippedStart.getTime(),
      endMs: clippedEnd.getTime(),
      taskId: session.taskId,
      title: titles.get(session.taskId) ?? 'Removed task',
      minutes: Math.round((clippedEnd.getTime() - clippedStart.getTime()) / 60_000),
    });
  }
  spans.sort((a, b) => a.startMs - b.startMs);

  const marks: ReplayMark[] = tasks
    .filter((task) => task.completedAt && toISODate(new Date(task.completedAt)) === dateISO)
    .map((task) => ({ atMs: new Date(task.completedAt as string).getTime(), title: task.title }))
    .sort((a, b) => a.atMs - b.atMs);

  // The window: working hours when settings say so, else whatever the data
  // spans (an empty day still needs a sensible bar).
  let startMs = dayStart.getTime();
  let endMs = midnightEnd.getTime();
  if (settings) {
    const from = parseTimeToMinutes(settings.workdayStart);
    const to = parseTimeToMinutes(settings.workdayEnd);
    if (to > from) {
      startMs = dayStart.getTime() + from * 60_000;
      endMs = dayStart.getTime() + to * 60_000;
    }
  }
  if (spans.length > 0) {
    startMs = Math.min(startMs, spans[0].startMs);
    endMs = Math.max(endMs, spans[spans.length - 1].endMs);
  }
  if (endMs <= startMs) endMs = startMs + 60 * 60_000;

  return {
    date: dateISO,
    startMs,
    endMs,
    spans,
    marks,
    workMinutes: spans.reduce((sum, span) => sum + span.minutes, 0),
  };
}

/** What is happening at `atMs` — the last span that has begun. */
export function replayAt(replay: DayReplay, atMs: number): ReplaySpan | null {
  let current: ReplaySpan | null = null;
  for (const span of replay.spans) {
    if (span.startMs <= atMs) current = span;
    else break;
  }
  return current;
}

/** Dates that have something to replay, newest first. */
export function replayableDates(sessions: TimeSession[], limit = 14): string[] {
  const dates = new Set<string>();
  for (const session of sessions) {
    if (session.state === 'running') continue;
    const start = new Date(session.startedAt);
    if (!Number.isNaN(start.getTime())) dates.add(toISODate(start));
  }
  return [...dates].sort().reverse().slice(0, limit);
}
