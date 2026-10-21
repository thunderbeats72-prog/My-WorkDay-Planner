import { describe, expect, it } from 'vitest';
import type { Settings, Task } from './types';
import { DEFAULT_SETTINGS } from './types';
import { daysFromNow, todayISO } from './dates';
import { suggestFocus } from './focus';

const NOW = new Date(2026, 9, 21, 10, 0, 0); // Wed 21 Oct 2026, 10:00
const YESTERDAY = daysFromNow(-1, NOW);
const TOMORROW = daysFromNow(1, NOW);

const settings: Settings = {
  ...DEFAULT_SETTINGS,
  name: 'Test User',
  workingDays: [1, 2, 3, 4, 5],
};

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

describe('suggestFocus', () => {
  it('returns nothing when there is nothing to do', () => {
    expect(suggestFocus([], settings, NOW)).toBeNull();
    expect(
      suggestFocus(
        [
          makeTask({ id: 'done', status: 'completed', dueDate: YESTERDAY }),
          makeTask({ id: 'deleted', deletedAt: NOW.toISOString() }),
        ],
        settings,
        NOW,
      ),
    ).toBeNull();
  });

  it('picks the overdue task and explains why', () => {
    const pick = suggestFocus(
      [
        makeTask({ id: 'later', title: 'Later work', dueDate: daysFromNow(5, NOW) }),
        makeTask({ id: 'late', title: 'Late work', dueDate: YESTERDAY }),
      ],
      settings,
      NOW,
    );
    expect(pick?.task.id).toBe('late');
    expect(pick?.kind).toBe('overdue');
    expect(pick?.reason).toContain('Overdue by 1 day');
    expect(pick?.alternatives.map((option) => option.task.id)).toEqual(['later']);
  });

  it('never suggests a blocked task', () => {
    const pick = suggestFocus(
      [
        makeTask({ id: 'blocked', priority: 'critical', dueDate: YESTERDAY, blocked: true }),
        makeTask({ id: 'open', title: 'Open work', dueDate: todayISO(NOW) }),
      ],
      settings,
      NOW,
    );
    expect(pick?.task.id).toBe('open');
  });

  it('waits for unfinished dependencies and releases them when done', () => {
    const waiting = makeTask({ id: 'waiting', priority: 'critical', dueDate: YESTERDAY, dependencyIds: ['dep'] });
    const open = makeTask({ id: 'open', dueDate: TOMORROW });
    const blocked = suggestFocus([waiting, open, makeTask({ id: 'dep' })], settings, NOW);
    expect(blocked?.task.id).toBe('open');

    const released = suggestFocus(
      [waiting, open, makeTask({ id: 'dep', status: 'completed', completedAt: NOW.toISOString() })],
      settings,
      NOW,
    );
    expect(released?.task.id).toBe('waiting');
  });

  it('prefers work that fits the time left in the day', () => {
    const long = makeTask({ id: 'long', priority: 'critical', dueDate: todayISO(NOW), estimatedMinutes: 90 });
    const short = makeTask({ id: 'short', priority: 'low', dueDate: todayISO(NOW), estimatedMinutes: 20 });
    const noBudget = suggestFocus([long, short], settings, NOW);
    expect(noBudget?.task.id).toBe('long');

    const tight = suggestFocus([long, short], settings, NOW, { freeMinutes: 30 });
    expect(tight?.task.id).toBe('short');
    expect(tight?.fits).toBe(true);

    const impossible = suggestFocus([long], settings, NOW, { freeMinutes: 15 });
    expect(impossible?.task.id).toBe('long');
    expect(impossible?.fits).toBe(false);
  });

  it('keeps a running timer as the suggestion', () => {
    const pick = suggestFocus(
      [
        makeTask({ id: 'urgent', priority: 'critical', dueDate: YESTERDAY }),
        makeTask({ id: 'running', priority: 'low', dueDate: TOMORROW }),
      ],
      settings,
      NOW,
      { runningTaskId: 'running' },
    );
    expect(pick?.task.id).toBe('running');
    expect(pick?.kind).toBe('resume');
    expect(pick?.reason).toMatch(/timer is already running/i);
  });

  it('cycles through suggestions with skip and wraps around', () => {
    const tasks = [
      makeTask({ id: 'a', priority: 'critical', dueDate: YESTERDAY }),
      makeTask({ id: 'b', priority: 'high', dueDate: todayISO(NOW) }),
    ];
    expect(suggestFocus(tasks, settings, NOW)?.task.id).toBe('a');
    expect(suggestFocus(tasks, settings, NOW, { skip: 1 })?.task.id).toBe('b');
    expect(suggestFocus(tasks, settings, NOW, { skip: 2 })?.task.id).toBe('a');
    expect(suggestFocus(tasks, settings, NOW, { skip: 1 })?.alternatives.map((option) => option.task.id)).toEqual(['a']);
  });

  it('flags a quick win without calling it urgent', () => {
    const pick = suggestFocus([makeTask({ id: 'tiny', estimatedMinutes: 10, dueDate: TOMORROW })], settings, NOW);
    expect(pick?.kind).toBe('quick-win');
    expect(pick?.reason).toContain('Quick win');
  });
});
