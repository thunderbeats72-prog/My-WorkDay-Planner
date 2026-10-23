import { describe, expect, it } from 'vitest';
import { nextWorkingISO, rehearsalFor } from './rehearsal';
import type { Settings, Task } from './types';
import { DEFAULT_SETTINGS } from './types';

const settings: Settings = { ...DEFAULT_SETTINGS, workingDays: [1, 2, 3, 4, 5] };

function task(over: Partial<Task> = {}): Task {
  return {
    id: over.id ?? 'tsk_a',
    title: 'Thing to do',
    notes: '',
    client: '',
    category: 'follow_up',
    priority: 'medium',
    estimatedMinutes: 60,
    actualMinutes: 0,
    dueDate: null,
    dueTime: '',
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

// Wednesday 2026-10-21 → next working day is Thursday 2026-10-22.
const NOW = new Date(2026, 9, 21, 18, 30, 0);

describe('tomorrow rehearsal', () => {
  it('finds the next working day, skipping weekends', () => {
    expect(nextWorkingISO(settings, NOW)).toBe('2026-10-22');
    expect(nextWorkingISO(settings, new Date(2026, 9, 23, 12, 0))).toBe('2026-10-26'); // Friday → Monday
  });

  it('is quiet when nothing is dated for tomorrow', () => {
    expect(rehearsalFor([task({ suggestedDate: '2026-10-21', dueDate: '2026-10-21' })], settings, NOW)).toBeNull();
  });

  it('counts demand, capacity and the overflow between them', () => {
    const tasks = [
      task({ id: 'a', suggestedDate: '2026-10-22', estimatedMinutes: 120 }),
      task({ id: 'b', suggestedDate: '2026-10-22', estimatedMinutes: 180 }),
      task({ id: 'c', suggestedDate: '2026-10-22', estimatedMinutes: 300 }),
    ];
    const rehearsal = rehearsalFor(tasks, settings, NOW)!;
    expect(rehearsal.date).toBe('2026-10-22');
    expect(rehearsal.capacityMinutes).toBe(495); // 09:00–18:00 minus the 45m lunch
    expect(rehearsal.demandMinutes).toBe(600);
    expect(rehearsal.overflowMinutes).toBe(105);
    expect(rehearsal.dated).toHaveLength(3);
  });

  it('flags a deadline that day with no slot left for it', () => {
    // More due-that-day than the calendar can hold, all with tight deadlines.
    const tasks = Array.from({ length: 9 }, (_, index) =>
      task({
        id: `t${index}`,
        suggestedDate: '2026-10-22',
        dueDate: '2026-10-22',
        estimatedMinutes: 120,
        priority: 'high',
      }),
    );
    const rehearsal = rehearsalFor(tasks, settings, NOW)!;
    expect(rehearsal.overflowMinutes).toBeGreaterThan(0);
    expect(rehearsal.atRisk.length).toBeGreaterThan(0);
    for (const risk of rehearsal.atRisk) expect(risk.task.dueDate).toBe('2026-10-22');
  });

  it('suggests pushing only work whose deadline allows it, least urgent first', () => {
    const tasks = [
      task({ id: 'due-that-day', suggestedDate: '2026-10-22', dueDate: '2026-10-22', estimatedMinutes: 480 }),
      task({ id: 'low-later', suggestedDate: '2026-10-22', dueDate: '2026-10-30', estimatedMinutes: 240, priority: 'low' }),
      task({ id: 'critical-later', suggestedDate: '2026-10-22', dueDate: '2026-10-24', estimatedMinutes: 240, priority: 'critical' }),
    ];
    const rehearsal = rehearsalFor(tasks, settings, NOW)!;
    // Demand 960 vs 480 capacity → overflow 480. The critical later task is
    // more urgent than the low one, so low moves first among the safe set…
    expect(rehearsal.suggestedDefers.every((item) => item.task.dueDate! > '2026-10-22')).toBe(true);
    expect(rehearsal.suggestedDefers.some((item) => item.task.id === 'due-that-day')).toBe(false);
    expect(rehearsal.suggestedDefers[0]?.task.id).toBe('low-later');
    // …and the stops once the day fits.
    const deferred = rehearsal.suggestedDefers.reduce((sum, item) => sum + item.estimateMinutes, 0);
    expect(deferred).toBeGreaterThanOrEqual(Math.min(480, rehearsal.overflowMinutes));
  });

  it('uses calibrated durations for the demand, not the wish', () => {
    const tasks = [task({ id: 'a', suggestedDate: '2026-10-22', estimatedMinutes: 100 })];
    const plain = rehearsalFor(tasks, settings, NOW, null)!;
    const corrected = rehearsalFor(tasks, settings, NOW, {
      byCategory: {},
      byClient: {},
      factors: { follow_up: 2 },
    })!;
    expect(plain.demandMinutes).toBe(100);
    expect(corrected.demandMinutes).toBe(200);
  });
});
