import { useMemo, useState } from 'react';
import { addDays } from 'date-fns';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Coffee,
  Info,
  ArrowRight,
  TriangleAlert,
} from 'lucide-react';
import type { DayPlan } from '../lib/engine';
import { buildDayPlan, buildWeekSummary, summarisePlan, workingMinutes } from '../lib/engine';
import {
  formatDateLong,
  formatDuration,
  formatWeekday,
  formatDayNumber,
  formatMonthShort,
  minutesToTime,
  todayISO,
} from '../lib/dates';
import { learnDurations } from '../lib/ml';
import type { CommonPageProps } from './pageProps';
import { Badge, Button, ConfirmDialog, EmptyState, ProgressBar, Segmented } from './ui';
import { PageHeader } from './Shell';

export function SchedulePage({
  tasks,
  settings,
  now,
  timer,
  taskHandlers,
  onOpenPage,
  addToast,
  onApplyPlan,
}: CommonPageProps & { onApplyPlan: (plan: DayPlan) => void }) {
  const [view, setView] = useState<'day' | 'week'>('day');
  const [selected, setSelected] = useState<Date>(() => new Date(now));
  const [confirmOpen, setConfirmOpen] = useState(false);
  const selectedISO = todayISO(selected);
  const today = todayISO(now);
  const isToday = selectedISO === today;
  const plan = useMemo(() => {
    const learned = learnDurations(tasks, timer.sessions).learned;
    return buildDayPlan(tasks, settings, now, { date: selected, learned });
  }, [tasks, settings, now, selected, timer.sessions]);
  const week = useMemo(() => buildWeekSummary(tasks, settings, selected), [tasks, settings, selected]);
  const summary = summarisePlan(plan);
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const changeDay = (offset: number) => {
    const next = addDays(selected, offset);
    setSelected(next);
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="Explainable scheduling"
        title="Schedule"
        description="Priority, deadline and deferrals decide order. Lunch is protected, buffers are real, and nothing is silently dropped."
        actions={
          <>
            <Segmented<'day' | 'week'>
              ariaLabel="Schedule view"
              value={view}
              onChange={setView}
              options={[
                { value: 'day', label: 'Day' },
                { value: 'week', label: 'Week' },
              ]}
            />
            <Button variant="primary" icon={ArrowRight} onClick={() => setConfirmOpen(true)}>
              Apply suggestions
            </Button>
          </>
        }
      />

      <div className="date-nav card">
        <button type="button" className="icon-btn" aria-label="Previous day" onClick={() => changeDay(-1)}>
          <ChevronLeft size={18} />
        </button>
        <div className="date-nav-label">
          <strong>{formatDateLong(selectedISO)}</strong>
          <span>
            {isToday ? 'Today' : 'Selected day'} ·{' '}
            {settings.workingDays.includes(selected.getDay()) ? 'Working day' : 'Non-working day'}
          </span>
        </div>
        <button type="button" className="icon-btn" aria-label="Next day" onClick={() => changeDay(1)}>
          <ChevronRight size={18} />
        </button>
        <Button size="sm" variant="ghost" onClick={() => setSelected(new Date(now))}>
          Today
        </Button>
      </div>

      {view === 'day' ? (
        <div className="schedule-grid">
          <section className="card timeline-card">
            <div className="section-head">
              <h2>
                <CalendarDays size={16} /> Daily timeline
              </h2>
              <div className="timeline-summary">
                <Badge tone="info">{formatDuration(plan.plannedMinutes)} planned</Badge>
                <Badge tone={plan.remainingMinutes > 0 ? 'success' : 'warning'}>
                  {formatDuration(plan.remainingMinutes)} free
                </Badge>
                {plan.queued.length > 0 ? <Badge tone="warning">{plan.queued.length} queued</Badge> : null}
              </div>
            </div>

            {!plan.isWorkingDay ? (
              <EmptyState
                icon={Coffee}
                title="Not a working day"
                message="Your settings mark this day as non-working, so nothing is auto-scheduled. You can still schedule manually."
                action={
                  <Button variant="secondary" onClick={() => onOpenPage('settings')}>
                    Change working days
                  </Button>
                }
              />
            ) : (
              <>
                <ProgressBar
                  value={plan.capacityMinutes > 0 ? Math.round((plan.plannedMinutes / plan.capacityMinutes) * 100) : 0}
                  label="Planned vs capacity"
                />
                <p className="fine-print">
                  Capacity {formatDuration(plan.capacityMinutes)} ({settings.workdayStart}–{settings.workdayEnd}, lunch{' '}
                  {settings.lunchStart}–{settings.lunchEnd}) · buffer {settings.bufferMinutes}m · focus blocks{' '}
                  {settings.focusBlockMinutes}m
                </p>
                {isToday ? <p className="fine-print">Now {minutesToTime(nowMinutes)} — planning starts after this time.</p> : null}

                {plan.conflicts.length > 0 ? (
                  <div className="notice-card warning">
                    <TriangleAlert size={16} />
                    <div>
                      <strong>{plan.conflicts.length} overlap warning</strong>
                      {plan.conflicts.map((conflict) => (
                        <p key={`${conflict.firstTaskId}-${conflict.secondTaskId}`}>{conflict.message}</p>
                      ))}
                    </div>
                  </div>
                ) : null}

                {plan.blocks.length === 0 ? (
                  <EmptyState
                    icon={CalendarDays}
                    title="Nothing scheduled"
                    message="No tasks fit the remaining time, or your queue is empty. Suggestions never fake a slot."
                  />
                ) : (
                  <ol className="timeline">
                    {plan.blocks.map((block) => {
                      const task = block.taskId ? taskById.get(block.taskId) : undefined;
                      const active = isToday && nowMinutes >= block.start && nowMinutes < block.end;
                      return (
                        <li key={block.id} className={`timeline-block ${block.kind} ${active ? 'now' : ''}`.trim()}>
                          <div className="timeline-time">
                            <strong>{minutesToTime(block.start)}</strong>
                            <span>{formatDuration(block.end - block.start)}</span>
                          </div>
                          <div className="timeline-body">
                            {block.kind === 'break' ? (
                              <p className="timeline-title">
                                <Coffee size={14} /> {block.title}
                              </p>
                            ) : block.kind === 'buffer' ? (
                              <p className="timeline-title muted">Buffer</p>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  className="timeline-title link"
                                  onClick={() => task && taskHandlers(task).onOpen()}
                                >
                                  {block.title}
                                </button>
                                <div className="timeline-meta">
                                  <Badge tone="info">{task?.category.replace('_', ' ') ?? 'focus'}</Badge>
                                  {task ? <span>{formatDuration(task.estimatedMinutes)} estimated</span> : null}
                                  {block.end - block.start >= settings.focusBlockMinutes ? (
                                    <span className="focus-label">Focus block</span>
                                  ) : null}
                                  {block.learned ? <span className="focus-label">Learned duration</span> : null}
                                  {active ? <Badge tone="success">Now</Badge> : null}
                                </div>
                              </>
                            )}
                          </div>
                        </li>
                      );
                    })}
                    {isToday ? (
                      <li className="timeline-now" aria-hidden="true">
                        <span>Now · {minutesToTime(nowMinutes)}</span>
                      </li>
                    ) : null}
                  </ol>
                )}
              </>
            )}
          </section>

          <aside className="schedule-side">
            <section className="card">
              <div className="section-head">
                <h2>Unscheduled queue</h2>
                <Badge tone={plan.queued.length > 0 ? 'warning' : 'success'}>{plan.queued.length}</Badge>
              </div>
              {plan.queued.length === 0 ? (
                <p className="muted">Everything open fits the plan. Nice.</p>
              ) : (
                <ul className="queue-list">
                  {plan.queued.map((item) => (
                    <li key={`${item.task.id}-${item.reason}`}>
                      <button type="button" className="queue-title" onClick={() => taskHandlers(item.task).onOpen()}>
                        {item.task.title}
                      </button>
                      <p className="queue-reason">
                        <Info size={12} /> {item.reason}
                      </p>
                      <span className="queue-meta">
                        {formatDuration(item.estimateMinutes)} · {item.task.priority}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="card">
              <h2>How scoring works</h2>
              <ul className="limit-list">
                <li>Priority weight: Critical 40 → Low 10.</li>
                <li>Deadlines add up to 35 points; overdue ranks highest.</li>
                <li>Each deferral adds 4 points (max 15).</li>
                <li>Blocked tasks and unfinished dependencies are never scheduled.</li>
                <li>Lunch and buffers are reserved before tasks are placed.</li>
                <li>With 3+ timed samples, learned category or client durations replace estimates.</li>
              </ul>
            </section>
          </aside>
        </div>
      ) : (
        <section className="card week-view">
          <div className="section-head">
            <h2>Week of {formatMonthShort(week[0].dateISO)}</h2>
            <span className="muted">Real due dates only — no invented slots</span>
          </div>
          <div className="week-grid">
            {week.map((day) => {
              const dayTasks = tasks.filter(
                (task) =>
                  task.deletedAt === null &&
                  task.status !== 'completed' &&
                  task.dueDate === day.dateISO,
              );
              return (
                <div
                  key={day.dateISO}
                  className={`week-column ${day.dateISO === today ? 'today' : ''}`.trim()}
                >
                  <div className="week-column-head">
                    <span>{formatWeekday(day.dateISO)}</span>
                    <strong>{formatDayNumber(day.dateISO)}</strong>
                  </div>
                  <p className="week-column-meta">
                    {day.dueCount} due · {formatDuration(day.scheduledMinutes)} planned
                  </p>
                  <ul className="week-task-list">
                    {dayTasks.slice(0, 6).map((task) => (
                      <li key={task.id}>
                        <button type="button" onClick={() => taskHandlers(task).onOpen()}>
                          {task.title}
                        </button>
                        <span className={`priority-text priority-${task.priority}`}>{task.priority}</span>
                      </li>
                    ))}
                    {dayTasks.length === 0 ? <li className="muted">No deadlines</li> : null}
                    {dayTasks.length > 6 ? <li className="muted">+{dayTasks.length - 6} more</li> : null}
                  </ul>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setSelected(new Date(`${day.dateISO}T12:00:00`));
                      setView('day');
                    }}
                  >
                    Open day
                  </Button>
                </div>
              );
            })}
          </div>
          <p className="fine-print">
            Weekly capacity uses the same working hours as daily planning: {formatDuration(workingMinutes(settings))} per
            working day.
          </p>
        </section>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Apply these suggestions?"
        tone="primary"
        confirmLabel="Apply suggestions"
        message={
          <>
            <p>
              This moves <strong>{summary.moves}</strong> task{summary.moves === 1 ? '' : 's'} into suggested slots for{' '}
              <strong>{formatDateLong(selectedISO)}</strong>.
            </p>
            <p>
              <strong>{summary.staysQueued}</strong> task{summary.staysQueued === 1 ? '' : 's'} stay in the queue with a
              reason.
            </p>
            <p>
              <strong>{summary.deadlineChanges}</strong> deadline{summary.deadlineChanges === 1 ? '' : 's'} will change. Due
              dates are never rewritten by scheduling.
            </p>
          </>
        }
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          onApplyPlan(plan);
          addToast('Suggestions applied — deadlines were not changed.', 'success');
        }}
      />
    </div>
  );
}
