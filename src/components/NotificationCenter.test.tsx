import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NotificationCenter } from './NotificationCenter';
import type { AppNotification } from '../lib/notifications';

const common = { body: 'Still incomplete', createdAt: '2026-10-28T10:00:00.000Z', dueAt: null, read: false };
const task: AppNotification = { ...common, id: 'cloud:task', taskId: 'task-1', title: 'Overdue task', kind: 'overdue' };
const summary: AppNotification = { ...common, id: 'cloud:summary', taskId: null, title: 'Daily pending summary', kind: 'summary' };

describe('notification inbox actions', () => {
  it('opens summaries in overdue tasks and offers task snooze/read/dismiss controls', async () => {
    const onOpenOverdue = vi.fn(); const onOpenTask = vi.fn(); const onSnooze = vi.fn();
    const onMarkRead = vi.fn(); const onDismiss = vi.fn();
    render(<NotificationCenter notifications={[task, summary]} permission="granted" alertsEnabled
      onOpenTask={onOpenTask} onOpenOverdue={onOpenOverdue} onSnooze={onSnooze} onDismiss={onDismiss}
      onMarkAllRead={vi.fn()} onMarkRead={onMarkRead} onClearAll={vi.fn()} onRequestPermission={vi.fn()}
      onSendTest={vi.fn()} onOpenSettings={vi.fn()} backgroundMessage="Scheduler active" />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Notifications, 2 unread/ }));
    await user.selectOptions(screen.getByLabelText('Snooze Overdue task'), '30');
    expect(onSnooze).toHaveBeenCalledWith('task-1', 30);
    await user.click(screen.getByRole('button', { name: 'Mark Overdue task as read' }));
    expect(onMarkRead).toHaveBeenCalledWith('cloud:task');
    await user.click(screen.getByRole('button', { name: 'Dismiss notification: Overdue task' }));
    expect(onDismiss).toHaveBeenCalledWith(task);
    await user.click(screen.getByRole('button', { name: 'Daily pending summary' }));
    expect(onOpenOverdue).toHaveBeenCalledWith('cloud:summary');
    await user.click(screen.getByRole('button', { name: /Notifications, 2 unread/ }));
    await user.click(screen.getByRole('button', { name: 'Overdue task' }));
    expect(onOpenTask).toHaveBeenCalledWith('task-1', 'cloud:task');
  });
});
