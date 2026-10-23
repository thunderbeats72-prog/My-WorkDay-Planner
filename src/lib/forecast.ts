/**
 * Deadline forecasts — "78% chance this lands Thursday" instead of a guess.
 *
 * A thousand lightweight simulations, on-device, from numbers this planner
 * already owns: your learned durations, your estimate bias, your deferral
 * history, your working calendar. No paid model, no network, and — the rule
 * this codebase lives by — every forecast carries the reasons it believes
 * what it believes, so a number you disagree with can be argued with.
 *
 * The model, stated honestly:
 *   · the median duration is the learned client median, else the learned
 *     category median, else your estimate corrected by the category's
 *     observed bias (the planning fallacy, measured rather than assumed);
 *   · each run draws a duration from a triangular spread around that median
 *     (55%–190% — tight around the mode, with a realistic long tail);
 *   · a task that has been deferred gets, on some runs, a restart: deferral
 *     is not "work takes longer", it is "the work begins again";
 *   · the drawn duration is spent inside your real working calendar —
 *     nights, weekends and lunch don't count — and the finish time is
 *     compared with the actual deadline moment.
 *
 * Determinism comes from an injectable RNG: same inputs, same forecast, so
 * the tests assert numbers rather than vibes.
 */

import type { Settings, Task } from './types';
import type { LearnedDurations } from './engine';
import { isWorkingDaySettings, workingMinutes } from './engine';
import { combineDateTime, parseTimeToMinutes, toISODate } from './dates';

export interface ForecastModel {
  medianMinutes: number;
  /** 'client' | 'category' | 'corrected' | 'estimate' */
  source: 'client' | 'category' | 'corrected' | 'estimate';
  /** Factor applied to the raw estimate, when the bias correction ran. */
  factor: number | null;
  /** Evidence for the label: "×1.4 — work runs long here (5 samples)". */
  reasons: string[];
}

export interface Forecast {
  runs: number;
  /** Percent of runs finishing by the deadline; null when undated. */
  pOnTime: number | null;
  /** Median finish date; band is the 10th–90th percentile. */
  medianDate: string;
  bandStart: string;
  bandEnd: string;
  deadline: string | null;
  model: ForecastModel;
  /** One line per belief: what the number is made of. */
  reasons: string[];
}

export interface ForecastInput {
  task: Task;
  tasks: Task[];
  settings: Settings;
  learned: LearnedDurations | null;
  now: Date;
  runs?: number;
  /** Injectable for tests; defaults to a seeded generator. */
  rng?: () => number;
}

/** mulberry32 — 32 bits of state, plenty for a planner, and reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Triangular distribution — the poor man's realistic spread. */
export function triangular(rng: () => number, min: number, mode: number, max: number): number {
  if (max <= min) return min;
  const u = rng();
  const fc = (mode - min) / (max - min);
  if (u < fc) return min + Math.sqrt(u * (max - min) * (mode - min));
  return max - Math.sqrt((1 - u) * (max - min) * (max - mode));
}

/** What duration the forecast believes in, and why. */
export function durationModel(task: Task, learned: LearnedDurations | null): ForecastModel {
  const raw = Math.max(5, Math.round(task.estimatedMinutes || 30));
  const samples = learned?.samples;

  const clientMedian = task.client ? learned?.byClient[task.client] : undefined;
  if (typeof clientMedian === 'number' && clientMedian > 0) {
    const count = samples?.byClient[task.client] ?? 0;
    return {
      medianMinutes: Math.round(clientMedian),
      source: 'client',
      factor: null,
      reasons: [`Duration learned from ${count || 'several'} timed ${task.client} task${count === 1 ? '' : 's'}`],
    };
  }

  const categoryMedian = learned?.byCategory[task.category];
  if (typeof categoryMedian === 'number' && categoryMedian > 0) {
    const count = samples?.byCategory[task.category] ?? 0;
    return {
      medianMinutes: Math.round(categoryMedian),
      source: 'category',
      factor: null,
      reasons: [`Duration learned from ${count || 'several'} timed ${task.category.replace(/-/g, ' ')} tasks`],
    };
  }

  const factor = learned?.factors?.[task.category];
  if (typeof factor === 'number' && factor > 0 && factor !== 1) {
    const count = samples?.byCategory[task.category] ?? 0;
    return {
      medianMinutes: Math.max(5, Math.round(raw * factor)),
      source: 'corrected',
      factor,
      reasons: [
        `Your ${task.category.replace(/-/g, ' ')} estimates run ${factor > 1 ? 'long' : 'short'} — plans use ×${factor} (${count || '3+'} samples)`,
      ],
    };
  }

  return {
    medianMinutes: raw,
    source: 'estimate',
    factor: null,
    reasons: ['No timing history yet — using your own estimate'],
  };
}

/** The moment a deadline actually expires: date + time, else end of workday. */
export function deadlineMoment(task: Task, settings: Settings): Date | null {
  if (!task.dueDate) return null;
  const fallback = settings.workdayEnd || '18:00';
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(task.dueTime) ? task.dueTime : fallback;
  return combineDateTime(task.dueDate, time);
}

/**
 * Spend `minutes` of work, starting at `from`, inside the working calendar.
 * The walk is day-by-day (never minute-by-minute) so a 40-day horizon costs
 * 40 iterations, not 40 000.
 */
export function addWorkTime(from: Date, minutes: number, settings: Settings): Date {
  let remaining = Math.max(1, Math.round(minutes));
  const dayStart = parseTimeToMinutes(settings.workdayStart);
  const dayEnd = parseTimeToMinutes(settings.workdayEnd);
  const lunchStart = parseTimeToMinutes(settings.lunchStart);
  const lunchEnd = parseTimeToMinutes(settings.lunchEnd);
  const hasLunch = dayEnd > dayStart && lunchEnd > lunchStart && lunchStart >= dayStart && lunchEnd <= dayEnd;
  if (dayEnd <= dayStart) return from; // broken hours: refuse to invent time

  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  let guard = 0;

  while (remaining > 0 && guard < 400) {
    guard += 1;
    if (!isWorkingDaySettings(settings, cursor) || workingMinutes(settings) === 0) {
      cursor.setDate(cursor.getDate() + 1);
      continue;
    }
    const startMinutes =
      toISODate(cursor) === toISODate(from)
        ? Math.max(dayStart, from.getHours() * 60 + from.getMinutes())
        : dayStart;
    let minute = startMinutes;
    while (minute < dayEnd && remaining > 0) {
      let chunk = dayEnd - minute;
      if (hasLunch && minute < lunchStart) chunk = Math.min(chunk, lunchStart - minute);
      if (hasLunch && minute >= lunchStart && minute < lunchEnd) {
        minute = lunchEnd;
        continue;
      }
      const take = Math.min(remaining, chunk);
      remaining -= take;
      minute += take;
      if (hasLunch && minute >= lunchStart && minute < lunchEnd) minute = lunchEnd;
    }
    if (remaining > 0) cursor.setDate(cursor.getDate() + 1);
    else return new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), Math.floor(minute / 60), minute % 60);
  }
  return cursor;
}

const DEFAULT_RUNS = 1_000;

export function forecastTask(input: ForecastInput): Forecast | null {
  const { task, settings, now } = input;
  if (task.deletedAt !== null || task.status === 'completed') return null;
  const runs = Math.max(1, input.runs ?? DEFAULT_RUNS);
  const rng = input.rng ?? mulberry32(hashTaskId(task.id, now));
  const model = durationModel(task, input.learned);
  const deadline = deadlineMoment(task, settings);

  const finishTimes: number[] = [];
  let onTime = 0;
  let restarts = 0;
  const restartChance = task.deferrals > 0 ? Math.min(0.7, task.deferrals * 0.2) : 0;

  for (let i = 0; i < runs; i += 1) {
    let minutes = triangular(rng, model.medianMinutes * 0.55, model.medianMinutes, model.medianMinutes * 1.9);
    if (restartChance > 0 && rng() < restartChance) {
      // Deferral history shows up as a restart on some runs, not as a
      // blanket fudge on every run.
      minutes += triangular(rng, model.medianMinutes * 0.5, model.medianMinutes * 0.9, model.medianMinutes * 1.2);
      restarts += 1;
    }
    const finish = addWorkTime(now, minutes, settings);
    finishTimes.push(finish.getTime());
    if (deadline && finish.getTime() <= deadline.getTime()) onTime += 1;
  }

  finishTimes.sort((a, b) => a - b);
  const pick = (p: number) => toISODate(new Date(finishTimes[Math.min(finishTimes.length - 1, Math.max(0, Math.round(p * (finishTimes.length - 1))))]));

  const reasons = [...model.reasons];
  if (deadline) reasons.push(`Deadline: ${toISODate(deadline)}${/^([01]\d|2[0-3]):[0-5]\d$/.test(task.dueTime) ? ` ${task.dueTime}` : ' (end of workday)'}`);
  else reasons.push('No deadline — showing when the work is likely to finish, not a promise');
  if (task.deferrals > 0) {
    reasons.push(`Deferred ${task.deferrals}× — ${Math.round(restartChance * 100)}% of runs restart the work`);
  }
  reasons.push(`Calendar: ${settings.workingDays.length} working day${settings.workingDays.length === 1 ? '' : 's'} a week, ${settings.workdayStart}–${settings.workdayEnd}`);

  return {
    runs,
    pOnTime: deadline ? Math.round((onTime / runs) * 100) : null,
    medianDate: pick(0.5),
    bandStart: pick(0.1),
    bandEnd: pick(0.9),
    deadline: deadline ? toISODate(deadline) : null,
    model,
    reasons,
  };
}

/** Stable seed: the same task forecasts the same numbers within a minute. */
function hashTaskId(id: string, now: Date): number {
  const day = Math.floor(now.getTime() / 60_000);
  let h = day ^ 0x9e3779b9;
  for (let i = 0; i < id.length; i += 1) h = Math.imul(h ^ id.charCodeAt(i), 0x85ebca6b);
  return h >>> 0;
}
