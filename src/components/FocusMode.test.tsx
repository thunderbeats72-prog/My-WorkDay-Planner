import type { ComponentProps } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FocusMode } from './FocusMode';
import type { Task } from '../lib/types';

const NOW = new Date(2026, 9, 31, 12, 0, 0);

const TASK: Task = {
  id: 'task_focus',
  title: 'Prepare the Northwind proposal',
  notes: '',
  client: 'Northwind',
  category: 'proposal',
  priority: 'high',
  estimatedMinutes: 50,
  actualMinutes: 0,
  dueDate: '2026-10-31',
  dueTime: '16:00',
  scheduledFor: null,
  suggestedDate: null,
  suggestedStart: null,
  status: 'todo',
  blocked: false,
  dependencyIds: [],
  deferrals: 0,
  createdAt: '2026-10-30T09:00:00.000Z',
  updatedAt: '2026-10-30T09:00:00.000Z',
  completedAt: null,
  deletedAt: null,
  source: 'manual',
  graphRef: null,
};

function renderFocus(overrides: Partial<ComponentProps<typeof FocusMode>> = {}) {
  const props: ComponentProps<typeof FocusMode> = {
    task: TASK,
    now: NOW,
    elapsedMs: 0,
    isRunning: false,
    isPaused: false,
    defaultGoalMinutes: 50,
    onClose: vi.fn(),
    onStart: vi.fn(),
    onResume: vi.fn(),
    onPause: vi.fn(),
    onFinish: vi.fn(),
    onComplete: vi.fn(),
    ...overrides,
  };
  const view = render(<FocusMode {...props} />);
  return { ...view, props };
}

describe('FocusMode', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('starts a session and remembers the chosen goal', async () => {
    const user = userEvent.setup();
    const { props, unmount } = renderFocus();

    expect(screen.getByRole('dialog', { name: TASK.title })).toBeTruthy();
    expect(screen.getByText('00:00:00')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '25m' }));
    expect(screen.getByText('A 25-minute goal. Start when you are ready.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Start focus' }));
    expect(props.onStart).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem('workday.focus-goal.v1')).toBe('25');

    unmount();
    renderFocus();
    expect(screen.getByRole('button', { name: '25m' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('shows live elapsed time and wires pause, finish and complete independently', async () => {
    const user = userEvent.setup();
    const { props } = renderFocus({ isRunning: true, elapsedMs: 65_000 });

    expect(screen.getByText('00:01:05')).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'Focus session goal' }).getAttribute('aria-valuenow')).toBe('2');
    await user.click(screen.getByRole('button', { name: 'Pause focus' }));
    expect(props.onPause).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Finish & exit' }));
    expect(props.onFinish).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Complete task' }));
    expect(props.onComplete).toHaveBeenCalledTimes(1);
  });

  it('resumes a paused session without offering a no-op finish action', async () => {
    const user = userEvent.setup();
    const { props } = renderFocus({ isPaused: true, elapsedMs: 120_000 });
    await user.click(screen.getByRole('button', { name: 'Resume focus' }));
    expect(props.onResume).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Finish & exit' })).toBeNull();
  });

  it('supports Space to start and Escape to minimize without losing the timer', () => {
    const { props } = renderFocus();
    const dialog = screen.getByRole('dialog', { name: TASK.title });
    fireEvent.keyDown(dialog, { key: ' ', code: 'Space' });
    expect(props.onStart).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('labels a reached goal and restores page scrolling on unmount', () => {
    window.localStorage.setItem('workday.focus-goal.v1', '25');
    const { unmount } = renderFocus({ isRunning: true, elapsedMs: 26 * 60_000 });
    expect(screen.getByText(/Goal reached/)).toBeTruthy();
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('');
  });
});
