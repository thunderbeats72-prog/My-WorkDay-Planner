import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Onboarding } from './Onboarding';
import type { AccountApi } from '../hooks/useAccount';
import type { StoredAccount } from '../lib/accounts';

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

const signedIn: StoredAccount = {
  id: 'lakshit',
  displayName: 'Lakshit',
  salt: 'a'.repeat(32),
  hash: 'b'.repeat(64),
  iterations: 210_000,
  createdAt: '2026-01-01T00:00:00.000Z',
  lastLoginAt: '2026-01-02T00:00:00.000Z',
};

describe('Onboarding — account step', () => {
  it('asks for an account first, before any of the setup questions', () => {
    render(<Onboarding onComplete={vi.fn()} account={fakeAccount()} />);

    expect(screen.getByText('Step 1 of 4')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Sign in, or start fresh' })).toBeTruthy();
    expect(screen.getByLabelText('User ID')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Create account' })).toBeTruthy();
    // Setup questions must not be visible yet.
    expect(screen.queryByLabelText('Your name')).toBeNull();
  });

  it('creates the account from inside onboarding', async () => {
    const account = fakeAccount();
    render(<Onboarding onComplete={vi.fn()} account={account} />);

    await userEvent.click(screen.getByRole('tab', { name: 'Create account' }));
    await userEvent.type(screen.getByLabelText('User ID'), 'lakshit');
    await userEvent.type(screen.getByLabelText('Password'), 'open sesame 72');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'open sesame 72');
    await userEvent.click(screen.getByRole('button', { name: /Create account/ }));

    expect(account.signUp).toHaveBeenCalledWith('lakshit', 'open sesame 72', '');
  });

  it('signs in with an existing account, which is how a new device gets its data', async () => {
    const account = fakeAccount();
    render(<Onboarding onComplete={vi.fn()} account={account} />);

    await userEvent.type(screen.getByLabelText('User ID'), 'lakshit');
    await userEvent.type(screen.getByLabelText('Password'), 'open sesame 72');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(account.signIn).toHaveBeenCalledWith('lakshit', 'open sesame 72');
  });

  it('shows the signed-in user and lets setup continue', async () => {
    const onComplete = vi.fn();
    render(<Onboarding onComplete={onComplete} account={fakeAccount({ account: signedIn })} />);

    expect(screen.getAllByText(/@lakshit/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Signed in on this device/)).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('Step 2 of 4')).toBeTruthy();
  });

  it('tells the truth when no sync project is connected', () => {
    render(<Onboarding onComplete={vi.fn()} account={fakeAccount()} />);
    expect(screen.getByText(/the login stays on this device/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Set up sync' })).toBeTruthy();
  });

  it('offers the two-minute sync setup without leaving onboarding', async () => {
    const account = fakeAccount();
    render(<Onboarding onComplete={vi.fn()} account={account} />);

    await userEvent.click(screen.getByRole('button', { name: 'Set up sync' }));
    await userEvent.type(screen.getByLabelText('Project URL'), 'https://abcd1234.supabase.co');
    await userEvent.type(screen.getByLabelText('Anon public key'), 'k'.repeat(40));
    await userEvent.click(screen.getByRole('button', { name: 'Connect sync' }));

    expect(account.connectCloud).toHaveBeenCalledWith('https://abcd1234.supabase.co', 'k'.repeat(40));
  });

  it('confirms sync is on when the deployment supplies a project', () => {
    render(
      <Onboarding onComplete={vi.fn()} account={fakeAccount({ account: signedIn, cloudConfigured: true, cloudConnected: true })} />,
    );
    expect(screen.getAllByText(/Sync is on/).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Set up sync' })).toBeNull();
  });

  it('still allows skipping the account entirely', async () => {
    render(<Onboarding onComplete={vi.fn()} account={fakeAccount()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Continue without an account' }));
    expect(screen.getByLabelText('Your name')).toBeTruthy();
  });
});
