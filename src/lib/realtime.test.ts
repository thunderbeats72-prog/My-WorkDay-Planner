import { describe, expect, it } from 'vitest';
import { countdownLabel, taskDueAt } from './dates';
import { DEFAULT_SETTINGS } from './types';
import type { Task } from './types';
import { buildReminders } from './engine';

const NOW = new Date(2026, 9, 21, 15, 30, 0); // Wed 21 Oct 2026, 15:30

function at(minutes: number): Date {
  return new Date(NOW.getTime() + minutes * 60_000);
}

function makeTask(overrides: Partial<Task> & { id: string }): Task {
  const iso = NOW.toISOString();
  const { id, ...rest } = overrides;
  return {
    id,
    title: overrides.title ?? 'Test task',
    notes: '',
    client: '',
    category: 'other',
    priority: 'medium',
    estimatedMinutes: 30,
    actualMinutes: 0,
    dueDate: null,
    dueTime: '',
    scheduledFor: null,
    suggestedDate: null,
    suggestedStart: null,
    status: 'todo',
    blocked: false,
    dependencyIds: [],
    deferrals: 0,
    createdAt: iso,
    updatedAt: iso,
    completedAt: null,
    deletedAt: null,
    source: 'manual',
    graphRef: null,
    ...rest,
  };
}

describe('countdownLabel', () => {
  it('counts down in minutes, then hours, then days', () => {
    expect(countdownLabel(at(45), NOW)).toBe('45m');
    expect(countdownLabel(at(90), NOW)).toBe('1h 30m');
    expect(countdownLabel(at(120), NOW)).toBe('2h');
    expect(countdownLabel(at(60 * 30), NOW)).toBe('1d 6h');
    expect(countdownLabel(at(60 * 48), NOW)).toBe('2d');
  });

  it('never shows a negative countdown', () => {
    expect(countdownLabel(at(-1), NOW)).toBe('due now');
    expect(countdownLabel(NOW, NOW)).toBe('due now');
    expect(countdownLabel(at(-600), NOW)).toBe('due now');
  });

  it('rounds to the minute so a 15s tick cannot jitter', () => {
    const almost = new Date(NOW.getTime() + 29_000);
    expect(countdownLabel(almost, NOW)).toBe('under a minute');
    expect(countdownLabel(new Date(NOW.getTime() + 31_000), NOW)).toBe('1m');
  });
});

describe('taskDueAt', () => {
  it('defaults to 17:00 when no time is set', () => {
    const due = taskDueAt(makeTask({ id: 'a', dueDate: '2026-10-21' }));
    expect(due?.getHours()).toBe(17);
    expect(due?.getMinutes()).toBe(0);
  });

  it('honours an explicit time and returns null without a date', () => {
    const due = taskDueAt(makeTask({ id: 'b', dueDate: '2026-10-21', dueTime: '09:15' }));
    expect(due?.getHours()).toBe(9);
    expect(due?.getMinutes()).toBe(15);
    expect(taskDueAt(makeTask({ id: 'c' }))).toBeNull();
  });
});

describe('live reminders', () => {
  const settings = { ...DEFAULT_SETTINGS, reminderLeadMinutes: 60 };

  it('surfaces only work whose deadline is inside the lead window', () => {
    const soon = makeTask({ id: 'soon', dueDate: '2026-10-21', dueTime: '16:00' });
    const later = makeTask({ id: 'later', dueDate: '2026-10-21', dueTime: '18:30' });
    const ids = buildReminders([soon, later], settings, NOW).map((item) => item.task.id);
    expect(ids).toEqual(['soon']);
  });

  it('moves a task into the reminder window as the clock advances', () => {
    const task = makeTask({ id: 'later', dueDate: '2026-10-21', dueTime: '18:30' });
    expect(buildReminders([task], settings, NOW)).toHaveLength(0);
    // 18:30 minus one hour = 17:30, so 17:31 must raise it without any reload.
    const later = new Date(2026, 9, 21, 17, 31, 0);
    const raised = buildReminders([task], settings, later);
    expect(raised).toHaveLength(1);
    expect(raised[0].overdue).toBe(false);
  });

  it('flags overdue work and ignores completed tasks', () => {
    const overdue = makeTask({ id: 'late', dueDate: '2026-10-20', dueTime: '10:00' });
    const done = makeTask({ id: 'done', dueDate: '2026-10-21', dueTime: '15:00', status: 'completed' });
    const items = buildReminders([overdue, done], settings, NOW);
    expect(items.map((item) => item.task.id)).toEqual(['late']);
    expect(items[0].overdue).toBe(true);
  });
});
