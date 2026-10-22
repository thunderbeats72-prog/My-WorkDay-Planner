import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthForm } from './AuthForm';
import type { AccountApi } from '../hooks/useAccount';

function fakeAccount(overrides: Partial<AccountApi> = {}): AccountApi {
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
    ...overrides,
  };
}

describe('AuthForm', () => {
  it('keeps the action disabled until both fields have something in them', async () => {
    render(<AuthForm account={fakeAccount()} />);
    const submit = screen.getByRole('button', { name: 'Sign in' });
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    await userEvent.type(screen.getByLabelText('User ID'), 'lakshit');
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    await userEvent.type(screen.getByLabelText('Password'), 'open sesame 72');
    expect((submit as HTMLButtonElement).disabled).toBe(false);
  });

  it('reveals the password without moving it between fields', async () => {
    render(<AuthForm account={fakeAccount()} />);
    const password = screen.getByLabelText('Password') as HTMLInputElement;
    await userEvent.type(password, 'open sesame 72');
    expect(password.type).toBe('password');

    await userEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(password.type).toBe('text');
    expect(password.value).toBe('open sesame 72');

    await userEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(password.type).toBe('password');
  });

  it('shows an inline error as an alert, not a silent no-op', async () => {
    const account = fakeAccount({ signIn: vi.fn(async () => ({ ok: false, error: 'That user ID and password do not match.' })) });
    render(<AuthForm account={account} />);

    await userEvent.type(screen.getByLabelText('User ID'), 'lakshit');
    await userEvent.type(screen.getByLabelText('Password'), 'nope');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect((await screen.findByRole('alert')).textContent).toContain('do not match');
  });

  it('tabs are tabs, not buttons, so the submit action is unambiguous to a screen reader', () => {
    render(<AuthForm account={fakeAccount()} />);
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Sign in' })).toHaveLength(1);
  });

  it('asks for confirmation only when creating', async () => {
    render(<AuthForm account={fakeAccount()} />);
    expect(screen.queryByLabelText('Confirm password')).toBeNull();
    await userEvent.click(screen.getByRole('tab', { name: 'Create account' }));
    expect(screen.getByLabelText('Confirm password')).toBeTruthy();
    expect(screen.getByLabelText('Your name')).toBeTruthy();
  });
});
