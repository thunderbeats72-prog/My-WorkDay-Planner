import { useId, useState } from 'react';
import { ArrowRight, Eye, EyeOff, Lock, LogIn, UserRound } from 'lucide-react';
import type { AccountApi } from '../hooks/useAccount';
import type { AddToast } from './pageProps';

/**
 * The sign-in / create-account form, in one place.
 *
 * Onboarding and Settings both need it, and two copies of an auth form drift
 * within a release — one gets the lockout message, the other does not. The only
 * difference between the two uses is the wording around it.
 */
export function AuthForm({
  account,
  addToast,
  onSignedIn,
  autoFocus = false,
  compact = false,
}: {
  account: AccountApi;
  addToast?: AddToast;
  onSignedIn?: (mode: 'signin' | 'signup') => void;
  autoFocus?: boolean;
  compact?: boolean;
}) {
  const idBase = useId();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);

  const switchMode = (next: 'signin' | 'signup') => {
    setMode(next);
    setError(null);
  };

  const fail = (message: string) => {
    setError(message);
    // Re-triggers the nudge animation; a key is cheaper than a class toggle race.
    setShake((count) => count + 1);
  };

  const submit = async () => {
    setError(null);
    if (mode === 'signup' && password !== confirm) {
      fail('The two passwords do not match.');
      return;
    }
    if (!userId.trim()) {
      fail('Choose a user ID first.');
      return;
    }
    if (!password) {
      fail('Enter your password.');
      return;
    }

    const result =
      mode === 'signup'
        ? await account.signUp(userId, password, displayName)
        : await account.signIn(userId, password);

    if (!result.ok) {
      fail(result.error ?? 'That did not work.');
      return;
    }

    // Signing in succeeds locally even when the sync project refuses; say so
    // rather than letting someone believe both devices now match.
    if (result.error) addToast?.(`Signed in on this device — ${result.error}`, 'warning');
    else addToast?.(mode === 'signup' ? 'Account created. Welcome in.' : 'Signed in.', 'success');

    setPassword('');
    setConfirm('');
    onSignedIn?.(mode);
  };

  const ready = userId.trim().length > 0 && password.length >= (mode === 'signup' ? 8 : 1);

  return (
    <form
      className={`auth-form ${compact ? 'is-compact' : ''}`.trim()}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="auth-tabs" role="tablist" aria-label="Sign in or create an account">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'signin'}
          className={`auth-tab ${mode === 'signin' ? 'is-active' : ''}`}
          onClick={() => switchMode('signin')}
        >
          Sign in
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'signup'}
          className={`auth-tab ${mode === 'signup' ? 'is-active' : ''}`}
          onClick={() => switchMode('signup')}
        >
          Create account
        </button>
      </div>

      <div className="auth-fields">
        <div className="auth-input-wrap">
          <UserRound size={15} className="auth-input-icon" aria-hidden="true" />
          <input
            id={`${idBase}-user`}
            className="input auth-input"
            aria-label="User ID"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus={autoFocus}
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
            placeholder="User ID"
          />
        </div>

        <div className="auth-input-wrap">
          <Lock size={15} className="auth-input-icon" aria-hidden="true" />
          <input
            id={`${idBase}-pass`}
            className="input auth-input has-trailing"
            aria-label="Password"
            type={reveal ? 'text' : 'password'}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={mode === 'signup' ? 'Password — at least 8 characters' : 'Password'}
          />
          <button
            type="button"
            className="auth-reveal"
            aria-label={reveal ? 'Hide password' : 'Show password'}
            aria-pressed={reveal}
            onClick={() => setReveal((value) => !value)}
          >
            {reveal ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>

        {mode === 'signup' ? (
          <>
            <div className="auth-input-wrap">
              <Lock size={15} className="auth-input-icon" aria-hidden="true" />
              <input
                id={`${idBase}-confirm`}
                className="input auth-input"
                aria-label="Confirm password"
                type={reveal ? 'text' : 'password'}
                autoComplete="new-password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                placeholder="Confirm password"
              />
            </div>
            <div className="auth-input-wrap">
              <UserRound size={15} className="auth-input-icon" aria-hidden="true" />
              <input
                id={`${idBase}-name`}
                className="input auth-input"
                aria-label="Your name"
                autoComplete="name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="Your name (optional)"
              />
            </div>
          </>
        ) : null}
      </div>

      {error ? (
        <p className="auth-error" role="alert" key={shake}>
          {error}
        </p>
      ) : null}

      <button type="submit" className="auth-submit" disabled={account.busy || !ready}>
        <span>{mode === 'signup' ? 'Create my account' : 'Sign in'}</span>
        {account.busy ? <span className="auth-spinner" aria-hidden="true" /> : <ArrowRight size={16} aria-hidden="true" />}
      </button>

      <p className="auth-footnote">
        {mode === 'signup' ? (
          <>
            Your password is scrambled with <strong>PBKDF2</strong> on this device and never stored as text.
          </>
        ) : (
          <>
            <LogIn size={12} aria-hidden="true" /> Signing in on a second device brings its tasks across.
          </>
        )}
      </p>
    </form>
  );
}
