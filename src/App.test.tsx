import { StrictMode } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import App from './App';
import { db } from './lib/db';

function sidebarButton(label: string): HTMLElement {
  const sidebar = document.querySelector('.sidebar-nav');
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

    const nameInput = await screen.findByLabelText('Your name', {}, { timeout: 15000 });
    await user.type(nameInput, 'Aarav Sharma');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByText('When do you actually work?')).toBeTruthy();
    expect(screen.getByText(/of capacity per working day/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByText('Your defaults')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Start planning' }));

    expect(await screen.findByText(/Good (morning|afternoon|evening), Aarav/)).toBeTruthy();

    const quickAdd = screen.getByPlaceholderText(/Quick add for today/);
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

    await user.click(sidebarButton('Inbox'));
    expect(await screen.findByRole('heading', { name: 'Inbox' })).toBeTruthy();
    expect(screen.getAllByText('Follow up with Acme').length).toBeGreaterThan(0);

    await user.click(sidebarButton('Schedule'));
    expect(await screen.findByRole('heading', { name: 'Schedule' })).toBeTruthy();
    expect(screen.getByText('Unscheduled queue')).toBeTruthy();

    await user.click(sidebarButton('Reports'));
    expect(await screen.findByRole('heading', { name: 'Reports' })).toBeTruthy();

    await user.click(sidebarButton('Screenshot Import'));
    expect(await screen.findByText(/Turn a screenshot into reviewed tasks/)).toBeTruthy();

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
    await user.click(within(card).getByRole('menuitem', { name: 'Tomorrow' }));
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

    await user.click(sidebarButton('Screenshot Import'));
    await screen.findByText(/Turn a screenshot into reviewed tasks/);
    await user.click(screen.getByRole('button', { name: 'Use sample text' }));
    expect(await screen.findByText('Extract text')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Continue to review' }));
    expect(await screen.findByText('Review parsed tasks')).toBeTruthy();
    expect((await screen.findAllByText(/3 drafts/)).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Continue to confirm' }));
    expect(await screen.findByText('Confirm import')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Save 3 tasks/ }));

    expect(await screen.findByRole('heading', { name: 'Inbox' })).toBeTruthy();
    expect(
      await screen.findByRole('button', { name: 'Follow up with Acme Industries on the proposal' }),
    ).toBeTruthy();
    expect(
      await screen.findByRole('button', { name: 'Send revised pricing deck to Nexus Retail — urgent' }),
    ).toBeTruthy();
  }, 30000);
});
