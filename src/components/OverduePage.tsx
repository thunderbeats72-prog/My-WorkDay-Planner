import { Flame, TriangleAlert } from 'lucide-react';
import { dayOffset, formatDuration, todayISO } from '../lib/dates';
import type { CommonPageProps } from './pageProps';
import { TaskCard } from './TaskCard';
import { Badge, EmptyState } from './ui';
import { PageHeader } from './Shell';

export function OverduePage({ tasks, now, timer, taskHandlers, onOpenPage }: CommonPageProps) {
  const today = todayISO(now);
  const overdue = tasks
    .filter(
      (task) => task.deletedAt === null && task.status !== 'completed' && task.dueDate !== null && task.dueDate < today,
    )
    .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
  const totalMinutes = overdue.reduce((sum, task) => sum + task.estimatedMinutes, 0);

  return (
    <div className="page">
      <PageHeader
        eyebrow="Past their real deadline"
        title="Overdue"
        description="Only actual due dates count here — a suggested time passing never marks a task overdue."
        actions={
          <Badge tone={overdue.length > 0 ? 'danger' : 'success'}>
            {overdue.length} overdue
          </Badge>
        }
      />

      {overdue.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={Flame}
            title="Nothing is overdue"
            message="Every open task is either due today or in the future. Keep it that way."
            action={
              <button type="button" className="link-button" onClick={() => onOpenPage('today')}>
                Back to Today
              </button>
            }
          />
        </div>
      ) : (
        <>
          <div className="notice-card danger">
            <TriangleAlert size={18} />
            <div>
              <strong>
                {overdue.length} task{overdue.length === 1 ? '' : 's'} need rescuing
              </strong>
              <p>
                Estimated effort to clear: {formatDuration(totalMinutes)}. Reschedule honestly or finish what you can
                today.
              </p>
            </div>
          </div>
          <div className="task-list">
            {overdue.map((task) => (
              <div key={task.id}>
                <p className="overdue-age">
                  {Math.abs(dayOffset(task.dueDate ?? today, now))} day
                  {Math.abs(dayOffset(task.dueDate ?? today, now)) === 1 ? '' : 's'} overdue
                </p>
                <TaskCard
                  task={task}
                  now={now}
                  elapsedMs={timer.elapsedMsFor(task.id)}
                  isRunning={timer.isRunning(task.id)}
                  isPaused={timer.hasPausedSession(task.id)}
                  handlers={taskHandlers(task)}
                />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
