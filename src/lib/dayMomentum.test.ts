import { describe, expect, it } from 'vitest';
import { buildDayMomentum } from './dayMomentum';
import type { Task } from './types';

const NOW = new Date(2026, 9, 31, 12, 0, 0);
const TODAY = '2026-10-31';

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task_1',
    title: 'Prepare the proposal',
    notes: '',
    client: 'Northwind',
    category: 'proposal',
    priority: 'high',
    estimatedMinutes: 30,
    actualMinutes: 0,
    dueDate: TODAY,
    dueTime: '',
    scheduledFor: null,
    suggestedDate: null,
    suggestedStart: null,
    status: 'todo',
    blocked: false,
    dependencyIds: [],
    deferrals: 0,
    createdAt: new Date(2026, 9, 30, 9).toISOString(),
    updatedAt: new Date(2026, 9, 30, 9).toISOString(),
    completedAt: null,
    deletedAt: null,
    source: 'manual',
    graphRef: null,
    ...overrides,
  };
}

describe('daily momentum', () => {
  it('has an honest empty state rather than inventing a target', () => {
    expect(buildDayMomentum([], NOW)).toEqual({ completed: 0, remaining: 0, total: 0, percent: 0 });
    expect(buildDayMomentum([task({ dueDate: null })], NOW).percent).toBe(0);
  });

  it('compares work completed today with open deadlines still due today', () => {
    const tasks = [
      task({ id: 'done', status: 'completed', completedAt: new Date(2026, 9, 31, 10).toISOString() }),
      task({ id: 'due_1' }),
      task({ id: 'due_2', dueTime: '16:00' }),
      task({ id: 'overdue', dueDate: '2026-10-30' }),
      task({ id: 'done_yesterday', dueDate: null, status: 'completed', completedAt: new Date(2026, 9, 30, 17).toISOString() }),
    ];
    expect(buildDayMomentum(tasks, NOW)).toEqual({ completed: 1, remaining: 2, total: 3, percent: 33 });
  });

  it('counts a completion today even when its original deadline was earlier', () => {
    const result = buildDayMomentum([
      task({ id: 'done', dueDate: '2026-10-28', status: 'completed', completedAt: new Date(2026, 9, 31, 9).toISOString() }),
    ], NOW);
    expect(result).toEqual({ completed: 1, remaining: 0, total: 1, percent: 100 });
  });

  it('excludes deleted tasks and invalid completion dates', () => {
    const result = buildDayMomentum([
      task({ id: 'deleted', deletedAt: NOW.toISOString() }),
      task({ id: 'deleted_done', status: 'completed', completedAt: NOW.toISOString(), deletedAt: NOW.toISOString() }),
      task({ id: 'invalid', status: 'completed', completedAt: 'not-a-date' }),
    ], NOW);
    expect(result).toEqual({ completed: 0, remaining: 0, total: 0, percent: 0 });
  });
});
