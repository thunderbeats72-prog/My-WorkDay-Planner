import { describe, expect, it } from 'vitest';
import {
  addWorkTime,
  deadlineMoment,
  durationModel,
  forecastTask,
  mulberry32,
  triangular,
} from './forecast';
import type { LearnedDurations } from './engine';
import type { Settings, Task } from './types';
import { DEFAULT_SETTINGS } from './types';

const settings: Settings = { ...DEFAULT_SETTINGS, workingDays: [1, 2, 3, 4, 5] };

function task(over: Partial<Task> = {}): Task {
  return {
    id: 'tsk_forecast',
    title: 'Send proposal',
    notes: '',
    client: '',
    category: 'proposal',
    priority: 'high',
    estimatedMinutes: 60,
    actualMinutes: 0,
    dueDate: '2026-10-27', // a Tuesday
    dueTime: '17:00',
    scheduledFor: null,
    suggestedDate: null,
    suggestedStart: null,
    status: 'open',
    blocked: false,
    dependencyIds: [],
    deferrals: 0,
    createdAt: '2026-10-20T09:00:00.000Z',
    updatedAt: '2026-10-20T09:00:00.000Z',
    completedAt: null,
    deletedAt: null,
    source: 'manual',
    graphRef: null,
    ...over,
  } as Task;
}

// Wednesday 2026-10-21, 10:00 local — a working day.
const NOW = new Date(2026, 9, 21, 10, 0, 0);

describe('the working-calendar walk', () => {
  it('spends minutes only inside working hours, skipping lunch', () => {
    // 60 minutes from 10:00 → 11:00 (lunch untouched).
    expect(addWorkTime(new Date(2026, 9, 21, 10, 0), 60, settings)).toEqual(new Date(2026, 9, 21, 11, 0));
    // 60 minutes from 12:30 → 30m to lunch, then 13:45 + 30 = 14:15.
    expect(addWorkTime(new Date(2026, 9, 21, 12, 30), 60, settings)).toEqual(new Date(2026, 9, 21, 14, 15));
  });

  it('never works nights or weekends', () => {
    // Friday 17:30 + 2h → 30m remain at end of Friday, then Monday
    // 09:00 + the other 90 minutes = 10:30.
    const friday = new Date(2026, 9, 23, 17, 30);
    expect(addWorkTime(friday, 120, settings)).toEqual(new Date(2026, 9, 26, 10, 30));
  });

  it('crosses a full day when the estimate demands it', () => {
    const finish = addWorkTime(new Date(2026, 9, 21, 16, 0), 480, settings); // 8h from 16:00
    expect(finish.getTime()).toBeGreaterThan(new Date(2026, 9, 21, 18, 0).getTime());
    expect(finish.getDay()).toBe(4); // Thursday
  });

  it('refuses to invent time when the working hours are broken', () => {
    const broken = { ...settings, workdayStart: '18:00', workdayEnd: '09:00' };
    const from = new Date(2026, 9, 21, 10, 0);
    expect(addWorkTime(from, 60, broken)).toEqual(from);
  });
});

describe('the duration model', () => {
  it('prefers the client median, with its evidence', () => {
    const learned: LearnedDurations = {
      byCategory: { proposal: 90 },
      byClient: { Nova: 45 },
      samples: { byCategory: { proposal: 5 }, byClient: { Nova: 4 } },
    };
    const model = durationModel(task({ client: 'Nova' }), learned);
    expect(model.source).toBe('client');
    expect(model.medianMinutes).toBe(45);
    expect(model.reasons[0]).toContain('4 timed');
  });

  it('falls to the category median', () => {
    const learned: LearnedDurations = {
      byCategory: { proposal: 90 },
      byClient: {},
      samples: { byCategory: { proposal: 7 }, byClient: {} },
    };
    const model = durationModel(task(), learned);
    expect(model.source).toBe('category');
    expect(model.medianMinutes).toBe(90);
  });

  it('corrects the raw estimate with the measured bias — the label included', () => {
    const learned: LearnedDurations = {
      byCategory: {},
      byClient: {},
      factors: { proposal: 1.4 },
      samples: { byCategory: { proposal: 6 }, byClient: {} },
    };
    const model = durationModel(task({ estimatedMinutes: 60 }), learned);
    expect(model.source).toBe('corrected');
    expect(model.medianMinutes).toBe(84);
    expect(model.factor).toBe(1.4);
    expect(model.reasons[0]).toContain('×1.4');
    expect(model.reasons[0]).toContain('long');
  });

  it('says so when nothing is learned yet', () => {
    const model = durationModel(task(), null);
    expect(model.source).toBe('estimate');
    expect(model.medianMinutes).toBe(60);
    expect(model.reasons[0]).toMatch(/no timing history/i);
  });
});

describe('deadline forecasts', () => {
  const rng = () => 0.5; // constant draws — triangular returns its mode

  it('is deterministic with an injected rng and lands on the median date', () => {
    const result = forecastTask({ task: task(), tasks: [], settings, learned: null, now: NOW, runs: 200, rng });
    expect(result).not.toBeNull();
    expect(result!.medianDate).toBe('2026-10-21'); // 60m from 10:00 finishes today
    expect(result!.pOnTime).toBe(100); // deadline is Tuesday
    expect(result!.bandStart).toBe(result!.bandEnd);
    expect(result!.runs).toBe(200);
  });

  it('drops the on-time percent when the deadline is already gone', () => {
    const past = task({ dueDate: '2026-10-21', dueTime: '10:30' }); // half an hour from now, 60m of work
    const result = forecastTask({ task: past, tasks: [], settings, learned: null, now: NOW, runs: 100, rng });
    expect(result!.pOnTime).toBe(0);
  });

  it('has no on-time percent without a deadline, but still forecasts dates', () => {
    const undated = task({ dueDate: null, dueTime: '' });
    const result = forecastTask({ task: undated, tasks: [], settings, learned: null, now: NOW, runs: 50, rng });
    expect(result!.pOnTime).toBeNull();
    expect(result!.medianDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result!.reasons.join(' ')).toMatch(/no deadline/i);
  });

  it('deferral history lowers confidence — same rng, fewer guarantees', () => {
    const calm = forecastTask({ task: task(), tasks: [], settings, learned: null, now: NOW, runs: 400, rng: mulberry32(42) });
    const jumpy = forecastTask({
      task: task({ deferrals: 3 }),
      tasks: [],
      settings,
      learned: null,
      now: NOW,
      runs: 400,
      rng: mulberry32(42),
    });
    expect(jumpy!.pOnTime!).toBeLessThanOrEqual(calm!.pOnTime!);
    expect(jumpy!.reasons.join(' ')).toMatch(/restart/i);
  });

  it('a short deadline with a learned 4-hour duration is not optimistic', () => {
    const learned: LearnedDurations = {
      byCategory: { proposal: 240 },
      byClient: {},
      samples: { byCategory: { proposal: 9 }, byClient: {} },
    };
    const tight = task({ dueDate: '2026-10-21', dueTime: '13:00' }); // 3h away, needs 4h+
    const result = forecastTask({ task: tight, tasks: [], settings, learned, now: NOW, runs: 300, rng });
    expect(result!.pOnTime!).toBeLessThan(40);
    expect(result!.model.source).toBe('category');
  });

  it('every forecast explains itself', () => {
    const result = forecastTask({ task: task(), tasks: [], settings, learned: null, now: NOW, runs: 10, rng });
    expect(result!.reasons.length).toBeGreaterThanOrEqual(3);
    expect(result!.reasons.join(' ')).toMatch(/calendar/i);
  });

  it('completed and deleted tasks are not forecast', () => {
    expect(forecastTask({ task: task({ status: 'completed' }), tasks: [], settings, learned: null, now: NOW })).toBeNull();
    expect(
      forecastTask({ task: task({ deletedAt: '2026-10-20T00:00:00.000Z' }), tasks: [], settings, learned: null, now: NOW }),
    ).toBeNull();
  });
});

describe('primitives', () => {
  it('the seeded rng is reproducible and in [0,1)', () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    for (let i = 0; i < 20; i += 1) {
      const value = a();
      expect(value).toBe(b());
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('triangular stays inside its bounds and peaks near the mode', () => {
    const rng = mulberry32(99);
    let sum = 0;
    for (let i = 0; i < 500; i += 1) {
      const v = triangular(rng, 10, 20, 40);
      expect(v).toBeGreaterThanOrEqual(10);
      expect(v).toBeLessThanOrEqual(40);
      sum += v;
    }
    expect(sum / 500).toBeGreaterThan(18);
    expect(sum / 500).toBeLessThan(30);
    expect(triangular(() => 0.5, 10, 10, 10)).toBe(10);
  });

  it('the deadline moment falls back to the end of the workday', () => {
    const withTime = deadlineMoment(task(), settings);
    expect(withTime).toEqual(new Date(2026, 9, 27, 17, 0));
    const noTime = deadlineMoment(task({ dueTime: '' }), settings);
    expect(noTime).toEqual(new Date(2026, 9, 27, 18, 0)); // workdayEnd default 18:00
    expect(deadlineMoment(task({ dueDate: null }), settings)).toBeNull();
  });
});
