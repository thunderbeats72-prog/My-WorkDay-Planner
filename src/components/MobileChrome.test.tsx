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

  it('is absent on Reports and Completed, where it covered the page', () => {
    const reports = render(<BottomNav page="reports" onNavigate={noop} onAddTask={noop} />);
    expect(screen.queryByRole('button', { name: 'Add task' })).toBeNull();
    reports.unmount();

    render(<BottomNav page="completed" onNavigate={noop} onAddTask={noop} />);
    expect(screen.queryByRole('button', { name: 'Add task' })).toBeNull();
  });

  it('keeps exactly four destinations', () => {
    render(<BottomNav page="today" onNavigate={noop} onAddTask={noop} />);
    expect(screen.getByRole('navigation', { name: 'Mobile navigation' }).querySelectorAll('button')).toHaveLength(4);
  });
});
