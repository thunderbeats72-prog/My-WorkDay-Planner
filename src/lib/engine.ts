import { addDays, differenceInCalendarDays, startOfDay } from 'date-fns';
import {
  clamp,
  combineDateTime,
  daysFromNow,
  dayOffset,
  fromISODate,
  isQuietNow,
  minutesToTime,
  parseTimeToMinutes,
  toISODate,
} from './dates';
import type {
  Category,
  Priority,
  ScheduleBlock,
  Settings,
  Task,
} from './types';
import { CATEGORIES, PRIORITIES } from './types';

export interface ScoredTask {
  task: Task;
  score: number;
  reasons: string[];
  estimateMinutes: number;
  blocked: boolean;
  blockReasons: string[];
}

export interface PlanQueueItem {
  task: Task;
  reason: string;
  estimateMinutes: number;
}

export interface DayPlan {
  dateISO: string;
  isWorkingDay: boolean;
  nowMinutes: number;
  dayStart: number;
  dayEnd: number;
  capacityMinutes: number;
  plannedMinutes: number;
  remainingMinutes: number;
  /** Minutes of the day covered by calendar meetings (clamped to the workday). */
  busyMinutes: number;
  /** Explainable energy-curve note, or null when no curve was applied. */
  energyNote: string | null;
  blocks: ScheduleBlock[];
  queued: PlanQueueItem[];
  conflicts: ConflictWarning[];
}

/** A calendar commitment that blocks capacity, in minutes of day. */
export interface BusyInterval {
  id: string;
  title: string;
  start: number;
  end: number;
}

/** Reports-derived energy curve: sharpest and slowest hours from real sessions. */
export interface EnergyCurve {
  sharpestHour: number | null;
  slumpHour: number | null;
  sharpestMinutes?: number;
  slumpMinutes?: number;
}

/** One task-level difference between two plans of the same day. */
export interface PlanShift {
  taskId: string;
  title: string;
  kind: 'moved' | 'queued' | 'scheduled';
  /** Previous and new start as HH:MM (null when the side has no slot). */
  from: string | null;
  to: string | null;
}

export interface ConflictWarning {
  dateISO: string;
  firstTaskId: string;
  secondTaskId: string;
  message: string;
}

export interface LearnedDurations {
  byCategory: Partial<Record<Category, number>>;
  byClient: Record<string, number>;
  /** Planning-fallacy correction: 1.4 means estimates in that category
   * typically miss the real work by 40%. Applied only when no learned median
   * exists yet — measured data always beats a correction factor. */
  factors?: Partial<Record<Category, number>>;
  /** How much evidence sits behind each number — for honest labels. */
  samples?: {
    byCategory: Partial<Record<Category, number>>;
    byClient: Record<string, number>;
  };
}

export interface ParsedDraft {
  title: string;
  notes: string;
  client: string;
  category: Category;
  priority: Priority;
  estimatedMinutes: number;
  dueDate: string | null;
  dueTime: string;
  confidence: number;
  warnings: string[];
  rawText: string;
  /**
   * The heading this item sat under in the screenshot (“BizConnect Leads
   * Follow-ups”). Empty when it was in the ungrouped list at the top.
   */
  section: string;
  /**
   * The line was struck through in the screenshot, which usually means the
   * person already did it. This is a *hint*: the review step asks, and nothing
   * is saved as completed unless that box is ticked.
   */
  completedHint: boolean;
}

const WEEKDAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

export function roundUpToFive(minutes: number): number {
  return Math.ceil(minutes / 5) * 5;
}

export function isWorkingDaySettings(settings: Settings, date: Date): boolean {
  return settings.workingDays.includes(date.getDay());
}

export function workingMinutes(settings: Settings): number {
  const start = parseTimeToMinutes(settings.workdayStart);
  const end = parseTimeToMinutes(settings.workdayEnd);
  if (end <= start) return 0;
  const lunchStart = parseTimeToMinutes(settings.lunchStart);
  const lunchEnd = parseTimeToMinutes(settings.lunchEnd);
  const lunch = lunchEnd > lunchStart && lunchStart >= start && lunchEnd <= end ? lunchEnd - lunchStart : 0;
  return Math.max(0, end - start - lunch);
}

export function findDependencyCycle(
  taskId: string | null,
  dependencyIds: string[],
  tasks: Task[],
): string[] | null {
  if (!taskId) return null;
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const visited = new Set<string>();
  const walk = (id: string, path: string[]): string[] | null => {
    if (id === taskId) return [...path, id];
    if (visited.has(id)) return null;
    visited.add(id);
    const task = byId.get(id);
    if (!task) return null;
    for (const nextId of task.dependencyIds) {
      const cycle = walk(nextId, [...path, id]);
      if (cycle) return cycle;
    }
    return null;
  };
  for (const dependencyId of dependencyIds) {
    const cycle = walk(dependencyId, []);
    if (cycle) return cycle;
  }
  return null;
}

export function isDependencyMet(task: Task, byId: Map<string, Task>): boolean {
  if (task.dependencyIds.length === 0) return true;
  return task.dependencyIds.every((id) => {
    const dependency = byId.get(id);
    if (!dependency) return true;
    return dependency.status === 'completed' && dependency.deletedAt === null;
  });
}

export function scoreTask(
  task: Task,
  settings: Settings,
  now: Date = new Date(),
  learned: LearnedDurations | null = null,
): ScoredTask {
  const reasons: string[] = [];
  const blockReasons: string[] = [];
  const priorityMeta = PRIORITIES[task.priority];
  let score = 0;
  score += priorityMeta.weight;
  reasons.push(`${priorityMeta.label} priority (+${priorityMeta.weight})`);

  if (task.dueDate) {
    const offset = dayOffset(task.dueDate, now);
    let deadlinePoints = 0;
    if (offset < 0) {
      deadlinePoints = 35;
      reasons.push(`Overdue by ${Math.abs(offset)} day${Math.abs(offset) === 1 ? '' : 's'} (+35)`);
    } else if (offset === 0) {
      deadlinePoints = 28;
      reasons.push('Deadline is today (+28)');
    } else if (offset === 1) {
      deadlinePoints = 20;
      reasons.push('Deadline is tomorrow (+20)');
    } else if (offset <= 7) {
      deadlinePoints = 14 - offset;
      reasons.push(`Due in ${offset} days (+${deadlinePoints})`);
    } else {
      deadlinePoints = 3;
      reasons.push(`Due ${offset} days out (+3)`);
    }
    score += deadlinePoints;
  } else {
    reasons.push('No deadline (+0)');
  }

  if (task.deferrals > 0) {
    const points = Math.min(15, task.deferrals * 4);
    score += points;
    reasons.push(`Deferred ${task.deferrals} time${task.deferrals === 1 ? '' : 's'} (+${points})`);
  }

  if (task.estimatedMinutes <= 15) {
    score += 4;
    reasons.push('Quick win under 15m (+4)');
  }

  const ageDays = Math.max(0, differenceInCalendarDays(now, new Date(task.createdAt)));
  if (ageDays >= 3) {
    score += Math.min(6, Math.floor(ageDays / 3) + 2);
    reasons.push(`Waiting ${ageDays} days (+${Math.min(6, Math.floor(ageDays / 3) + 2)})`);
  }

  if (task.blocked) {
    blockReasons.push('Marked as blocked');
  }
  if (task.dependencyIds.length > 0) {
    blockReasons.push(
      task.dependencyIds.length === 1 ? 'Waiting on 1 dependency' : `Waiting on ${task.dependencyIds.length} dependencies`,
    );
  }
  if (task.status === 'completed') blockReasons.push('Already completed');
  if (task.deletedAt) blockReasons.push('Deleted');

  return {
    task,
    score: clamp(Math.round(score), 0, 100),
    reasons,
    estimateMinutes: estimateForTask(task, settings, learned),
    blocked: blockReasons.length > 0,
    blockReasons,
  };
}

export function estimateForTask(task: Task, settings: Settings, learned: LearnedDurations | null): number {
  if (learned) {
    const categoryMedian = learned.byCategory[task.category];
    const clientMedian = task.client ? learned.byClient[task.client] : undefined;
    if (typeof categoryMedian === 'number' && categoryMedian > 0) return Math.round(categoryMedian);
    if (typeof clientMedian === 'number' && clientMedian > 0) return Math.round(clientMedian);
    // No median for this category/client yet — but if ≥3 timed tasks show
    // estimates missing by a clear margin, plan with the correction instead
    // of the wish. The label ("×1.4") travels with the forecast so the
    // adjustment is never a silent fudge.
    const factor = learned.factors?.[task.category];
    if (typeof factor === 'number' && factor > 0 && factor !== 1) {
      const base = Math.max(5, Math.round(task.estimatedMinutes || settings.defaultEstimateMinutes));
      return Math.max(5, Math.round(base * factor));
    }
  }
  return Math.max(5, Math.round(task.estimatedMinutes || settings.defaultEstimateMinutes));
}

export function orderCandidates(
  tasks: Task[],
  settings: Settings,
  now: Date,
  learned: LearnedDurations | null = null,
): ScoredTask[] {
  return tasks
    .map((task) => scoreTask(task, settings, now, learned))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aDue = a.task.dueDate ?? '9999-12-31';
      const bDue = b.task.dueDate ?? '9999-12-31';
      if (aDue !== bDue) return aDue.localeCompare(bDue);
      return a.task.createdAt.localeCompare(b.task.createdAt);
    });
}

export interface BuildPlanOptions {
  date?: Date;
  learned?: LearnedDurations | null;
  /** Calendar meetings (minutes of day) that hard-block capacity. */
  busy?: BusyInterval[];
  /** Reports-derived energy curve; deep work anchored to the sharp hour. */
  energy?: EnergyCurve | null;
}

export function buildDayPlan(tasks: Task[], settings: Settings, now: Date = new Date(), options: BuildPlanOptions = {}): DayPlan {
  const date = options.date ?? now;
  const dateISO = toISODate(date);
  const isWorkingDay = settings.workingDays.includes(date.getDay());
  const dayStart = parseTimeToMinutes(settings.workdayStart);
  const dayEnd = parseTimeToMinutes(settings.workdayEnd);
  const lunchStart = parseTimeToMinutes(settings.lunchStart);
  const lunchEnd = parseTimeToMinutes(settings.lunchEnd);
  const hasLunch = lunchEnd > lunchStart && lunchStart >= dayStart && lunchEnd <= dayEnd;
  const capacityMinutes = isWorkingDay ? workingMinutes(settings) : 0;
  const nowMinutes = dateISO === toISODate(now) ? now.getHours() * 60 + now.getMinutes() : dayStart;

  // Calendar truth: merge overlaps, clamp to the working day, and subtract the
  // lunch overlap so a meeting across lunch never double-takes capacity.
  const busy = mergeBusy(
    (options.busy ?? [])
      .filter((interval) => interval.end > interval.start)
      .map((interval) => ({
        ...interval,
        start: Math.max(interval.start, dayStart),
        end: Math.min(interval.end, dayEnd),
      }))
      .filter((interval) => interval.end > interval.start),
  );
  const busyMinutes = busy.reduce((sum, interval) => {
    const lunchOverlap =
      hasLunch && interval.start < lunchEnd && interval.end > lunchStart
        ? Math.min(interval.end, lunchEnd) - Math.max(interval.start, lunchStart)
        : 0;
    return sum + (interval.end - interval.start) - lunchOverlap;
  }, 0);
  const busyAt = (from: number): BusyInterval | null =>
    busy.find((interval) => from >= interval.start && from < interval.end) ?? null;

  const openTasks = tasks
    .filter((task) => task.status !== 'completed' && task.deletedAt === null)
    .map((task) => ({ ...task }));
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const scoredTasks = orderCandidates(openTasks, settings, now, options.learned ?? null);
  let candidates = scoredTasks.filter((scored) => {
    if (scored.task.blocked) return false;
    return isDependencyMet(scored.task, byId);
  });
  const ineligible = scoredTasks.filter((scored) => !candidates.includes(scored));

  const blocks: ScheduleBlock[] = [];
  const queued: PlanQueueItem[] = [];
  let cursor = Math.max(dayStart, roundUpToFive(nowMinutes));
  let plannedMinutes = 0;
  let lunchInserted = !hasLunch;
  let buffer = Math.max(0, settings.bufferMinutes);
  let blockCounter = 0;

  if (!isWorkingDay) {
    for (const scored of candidates) {
      queued.push({ task: scored.task, reason: 'Not a working day', estimateMinutes: scored.estimateMinutes });
    }
    for (const scored of ineligible) {
      const reasons = scored.blockReasons.join(' · ');
      queued.push({
        task: scored.task,
        reason: reasons ? `${reasons} — not scheduled` : 'Not a working day',
        estimateMinutes: scored.estimateMinutes,
      });
    }
    return {
      dateISO,
      isWorkingDay,
      nowMinutes,
      dayStart,
      dayEnd,
      capacityMinutes,
      plannedMinutes: 0,
      remainingMinutes: 0,
      busyMinutes,
      energyNote: null,
      blocks: [],
      queued,
      conflicts: detectConflicts(tasks, dateISO),
    };
  }

  if (cursor >= dayEnd) {
    for (const scored of candidates) {
      queued.push({ task: scored.task, reason: 'Workday already finished', estimateMinutes: scored.estimateMinutes });
    }
    for (const scored of ineligible) {
      const reasons = scored.blockReasons.join(' · ');
      queued.push({
        task: scored.task,
        reason: reasons ? `${reasons} — not scheduled` : 'Workday already finished',
        estimateMinutes: scored.estimateMinutes,
      });
    }
    return {
      dateISO,
      isWorkingDay,
      nowMinutes,
      dayStart,
      dayEnd,
      capacityMinutes,
      plannedMinutes: 0,
      remainingMinutes: capacityMinutes,
      busyMinutes,
      energyNote: null,
      blocks: [],
      queued,
      conflicts: detectConflicts(tasks, dateISO),
    };
  }

  const focusMinutes = clamp(settings.focusBlockMinutes || 50, 15, 180);

  // Meetings are facts: render them, then start placing around them.
  for (const interval of busy) {
    blocks.push({
      id: `mtg_${dateISO}_${interval.id}`,
      taskId: null,
      title: interval.title,
      start: interval.start,
      end: interval.end,
      kind: 'meeting',
      reason: 'From your calendar — blocks capacity',
    });
  }
  let jump = busyAt(cursor);
  while (jump) {
    cursor = jump.end;
    jump = busyAt(cursor);
  }

  // Energy curve: re-order only what energy can honestly claim — deadline work
  // stays locked, and swaps are recorded as explainable reasons.
  const energyResult = applyEnergyOrder(candidates, options.energy ?? null, cursor, dayEnd, dateISO);
  candidates = energyResult.ordered;
  const energyNote = energyResult.note;
  const energyReasons = energyResult.reasonsByTask;

  for (const scored of candidates) {
    const task = scored.task;
    let remaining = scored.estimateMinutes;
    let placedMinutes = 0;

    while (remaining > 0) {
      if (!lunchInserted && cursor >= lunchStart && cursor < lunchEnd) {
        blocks.push({
          id: `break_${dateISO}_lunch`,
          taskId: null,
          title: 'Lunch break',
          start: lunchStart,
          end: lunchEnd,
          kind: 'break',
        });
        cursor = lunchEnd;
        lunchInserted = true;
        continue;
      }

      // A meeting can start under the cursor (e.g. right after a buffer).
      const meetingNow = busyAt(cursor);
      if (meetingNow) {
        cursor = meetingNow.end;
        continue;
      }

      let latestEnd = cursor + Math.min(remaining, focusMinutes);
      if (!lunchInserted && cursor < lunchStart && latestEnd > lunchStart) {
        latestEnd = lunchStart;
      }
      // Never run a block into a meeting; the next iteration jumps past it.
      const meetingWall = busy.find((interval) => interval.start > cursor && interval.start < latestEnd);
      if (meetingWall) {
        latestEnd = meetingWall.start;
      }
      if (latestEnd <= cursor) {
        break;
      }
      if (latestEnd > dayEnd) break;

      blocks.push({
        id: `blk_${dateISO}_${blockCounter}`,
        taskId: task.id,
        title: task.title,
        start: cursor,
        end: latestEnd,
        kind: 'focus',
        learned: Boolean(
          (options.learned?.byCategory[task.category] ?? 0) > 0 ||
            (task.client ? (options.learned?.byClient[task.client] ?? 0) > 0 : false),
        ),
        reason: energyReasons.get(task.id),
      });
      blockCounter += 1;
      const chunk = latestEnd - cursor;
      placedMinutes += chunk;
      remaining -= chunk;
      cursor = latestEnd;

      if (remaining > 0) {
        const nextCursor = cursor + buffer;
        cursor = !lunchInserted && cursor < lunchStart && nextCursor > lunchStart ? lunchStart : nextCursor;
      } else if (buffer > 0 && cursor + buffer <= dayEnd) {
        const wouldCollideWithLunch = !lunchInserted && cursor < lunchEnd && cursor + buffer > lunchStart;
        const wouldCollideWithMeeting = busy.some(
          (interval) => interval.start > cursor && interval.start < cursor + buffer,
        );
        if (!wouldCollideWithLunch && !wouldCollideWithMeeting) {
          blocks.push({
            id: `buf_${dateISO}_${blockCounter}`,
            taskId: null,
            title: 'Buffer',
            start: cursor,
            end: cursor + buffer,
            kind: 'buffer',
          });
          blockCounter += 1;
          cursor += buffer;
        }
      }
    }

    if (placedMinutes > 0) {
      task.suggestedDate = dateISO;
      task.suggestedStart = minutesToTime(
        blocks.find((block) => block.taskId === task.id)?.start ?? dayStart,
      );
      plannedMinutes += placedMinutes;
      if (remaining > 0) {
        queued.push({
          task,
          reason: `Partially scheduled — ${Math.round(remaining)}m still queued (workday ends ${settings.workdayEnd})`,
          estimateMinutes: remaining,
        });
      }
    } else {
      queued.push({
        task,
        reason: `Not enough time left before ${settings.workdayEnd}`,
        estimateMinutes: scored.estimateMinutes,
      });
    }
    if (cursor >= dayEnd) {
      // Remaining tasks stay visible in the queue rather than disappearing.
      continue;
    }
  }

  const scheduledIds = new Set(blocks.filter((block) => block.taskId).map((block) => block.taskId));
  for (const scored of candidates) {
    if (scheduledIds.has(scored.task.id)) continue;
    if (queued.some((item) => item.task.id === scored.task.id)) continue;
    queued.push({
      task: scored.task,
      reason: 'Did not fit in the remaining workday',
      estimateMinutes: scored.estimateMinutes,
    });
  }

  for (const scored of ineligible) {
    const reasons = scored.blockReasons.join(' · ');
    queued.push({
      task: scored.task,
      reason: reasons ? `${reasons} — not scheduled` : 'Not eligible for automatic scheduling',
      estimateMinutes: scored.estimateMinutes,
    });
  }

  blocks.sort((a, b) => a.start - b.start);

  return {
    dateISO,
    isWorkingDay,
    nowMinutes,
    dayStart,
    dayEnd,
    capacityMinutes,
    plannedMinutes,
    remainingMinutes: Math.max(0, capacityMinutes - plannedMinutes),
    busyMinutes,
    energyNote,
    blocks,
    queued,
    conflicts: detectConflicts(tasks, dateISO),
  };
}

/** Merge overlapping or touching busy intervals so capacity is never counted twice. */
function mergeBusy(intervals: BusyInterval[]): BusyInterval[] {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged: BusyInterval[] = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last && interval.start <= last.end) {
      last.end = Math.max(last.end, interval.end);
      if (interval.end - interval.start > last.end - last.start) last.title = interval.title;
    } else {
      merged.push({ ...interval });
    }
  }
  return merged;
}

const DEEP_CATEGORIES = new Set<Category>(['research', 'report', 'proposal']);
const ADMIN_CATEGORIES = new Set<Category>(['admin', 'email', 'follow_up']);

export interface EnergyOrderResult {
  ordered: ScoredTask[];
  /** One honest, human-readable note about what the curve did (or just is). */
  note: string | null;
  /** taskId → reason shown on the task's block. */
  reasonsByTask: Map<string, string>;
}

/**
 * Energy-curve placement (#8): anchor deep work to the sharpest hour from real
 * session data and batch admin into the slowest hour — but only by re-ordering
 * tasks energy can honestly claim: anything due today or overdue keeps its
 * scored place (deadlines beat energy), and every swap carries a visible reason.
 */
export function applyEnergyOrder(
  candidates: ScoredTask[],
  energy: EnergyCurve | null,
  cursor: number,
  dayEnd: number,
  dateISO: string,
): EnergyOrderResult {
  const ordered = [...candidates];
  const reasonsByTask = new Map<string, string>();
  if (!energy || (energy.sharpestHour === null && energy.slumpHour === null)) {
    return { ordered, note: null, reasonsByTask };
  }

  const facts: string[] = [];
  if (energy.sharpestHour !== null) {
    const sharpLabel = `${String(energy.sharpestHour).padStart(2, '0')}:00`;
    facts.push(
      `sharpest ${sharpLabel}${energy.sharpestMinutes ? ` (${energy.sharpestMinutes}m tracked)` : ''}`,
    );
  }
  if (energy.slumpHour !== null) {
    const slumpLabel = `${String(energy.slumpHour).padStart(2, '0')}:00`;
    facts.push(`slowest ${slumpLabel}${energy.slumpMinutes ? ` (${energy.slumpMinutes}m tracked)` : ''}`);
  }

  const deadlineLocked = (scored: ScoredTask) =>
    scored.task.dueDate !== null && scored.task.dueDate <= dateISO;
  const isDeep = (scored: ScoredTask) => DEEP_CATEGORIES.has(scored.task.category);
  const isAdmin = (scored: ScoredTask) => ADMIN_CATEGORIES.has(scored.task.category);

  const sharpMinutes = energy.sharpestHour !== null ? energy.sharpestHour * 60 : null;
  const slumpMinutes = energy.slumpHour !== null ? energy.slumpHour * 60 : null;
  const sharpActive = sharpMinutes !== null && sharpMinutes < dayEnd && cursor < sharpMinutes + 60;
  const sharpPassed = sharpMinutes === null || cursor >= sharpMinutes + 60;
  const slumpActive =
    slumpMinutes !== null && slumpMinutes < dayEnd && cursor < slumpMinutes + 60 && sharpPassed;

  const swaps: string[] = [];

  if (sharpActive && sharpMinutes !== null) {
    const deepIdx = ordered.findIndex((scored) => isDeep(scored) && !deadlineLocked(scored));
    const adminIdx = ordered.findIndex((scored) => isAdmin(scored) && !deadlineLocked(scored));
    if (deepIdx !== -1 && adminIdx !== -1 && adminIdx < deepIdx) {
      const [item] = ordered.splice(deepIdx, 1);
      ordered.splice(adminIdx, 0, item);
      const label = `${String(energy.sharpestHour).padStart(2, '0')}:00`;
      reasonsByTask.set(
        item.task.id,
        `Placed at your sharpest hour (${label}${energy.sharpestMinutes ? `, ${energy.sharpestMinutes}m tracked` : ''})`,
      );
      swaps.push(`“${item.task.title}” moved ahead of admin work — ${label} is your sharpest hour`);
    }
  }

  if (slumpActive && slumpMinutes !== null) {
    const deepIdx = ordered.findIndex((scored) => isDeep(scored) && !deadlineLocked(scored));
    const adminIdx = ordered.findIndex((scored) => isAdmin(scored) && !deadlineLocked(scored));
    if (deepIdx !== -1 && adminIdx !== -1 && adminIdx > deepIdx) {
      const [item] = ordered.splice(adminIdx, 1);
      ordered.splice(deepIdx, 0, item);
      const label = `${String(energy.slumpHour).padStart(2, '0')}:00`;
      reasonsByTask.set(
        item.task.id,
        `Batched into your slowest hour (${label}) — deep work keeps the sharp hours`,
      );
      swaps.push(`“${item.task.title}” moved up — ${label} is your slowest hour, admin fits it`);
    }
  }

  const note =
    facts.length > 0
      ? `Energy curve from your sessions: ${facts.join(' · ')}${swaps.length > 0 ? `. ${swaps.join('. ')}` : ''}.`
      : null;
  return { ordered, note, reasonsByTask };
}

/**
 * Compare two plans of the same day (built from different task states at the
 * same clock) into the human-visible diff for live re-flow (#9).
 */
export function diffDayPlans(before: DayPlan, after: DayPlan, toleranceMinutes = 6): PlanShift[] {
  const beforeBlocks = new Map(
    before.blocks.filter((block) => block.taskId !== null).map((block) => [block.taskId as string, block]),
  );
  const afterBlocks = new Map(
    after.blocks.filter((block) => block.taskId !== null).map((block) => [block.taskId as string, block]),
  );
  const shifts: PlanShift[] = [];

  for (const [taskId, block] of afterBlocks) {
    const previous = beforeBlocks.get(taskId);
    if (!previous) {
      // New to the plan (pulled from the queue or just created).
      shifts.push({ taskId, title: block.title, kind: 'scheduled', from: null, to: minutesToTime(block.start) });
      continue;
    }
    if (
      Math.abs(previous.start - block.start) > toleranceMinutes ||
      Math.abs(previous.end - block.end) > toleranceMinutes
    ) {
      shifts.push({
        taskId,
        title: block.title,
        kind: 'moved',
        from: minutesToTime(previous.start),
        to: minutesToTime(block.start),
      });
    }
  }

  for (const [taskId, block] of beforeBlocks) {
    if (afterBlocks.has(taskId)) continue;
    shifts.push({ taskId, title: block.title, kind: 'queued', from: minutesToTime(block.start), to: null });
  }

  return shifts;
}

export function detectConflicts(tasks: Task[], dateISO?: string): ConflictWarning[] {
  const warnings: ConflictWarning[] = [];
  const scheduled = tasks.filter(
    (task) =>
      task.status !== 'completed' &&
      task.deletedAt === null &&
      task.suggestedDate !== null &&
      task.suggestedStart !== null &&
      (dateISO === undefined || task.suggestedDate === dateISO),
  );
  for (let i = 0; i < scheduled.length; i += 1) {
    for (let j = i + 1; j < scheduled.length; j += 1) {
      const first = scheduled[i];
      const second = scheduled[j];
      if (first.suggestedDate !== second.suggestedDate) continue;
      const firstStart = parseTimeToMinutes(first.suggestedStart ?? '00:00');
      const secondStart = parseTimeToMinutes(second.suggestedStart ?? '00:00');
      const firstEnd = firstStart + estimateForTask(first, { defaultEstimateMinutes: 30 } as Settings, null);
      const secondEnd = secondStart + estimateForTask(second, { defaultEstimateMinutes: 30 } as Settings, null);
      if (firstStart < secondEnd && secondStart < firstEnd) {
        warnings.push({
          dateISO: first.suggestedDate ?? '',
          firstTaskId: first.id,
          secondTaskId: second.id,
          message: `“${first.title}” and “${second.title}” overlap on ${first.suggestedDate}`,
        });
      }
    }
  }
  return warnings;
}

export function applyPlanToTasks(plan: DayPlan, tasks: Task[]): Task[] {
  const nowISO = new Date().toISOString();
  const scheduledStarts = new Map<string, number>();
  for (const block of plan.blocks) {
    if (!block.taskId) continue;
    if (!scheduledStarts.has(block.taskId)) scheduledStarts.set(block.taskId, block.start);
  }
  return tasks.map((task) => {
    const start = scheduledStarts.get(task.id);
    if (start === undefined) {
      if (task.suggestedDate === plan.dateISO) {
        return { ...task, suggestedDate: null, suggestedStart: null, updatedAt: nowISO };
      }
      return task;
    }
    return {
      ...task,
      suggestedDate: plan.dateISO,
      suggestedStart: minutesToTime(start),
      updatedAt: nowISO,
    };
  });
}

export interface PlanSummary {
  moves: number;
  staysQueued: number;
  deadlineChanges: number;
}

export function summarisePlan(plan: DayPlan): PlanSummary {
  return {
    moves: new Set(plan.blocks.filter((block) => block.taskId).map((block) => block.taskId)).size,
    staysQueued: plan.queued.length,
    deadlineChanges: 0,
  };
}

export interface WeekDaySummary {
  dateISO: string;
  label: string;
  dueCount: number;
  overdueCount: number;
  scheduledMinutes: number;
}

export function buildWeekSummary(tasks: Task[], settings: Settings, anchor: Date = new Date()): WeekDaySummary[] {
  const start = startOfDay(anchor);
  const mondayOffset = (start.getDay() + 6) % 7;
  const monday = addDays(start, -mondayOffset);
  const days: WeekDaySummary[] = [];
  for (let index = 0; index < 7; index += 1) {
    const day = addDays(monday, index);
    const dateISO = toISODate(day);
    const dueTasks = tasks.filter(
      (task) => task.deletedAt === null && task.status !== 'completed' && task.dueDate === dateISO,
    );
    const scheduled = tasks.filter(
      (task) =>
        task.deletedAt === null &&
        task.status !== 'completed' &&
        (task.scheduledFor === dateISO || task.suggestedDate === dateISO),
    );
    const isPast = dayOffset(dateISO, new Date()) < 0;
    days.push({
      dateISO,
      label: `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day.getDay()]} ${day.getDate()}`,
      dueCount: dueTasks.length,
      overdueCount: isPast ? dueTasks.length : 0,
      scheduledMinutes: scheduled.reduce((sum, task) => sum + estimateForTask(task, settings, null), 0),
    });
  }
  return days;
}

export interface ReminderItem {
  task: Task;
  dueAt: Date;
  leadMinutes: number;
  overdue: boolean;
}

export function buildReminders(tasks: Task[], settings: Settings, now: Date = new Date()): ReminderItem[] {
  return tasks
    .filter((task) => task.status !== 'completed' && task.deletedAt === null && task.dueDate !== null)
    .map((task) => {
      const dueAt = combineDateTime(task.dueDate as string, task.dueTime || '17:00');
      const minutesUntil = (dueAt.getTime() - now.getTime()) / 60000;
      return { task, dueAt, leadMinutes: settings.reminderLeadMinutes, overdue: minutesUntil < 0 };
    })
    .filter((item) => (item.dueAt.getTime() - now.getTime()) / 60000 <= settings.reminderLeadMinutes)
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
}

export function canNotifyNow(settings: Settings, now: Date = new Date()): boolean {
  return !isQuietNow(settings, now);
}

function stripBullets(line: string): string {
  return line
    .replace(/^\s*[-*•·]\s*/, '')
    .replace(/^\s*\d+[.)]\s*/, '')
    .replace(/^\s*(task|todo|to-do)\s*[:-]\s*/i, '')
    .trim();
}

const SECTION_SUFFIXES = /^(priorities?|tasks?|to[- ]?dos?|follow[- ]?ups?)$/i;

/**
 * Is this line a heading rather than a task?
 *
 * Headings in a pasted priority list look like “Priorities -”, “BizConnect
 * Leads Follow-ups -” or “Today:”. They are short, end with a dash or colon,
 * and are not themselves sentences. A task called “Update CRM.” ends with a
 * full stop and stays a task.
 */
export function sectionHeadingOf(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (/^\s*[-*•·]\s+/.test(trimmed)) return null;
  if (/^(client|customer|account|company|priority|due|deadline|estimate)\s*[:-]/i.test(trimmed)) return null;
  const match = /^(.{2,64}?)\s*[-–—:]\s*$/.exec(trimmed);
  const candidate = (match ? (match[1] ?? '') : trimmed).replace(/^#+\s*/, '').trim();
  if (!candidate || candidate.length > 64) return null;
  if (/[.!?]$/.test(candidate)) return null;
  if (/\d{1,2}[:.]\d{2}/.test(candidate)) return null;
  if (candidate.split(/\s+/).length > 8) return null;
  if (!match && !SECTION_SUFFIXES.test(candidate)) return null;
  return candidate;
}

/** Strip the strikethrough a screenshot renders around a finished task. */
export function stripStrikethrough(line: string): { text: string; struck: boolean } {
  const trimmed = line.trim();
  const wrapped = /^~~(.+)~~$/.exec(trimmed) ?? /^~(.+)~$/.exec(trimmed);
  if (wrapped) return { text: wrapped[1].trim(), struck: true };
  /* Some OCR runs turn the strike into a leading marker instead. */
  const marked = /^\[(x|X|✓|✔)\]\s*(.+)$/.exec(trimmed);
  if (marked) return { text: marked[2].trim(), struck: true };
  return { text: trimmed, struck: false };
}

/**
 * Split pasted text into blocks, carrying the heading each block sits under.
 *
 * Two shapes arrive here. A list copied out of a chat has blank lines between
 * groups and looks like paragraphs; a list copied out of a notes app has one
 * task per line and no blank lines at all. Both are handled: paragraphs when
 * there are any, otherwise one block per sentence-shaped line.
 */
export function splitSectionedBlocks(raw: string): Array<{ text: string; section: string }> {
  const normalised = raw.replace(/\r\n/g, '\n').trim();
  if (!normalised) return [];

  const out: Array<{ text: string; section: string }> = [];
  let section = '';
  let buffer: string[] = [];
  const flush = () => {
    if (buffer.length > 0) out.push({ text: buffer.join('\n'), section });
    buffer = [];
  };

  for (const line of normalised.split('\n')) {
    const heading = sectionHeadingOf(line);
    if (heading) {
      flush();
      section = heading;
      continue;
    }
    buffer.push(line);
  }
  flush();

  /* Each run may hold several blocks; split them with the same rules the
     paragraph parser used, so nothing about the old behaviour changes. */
  return out.flatMap(({ text, section: owner }) =>
    splitDraftBlocks(text).map((block) => ({ text: block, section: owner })),
  );
}

function splitDraftBlocks(raw: string): string[] {
  const normalised = raw.replace(/\r\n/g, '\n').trim();
  if (!normalised) return [];
  const byParagraph = normalised
    .split(/\n\s*\n+/)
    .map((block) => block.trim())
    .filter(Boolean);
  if (byParagraph.length > 1) return byParagraph;

  const lines = normalised.split('\n').map((line) => line.trim()).filter(Boolean);

  /* One-task-per-line, no blank lines: the shape a priority list is pasted in.
     A line that closed a sentence starts the next task, so each priority keeps
     its own card instead of all of them collapsing into one. */
  const sentenceTask = (line: string) => {
    if (/^\s*([-*•·]|\d+[.)])\s+/.test(line)) return true;
    const { text, struck } = stripStrikethrough(line);
    if (struck) return true;
    return /[.!?]$/.test(text) && text.split(/\s+/).length >= 3;
  };
  if (lines.length > 1 && lines.every(sentenceTask)) {
    return lines.map((line) => stripStrikethrough(line).text);
  }
  const blocks: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    const startsNew =
      /^\s*([-*•·]|\d+[.)])\s+/.test(line) ||
      /^\s*(task|todo|to-do)\s*[:-]/i.test(line);
    if (startsNew && current.length > 0) {
      blocks.push(current.join('\n'));
      current = [];
    }
    current.push(line);
  }
  if (current.length > 0) blocks.push(current.join('\n'));
  return blocks.length > 0 ? blocks : [normalised];
}

function monthIndex(name: string): number {
  const lower = name.toLowerCase();
  const full = MONTHS.findIndex((month) => month === lower || month.startsWith(lower.slice(0, 3)));
  return full;
}

export interface ParsedDueDate {
  dateISO: string | null;
  matchedText: string;
  ambiguous: boolean;
  reason: string;
}

export function parseDuePhrase(text: string, now: Date = new Date()): ParsedDueDate {
  const lower = text.toLowerCase();
  const base = startOfDay(now);

  if (/\btoday\b/.test(lower)) return { dateISO: toISODate(base), matchedText: 'today', ambiguous: false, reason: '' };
  if (/\btomorrow\b/.test(lower)) return { dateISO: daysFromNow(1, now), matchedText: 'tomorrow', ambiguous: false, reason: '' };
  if (/\bday after tomorrow\b/.test(lower)) {
    return { dateISO: daysFromNow(2, now), matchedText: 'day after tomorrow', ambiguous: false, reason: '' };
  }

  const inDays = /\bin\s+(\d{1,2})\s+days?\b/.exec(lower);
  if (inDays) {
    return { dateISO: daysFromNow(Number(inDays[1]), now), matchedText: inDays[0], ambiguous: false, reason: '' };
  }

  const iso = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/.exec(lower);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    const parsed = new Date(year, month - 1, day);
    if (!Number.isNaN(parsed.getTime()) && parsed.getMonth() === month - 1) {
      return { dateISO: toISODate(parsed), matchedText: iso[0], ambiguous: false, reason: '' };
    }
    return { dateISO: null, matchedText: iso[0], ambiguous: false, reason: 'Invalid ISO date' };
  }

  const weekday = /\b(next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)\b/.exec(
    lower,
  );
  if (weekday) {
    const name = weekday[2];
    const target = WEEKDAY_NAMES.findIndex((day) => day.startsWith(name.slice(0, 3)));
    if (target >= 0) {
      let offset = (target - base.getDay() + 7) % 7;
      if (offset === 0) offset = 7;
      return { dateISO: toISODate(addDays(base, offset)), matchedText: weekday[0], ambiguous: false, reason: '' };
    }
  }

  const dayMonth = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s*,?\s*(\d{4}))?\b/.exec(
    lower,
  );
  if (dayMonth) {
    const day = Number(dayMonth[1]);
    const month = monthIndex(dayMonth[2]);
    const year = dayMonth[3] ? Number(dayMonth[3]) : base.getFullYear();
    if (month >= 0 && day >= 1 && day <= 31) {
      let parsed = new Date(year, month, day);
      if (!dayMonth[3] && parsed.getTime() < base.getTime()) parsed = new Date(year + 1, month, day);
      return { dateISO: toISODate(parsed), matchedText: dayMonth[0], ambiguous: false, reason: '' };
    }
  }

  const monthDay = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*,?\s*(\d{4}))?\b/.exec(
    lower,
  );
  if (monthDay) {
    const month = monthIndex(monthDay[1]);
    const day = Number(monthDay[2]);
    const year = monthDay[3] ? Number(monthDay[3]) : base.getFullYear();
    if (month >= 0 && day >= 1 && day <= 31) {
      let parsed = new Date(year, month, day);
      if (!monthDay[3] && parsed.getTime() < base.getTime()) parsed = new Date(year + 1, month, day);
      return { dateISO: toISODate(parsed), matchedText: monthDay[0], ambiguous: false, reason: '' };
    }
  }

  const numeric =
    /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(lower) ??
    /\b(\d{1,2})\.(\d{1,2})\.(\d{2,4})\b/.exec(lower);
  if (numeric) {
    let first = Number(numeric[1]);
    let second = Number(numeric[2]);
    const yearPart = numeric[3] ? Number(numeric[3]) : base.getFullYear();
    const year = yearPart < 100 ? 2000 + yearPart : yearPart;
    const ambiguous = first <= 12 && second <= 12;
    if (first > 12 && second <= 12) {
      // already day/month
    } else if (second > 12 && first <= 12) {
      const swap = first;
      first = second;
      second = swap;
    }
    const parsed = new Date(year, second - 1, first);
    if (!Number.isNaN(parsed.getTime()) && parsed.getMonth() === second - 1 && parsed.getDate() === first) {
      return {
        dateISO: toISODate(parsed),
        matchedText: numeric[0],
        ambiguous,
        reason: ambiguous ? `“${numeric[0]}” is ambiguous — read as day/month` : '',
      };
    }
    return { dateISO: null, matchedText: numeric[0], ambiguous, reason: `“${numeric[0]}” is not a valid date` };
  }

  return { dateISO: null, matchedText: '', ambiguous: false, reason: '' };
}

export interface ParsedTime {
  time: string;
  matchedText: string;
}

export function parseTimePhrase(text: string): ParsedTime {
  const eod = /\b(eod|end of day)\b/i.exec(text);
  if (eod) return { time: '18:00', matchedText: eod[0] };
  const meridiem = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(text);
  if (meridiem) {
    let hours = Number(meridiem[1]);
    const minutes = meridiem[2] ? Number(meridiem[2]) : 0;
    const isPm = meridiem[3].toLowerCase() === 'pm';
    if (hours < 12 && isPm) hours += 12;
    if (hours === 12 && !isPm) hours = 0;
    if (hours <= 23 && minutes <= 59) {
      return { time: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`, matchedText: meridiem[0] };
    }
  }
  const clock = /\b(\d{1,2}):(\d{2})\b/.exec(text);
  if (clock) {
    const hours = Number(clock[1]);
    const minutes = Number(clock[2]);
    if (hours <= 23 && minutes <= 59) {
      return { time: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`, matchedText: clock[0] };
    }
  }
  return { time: '', matchedText: '' };
}

function parsePriority(text: string): { priority: Priority; matched: boolean } {
  const lower = text.toLowerCase();
  if (/\b(critical|urgent|asap|p0|immediately)\b/.test(lower)) return { priority: 'critical', matched: true };
  if (/\b(high|important|p1|priority)\b/.test(lower)) return { priority: 'high', matched: true };
  if (/\b(low|whenever|later|p3|someday)\b/.test(lower)) return { priority: 'low', matched: true };
  if (/\b(medium|normal|p2)\b/.test(lower)) return { priority: 'medium', matched: true };
  return { priority: 'medium', matched: false };
}

function parseCategory(text: string): { category: Category; matched: boolean } {
  const lower = text.toLowerCase();
  const rules: Array<[Category, RegExp]> = [
    ['follow_up', /\b(follow[- ]?up|check[- ]?in|chase|remind|revert|nudge)\b/],
    ['proposal', /\b(proposal|quote|quotation|estimate|pitch|sow|rfp|tender)\b/],
    ['meeting', /\b(meeting|call|demo|sync|visit|discussion|review call|standup)\b/],
    ['email', /\b(email|e-mail|mail|inbox|reply|respond)\b/],
    ['report', /\b(report|deck|presentation|summary|dashboard|analysis deck)\b/],
    ['research', /\b(research|analyse|analyze|analysis|investigate|explore|benchmark)\b/],
    ['admin', /\b(admin|expense|timesheet|invoice|update crm|data entry)\b/],
  ];
  for (const [category, pattern] of rules) {
    if (pattern.test(lower)) return { category, matched: true };
  }
  return { category: 'other', matched: false };
}

function parseEstimate(text: string): { minutes: number; matched: boolean } {
  const hours = /\b(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/i.exec(text);
  if (hours) return { minutes: Math.round(Number(hours[1]) * 60), matched: true };
  const minutes = /\b(\d+)\s*(?:m|min|mins|minute|minutes)\b/i.exec(text);
  if (minutes) return { minutes: Number(minutes[1]), matched: true };
  return { minutes: 30, matched: false };
}

function parseClient(text: string): string {
  const explicit = /(?:client|customer|account|company)\s*[:-]\s*([^\n,;]+)/i.exec(text);
  if (explicit) return explicit[1].trim().slice(0, 60);
  const withCompany = /\b(?:with|for)\s+([A-Z][A-Za-z0-9&.'-]*(?:\s+[A-Z][A-Za-z0-9&.'-]*){0,3})(?=[\s,.;]|$)/.exec(text);
  if (withCompany) return withCompany[1].trim().slice(0, 60);
  return '';
}

export function parseScreenshotText(rawText: string, now: Date = new Date()): ParsedDraft[] {
  const blocks = splitSectionedBlocks(rawText);
  const drafts: ParsedDraft[] = [];

  for (const entry of blocks) {
    const block = entry.text;
    const lines = block
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) continue;

    const firstLine = lines[0];
    const struckTitle = stripStrikethrough(stripBullets(firstLine));
    const first = stripBullets(firstLine);
    const titleSource = /^(client|customer|account|company|priority|due|deadline)\s*[:-]/i.test(first)
      ? stripStrikethrough(stripBullets(lines[1] ?? first)).text
      : struckTitle.text;
    const title = titleSource.replace(/\s+/g, ' ').slice(0, 160).trim();
    if (!title) continue;
    /* A struck-through title is a hint that the work is done — surfaced in the
       review step, never applied on its own. */
    const completedHint = /^(client|customer|account|company|priority|due|deadline)\s*[:-]/i.test(first)
      ? stripStrikethrough(stripBullets(lines[1] ?? first)).struck
      : struckTitle.struck;

    const notes = lines
      .slice(1)
      .filter((line) => !/^(client|customer|account|company)\s*[:-]/i.test(line))
      .join('\n')
      .trim();

    const due = parseDuePhrase(block, now);
    const time = parseTimePhrase(block);
    const priority = parsePriority(block);
    const category = parseCategory(block);
    const estimate = parseEstimate(block);
    const client = parseClient(block);

    const warnings: string[] = [];
    if (due.ambiguous) warnings.push(due.reason || 'Date is ambiguous — please confirm the exact day.');
    if (due.reason && !due.ambiguous) warnings.push(due.reason);
    if (!due.dateISO && /\b(deadline|due|by)\b/i.test(block)) {
      warnings.push('A deadline was mentioned but no clear date could be read — please set it manually.');
    }
    if (due.dateISO && dayOffset(due.dateISO, now) < 0) {
      warnings.push(`Parsed date ${due.dateISO} is in the past — confirm before saving.`);
    }

    let confidence = 40;
    if (title.length >= 6) confidence += 10;
    if (due.dateISO) confidence += 20;
    if (client) confidence += 10;
    if (priority.matched) confidence += 5;
    if (category.matched) confidence += 10;
    if (estimate.matched) confidence += 5;
    if (warnings.length > 0) confidence -= warnings.length * 8;

    drafts.push({
      title,
      notes,
      client,
      category: category.category,
      priority: priority.priority,
      estimatedMinutes: clamp(estimate.minutes, 5, 480),
      dueDate: due.dateISO,
      dueTime: time.time,
      confidence: clamp(confidence, 10, 95),
      warnings,
      rawText: block,
      section: entry.section,
      completedHint,
    });
  }

  return drafts;
}

function normaliseTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function titleSimilarity(a: string, b: string): number {
  const first = new Set(normaliseTitle(a).split(' ').filter(Boolean));
  const second = new Set(normaliseTitle(b).split(' ').filter(Boolean));
  if (first.size === 0 || second.size === 0) return 0;
  let overlap = 0;
  for (const token of first) if (second.has(token)) overlap += 1;
  return overlap / Math.max(first.size, second.size);
}

export function findDuplicate(draft: ParsedDraft, existing: Task[]): Task | null {
  for (const task of existing) {
    if (task.deletedAt !== null) continue;
    if (task.status === 'completed') continue;
    if (normaliseTitle(task.title) === normaliseTitle(draft.title)) return task;
    if (titleSimilarity(task.title, draft.title) >= 0.8) return task;
  }
  return null;
}

export function draftToTask(draft: ParsedDraft, settings: Settings, now: Date = new Date()): Task {
  const iso = now.toISOString();
  return {
    id: '',
    title: draft.title,
    notes: draft.notes,
    client: draft.client,
    category: draft.category,
    priority: draft.priority || settings.defaultPriority,
    estimatedMinutes: draft.estimatedMinutes,
    actualMinutes: 0,
    dueDate: draft.dueDate,
    dueTime: draft.dueTime || '',
    scheduledFor: null,
    suggestedDate: null,
    suggestedStart: null,
    status: 'inbox',
    blocked: false,
    dependencyIds: [],
    deferrals: 0,
    createdAt: iso,
    updatedAt: iso,
    completedAt: null,
    deletedAt: null,
    source: 'ocr',
    graphRef: null,
    section: draft.section || undefined,
  };
}

export function describeCategory(category: Category): string {
  return CATEGORIES[category].label;
}

export function countOpenTasks(tasks: Task[]): number {
  return tasks.filter((task) => task.status !== 'completed' && task.deletedAt === null).length;
}

export function dueTodayCount(tasks: Task[], now: Date = new Date()): number {
  const iso = toISODate(now);
  return tasks.filter(
    (task) => task.deletedAt === null && task.status !== 'completed' && task.dueDate === iso,
  ).length;
}

export function fromDateInput(value: string): string | null {
  if (!value) return null;
  const parsed = fromISODate(value);
  return Number.isNaN(parsed.getTime()) ? null : toISODate(parsed);
}
