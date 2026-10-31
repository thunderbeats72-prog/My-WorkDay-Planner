import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Minimize2, Pause, Play, ShieldCheck, Square, Target } from 'lucide-react';
import type { Task } from '../lib/types';
import { dueLabel, formatDuration, formatSecondsLabel } from '../lib/dates';
import { BrandMark } from './BrandMark';
import { Button, CategoryBadge, PriorityBadge } from './ui';

const GOAL_STORAGE_KEY = 'workday.focus-goal.v1';
const BASE_GOALS = [15, 25, 50, 90];

function validGoal(value: number): boolean {
  return Number.isFinite(value) && value >= 5 && value <= 240;
}

function readGoal(fallback: number): number {
  try {
    const stored = Number(window.localStorage.getItem(GOAL_STORAGE_KEY));
    if (validGoal(stored)) return stored;
  } catch {
    // A blocked store only means the preference lasts for this open view.
  }
  return validGoal(fallback) ? fallback : 50;
}

export function FocusMode({
  task,
  now,
  elapsedMs,
  isRunning,
  isPaused,
  defaultGoalMinutes,
  onClose,
  onStart,
  onResume,
  onPause,
  onFinish,
  onComplete,
}: {
  task: Task;
  now: Date;
  elapsedMs: number;
  isRunning: boolean;
  isPaused: boolean;
  defaultGoalMinutes: number;
  onClose: () => void;
  onStart: () => void;
  onResume: () => void;
  onPause: () => void;
  onFinish: () => void;
  onComplete: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [goalMinutes, setGoalMinutes] = useState(() => readGoal(defaultGoalMinutes));
  const actionsRef = useRef({ onClose, onStart, onResume, onPause, isRunning, isPaused });

  const goalOptions = [...new Set([...BASE_GOALS, defaultGoalMinutes])]
    .filter(validGoal)
    .sort((a, b) => a - b);
  const safeElapsed = Math.max(0, elapsedMs);
  const goalMs = goalMinutes * 60_000;
  const remainingMs = goalMs - safeElapsed;
  const progress = Math.min(100, (safeElapsed / goalMs) * 100);
  const radius = 132;
  const circumference = 2 * Math.PI * radius;
  const stateLabel = isRunning ? 'In focus' : isPaused ? 'Paused' : 'Ready';

  useEffect(() => {
    actionsRef.current = { onClose, onStart, onResume, onPause, isRunning, isPaused };
  }, [onClose, onStart, onResume, onPause, isRunning, isPaused]);

  useEffect(() => {
    try {
      window.localStorage.setItem(GOAL_STORAGE_KEY, String(goalMinutes));
    } catch {
      // The timer and goal still work when storage is unavailable.
    }
  }, [goalMinutes]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusTimer = window.setTimeout(() => dialogRef.current?.focus(), 20);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        actionsRef.current.onClose();
        return;
      }
      if (event.key === 'Tab') {
        const dialog = dialogRef.current;
        if (!dialog) return;
        const items = Array.from(
          dialog.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex]:not([tabindex="-1"])'),
        );
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        const active = document.activeElement;
        if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        } else if (event.shiftKey && (active === first || active === dialog)) {
          event.preventDefault();
          last.focus();
        }
        return;
      }
      if (event.code !== 'Space' || event.repeat) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.closest('button, input, select, textarea, a, [contenteditable="true"]')) return;
      event.preventDefault();
      const current = actionsRef.current;
      if (current.isRunning) current.onPause();
      else if (current.isPaused) current.onResume();
      else current.onStart();
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  const toggleTimer = () => {
    if (isRunning) onPause();
    else if (isPaused) onResume();
    else onStart();
  };

  return createPortal(
    <div
      ref={dialogRef}
      className={`focus-mode ${isRunning ? 'is-running' : ''} ${remainingMs <= 0 && safeElapsed > 0 ? 'is-goal-met' : ''}`.trim()}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      tabIndex={-1}
    >
      <header className="focus-mode-bar">
        <div className="focus-mode-brand">
          <BrandMark size="sm" />
          <span>Workday</span>
          <i aria-hidden="true" />
          <strong>Focus</strong>
        </div>
        <span className={`focus-mode-state ${isRunning ? 'is-live' : ''}`.trim()}>
          <span aria-hidden="true" />
          {stateLabel}
        </span>
        <button type="button" className="focus-mode-minimize" onClick={onClose} aria-label="Minimize focus mode">
          <Minimize2 size={16} aria-hidden="true" />
          <span>Minimize</span>
        </button>
      </header>

      <main className="focus-mode-main">
        <p className="focus-mode-kicker">
          <Target size={14} aria-hidden="true" /> One thing at a time
        </p>
        <h1 id={titleId}>{task.title}</h1>
        <div className="focus-mode-meta">
          <CategoryBadge category={task.category} />
          <PriorityBadge priority={task.priority} />
          {task.client ? <span>{task.client}</span> : null}
          <span>{dueLabel(task, now)}</span>
        </div>

        <div
          className="focus-mode-dial"
          role="progressbar"
          aria-label="Focus session goal"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress)}
          aria-valuetext={`${Math.round(progress)}% of a ${goalMinutes}-minute goal`}
        >
          <svg viewBox="0 0 300 300" aria-hidden="true">
            <circle className="focus-mode-track" cx="150" cy="150" r={radius} />
            <circle
              className="focus-mode-value"
              cx="150"
              cy="150"
              r={radius}
              strokeDasharray={circumference}
              strokeDashoffset={circumference - (progress / 100) * circumference}
            />
          </svg>
          <div className="focus-mode-clock">
            <strong>{formatSecondsLabel(safeElapsed / 1000)}</strong>
            <span>{isRunning ? 'elapsed' : isPaused ? 'timer paused' : 'ready when you are'}</span>
          </div>
        </div>

        <p className="focus-mode-remaining" id={descriptionId}>
          {safeElapsed === 0
            ? `A ${goalMinutes}-minute goal. Start when you are ready.`
            : remainingMs > 0
              ? `${formatDuration(Math.ceil(remainingMs / 60_000))} to your ${goalMinutes}-minute goal`
              : 'Goal reached — keep going, or finish when it feels right.'}
        </p>

        <div className="focus-mode-goal">
          <span>Session goal</span>
          <div role="group" aria-label="Focus goal in minutes">
            {goalOptions.map((minutes) => (
              <button
                key={minutes}
                type="button"
                className={goalMinutes === minutes ? 'is-active' : ''}
                aria-pressed={goalMinutes === minutes}
                onClick={() => setGoalMinutes(minutes)}
              >
                {minutes}m
              </button>
            ))}
          </div>
        </div>

        <div className="focus-mode-controls">
          <Button variant="primary" size="lg" icon={isRunning ? Pause : Play} onClick={toggleTimer}>
            {isRunning ? 'Pause focus' : isPaused ? 'Resume focus' : 'Start focus'}
          </Button>
          {isRunning ? (
            <Button variant="secondary" size="lg" icon={Square} onClick={onFinish}>
              Finish &amp; exit
            </Button>
          ) : null}
          <Button variant="ghost" size="lg" icon={Check} onClick={onComplete}>
            Complete task
          </Button>
        </div>

        <p className="focus-mode-assurance">
          <ShieldCheck size={14} aria-hidden="true" />
          {isRunning ? 'Minimize anytime — your timer keeps running and saves automatically.' : 'Your tracked time is saved to this task automatically.'}
        </p>
      </main>

      <footer className="focus-mode-foot">
        <span><kbd>Space</kbd> start / pause</span>
        <span><kbd>Esc</kbd> minimize</span>
      </footer>
    </div>,
    document.body,
  );
}
