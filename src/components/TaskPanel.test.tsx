import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TaskPanel } from './TaskPanel';
import type { Task } from '../lib/types';
import { DEFAULT_SETTINGS } from '../lib/types';

const task: Task = {
  id: 'task-panel-1',
  title: 'Check on Zoho CRM leads',
  notes: '',
  client: '',
  category: 'other',
  priority: 'medium',
  estimatedMinutes: 30,
  actualMinutes: 0,
  dueDate: '2026-10-28',
  dueTime: '',
  scheduledFor: null,
  suggestedDate: null,
  suggestedStart: null,
  status: 'todo',
  blocked: false,
  dependencyIds: [],
  deferrals: 0,
  createdAt: '2026-10-28T06:00:00.000Z',
  updatedAt: '2026-10-28T06:00:00.000Z',
  completedAt: null,
  deletedAt: null,
  source: 'manual',
  graphRef: null,
};

function renderPanel(overrides: Partial<Task> = {}, onToggleComplete = vi.fn()) {
  const shownTask = { ...task, ...overrides };
  render(
    <TaskPanel
      task={shownTask}
      tasks={[shownTask]}
      settings={DEFAULT_SETTINGS}
      now={new Date('2026-10-28T09:00:00.000Z')}
      elapsedMs={0}
      isRunning={false}
      isPaused={false}
      learned={null}
      onClose={vi.fn()}
      onEdit={vi.fn()}
      onStart={vi.fn()}
      onPause={vi.fn()}
      onResume={vi.fn()}
      onFinish={vi.fn()}
      onToggleComplete={onToggleComplete}
      onSaveNote={vi.fn()}
      onSaveCompletionNote={vi.fn()}
      onApplySuggestion={vi.fn()}
      onOpenTask={vi.fn()}
      onAttachmentsChange={vi.fn()}
    />,
  );
  return { onToggleComplete };
}

describe('task details panel actions', () => {
  it('keeps completion outside the scrolling body so it is always reachable', () => {
    const { onToggleComplete } = renderPanel();
    const panel = screen.getByRole('dialog', { name: /Task details/ });
    const footer = panel.querySelector('.panel-foot');
    const body = panel.querySelector('.panel-body');

    expect(footer).toBeTruthy();
    expect(body).toBeTruthy();
    expect(body?.contains(footer)).toBe(false);

    fireEvent.click(within(footer as HTMLElement).getByRole('button', { name: 'Complete task' }));
    expect(onToggleComplete).toHaveBeenCalledOnce();
  });

  it('offers the inverse action for an already completed task', () => {
    const { onToggleComplete } = renderPanel({ status: 'completed', completedAt: '2026-10-28T08:00:00.000Z' });
    const panel = screen.getByRole('dialog', { name: /Task details/ });
    const footer = panel.querySelector('.panel-foot') as HTMLElement;

    fireEvent.click(within(footer).getByRole('button', { name: 'Reopen task' }));
    expect(onToggleComplete).toHaveBeenCalledOnce();
  });
});
