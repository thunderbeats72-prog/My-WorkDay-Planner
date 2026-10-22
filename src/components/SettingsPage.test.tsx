import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsPage } from './SettingsPage';
import { DEFAULT_SETTINGS } from '../lib/types';
import type { AccountApi } from '../hooks/useAccount';

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

function renderSettings(overrides: { theme?: 'light' | 'dark' | 'system' } = {}) {
  const onThemeChange = vi.fn();
  render(
    <SettingsPage
      tasks={[]}
      settings={{ ...DEFAULT_SETTINGS, onboardingComplete: true, theme: overrides.theme ?? 'light' }}
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
      addToast={vi.fn()}
      online
      onSaveSettings={vi.fn()}
      onThemeChange={onThemeChange}
      onExportBackup={vi.fn()}
      onImportBackup={vi.fn()}
      onExportCsv={vi.fn()}
      onResetData={vi.fn()}
      graph={{
        connected: false,
        account: null,
        errors: [],
        busy: false,
        onConnect: vi.fn(),
        onDisconnect: vi.fn(),
        onCheck: vi.fn(),
      }}
      notificationsPermission="default"
      onRequestNotifications={vi.fn(async () => 'granted')}
      onSendTestNotification={vi.fn()}
      account={fakeAccount()}
    />,
  );
  return { onThemeChange };
}

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
