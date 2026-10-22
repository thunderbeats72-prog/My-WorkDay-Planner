import { useId, useState } from 'react';
import { Cloud, KeyRound, LogOut, RefreshCw, Trash2, UserRound } from 'lucide-react';
import { Button, Field } from './ui';
import { AuthForm } from './AuthForm';
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
  const [error, setError] = useState<string | null>(null);
  const [openPanel, setOpenPanel] = useState<'password' | 'delete' | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [nextPassword, setNextPassword] = useState('');
  const [deletePassword, setDeletePassword] = useState('');

  const signedIn = account.account !== null;

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
        <AuthForm
          account={account}
          addToast={addToast}
          onSignedIn={() => setOpenPanel(null)}
        />
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
                {account.syncBuiltIn
                  ? account.cloudConnected
                    ? `Synced automatically${account.lastSyncedAt ? ` · last sync ${new Date(account.lastSyncedAt).toLocaleTimeString()}` : ''}`
                    : 'Built into this deployment — sign in above to use it.'
                  : !account.cloudConfigured
                    ? 'Not configured in this copy — tasks live in this browser only. Deploy with the database and it turns on by itself, with nothing to paste here.'
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
                  {account.syncBuiltIn ? null : (
                    <Button variant="ghost" onClick={account.disconnectCloud}>
                      Disconnect
                    </Button>
                  )}
                </>
              ) : account.syncBuiltIn ? (
                <span className="account-state is-on">
                  <Cloud size={13} aria-hidden="true" />
                  Sync built in
                </span>
              ) : (
                <span className="account-state account-state-off">
                  <Cloud size={13} aria-hidden="true" />
                  Local only
                </span>
              )}
            </div>
          </div>

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
