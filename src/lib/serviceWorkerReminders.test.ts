import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The background half of reminders.
 *
 * On Android an installed app is woken by `periodicsync` and the worker decides
 * on its own whether to buzz — the page is not running, so nothing in `App.tsx`
 * can help. This loads the real `public/sw.js` in Node and drives that decision
 * function directly, so "keeps reminding" is a property of the shipped worker
 * and not only of the screen the user happens to have open.
 */

interface DueEntry {
  task: { id: string; title: string };
  at: Date;
  slot: number;
  key: string;
  overdue: boolean;
}

interface Internals {
  computeDue: (
    tasks: unknown[],
    settings: Record<string, unknown>,
    now: Date,
    options?: { fired?: Set<string>; reminders?: unknown[] },
  ) => DueEntry[];
}

const source = readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8');

function loadWorker(): Internals {
  const self = {
    addEventListener: () => undefined,
    location: { origin: 'https://planner.test' },
    clients: { claim: () => Promise.resolve(), matchAll: async () => [] },
    registration: { showNotification: async () => undefined },
  };
  /* The worker only touches caches, clients and IndexedDB inside event
     handlers, which are registered but never invoked here. */
  const factory = new Function(
    'self',
    'caches',
    'clients',
    'Notification',
    'indexedDB',
    `${source}\nreturn self.__workdayInternals;`,
  ) as (...args: unknown[]) => Internals;
  return factory(self, undefined, self.clients, undefined, undefined);
}

const worker = loadWorker();
const settings = {
  notificationsEnabled: true,
  reminderLeadMinutes: 60,
  reminderRepeatMinutes: 30,
  quietHoursEnabled: false,
};

const task = (id: string, dueDate: string, dueTime = '15:00', extra: Record<string, unknown> = {}) => ({
  id,
  title: `Task ${id}`,
  status: 'todo',
  deletedAt: null,
  dueDate,
  dueTime,
  client: 'Oraglife',
  ...extra,
});

const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute, 0, 0);

describe('the installed app keeps reminding with the page closed', () => {
  it('says nothing before the lead window', () => {
    expect(worker.computeDue([task('a', '2026-10-21', '15:00')], settings, at(21, 13))).toHaveLength(0);
  });

  it('fires at the lead time and then again at every interval', () => {
    const first = worker.computeDue([task('a', '2026-10-21', '15:00')], settings, at(21, 14));
    expect(first).toHaveLength(1);
    expect(first[0].slot).toBe(0);

    /* The bug this covers: the worker used to skip anything already fired and
       go quiet until the deadline moved. Waiting 30 minutes now produces a new
       alert with a new key, not the same one suppressed. */
    const second = worker.computeDue([task('a', '2026-10-21', '15:00')], settings, at(21, 14, 30));
    expect(second).toHaveLength(1);
    expect(second[0].slot).toBe(1);
    expect(second[0].key).not.toBe(first[0].key);
  });

  it('does not re-show the same nudge twice', () => {
    const [entry] = worker.computeDue([task('a', '2026-10-21', '15:00')], settings, at(21, 14, 30));
    const again = worker.computeDue([task('a', '2026-10-21', '15:00')], settings, at(21, 14, 45), {
      fired: new Set([entry.key]),
    });
    expect(again).toHaveLength(0);
  });

  it('stays quiet once the task is dismissed in the app', () => {
    const reminders = [
      { taskId: 'a', dueAt: at(21, 15).toISOString(), status: 'dismissed', snoozedUntil: null },
    ];
    expect(worker.computeDue([task('a', '2026-10-21', '15:00')], settings, at(21, 16), { reminders })).toHaveLength(0);
  });

  it('honours a snooze until it expires', () => {
    const reminders = [
      { taskId: 'a', dueAt: at(21, 15).toISOString(), status: 'queued', snoozedUntil: at(21, 16).toISOString() },
    ];
    const during = worker.computeDue([task('a', '2026-10-21', '15:00')], settings, at(21, 15, 30), { reminders });
    const after = worker.computeDue([task('a', '2026-10-21', '15:00')], settings, at(21, 17), { reminders });
    expect(during).toHaveLength(0);
    expect(after).toHaveLength(1);
  });

  it('does not keep alerting for finished or deleted work', () => {
    const done = task('done', '2026-10-21', '15:00', { status: 'completed' });
    const gone = task('gone', '2026-10-21', '15:00', { deletedAt: '2026-10-21T09:00:00.000Z' });
    expect(worker.computeDue([done, gone], settings, at(21, 16))).toHaveLength(0);
  });
});

describe('the worker reads the same tables the app writes', () => {
  it('looks dismissals up in the reminderRecords table', () => {
    /* Dexie calls the table `reminderRecords`; reading a table that does not
       exist returns an empty list, so a renamed store would silently switch
       dismissal off instead of failing loudly. */
    expect(source).toContain("readAll(db, 'reminderRecords')");
    expect(source).toContain("readAll(db, 'tasks')");
    expect(source).toContain("readOne(db, 'settings', 'app')");
  });
});
