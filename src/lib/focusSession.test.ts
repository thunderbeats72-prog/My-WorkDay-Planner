import { describe, expect, it } from 'vitest';
import { focusElapsedMs } from './focusSession';
import type { TimeSession } from './types';

const NOW = new Date('2026-10-31T12:00:00.000Z').getTime();

function session(overrides: Partial<TimeSession> = {}): TimeSession {
  return {
    id: 'session_1',
    taskId: 'task_1',
    startedAt: '2026-10-31T11:55:00.000Z',
    endedAt: null,
    durationMs: 60_000,
    state: 'running',
    lastHeartbeatAt: '2026-10-31T11:59:50.000Z',
    note: '',
    ...overrides,
  };
}

describe('focus session elapsed time', () => {
  it('starts at zero without a current session and ignores completed history', () => {
    expect(focusElapsedMs([], 'task_1', NOW)).toBe(0);
    expect(focusElapsedMs([session({ state: 'completed', endedAt: '2026-10-31T11:58:00.000Z' })], 'task_1', NOW)).toBe(0);
  });

  it('adds only the live segment to time already banked by the timer', () => {
    expect(focusElapsedMs([session()], 'task_1', NOW)).toBe(360_000);
  });

  it('does not keep counting a paused session', () => {
    const paused = session({ state: 'paused', endedAt: '2026-10-31T11:57:00.000Z', durationMs: 180_000 });
    expect(focusElapsedMs([paused], 'task_1', NOW)).toBe(180_000);
    expect(focusElapsedMs([paused], 'task_1', NOW + 60_000)).toBe(180_000);
  });

  it('uses the newest paused session and never another task’s timer', () => {
    const sessions = [
      session({ id: 'old', state: 'paused', endedAt: '2026-10-31T10:00:00.000Z', durationMs: 20_000 }),
      session({ id: 'new', state: 'paused', endedAt: '2026-10-31T11:00:00.000Z', durationMs: 40_000 }),
      session({ id: 'other', taskId: 'task_2', durationMs: 900_000 }),
    ];
    expect(focusElapsedMs(sessions, 'task_1', NOW)).toBe(40_000);
  });

  it('clamps invalid durations, future starts and invalid dates safely', () => {
    expect(focusElapsedMs([session({ durationMs: -5 })], 'task_1', NOW)).toBe(300_000);
    expect(focusElapsedMs([session({ startedAt: '2026-10-31T12:05:00.000Z' })], 'task_1', NOW)).toBe(60_000);
    expect(focusElapsedMs([session({ startedAt: 'invalid' })], 'task_1', NOW)).toBe(60_000);
  });
});
