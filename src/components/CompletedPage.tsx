import { useMemo, useState } from 'react';
import { CircleCheck, Search } from 'lucide-react';
import { formatDateLong, todayISO } from '../lib/dates';
import type { CommonPageProps } from './pageProps';
import { TaskCard } from './TaskCard';
import { EmptyState } from './ui';
import { PageHeader } from './Shell';
import { StickerChip } from './StickerStamp';
import { STICKERS, loadShelf, streakFrom } from '../lib/stickers';

export function CompletedPage({ tasks, now, timer, taskHandlers }: CommonPageProps) {
  const [query, setQuery] = useState('');
  const today = todayISO(now);
  const completed = tasks.filter((task) => task.status === 'completed' && task.deletedAt === null);

  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase();
    return completed
      .filter((task) => (search ? `${task.title} ${task.client}`.toLowerCase().includes(search) : true))
      .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
  }, [completed, query]);

  const todayCount = completed.filter((task) => task.completedAt?.slice(0, 10) === today).length;
  const shelf = loadShelf();
  const streak = streakFrom(shelf, today);
  // Newest first, but a shelf should show variety before repetition.
  const shelfCounts = shelf.reduce<Map<string, number>>((counts, entry) => {
    counts.set(entry.id, (counts.get(entry.id) ?? 0) + 1);
    return counts;
  }, new Map());
  const groups = new Map<string, typeof filtered>();
  for (const task of filtered) {
    const key = task.completedAt ? task.completedAt.slice(0, 10) : 'unknown';
    const bucket = groups.get(key) ?? [];
    bucket.push(task);
    groups.set(key, bucket);
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="Undo is always one tap away"
        title="Completed"
        description={`${completed.length} completed in total · ${todayCount} today.`}
        actions={
          <div className="search-field compact">
            <Search size={15} aria-hidden="true" />
            <input
              className="input"
              placeholder="Search completed"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search completed tasks"
            />
          </div>
        }
      />

      {shelf.length > 0 ? (
        <section className="card sticker-shelf" aria-label="Stickers earned">
          <div className="section-head">
            <div>
              <h2>Stickers</h2>
              <p className="section-sub">
                {shelf.length} earned{streak > 1 ? ` · ${streak}-day streak` : ''}. They are kept on this device.
              </p>
            </div>
          </div>
          <div className="sticker-row">
            {[...shelfCounts.entries()].map(([id, count]) => {
              const sticker = STICKERS[id];
              if (!sticker) return null;
              return (
                <span key={id} className="sticker-slot">
                  <StickerChip sticker={sticker} title={`${sticker.name} — earned ${count} ${count === 1 ? 'time' : 'times'}`} />
                  {count > 1 ? <small>{count}</small> : null}
                </span>
              );
            })}
          </div>
        </section>
      ) : null}

      {filtered.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={CircleCheck}
            title={completed.length === 0 ? 'No completed tasks yet' : 'No matches'}
            message={
              completed.length === 0
                ? 'Finished work lands here. You can reopen or delete anything if you change your mind.'
                : 'Try a different search term.'
            }
          />
        </div>
      ) : (
        <div className="completed-groups">
          {[...groups.entries()].map(([date, group]) => (
            <section key={date} className="task-group">
              <div className="section-head">
                <h2>{date === today ? 'Today' : formatDateLong(date)}</h2>
                <span className="muted">{group.length} task{group.length === 1 ? '' : 's'}</span>
              </div>
              {group.map((task) => (
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
          ))}
        </div>
      )}
    </div>
  );
}
