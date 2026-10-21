import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  CircleCheck,
  Clock,
  ExternalLink,
  Link2,
  Pause,
  Pencil,
  Play,
  Sparkles,
  Square,
  Target,
  TriangleAlert,
  X,
} from 'lucide-react';
import type { Task, TaskEvent, Settings } from '../lib/types';
import { CATEGORIES, PRIORITIES } from '../lib/types';
import {
  dueLabel,
  dueTone,
  formatDateLong,
  formatDuration,
  formatSecondsLabel,
  formatTimeAgo,
} from '../lib/dates';
import { deadlineRisk, suggestForTask } from '../lib/ml';
import { listEvents } from '../lib/db';
import { Badge, Button, CategoryBadge, IconButton, PriorityBadge, ProgressBar } from './ui';

export function TaskPanel({
  task,
  tasks,
  settings,
  now,
  elapsedMs,
  isRunning,
  isPaused,
  onClose,
  onEdit,
  onStart,
  onPause,
  onResume,
  onFinish,
  onToggleComplete,
  onApplySuggestion,
  onOpenTask,
}: {
  task: Task | null;
  tasks: Task[];
  settings: Settings;
  now: Date;
  elapsedMs: number;
  isRunning: boolean;
  isPaused: boolean;
  onClose: () => void;
  onEdit: () => void;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onFinish: () => void;
  onToggleComplete: () => void;
  onApplySuggestion: (input: { category: Task['category']; priority: Task['priority']; estimatedMinutes: number }) => void;
  onOpenTask: (id: string) => void;
}) {
  const [events, setEvents] = useState<TaskEvent[]>([]);

  useEffect(() => {
    if (!task) return;
    let cancelled = false;
    void listEvents(task.id).then((loaded) => {
      if (!cancelled) setEvents(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [task]);

  useEffect(() => {
    if (!task) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previous;
    };
  }, [task, onClose]);

  const suggestion = useMemo(
    () => (task ? suggestForTask(task.title, tasks, settings) : null),
    [task, tasks, settings],
  );
  const risk = useMemo(
    () => (task ? deadlineRisk(task, tasks, settings, now) : null),
    [task, tasks, settings, now],
  );

  if (!task) return null;
  const completed = task.status === 'completed';
  const dependencies = task.dependencyIds
    .map((id) => tasks.find((candidate) => candidate.id === id))
    .filter((candidate): candidate is Task => Boolean(candidate));
  const tone = dueTone(task, now);
  const suggestionApplies =
    suggestion &&
    suggestion.hasEnoughHistory &&
    (suggestion.category !== task.category ||
      suggestion.priority !== task.priority ||
      suggestion.estimatedMinutes !== task.estimatedMinutes);

  return (
    <div className="panel-layer">
      <button type="button" className="panel-backdrop" aria-label="Close task details" onClick={onClose} />
      <aside className="task-panel" role="dialog" aria-modal="true" aria-label={`Task details: ${task.title}`}>
        <header className="panel-head">
          <div className="panel-heading">
            <div className="panel-badges">
              <PriorityBadge priority={task.priority} />
              <CategoryBadge category={task.category} />
              {completed ? <Badge tone="success">Completed</Badge> : null}
              {task.blocked ? (
                <Badge tone="danger">
                  <TriangleAlert size={11} /> Blocked
                </Badge>
              ) : null}
              {task.graphRef ? <Badge tone="info">From {(task.graphRef.kind === 'mail' ? 'Outlook' : 'Teams')}</Badge> : null}
            </div>
            <h2>{task.title}</h2>
            <p className="panel-sub">
              {task.client || 'No client'} · Created {formatDateLong(task.createdAt.slice(0, 10))}
            </p>
          </div>
          <div className="panel-head-actions">
            <IconButton label="Edit task" icon={Pencil} onClick={onEdit} />
            <IconButton label="Close task details" icon={X} onClick={onClose} />
          </div>
        </header>

        <div className="panel-body">
          <section className={`timer-card ${isRunning ? 'running' : ''}`.trim()}>
            <div className="timer-display">
              <span className="timer-label">
                {isRunning ? <span className="live-dot" aria-hidden="true" /> : <Clock size={14} />}
                {isRunning ? 'Tracking now' : isPaused ? 'Paused' : 'Tracked time'}
              </span>
              <strong className="timer-value">{formatSecondsLabel(elapsedMs / 1000)}</strong>
              <span className="timer-sub">
                {formatDuration(task.estimatedMinutes)} estimated · {Math.round(elapsedMs / 60000)}m actual
              </span>
            </div>
            <div className="timer-actions">
              {completed ? (
                <Button variant="secondary" icon={Check} onClick={onToggleComplete}>
                  Reopen task
                </Button>
              ) : isRunning ? (
                <>
                  <Button variant="secondary" icon={Pause} onClick={onPause}>
                    Pause
                  </Button>
                  <Button variant="primary" icon={Square} onClick={onFinish}>
                    Finish
                  </Button>
                </>
              ) : isPaused ? (
                <>
                  <Button variant="primary" icon={Play} onClick={onResume}>
                    Resume
                  </Button>
                  <Button variant="ghost" icon={Check} onClick={onToggleComplete}>
                    Complete task
                  </Button>
                </>
              ) : (
                <Button variant="primary" icon={Play} onClick={onStart}>
                  Start timer
                </Button>
              )}
            </div>
          </section>

          <section className="panel-section">
            <h3>Details</h3>
            <dl className="detail-grid">
              <div>
                <dt>Priority</dt>
                <dd>
                  {PRIORITIES[task.priority].label}
                  {task.deferrals > 0 ? ` · deferred ${task.deferrals}×` : ''}
                </dd>
              </div>
              <div>
                <dt>Category</dt>
                <dd>{CATEGORIES[task.category].label}</dd>
              </div>
              <div>
                <dt>Due</dt>
                <dd className={`due-${tone}`}>{dueLabel(task, now)}</dd>
              </div>
              <div>
                <dt>Estimate</dt>
                <dd>{formatDuration(task.estimatedMinutes)}</dd>
              </div>
              <div>
                <dt>Actual</dt>
                <dd>{task.actualMinutes > 0 ? formatDuration(task.actualMinutes) : 'Not tracked yet'}</dd>
              </div>
              <div>
                <dt>Suggested slot</dt>
                <dd>
                  {task.suggestedDate
                    ? `${formatDateLong(task.suggestedDate)}${task.suggestedStart ? ` · ${task.suggestedStart}` : ''}`
                    : 'Not scheduled'}
                </dd>
              </div>
            </dl>
            {task.notes ? <p className="panel-notes">{task.notes}</p> : null}
            {task.graphRef ? (
              <a className="panel-source" href={task.graphRef.webUrl} target="_blank" rel="noreferrer">
                Open original in {task.graphRef.kind === 'mail' ? 'Outlook' : 'Teams'} <ExternalLink size={12} />
              </a>
            ) : null}
          </section>

          {suggestion ? (
            <section className="panel-section suggestion-card">
              <div className="section-title-row">
                <h3>
                  <Sparkles size={15} /> On-device suggestions
                </h3>
                <Badge tone={suggestion.hasEnoughHistory ? 'info' : 'neutral'}>
                  {suggestion.hasEnoughHistory ? `${suggestion.confidence}% confidence` : 'learning'}
                </Badge>
              </div>
              <div className="suggestion-values">
                <span>
                  <small>Category</small>
                  {CATEGORIES[suggestion.category].label}
                </span>
                <span>
                  <small>Priority</small>
                  {PRIORITIES[suggestion.priority].label}
                </span>
                <span>
                  <small>Duration</small>
                  {formatDuration(suggestion.estimatedMinutes)}
                </span>
              </div>
              <ul className="reason-list">
                {suggestion.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
              <Button
                size="sm"
                variant="secondary"
                disabled={!suggestionApplies}
                onClick={() =>
                  onApplySuggestion({
                    category: suggestion.category,
                    priority: suggestion.priority,
                    estimatedMinutes: suggestion.estimatedMinutes,
                  })
                }
              >
                Apply suggestion
              </Button>
              <p className="fine-print">
                Trained only on your saved tasks on this device. Nothing changes until you tap Apply.
              </p>
            </section>
          ) : null}

          {risk ? (
            <section className="panel-section">
              <div className="section-title-row">
                <h3>
                  <Target size={15} /> Deadline risk
                </h3>
                <Badge tone={risk.level === 'high' ? 'danger' : risk.level === 'medium' ? 'warning' : 'success'}>
                  {risk.score}/100 · {risk.level}
                </Badge>
              </div>
              <ProgressBar value={risk.score} tone={risk.level === 'high' ? 'danger' : risk.level === 'medium' ? 'warning' : 'success'} label="Deadline risk" />
              <ul className="reason-list">
                {risk.factors.map((factor) => (
                  <li key={factor.label}>
                    {factor.label}
                    {factor.points > 0 ? <span className="factor-points">+{factor.points}</span> : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="panel-section">
            <h3>
              <Link2 size={15} /> Dependencies
            </h3>
            {dependencies.length === 0 ? (
              <p className="muted">This task can be scheduled on its own.</p>
            ) : (
              <ul className="dependency-list static">
                {dependencies.map((dependency) => (
                  <li key={dependency.id}>
                    <button type="button" className="link-button" onClick={() => onOpenTask(dependency.id)}>
                      {dependency.title}
                    </button>
                    <span className={`mini-status ${dependency.status}`}>
                      {dependency.status === 'completed' ? <CircleCheck size={12} /> : null}
                      {dependency.status.replace('_', ' ')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {task.blocked ? (
              <p className="field-hint">
                Marked blocked — the scheduler leaves it queued and shows “Why not scheduled”.
              </p>
            ) : null}
          </section>

          <section className="panel-section">
            <h3>History</h3>
            {events.length === 0 ? (
              <p className="muted">No changes recorded yet.</p>
            ) : (
              <ol className="history-list">
                {[...events].reverse().map((event) => (
                  <li key={event.id}>
                    <span className={`history-dot history-${event.type}`} aria-hidden="true" />
                    <div>
                      <p>{event.detail}</p>
                      <small>
                        {event.type} · {formatTimeAgo(event.at, now)}
                      </small>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </aside>
    </div>
  );
}
