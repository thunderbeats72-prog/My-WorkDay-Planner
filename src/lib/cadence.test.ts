import { describe, expect, it } from 'vitest';
import { ESCALATE_AFTER_DAYS, NUDGE_AFTER_DAYS, followUpCadence, repliesFromHighlights } from './cadence';
import type { GraphHighlight } from './graph';
import type { Task } from './types';

const NOW = new Date(2026, 9, 21, 12, 0, 0); // Wednesday noon

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

function task(over: Partial<Task> & { id: string }): Task {
  const { id, ...rest } = over;
  return {
    id,
    title: over.title ?? 'Thing',
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
    createdAt: daysAgo(10),
    updatedAt: daysAgo(10),
    completedAt: null,
    deletedAt: null,
    source: 'manual',
    graphRef: null,
    ...rest,
  } as Task;
}

describe('followUpCadence', () => {
  it('nudges a follow-up after exactly three quiet days', () => {
    const quiet = task({ id: 'q', title: 'Ping Nova', client: 'Nova', updatedAt: daysAgo(NUDGE_AFTER_DAYS) });
    const actions = followUpCadence({ tasks: [quiet], now: NOW });
    expect(actions).toHaveLength(1);
    expect(actions[0].level).toBe('nudge');
    expect(actions[0].ruleId).toBe('quiet-follow-up');
    expect(actions[0].days).toBe(3);
    expect(actions[0].reason).toContain('3 days');
    expect(actions[0].reason).toContain('nudge after 3 quiet days');
    expect(actions[0].reason).toContain('no reply from Nova');
  });

  it('stays quiet while the task is still inside the window', () => {
    const fresh = task({ id: 'f', updatedAt: daysAgo(NUDGE_AFTER_DAYS - 1) });
    expect(followUpCadence({ tasks: [fresh], now: NOW })).toEqual([]);
  });

  it('escalates a silent proposal after seven days, and only then', () => {
    const silent = task({ id: 'p', title: 'Proposal: Acme', category: 'proposal', updatedAt: daysAgo(7) });
    const almost = task({ id: 'p2', title: 'Proposal: almost', category: 'proposal', updatedAt: daysAgo(6) });
    const actions = followUpCadence({ tasks: [silent, almost], now: NOW });
    expect(actions).toHaveLength(1);
    expect(actions[0].task.id).toBe('p');
    expect(actions[0].level).toBe('escalate');
    expect(actions[0].days).toBe(ESCALATE_AFTER_DAYS);
    expect(actions[0].reason).toContain('escalate after 7 quiet days');
    expect(actions[0].reason).toContain('ask for a decision');
  });

  it('suppresses the nudge when the client replied after the task last moved', () => {
    const quiet = task({ id: 'q', client: 'Nova', updatedAt: daysAgo(5) });
    const replies = new Map([['Nova', new Date(NOW.getTime() - 86_400_000)]]);
    expect(followUpCadence({ tasks: [quiet], now: NOW, replies })).toEqual([]);

    const olderReply = new Map([['Nova', new Date(NOW.getTime() - 9 * 86_400_000)]]);
    expect(followUpCadence({ tasks: [quiet], now: NOW, replies: olderReply })).toHaveLength(1);
  });

  it('ignores completed, deleted and non-cadence categories', () => {
    const actions = followUpCadence({
      tasks: [
        task({ id: 'done', status: 'completed', updatedAt: daysAgo(9) }),
        task({ id: 'gone', deletedAt: daysAgo(9), updatedAt: daysAgo(9) }),
        task({ id: 'admin', category: 'admin', updatedAt: daysAgo(9) }),
        task({ id: 'research', category: 'research', updatedAt: daysAgo(9) }),
      ],
      now: NOW,
    });
    expect(actions).toEqual([]);
  });

  it('lists escalations before nudges, then quietest first', () => {
    const actions = followUpCadence({
      tasks: [
        task({ id: 'n-old', title: 'Nudge old', updatedAt: daysAgo(9) }),
        task({ id: 'n-new', title: 'Nudge new', updatedAt: daysAgo(3) }),
        task({ id: 'esc', title: 'Silent proposal', category: 'proposal', updatedAt: daysAgo(8) }),
      ],
      now: NOW,
    });
    expect(actions.map((action) => action.task.id)).toEqual(['esc', 'n-old', 'n-new']);
  });
});

describe('repliesFromHighlights', () => {
  const highlights = [
    { id: 'm1', kind: 'mail', from: 'sam@nova.test', title: 'Re: contract', preview: '', receivedAt: '2026-10-19T09:00:00.000Z' },
    { id: 'm2', kind: 'mail', from: 'other@x.test', title: 'NOVA mentioned here', preview: '', receivedAt: '2026-10-20T09:00:00.000Z' },
    { id: 'm3', kind: 'chat', from: 'sam@nova.test', title: 'Nova chat', preview: '', receivedAt: '2026-10-21T09:00:00.000Z' },
    { id: 'm4', kind: 'mail', from: 'sam@acme.test', title: 'Acme mail', preview: '', receivedAt: '2026-10-21T09:00:00.000Z' },
  ] as unknown as GraphHighlight[];

  it('takes the newest inbound MAIL per client and ignores chat noise', () => {
    const replies = repliesFromHighlights(highlights, ['Nova', 'Acme']);
    expect(replies.get('Nova')?.toISOString()).toBe('2026-10-20T09:00:00.000Z');
    expect(replies.get('Acme')?.toISOString()).toBe('2026-10-21T09:00:00.000Z');
  });
});
