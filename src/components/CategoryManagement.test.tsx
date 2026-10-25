import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import App from '../App';
import { db } from '../lib/db';
import { DEFAULT_SETTINGS } from '../lib/types';
import type { Settings, Task } from '../lib/types';

/**
 * Categories were only ever addable from the task form's picker, and nothing
 * anywhere could rename or delete one. This drives the real Settings page
 * through the real App and IndexedDB: add, rename (the tasks must follow the
 * new name), and delete (the tasks must land somewhere real, not on a word no
 * picker offers any more).
 */

const iso = (date: Date) => {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
};
const TODAY = iso(new Date());

function task(overrides: Partial<Task> & { id: string; title: string }): Task {
  const at = `${TODAY}T08:00:00.000Z`;
  return {
    notes: '',
    client: 'Oraglife',
    category: 'other',
    priority: 'medium',
    estimatedMinutes: 30,
    actualMinutes: 0,
    dueDate: TODAY,
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
    quietHoursEnabled: false,
    ...overrides,
  });
}

async function openSettings() {
  window.location.hash = '#/today';
  render(<App />);
  /* The sidebar and the phone chrome both name it, so take the first. */
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'Settings' }).length).toBeGreaterThan(0), {
    timeout: 20000,
  });
  const user = userEvent.setup();
  await user.click(screen.getAllByRole('button', { name: 'Settings' })[0]);
  await screen.findByRole('heading', { name: 'Settings' }, { timeout: 20000 });
  return user;
}

beforeEach(async () => {
  if (!db.isOpen()) await db.open();
  await db.taskEvents.clear();
});

describe('managing categories from Settings', () => {
  it('adds one that is offered in the task form immediately', async () => {
    await seed([]);
    const user = await openSettings();

    await user.type(screen.getByLabelText('Add a category'), 'Recruitment');
    await user.click(screen.getByRole('button', { name: 'Add category' }));

    await waitFor(async () => {
      const settings = await db.settings.get('app');
      expect(settings?.customCategories).toContain('Recruitment');
    });

    // The row appears with its usage, and the form will offer it.
    expect(await screen.findByRole('button', { name: 'Edit Recruitment' })).toBeTruthy();
    await user.click(screen.getAllByRole('button', { name: 'Today' })[0]);
    await user.click(await screen.findByRole('button', { name: 'Add task' }));
    const sheet = await screen.findByRole('dialog', { name: /New task/ });
    expect(within(sheet).getByRole('radio', { name: 'Recruitment' })).toBeTruthy();
  }, 40000);

  it('renames one and the tasks filed under it follow', async () => {
    await seed([task({ id: 'a', title: 'Renew the Apollo licence', category: 'Licensing' })], {
      customCategories: ['Licensing'],
    });
    const user = await openSettings();

    await user.click(screen.getByRole('button', { name: 'Edit Licensing' }));
    const field = screen.getByLabelText('Rename Licensing');
    await user.clear(field);
    await user.type(field, 'Permits{Enter}');

    await waitFor(async () => {
      const [saved] = await db.tasks.toArray();
      expect(saved.category).toBe('Permits');
    });
    const settings = await db.settings.get('app');
    expect(settings?.customCategories).toEqual(['Permits']);
    // The row now offers the new name, and no longer the old one.
    expect(await screen.findByRole('button', { name: 'Edit Permits' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit Licensing' })).toBeNull();
  }, 40000);

  it('deletes one and moves its tasks to Other', async () => {
    await seed(
      [
        task({ id: 'a', title: 'Renew the Apollo licence', category: 'Licensing' }),
        task({ id: 'b', title: 'Send the CRM update', category: 'Licensing' }),
      ],
      { customCategories: ['Licensing'] },
    );
    const user = await openSettings();

    await user.click(screen.getByRole('button', { name: 'Delete Licensing' }));
    const dialog = await screen.findByRole('dialog', { name: /Delete “Licensing”/ });
    expect(dialog.textContent).toContain('2 tasks use it');
    expect(dialog.textContent).toContain('Other');
    await user.click(within(dialog).getByRole('button', { name: 'Delete category' }));

    await waitFor(async () => {
      const saved = await db.tasks.toArray();
      expect(saved.map((item) => item.category)).toEqual(['other', 'other']);
    });
    const settings = await db.settings.get('app');
    expect(settings?.customCategories ?? []).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Delete Licensing' })).toBeNull();
  }, 40000);

  it('refuses a name that already exists and changes nothing', async () => {
    await seed([], { customCategories: ['Licensing'] });
    const user = await openSettings();

    await user.type(screen.getByLabelText('Add a category'), 'licensing');
    await user.click(screen.getByRole('button', { name: 'Add category' }));

    expect(await screen.findByText('That category already exists.')).toBeTruthy();
    const settings = await db.settings.get('app');
    expect(settings?.customCategories).toEqual(['Licensing']);
  }, 40000);
});
