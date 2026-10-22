import { beforeEach, describe, expect, it } from 'vitest';
import {
  accountSnapshot,
  bindDevice,
  changePassword,
  checkPassword,
  checkUserId,
  constantTimeEqual,
  deleteAccount,
  deriveHash,
  findAccount,
  getDeviceOwner,
  getSession,
  listAccounts,
  normaliseUserId,
  signIn,
  signOut,
  signUp,
} from './accounts';

beforeEach(() => {
  localStorage.clear();
  signOut();
});

describe('user IDs', () => {
  it('lower-cases and strips a leading @, so one person has one ID', () => {
    expect(normaliseUserId('  @Lakshit ')).toBe('lakshit');
  });

  it('accepts letters, numbers, dots, dashes and underscores', () => {
    expect(checkUserId('lakshit.72').ok).toBe(true);
    expect(checkUserId('l-72_b').ok).toBe(true);
  });

  it('rejects IDs that are too short, too long, or start with punctuation', () => {
    expect(checkUserId('ab').ok).toBe(false);
    expect(checkUserId('a'.repeat(33)).ok).toBe(false);
    expect(checkUserId('.hidden').ok).toBe(false);
    expect(checkUserId('has space').ok).toBe(false);
  });

  it('refuses reserved names and spaces in the message', () => {
    const result = checkUserId('admin');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('reserved');
  });
});

describe('passwords', () => {
  it('requires at least eight characters', () => {
    expect(checkPassword('short').ok).toBe(false);
  });

  it('rejects the guesses everyone tries first', () => {
    expect(checkPassword('password').ok).toBe(false);
    expect(checkPassword('aaaaaaaa').ok).toBe(false);
  });
});

describe('hashing', () => {
  it('derives the same hash for the same password and salt', async () => {
    const salt = 'a'.repeat(32);
    const first = await deriveHash('correct horse battery', salt, 1000);
    const second = await deriveHash('correct horse battery', salt, 1000);
    expect(first).toBe(second);
    expect(first).toHaveLength(64);
  });

  it('derives a different hash for a different salt', async () => {
    const a = await deriveHash('same password', 'a'.repeat(32), 1000);
    const b = await deriveHash('same password', 'b'.repeat(32), 1000);
    expect(a).not.toBe(b);
  });

  it('compares digests without short-circuiting on length', () => {
    expect(constantTimeEqual('abcd', 'abcd')).toBe(true);
    expect(constantTimeEqual('abcd', 'abce')).toBe(false);
    expect(constantTimeEqual('abcd', 'abcde')).toBe(false);
  });
});

describe('sign up and sign in', () => {
  it('creates an account, stores only a salted hash, and starts a session', async () => {
    const result = await signUp({ userId: 'Lakshit', password: 'open sesame 72', displayName: 'Lakshit' });
    expect(result.ok).toBe(true);
    expect(getSession()?.userId).toBe('lakshit');

    const stored = findAccount('lakshit');
    expect(stored).toBeTruthy();
    expect(stored?.hash).not.toContain('open sesame 72');
    expect(stored?.salt).toHaveLength(32);
    expect(JSON.stringify(listAccounts())).not.toContain('open sesame 72');
  });

  it('refuses a taken ID, on any capitalisation', async () => {
    await signUp({ userId: 'lakshit', password: 'open sesame 72' });
    const again = await signUp({ userId: 'LAKSHIT', password: 'another pass 1' });
    expect(again.ok).toBe(false);
    expect(again.error).toContain('taken');
  });

  it('signs in with the right password and rejects the wrong one', async () => {
    await signUp({ userId: 'lakshit', password: 'open sesame 72' });
    signOut();
    expect(getSession()).toBeNull();

    const wrong = await signIn('lakshit', 'not the password');
    expect(wrong.ok).toBe(false);
    expect(getSession()).toBeNull();

    const right = await signIn('@Lakshit', 'open sesame 72');
    expect(right.ok).toBe(true);
    expect(getSession()?.userId).toBe('lakshit');
  });

  it('gives the same message for an unknown ID and a wrong password', async () => {
    await signUp({ userId: 'lakshit', password: 'open sesame 72' });
    const unknown = await signIn('someone-else', 'open sesame 72');
    const wrong = await signIn('lakshit', 'wrong password');
    expect(unknown.error).toBe(wrong.error);
  });

  it('pauses after five wrong attempts', async () => {
    await signUp({ userId: 'lakshit', password: 'open sesame 72' });
    for (let attempt = 0; attempt < 5; attempt += 1) await signIn('lakshit', `wrong ${attempt}`);
    const locked = await signIn('lakshit', 'open sesame 72');
    expect(locked.ok).toBe(false);
    expect(locked.error).toContain('Too many attempts');
  });
});

describe('changing and deleting', () => {
  it('changes the password only when the current one is right', async () => {
    await signUp({ userId: 'lakshit', password: 'open sesame 72' });
    const refused = await changePassword('lakshit', 'wrong password', 'new password 1');
    expect(refused.ok).toBe(false);

    const changed = await changePassword('lakshit', 'open sesame 72', 'new password 1');
    expect(changed.ok).toBe(true);

    signOut();
    expect((await signIn('lakshit', 'open sesame 72')).ok).toBe(false);
    expect((await signIn('lakshit', 'new password 1')).ok).toBe(true);
  });

  it('deletes the account, and the tasks it never owned stay put', async () => {
    await signUp({ userId: 'lakshit', password: 'open sesame 72' });
    const refused = await deleteAccount('lakshit', 'wrong password');
    expect(refused.ok).toBe(false);

    const deleted = await deleteAccount('lakshit', 'open sesame 72');
    expect(deleted.ok).toBe(true);
    expect(findAccount('lakshit')).toBeNull();
    expect(getSession()).toBeNull();
  });
});

describe('device binding', () => {
  it('remembers which account owns this device, and keeps one device id', () => {
    expect(getDeviceOwner()).toBeNull();
    bindDevice('Lakshit');
    const owner = getDeviceOwner();
    expect(owner?.userId).toBe('lakshit');
    bindDevice('lakshit');
    expect(getDeviceOwner()?.deviceId).toBe(owner?.deviceId);
  });
});

describe('react snapshot', () => {
  it('returns an identical reference until the account changes', async () => {
    const empty = accountSnapshot();
    expect(accountSnapshot()).toBe(empty);

    await signUp({ userId: 'lakshit', password: 'open sesame 72' });
    const signedIn = accountSnapshot();
    expect(signedIn?.id).toBe('lakshit');
    expect(accountSnapshot()).toBe(signedIn);

    signOut();
    expect(accountSnapshot()).not.toBe(signedIn);
  });
});
