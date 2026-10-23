import { describe, expect, it } from 'vitest';
import { buildDayReplay, replayAt, replayableDates } from './replay';
import type { Settings, Task, TimeSession } from './types';
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

function session(over: Partial<TimeSession> = {}): TimeSession {
  return {
    id: over.id ?? 'ses_1',
    taskId: 'tsk_a',
    startedAt: '2026-10-21T09:15:00',
    endedAt: '2026-10-21T10:00:00',
    durationMs: 45 * 60_000,
    state: 'paused',
    lastHeartbeatAt: null,
    note: '',
    ...over,
  } as TimeSession;
}

describe('day replay', () => {
  it('collects and orders one day’s sessions', () => {
    const sessions = [
      session({ id: 's2', startedAt: '2026-10-21T11:00:00', endedAt: '2026-10-21T11:30:00' }),
      session({ id: 's1', startedAt: '2026-10-21T09:15:00', endedAt: '2026-10-21T10:00:00' }),
      session({ id: 'other-day', startedAt: '2026-10-20T09:00:00', endedAt: '2026-10-20T10:00:00' }),
    ];
    const replay = buildDayReplay('2026-10-21', [task()], sessions, settings);
    expect(replay.spans.map((span) => span.title)).toEqual(['Thing to do', 'Thing to do']);
    expect(replay.spans[0].startMs).toBe(new Date(2026, 9, 21, 9, 15).getTime());
    expect(replay.workMinutes).toBe(75);
    expect(replay.startMs).toBe(new Date(2026, 9, 21, 9, 0).getTime()); // workdayStart
    expect(replay.endMs).toBe(new Date(2026, 9, 21, 18, 0).getTime());
  });

  it('clips a session that straddles midnight', () => {
    const late = session({ startedAt: '2026-10-21T23:30:00', endedAt: '2026-10-22T00:30:00' });
    const replay = buildDayReplay('2026-10-21', [task()], [late], settings);
    expect(replay.spans).toHaveLength(1);
    expect(replay.spans[0].endMs).toBe(new Date(2026, 9, 22, 0, 0).getTime());
    expect(replay.spans[0].minutes).toBe(30);
  });

  it('collects completions as marks and skips running sessions', () => {
    const done = task({ id: 'tsk_a', completedAt: '2026-10-21T14:05:00' });
    const running = session({ state: 'running', endedAt: null, durationMs: 0 });
    const replay = buildDayReplay('2026-10-21', [done], [running], settings);
    expect(replay.spans).toHaveLength(0);
    expect(replay.marks).toHaveLength(1);
    expect(replay.marks[0].atMs).toBe(new Date(2026, 9, 21, 14, 5).getTime());
  });

  it('names what was happening at a moment', () => {
    const sessions = [session({ startedAt: '2026-10-21T10:00:00', endedAt: '2026-10-21T11:00:00' })];
    const replay = buildDayReplay('2026-10-21', [task()], sessions, settings);
    expect(replayAt(replay, new Date(2026, 9, 21, 9, 30).getTime())).toBeNull();
    expect(replayAt(replay, new Date(2026, 9, 21, 10, 30).getTime())?.title).toBe('Thing to do');
    expect(replayAt(replay, new Date(2026, 9, 21, 12, 0).getTime())?.title).toBe('Thing to do');
  });

  it('lists replayable dates, newest first', () => {
    const sessions = [
      session({ startedAt: '2026-10-20T09:00:00', endedAt: '2026-10-20T09:30:00' }),
      session({ id: 's2', startedAt: '2026-10-21T09:00:00', endedAt: '2026-10-21T09:30:00' }),
      session({ id: 's3', state: 'running', startedAt: '2026-10-22T09:00:00', endedAt: null, durationMs: 0 }),
    ];
    expect(replayableDates(sessions)).toEqual(['2026-10-21', '2026-10-20']);
  });

  it('an empty day still yields a sane window', () => {
    const replay = buildDayReplay('2026-10-21', [], [], settings);
    expect(replay.endMs).toBeGreaterThan(replay.startMs);
    expect(replay.spans).toHaveLength(0);
    expect(replay.workMinutes).toBe(0);
  });
});
