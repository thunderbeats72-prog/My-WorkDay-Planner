import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsPage } from './SettingsPage';
import { DEFAULT_SETTINGS } from '../lib/types';
import type { AccountApi } from '../hooks/useAccount';
import type { BackgroundPushStatus } from '../lib/pushClient';

/**
 * Appearance used to be two controls saying the same thing: a segmented
 * Light/Dark/System picker, and underneath it two decorative swatches that
 * looked tappable and were not. The swatches are now the only control, and
 * they apply immediately — this is the guard for both halves.
 */

function fakeAccount(): AccountApi {
  return {
    account: null,
    cloudConfigured: false,
    cloudConnected: false,
    lastSyncedAt: null,
    syncBuiltIn: false,
    busy: false,
    syncNow: vi.fn(async () => ({ ok: true, message: 'ok' })),
    schedulePush: vi.fn(),
    signUp: vi.fn(async () => ({ ok: true })),
    signIn: vi.fn(async () => ({ ok: true })),
    signOut: vi.fn(),
    changePassword: vi.fn(async () => ({ ok: true })),
    removeAccount: vi.fn(async () => ({ ok: true })),
    connectCloud: vi.fn(async () => ({ ok: true })),
    disconnectCloud: vi.fn(),
    publishAccount: vi.fn(async () => ({ ok: true })),
  };
}

function renderSettings(
  overrides: {
    theme?: 'light' | 'dark' | 'system';
    settings?: Partial<typeof DEFAULT_SETTINGS>;
    onAddCategory?: (name: string) => string | null;
    onRenameCategory?: (from: string, to: string) => Promise<string | null>;
    onDeleteCategory?: (name: string) => Promise<number>;
    notificationsPermission?: string;
    backgroundStatus?: BackgroundPushStatus;
  } = {},
) {
  const onThemeChange = vi.fn();
  const onAddCategory = overrides.onAddCategory ?? vi.fn(() => null);
  const onRenameCategory = overrides.onRenameCategory ?? vi.fn(async () => null);
  const onDeleteCategory = overrides.onDeleteCategory ?? vi.fn(async () => 0);
  const onRequestNotifications = vi.fn(async () => 'granted');
  const onSendTestNotification = vi.fn();
  const addToast = vi.fn();
  render(
    <SettingsPage
      tasks={[]}
      graphHighlights={[]}
      settings={{
        ...DEFAULT_SETTINGS,
        onboardingComplete: true,
        theme: overrides.theme ?? 'light',
        ...overrides.settings,
      }}
      now={new Date('2026-01-05T10:00:00.000Z')}
      timer={{
        sessions: [],
        activeSession: null,
        now: Date.now(),
        elapsedMsFor: () => 0,
        isRunning: () => false,
        hasPausedSession: () => false,
        start: vi.fn(async () => undefined),
        pause: vi.fn(async () => undefined),
        resume: vi.fn(async () => undefined),
        finish: vi.fn(async () => 0),
        refresh: vi.fn(async () => undefined),
      }}
      taskHandlers={() => ({
        onOpen: vi.fn(),
        onEdit: vi.fn(),
        onDelete: vi.fn(),
        onToggleComplete: vi.fn(),
        onStart: vi.fn(),
        onPause: vi.fn(),
        onResume: vi.fn(),
        onFinish: vi.fn(),
        onToggleBlocked: vi.fn(),
        onReschedule: vi.fn(),
        onSnooze: vi.fn(),
      })}
      onOpenPage={vi.fn()}
      onQuickAdd={vi.fn()}
      onNewTask={vi.fn()}
      onEditTask={vi.fn()}
      addToast={addToast}
      online
      onSaveSettings={vi.fn()}
      onThemeChange={onThemeChange}
      onExportBackup={vi.fn()}
      onImportBackup={vi.fn()}
      onExportCsv={vi.fn()}
      onExportIcs={vi.fn()}
      onResetData={vi.fn()}
      onAddCategory={onAddCategory}
      onRenameCategory={onRenameCategory}
      onDeleteCategory={onDeleteCategory}
      graph={{
        connected: false,
        account: null,
        errors: [],
        busy: false,
        onConnect: vi.fn(),
        onDisconnect: vi.fn(),
        onCheck: vi.fn(),
      }}
      notificationsPermission={overrides.notificationsPermission ?? 'default'}
      onRequestNotifications={onRequestNotifications}
      onSendTestNotification={onSendTestNotification}
      backgroundStatus={overrides.backgroundStatus}
      account={fakeAccount()}
    />,
  );
  return { onThemeChange, onAddCategory, onRenameCategory, onDeleteCategory, onRequestNotifications, onSendTestNotification, addToast };
}

describe('Notification setup', () => {
  it('requests permission only after an explicit enable click', async () => {
    const { onRequestNotifications, onSendTestNotification, addToast } = renderSettings();
    expect(onRequestNotifications).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Send test notification' }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole('switch', { name: 'Send system reminders' }));
    expect(onRequestNotifications).not.toHaveBeenCalled();
    expect(addToast).toHaveBeenCalledWith('Select Enable system notifications first.', 'warning');
    expect(onSendTestNotification).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Enable system notifications' }));
    expect(onRequestNotifications).toHaveBeenCalledOnce();
  });

  it('does not label permission alone as verified background delivery', () => {
    renderSettings({ notificationsPermission: 'granted', settings: { notificationsEnabled: true }, backgroundStatus: {
      state: 'scheduler-offline', message: 'The scheduler has not run recently.', subscribed: true, schedulerLastSuccess: null, history: [],
    } });
    expect(screen.getByText('The scheduler has not run recently.')).toBeTruthy();
    expect(screen.queryByText('Background setup verified')).toBeNull();
  });
});

describe('Appearance', () => {
  it('offers exactly two choices, both with an icon', () => {
    renderSettings();
    const light = screen.getByRole('button', { name: 'Light' });
    const dark = screen.getByRole('button', { name: 'Dark' });
    expect(light.querySelector('svg')).toBeTruthy();
    expect(dark.querySelector('svg')).toBeTruthy();
    // The old segmented picker is gone, so nothing offers a third option.
    expect(screen.queryByRole('tab', { name: 'System' })).toBeNull();
  });

  it('marks the current theme as pressed', () => {
    renderSettings({ theme: 'dark' });
    expect(screen.getByRole('button', { name: 'Dark' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Light' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('applies the theme the moment it is tapped, without Save', async () => {
    const { onThemeChange } = renderSettings({ theme: 'light' });
    await userEvent.click(screen.getByRole('button', { name: 'Dark' }));
    expect(onThemeChange).toHaveBeenCalledWith('dark');
  });

  it('explains that a system preference is in force until a choice is made', () => {
    renderSettings({ theme: 'system' });
    expect(screen.getByText(/Following your system/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Light' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'Dark' }).getAttribute('aria-pressed')).toBe('false');
  });
});

describe('Categories in Settings', () => {
  it('lists the built-ins as fixed and the user’s own as editable', () => {
    renderSettings({ settings: { customCategories: ['Licensing'] } });
    expect(screen.getByRole('heading', { name: 'Categories' })).toBeTruthy();
    // A built-in says it cannot be edited rather than offering a dead button.
    expect(screen.getAllByText('Built-in').length).toBeGreaterThanOrEqual(8);
    expect(screen.queryByRole('button', { name: 'Edit Other' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Edit Licensing' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete Licensing' })).toBeTruthy();
  });

  it('adds a category with the button and with Enter', async () => {
    const user = userEvent.setup();
    const { onAddCategory } = renderSettings();
    const field = screen.getByLabelText('Add a category');

    await user.type(field, 'Recruitment');
    await user.click(screen.getByRole('button', { name: 'Add category' }));
    expect(onAddCategory).toHaveBeenCalledWith('Recruitment');
    expect((field as HTMLInputElement).value).toBe('');

    await user.type(field, 'Field work');
    await user.keyboard('{Enter}');
    expect(onAddCategory).toHaveBeenCalledWith('Field work');
  });

  it('refuses a built-in name before anything is saved', async () => {
    const user = userEvent.setup();
    const onAddCategory = vi.fn(() => null);
    renderSettings({ onAddCategory });

    await user.type(screen.getByLabelText('Add a category'), 'Proposal');
    await user.click(screen.getByRole('button', { name: 'Add category' }));

    expect(await screen.findByText('That category already exists.')).toBeTruthy();
    expect(onAddCategory).not.toHaveBeenCalled();
    // The name stays in the field so it can be corrected rather than retyped.
    expect((screen.getByLabelText('Add a category') as HTMLInputElement).value).toBe('Proposal');
  });

  it('shows the reason when saving is refused', async () => {
    const user = userEvent.setup();
    const onAddCategory = vi.fn(() => 'Only 20 custom categories are allowed.');
    renderSettings({ onAddCategory });

    await user.type(screen.getByLabelText('Add a category'), 'Licensing');
    await user.click(screen.getByRole('button', { name: 'Add category' }));

    expect(onAddCategory).toHaveBeenCalledWith('Licensing');
    expect(await screen.findByText('Only 20 custom categories are allowed.')).toBeTruthy();
  });

  it('renames in place, and saves with Enter', async () => {
    const user = userEvent.setup();
    const onRenameCategory = vi.fn(async () => null);
    renderSettings({ settings: { customCategories: ['Licensing'] }, onRenameCategory });

    await user.click(screen.getByRole('button', { name: 'Edit Licensing' }));
    const field = screen.getByLabelText('Rename Licensing');
    await user.clear(field);
    await user.type(field, 'Permits{Enter}');
    expect(onRenameCategory).toHaveBeenCalledWith('Licensing', 'Permits');
  });

  it('keeps the old name and says why when a rename clashes', async () => {
    const user = userEvent.setup();
    const onRenameCategory = vi.fn(async () => 'That category already exists.');
    renderSettings({ settings: { customCategories: ['Licensing', 'Permits'] }, onRenameCategory });

    await user.click(screen.getByRole('button', { name: 'Edit Licensing' }));
    const field = screen.getByLabelText('Rename Licensing');
    await user.clear(field);
    await user.type(field, 'Permits');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('That category already exists.')).toBeTruthy();
    // Still editing — the row has not pretended the rename happened.
    expect(screen.getByLabelText('Rename Licensing')).toBeTruthy();
  });

  it('asks before deleting, and says what happens to the tasks', async () => {
    const user = userEvent.setup();
    const onDeleteCategory = vi.fn(async () => 0);
    renderSettings({ settings: { customCategories: ['Licensing'] }, onDeleteCategory });

    await user.click(screen.getByRole('button', { name: 'Delete Licensing' }));
    const dialog = await screen.findByRole('dialog', { name: /Delete “Licensing”/ });
    /* No tasks in this fixture, so the message says so rather than inventing
       a count. The “moves to Other” wording is asserted end to end in
       CategoryManagement.test.tsx, where the tasks are real. */
    expect(dialog.textContent).toContain('Nothing is filed under it');
    await user.click(screen.getByRole('button', { name: 'Delete category' }));

    expect(onDeleteCategory).toHaveBeenCalledWith('Licensing');
  });

  it('cancelling the confirmation deletes nothing', async () => {
    const user = userEvent.setup();
    const onDeleteCategory = vi.fn(async () => 0);
    renderSettings({ settings: { customCategories: ['Licensing'] }, onDeleteCategory });

    await user.click(screen.getByRole('button', { name: 'Delete Licensing' }));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(onDeleteCategory).not.toHaveBeenCalled();
  });
});
