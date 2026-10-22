import { describe, expect, it } from 'vitest';
import { markNudged, nudgeFor, readSeen, wasNudged } from './assistant';

const quiet = { overdue: 0, dueToday: 0, openCount: 0, hour: 9 };

describe('what the assistant chooses to say', () => {
  it('says nothing at all when there is nothing to say', () => {
    expect(nudgeFor(quiet)).toBeNull();
    // Busy, but nothing urgent and nothing full: silence is still correct.
    expect(nudgeFor({ overdue: 0, dueToday: 1, openCount: 4, hour: 15 })).toBeNull();
  });

  it('leads with slipped deadlines', () => {
    const nudge = nudgeFor({ ...quiet, overdue: 3, openCount: 9, hour: 11 });
    expect(nudge?.key).toBe('overdue');
    expect(nudge?.message).toContain('3');
    expect(nudge?.page).toBe('tasks');
  });

  it('still mentions a single slip', () => {
    expect(nudgeFor({ ...quiet, overdue: 1, openCount: 2 })?.key).toBe('overdue-one');
  });

  it('warns about a crowded afternoon, not a crowded morning', () => {
    expect(nudgeFor({ ...quiet, dueToday: 4, openCount: 4, hour: 10 })).toBeNull();
    expect(nudgeFor({ ...quiet, dueToday: 4, openCount: 4, hour: 15 })?.key).toBe('afternoon-rush');
  });

  it('suggests getting ahead on an empty morning', () => {
    const nudge = nudgeFor({ ...quiet, openCount: 3, hour: 8 });
    expect(nudge?.key).toBe('quiet-morning');
    expect(nudge?.page).toBe('today');
  });

  it('always gives the button something to do', () => {
    for (const input of [
      { ...quiet, overdue: 5 },
      { ...quiet, dueToday: 5, hour: 16 },
      { ...quiet, openCount: 2, hour: 7 },
    ]) {
      const nudge = nudgeFor(input);
      if (!nudge) continue;
      expect(nudge.actionLabel.length).toBeGreaterThan(0);
      expect(['today', 'tasks', 'reports']).toContain(nudge.page);
    }
  });
});

describe('the assistant does not repeat itself', () => {
  it('remembers a nudge for the day it was given', () => {
    localStorage.clear();
    const nudge = nudgeFor({ ...quiet, overdue: 2 })!;
    expect(wasNudged(nudge, '2026-01-05')).toBe(false);
    markNudged(nudge, '2026-01-05');
    expect(wasNudged(nudge, '2026-01-05')).toBe(true);
  });

  it('forgets overnight', () => {
    localStorage.clear();
    const nudge = nudgeFor({ ...quiet, overdue: 2 })!;
    markNudged(nudge, '2026-01-05');
    expect(wasNudged(nudge, '2026-01-06')).toBe(false);
  });

  it('keeps several observations from the same day without crowding', () => {
    localStorage.clear();
    const a = nudgeFor({ ...quiet, overdue: 2 })!;
    const b = nudgeFor({ ...quiet, openCount: 2, hour: 8 })!;
    markNudged(a, '2026-01-05');
    markNudged(b, '2026-01-05');
    expect(readSeen().keys).toEqual([a.key, b.key]);
    expect(wasNudged(a, '2026-01-05')).toBe(true);
    expect(wasNudged(b, '2026-01-05')).toBe(true);
  });
});
