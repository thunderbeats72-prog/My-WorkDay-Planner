import { describe, expect, it } from 'vitest';
import type { Settings, Task, TimeSession } from './types';
import { DEFAULT_SETTINGS } from './types';
import { buildInsights, collectActualMinutes, deadlineRisk, learnDurations, median, suggestForTask } from './ml';
import { buildWeeklyReport, tasksToCsv } from './reports';

const NOW = new Date(2026, 9, 21, 10, 0, 0);

const settings: Settings = {
  ...DEFAULT_SETTINGS,
  defaultEstimateMinutes: 30,
  focusBlockMinutes: 50,
};

function makeTask(overrides: Partial<Task> & { id: string }): Task {
  const iso = new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const { id, ...rest } = overrides;
  return {
    id,
    title: 'Prepare proposal',
    notes: '',
    client: 'Acme Industries',
    category: 'proposal',
    priority: 'high',
    estimatedMinutes: 30,
    actualMinutes: 0,
    dueDate: null,
    dueTime: '',
    scheduledFor: null,
    suggestedDate: null,
    suggestedStart: null,
    status: 'completed',
    blocked: false,
    dependencyIds: [],
    deferrals: 0,
    createdAt: iso,
    updatedAt: iso,
    completedAt: NOW.toISOString(),
    deletedAt: null,
    source: 'manual',
    graphRef: null,
    ...rest,
  };
}

function makeSession(overrides: Partial<TimeSession> & { id: string; taskId: string }): TimeSession {
  const { id, taskId, ...rest } = overrides;
  return {
    id,
    taskId,
    startedAt: new Date(2026, 9, 21, 10, 0, 0).toISOString(),
    endedAt: new Date(2026, 9, 21, 11, 0, 0).toISOString(),
    durationMs: 60 * 60 * 1000,
    state: 'completed',
    lastHeartbeatAt: new Date(2026, 9, 21, 11, 0, 0).toISOString(),
    note: '',
    ...rest,
  };
}

describe('median', () => {
  it('handles odd and even sample counts', () => {
    expect(median([10, 30, 20])).toBe(20);
    expect(median([10, 20, 30, 40])).toBe(25);
    expect(median([])).toBe(0);
  });
});

describe('learnDurations', () => {
  it('learns median actual minutes only once there are three samples', () => {
    const tasks = [
      makeTask({ id: 'a', actualMinutes: 40 }),
      makeTask({ id: 'b', actualMinutes: 50 }),
      makeTask({ id: 'c', actualMinutes: 60 }),
      makeTask({ id: 'd', actualMinutes: 70, category: 'email', client: 'Nexus' }),
    ];
    const learning = learnDurations(tasks, [], 3);
    expect(learning.learned.byCategory.proposal).toBe(50);
    expect(learning.categorySamples.proposal).toBe(3);
    expect(learning.learned.byCategory.email).toBeUndefined();
    expect(learning.learned.byClient['Acme Industries']).toBe(50);
    expect(learning.categorySamples.email).toBe(1);
  });

  it('lets tracked sessions override the stored actual minutes', () => {
    const tasks = [makeTask({ id: 'a', actualMinutes: 5 })];
    const sessions = [makeSession({ id: 's1', taskId: 'a', durationMs: 45 * 60 * 1000 })];
    expect(collectActualMinutes(tasks, sessions).get('a')).toBe(45);
  });

  it('returns no learned durations with thin history', () => {
    const learning = learnDurations([makeTask({ id: 'a', actualMinutes: 40 })], [], 3);
    expect(learning.learned.byCategory.proposal).toBeUndefined();
    expect(learning.totalSamples).toBe(0);
  });
});

describe('suggestForTask', () => {
  it('stays honest when there is not enough history', () => {
    const suggestion = suggestForTask('Prepare proposal', [], settings);
    expect(suggestion.hasEnoughHistory).toBe(false);
    expect(suggestion.confidence).toBe(0);
    expect(suggestion.reasons.join(' ')).toContain('Only 0 saved tasks');
  });

  it('suggests category, priority and a learned duration from saved work', () => {
    const tasks = [
      makeTask({ id: 'a', title: 'Prepare proposal for Acme', actualMinutes: 40 }),
      makeTask({ id: 'b', title: 'Prepare proposal for Acme retail', actualMinutes: 50 }),
      makeTask({ id: 'c', title: 'Prepare proposal for Nexus', actualMinutes: 60 }),
      makeTask({ id: 'd', title: 'Prepare proposal for Orion', actualMinutes: 50 }),
      makeTask({ id: 'e', title: 'Follow up with Acme', category: 'follow_up', priority: 'medium', actualMinutes: 15 }),
      makeTask({ id: 'f', title: 'Send email to Nexus', category: 'email', priority: 'low', actualMinutes: 10 }),
    ];
    const suggestion = suggestForTask('Prepare proposal for Acme Industries', tasks, settings);
    expect(suggestion.hasEnoughHistory).toBe(true);
    expect(suggestion.category).toBe('proposal');
    expect(suggestion.estimatedMinutes).toBe(50);
    expect(suggestion.reasons.length).toBeGreaterThan(1);
    expect(suggestion.confidence).toBeGreaterThan(0);
  });
});

describe('deadlineRisk', () => {
  it('scores overdue, blocked and repeatedly deferred work highly with transparent factors', () => {
    const dependency = makeTask({ id: 'dep', status: 'todo', completedAt: null });
    const task = makeTask({
      id: 'risk',
      status: 'todo',
      completedAt: null,
      dueDate: '2026-10-18',
      blocked: true,
      dependencyIds: ['dep'],
      deferrals: 2,
      source: 'ocr',
      estimatedMinutes: 120,
    });
    const risk = deadlineRisk(task, [dependency, task], settings, NOW);
    expect(risk.score).toBeGreaterThanOrEqual(60);
    expect(risk.level).toBe('high');
    expect(risk.factors.some((factor) => factor.label.includes('Overdue'))).toBe(true);
    expect(risk.factors.some((factor) => factor.label.includes('blocked'))).toBe(true);
    expect(risk.factors.some((factor) => factor.label.includes('dependenc'))).toBe(true);
  });

  it('gives low risk to a calm task with no deadline', () => {
    const task = makeTask({ id: 'calm', status: 'todo', completedAt: null, priority: 'low', estimatedMinutes: 15 });
    const risk = deadlineRisk(task, [task], settings, NOW);
    expect(risk.level).toBe('low');
    expect(risk.score).toBeLessThan(30);
  });
});

describe('buildInsights', () => {
  it('derives the sharpest hour and estimate bias from real samples', () => {
    const tasks = [
      makeTask({ id: 'a', estimatedMinutes: 30, completedAt: NOW.toISOString() }),
      makeTask({ id: 'b', estimatedMinutes: 30, completedAt: NOW.toISOString() }),
      makeTask({ id: 'c', estimatedMinutes: 30, completedAt: NOW.toISOString() }),
    ];
    const sessions = [
      makeSession({ id: 's1', taskId: 'a' }),
      makeSession({ id: 's2', taskId: 'b' }),
      makeSession({ id: 's3', taskId: 'c' }),
    ];
    const insights = buildInsights(tasks, sessions);
    expect(insights.hasEnoughData).toBe(true);
    expect(insights.sharpestHour?.hour).toBe(10);
    expect(insights.sharpestHour?.minutes).toBe(180);
    expect(insights.bias[0]?.category).toBe('proposal');
    expect(insights.bias[0]?.direction).toBe('under');
    expect(insights.bias[0]?.differencePct).toBe(100);
    expect(insights.durations[0]?.medianActual).toBe(60);
    // One hour with data only: sharpest exists, but a "slump" would be the
    // same number — refuse to invent a spread.
    expect(insights.slumpHour).toBeNull();
  });

  it('derives a slowest hour once a second hour has data', () => {
    const tasks = [
      makeTask({ id: 'a', estimatedMinutes: 30, completedAt: NOW.toISOString() }),
      makeTask({ id: 'b', estimatedMinutes: 30, completedAt: NOW.toISOString() }),
    ];
    const sessions = [
      makeSession({ id: 's1', taskId: 'a' }), // 10:00, 60m
      makeSession({
        id: 's2',
        taskId: 'b',
        startedAt: new Date(2026, 9, 21, 14, 0, 0).toISOString(),
        endedAt: new Date(2026, 9, 21, 14, 15, 0).toISOString(),
        durationMs: 15 * 60 * 1000,
      }),
    ];
    const insights = buildInsights(tasks, sessions);
    expect(insights.sharpestHour?.hour).toBe(10);
    expect(insights.slumpHour?.hour).toBe(14);
    expect(insights.slumpHour?.minutes).toBe(15);
  });

  it('does not claim bias with fewer than three samples', () => {
    const tasks = [makeTask({ id: 'a', actualMinutes: 60 })];
    const insights = buildInsights(tasks, []);
    expect(insights.bias).toHaveLength(0);
    expect(insights.hasEnoughData).toBe(false);
  });
});

describe('weekly report', () => {
  it('reports only the last seven days of real activity', () => {
    const now = new Date(2026, 9, 21, 12, 0, 0);
    const completed = makeTask({
      id: 'done',
      status: 'completed',
      completedAt: new Date(2026, 9, 20, 12, 0, 0).toISOString(),
      estimatedMinutes: 20,
    });
    const overdue = makeTask({
      id: 'late',
      status: 'todo',
      completedAt: null,
      dueDate: '2026-10-19',
      actualMinutes: 0,
    });
    const sessions = [
      makeSession({
        id: 's1',
        taskId: 'done',
        startedAt: new Date(2026, 9, 20, 10, 0, 0).toISOString(),
        durationMs: 30 * 60 * 1000,
      }),
    ];
    const report = buildWeeklyReport([completed, overdue], sessions, now);
    expect(report.completedCount).toBe(1);
    expect(report.overdueCount).toBe(1);
    expect(report.estimatedMinutes).toBe(20);
    expect(report.actualMinutes).toBe(30);
    expect(report.focusMinutes).toBe(30);
    expect(report.sessionsCount).toBe(1);
    expect(report.byCategory[0]?.category).toBe('proposal');
    expect(report.byDay).toHaveLength(7);
  });

  it('returns a stable empty report with no data', () => {
    const report = buildWeeklyReport([], [], NOW);
    expect(report.completedCount).toBe(0);
    expect(report.hasData).toBe(false);
    expect(report.byCategory).toHaveLength(0);
  });
});

describe('CSV export', () => {
  it('escapes commas, quotes and newlines', () => {
    const task = makeTask({
      id: 'csv',
      title: 'Send "final", revised\nproposal',
      client: 'Acme, Inc.',
    });
    const csv = tasksToCsv([task]);
    expect(csv.split('\n')[0]).toContain('Title,Client');
    expect(csv).toContain('"Send ""final"", revised\nproposal"');
    expect(csv).toContain('"Acme, Inc."');
  });

  it('excludes soft-deleted tasks', () => {
    const task = makeTask({ id: 'deleted', deletedAt: NOW.toISOString() });
    const csv = tasksToCsv([task]);
    expect(csv.split('\n')).toHaveLength(1);
  });
});
