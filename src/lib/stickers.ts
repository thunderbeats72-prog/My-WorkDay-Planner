/**
 * Stickers — the smallest possible reward.
 *
 * A planner is a tool, but finishing something deserves an acknowledgement
 * that is not a modal. These are tiny ink stamps, the kind you would put in
 * the corner of a page: monochrome, drawn from the same ink as the rest of the
 * product, never confetti for every tap.
 *
 * Two rules keep them meaningful:
 *   · The sticker is chosen by *what happened*, not at random, so "Clean
 *     sweep" means the board is actually clear.
 *   · They are recorded, so the Completed page can show the collection and a
 *     person can see a week of work as something other than a list.
 *
 * Nothing here touches the network. The shelf lives in localStorage.
 */

export type StickerGlyph =
  | 'spark'
  | 'chevrons'
  | 'rings'
  | 'check-ring'
  | 'crescent'
  | 'sunrise'
  | 'flag'
  | 'bars';

export interface Sticker {
  id: string;
  name: string;
  glyph: StickerGlyph;
  /** Why this one, in the assistant's voice. Filled in by `stickerCaption`. */
  tone: 'ink' | 'success';
}

export const STICKERS: Record<string, Sticker> = {
  'first-light': { id: 'first-light', name: 'First one down', glyph: 'spark', tone: 'ink' },
  momentum: { id: 'momentum', name: 'Momentum', glyph: 'chevrons', tone: 'ink' },
  'deep-work': { id: 'deep-work', name: 'Deep work', glyph: 'rings', tone: 'ink' },
  'clean-sweep': { id: 'clean-sweep', name: 'Clean sweep', glyph: 'check-ring', tone: 'success' },
  'night-owl': { id: 'night-owl', name: 'Night owl', glyph: 'crescent', tone: 'ink' },
  'early-bird': { id: 'early-bird', name: 'Early bird', glyph: 'sunrise', tone: 'ink' },
  finisher: { id: 'finisher', name: 'Finisher', glyph: 'flag', tone: 'success' },
  steady: { id: 'steady', name: 'Steady hand', glyph: 'bars', tone: 'ink' },
};

export interface StickerInput {
  /** How many tasks are done today, including the one just finished. */
  completedToday: number;
  /** Consecutive days with at least one completion. */
  streakDays: number;
  /** Local hour of the completion, 0–23. */
  hour: number;
  /** True when nothing is left open on today's board. */
  clearedAll: boolean;
}

/**
 * Pick the sticker that is actually true.
 *
 * Ordered by how rare the moment is: clearing the board beats finishing ten,
 * which beats being up early or late. Two people finishing their first task
 * get the same sticker — that is what makes it a stamp rather than a slot
 * machine.
 */
export function stickerFor(input: StickerInput): Sticker {
  const { completedToday, streakDays, hour, clearedAll } = input;
  if (clearedAll) return STICKERS['clean-sweep'];
  if (completedToday >= 10) return STICKERS.finisher;
  if (completedToday >= 5) return STICKERS['deep-work'];
  if (hour < 11) return STICKERS['early-bird'];
  if (hour >= 21) return STICKERS['night-owl'];
  if (streakDays >= 3) return STICKERS.steady;
  if (completedToday === 1) return STICKERS['first-light'];
  return STICKERS.momentum;
}

/**
 * The assistant's one line, under the stamp.
 *
 * It says what just happened and what it would do next, in that order — the
 * same two sentences a good colleague would offer, and never a lecture.
 */
export function stickerCaption(
  sticker: Sticker,
  input: { completedToday: number; nextTitle?: string | null },
): string {
  const done = input.completedToday;
  const tail = input.nextTitle ? ` Next: ${input.nextTitle}.` : '';
  switch (sticker.id) {
    case 'clean-sweep':
      return `Board clear. ${done} ${done === 1 ? 'task' : 'tasks'} today — enjoy the quiet.`;
    case 'finisher':
      return `${done} finished today. That is a full day of work.${tail}`;
    case 'deep-work':
      return `${done} down. You are past the hard part of the day.${tail}`;
    case 'early-bird':
      return `Done before eleven. ${done === 1 ? 'A quiet start' : `${done} already`}.${tail}`;
    case 'night-owl':
      return `Still going — that is ${done} today. Wrap up when you can.${tail}`;
    case 'steady':
      return `${done} today, and a streak behind it.${tail}`;
    case 'first-light':
      return `First one down.${tail}`;
    default:
      return `${done} done today. Keep the rhythm.${tail}`;
  }
}

/* ------------------------------------------------------------------ shelf */

/** `2026-01-05` for a timestamp, in the browser's own timezone. */
export function localDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

const SHELF_KEY = 'workday.stickers.v1';
const SHELF_LIMIT = 60;

export interface EarnedSticker {
  id: string;
  at: string;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadShelf(): EarnedSticker[] {
  try {
    const raw = storage()?.getItem(SHELF_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is EarnedSticker =>
        Boolean(entry) &&
        typeof entry === 'object' &&
        typeof (entry as EarnedSticker).id === 'string' &&
        typeof (entry as EarnedSticker).at === 'string',
    );
  } catch {
    return [];
  }
}

/** Newest first, capped. A sticker shelf is a keepsake, not a log. */
export function recordSticker(list: EarnedSticker[], id: string, at: string): EarnedSticker[] {
  return [{ id, at }, ...list].slice(0, SHELF_LIMIT);
}

export function saveShelf(list: EarnedSticker[]): void {
  try {
    storage()?.setItem(SHELF_KEY, JSON.stringify(list.slice(0, SHELF_LIMIT)));
  } catch {
    // Private mode: the sticker still appears, it just is not kept.
  }
}

/**
 * How many consecutive days, ending today or yesterday, have a sticker.
 *
 * Yesterday counts as the live streak until the day is over — otherwise the
 * count would drop to zero every midnight and tell a lie about someone's week.
 */
export function streakFrom(list: EarnedSticker[], today: string): number {
  // A sticker is stamped with an ISO timestamp; its *local* day is what a
  // person would call "the day I did that".
  const days = [...new Set(list.map((entry) => localDay(entry.at)))].sort().reverse();
  if (days.length === 0) return 0;
  const start = days.includes(today) ? 0 : 1;
  const dayMs = 86_400_000;
  let streak = 0;
  let cursor = Date.parse(`${today}T00:00:00.000Z`);
  if (start === 1) {
    // No sticker today yet; a streak still stands if yesterday has one.
    if (!days.includes(new Date(cursor - dayMs).toISOString().slice(0, 10))) return 0;
    cursor -= dayMs;
  }
  for (;;) {
    const key = new Date(cursor).toISOString().slice(0, 10);
    if (!days.includes(key)) break;
    streak += 1;
    cursor -= dayMs;
  }
  return streak;
}
