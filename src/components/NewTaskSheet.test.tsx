import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import App from '../App';
import { db } from '../lib/db';
import { DEFAULT_SETTINGS } from '../lib/types';

/**
 * Opening the New task sheet must not re-lay the page.
 *
 * The bug was not in the sheet: the ripple painted inside the fixed add button
 * gave it `position: relative`, so it left the corner, became a flex child of
 * the shell, and the whole page shifted under the finger that had just tapped
 * "+". From the outside that is both "the plus does nothing" and "opening it
 * breaks the padding". These are the invariants that keep it from coming back:
 * while the sheet is open, the page keeps its own scroll, the body is not
 * locked on a touch screen, and the floating button is still in the DOM.
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

describe('the add button never moves the page', () => {
  it('leaves the document scrolling while the sheet is open on a phone', async () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes('coarse') || query.includes('max-width'),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;

    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Add task' }, { timeout: 15000 }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New task' })).not.toBeNull());

    // The CSS stops the page behind the backdrop from scrolling; flipping
    // `body.overflow` as well re-lays the document and is what made the tap
    // look like a layout jump.
    expect(document.body.style.overflow).toBe('');

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New task' })).toBeNull());
    window.matchMedia = original;
  });

  it('keeps the floating button mounted for the whole round trip', async () => {
    const user = userEvent.setup();
    render(<App />);

    const fab = await screen.findByRole('button', { name: 'Add task' }, { timeout: 15000 });
    await user.click(fab);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New task' })).not.toBeNull());
    // Still there, still the same node: nothing unmounted or moved the page.
    expect(document.contains(fab)).toBe(true);

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New task' })).toBeNull());
    expect(document.contains(fab)).toBe(true);
  });

  it('saves a task created from the sheet and closes it', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Add task' }, { timeout: 15000 }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New task' })).not.toBeNull());

    await user.type(screen.getByLabelText('Task'), 'Call the Acme buyer');
    await user.click(screen.getByRole('button', { name: 'Create task' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New task' })).toBeNull());
    const stored = await db.tasks.toArray();
    expect(stored.some((task) => task.title === 'Call the Acme buyer')).toBe(true);
  });
});
