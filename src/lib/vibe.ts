/**
 * A tiny, honest "vibe" read on the day.
 *
 * It is derived only from numbers the planner already knows (deadlines,
 * completion, planned capacity) and is deterministic — no ML, no guessing.
 * The point is a single glanceable sentence about how the day *feels*.
 */

export type VibeTone = 'danger' | 'warning' | 'primary' | 'success' | 'neutral';

export interface DayVibe {
  label: string;
  glyph: string;
  tone: VibeTone;
  note: string;
  /** 0–100, higher = calmer day. Used by the little meter in the hero. */
  score: number;
}

export interface VibeInput {
  overdue: number;
  dueToday: number;
  completedToday: number;
  plannedPercent: number;
  openCount: number;
}

export function dayVibe(input: VibeInput): DayVibe {
  const { overdue, dueToday, completedToday, plannedPercent, openCount } = input;

  if (openCount === 0) {
    return {
      label: 'Wide open',
      glyph: '✦',
      tone: 'success',
      note: 'Nothing on the board. A rare and beautiful thing.',
      score: 98,
    };
  }

  if (overdue >= 3) {
    return {
      label: 'Firefighting',
      glyph: '◍',
      tone: 'danger',
      note: `${overdue} deadlines have slipped. Triage the oldest first.`,
      score: 24,
    };
  }

  if (overdue > 0) {
    return {
      label: 'Triage mode',
      glyph: '◍',
      tone: 'warning',
      note: `${overdue} task${overdue === 1 ? '' : 's'} past the deadline. Clear the queue before adding more.`,
      score: 46,
    };
  }

  if (plannedPercent >= 85) {
    return {
      label: 'Locked in',
      glyph: '◆',
      tone: 'primary',
      note: 'Your day is nearly fully committed. Protect the focus blocks.',
      score: 68,
    };
  }

  if (completedToday > 0 && dueToday === 0) {
    return {
      label: 'In the flow',
      glyph: '✦',
      tone: 'success',
      note: 'Ahead of the curve with nothing overdue. Keep the streak.',
      score: 92,
    };
  }

  if (dueToday > 0) {
    return {
      label: 'On the move',
      glyph: '▲',
      tone: 'primary',
      note: `${dueToday} deadline${dueToday === 1 ? '' : 's'} today, and the schedule still has room.`,
      score: 74,
    };
  }

  return {
    label: 'Cruising',
    glyph: '◦',
    tone: 'neutral',
    note: 'Nothing urgent, nothing overdue. A good afternoon for deep work.',
    score: 84,
  };
}
