import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import App from '../App';
import { db } from '../lib/db';
import { todayISO } from '../lib/dates';
import { DEFAULT_SETTINGS } from '../lib/types';

describe('focus workspace in the planner', () => {
  beforeEach(async () => {
    if (!db.isOpen()) await db.open();
    await db.transaction('rw', db.tasks, db.timeSessions, db.reminderRecords, db.taskEvents, db.settings, async () => {
      await db.tasks.clear();
      await db.timeSessions.clear();
      await db.reminderRecords.clear();
      await db.taskEvents.clear();
      await db.settings.clear();
    });
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.location.hash = '#/today';
    await db.settings.put({
      ...DEFAULT_SETTINGS,
      name: 'Aarav Sharma',
      onboardingComplete: true,
      workdayStart: '00:00',
      workdayEnd: '23:59',
      workingDays: [0, 1, 2, 3, 4, 5, 6],
    });
    await db.tasks.put({
      id: 'task_focus_flow',
      title: 'Prepare the Northwind proposal',
      notes: '',
      client: 'Northwind',
      category: 'proposal',
      priority: 'high',
      estimatedMinutes: 30,
      actualMinutes: 0,
      dueDate: todayISO(),
      dueTime: '23:45',
      scheduledFor: null,
      suggestedDate: null,
      suggestedStart: null,
      status: 'todo',
      blocked: false,
      dependencyIds: [],
      deferrals: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
      deletedAt: null,
      source: 'manual',
      graphRef: null,
    });
  });

  it('starts, pauses, minimizes, returns, and completes with real persisted timer data', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Focus mode' }, { timeout: 15000 }));
    const focusDialog = await screen.findByRole('dialog', { name: 'Prepare the Northwind proposal' });
    await user.click(within(focusDialog).getByRole('button', { name: 'Start focus' }));
    expect(await within(focusDialog).findByRole('button', { name: 'Pause focus' })).toBeTruthy();

    await user.click(within(focusDialog).getByRole('button', { name: 'Minimize focus mode' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Prepare the Northwind proposal' })).toBeNull());

    await user.click(screen.getByRole('button', { name: 'Focus' }));
    const returned = await screen.findByRole('dialog', { name: 'Prepare the Northwind proposal' });
    await user.click(within(returned).getByRole('button', { name: 'Pause focus' }));
    expect(await within(returned).findByRole('button', { name: 'Resume focus' })).toBeTruthy();
    await waitFor(async () => {
      const sessions = await db.timeSessions.toArray();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].state).toBe('paused');
    });

    await user.click(within(returned).getByRole('button', { name: 'Complete task' }));
    const completion = await screen.findByRole('dialog', { name: 'Complete task' });
    await user.click(within(completion).getByRole('button', { name: 'Complete Without Note' }));

    expect(await screen.findByText('1 of 1 task complete')).toBeTruthy();
    expect(screen.getByRole('group', { name: /100% of today's work complete/ })).toBeTruthy();
    expect((await db.tasks.get('task_focus_flow'))?.status).toBe('completed');
  }, 30000);
});
