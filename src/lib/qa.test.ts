import { describe, expect, it } from 'vitest';
import { answerQuestion, bm25Search, buildQaDocs, tokenize } from './qa';
import { DEFAULT_SETTINGS } from './types';
import type { Settings, Task, TimeSession } from './types';

const NOW = new Date(2026, 9, 21, 12, 0, 0); // Wednesday
const settings: Settings = { ...DEFAULT_SETTINGS, workingDays: [1, 2, 3, 4, 5] };

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
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
    completedAt: null,
    deletedAt: null,
    source: 'manual',
    graphRef: null,
    ...rest,
  } as Task;
}

function session(over: Partial<TimeSession> & { id: string; taskId: string }): TimeSession {
  const { id, taskId, ...rest } = over;
  return {
    id,
    taskId,
    startedAt: new Date(2026, 9, 21, 9, 0, 0).toISOString(),
    endedAt: new Date(2026, 9, 21, 10, 0, 0).toISOString(),
    durationMs: 60 * 60 * 1000,
    state: 'completed',
    lastHeartbeatAt: null,
    note: '',
    ...rest,
  } as TimeSession;
}

function ask(question: string, tasks: Task[], sessions: TimeSession[] = []) {
  return answerQuestion({ question, tasks, sessions, now: NOW, settings });
}

describe('tokenize and BM25', () => {
  it('drops stopwords and keeps meaningful terms', () => {
    expect(tokenize('when is the Nova proposal due?')).toEqual(['nova', 'proposal', 'due']);
  });

  it('ranks the document that actually contains the words', () => {
    const docs = buildQaDocs([
      task({ id: 'a', title: 'Renew Nova contract', notes: 'call billing' }),
      task({ id: 'b', title: 'Water the plants' }),
      task({ id: 'c', title: 'Draft proposal for acquisition' }),
      task({ id: 'd', title: 'Nova onboarding checklist' }),
    ]);
    const hits = bm25Search('Nova contract', docs, 3);
    expect(hits[0].doc.taskId).toBe('a'); // matches both terms
    expect(hits.map((hit) => hit.doc.taskId)).toEqual(['a', 'd']); // only positive scores survive
  });

  it('returns nothing rather than everything for gibberish', () => {
    const docs = buildQaDocs([task({ id: 'a', title: 'Send invoice' })]);
    expect(bm25Search('zzz qqq', docs)).toEqual([]);
  });
});

describe('templated answers with citations', () => {
  const tasks = [
    task({ id: 'late', title: 'Send overdue deck', dueDate: '2026-10-18', priority: 'high' }),
    task({ id: 'today', title: 'Nova check-in', dueDate: '2026-10-21', client: 'Nova' }),
    task({ id: 'soon', title: 'Write research notes', category: 'research', dueDate: '2026-10-23' }),
    task({ id: 'done', title: 'Shipped thing', status: 'completed', completedAt: '2026-10-21T08:00:00.000Z' }),
  ];

  it('counts overdue with exact confidence and cites the offenders', () => {
    const answer = ask('how many overdue tasks do I have?', tasks);
    expect(answer.confidence).toBe('exact');
    expect(answer.text).toContain('1 overdue');
    expect(answer.citations.map((citation) => citation.taskId)).toContain('late');
  });

  it('answers "due today" from due dates only', () => {
    const answer = ask("what's due today?", tasks);
    expect(answer.text).toContain('1 task due today');
    expect(answer.citations[0]?.taskId).toBe('today');
  });

  it('summarises completed work honestly for today vs this week', () => {
    expect(ask('what did I complete today?', tasks).text).toContain('1 completed today');
    expect(ask('how many tasks completed this week?', tasks).text).toContain('this week');
  });

  it('recommends the top-scoring open task with its reasons', () => {
    const answer = ask('what should I do next?', tasks);
    expect(answer.confidence).toBe('exact');
    expect(answer.citations).toHaveLength(1);
    expect(answer.text).toContain('scheduler scored');
    // Overdue high-priority work should win over undated research.
    expect(answer.citations[0]?.taskId).toBe('late');
  });

  it('answers when a named task is due, citing it', () => {
    const answer = ask('when is Nova check-in due?', tasks);
    expect(answer.confidence).toBe('exact');
    expect(answer.text).toContain('due Today');
    expect(answer.text).toContain('Nova');
    expect(answer.citations[0]?.taskId).toBe('today');
  });

  it('reports tracked time for a named task', () => {
    const sessions = [
      session({ id: 's1', taskId: 'today', durationMs: 45 * 60 * 1000 }),
      session({ id: 's2', taskId: 'today', durationMs: 30 * 60 * 1000 }),
    ];
    const answer = ask('how long did Nova check-in take?', [...tasks, task({ id: 'today', title: 'Nova check-in', dueDate: '2026-10-21', client: 'Nova', estimatedMinutes: 30 })], sessions);
    expect(answer.text).toContain('1h 15m');
    expect(answer.citations[0]?.taskId).toBe('today');
  });

  it('totals tracked time by window', () => {
    const sessions = [session({ id: 's1', taskId: 'today' }), session({ id: 's2', taskId: 'today' })];
    expect(ask('how much did I work today?', tasks, sessions).text).toContain('2h');
    const lastWeek = session({
      id: 'old',
      taskId: 'today',
      startedAt: '2026-10-10T09:00:00.000Z',
      endedAt: '2026-10-10T10:00:00.000Z',
    });
    expect(ask('how much time did I track today?', tasks, [lastWeek]).text).toContain('No completed timer time');
  });

  it('summarises a client mentioned by name', () => {
    const answer = ask('tell me about the Nova client', tasks);
    expect(answer.confidence).toBe('exact');
    expect(answer.text).toContain('“Nova”');
    expect(answer.text).toContain('1 open task');
    expect(answer.citations[0]?.taskId).toBe('today');
  });

  it('falls back to closest matches, labelled as such', () => {
    const answer = ask('acquisition research', [task({ id: 'c', title: 'Draft proposal for acquisition' })]);
    expect(answer.confidence).toBe('closest');
    expect(answer.text).toContain('closest in your data');
    expect(answer.citations[0]?.taskId).toBe('c');
  });

  it('admits when nothing matches instead of inventing an answer', () => {
    const answer = ask('zzz qqq nonsense', tasks);
    expect(answer.confidence).toBe('none');
    expect(answer.citations).toEqual([]);
    expect(answer.text).toContain("couldn't find");
    expect(answer.text).toContain('on this device');
  });
});
