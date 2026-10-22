/**
 * The assistant's one sentence.
 *
 * A planner tells you what is on the list. An assistant notices the thing you
 * would have noticed a day late, says it once, and offers the next step. This
 * module holds that judgement so it can be tested — and so the app never
 * interrupts with the same observation twice in one day.
 */

export interface Nudge {
  key: string;
  message: string;
  actionLabel: string;
  /** Where the action takes you. */
  page: 'today' | 'tasks' | 'reports';
}

export interface NudgeInput {
  overdue: number;
  dueToday: number;
  openCount: number;
  /** Local hour, 0–23. */
  hour: number;
}

/**
 * At most one nudge, chosen by urgency. Silence is the default.
 *
 * Order matters: a slipped deadline outranks a full afternoon, which outranks
 * an empty morning. If nothing is worth saying, say nothing — an assistant
 * that speaks every time you open the door is a notification, not help.
 */
export function nudgeFor(input: NudgeInput): Nudge | null {
  const { overdue, dueToday, openCount, hour } = input;

  if (overdue >= 2) {
    return {
      key: 'overdue',
      message: `${overdue} tasks are past their deadline. The oldest is usually the cheapest to clear.`,
      actionLabel: 'Show overdue',
      page: 'tasks',
    };
  }
  if (overdue === 1) {
    return {
      key: 'overdue-one',
      message: 'One task slipped past its deadline. It is at the top of your list whenever you are ready.',
      actionLabel: 'Show it',
      page: 'tasks',
    };
  }
  if (dueToday >= 3 && hour >= 14) {
    return {
      key: 'afternoon-rush',
      message: `${dueToday} deadlines land today and the afternoon is already going. The plan below is ordered for that.`,
      actionLabel: 'Open today',
      page: 'today',
    };
  }
  if (openCount > 0 && dueToday === 0 && hour < 10) {
    return {
      key: 'quiet-morning',
      message: 'Nothing is due today. Twenty minutes on one task now buys you a calm afternoon.',
      actionLabel: 'Pick one',
      page: 'today',
    };
  }
  return null;
}

const SEEN_KEY = 'workday.nudge.v1';

interface SeenRecord {
  day: string;
  keys: string[];
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function readSeen(): SeenRecord {
  try {
    const raw = storage()?.getItem(SEEN_KEY);
    if (!raw) return { day: '', keys: [] };
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { day: '', keys: [] };
    const record = parsed as Partial<SeenRecord>;
    return {
      day: typeof record.day === 'string' ? record.day : '',
      keys: Array.isArray(record.keys) ? record.keys.filter((key): key is string => typeof key === 'string') : [],
    };
  } catch {
    return { day: '', keys: [] };
  }
}

/** True when this exact nudge has already been delivered today. */
export function wasNudged(nudge: Nudge, today: string): boolean {
  const seen = readSeen();
  return seen.day === today && seen.keys.includes(nudge.key);
}

export function markNudged(nudge: Nudge, today: string): void {
  const seen = readSeen();
  const keys = seen.day === today ? [...new Set([...seen.keys, nudge.key])] : [nudge.key];
  try {
    storage()?.setItem(SEEN_KEY, JSON.stringify({ day: today, keys } satisfies SeenRecord));
  } catch {
    // Private mode: the nudge simply repeats next time.
  }
}
