import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import App from '../App';
import { db } from '../lib/db';
import { DEFAULT_SETTINGS } from '../lib/types';

/**
 * "+" must open the sheet.
 *
 * This is the whole path — floating button, App state, portal, dialog — through
 * the real component tree rather than a mock. It passed the day the phone said
 * the button was dead, which is what narrowed that report to the keyboard and
 * the zoom rather than the wiring. Keeping it means the wiring stays true.
 */

beforeEach(async () => {
  if (!db.isOpen()) await db.open();
  window.location.hash = '#/tasks';
  await db.settings.clear();
  await db.tasks.clear();
  window.localStorage.clear();
  window.sessionStorage.clear();
  await db.settings.put({ ...DEFAULT_SETTINGS, id: 'app', name: 'A', onboardingComplete: true });
});

describe('the floating add button', () => {
  it('opens the New task sheet', async () => {
    const user = userEvent.setup();
    render(<App />);

    const fab = await screen.findByRole('button', { name: 'Add task' }, { timeout: 15000 });
    await user.click(fab);

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New task' })).not.toBeNull());
    expect(screen.getByLabelText('Task')).toBeTruthy();
  });

  it('closes on Escape and leaves the page as it was', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Add task' }, { timeout: 15000 }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New task' })).not.toBeNull());

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New task' })).toBeNull());
  });
});
