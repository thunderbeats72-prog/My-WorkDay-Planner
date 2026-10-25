import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import App from '../App';
import { db } from '../lib/db';
import { BUILT_IN_CATEGORIES, DEFAULT_SETTINGS, categoryLabel } from '../lib/types';
import type { Task } from '../lib/types';
import { TaskForm } from './TaskForm';

/**
 * The category field in the New task sheet.
 *
 * It used to be a `<select>` whose last option was “＋ New category…” — so the
 * one way to add your own sat at the bottom of a native dropdown, invisible
 * until it was opened, and was reported twice as “there is no option”. Every
 * category is on screen as a chip now, and the last chip is always the way to
 * name a new one.
 */

beforeEach(async () => {
  if (!db.isOpen()) await db.open();
  window.location.hash = '#/tasks';
  await db.settings.clear();
  await db.tasks.clear();
  window.localStorage.clear();
  await db.settings.put({ ...DEFAULT_SETTINGS, id: 'app', name: 'A', onboardingComplete: true });
});

async function openSheet() {
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole('button', { name: 'Add task' }, { timeout: 20000 }));
  return { user, sheet: await screen.findByRole('dialog', { name: 'New task' }) };
}

describe('filing a task under a category', () => {
  it('shows every category without opening anything', async () => {
    const { sheet } = await openSheet();
    const group = within(sheet).getByRole('radiogroup', { name: 'Category' });

    for (const category of BUILT_IN_CATEGORIES) {
      expect(within(group).getByRole('radio', { name: categoryLabel(category) })).toBeTruthy();
    }
    // And the way to add one is a chip, not a hidden option.
    expect(within(group).getByRole('button', { name: 'New category' })).toBeTruthy();
  }, 40000);

  it('marks the chosen chip and saves the task under it', async () => {
    const { user, sheet } = await openSheet();
    await user.type(within(sheet).getByLabelText('Task'), 'Renew the Apollo licence');
    await user.click(within(sheet).getByRole('radio', { name: 'Proposal' }));
    expect(within(sheet).getByRole('radio', { name: 'Proposal' }).getAttribute('aria-checked')).toBe('true');
    expect(within(sheet).getByRole('radio', { name: 'Other' }).getAttribute('aria-checked')).toBe('false');

    await user.click(within(sheet).getByRole('button', { name: 'Create task' }));
    await waitFor(async () => {
      const [saved] = await db.tasks.toArray();
      expect(saved.category).toBe('proposal');
    });
  }, 40000);

  it('adds a category from the chip and selects it', async () => {
    const { user, sheet } = await openSheet();
    await user.type(within(sheet).getByLabelText('Task'), 'Visit the Raipur plant');

    await user.click(within(sheet).getByRole('button', { name: 'New category' }));
    const field = within(sheet).getByLabelText('New category name');
    await user.type(field, 'Field work{Enter}');

    expect(await within(sheet).findByRole('radio', { name: 'Field work' })).toBeTruthy();
    await waitFor(() =>
      expect(within(sheet).getByRole('radio', { name: 'Field work' }).getAttribute('aria-checked')).toBe('true'),
    );

    await user.click(within(sheet).getByRole('button', { name: 'Create task' }));
    await waitFor(async () => {
      const [saved] = await db.tasks.toArray();
      expect(saved.category).toBe('Field work');
    });
    const settings = await db.settings.get('app');
    expect(settings?.customCategories).toContain('Field work');
  }, 40000);

  it('cancelling the input leaves the chosen category alone', async () => {
    const { user, sheet } = await openSheet();
    await user.click(within(sheet).getByRole('button', { name: 'New category' }));
    await user.type(within(sheet).getByLabelText('New category name'), 'Half typed');
    /* The sheet's own Cancel closes it; the field's cancel abandons the name.
       Take the one next to the input. */
    const fieldRow = within(sheet).getByLabelText('New category name').closest('.category-add') as HTMLElement;
    await user.click(within(fieldRow).getByRole('button', { name: 'Cancel' }));

    expect(within(sheet).queryByLabelText('New category name')).toBeNull();
    // Back to chips, still on the default, with nothing written to settings.
    expect(within(sheet).getByRole('radio', { name: 'Other' }).getAttribute('aria-checked')).toBe('true');
    const settings = await db.settings.get('app');
    expect(settings?.customCategories ?? []).toHaveLength(0);
  }, 40000);

  it('keeps a chip for a category the settings no longer list', () => {
    /* A task saved before its category was deleted still carries the name.
       Opening it must show that name as the chosen chip, not quietly re-file
       the task under “Other”. */
    const at = new Date().toISOString();
    const legacy: Task = {
      id: 'legacy',
      title: 'Old task',
      notes: '',
      client: '',
      category: 'Licensing',
      priority: 'medium',
      estimatedMinutes: 30,
      actualMinutes: 0,
      dueDate: null,
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
    };

    render(
      <TaskForm
        open
        task={legacy}
        settings={{ ...DEFAULT_SETTINGS }}
        tasks={[legacy]}
        onClose={() => undefined}
        onSubmit={() => undefined}
      />,
    );

    const chip = screen.getByRole('radio', { name: 'Licensing' });
    expect(chip.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Other' }).getAttribute('aria-checked')).toBe('false');
  });
});
