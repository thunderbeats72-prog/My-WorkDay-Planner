import type { TimeSession } from './types';

function safeDuration(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/**
 * Elapsed time for the focus session belonging to one task.
 *
 * Completed sessions are history, not the current focus block. A running
 * session wins over older paused ones; otherwise the newest paused session is
 * resumed. Only the live segment is calculated from the clock — banked time
 * has already been included in `durationMs` by the timer engine.
 */
export function focusElapsedMs(sessions: TimeSession[], taskId: string, nowMs: number = Date.now()): number {
  const candidates = sessions.filter(
    (session) => session.taskId === taskId && (session.state === 'running' || session.state === 'paused'),
  );
  const running = candidates
    .filter((session) => session.state === 'running')
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  const paused = candidates
    .filter((session) => session.state === 'paused')
    .sort((a, b) => (b.endedAt ?? b.startedAt).localeCompare(a.endedAt ?? a.startedAt))[0];
  const session = running ?? paused;
  if (!session) return 0;

  const startedMs = new Date(session.startedAt).getTime();
  const liveMs = session.state === 'running' && !Number.isNaN(startedMs)
    ? Math.max(0, nowMs - startedMs)
    : 0;
  return safeDuration(session.durationMs) + liveMs;
}
