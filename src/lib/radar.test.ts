import { describe, expect, it } from 'vitest';
import { buildClientRadar } from './radar';
import type { GraphHighlight } from './graph';
import type { Task } from './types';

const NOW = new Date(2026, 9, 21, 12, 0, 0); // Wednesday

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
    createdAt: '2026-10-19T09:00:00.000Z',
    updatedAt: '2026-10-19T09:00:00.000Z',
    completedAt: null,
    deletedAt: null,
    source: 'manual',
    graphRef: null,
    ...rest,
  } as Task;
}

function highlight(over: Partial<GraphHighlight> & { id: string }): GraphHighlight {
  return {
    kind: 'mail',
    title: 'Re: pricing',
    from: 'Nova Labs <billing@nova.test>',
    preview: 'Sounds good',
    receivedAt: '2026-10-20T10:00:00.000Z',
    webUrl: 'https://outlook.office.com/mail/',
    ref: { kind: 'mail', id: over.id, webUrl: 'https://outlook.office.com/mail/' },
    ...over,
  } as GraphHighlight;
}

describe('buildClientRadar', () => {
  it('groups open tasks by client and skips the unassigned, done and deleted', () => {
    const briefs = buildClientRadar(
      [
        task({ id: 'a', client: 'Nova' }),
        task({ id: 'b', client: 'Nova', title: 'Second' }),
        task({ id: 'c', client: '   ', title: 'No client' }),
        task({ id: 'd', client: 'Acme', status: 'completed' }),
        task({ id: 'e', client: 'Acme', deletedAt: '2026-10-20T00:00:00.000Z' }),
        task({ id: 'f', client: '  Nova  ', title: 'Trimmed twin' }),
      ],
      NOW,
    );
    expect(briefs).toHaveLength(1);
    expect(briefs[0].client).toBe('Nova');
    expect(briefs[0].openCount).toBe(3);
  });

  it('counts overdue and due-soon honestly and orders by risk', () => {
    const briefs = buildClientRadar(
      [
        task({ id: 'late1', client: 'Zenith', dueDate: '2026-10-18', priority: 'high' }),
        task({ id: 'soon1', client: 'Nova', dueDate: '2026-10-22' }),
        task({ id: 'far1', client: 'Acme', dueDate: '2026-11-30' }),
        task({ id: 'open1', client: 'Acme', dueDate: '2026-10-21', priority: 'critical' }),
      ],
      NOW,
    );
    expect(briefs[0].client).toBe('Zenith'); // overdue sorts first
    expect(briefs[0].overdue).toBe(1);
    expect(briefs.find((brief) => brief.client === 'Nova')?.dueSoon).toBe(1);
    const acme = briefs.find((brief) => brief.client === 'Acme');
    expect(acme?.overdue).toBe(0);
    expect(acme?.dueSoon).toBe(1); // due today
    expect(acme?.nextDueDate).toBe('2026-10-21');
    expect(acme?.priorities).toEqual(['critical', 'medium']);
  });

  it('keeps only real client mail mentions, newest first, capped at three', () => {
    const mentions = [
      highlight({ id: 'm1', title: 'Nova renewal', receivedAt: '2026-10-19T09:00:00.000Z' }),
      highlight({ id: 'm2', title: 'Re: kickoff', receivedAt: '2026-10-21T08:00:00.000Z' }),
      highlight({ id: 'm3', title: 'Invoice for nova', receivedAt: '2026-10-20T12:00:00.000Z' }),
      highlight({
        id: 'm4',
        title: 'Quarterly update',
        from: 'Someone Else <other@x.test>',
        preview: 'nothing here',
        receivedAt: '2026-10-21T09:00:00.000Z',
      }),
      highlight({ id: 'm5', title: 'Nova kickoff round two', receivedAt: '2026-10-21T10:00:00.000Z' }),
      highlight({ id: 'm6', title: 'Nova urgent', receivedAt: '2026-10-21T11:00:00.000Z' }),
    ];
    const briefs = buildClientRadar([task({ id: 'a', client: 'Nova' })], NOW, mentions);
    expect(briefs[0].mentions.map((mention) => mention.id)).toEqual(['m6', 'm5', 'm2']);
  });

  it('matches mentions case-insensitively against sender and preview too', () => {
    const mentions = [
      highlight({ id: 'from', from: 'sam@NOVA.test', title: 'Hello' }),
      highlight({ id: 'preview', from: 'Someone', title: 'Unrelated', preview: 'about the nova account' }),
      highlight({ id: 'miss', from: 'Else', title: 'Nope', preview: 'nothing' }),
    ];
    const briefs = buildClientRadar([task({ id: 'a', client: 'nova' })], NOW, mentions);
    expect(briefs[0].mentions.map((mention) => mention.id).sort()).toEqual(['from', 'preview']);
  });
});
