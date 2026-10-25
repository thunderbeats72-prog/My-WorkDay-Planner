import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import App from '../App';
import { db } from '../lib/db';
import { DEFAULT_SETTINGS } from '../lib/types';
import type { Settings, Task } from '../lib/types';

/**
 * The two promises this file exists for:
 *
 *   · A task that is still open keeps reminding — not once at its deadline and
 *     then silence — and work with no deadline at all still gets a daily
 *     summary instead of being quietly forgotten.
 *   · A category the user names is a real category: it is saved, it is offered
 *     again next time, and the task carries it.
 *
 * Everything runs through the real App, the real IndexedDB and the real
 * settings page paths. Only the clock is controlled, by choosing deadlines
 * relative to the moment the test runs.
 */

const iso = (date: Date) => {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
};
const TODAY_ISO = iso(new Date());

function task(overrides: Partial<Task> & { id: string; title: string }): Task {
  const at = `${TODAY_ISO}T08:00:00.000Z`;
  return {
    notes: '',
    client: '',
    category: 'follow_up',
    priority: 'medium',
    estimatedMinutes: 30,
    actualMinutes: 0,
    dueDate: TODAY_ISO,
    dueTime: '',
    scheduledFor: null,
    suggestedDate: null,
    suggestedStart: null,
    status: 'todo',
    blocked: false,
    dependencyIds: [],
    deferrals: 0,
    createdAt: at,
    updatedAt: at,
    completedAt: null,
    deletedAt: null,
    source: 'manual',
    graphRef: null,
    ...overrides,
  };
}

async function seed(tasks: Task[], overrides: Partial<Settings> = {}) {
  if (!db.isOpen()) await db.open();
  await db.tasks.clear();
  await db.settings.clear();
  await db.reports.clear();
  await db.taskEvents.clear();
  await db.reminderRecords.clear();
  window.localStorage.clear();
  await db.tasks.bulkPut(tasks);
  await db.settings.put({
    ...DEFAULT_SETTINGS,
    id: 'app',
    name: 'Aarav',
    onboardingComplete: true,
    /* Quiet hours off: the tests are about whether an alert is produced, not
       about what time of day the suite happens to run. */
    quietHoursEnabled: false,
    ...overrides,
  });
}

async function openApp() {
  window.location.hash = '#/today';
  render(<App />);
  await waitFor(() => expect(document.querySelector('.sidebar')).toBeTruthy(), { timeout: 20000 });
  await waitFor(() => expect(document.querySelector('.page')).toBeTruthy(), { timeout: 20000 });
}

async function openBell() {
  const bell = await waitFor(() => {
    const found = screen.getAllByRole('button', { name: /^Notifications/ });
    expect(found.length).toBeGreaterThan(0);
    return found[0];
  });
  await waitFor(() => expect(bell.getAttribute('aria-label')).toMatch(/unread/), { timeout: 10000 });
  return bell;
}

beforeEach(async () => {
  if (!db.isOpen()) await db.open();
  await db.taskEvents.clear();
});

describe('reminders keep coming', () => {
  it('reminds about a task that is already overdue, not only at its deadline', async () => {
    /* A deadline in the past: the first alert is long gone, so what is being
       tested is the repeat — the "still open" nudge that did not exist. */
    const due = new Date(Date.now() - 3 * 60 * 60 * 1000);
    await seed(
      [
        task({
          id: 'overdue',
          title: 'Follow up with Oraglife',
          dueDate: iso(due),
          dueTime: `${String(due.getHours()).padStart(2, '0')}:${String(due.getMinutes()).padStart(2, '0')}`,
        }),
      ],
      { reminderLeadMinutes: 60, reminderRepeatMinutes: 30 },
    );
    await openApp();

    const bell = await openBell();
    const user = userEvent.setup();
    await user.click(bell);
    const panel = await screen.findByRole('dialog', { name: 'Notifications' });
    expect(within(panel).getByText('Follow up with Oraglife')).toBeTruthy();
  }, 30000);

  it('sends one pending summary a day, and includes work with no deadline', async () => {
    await seed(
      [
        task({ id: 'dated', title: 'Chase the invoice' }),
        task({ id: 'undated', title: 'Think about the pitch deck', dueDate: null }),
      ],
      /* 00:00 makes the summary due at any hour the suite runs. */
      { dailyDigestEnabled: true, digestTime: '00:00' },
    );
    await openApp();

    const bell = await openBell();
    const user = userEvent.setup();
    await user.click(bell);
    const panel = await screen.findByRole('dialog', { name: 'Notifications' });
    expect(within(panel).getByText(/Today’s pending work/)).toBeTruthy();
    // Two open tasks, one of them with no date at all.
    expect(within(panel).getByText(/2 tasks still open/)).toBeTruthy();
    expect(within(panel).getByText(/1 with no date/)).toBeTruthy();
  }, 30000);

  it('delivers the summary only once for the day', async () => {
    await seed([task({ id: 'dated', title: 'Chase the invoice' })], { digestTime: '00:00' });
    await openApp();
    await openBell();

    const stored = JSON.parse(window.localStorage.getItem('workday.notifications.v1') ?? '[]') as Array<{
      id: string;
    }>;
    const digests = stored.filter((item) => item.id.startsWith('digest_'));
    expect(digests).toHaveLength(1);
  }, 30000);
});

describe('a category the user names', () => {
  it('can be created from the task form and is offered again afterwards', async () => {
    await seed([]);
    const user = userEvent.setup();
    await openApp();

    /* Start from the sidebar so the sheet is the app's own, not a fixture. */
    await user.click(screen.getByRole('button', { name: 'Add task' }));
    const sheet = await screen.findByRole('dialog', { name: /New task/ });

    await user.type(within(sheet).getByLabelText('Task'), 'Renew the Apollo licence');
    /* The way to add one is a chip in the category field itself, visible
       without opening anything. */
    await user.click(within(sheet).getByRole('button', { name: 'New category' }));

    const nameField = await within(sheet).findByLabelText('New category name');
    await user.type(nameField, 'Licensing');
    await user.click(within(sheet).getByRole('button', { name: 'Add' }));

    /* The field is back to chips, with the new one already chosen. */
    await waitFor(() =>
      expect(within(sheet).getByRole('radio', { name: 'Licensing' }).getAttribute('aria-checked')).toBe('true'),
    );

    await user.click(within(sheet).getByRole('button', { name: 'Create task' }));

    await waitFor(async () => {
      const saved = await db.tasks.toArray();
      expect(saved).toHaveLength(1);
      expect(saved[0].category).toBe('Licensing');
    });

    const settings = await db.settings.get('app');
    expect(settings?.customCategories).toContain('Licensing');

    /* Open the form again: the category is on the list without retyping it. */
    await user.click(screen.getByRole('button', { name: 'Add task' }));
    const again = await screen.findByRole('dialog', { name: /New task/ });
    expect(within(again).getByRole('radio', { name: 'Licensing' })).toBeTruthy();
  }, 40000);

  it('shows a task filed under a custom category with a readable chip', async () => {
    await seed([task({ id: 'c1', title: 'Renew the Apollo licence', category: 'Licensing' })], {
      customCategories: ['Licensing'],
    });
    await openApp();

    /* The badge in the card, the one place a missing CATEGORIES entry used to
       render as nothing at all. */
    expect(await screen.findAllByText('Licensing')).not.toHaveLength(0);
  }, 30000);

  it('refuses a duplicate of a built-in category instead of creating a second one', async () => {
    await seed([]);
    const user = userEvent.setup();
    await openApp();

    await user.click(screen.getByRole('button', { name: 'Add task' }));
    const sheet = await screen.findByRole('dialog', { name: /New task/ });
    await user.click(within(sheet).getByRole('button', { name: 'New category' }));
    await user.type(await within(sheet).findByLabelText('New category name'), 'Follow-up');
    await user.click(within(sheet).getByRole('button', { name: 'Add' }));

    expect(await within(sheet).findByText(/already exists/)).toBeTruthy();
    const settings = await db.settings.get('app');
    expect(settings?.customCategories ?? []).toHaveLength(0);
  }, 30000);
});

describe('a task created in a hurry', () => {
  it('still gets a deadline, so it can be reminded about at all', async () => {
    await seed([]);
    const user = userEvent.setup();
    await openApp();

    await user.click(screen.getByRole('button', { name: 'Add task' }));
    const sheet = await screen.findByRole('dialog', { name: /New task/ });
    /* Only the title is typed — the date the form offers is not touched. */
    await user.type(within(sheet).getByLabelText('Task'), 'Call the Kaashi Spine front desk');
    const dueDate = within(sheet).getByLabelText('Due date') as HTMLInputElement;
    expect(dueDate.value).toBe(TODAY_ISO);

    await user.click(within(sheet).getByRole('button', { name: 'Create task' }));
    await waitFor(async () => {
      const [saved] = await db.tasks.toArray();
      expect(saved.dueDate).toBe(TODAY_ISO);
    });
  }, 30000);
});
