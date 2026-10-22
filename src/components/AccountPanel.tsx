import { useId, useState } from 'react';
import { Cloud, KeyRound, LogIn, LogOut, RefreshCw, ShieldCheck, Trash2, UserRound } from 'lucide-react';
import { Button, Field } from './ui';
import type { AccountApi } from '../hooks/useAccount';
import type { AddToast } from './pageProps';

/**
 * Account, in Settings.
 *
 * Two honest states: either this device is the whole story (local account), or
 * a sync project has been connected and the same login follows you to a phone.
 * The panel never claims the second one until it is true.
 */
export function AccountPanel({ account, addToast }: { account: AccountApi; addToast: AddToast }) {
  const idBase = useId();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [openPanel, setOpenPanel] = useState<'password' | 'delete' | 'cloud' | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [nextPassword, setNextPassword] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [cloudUrl, setCloudUrl] = useState('');
  const [cloudKey, setCloudKey] = useState('');

  const signedIn = account.account !== null;

  const submitAuth = async () => {
    setError(null);
    if (mode === 'signup' && password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    const result =
      mode === 'signup'
        ? await account.signUp(userId, password, displayName)
        : await account.signIn(userId, password);

    if (!result.ok) {
      setError(result.error ?? 'That did not work.');
      return;
    }
    // A sign-in can succeed locally but fail to reach the sync project; that is
    // worth saying out loud rather than pretending everything synced.
    if (result.error) addToast(`Signed in on this device — sync says: ${result.error}`, 'warning');
    else addToast(mode === 'signup' ? 'Account created on this device.' : 'Signed in.', 'success');
    setPassword('');
    setConfirm('');
  };

  const sync = async () => {
    const result = await account.syncNow();
    addToast(result.message, result.ok ? 'success' : 'warning');
  };

  return (
    <section className="card settings-section account-section">
      <div className="section-head">
        <div>
          <h2>Account</h2>
          <p className="section-sub">
            {signedIn
              ? 'Your user ID and password work on any device once sync is connected.'
              : 'A user ID and password, kept on this device. No email, no sign-up email, no server.'}
          </p>
        </div>
        <span className={`account-state ${signedIn ? 'is-on' : ''}`}>
          <UserRound size={13} aria-hidden="true" />
          {signedIn ? `@${account.account?.id}` : 'Not signed in'}
        </span>
      </div>

      {!signedIn ? (
        <form
          className="account-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submitAuth();
          }}
        >
          <div className="account-tabs" role="tablist" aria-label="Sign in or create an account">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'signin'}
              className={`account-tab ${mode === 'signin' ? 'is-active' : ''}`}
              onClick={() => {
                setMode('signin');
                setError(null);
              }}
            >
              Sign in
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'signup'}
              className={`account-tab ${mode === 'signup' ? 'is-active' : ''}`}
              onClick={() => {
                setMode('signup');
                setError(null);
              }}
            >
              Create account
            </button>
          </div>

          <div className="account-fields">
            <Field label="User ID" htmlFor={`${idBase}-user`} hint="Letters, numbers, dots, dashes. Case does not matter.">
              <input
                id={`${idBase}-user`}
                className="input"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                value={userId}
                onChange={(event) => setUserId(event.target.value)}
                placeholder="lakshit"
              />
            </Field>

            {mode === 'signup' ? (
              <Field label="Your name" htmlFor={`${idBase}-name`} hint="Optional — shown on your own screens only.">
                <input
                  id={`${idBase}-name`}
                  className="input"
                  autoComplete="name"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="Lakshit"
                />
              </Field>
            ) : null}

            <Field label="Password" htmlFor={`${idBase}-pass`} hint={mode === 'signup' ? 'At least 8 characters.' : undefined}>
              <input
                id={`${idBase}-pass`}
                className="input"
                type="password"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••"
              />
            </Field>

            {mode === 'signup' ? (
              <Field label="Confirm password" htmlFor={`${idBase}-confirm`}>
                <input
                  id={`${idBase}-confirm`}
                  className="input"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  placeholder="••••••••"
                />
              </Field>
            ) : null}
          </div>

          {error ? (
            <p className="account-error" role="alert">
              {error}
            </p>
          ) : null}

          <div className="account-actions">
            <Button variant="primary" icon={mode === 'signup' ? ShieldCheck : LogIn} type="submit" loading={account.busy}>
              {mode === 'signup' ? 'Create account' : 'Sign in'}
            </Button>
            <p className="account-fine">
              {mode === 'signup'
                ? 'The password is hashed on this device with PBKDF2 and never leaves it.'
                : 'Your tasks stay on this device whether or not you sign in.'}
            </p>
          </div>
        </form>
      ) : (
        <>
          <div className="account-row">
            <div>
              <p className="account-row-title">
                Signed in as <strong>@{account.account?.id}</strong>
              </p>
              <p className="account-row-sub">
                {account.account?.displayName} · {account.account?.lastLoginAt ? 'last sign-in just now' : 'this device'}
                {account.cloudConnected ? ' · sync connected' : ' · this device only'}
              </p>
            </div>
            <Button variant="ghost" icon={LogOut} onClick={account.signOut}>
              Sign out
            </Button>
          </div>

          <div className="account-row">
            <div>
              <p className="account-row-title">Sync across devices</p>
              <p className="account-row-sub">
                {!account.cloudConfigured
                  ? 'Not connected. Tasks live in this browser only.'
                  : account.cloudConnected
                    ? `Connected${account.lastSyncedAt ? ` · last sync ${new Date(account.lastSyncedAt).toLocaleTimeString()}` : ''}`
                    : 'Project connected, but this session is not signed in to it yet.'}
              </p>
            </div>
            <div className="account-row-actions">
              {account.cloudConfigured ? (
                <>
                  <Button variant="secondary" icon={RefreshCw} onClick={() => void sync()} loading={account.busy}>
                    Sync now
                  </Button>
                  <Button variant="ghost" onClick={account.disconnectCloud}>
                    Disconnect
                  </Button>
                </>
              ) : (
                <Button
                  variant="secondary"
                  icon={Cloud}
                  onClick={() => setOpenPanel(openPanel === 'cloud' ? null : 'cloud')}
                >
                  Use on phone and laptop
                </Button>
              )}
            </div>
          </div>

          {openPanel === 'cloud' && !account.cloudConfigured ? (
            <div className="account-subpanel">
              <p className="account-subpanel-lead">
                Sync needs somewhere both devices can reach. A free Supabase project costs nothing and takes about two
                minutes — paste its URL and public key here, once.
              </p>
              <ol className="account-steps">
                <li>
                  Create a project at <span className="mono">supabase.com</span> (free tier).
                </li>
                <li>
                  In the SQL editor, run the setup in <span className="mono">supabase/schema.sql</span> from this repo —
                  it creates one table and locks it to your own user.
                </li>
                <li>
                  Turn off <em>Confirm email</em> under Authentication → Providers → Email, so a user ID can sign in
                  without an inbox.
                </li>
                <li>
                  Copy <span className="mono">Project URL</span> and the <span className="mono">anon public</span> key from
                  Project Settings → API.
                </li>
              </ol>
              <div className="account-fields">
                <Field label="Project URL" htmlFor={`${idBase}-cloud-url`}>
                  <input
                    id={`${idBase}-cloud-url`}
                    className="input"
                    value={cloudUrl}
                    onChange={(event) => setCloudUrl(event.target.value)}
                    placeholder="https://abcd1234.supabase.co"
                    spellCheck={false}
                  />
                </Field>
                <Field label="Anon public key" htmlFor={`${idBase}-cloud-key`}>
                  <input
                    id={`${idBase}-cloud-key`}
                    className="input"
                    value={cloudKey}
                    onChange={(event) => setCloudKey(event.target.value)}
                    placeholder="eyJhbGciOi…"
                    spellCheck={false}
                  />
                </Field>
              </div>
              {error ? (
                <p className="account-error" role="alert">
                  {error}
                </p>
              ) : null}
              <div className="account-actions">
                <Button
                  variant="primary"
                  icon={Cloud}
                  loading={account.busy}
                  onClick={async () => {
                    setError(null);
                    const result = await account.connectCloud(cloudUrl, cloudKey);
                    if (!result.ok) {
                      setError(result.error ?? 'Could not connect.');
                      return;
                    }
                    addToast('Sync connected. Sign in again to link this device.', 'success');
                    setOpenPanel(null);
                  }}
                >
                  Connect sync
                </Button>
                <p className="account-fine">The key is stored in this browser only, never in the app bundle.</p>
              </div>
            </div>
          ) : null}

          <div className="account-row account-row-danger">
            <div>
              <p className="account-row-title">Password and account</p>
              <p className="account-row-sub">Changing the password re-hashes it here. Deleting the account keeps your tasks.</p>
            </div>
            <div className="account-row-actions">
              <Button
                variant="ghost"
                icon={KeyRound}
                onClick={() => setOpenPanel(openPanel === 'password' ? null : 'password')}
              >
                Change password
              </Button>
              <Button
                variant="ghost"
                icon={Trash2}
                onClick={() => setOpenPanel(openPanel === 'delete' ? null : 'delete')}
              >
                Delete account
              </Button>
            </div>
          </div>

          {openPanel === 'password' ? (
            <div className="account-subpanel">
              <div className="account-fields">
                <Field label="Current password" htmlFor={`${idBase}-cur`}>
                  <input
                    id={`${idBase}-cur`}
                    className="input"
                    type="password"
                    autoComplete="current-password"
                    value={currentPassword}
                    onChange={(event) => setCurrentPassword(event.target.value)}
                  />
                </Field>
                <Field label="New password" htmlFor={`${idBase}-next`}>
                  <input
                    id={`${idBase}-next`}
                    className="input"
                    type="password"
                    autoComplete="new-password"
                    value={nextPassword}
                    onChange={(event) => setNextPassword(event.target.value)}
                  />
                </Field>
              </div>
              {error ? (
                <p className="account-error" role="alert">
                  {error}
                </p>
              ) : null}
              <div className="account-actions">
                <Button
                  variant="primary"
                  icon={KeyRound}
                  onClick={async () => {
                    setError(null);
                    const result = await account.changePassword(currentPassword, nextPassword);
                    if (!result.ok) {
                      setError(result.error ?? 'Could not change the password.');
                      return;
                    }
                    addToast('Password changed.', 'success');
                    setCurrentPassword('');
                    setNextPassword('');
                    setOpenPanel(null);
                  }}
                >
                  Save new password
                </Button>
              </div>
            </div>
          ) : null}

          {openPanel === 'delete' ? (
            <div className="account-subpanel">
              <p className="account-subpanel-lead">
                This removes the login from this device. Your tasks, timers and reports stay exactly where they are.
              </p>
              <div className="account-fields">
                <Field label="Password" htmlFor={`${idBase}-del`}>
                  <input
                    id={`${idBase}-del`}
                    className="input"
                    type="password"
                    autoComplete="current-password"
                    value={deletePassword}
                    onChange={(event) => setDeletePassword(event.target.value)}
                  />
                </Field>
              </div>
              {error ? (
                <p className="account-error" role="alert">
                  {error}
                </p>
              ) : null}
              <div className="account-actions">
                <Button
                  variant="danger"
                  icon={Trash2}
                  onClick={async () => {
                    setError(null);
                    const result = await account.removeAccount(deletePassword);
                    if (!result.ok) {
                      setError(result.error ?? 'Could not delete the account.');
                      return;
                    }
                    setDeletePassword('');
                    setOpenPanel(null);
                  }}
                >
                  Delete this account
                </Button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
