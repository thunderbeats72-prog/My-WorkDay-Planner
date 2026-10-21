import { useMemo, useState } from 'react';
import { Inbox, ListFilter, Plus, Search } from 'lucide-react';
import { todayISO } from '../lib/dates';
import { scoreTask } from '../lib/engine';
import type { CommonPageProps } from './pageProps';
import { TaskCard } from './TaskCard';
import { Badge, Button, EmptyState, Segmented } from './ui';
import { PageHeader } from './Shell';

type Filter = 'all' | 'urgent' | 'today' | 'overdue' | 'proposals';
type Sort = 'smart' | 'deadline' | 'newest';

export function InboxPage({
  tasks,
  settings,
  now,
  timer,
  taskHandlers,
  onNewTask,
}: CommonPageProps) {
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('smart');
  const [query, setQuery] = useState('');
  const today = todayISO(now);
  const openTasks = tasks.filter((task) => task.status !== 'completed' && task.deletedAt === null);

  const filters: Array<{ value: Filter; label: string; count: number }> = [
    { value: 'all', label: 'All', count: openTasks.length },
    {
      value: 'urgent',
      label: 'Critical + High',
      count: openTasks.filter((task) => task.priority === 'critical' || task.priority === 'high').length,
    },
    { value: 'today', label: 'Due today', count: openTasks.filter((task) => task.dueDate === today).length },
    {
      value: 'overdue',
      label: 'Overdue',
      count: openTasks.filter((task) => task.dueDate !== null && task.dueDate < today).length,
    },
    { value: 'proposals', label: 'Proposals', count: openTasks.filter((task) => task.category === 'proposal').length },
  ];

  const visible = useMemo(() => {
    const search = query.trim().toLowerCase();
    let result = openTasks.filter((task) => {
      if (search) {
        const haystack = `${task.title} ${task.client} ${task.notes}`.toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      switch (filter) {
        case 'urgent':
          return task.priority === 'critical' || task.priority === 'high';
        case 'today':
          return task.dueDate === today;
        case 'overdue':
          return task.dueDate !== null && task.dueDate < today;
        case 'proposals':
          return task.category === 'proposal';
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
  }, [openTasks, filter, sort, query, today, settings, now]);

  return (
    <div className="page">
      <PageHeader
        eyebrow="Everything captured"
        title="Inbox"
        description="Every open task in one place. Priority is always written out — never colour alone."
        actions={
          <>
            <Button variant="secondary" icon={Search} onClick={() => document.getElementById('inbox-search')?.focus()}>
              Search
            </Button>
            <Button variant="primary" icon={Plus} onClick={onNewTask}>
              New task
            </Button>
          </>
        }
      />

      <div className="toolbar card">
        <div className="toolbar-row">
          <div className="filter-chips" role="group" aria-label="Filter tasks">
            {filters.map((entry) => (
              <button
                key={entry.value}
                type="button"
                className={`chip-button ${filter === entry.value ? 'active' : ''}`.trim()}
                aria-pressed={filter === entry.value}
                onClick={() => setFilter(entry.value)}
              >
                {entry.label}
                <span>{entry.count}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="toolbar-row split">
          <div className="search-field">
            <Search size={16} aria-hidden="true" />
            <input
              id="inbox-search"
              className="input"
              placeholder="Search title, client or notes"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <Segmented<Sort>
            ariaLabel="Sort tasks"
            value={sort}
            onChange={setSort}
            options={[
              { value: 'smart', label: 'Smart' },
              { value: 'deadline', label: 'Deadline' },
              { value: 'newest', label: 'Newest' },
            ]}
          />
        </div>
      </div>

      <div className="list-head">
        <h2>
          <ListFilter size={15} /> {visible.length} task{visible.length === 1 ? '' : 's'}
        </h2>
        {visible.length !== openTasks.length ? <Badge tone="info">filtered</Badge> : null}
      </div>

      {visible.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={Inbox}
            title={openTasks.length === 0 ? 'Inbox is empty' : 'No tasks match this filter'}
            message={
              openTasks.length === 0
                ? 'Add your first task, or import a screenshot to pull in follow-ups.'
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
          {visible.map((task) => (
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
        </div>
      )}
    </div>
  );
}
