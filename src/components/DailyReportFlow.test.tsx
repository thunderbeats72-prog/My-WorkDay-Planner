import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { db } from '../lib/db';
import { DEFAULT_SETTINGS } from '../lib/types';
import type { Task } from '../lib/types';

/**
 * The workflow as a person does it, end to end:
 *
 *   complete a task with a note → complete one without → write a note on a
 *   pending task → open the daily update → see all three, struck through or
 *   not, in the right places → copy it.
 *
 * Everything here goes through the real App, the real IndexedDB (fake-indexeddb)
 * and the real report generator. Only the clipboard is stubbed, because jsdom
 * has none.
 */

const TODAY = new Date();
const iso = (date: Date) => {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
};
const TODAY_ISO = iso(TODAY);
const yesterday = new Date(TODAY);
yesterday.setDate(yesterday.getDate() - 1);
const YESTERDAY_ISO = iso(yesterday);

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

async function seed(tasks: Task[]) {
  if (!db.isOpen()) await db.open();
  await db.tasks.clear();
  await db.settings.clear();
  await db.reports.clear();
  await db.taskEvents.clear();
  window.localStorage.clear();
  await db.tasks.bulkPut(tasks);
  await db.settings.put({ ...DEFAULT_SETTINGS, id: 'app', name: 'Aarav', onboardingComplete: true });
}

async function openApp(hash = '#/today') {
  window.location.hash = hash;
  render(<App />);
  /* Onboarding is complete in these fixtures, so the shell appears once
     IndexedDB has answered. The sidebar is an <aside> with a label, not a
     `navigation` landmark, so it is found by its class. */
  await waitFor(() => expect(document.querySelector('.sidebar')).toBeTruthy(), { timeout: 20000 });
  await waitFor(() => expect(document.querySelector('.page')).toBeTruthy(), { timeout: 20000 });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('completion notes', () => {
  it('asks for an optional note, and saves it on the task', async () => {
    await seed([task({ id: 't1', title: 'Follow up with Narayani Group' })]);
    const user = userEvent.setup();
    await openApp();

    await user.click(await screen.findByRole('button', { name: /^Complete “Follow up with Narayani Group”/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Complete task' });
    expect(within(dialog).getByText('Follow up with Narayani Group')).toBeTruthy();

    await user.type(
      within(dialog).getByLabelText(/Completion Note/),
      'Meeting could not be aligned today. Follow up tomorrow.',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Complete Task' }));

    await waitFor(async () => {
      const saved = await db.tasks.get('t1');
      expect(saved?.status).toBe('completed');
      expect(saved?.completionNote).toBe('Meeting could not be aligned today. Follow up tomorrow.');
    });
  }, 30000);

  it('completes without a note in one tap', async () => {
    await seed([task({ id: 't1', title: 'Update CRM' })]);
    const user = userEvent.setup();
    await openApp();

    await user.click(await screen.findByRole('button', { name: /^Complete “Update CRM”/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Complete task' });
    await user.click(within(dialog).getByRole('button', { name: 'Complete Without Note' }));

    await waitFor(async () => {
      const saved = await db.tasks.get('t1');
      expect(saved?.status).toBe('completed');
      expect(saved?.completionNote ?? '').toBe('');
    });
  }, 30000);

  it('leaves the task untouched when the dialog is cancelled', async () => {
    await seed([task({ id: 't1', title: 'Update CRM' })]);
    const user = userEvent.setup();
    await openApp();

    await user.click(await screen.findByRole('button', { name: /^Complete “Update CRM”/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Complete task' });
    await user.type(within(dialog).getByLabelText(/Completion Note/), 'typed then abandoned');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(async () => {
      const saved = await db.tasks.get('t1');
      expect(saved?.status).toBe('todo');
      expect(saved?.completionNote ?? '').toBe('');
    });
  }, 30000);

  it('does not complete a task twice when the action is tapped repeatedly', async () => {
    await seed([task({ id: 't1', title: 'Update CRM' })]);
    const user = userEvent.setup();
    await openApp();

    const completeButton = await screen.findByRole('button', { name: /^Complete “Update CRM”/ });
    await user.click(completeButton);
    const dialog = await screen.findByRole('dialog', { name: 'Complete task' });
    const confirm = within(dialog).getByRole('button', { name: 'Complete Task' });
    await user.click(confirm);
    await user.click(confirm).catch(() => undefined);

    await waitFor(async () => {
      const saved = await db.tasks.get('t1');
      expect(saved?.status).toBe('completed');
    });
    const events = await db.taskEvents.where('taskId').equals('t1').toArray();
    expect(events.filter((event) => event.detail.startsWith('Task completed'))).toHaveLength(1);
  }, 30000);
}, 30000);

  it('keeps an unsaved task note when the completion note is saved', async () => {
    await seed([
      task({
        id: 't1',
        title: 'Task one',
        status: 'completed',
        completedAt: `${TODAY_ISO}T10:00:00.000Z`,
      }),
    ]);
    const user = userEvent.setup();
    await openApp('#/completed');

    const [open] = await screen.findAllByRole('button', { name: 'Task one' });
    await user.click(open);
    const panel = await screen.findByRole('dialog', { name: /Task details/ });

    const note = within(panel).getByLabelText(/^Task note/) as HTMLTextAreaElement;
    await user.type(note, 'Typed but not saved yet.');

    const completion = within(panel).getByLabelText(/^Completion note/) as HTMLTextAreaElement;
    await user.type(completion, 'Spoke to the client.');
    await user.click(within(panel).getByRole('button', { name: 'Save completion note' }));

    /* Saving one field must not reset the other field's draft. */
    expect(note.value).toBe('Typed but not saved yet.');
  }, 30000);

describe('the daily update', () => {
  it('puts every note in the report, struck through only where completed', async () => {
    await seed([
      task({
        id: 'done-note',
        title: 'Follow up with Mystery Bakers to align a demo',
        status: 'completed',
        completedAt: new Date(`${TODAY_ISO}T10:00:00`).toISOString(),
        completionNote: 'Demo meeting scheduled for next week.',
        createdAt: `${TODAY_ISO}T08:00:00.000Z`,
      }),
      task({
        id: 'pending-note',
        title: 'Align a meeting with Narayani Group',
        notes: "Couldn't connect today. Follow up tomorrow.",
        notesUpdatedAt: `${TODAY_ISO}T11:00:00.000Z`,
        createdAt: `${TODAY_ISO}T08:30:00.000Z`,
      }),
      task({
        id: 'plain',
        title: 'Check on Zoho CRM leads',
        createdAt: `${TODAY_ISO}T09:00:00.000Z`,
      }),
    ]);

    await openApp('#/daily');

    const preview = (await screen.findByLabelText('Report text')) as HTMLTextAreaElement;
    await waitFor(() => expect(preview.value).toContain('Follow up with Mystery Bakers'));

    const lines = preview.value.split('\n');
    expect(lines).toContain('~Follow up with Mystery Bakers to align a demo~ - Demo meeting scheduled for next week.');
    expect(lines).toContain("Align a meeting with Narayani Group - Couldn't connect today. Follow up tomorrow.");
    expect(lines).toContain('Check on Zoho CRM leads');
    expect(preview.value).not.toContain('~Check on Zoho CRM leads~');

    /* Every task in the day list too, with its state spelled out. */
    expect(screen.getAllByText('Completed').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Pending').length).toBeGreaterThan(0);
  }, 30000);

  it('updates when a note is edited in the day list', async () => {
    await seed([task({ id: 't1', title: 'Align a meeting with Narayani Group' })]);
    const user = userEvent.setup();
    await openApp('#/daily');

    const preview = (await screen.findByLabelText('Report text')) as HTMLTextAreaElement;
    await waitFor(() => expect(preview.value).toContain('Align a meeting with Narayani Group'));

    await user.click(screen.getByRole('button', { name: 'Add note' }));
    const noteField = screen.getByLabelText('Note for Align a meeting with Narayani Group');
    await user.type(noteField, 'Did not connect. Follow up tomorrow.');
    await user.click(screen.getByRole('button', { name: 'Save note' }));

    await waitFor(() => expect(preview.value).toContain('Did not connect. Follow up tomorrow.'));

    /* The note was written to the task, not to the report. */
    await waitFor(async () => {
      const saved = await db.tasks.get('t1');
      expect(saved?.notes).toBe('Did not connect. Follow up tomorrow.');
      expect(saved?.status).toBe('todo');
      expect(saved?.notesUpdatedAt).toBeTruthy();
    });
  }, 30000);

  it('keeps another day’s tasks out of the report', async () => {
    await seed([
      task({ id: 'today', title: 'Today task', createdAt: `${TODAY_ISO}T08:00:00.000Z` }),
      task({
        id: 'old',
        title: 'Yesterday task',
        createdAt: `${YESTERDAY_ISO}T08:00:00.000Z`,
        dueDate: YESTERDAY_ISO,
      }),
    ]);
    await openApp('#/daily');

    const preview = (await screen.findByLabelText('Report text')) as HTMLTextAreaElement;
    await waitFor(() => expect(preview.value).toContain('Today task'));
    expect(preview.value).not.toContain('Yesterday task');
  }, 30000);

  it('protects a hand-edited preview from being overwritten', async () => {
    await seed([task({ id: 't1', title: 'Task one' })]);
    const user = userEvent.setup();
    await openApp('#/daily');

    const preview = (await screen.findByLabelText('Report text')) as HTMLTextAreaElement;
    await waitFor(() => expect(preview.value).toContain('Task one'));

    await user.clear(preview);
    await user.type(preview, 'My own wording for the group.');
    expect(screen.getByText(/edited by you/i)).toBeTruthy();

    /* Regenerating is explicit, and confirmed. */
    await user.click(screen.getByRole('button', { name: 'Regenerate' }));
    const confirm = await screen.findByRole('dialog', { name: /Replace your edits/ });
    expect(within(confirm).getByText(/handwritten changes/)).toBeTruthy();
    await user.click(within(confirm).getByRole('button', { name: 'Regenerate' }));
    await waitFor(() => expect(preview.value).toContain('Task one'));
  }, 30000);

  it('copies the update to the clipboard', async () => {
    await seed([task({ id: 't1', title: 'Task one' })]);
    /* user-event installs its own clipboard stub, so the spy goes on after
       setup — this is the same object the component writes through. */
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText');
    await openApp('#/daily');

    const preview = (await screen.findByLabelText('Report text')) as HTMLTextAreaElement;
    await waitFor(() => expect(preview.value).toContain('Task one'));

    await user.click(screen.getByRole('button', { name: 'Copy update' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0][0]).toContain('Task one');
  }, 30000);

  it('copies rich text too, so Teams pastes a real strikethrough', async () => {
    await seed([
      task({
        id: 't1',
        title: 'Connect with Abhiyantri Enterprises.',
        status: 'completed',
        completedAt: `${TODAY_ISO}T10:00:00.000Z`,
        completionNote: 'No response',
      }),
      task({ id: 't2', title: 'Follow up with TR Chadha regarding the proposal.', notes: 'No response' }),
    ]);
    const user = userEvent.setup();

    /* A browser with the async clipboard: write() takes a ClipboardItem that
       carries both flavours. jsdom has neither, so both are stubbed. */
    const written: Array<Record<string, Blob>> = [];
    class FakeClipboardItem {
      readonly items: Record<string, Blob>;
      constructor(items: Record<string, Blob>) {
        this.items = items;
        written.push(items);
      }
    }
    vi.stubGlobal('ClipboardItem', FakeClipboardItem);
    const write = vi.fn(async (_items: unknown[]) => undefined);
    Object.defineProperty(navigator.clipboard, 'write', { configurable: true, value: write });

    await openApp('#/daily');
    const preview = (await screen.findByLabelText('Report text')) as HTMLTextAreaElement;
    await waitFor(() => expect(preview.value).toContain('Connect with Abhiyantri Enterprises.'));

    await user.click(screen.getByRole('button', { name: 'Copy update' }));
    await waitFor(() => expect(written).toHaveLength(1));

    const [flavours] = written;
    expect(Object.keys(flavours).sort()).toEqual(['text/html', 'text/plain']);

    // WhatsApp reads this one: tildes, notes after the title.
    const plain = await flavours['text/plain'].text();
    expect(plain).toContain('~Connect with Abhiyantri Enterprises.~ - No response');
    expect(plain).toContain('Follow up with TR Chadha regarding the proposal. - No response');

    // Teams and Outlook read this one: a real strikethrough, no tildes anywhere.
    const html = await flavours['text/html'].text();
    expect(html).toContain('<s>Connect with Abhiyantri Enterprises.</s> - No response');
    expect(html).not.toContain('~');
    // Pending work is left alone in both flavours.
    expect(html).toContain('Follow up with TR Chadha regarding the proposal. - No response');
    expect(html).not.toMatch(/<s>[^<]*TR Chadha/);
  }, 30000);

  it('asks before a day change throws away a hand-edited preview', async () => {
    await seed([task({ id: 't1', title: 'Task one' })]);
    const user = userEvent.setup();
    await openApp('#/daily');

    const preview = (await screen.findByLabelText('Report text')) as HTMLTextAreaElement;
    await waitFor(() => expect(preview.value).toContain('Task one'));

    await user.clear(preview);
    await user.type(preview, 'Half-finished wording.');

    await user.click(screen.getByRole('button', { name: 'Previous day' }));
    const guard = await screen.findByRole('dialog', { name: /Leave this day/ });
    expect(within(guard).getByText(/your own wording/)).toBeTruthy();

    /* Cancel means cancel: the edit and the day both stay. */
    await user.click(within(guard).getByRole('button', { name: 'Cancel' }));
    expect(preview.value).toBe('Half-finished wording.');

    await user.click(screen.getByRole('button', { name: 'Previous day' }));
    const again = await screen.findByRole('dialog', { name: /Leave this day/ });
    await user.click(within(again).getByRole('button', { name: 'Switch day' }));
    await waitFor(() => expect(preview.value).not.toContain('Half-finished wording.'));
  }, 30000);

  it('saves one update per day and never overwrites an earlier day', async () => {
    await seed([
      task({ id: 't1', title: 'Task one' }),
      task({
        id: 'y1',
        title: 'Task from yesterday',
        createdAt: `${YESTERDAY_ISO}T08:00:00.000Z`,
        dueDate: YESTERDAY_ISO,
      }),
    ]);
    const user = userEvent.setup();
    await openApp('#/daily');

    await waitFor(() => expect(screen.getByLabelText('Report text')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'Save this update' }));

    await waitFor(async () => {
      const rows = await db.reports.toArray();
      expect(rows).toHaveLength(1);
      expect(rows[0].dateISO).toBe(TODAY_ISO);
    });

    /* Move to yesterday, save there, and check today's row is untouched. */
    await user.click(screen.getByRole('button', { name: 'Previous day' }));
    await user.click(screen.getByRole('button', { name: 'Save this update' }));
    await waitFor(async () => {
      const rows = await db.reports.toArray();
      expect(rows).toHaveLength(2);
      expect(rows.map((row) => row.dateISO).sort()).toEqual([YESTERDAY_ISO, TODAY_ISO].sort());
    });
  }, 30000);

  it('shows an honest empty state for a day with nothing on it', async () => {
    await seed([task({ id: 'old', title: 'Old task', createdAt: '2020-01-01T08:00:00.000Z', dueDate: '2020-01-01' })]);
    await openApp('#/daily');

    const preview = (await screen.findByLabelText('Report text')) as HTMLTextAreaElement;
    await waitFor(() => expect(preview.value).toContain('No tasks recorded for this day'));
    expect(screen.queryByText('Old task')).toBeNull();
  }, 30000);
});

describe('where the daily update lives', () => {
  it('is a tab inside Reports, not a destination of its own', async () => {
    await seed([task({ id: 't1', title: 'Task one' })]);
    const user = userEvent.setup();
    /* Opened the way the sidebar opens it. */
    await openApp('#/reports');

    const weekly = screen.getByRole('tab', { name: 'Weekly summary' });
    const daily = screen.getByRole('tab', { name: 'Daily update' });
    expect(weekly.getAttribute('aria-selected')).toBe('true');
    expect(daily.getAttribute('aria-selected')).toBe('false');
    // The weekly report itself is still there.
    expect(screen.getByText('Completed by category')).toBeTruthy();
    expect(screen.queryByLabelText('Report text')).toBeNull();

    await user.click(daily);
    expect((await screen.findByLabelText('Report text')) as HTMLTextAreaElement).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Daily update' }).getAttribute('aria-selected')).toBe('true');
    // And it can go back, with the weekly charts rebuilt.
    await user.click(weekly);
    expect(screen.queryByLabelText('Report text')).toBeNull();
    expect(screen.getByText('Completed by category')).toBeTruthy();
  }, 30000);

  it('still honours an old #/daily bookmark', async () => {
    await seed([task({ id: 't1', title: 'Task one' })]);
    await openApp('#/daily');

    expect(await screen.findByLabelText('Report text')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Daily update' }).getAttribute('aria-selected')).toBe('true');
    // The URL is normalised to the page that owns the tab.
    expect(window.location.hash).toBe('#/reports');
  }, 30000);

  it('has no fifth destination in the sidebar or the phone bar', async () => {
    await seed([task({ id: 't1', title: 'Task one' })]);
    await openApp('#/reports');

    const sidebar = document.querySelector('.sidebar') as HTMLElement;
    const labels = Array.from(sidebar.querySelectorAll('.nav-item')).map((item) => item.textContent?.trim() ?? '');
    expect(labels.some((label) => /daily/i.test(label))).toBe(false);

    const nav = screen.getByRole('navigation', { name: 'Mobile navigation' });
    const mobile = Array.from(nav.querySelectorAll('button')).map((button) => button.textContent?.trim());
    expect(mobile).toEqual(['Today', 'My Tasks', 'Completed', 'Reports']);
  }, 30000);
});
