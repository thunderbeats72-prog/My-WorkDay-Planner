import { describe, expect, it } from 'vitest';
import { dayVibe } from './vibe';

const base = { overdue: 0, dueToday: 0, completedToday: 0, plannedPercent: 0, openCount: 4 };

describe('dayVibe', () => {
  it('celebrates an empty board', () => {
    expect(dayVibe({ ...base, openCount: 0 })).toMatchObject({ label: 'Wide open', tone: 'success' });
  });

  it('escalates to firefighting when several deadlines slipped', () => {
    expect(dayVibe({ ...base, overdue: 4 })).toMatchObject({ label: 'Firefighting', tone: 'danger' });
  });

  it('uses triage for a single slip', () => {
    expect(dayVibe({ ...base, overdue: 1 })).toMatchObject({ label: 'Triage mode', tone: 'warning' });
  });

  it('flags a heavily committed day', () => {
    expect(dayVibe({ ...base, plannedPercent: 92 })).toMatchObject({ label: 'Locked in' });
  });

  it('recognises flow when work is done and nothing is due', () => {
    expect(dayVibe({ ...base, completedToday: 2 })).toMatchObject({ label: 'In the flow', tone: 'success' });
  });

  it('reports a normal day with deadlines as on the move', () => {
    expect(dayVibe({ ...base, dueToday: 3 })).toMatchObject({ label: 'On the move' });
  });

  it('falls back to cruising for a quiet board', () => {
    expect(dayVibe(base)).toMatchObject({ label: 'Cruising', tone: 'neutral' });
  });

  it('always returns a bounded score and a note', () => {
    const cases = [
      { ...base, openCount: 0 },
      { ...base, overdue: 9 },
      { ...base, plannedPercent: 100 },
      { ...base, dueToday: 2, completedToday: 3 },
    ];
    for (const input of cases) {
      const vibe = dayVibe(input);
      expect(vibe.score).toBeGreaterThanOrEqual(0);
      expect(vibe.score).toBeLessThanOrEqual(100);
      expect(vibe.note.length).toBeGreaterThan(0);
      expect(vibe.glyph.length).toBeGreaterThan(0);
    }
  });
});
