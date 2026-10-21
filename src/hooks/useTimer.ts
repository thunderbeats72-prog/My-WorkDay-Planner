import { useCallback, useEffect, useRef, useState } from 'react';
import type { Task, TimeSession } from '../lib/types';
import { activeSession as findActiveSession, db, listSessions, logEvent, uniqueId } from '../lib/db';

const HEARTBEAT_MS = 10_000;
const STALE_AFTER_MS = 30_000;

export interface TimerApi {
  sessions: TimeSession[];
  activeSession: TimeSession | null;
  now: number;
  elapsedMsFor: (taskId: string) => number;
  isRunning: (taskId: string) => boolean;
  hasPausedSession: (taskId: string) => boolean;
  start: (taskId: string) => Promise<void>;
  pause: () => Promise<void>;
  resume: (taskId: string) => Promise<void>;
  finish: () => Promise<number>;
  refresh: () => Promise<void>;
}

interface UseTimerOptions {
  tasks: Task[];
  onActualMinutes: (taskId: string, minutes: number) => void;
  onNotice: (message: string) => void;
  enabled: boolean;
}

function minutesFor(sessions: TimeSession[], taskId: string): number {
  return Math.round(
    sessions
      .filter((session) => session.taskId === taskId)
      .reduce((sum, session) => sum + Math.max(0, session.durationMs), 0) / 60000,
  );
}

export function useTimer({ tasks, onActualMinutes, onNotice, enabled }: UseTimerOptions): TimerApi {
  const [sessions, setSessions] = useState<TimeSession[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const busy = useRef(false);
  const sessionsRef = useRef<TimeSession[]>([]);
  const tasksRef = useRef<Task[]>(tasks);
  const initialised = useRef<Promise<void> | null>(null);

  tasksRef.current = tasks;
  sessionsRef.current = sessions;

  const persist = useCallback((next: TimeSession[]) => {
    sessionsRef.current = next;
    setSessions(next);
  }, []);

  const refresh = useCallback(async () => {
    const loaded = await listSessions();
    persist(loaded);
  }, [persist]);

  useEffect(() => {
    if (!enabled) return;
    if (!initialised.current) {
      initialised.current = (async () => {
        const loaded = await listSessions();
        const running = loaded
          .filter((session) => session.state === 'running')
          .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
        const keep = running[0] ?? null;
        const changed: TimeSession[] = [];
        const at = new Date().toISOString();

        for (const duplicate of running.slice(1)) {
          const paused: TimeSession = {
            ...duplicate,
            state: 'paused',
            endedAt: at,
            note: `${duplicate.note ? `${duplicate.note} · ` : ''}Auto-paused duplicate session`,
          };
          await db.timeSessions.put(paused);
          changed.push(paused);
        }
        if (running.length > 1) {
          onNotice('Duplicate running timers were paused — one active session is kept.');
        }

        if (keep) {
          const lastBeat = keep.lastHeartbeatAt ? new Date(keep.lastHeartbeatAt).getTime() : new Date(keep.startedAt).getTime();
          const gap = Date.now() - lastBeat;
          if (gap > STALE_AFTER_MS) {
            const banked = Math.min(gap, STALE_AFTER_MS);
            const paused: TimeSession = {
              ...keep,
              state: 'paused',
              durationMs: keep.durationMs + banked,
              endedAt: at,
              lastHeartbeatAt: at,
              note: `${keep.note ? `${keep.note} · ` : ''}Auto-paused after the app was closed; only 30s past the last heartbeat was counted`,
            };
            await db.timeSessions.put(paused);
            changed.push(paused);
            await logEvent(
              keep.taskId,
              'timer',
              `Timer recovered after the app was closed — banked ${Math.round(banked / 1000)}s and paused`,
            );
            onActualMinutes(keep.taskId, minutesFor(loaded.map((session) => (session.id === paused.id ? paused : session)), keep.taskId));
            onNotice('Timer paused: the app was closed. Only time up to 30s after the last heartbeat was counted.');
          }
        }

        const updated = loaded.map((session) => changed.find((item) => item.id === session.id) ?? session);
        persist(updated);
      })();
    }
    void initialised.current;
  }, [enabled, onActualMinutes, onNotice, persist]);

  const runningSession = sessions.find((session) => session.state === 'running') ?? null;

  useEffect(() => {
    if (!runningSession) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [runningSession]);

  useEffect(() => {
    if (!runningSession) return;
    const interval = window.setInterval(() => {
      const current = sessionsRef.current.find((session) => session.id === runningSession.id);
      if (!current || current.state !== 'running') return;
      const at = Date.now();
      const elapsed = Math.max(0, at - new Date(current.startedAt).getTime());
      const updated: TimeSession = {
        ...current,
        durationMs: current.durationMs + elapsed,
        startedAt: new Date(at).toISOString(),
        lastHeartbeatAt: new Date(at).toISOString(),
      };
      const next = sessionsRef.current.map((session) => (session.id === updated.id ? updated : session));
      persist(next);
      void db.timeSessions.put(updated);
      onActualMinutes(updated.taskId, minutesFor(next, updated.taskId));
    }, HEARTBEAT_MS);
    return () => window.clearInterval(interval);
  }, [runningSession, persist, onActualMinutes]);

  const start = useCallback(
    async (taskId: string) => {
      if (busy.current) return;
      busy.current = true;
      try {
        const task = tasksRef.current.find((candidate) => candidate.id === taskId);
        if (!task) return;
        if (task.status === 'completed') {
          onNotice('This task is already completed. Reopen it before starting a timer.');
          return;
        }
        const existingRunning = sessionsRef.current.find((session) => session.state === 'running');
        if (existingRunning && existingRunning.taskId === taskId) {
          return;
        }
        let next = sessionsRef.current;
        if (existingRunning) {
          const at = Date.now();
          const paused: TimeSession = {
            ...existingRunning,
            durationMs: existingRunning.durationMs + Math.max(0, at - new Date(existingRunning.startedAt).getTime()),
            startedAt: new Date(at).toISOString(),
            endedAt: new Date(at).toISOString(),
            lastHeartbeatAt: new Date(at).toISOString(),
            state: 'paused',
          };
          next = next.map((session) => (session.id === paused.id ? paused : session));
          await db.timeSessions.put(paused);
          onActualMinutes(paused.taskId, minutesFor(next, paused.taskId));
          await logEvent(paused.taskId, 'timer', 'Timer paused automatically when another task was started');
        }
        const at = Date.now();
        const session: TimeSession = {
          id: uniqueId('ses'),
          taskId,
          startedAt: new Date(at).toISOString(),
          endedAt: null,
          durationMs: 0,
          state: 'running',
          lastHeartbeatAt: new Date(at).toISOString(),
          note: '',
        };
        next = [...next, session];
        persist(next);
        await db.timeSessions.add(session);
        await logEvent(taskId, 'timer', 'Timer started');
        onActualMinutes(taskId, minutesFor(next, taskId));
        onNotice(`Timer started for “${task.title}”.`);
      } finally {
        busy.current = false;
      }
    },
    [onActualMinutes, onNotice, persist],
  );

  const pause = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const running = sessionsRef.current.find((session) => session.state === 'running');
      if (!running) return;
      const at = Date.now();
      const paused: TimeSession = {
        ...running,
        durationMs: running.durationMs + Math.max(0, at - new Date(running.startedAt).getTime()),
        startedAt: new Date(at).toISOString(),
        endedAt: new Date(at).toISOString(),
        lastHeartbeatAt: new Date(at).toISOString(),
        state: 'paused',
      };
      const next = sessionsRef.current.map((session) => (session.id === paused.id ? paused : session));
      persist(next);
      await db.timeSessions.put(paused);
      onActualMinutes(paused.taskId, minutesFor(next, paused.taskId));
      await logEvent(paused.taskId, 'timer', `Timer paused at ${Math.round(paused.durationMs / 60000)}m elapsed`);
    } finally {
      busy.current = false;
    }
  }, [onActualMinutes, persist]);

  const resume = useCallback(
    async (taskId: string) => {
      if (busy.current) return;
      busy.current = true;
      try {
        const running = sessionsRef.current.find((session) => session.state === 'running');
        if (running) {
          if (running.taskId === taskId) return;
          const at = Date.now();
          const paused: TimeSession = {
            ...running,
            durationMs: running.durationMs + Math.max(0, at - new Date(running.startedAt).getTime()),
            startedAt: new Date(at).toISOString(),
            endedAt: new Date(at).toISOString(),
            lastHeartbeatAt: new Date(at).toISOString(),
            state: 'paused',
          };
          sessionsRef.current = sessionsRef.current.map((session) => (session.id === paused.id ? paused : session));
          await db.timeSessions.put(paused);
          onActualMinutes(paused.taskId, minutesFor(sessionsRef.current, paused.taskId));
        }
        const pausedCandidate = sessionsRef.current
          .filter((session) => session.taskId === taskId && session.state === 'paused')
          .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
        if (!pausedCandidate) {
          const at = Date.now();
          const session: TimeSession = {
            id: uniqueId('ses'),
            taskId,
            startedAt: new Date(at).toISOString(),
            endedAt: null,
            durationMs: 0,
            state: 'running',
            lastHeartbeatAt: new Date(at).toISOString(),
            note: '',
          };
          const next = [...sessionsRef.current, session];
          persist(next);
          await db.timeSessions.add(session);
          await logEvent(taskId, 'timer', 'Timer started');
          onActualMinutes(taskId, minutesFor(next, taskId));
          onNotice('Timer started.');
          return;
        }
        const at = Date.now();
        const resumed: TimeSession = {
          ...pausedCandidate,
          state: 'running',
          startedAt: new Date(at).toISOString(),
          endedAt: null,
          lastHeartbeatAt: new Date(at).toISOString(),
        };
        const next = sessionsRef.current.map((session) => (session.id === resumed.id ? resumed : session));
        persist(next);
        await db.timeSessions.put(resumed);
        await logEvent(taskId, 'timer', 'Timer resumed');
        onNotice('Timer resumed.');
      } finally {
        busy.current = false;
      }
    },
    [onActualMinutes, onNotice, persist],
  );

  const finish = useCallback(async () => {
    const running = sessionsRef.current.find((session) => session.state === 'running');
    if (!running) return 0;
    const at = Date.now();
    const finished: TimeSession = {
      ...running,
      durationMs: running.durationMs + Math.max(0, at - new Date(running.startedAt).getTime()),
      startedAt: new Date(at).toISOString(),
      endedAt: new Date(at).toISOString(),
      lastHeartbeatAt: new Date(at).toISOString(),
      state: 'completed',
    };
    const next = sessionsRef.current.map((session) => (session.id === finished.id ? finished : session));
    persist(next);
    await db.timeSessions.put(finished);
    const minutes = minutesFor(next, finished.taskId);
    onActualMinutes(finished.taskId, minutes);
    await logEvent(finished.taskId, 'timer', `Timer finished at ${minutes}m tracked`);
    return minutes;
  }, [onActualMinutes, persist]);

  const elapsedMsFor = useCallback(
    (taskId: string) => {
      return sessions
        .filter((session) => session.taskId === taskId)
        .reduce((sum, session) => {
          if (session.state === 'running') {
            return sum + session.durationMs + Math.max(0, now - new Date(session.startedAt).getTime());
          }
          return sum + session.durationMs;
        }, 0);
    },
    [sessions, now],
  );

  const isRunning = useCallback(
    (taskId: string) => sessions.some((session) => session.taskId === taskId && session.state === 'running'),
    [sessions],
  );

  const hasPausedSession = useCallback(
    (taskId: string) => sessions.some((session) => session.taskId === taskId && session.state === 'paused'),
    [sessions],
  );

  const activeSession = findActiveSessionSync(sessions);

  return {
    sessions,
    activeSession,
    now,
    elapsedMsFor,
    isRunning,
    hasPausedSession,
    start,
    pause,
    resume,
    finish,
    refresh,
  };
}

function findActiveSessionSync(sessions: TimeSession[]): TimeSession | null {
  const running = sessions.filter((session) => session.state === 'running');
  if (running.length === 0) return null;
  running.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return running[0];
}

export async function getActiveSessionFromDb(): Promise<TimeSession | null> {
  return findActiveSession();
}
