import type { ReactNode } from 'react';
import { useState } from 'react';
import {
  Bell,
  CalendarDays,
  Check,
  CircleCheck,
  Clock,
  Flame,
  Inbox,
  Plus,
  Sparkles,
  Target,
  TriangleAlert,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type { Priority } from '../lib/types';
import { PRIORITIES, PRIORITY_ORDER } from '../lib/types';
import {
  daysFromNow,
  formatDateLong,
  formatDuration,
  formatWeekday,
  isTaskOverdue,
  formatDayNumber,
  greetingForHour,
  percent,
  todayISO,
} from '../lib/dates';
import { buildDayPlan } from '../lib/engine';
import type { ReminderItem } from '../lib/engine';
import { deadlineRisk, learnDurations } from '../lib/ml';
import type { CommonPageProps } from './pageProps';
import { TaskCard } from './TaskCard';
import { Badge, Button, EmptyState, ProgressBar, Ring, StatCard } from './ui';

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
  onCompleteReminder,
}: CommonPageProps & {
  graphCard: ReactNode;
  reminders: ReminderItem[];
  notificationsPermission: string;
  onRequestNotifications: () => void;
  onSnoozeReminder: (taskId: string) => void;
  onDismissReminder: (taskId: string) => void;
  onStartTask: (taskId: string) => void;
  onCompleteReminder: (taskId: string) => void;
}) {
  const [quickTitle, setQuickTitle] = useState('');
  const [quickPriority, setQuickPriority] = useState<Priority>(settings.defaultPriority);
  const today = todayISO(now);
  const openTasks = tasks.filter((task) => task.status !== 'completed' && task.deletedAt === null);
  const learned = learnDurations(tasks, timer.sessions).learned;
  const plan = buildDayPlan(tasks, settings, now, { learned });
  const capacity = plan.capacityMinutes;
  const planned = plan.plannedMinutes;
  const freeMinutes = Math.max(0, capacity - planned);
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
  const firstName = settings.name.split(/\s+/)[0] || 'there';
  const nextDays = Array.from({ length: 7 }, (_, index) => {
    const iso = index === 0 ? today : daysFromNow(index, now);
    const due = openTasks.filter((task) => task.dueDate === iso).length;
    return { iso, due, overdue: index === 0 ? overdue.length : 0 };
  });

  return (
    <div className="page today-page">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">{formatDateLong(today)}</p>
          <h1>
            {greetingForHour(now.getHours())}, {firstName}
          </h1>
          <p className="hero-sub">
            {overdue.length > 0
              ? `${overdue.length} task${overdue.length === 1 ? ' is' : 's are'} past their deadline. Clear those first.`
              : dueToday.length > 0
                ? `${dueToday.length} deadline${dueToday.length === 1 ? '' : 's'} land today. Your schedule has room for ${formatDuration(freeMinutes)}.`
                : `${openTasks.length} open task${openTasks.length === 1 ? '' : 's'} · ${formatDuration(freeMinutes)} still free today.`}
          </p>
          <div className="hero-chips">
            <span className={`chip ${online ? 'chip-online' : 'chip-offline'}`}>
              {online ? <Wifi size={12} /> : <WifiOff size={12} />}
              {online ? 'Online' : 'Offline — local data still works'}
            </span>
            <span className="chip">
              <Bell size={12} />
              {notificationsPermission === 'granted'
                ? 'Browser notifications on'
                : notificationsPermission === 'denied'
                  ? 'Notifications blocked in browser'
                  : 'Notifications not enabled'}
            </span>
            <span className="chip">Local-only · Sync not configured</span>
          </div>
          <div className="hero-stats">
            <div>
              <strong>{overdue.length}</strong>
              <span>Overdue</span>
            </div>
            <div>
              <strong>{dueToday.length}</strong>
              <span>Due today</span>
            </div>
            <div>
              <strong>{completedToday}</strong>
              <span>Done today</span>
            </div>
            <div>
              <strong>{formatDuration(freeMinutes)}</strong>
              <span>Free capacity</span>
            </div>
          </div>
        </div>
        <div className="hero-ring">
          <Ring
            value={percent(planned, capacity)}
            size={168}
            stroke={12}
            label={`${percent(planned, capacity)}%`}
            sublabel="day planned"
          />
          <p>
            {formatDuration(planned)} of {formatDuration(capacity)} committed
          </p>
        </div>
      </section>

      <section className="quick-add card" aria-label="Quick add a task">
        <Plus size={18} aria-hidden="true" />
        <input
          className="quick-add-input"
          placeholder="Quick add for today — type and press Enter"
          value={quickTitle}
          onChange={(event) => setQuickTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && quickTitle.trim()) {
              onQuickAdd(quickTitle.trim(), quickPriority);
              setQuickTitle('');
            }
          }}
        />
        <select
          className="input quick-add-priority"
          aria-label="Priority for quick add"
          value={quickPriority}
          onChange={(event) => setQuickPriority(event.target.value as Priority)}
        >
          {PRIORITY_ORDER.map((priority) => (
            <option key={priority} value={priority}>
              {PRIORITIES[priority].label}
            </option>
          ))}
        </select>
        <Button
          variant="primary"
          disabled={!quickTitle.trim()}
          onClick={() => {
            if (!quickTitle.trim()) return;
            onQuickAdd(quickTitle.trim(), quickPriority);
            setQuickTitle('');
          }}
        >
          Add
        </Button>
      </section>

      <div className="stat-grid">
        <StatCard icon={TriangleAlert} label="Overdue" value={overdue.length} sub="real deadlines only" tone="danger" />
        <StatCard icon={CalendarDays} label="Due today" value={dueToday.length} sub="before end of day" tone="warning" />
        <StatCard icon={CircleCheck} label="Completed today" value={completedToday} sub="tracked work" tone="success" />
        <StatCard icon={Clock} label="Focus planned" value={formatDuration(planned)} sub={`${formatDuration(freeMinutes)} free`} tone="primary" />
      </div>

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
                <CalendarDays size={16} /> Next 7 days
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
                  <CalendarDays size={16} /> Due today
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
                icon={Sparkles}
                title="Your day is clear"
                message="Add a task, or import a screenshot from Teams or Outlook to get started."
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
              {plan.blocks.slice(0, 8).map((block) => (
                <li key={block.id} className={`mini-block ${block.kind}`}>
                  <span>{String(Math.floor(block.start / 60)).padStart(2, '0')}:{String(block.start % 60).padStart(2, '0')}</span>
                  <p>{block.title}</p>
                </li>
              ))}
            </ul>
            <Button size="sm" variant="secondary" onClick={() => onOpenPage('schedule')}>
              Open schedule
            </Button>
          </section>

          <section className="card">
            <h2>Honest limits</h2>
            <ul className="limit-list">
              <li>IndexedDB is per-browser. Export a backup regularly.</li>
              <li>A closed tab cannot guarantee reminders.</li>
              <li>OCR is deterministic and always needs your review.</li>
              <li>Cloud sync is not configured.</li>
            </ul>
            <Button size="sm" variant="ghost" onClick={() => addToast('Backup and restore live in Settings → Your data.', 'info')}>
              Where is backup?
            </Button>
          </section>
        </aside>
      </div>
    </div>
  );
}
