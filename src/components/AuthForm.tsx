import { useId, useState } from 'react';
import { LogIn, ShieldCheck } from 'lucide-react';
import { Button, Field } from './ui';
import type { AccountApi } from '../hooks/useAccount';
import type { AddToast } from './pageProps';

/**
 * The sign-in / create-account form, in one place.
 *
 * Onboarding and Settings both need it, and two copies of an auth form drift
 * within a release — one gets the lockout message, the other does not. The only
 * difference between the two uses is the wording above and below it.
 */
export function AuthForm({
  account,
  addToast,
  onSignedIn,
  onModeChange,
  autoFocus = false,
}: {
  account: AccountApi;
  addToast?: AddToast;
  onSignedIn?: (mode: 'signin' | 'signup') => void;
  onModeChange?: (mode: 'signin' | 'signup') => void;
  autoFocus?: boolean;
}) {
  const idBase = useId();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const switchMode = (next: 'signin' | 'signup') => {
    setMode(next);
    setError(null);
    onModeChange?.(next);
  };

  const submit = async () => {
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

    // Sign-in succeeds locally even if the sync project refuses; say so instead
    // of letting the user believe both devices now match.
    if (result.error) addToast?.(`Signed in on this device — sync says: ${result.error}`, 'warning');
    else addToast?.(mode === 'signup' ? 'Account created on this device.' : 'Signed in.', 'success');

    setPassword('');
    setConfirm('');
    onSignedIn?.(mode);
  };

  return (
    <form
      className="account-form"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="account-tabs" role="tablist" aria-label="Sign in or create an account">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'signin'}
          className={`account-tab ${mode === 'signin' ? 'is-active' : ''}`}
          onClick={() => switchMode('signin')}
        >
          Sign in
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'signup'}
          className={`account-tab ${mode === 'signup' ? 'is-active' : ''}`}
          onClick={() => switchMode('signup')}
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
            autoFocus={autoFocus}
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

        <Field
          label="Password"
          htmlFor={`${idBase}-pass`}
          hint={mode === 'signup' ? 'At least 8 characters.' : undefined}
        >
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
            ? 'The password is hashed on this device with PBKDF2 and never sent anywhere in the clear.'
            : 'Signing in on your other device brings its tasks across when sync is on.'}
        </p>
      </div>
    </form>
  );
}
