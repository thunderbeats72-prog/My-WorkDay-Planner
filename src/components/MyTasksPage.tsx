import { useMemo, useState } from 'react';
import {
  CalendarClock,
  CalendarRange,
  ChevronDown,
  Coffee,
  Flame,
  Info,
  ListFilter,
  Plus,
  ScanText,
  Search,
  TriangleAlert,
} from 'lucide-react';
import { dayOffset, formatDuration, minutesToTime, todayISO } from '../lib/dates';
import type { DayPlan } from '../lib/engine';
import { buildDayPlan, scoreTask, summarisePlan } from '../lib/engine';
import { learnDurations } from '../lib/ml';
import type { Task } from '../lib/types';
import type { CommonPageProps } from './pageProps';
import { TaskCard } from './TaskCard';
import { Badge, Button, ConfirmDialog, EmptyState, ProgressBar } from './ui';
import { PageHeader } from './Shell';

type Scope = 'all' | 'overdue' | 'today' | 'scheduled' | 'urgent';
type Sort = 'smart' | 'deadline' | 'newest';

/**
 * One surface for everything that used to be three pages.
 *
 * "Inbox", "Overdue" and "Schedule" are the same question asked three ways —
 * what needs me, what is late, and when will it happen. They now share a page:
 * a live plan strip at the top, honest filter chips below it, and one list.
 * Screenshot import is an action here rather than a destination.
 */
export function MyTasksPage({
  tasks,
  settings,
  now,
  timer,
  taskHandlers,
  onNewTask,
  onOpenImport,
  onApplyPlan,
}: CommonPageProps & {
  onOpenImport: () => void;
  onApplyPlan: (plan: DayPlan) => void;
}) {
  const [scope, setScope] = useState<Scope>('all');
  const [sort, setSort] = useState<Sort>('smart');
  const [query, setQuery] = useState('');
  const [planOpen, setPlanOpen] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const today = todayISO(now);
  const openTasks = tasks.filter((task) => task.status !== 'completed' && task.deletedAt === null);
  const overdue = openTasks.filter((task) => task.dueDate !== null && task.dueDate < today);
  const dueToday = openTasks.filter((task) => task.dueDate === today);

  const plan = useMemo(() => {
    const learned = learnDurations(tasks, timer.sessions).learned;
    return buildDayPlan(tasks, settings, now, { learned });
  }, [tasks, settings, now, timer.sessions]);
  const summary = summarisePlan(plan);
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  /* A long task is split into focus blocks; the strip shows one row per task,
     with the total span, so the day reads as a plan rather than a puzzle. */
  const visibleBlocks = (() => {
    const merged: Array<{ id: string; kind: string; start: number; end: number; title: string; taskId: string | null }> = [];
    for (const block of plan.blocks) {
      if (block.kind === 'buffer') continue;
      const previous = merged[merged.length - 1];
      if (block.kind === 'focus' && previous && previous.kind === 'focus' && previous.taskId === block.taskId) {
        previous.end = block.end;
        continue;
      }
      merged.push({ id: block.id, kind: block.kind, start: block.start, end: block.end, title: block.title, taskId: block.taskId });
    }
    return merged;
  })();

  const scopes: Array<{ value: Scope; label: string; count: number }> = [
    { value: 'all', label: 'All open', count: openTasks.length },
    { value: 'overdue', label: 'Overdue', count: overdue.length },
    { value: 'today', label: 'Due today', count: dueToday.length },
    {
      value: 'scheduled',
      label: 'Planned',
      count: new Set(plan.blocks.filter((block) => block.taskId).map((block) => block.taskId)).size,
    },
    {
      value: 'urgent',
      label: 'Critical + high',
      count: openTasks.filter((task) => task.priority === 'critical' || task.priority === 'high').length,
    },
  ];

  const visible = (() => {
    const search = query.trim().toLowerCase();
    const plannedIds = new Set(plan.blocks.filter((block) => block.taskId).map((block) => block.taskId));
    let result = openTasks.filter((task) => {
      if (search) {
        const haystack = `${task.title} ${task.client} ${task.notes}`.toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      switch (scope) {
        case 'overdue':
          return task.dueDate !== null && task.dueDate < today;
        case 'today':
          return task.dueDate === today;
        case 'scheduled':
          return plannedIds.has(task.id);
        case 'urgent':
          return task.priority === 'critical' || task.priority === 'high';
        default:
          return true;
      }
    });
    result = [...result].sort((a, b) => {
      if (sort === 'newest') return b.createdAt.localeCompare(a.createdAt);
      if (sort === 'deadline') {
        const aDue = a.dueDate ?? '9999-12-31';
        const bDue = b.dueDate ?? '9999-12-31';
        if (aDue !== bDue) return aDue.localeCompare(bDue);
        return b.createdAt.localeCompare(a.createdAt);
      }
      return scoreTask(b, settings, now).score - scoreTask(a, settings, now).score;
    });
    return result;
  })();

  const overdueMinutes = overdue.reduce((sum, task) => sum + task.estimatedMinutes, 0);

  const renderTask = (task: Task, showAge = false) => (
    <div key={task.id} className="task-item">
      {showAge && task.dueDate ? (
        <p className="task-age">
          {Math.abs(dayOffset(task.dueDate, now))} day{Math.abs(dayOffset(task.dueDate, now)) === 1 ? '' : 's'} overdue
        </p>
      ) : null}
      <TaskCard
        task={task}
        now={now}
        elapsedMs={timer.elapsedMsFor(task.id)}
        isRunning={timer.isRunning(task.id)}
        isPaused={timer.hasPausedSession(task.id)}
        handlers={taskHandlers(task)}
      />
    </div>
  );

  return (
    <div className="page">
      <PageHeader
        eyebrow="Everything captured"
        title="My Tasks"
        description="Every open task, the overdue ones, and how today actually fits together — in one place."
        actions={
          <>
            <Button variant="secondary" icon={ScanText} onClick={onOpenImport}>
              Import screenshot
            </Button>
            <Button variant="primary" icon={Plus} onClick={onNewTask}>
              New task
            </Button>
          </>
        }
      />

      {/* ---- Today's plan: the schedule, compressed to what you need ---- */}
      <section className={`plan-card card ${planOpen ? 'is-open' : ''}`.trim()}>
        <button
          type="button"
          className="plan-head"
          aria-expanded={planOpen}
          onClick={() => setPlanOpen((open) => !open)}
        >
          <span className="plan-title">
            <CalendarRange size={15} aria-hidden="true" />
            Today&rsquo;s plan
          </span>
          <span className="plan-meta">
            <span className="plan-meta-item">{formatDuration(plan.plannedMinutes)} planned</span>
            <span className="plan-meta-dot" aria-hidden="true" />
            <span className="plan-meta-item">{formatDuration(plan.remainingMinutes)} free</span>
            {plan.queued.length > 0 ? (
              <>
                <span className="plan-meta-dot" aria-hidden="true" />
                <span className="plan-meta-item is-warn">{plan.queued.length} queued</span>
              </>
            ) : null}
          </span>
          <ChevronDown className="plan-chevron" size={16} aria-hidden="true" />
        </button>

        {planOpen ? (
          <div className="plan-body">
            {!plan.isWorkingDay ? (
              <p className="plan-empty">
                <Coffee size={14} aria-hidden="true" /> Not a working day — nothing is auto-scheduled.
              </p>
            ) : (
              <>
                <ProgressBar
                  value={plan.capacityMinutes > 0 ? Math.round((plan.plannedMinutes / plan.capacityMinutes) * 100) : 0}
                  label="Planned vs capacity"
                />

                {visibleBlocks.length === 0 ? (
                  <p className="plan-empty">
                    <Info size={14} aria-hidden="true" /> Nothing fits the remaining time yet. Suggestions never fake a
                    slot.
                  </p>
                ) : (
                  <ol className="plan-strip">
                    {visibleBlocks.map((block) => {
                      const task = block.taskId ? taskById.get(block.taskId) : undefined;
                      const active = nowMinutes >= block.start && nowMinutes < block.end;
                      return (
                        <li key={block.id} className={`plan-slot ${block.kind} ${active ? 'is-now' : ''}`.trim()}>
                          <span className="plan-slot-time">{minutesToTime(block.start)}</span>
                          {block.kind === 'break' ? (
                            <span className="plan-slot-title is-break">
                              <Coffee size={11} aria-hidden="true" /> {block.title}
                            </span>
                          ) : (
                            <button
                              type="button"
                              className="plan-slot-title"
                              onClick={() => task && taskHandlers(task).onOpen()}
                            >
                              {block.title}
                            </button>
                          )}
                          <span className="plan-slot-dur">{formatDuration(block.end - block.start)}</span>
                          {active ? <span className="plan-slot-now">now</span> : null}
                        </li>
                      );
                    })}
                  </ol>
                )}

                {plan.queued.length > 0 ? (
                  <details className="plan-queue">
                    <summary>
                      <Info size={13} aria-hidden="true" /> {plan.queued.length} waiting for room
                    </summary>
                    <ul>
                      {plan.queued.slice(0, 6).map((item) => (
                        <li key={`${item.task.id}-${item.reason}`}>
                          <button type="button" onClick={() => taskHandlers(item.task).onOpen()}>
                            {item.task.title}
                          </button>
                          <span>{item.reason}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}

                <div className="plan-actions">
                  <Button size="sm" variant="secondary" onClick={() => setConfirmOpen(true)}>
                    Apply suggestions
                  </Button>
                  <span className="plan-fine">
                    {summary.moves} move · {summary.staysQueued} queued · deadlines never change
                  </span>
                </div>
              </>
            )}
          </div>
        ) : null}
      </section>

      {overdue.length > 0 ? (
        <div className="notice-card danger">
          <TriangleAlert size={16} aria-hidden="true" />
          <div>
            <strong>
              {overdue.length} overdue · {formatDuration(overdueMinutes)} to clear
            </strong>
            <p>Only real due dates count here — a suggested time passing never marks a task late.</p>
          </div>
        </div>
      ) : null}

      {/* ---- Filters ---- */}
      <div className="toolbar">
        <div className="toolbar-row split">
          <div className="filter-chips" role="group" aria-label="Filter tasks">
            {scopes.map((entry) => (
              <button
                key={entry.value}
                type="button"
                className={`chip-button ${scope === entry.value ? 'active' : ''}`.trim()}
                aria-pressed={scope === entry.value}
                onClick={() => setScope(entry.value)}
              >
                {entry.label}
                <span>{entry.count}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="toolbar-row split">
          <div className="search-field">
            <Search size={15} aria-hidden="true" />
            <input
              id="tasks-search"
              className="input"
              placeholder="Search title, client or notes"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div className="sort-switch" role="group" aria-label="Sort tasks">
            {(['smart', 'deadline', 'newest'] as Sort[]).map((option) => (
              <button
                key={option}
                type="button"
                className={`sort-option ${sort === option ? 'active' : ''}`.trim()}
                aria-pressed={sort === option}
                onClick={() => setSort(option)}
              >
                {option === 'smart' ? 'Smart' : option === 'deadline' ? 'Deadline' : 'Newest'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="list-head">
        <h2>
          <ListFilter size={14} aria-hidden="true" /> {visible.length} task{visible.length === 1 ? '' : 's'}
        </h2>
        {scope === 'overdue' && overdue.length > 0 ? <Badge tone="danger">late</Badge> : null}
        {visible.length !== openTasks.length && scope !== 'all' ? <Badge tone="neutral">filtered</Badge> : null}
      </div>

      {visible.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={scope === 'overdue' ? Flame : CalendarClock}
            title={
              openTasks.length === 0
                ? 'Nothing in the planner yet'
                : scope === 'overdue'
                  ? 'Nothing is overdue'
                  : 'No tasks match this filter'
            }
            message={
              openTasks.length === 0
                ? 'Add your first task, or import a screenshot to pull in follow-ups.'
                : scope === 'overdue'
                  ? 'Every open task is due today or later. Keep it that way.'
                  : 'Try a different filter, clear the search, or add a new task.'
            }
            action={
              <Button variant="primary" icon={Plus} onClick={onNewTask}>
                New task
              </Button>
            }
          />
        </div>
      ) : (
        <div className="task-list">
          {visible.map((task) => renderTask(task, scope === 'overdue' || (task.dueDate !== null && task.dueDate < today)))}
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Apply these suggestions?"
        tone="primary"
        confirmLabel="Apply suggestions"
        message={
          <>
            <p>
              This moves <strong>{summary.moves}</strong> task{summary.moves === 1 ? '' : 's'} into suggested slots for
              today.
            </p>
            <p>
              <strong>{summary.staysQueued}</strong> task{summary.staysQueued === 1 ? '' : 's'} stay in the queue with a
              reason.
            </p>
            <p>
              <strong>{summary.deadlineChanges}</strong> deadline{summary.deadlineChanges === 1 ? '' : 's'} will change.
              Due dates are never rewritten by scheduling.
            </p>
          </>
        }
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          onApplyPlan(plan);
        }}
      />
    </div>
  );
}
