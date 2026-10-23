import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { BottomNav, MobileTopBar } from './Shell';

/**
 * Two things on the phone are easy to "clean up" by accident and hard to
 * notice afterwards: the theme switch in the top bar, and the single page
 * that owns the floating add button.
 */

describe('the phone top bar', () => {
  it('offers the other theme from the top bar', async () => {
    const onToggleTheme = vi.fn();
    const user = userEvent.setup();

    render(
      <MobileTopBar
        isDark
        onToggleTheme={onToggleTheme}
        onOpenPalette={() => {}}
        onOpenSettings={() => {}}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Switch to light theme' }));
    expect(onToggleTheme).toHaveBeenCalledTimes(1);
  });

  it('offers light → dark the other way round', async () => {
    const onToggleTheme = vi.fn();
    const user = userEvent.setup();

    render(
      <MobileTopBar
        isDark={false}
        onToggleTheme={onToggleTheme}
        onOpenPalette={() => {}}
        onOpenSettings={() => {}}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
    expect(onToggleTheme).toHaveBeenCalledTimes(1);
  });

  it('still shows the name in full and keeps Settings on the right', () => {
    render(
      <MobileTopBar
        isDark
        onToggleTheme={() => {}}
        onOpenPalette={() => {}}
        onOpenSettings={() => {}}
      />,
    );

    expect(screen.getByText('Workday')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy();
  });
});

describe('the floating add button', () => {
  const noop = () => {};

  it('belongs to My Tasks', () => {
    render(<BottomNav page="tasks" onNavigate={noop} onAddTask={noop} />);
    expect(screen.getByRole('button', { name: 'Add task' })).toBeTruthy();
  });

  it('is present on every page — the plus always opens the new-task sheet', () => {
    const pages: Array<Parameters<typeof BottomNav>[0]['page']> = ['today', 'tasks', 'completed', 'reports'];
    for (const page of pages) {
      const { unmount } = render(<BottomNav page={page} onNavigate={noop} onAddTask={noop} />);
      expect(screen.getByRole('button', { name: 'Add task' })).toBeTruthy();
      unmount();
    }
  });

  it('keeps five destinations, one of them the daily update', () => {
    /* Five is the ceiling for a phone bar: at 320px each slot is still 64px
       wide, and the last one is the end-of-day update — the one screen a phone
       is most likely to be used for. Its label is shortened to “Daily” so it
       never wraps to two lines. */
    render(<BottomNav page="today" onNavigate={noop} onAddTask={noop} />);
    const nav = screen.getByRole('navigation', { name: 'Mobile navigation' });
    const labels = Array.from(nav.querySelectorAll('button')).map((button) => button.textContent?.trim());
    expect(labels).toEqual(['Today', 'My Tasks', 'Completed', 'Daily', 'Reports']);
  });
});
