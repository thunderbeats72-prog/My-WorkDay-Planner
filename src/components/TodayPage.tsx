import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';
import {
  AlarmClock,
  Bell,
  CalendarClock,
  CalendarRange,
  Check,
  Clock,
  Flame,
  Inbox,
  MoonStar,
  Play,
  CornerDownLeft,
  Plus,
  RefreshCw,
  Target,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type { Priority } from '../lib/types';
import { PRIORITIES, PRIORITY_ORDER } from '../lib/types';
import {
  countdownLabel,
  daysFromNow,
  formatDateLong,
  formatDuration,
  formatWeekday,
  isTaskOverdue,
  formatDayNumber,
  greetingForHour,
  parseTimeToMinutes,
  percent,
  relativeDayLabel,
  taskDueAt,
  todayISO,
} from '../lib/dates';
import { buildDayPlan } from '../lib/engine';
import type { ReminderItem } from '../lib/engine';
import { deadlineRisk, learnDurations } from '../lib/ml';
import { suggestFocus } from '../lib/focus';
import { parseQuickAdd } from '../lib/quickAdd';
import { dayVibe } from '../lib/vibe';
import type { CommonPageProps } from './pageProps';
import { TaskCard } from './TaskCard';
import { AnimatedValue, Badge, Button, EmptyState, PriorityBadge, ProgressBar, Ring } from './ui';

export function TodayPage({
  tasks,
  settings,
  now,
  timer,
  taskHandlers,
  onOpenPage,
  onQuickAdd,
  onNewTask,
  addToast,
  online,
  graphCard,
  reminders,
  notificationsPermission,
  onRequestNotifications,
  onSnoozeReminder,
  onDismissReminder,
  onStartTask,
  onResumeTask,
  onCompleteReminder,
  onDeferTodayToTomorrow,
}: CommonPageProps & {
  graphCard: ReactNode;
  reminders: ReminderItem[];
  notificationsPermission: string;
  onRequestNotifications: () => void;
  onSnoozeReminder: (taskId: string) => void;
  onDismissReminder: (taskId: string) => void;
  onStartTask: (taskId: string) => void;
  onResumeTask: (taskId: string) => void;
  onCompleteReminder: (taskId: string) => void;
  onDeferTodayToTomorrow: () => void;
}) {
  const [quickTitle, setQuickTitle] = useState('');
  const [quickPriority, setQuickPriority] = useState<Priority>(settings.defaultPriority);
  const [wrapUpDismissed, setWrapUpDismissed] = useState(false);
  const [focusSkip, setFocusSkip] = useState(0);
  const today = todayISO(now);
  const openTasks = tasks.filter((task) => task.status !== 'completed' && task.deletedAt === null);
  const learned = learnDurations(tasks, timer.sessions).learned;
  const plan = buildDayPlan(tasks, settings, now, { learned });
  const capacity = plan.capacityMinutes;
  const planned = plan.plannedMinutes;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const endMinutes = parseTimeToMinutes(settings.workdayEnd);
  const workdayOver = nowMinutes >= endMinutes;
  const workingToday = settings.workingDays.includes(now.getDay());
  // Free time is the smaller of uncommitted capacity and the hours actually
  // left — at 17:00 there is an hour, not the whole morning's remainder.
  const minutesLeft = Math.max(0, endMinutes - nowMinutes);
  const freeMinutes =
    workdayOver || !workingToday ? 0 : Math.max(0, Math.min(capacity - planned, minutesLeft));
  const completedToday = tasks.filter(
    (task) => task.status === 'completed' && task.completedAt && task.completedAt.slice(0, 10) === today,
  ).length;
  const overdue = openTasks.filter((task) => isTaskOverdue(task, now));
  const dueToday = openTasks.filter((task) => task.dueDate === today);
  const inProgress = openTasks.filter((task) => task.status === 'in_progress' && task.dueDate !== today);
  const remaining = openTasks.filter(
    (task) =>
      task.dueDate !== today &&
      task.status !== 'in_progress' &&
      !isTaskOverdue(task, now),
  );
  const atRisk = openTasks
    .map((task) => ({ task, risk: deadlineRisk(task, tasks, settings, now) }))
    .filter((entry) => entry.risk.score >= 40)
    .sort((a, b) => b.risk.score - a.risk.score)
    .slice(0, 4);
  const firstName = settings.name.trim().split(/\s+/)[0] ?? '';
  const plannedPercent = percent(planned, capacity);
  const vibe = dayVibe({
    overdue: overdue.length,
    dueToday: dueToday.length,
    completedToday,
    plannedPercent,
    openCount: openTasks.length,
  });
  const nextDays = Array.from({ length: 7 }, (_, index) => {
    const iso = index === 0 ? today : daysFromNow(index, now);
    const due = openTasks.filter((task) => task.dueDate === iso).length;
    return { iso, due, overdue: index === 0 ? overdue.length : 0 };
  });

  const hour = now.getHours();
  const timeOfDay = hour < 5 ? 'night' : hour < 9 ? 'dawn' : hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : hour < 21 ? 'evening' : 'night';

  const clients = useMemo(
    () => Array.from(new Set(tasks.map((task) => task.client).filter((client): client is string => Boolean(client)))).sort(),
    [tasks],
  );
  const quickPreview = useMemo(
    () =>
      parseQuickAdd(quickTitle, {
        now,
        fallbackPriority: quickPriority,
        fallbackEstimateMinutes: settings.defaultEstimateMinutes,
        clients,
      }),
    [quickTitle, now, quickPriority, settings.defaultEstimateMinutes, clients],
  );
  // Live: the next thing with a real deadline, recomputed as the clock moves.
  const nextDeadline = openTasks
    .map((task) => ({ task, at: taskDueAt(task) }))
    .filter((entry): entry is { task: typeof openTasks[number]; at: Date } => entry.at !== null)
    .filter((entry) => entry.at.getTime() >= now.getTime())
    .sort((a, b) => a.at.getTime() - b.at.getTime())[0] ?? null;

  const focus = suggestFocus(tasks, settings, now, {
    learned,
    freeMinutes,
    runningTaskId: timer.activeSession?.taskId ?? null,
    skip: focusSkip,
  });
  const focusRunning = Boolean(focus && timer.isRunning(focus.task.id));
  const focusPaused = Boolean(focus && timer.hasPausedSession(focus.task.id));
  const showWrapUp = workdayOver && dueToday.length > 0 && !wrapUpDismissed;

  const submitQuickAdd = () => {
    if (!quickTitle.trim()) return;
    onQuickAdd(quickPreview.draft);
    setQuickTitle('');
  };

  return (
    <div className="page today-page">
      <section className="hero" data-tod={timeOfDay}>
        <div className="hero-copy">
          <p className="eyebrow">{formatDateLong(today)}</p>
          <h1>
            {greetingForHour(now.getHours())}
            {firstName ? `, ${firstName}` : ''}
          </h1>
          <p className="hero-sub">
            {overdue.length > 0
              ? overdue.length === 1
                ? '1 task is past its deadline. Clear it first.'
                : `${overdue.length} tasks are past their deadlines. Clear those first.`
              : dueToday.length > 0
                ? !workingToday
                  ? `${dueToday.length} deadline${dueToday.length === 1 ? ' lands' : 's land'} today, outside your working days.`
                  : workdayOver
                    ? `${dueToday.length} deadline${dueToday.length === 1 ? ' is' : 's are'} still open today. Wrap up below when you are ready.`
                    : `${dueToday.length} deadline${dueToday.length === 1 ? ' lands' : 's land'} today. Your schedule has room for ${formatDuration(freeMinutes)}.`
                : `${openTasks.length} open task${openTasks.length === 1 ? '' : 's'} · ${
                    !workingToday
                      ? 'a rest day, nothing scheduled'
                      : workdayOver
                        ? 'the workday is done'
                        : `${formatDuration(freeMinutes)} still free today`
                  }.`}
          </p>
          <div className="hero-chips">
            <span className={`vibe-chip vibe-${vibe.tone}`} title={vibe.note}>
              <span className="vibe-glyph" aria-hidden="true" />
              <span className="vibe-label">{vibe.label}</span>
              <span className="vibe-meter" aria-hidden="true">
                <i style={{ width: `${vibe.score}%` }} />
              </span>
              <span className="sr-only">Day vibe: {vibe.note}</span>
            </span>
            <span className={`chip ${online ? 'chip-online' : 'chip-offline'}`}>
              {online ? <Wifi size={12} /> : <WifiOff size={12} />}
              {online ? 'Online' : 'Offline'}
            </span>
            {nextDeadline ? (
              <span
                className={`chip chip-live ${nextDeadline.at.getTime() - now.getTime() <= 60 * 60_000 ? 'is-urgent' : ''}`}
                title={`${nextDeadline.task.title} — ${formatDateLong(nextDeadline.task.dueDate ?? today)}`}
              >
                <AlarmClock size={12} />
                {nextDeadline.at.getTime() <= now.getTime() ? 'Due now' : `Next in ${countdownLabel(nextDeadline.at, now)}`}
              </span>
            ) : null}
          </div>
          <div className="hero-stats">
            <div>
              <strong>
                <AnimatedValue value={overdue.length} />
              </strong>
              <span>Overdue</span>
            </div>
            <div>
              <strong>
                <AnimatedValue value={dueToday.length} />
              </strong>
              <span>Due today</span>
            </div>
            <div>
              <strong>
                <AnimatedValue value={completedToday} />
              </strong>
              <span>Done today</span>
            </div>
            <div>
              <strong>{formatDuration(freeMinutes)}</strong>
              <span>Free capacity</span>
            </div>
          </div>
          <p className="hero-readout">
            <kbd>⌘K</kbd> search
            <span aria-hidden="true">·</span>
            <kbd>/</kbd> quick add
            <span aria-hidden="true">·</span>
            <kbd>?</kbd> shortcuts
            <span className="readout-caret" aria-hidden="true" />
          </p>
        </div>
        <div className="hero-ring">
          <Ring
            value={plannedPercent}
            size={168}
            stroke={12}
            label={`${plannedPercent}%`}
            sublabel="day planned"
          />
          <p>
            {capacity > 0
              ? `${formatDuration(planned)} of ${formatDuration(capacity)} committed`
              : 'No working hours today'}
          </p>
        </div>
      </section>

      <section className="quick-add card" aria-label="Quick add a task">
        <Plus size={18} aria-hidden="true" />
        <input
          id="quick-add-input"
          className="quick-add-input"
          placeholder="Quick add for today — type and press Enter"
          autoComplete="off"
          value={quickTitle}
          aria-describedby="quick-add-help"
          onChange={(event) => setQuickTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              submitQuickAdd();
            } else if (event.key === 'Escape') {
              setQuickTitle('');
            }
          }}
        />
        <select
          className="input quick-add-priority"
          aria-label="Priority for quick add"
          value={quickPreview.hasPriority ? quickPreview.draft.priority : quickPriority}
          disabled={quickPreview.hasPriority}
          title={quickPreview.hasPriority ? 'Priority is coming from the !token you typed' : undefined}
          onChange={(event) => setQuickPriority(event.target.value as Priority)}
        >
          {PRIORITY_ORDER.map((priority) => (
            <option key={priority} value={priority}>
              {PRIORITIES[priority].label}
            </option>
          ))}
        </select>
        <Button variant="primary" disabled={!quickTitle.trim()} onClick={submitQuickAdd}>
          Add
        </Button>
        <div className="quick-add-meta" id="quick-add-help">
          {quickPreview.tokens.length > 0 ? (
            <>
              <div className="quick-tokens">
                {quickPreview.tokens.map((token) => (
                  <span key={`${token.kind}-${token.label}`} className={`quick-token quick-token-${token.kind}`}>
                    {token.label}
                  </span>
                ))}
                {quickPreview.rolledOver ? (
                  <span className="quick-note">that time already passed today</span>
                ) : null}
              </div>
              <span className="quick-saves">
                Saves for {quickPreview.draft.dueDate ? relativeDayLabel(quickPreview.draft.dueDate, now) : 'no date'}
              </span>
            </>
          ) : (
            <p className="quick-tip">
              <CornerDownLeft size={12} aria-hidden="true" />
              Type naturally — “email Sam tomorrow 3pm !high 30m #email @Nova”
            </p>
          )}
        </div>
      </section>

      {showWrapUp ? (
        <section className="card wrapup-card">
          <div className="wrapup-copy">
            <span className="wrapup-eyebrow">
              <MoonStar size={13} aria-hidden="true" /> End of day
            </span>
            <h2>
              The workday is done — {dueToday.length} task{dueToday.length === 1 ? ' is' : 's are'} still dated today.
            </h2>
            <p className="muted">
              Roll {dueToday.length === 1 ? 'it' : 'them'} to tomorrow and the deferral is counted honestly. Nothing is
              lost.
            </p>
          </div>
          <div className="wrapup-actions">
            <Button variant="primary" onClick={onDeferTodayToTomorrow}>
              Move to tomorrow
            </Button>
            <Button variant="ghost" onClick={() => setWrapUpDismissed(true)}>
              Keep {dueToday.length === 1 ? 'it' : 'them'} today
            </Button>
          </div>
        </section>
      ) : null}

      {focus ? (
        <section className={`card focus-card focus-${focus.kind}`} aria-label="Suggested next task">
          <div className="focus-top">
            <span className="focus-eyebrow">
              <Target size={13} aria-hidden="true" /> Do this next
            </span>
            <span className="focus-score" title="Scheduler score: priority, deadline, deferrals and age">
              <strong>{focus.score}</strong>
              <small>/100</small>
            </span>
          </div>
          <div className="focus-main">
            <div className="focus-copy">
              <h3 className="focus-title">{focus.task.title}</h3>
              <p className="focus-reason">{focus.reason}</p>
              <div className="focus-meta">
                <span>
                  <Clock size={12} aria-hidden="true" /> {formatDuration(focus.estimateMinutes)}
                </span>
                <PriorityBadge priority={focus.task.priority} />
                {focus.task.client ? <span className="focus-client">{focus.task.client}</span> : null}
              </div>
            </div>
            <div className="focus-actions">
              {focusRunning ? (
                <Button variant="primary" icon={Clock} onClick={() => taskHandlers(focus.task).onOpen()}>
                  Timer running
                </Button>
              ) : focusPaused ? (
                <Button variant="primary" icon={Play} onClick={() => onResumeTask(focus.task.id)}>
                  Resume focus
                </Button>
              ) : (
                <Button variant="primary" icon={Play} onClick={() => onStartTask(focus.task.id)}>
                  Start focus
                </Button>
              )}
              <Button variant="ghost" onClick={() => taskHandlers(focus.task).onOpen()}>
                Open
              </Button>
              {focus.options.length > 1 ? (
                <button
                  type="button"
                  className="focus-shuffle"
                  aria-label="Suggest another task"
                  title="Suggest another task"
                  onClick={() => setFocusSkip((current) => current + 1)}
                >
                  <RefreshCw size={15} aria-hidden="true" />
                </button>
              ) : null}
            </div>
          </div>
          {focus.alternatives.length > 0 ? (
            <div className="focus-alts">
              <span className="focus-alts-label">Then</span>
              {focus.alternatives.map((alternative) => (
                <button
                  key={alternative.task.id}
                  type="button"
                  className="focus-alt"
                  onClick={() => taskHandlers(alternative.task).onOpen()}
                >
                  {alternative.task.title}
                  <small>{formatDuration(alternative.estimateMinutes)}</small>
                </button>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="dashboard-grid">
        <div className="dashboard-main">
          {reminders.length > 0 ? (
            <section className="card reminder-card">
              <div className="section-head">
                <h2>
                  <Bell size={16} /> Reminders
                </h2>
                <Badge tone="warning">{reminders.length} waiting</Badge>
              </div>
              <p className="fine-print">
                In-app only while this page is open. Browser notifications can fire in the background if you allow them.
              </p>
              <ul className="reminder-list">
                {reminders.slice(0, 5).map((reminder) => (
                  <li key={reminder.task.id} className={reminder.overdue ? 'overdue' : ''}>
                    <div className="reminder-copy">
                      <span className="reminder-title">{reminder.task.title}</span>
                      <small>
                        {reminder.overdue ? 'Overdue' : 'Due soon'}
                        {reminder.task.dueDate ? ` · ${reminder.task.dueDate}${reminder.task.dueTime ? ` ${reminder.task.dueTime}` : ''}` : ''}
                      </small>
                    </div>
                    <div className="reminder-actions">
                      <Button size="sm" variant="primary" icon={Clock} onClick={() => onStartTask(reminder.task.id)}>
                        Start
                      </Button>
                      <Button size="sm" variant="ghost" icon={Check} onClick={() => onCompleteReminder(reminder.task.id)}>
                        Complete
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => onSnoozeReminder(reminder.task.id)}>
                        Snooze 15m
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => onDismissReminder(reminder.task.id)}>
                        Dismiss
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {notificationsPermission !== 'granted' && notificationsPermission !== 'unsupported' ? (
            <section className="card notification-card">
              <div>
                <h3>Want browser reminders?</h3>
                <p className="muted">
                  Permission is optional. Reminders stay in-app; notifications are best-effort while the browser is open.
                </p>
              </div>
              <Button variant="secondary" icon={Bell} onClick={onRequestNotifications}>
                Enable notifications
              </Button>
            </section>
          ) : null}

          {atRisk.length > 0 ? (
            <section className="card risk-card">
              <div className="section-head">
                <h2>
                  <Target size={16} /> At-risk &amp; likely to slip
                </h2>
                <Badge tone="warning">transparent score</Badge>
              </div>
              <ul className="risk-list">
                {atRisk.map(({ task, risk }) => (
                  <li key={task.id}>
                    <button type="button" className="risk-title" onClick={() => taskHandlers(task).onOpen()}>
                      {task.title}
                    </button>
                    <Badge tone={risk.level === 'high' ? 'danger' : 'warning'}>
                      {risk.score}/100
                    </Badge>
                    <ProgressBar
                      value={risk.score}
                      tone={risk.level === 'high' ? 'danger' : 'warning'}
                      label={`Risk score for ${task.title}`}
                    />
                    <p className="fine-print">
                      {risk.factors
                        .filter((factor) => factor.points > 0)
                        .map((factor) => factor.label)
                        .join(' · ') || 'No risk factors recorded.'}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="card week-strip-card">
            <div className="section-head">
              <h2>
                <CalendarRange size={16} /> Next 7 days
              </h2>
              <Button size="sm" variant="ghost" onClick={() => onOpenPage('schedule')}>
                Open schedule
              </Button>
            </div>
            <div className="week-strip">
              {nextDays.map((day, index) => (
                <button
                  key={day.iso}
                  type="button"
                  className={`week-strip-day ${index === 0 ? 'today' : ''}`.trim()}
                  onClick={() => onOpenPage('schedule')}
                >
                  <span>{formatWeekday(day.iso)}</span>
                  <strong>{formatDayNumber(day.iso)}</strong>
                  <small className={day.overdue > 0 ? 'danger-text' : ''}>
                    {day.due > 0 ? `${day.due} due` : 'clear'}
                  </small>
                </button>
              ))}
            </div>
          </section>

          {graphCard}

          {overdue.length > 0 ? (
            <section className="task-group">
              <div className="section-head">
                <h2>
                  <Flame size={16} /> Overdue
                </h2>
                <Badge tone="danger">{overdue.length}</Badge>
              </div>
              {overdue.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  now={now}
                  elapsedMs={timer.elapsedMsFor(task.id)}
                  isRunning={timer.isRunning(task.id)}
                  isPaused={timer.hasPausedSession(task.id)}
                  handlers={taskHandlers(task)}
                />
              ))}
            </section>
          ) : null}

          {dueToday.length > 0 ? (
            <section className="task-group">
              <div className="section-head">
                <h2>
                  <CalendarClock size={16} /> Due today
                </h2>
                <Badge tone="warning">{dueToday.length}</Badge>
              </div>
              {dueToday.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  now={now}
                  elapsedMs={timer.elapsedMsFor(task.id)}
                  isRunning={timer.isRunning(task.id)}
                  isPaused={timer.hasPausedSession(task.id)}
                  handlers={taskHandlers(task)}
                />
              ))}
            </section>
          ) : null}

          {inProgress.length > 0 ? (
            <section className="task-group">
              <div className="section-head">
                <h2>
                  <Clock size={16} /> In progress
                </h2>
                <Badge tone="info">{inProgress.length}</Badge>
              </div>
              {inProgress.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  now={now}
                  elapsedMs={timer.elapsedMsFor(task.id)}
                  isRunning={timer.isRunning(task.id)}
                  isPaused={timer.hasPausedSession(task.id)}
                  handlers={taskHandlers(task)}
                />
              ))}
            </section>
          ) : null}

          {remaining.length > 0 ? (
            <section className="task-group">
              <div className="section-head">
                <h2>
                  <Inbox size={16} /> Next up
                </h2>
                <Button size="sm" variant="ghost" onClick={() => onOpenPage('inbox')}>
                  View all open tasks
                </Button>
              </div>
              {remaining.slice(0, 6).map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  now={now}
                  elapsedMs={timer.elapsedMsFor(task.id)}
                  isRunning={timer.isRunning(task.id)}
                  isPaused={timer.hasPausedSession(task.id)}
                  handlers={taskHandlers(task)}
                />
              ))}
              {remaining.length > 6 ? (
                <button type="button" className="link-button more-link" onClick={() => onOpenPage('inbox')}>
                  +{remaining.length - 6} more open tasks in Inbox
                </button>
              ) : null}
            </section>
          ) : null}

          {openTasks.length === 0 ? (
            <div className="card">
              <EmptyState
                icon={Check}
                title="Your day is clear"
                message="Nothing overdue, nothing due, nothing waiting. Add something small, or import a screenshot and let the parser do the typing."
                action={
                  <div className="empty-actions">
                    <Button variant="primary" icon={Plus} onClick={onNewTask}>
                      New task
                    </Button>
                    <Button variant="secondary" onClick={() => onOpenPage('import')}>
                      Import screenshot
                    </Button>
                  </div>
                }
              />
            </div>
          ) : null}
        </div>

        <aside className="dashboard-side">
          <section className="card plan-card">
            <div className="section-head">
              <h2>Today's plan</h2>
              <Badge tone="neutral">{plan.blocks.filter((block) => block.taskId).length} blocks</Badge>
            </div>
            <ProgressBar value={percent(planned, capacity)} label="Planned capacity" />
            <p className="fine-print">
              {formatDuration(planned)} planned · {formatDuration(freeMinutes)} free · {plan.queued.length} queued
            </p>
            <ul className="mini-timeline">
              {plan.blocks.slice(0, 8).map((block) => {
                const live = workingToday && nowMinutes >= block.start && nowMinutes < block.end;
                return (
                  <li key={block.id} className={`mini-block ${block.kind} ${live ? 'is-now' : ''}`.trim()}>
                    <span>
                      {String(Math.floor(block.start / 60)).padStart(2, '0')}:{String(block.start % 60).padStart(2, '0')}
                    </span>
                    <p>{block.title}</p>
                    {live ? <em className="mini-now">now</em> : null}
                  </li>
                );
              })}
            </ul>
            <div className="plan-foot">
              {workingToday ? (
                <p className={`plan-left ${workdayOver ? 'is-done' : ''}`}>
                  {workdayOver ? (
                    <>
                      <MoonStar size={12} aria-hidden="true" /> Workday finished · {formatDuration(Math.max(0, capacity - planned))} unplanned
                    </>
                  ) : (
                    <>
                      <Clock size={12} aria-hidden="true" /> {formatDuration(minutesLeft)} left
                    </>
                  )}
                </p>
              ) : (
                <span />
              )}
              <Button size="sm" variant="secondary" onClick={() => onOpenPage('schedule')}>
                Open schedule
              </Button>
            </div>
          </section>

          <details className="card honesty-card">
            <summary>
              <span>Honest limits</span>
              <small>4 notes</small>
            </summary>
            <ul className="limit-list">
              <li>IndexedDB is per-browser. Export a backup regularly.</li>
              <li>A closed tab cannot guarantee reminders.</li>
              <li>OCR is deterministic and always needs your review.</li>
              <li>Cloud sync is not configured.</li>
            </ul>
            <Button size="sm" variant="ghost" onClick={() => addToast('Backup and restore live in Settings → Your data.', 'info')}>
              Where is backup?
            </Button>
          </details>
        </aside>
      </div>
    </div>
  );
}
