import { useState } from 'react';
import {
  Bell,
  CalendarClock,
  Check,
  Clock,
  Ellipsis,
  ExternalLink,
  Flag,
  Pause,
  Pencil,
  Play,
  RotateCcw,
  Square,
  Trash,
  TriangleAlert,
  Undo2,
} from 'lucide-react';
import type { Task } from '../lib/types';
import {
  dueLabel,
  dueTone,
  formatDuration,
  formatSecondsLabel,
  nextWeekdayISO,
  relativeDayLabel,
} from '../lib/dates';
import { useClickOutside } from '../hooks/useEnvironment';
import { Badge, Button, CategoryBadge, IconButton, PriorityBadge } from './ui';

export interface TaskCardHandlers {
  onOpen: () => void;
  onEdit: () => void;
  onToggleComplete: () => void;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onFinish: () => void;
  onReschedule: (iso: string) => void;
  onSnooze: () => void;
  onDelete: () => void;
  onToggleBlocked: () => void;
  onToggleDependency?: () => void;
}

export function TaskCard({
  task,
  now,
  elapsedMs,
  isRunning,
  isPaused,
  handlers,
}: {
  task: Task;
  now: Date;
  elapsedMs: number;
  isRunning: boolean;
  isPaused: boolean;
  handlers: TaskCardHandlers;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [pickDate, setPickDate] = useState(task.dueDate ?? '');
  const menuRef = useClickOutside<HTMLDivElement>(menuOpen, () => setMenuOpen(false));
  const rescheduleRef = useClickOutside<HTMLDivElement>(rescheduleOpen, () => setRescheduleOpen(false));
  const completed = task.status === 'completed';
  const tone = dueTone(task, now);
  const primary = (() => {
    if (completed) return { label: 'Undo', action: handlers.onToggleComplete, icon: Undo2 };
    if (isRunning) return { label: 'Pause', action: handlers.onPause, icon: Pause };
    if (isPaused) return { label: 'Resume', action: handlers.onResume, icon: Play };
    if (task.source === 'ocr' && task.status === 'inbox') return { label: 'Review', action: handlers.onOpen, icon: Check };
    return { label: 'Start', action: handlers.onStart, icon: Play };
  })();
  const PrimaryIcon = primary.icon;
  const elapsedMinutes = Math.round(elapsedMs / 60000);

  return (
    <article className={`task-card priority-accent-${task.priority} ${completed ? 'completed' : ''}`.trim()}>
      <div className="task-main">
        <button
          type="button"
          className={`task-check ${completed ? 'checked' : ''}`.trim()}
          aria-label={completed ? `Mark “${task.title}” as not completed` : `Complete “${task.title}”`}
          aria-pressed={completed}
          onClick={handlers.onToggleComplete}
        >
          {completed ? <Check size={14} /> : null}
        </button>
        <div className="task-content">
          <div className="task-title-row">
            <button type="button" className="task-title" onClick={handlers.onOpen}>
              {task.title}
            </button>
            <PriorityBadge priority={task.priority} />
          </div>
          <div className="task-meta">
            <CategoryBadge category={task.category} />
            {task.client ? <span className="task-client">{task.client}</span> : null}
            <span className={`task-due due-${tone}`}>
              <Clock size={12} /> {dueLabel(task, now)}
            </span>
            <span className="task-estimate">{formatDuration(task.estimatedMinutes)} est.</span>
            {elapsedMs > 0 ? (
              <span className={`task-actual ${isRunning ? 'live' : ''}`.trim()}>
                {isRunning ? <span className="live-dot" aria-hidden="true" /> : null}
                {formatSecondsLabel(elapsedMs / 1000)} tracked
              </span>
            ) : null}
            {isRunning ? <Badge tone="success">Running</Badge> : null}
            {isPaused ? <Badge tone="warning">Paused</Badge> : null}
            {task.blocked ? (
              <Badge tone="danger">
                <TriangleAlert size={11} /> Blocked
              </Badge>
            ) : null}
            {task.dependencyIds.length > 0 ? <Badge tone="neutral">Waiting on {task.dependencyIds.length}</Badge> : null}
            {task.deferrals > 0 ? <Badge tone="warning">{task.deferrals}× deferred</Badge> : null}
            {task.source === 'ocr' ? <Badge tone="info">From screenshot</Badge> : null}
            {task.graphRef ? (
              <a className="task-link" href={task.graphRef.webUrl} target="_blank" rel="noreferrer">
                Original <ExternalLink size={11} />
              </a>
            ) : null}
          </div>
          {task.suggestedDate ? (
            <p className="task-suggestion">
              <CalendarClock size={12} /> Suggested {relativeDayLabel(task.suggestedDate, now).toLowerCase()}
              {task.suggestedStart ? ` at ${task.suggestedStart}` : ''}
            </p>
          ) : null}
          {completed && task.completedAt ? (
            <p className="task-completed-note">Completed {relativeDayLabel(task.completedAt.slice(0, 10), now).toLowerCase()}</p>
          ) : null}
        </div>
      </div>

      <div className="task-actions">
        <Button size="sm" variant={isRunning ? 'secondary' : 'primary'} icon={PrimaryIcon} onClick={primary.action}>
          {primary.label}
        </Button>
        {isRunning ? (
          <Button size="sm" variant="ghost" icon={Square} onClick={handlers.onFinish}>
            Finish
          </Button>
        ) : null}
        <IconButton label={`Edit “${task.title}”`} icon={Pencil} onClick={handlers.onEdit} />
        <div className="menu-wrap" ref={rescheduleRef}>
          <IconButton
            label={`Reschedule “${task.title}”`}
            icon={CalendarClock}
            aria-haspopup="menu"
            aria-expanded={rescheduleOpen}
            onClick={() => setRescheduleOpen((open) => !open)}
          />
          {rescheduleOpen ? (
            <div className="menu" role="menu">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  handlers.onReschedule(relativeISO(1, now));
                  setRescheduleOpen(false);
                }}
              >
                Tomorrow
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  handlers.onReschedule(relativeISO(2, now));
                  setRescheduleOpen(false);
                }}
              >
                In 2 days
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  handlers.onReschedule(nextWeekdayISO(1, now));
                  setRescheduleOpen(false);
                }}
              >
                Next Monday
              </button>
              <div className="menu-date">
                <label htmlFor={`pick-${task.id}`}>Pick a date</label>
                <input
                  id={`pick-${task.id}`}
                  type="date"
                  value={pickDate}
                  onChange={(event) => setPickDate(event.target.value)}
                  min={relativeISO(0, now)}
                />
                <Button
                  size="sm"
                  variant="primary"
                  disabled={!pickDate}
                  onClick={() => {
                    handlers.onReschedule(pickDate);
                    setRescheduleOpen(false);
                  }}
                >
                  Set date
                </Button>
              </div>
            </div>
          ) : null}
        </div>
        <div className="menu-wrap" ref={menuRef}>
          <IconButton
            label={`More actions for “${task.title}”`}
            icon={Ellipsis}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          />
          {menuOpen ? (
            <div className="menu menu-right" role="menu">
              {!completed ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    handlers.onSnooze();
                    setMenuOpen(false);
                  }}
                >
                  <Bell size={14} /> Snooze 15m
                </button>
              ) : null}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  handlers.onEdit();
                  setMenuOpen(false);
                }}
              >
                <Pencil size={14} /> Edit
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  handlers.onToggleComplete();
                  setMenuOpen(false);
                }}
              >
                {completed ? <RotateCcw size={14} /> : <Check size={14} />}
                {completed ? 'Reopen task' : 'Complete'}
              </button>
              {!completed ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    handlers.onToggleBlocked();
                    setMenuOpen(false);
                  }}
                >
                  <Flag size={14} /> {task.blocked ? 'Unblock' : 'Mark blocked'}
                </button>
              ) : null}
              <button
                type="button"
                role="menuitem"
                className="danger"
                onClick={() => {
                  handlers.onDelete();
                  setMenuOpen(false);
                }}
              >
                <Trash size={14} /> Delete
              </button>
            </div>
          ) : null}
        </div>
      </div>
      {elapsedMinutes > 0 ? <p className="sr-only">{elapsedMinutes} minutes tracked on this task</p> : null}
    </article>
  );
}

function relativeISO(days: number, now: Date): string {
  const date = new Date(now);
  date.setDate(date.getDate() + days);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}
