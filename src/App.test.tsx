import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { db } from './lib/db';
import { DEFAULT_SETTINGS } from './lib/types';

async function seedOnboarded(overrides: Partial<typeof DEFAULT_SETTINGS> = {}) {
  // Earlier tests leave the hash on another page; each test should start at Today.
  window.location.hash = '#/today';
  await db.settings.put({
    ...DEFAULT_SETTINGS,
    id: 'app',
    name: 'Aarav Sharma',
    onboardingComplete: true,
    ...overrides,
  });
}

function sidebarButton(label: string): HTMLElement {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) throw new Error('Sidebar not found');
  return within(sidebar as HTMLElement).getByTitle(label);
}

describe('My Workday Planner app', () => {
  beforeEach(async () => {
    if (!db.isOpen()) await db.open();
    await db.transaction(
      'rw',
      db.tasks,
      db.timeSessions,
      db.reminderRecords,
      db.taskEvents,
      db.settings,
      async () => {
        await db.tasks.clear();
        await db.timeSessions.clear();
        await db.reminderRecords.clear();
        await db.taskEvents.clear();
        await db.settings.clear();
      },
    );
    window.sessionStorage.clear();
    window.localStorage.clear();
  });

  it('completes onboarding, creates, times and persists a task, then navigates', async () => {
    const user = userEvent.setup();
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );

    // Step 1 is the (optional) account screen — skip it and keep setting up.
    await user.click(await screen.findByRole('button', { name: 'Continue without an account' }, { timeout: 15000 }));

    const nameInput = await screen.findByLabelText('Your name', {}, { timeout: 15000 });
    await user.type(nameInput, 'Aarav Sharma');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByText('When do you actually work?')).toBeTruthy();
    expect(screen.getByText(/of capacity per working day/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByText('Your defaults')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Start planning' }));

    expect(await screen.findByText(/Good (morning|afternoon|evening), Aarav/)).toBeTruthy();

    const quickAdd = screen.getByPlaceholderText(/Add a task — press Enter/);
    await user.type(quickAdd, 'Follow up with Acme{Enter}');

    const taskTitle = await screen.findByRole('button', { name: 'Follow up with Acme' });
    const card = taskTitle.closest('.task-card');
    expect(card).not.toBeNull();
    const cardScope = within(card as HTMLElement);

    await user.click(cardScope.getByRole('button', { name: 'Start' }));
    await waitFor(() => {
      expect(cardScope.getByText('Running')).toBeTruthy();
    });

    await user.click(cardScope.getByRole('button', { name: 'Pause' }));
    await waitFor(() => {
      expect(cardScope.getByText('Paused')).toBeTruthy();
    });

    await user.click(sidebarButton('My Tasks'));
    expect(await screen.findByRole('heading', { name: 'My Tasks' })).toBeTruthy();
    expect(screen.getAllByText('Follow up with Acme').length).toBeGreaterThan(0);
    // The schedule lives inside My Tasks now.
    expect(screen.getByText(/Today’s plan/i)).toBeTruthy();

    await user.click(sidebarButton('Reports'));
    expect(await screen.findByRole('heading', { name: 'Reports' })).toBeTruthy();

    // Import is an action on My Tasks, not a destination.
    await user.click(sidebarButton('My Tasks'));
    await user.click(await screen.findByRole('button', { name: 'Import screenshot' }));
    expect(await screen.findByText(/Turn a screenshot into reviewed tasks/)).toBeTruthy();
    await user.keyboard('{Escape}');

    await user.click(sidebarButton('Settings'));
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeTruthy();

    await user.click(sidebarButton('Today'));
    const titleButton = await screen.findByRole('button', { name: 'Follow up with Acme' });
    await user.click(titleButton);
    const panel = await screen.findByRole('dialog', { name: /Task details/ });
    expect(within(panel).getByText(/Paused|Tracked time/)).toBeTruthy();
    await user.click(within(panel).getByRole('button', { name: 'Close task details' }));

    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    expect(await screen.findByRole('dialog', { name: 'Command palette' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull();
    });

    // Remounts re-read IndexedDB: onboarding must not repeat and the task must persist.
    const reloaded = render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    expect(await within(reloaded.container).findByText(/Good (morning|afternoon|evening), Aarav/)).toBeTruthy();
    expect(await within(reloaded.container).findByRole('button', { name: 'Follow up with Acme' })).toBeTruthy();
  }, 30000);

  it('creates via the form, reschedules, completes, undoes, and imports sample screenshot text', async () => {
    const user = userEvent.setup();
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );

    await user.click(await screen.findByRole('button', { name: 'Continue without an account' }, { timeout: 15000 }));
    const nameInput = await screen.findByLabelText('Your name', {}, { timeout: 15000 });
    await user.type(nameInput, 'Aarav Sharma');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(await screen.findByRole('button', { name: 'Continue' }));
    await user.click(await screen.findByRole('button', { name: 'Start planning' }));
    await screen.findByText(/Good (morning|afternoon|evening), Aarav/);

    await user.click(screen.getAllByRole('button', { name: 'New task' })[0]);
    const modal = await screen.findByRole('dialog', { name: 'New task' });
    await user.type(within(modal).getByLabelText('Task'), 'Draft proposal for Orion');
    await user.type(within(modal).getByLabelText('Client / account'), 'Orion Foods');
    await user.click(within(modal).getByRole('button', { name: 'Create task' }));

    const title = await screen.findByRole('button', { name: 'Draft proposal for Orion' });
    const card = title.closest('.task-card') as HTMLElement;
    const cardScope = within(card);

    await user.click(cardScope.getByRole('button', { name: /Reschedule/ }));
    /* The menu is portalled to <body> on purpose — inside the card its z-index
       was trapped under the fixed bottom bar on a phone — so it is found at
       document level, not inside the card. */
    await user.click(screen.getByRole('menuitem', { name: 'Tomorrow' }));
    await waitFor(() => {
      expect(cardScope.getByText(/Due tomorrow/)).toBeTruthy();
    });

    await user.click(cardScope.getByRole('button', { name: /^Complete/ }));
    await user.click(sidebarButton('Completed'));
    expect(await screen.findByRole('heading', { name: 'Completed' })).toBeTruthy();
    const completedTitle = await screen.findByRole('button', { name: 'Draft proposal for Orion' });
    const completedCard = completedTitle.closest('.task-card') as HTMLElement;
    await user.click(within(completedCard).getByRole('button', { name: /not completed/ }));
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Draft proposal for Orion' })).toBeNull();
    });

    await user.click(sidebarButton('My Tasks'));
    await user.click(await screen.findByRole('button', { name: 'Import screenshot' }));
    await screen.findByText(/Turn a screenshot into reviewed tasks/);
    await user.click(screen.getByRole('button', { name: 'Use sample text' }));
    expect(await screen.findByText('Extract text')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Continue to review' }));
    expect(await screen.findByText('Review parsed tasks')).toBeTruthy();
    expect((await screen.findAllByText(/3 drafts/)).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Continue to confirm' }));
    expect(await screen.findByText('Confirm import')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Save 3 tasks/ }));

    expect(await screen.findByRole('heading', { name: 'My Tasks' })).toBeTruthy();
    // The plan strip may repeat a title, so assert inside the task list itself.
    const list = document.querySelector('.task-list') as HTMLElement;
    expect(
      await within(list).findByRole('button', { name: 'Follow up with Acme Industries on the proposal' }),
    ).toBeTruthy();
    expect(
      await within(list).findByRole('button', { name: 'Send revised pricing deck to Nexus Retail — urgent' }),
    ).toBeTruthy();
  }, 30000);

  it('turns one natural-language line into a dated, prioritised task', async () => {
    const user = userEvent.setup();
    await seedOnboarded();
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );

    const quickAdd = await screen.findByPlaceholderText(/Add a task — press Enter/, {}, { timeout: 15000 });
    await user.type(quickAdd, 'Send deck tomorrow 3pm !high 30m #proposal');

    const pending = document.querySelector('.quick-tokens') as HTMLElement;
    expect(pending).toBeTruthy();
    expect(within(pending).getByText('Tomorrow')).toBeTruthy();
    expect(within(pending).getByText('3pm')).toBeTruthy();
    expect(within(pending).getByText('High priority')).toBeTruthy();
    expect(within(pending).getByText('30m')).toBeTruthy();
    expect(within(pending).getByText('Proposal')).toBeTruthy();
    expect((document.querySelector('.quick-add-priority') as HTMLSelectElement).disabled).toBe(true);

    await user.keyboard('{Enter}');

    expect(await screen.findByRole('button', { name: 'Send deck' })).toBeTruthy();
    expect(await screen.findByText(/Added “Send deck” for tomorrow/)).toBeTruthy();
    expect(await screen.findByText(/Due tomorrow at 15:00/)).toBeTruthy();
    expect(quickAdd).toHaveProperty('value', '');

    // Shortcuts must not fire while a field has the caret.
    (document.activeElement as HTMLElement | null)?.blur();
    await user.keyboard('?');
    const sheet = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
    expect(within(sheet).getByText('Open the command palette')).toBeTruthy();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).toBeNull());

    // Quick capture works from any page.
    await user.click(sidebarButton('My Tasks'));
    expect(await screen.findByRole('heading', { name: 'My Tasks' })).toBeTruthy();
    await user.keyboard('/');
    const focusedBar = await screen.findByPlaceholderText(/Add a task — press Enter/);
    await waitFor(() => expect(document.activeElement).toBe(focusedBar));
  }, 30000);

  it('offers an end-of-day wrap-up that rolls today to tomorrow and can be undone', async () => {
    const user = userEvent.setup();
    // A workday that has already ended makes the wrap-up deterministic in any timezone.
    await seedOnboarded({ workdayEnd: '00:00', workdayStart: '00:05' });
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );

    const quickAdd = await screen.findByPlaceholderText(/Add a task — press Enter/, {}, { timeout: 15000 });
    await user.type(quickAdd, 'File the weekly report{Enter}');
    expect(await screen.findByRole('button', { name: 'File the weekly report' })).toBeTruthy();

    const roll = await screen.findByRole('button', { name: 'Move to tomorrow' });
    await user.click(roll);

    expect(await screen.findByText(/Moved 1 task to tomorrow/)).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Move to tomorrow' })).toBeNull());

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await screen.findByText(/Moved back to today/)).toBeTruthy();
  }, 30000);

  it('collects a due reminder in the bell and marks it read', async () => {
    await seedOnboarded({ reminderLeadMinutes: 1440, quietHoursEnabled: false });
    const today = new Date().toISOString().slice(0, 10);
    await db.tasks.put({
      id: 'task_notify',
      title: 'Chase the invoice',
      notes: '',
      client: 'Northwind',
      category: 'follow_up',
      priority: 'critical',
      estimatedMinutes: 20,
      actualMinutes: 0,
      dueDate: today,
      dueTime: '00:01',
      scheduledFor: null,
      suggestedDate: null,
      suggestedStart: null,
      status: 'todo',
      blocked: false,
      dependencyIds: [],
      deferrals: 0,
      createdAt: new Date(Date.now() - 86_400_000).toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
      deletedAt: null,
      source: 'manual',
      graphRef: null,
    });

    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    await screen.findByPlaceholderText(/Add a task — press Enter/, {}, { timeout: 15000 });

    const bell = await waitFor(() => {
      const found = screen.getAllByRole('button', { name: /^Notifications/ });
      expect(found.length).toBeGreaterThan(0);
      return found[0];
    });
    await waitFor(() => expect(bell.getAttribute('aria-label')).toMatch(/unread/));

    fireEvent.click(bell);
    const panel = await screen.findByRole('dialog', { name: 'Notifications' });
    const scope = within(panel);
    expect(scope.getByText('Chase the invoice')).toBeTruthy();
    expect(scope.getByText(/Northwind/)).toBeTruthy();

    fireEvent.click(scope.getByRole('button', { name: /Mark all read/ }));
    await waitFor(() => expect(bell.getAttribute('aria-label')).toBe('Notifications'));
    expect(JSON.parse(window.localStorage.getItem('workday.notifications.v1') ?? '[]')[0].read).toBe(true);
  }, 30000);
});

describe('live behaviour', () => {
  beforeEach(async () => {
    if (!db.isOpen()) await db.open();
    await db.transaction(
      'rw',
      db.tasks,
      db.timeSessions,
      db.reminderRecords,
      db.taskEvents,
      db.settings,
      async () => {
        await db.tasks.clear();
        await db.timeSessions.clear();
        await db.reminderRecords.clear();
        await db.taskEvents.clear();
        await db.settings.clear();
      },
    );
    window.sessionStorage.clear();
    window.localStorage.clear();
    window.location.hash = '#/today';
    await db.settings.put({ ...DEFAULT_SETTINGS, id: 'app', name: 'Aarav Sharma', onboardingComplete: true });
  });

  it('moves the deadline countdown and the clock without a reload', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(new Date(2026, 9, 21, 10, 0, 0));
    try {
      render(<StrictMode><App /></StrictMode>);

      const quickAdd = await screen.findByPlaceholderText(/Add a task — press Enter/, {}, { timeout: 15000 });
      fireEvent.change(quickAdd, { target: { value: 'Send the deck 4pm' } });
      fireEvent.keyDown(quickAdd, { key: 'Enter', code: 'Enter' });

      expect(await screen.findByText(/Next in 5h 5\dm|Next in 6h/)).toBeTruthy();
      expect(document.querySelector('.analog-clock')?.getAttribute('aria-label')).toContain('10:00');

      // Two hours later, with no reload and no new fetch.
      await act(async () => {
        vi.setSystemTime(new Date(2026, 9, 21, 12, 0, 0));
        vi.advanceTimersByTime(60_000);
      });

      expect(await screen.findByText(/Next in 3h 5\dm|Next in 4h/)).toBeTruthy();
      const clock = document.querySelector('.analog-clock');
      expect(clock?.getAttribute('aria-label')).toContain('12:00');
    } finally {
      vi.useRealTimers();
    }
  }, 40000);

  it('collapses, expands and remembers the sidebar choice', async () => {
    // jsdom answers every media query with false; pin the desktop breakpoint on.
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) =>
        query.includes('min-width: 1081px')
          ? { ...(originalMatchMedia as any)(query), matches: true }
          : originalMatchMedia(query),
    });
    render(<StrictMode><App /></StrictMode>);
    await screen.findByPlaceholderText(/Add a task — press Enter/, {}, { timeout: 15000 });

    const shell = document.querySelector('.app-shell') as HTMLElement;
    expect(shell.dataset.sidebar).toBe('full');

    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    await waitFor(() => expect(document.querySelector('.app-shell')?.getAttribute('data-sidebar')).toBe('rail'));
    expect(window.localStorage.getItem('workday.sidebar')).toBe('collapsed');
    // The label is visually hidden in rail mode but stays reachable for assistive tech.
    expect(within(document.querySelector('.sidebar-nav') as HTMLElement).getByRole('button', { name: 'My Tasks' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    await waitFor(() => expect(document.querySelector('.app-shell')?.getAttribute('data-sidebar')).toBe('full'));
    expect(window.localStorage.getItem('workday.sidebar')).toBe('expanded');

    Object.defineProperty(window, 'matchMedia', { writable: true, value: originalMatchMedia });
  }, 30000);

  it('keeps the sidebar to five destinations with no repeated icons', async () => {
    render(<StrictMode><App /></StrictMode>);
    await screen.findByPlaceholderText(/Add a task — press Enter/, {}, { timeout: 15000 });
    const sidebar = document.querySelector('.sidebar') as HTMLElement;
    const icons = Array.from(sidebar.querySelectorAll('.nav-item svg')).map((svg) => svg.innerHTML);
    // Today, My Tasks, Completed, Reports + Settings.
    expect(icons.length).toBe(5);
    expect(new Set(icons).size).toBe(icons.length);
  }, 30000);
});
