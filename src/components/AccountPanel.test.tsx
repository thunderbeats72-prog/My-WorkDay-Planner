import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AccountPanel } from './AccountPanel';
import type { AccountApi } from '../hooks/useAccount';
import type { StoredAccount } from '../lib/accounts';

const addToast = vi.fn();

function fakeAccount(overrides: Partial<AccountApi> = {}): AccountApi {
  return {
    account: null,
    cloudConfigured: false,
    cloudConnected: false,
    lastSyncedAt: null,
    syncBuiltIn: false,
    busy: false,
    syncNow: vi.fn(async () => ({ ok: true, message: 'Nothing new — both devices already match.' })),
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

const signedIn: StoredAccount = {
  id: 'lakshit',
  displayName: 'Lakshit',
  salt: 'a'.repeat(32),
  hash: 'b'.repeat(64),
  iterations: 210_000,
  createdAt: '2026-01-01T00:00:00.000Z',
  lastLoginAt: '2026-01-02T00:00:00.000Z',
};

describe('AccountPanel', () => {
  it('starts on sign in, and swaps to a create form with a confirm field', async () => {
    const api = fakeAccount();
    render(<AccountPanel account={api} addToast={addToast} />);

    expect(screen.getByLabelText('User ID')).toBeTruthy();
    expect(screen.queryByLabelText('Confirm password')).toBeNull();

    await userEvent.click(screen.getByRole('tab', { name: 'Create account' }));
    expect(screen.getByLabelText('Confirm password')).toBeTruthy();
    expect(screen.getByLabelText('Your name')).toBeTruthy();
  });

  it('refuses two different passwords before it calls the API', async () => {
    const api = fakeAccount();
    render(<AccountPanel account={api} addToast={addToast} />);

    await userEvent.click(screen.getByRole('tab', { name: 'Create account' }));
    await userEvent.type(screen.getByLabelText('User ID'), 'lakshit');
    await userEvent.type(screen.getByLabelText('Password'), 'open sesame 72');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'open sesame 73');
    await userEvent.click(screen.getByRole('button', { name: 'Create my account' }));

    expect((await screen.findByRole('alert')).textContent).toContain('The two passwords do not match.');
    expect(api.signUp).not.toHaveBeenCalled();
  });

  it('shows the API error rather than a generic failure', async () => {
    const api = fakeAccount({ signIn: vi.fn(async () => ({ ok: false, error: 'That user ID and password do not match.' })) });
    render(<AccountPanel account={api} addToast={addToast} />);

    await userEvent.type(screen.getByLabelText('User ID'), 'lakshit');
    await userEvent.type(screen.getByLabelText('Password'), 'nope');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect((await screen.findByRole('alert')).textContent).toContain('do not match');
  });

  it('says plainly that an account is device-only until sync is connected', () => {
    render(<AccountPanel account={fakeAccount({ account: signedIn })} addToast={addToast} />);
    expect(screen.getAllByText(/@lakshit/).length).toBeGreaterThan(0);
    expect(screen.getByText(/this device only/)).toBeTruthy();
    expect(screen.getByText('Local only')).toBeTruthy();
  });

  it('offers Sync now once a project is connected', async () => {
    const syncNow = vi.fn(async () => ({ ok: true, message: '1 new task' }));
    render(
      <AccountPanel
        account={fakeAccount({ account: signedIn, cloudConfigured: true, cloudConnected: true, syncNow })}
        addToast={addToast}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /Sync now/ }));
    expect(syncNow).toHaveBeenCalled();
    expect(addToast).toHaveBeenLastCalledWith('1 new task', 'success');
  });

  it('never asks for database keys when sync is not configured', () => {
    render(<AccountPanel account={fakeAccount({ account: signedIn })} addToast={addToast} />);

    expect(screen.getByText(/Not configured in this copy/)).toBeTruthy();
    expect(screen.queryByLabelText('Project URL')).toBeNull();
    expect(screen.queryByLabelText('Anon public key')).toBeNull();
    expect(screen.queryByText(/supabase/i)).toBeNull();
  });
});
