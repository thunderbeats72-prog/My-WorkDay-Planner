import { useEffect, useRef, useState } from 'react';
import {
  Bell,
  CloudOff,
  Database,
  Download,
  KeyRound,
  LogOut,
  Moon,
  RefreshCw,
  Save,
  Shield,
  Sun,
  Upload,
} from 'lucide-react';
import type { Settings, Theme } from '../lib/types';
import { DAY_SHORT, DEFAULT_SETTINGS, PRIORITIES, PRIORITY_ORDER } from '../lib/types';
import { formatDuration, parseTimeToMinutes } from '../lib/dates';
import { GRAPH_SCOPES, graphRedirectUri } from '../lib/graph';
import type { GraphAccount } from '../lib/graph';
import type { CommonPageProps } from './pageProps';
import type { AccountApi } from '../hooks/useAccount';
import { AccountPanel } from './AccountPanel';
import { Badge, Button, ConfirmDialog, Field, Switch } from './ui';
import { canHaptic, haptic, hapticsEnabled, setHapticsEnabled } from '../lib/haptics';
import { PageHeader } from './Shell';

const WORKING_DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

export function SettingsPage({
  settings,
  addToast,
  onSaveSettings,
  onThemeChange,
  onExportBackup,
  onImportBackup,
  onExportCsv,
  onResetData,
  graph,
  notificationsPermission,
  onRequestNotifications,
  onSendTestNotification,
  account,
}: CommonPageProps & {
  onSaveSettings: (next: Settings) => void;
  /** Applies and persists one theme choice. Called before Save is pressed. */
  onThemeChange: (theme: Theme) => void;
  onExportBackup: () => void;
  onImportBackup: (file: File) => void;
  onExportCsv: () => void;
  onResetData: () => void;
  graph: {
    connected: boolean;
    account: GraphAccount | null;
    errors: string[];
    busy: boolean;
    onConnect: (clientId: string) => void;
    onDisconnect: () => void;
    onCheck: () => void;
  };
  notificationsPermission: string;
  onRequestNotifications: () => Promise<string>;
  onSendTestNotification: () => void;
  account: AccountApi;
}) {
  /** Phone buzz. Stored on this device only — it is a hardware preference. */
  const [buzz, setBuzz] = useState(() => hapticsEnabled());
  const [draft, setDraft] = useState<Settings>(settings);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [resetOpen, setResetOpen] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const backupInput = useRef<HTMLInputElement | null>(null);

  const previousSettings = useRef(settings);

  useEffect(() => {
    const previous = previousSettings.current;
    previousSettings.current = settings;
    setDraft((current) => {
      // A theme tap saves immediately in App. That must not throw away edits
      // the person has not pressed Save on yet: merge the one field in.
      const onlyThemeChanged =
        previous.theme !== settings.theme &&
        JSON.stringify({ ...settings, theme: previous.theme }) === JSON.stringify(previous);
      return onlyThemeChanged ? { ...current, theme: settings.theme } : settings;
    });
  }, [settings]);

  /**
   * Theme is the one setting that never waits for Save.
   *
   * A person tapping "Dark" expects the screen to go dark under their finger,
   * not after a 40-field form has been validated. So this writes through
   * immediately and mirrors the value into the draft so Save does not undo it.
   */
  const chooseTheme = (theme: Theme) => {
    setDraft((current) => ({ ...current, theme }));
    haptic('tap');
    onThemeChange(theme);
  };

  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);

  const validate = (candidate: Settings): Record<string, string> => {
    const next: Record<string, string> = {};
    const start = parseTimeToMinutes(candidate.workdayStart);
    const end = parseTimeToMinutes(candidate.workdayEnd);
    if (end <= start) next.workdayEnd = 'Workday end must be after the start — otherwise capacity would go negative.';
    if (candidate.workingDays.length === 0) next.workingDays = 'Choose at least one working day.';
    const lunchStart = parseTimeToMinutes(candidate.lunchStart);
    const lunchEnd = parseTimeToMinutes(candidate.lunchEnd);
    if (lunchEnd <= lunchStart) next.lunchEnd = 'Lunch end must be after lunch start.';
    if (lunchStart < start || lunchEnd > end) next.lunchStart = 'Lunch should sit inside your working hours.';
    if (candidate.focusBlockMinutes < 15 || candidate.focusBlockMinutes > 180) {
      next.focusBlockMinutes = 'Focus blocks must be between 15 and 180 minutes.';
    }
    if (candidate.bufferMinutes < 0 || candidate.bufferMinutes > 60) next.bufferMinutes = 'Buffers must be 0–60 minutes.';
    if (candidate.defaultEstimateMinutes < 5 || candidate.defaultEstimateMinutes > 480) {
      next.defaultEstimateMinutes = 'Default estimate must be 5–480 minutes.';
    }
    if (candidate.reminderLeadMinutes < 0 || candidate.reminderLeadMinutes > 1440) {
      next.reminderLeadMinutes = 'Reminder lead must be 0–1440 minutes.';
    }
    return next;
  };

  const save = () => {
    const nextErrors = validate(draft);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      addToast('Settings not saved — fix the highlighted fields.', 'warning');
      return;
    }
    onSaveSettings({ ...draft, id: 'app' });
    setSavedAt(new Date().toISOString());
    addToast('Settings saved on this device.', 'success');
  };

  const resetDefaults = () => {
    setDraft({ ...DEFAULT_SETTINGS, name: draft.name, graphClientId: draft.graphClientId, onboardingComplete: true });
    setErrors({});
    addToast('Defaults loaded into the form — press Save changes to apply.', 'info');
  };

  const workingMinutes =
    Math.max(0, parseTimeToMinutes(draft.workdayEnd) - parseTimeToMinutes(draft.workdayStart)) -
    Math.max(0, parseTimeToMinutes(draft.lunchEnd) - parseTimeToMinutes(draft.lunchStart));

  return (
    <div className="page settings-page">
      <PageHeader
        eyebrow="Local settings"
        title="Settings"
        description="Stored in this browser. An account can carry it to your other devices — nothing else leaves this machine."
        actions={
          <>
            <Button variant="ghost" onClick={resetDefaults}>
              Load defaults
            </Button>
            <Button variant="primary" icon={Save} onClick={save} disabled={!dirty}>
              Save changes
            </Button>
          </>
        }
      />

      <div className="settings-layout">
        <div className="settings-main">
          <AccountPanel account={account} addToast={addToast} />

          <section className="card settings-section">
            <h2>About you</h2>
            <div className="form-grid">
              <Field label="Name" htmlFor="settings-name">
                <input
                  id="settings-name"
                  className="input"
                  value={draft.name}
                  placeholder="Your name"
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
              </Field>
              <Field label="Role" htmlFor="settings-role">
                <input
                  id="settings-role"
                  className="input"
                  value={draft.role}
                  onChange={(event) => setDraft({ ...draft, role: event.target.value })}
                />
              </Field>
              <Field label="Company" htmlFor="settings-company" className="span-2">
                <input
                  id="settings-company"
                  className="input"
                  value={draft.company}
                  onChange={(event) => setDraft({ ...draft, company: event.target.value })}
                />
              </Field>
            </div>
          </section>

          <section className="card settings-section">
            <div className="section-head">
              <h2>Working rhythm</h2>
              <Badge tone="info">{formatDuration(workingMinutes)} capacity / working day</Badge>
            </div>
            <div className="form-grid">
              <Field label="Workday start" htmlFor="settings-start">
                <input
                  id="settings-start"
                  className="input"
                  type="time"
                  value={draft.workdayStart}
                  onChange={(event) => setDraft({ ...draft, workdayStart: event.target.value })}
                />
              </Field>
              <Field label="Workday end" htmlFor="settings-end" error={errors.workdayEnd}>
                <input
                  id="settings-end"
                  className={`input ${errors.workdayEnd ? 'invalid' : ''}`.trim()}
                  type="time"
                  value={draft.workdayEnd}
                  onChange={(event) => setDraft({ ...draft, workdayEnd: event.target.value })}
                />
              </Field>
              <Field label="Lunch start" htmlFor="settings-lunch-start" error={errors.lunchStart}>
                <input
                  id="settings-lunch-start"
                  className="input"
                  type="time"
                  value={draft.lunchStart}
                  onChange={(event) => setDraft({ ...draft, lunchStart: event.target.value })}
                />
              </Field>
              <Field label="Lunch end" htmlFor="settings-lunch-end" error={errors.lunchEnd}>
                <input
                  id="settings-lunch-end"
                  className="input"
                  type="time"
                  value={draft.lunchEnd}
                  onChange={(event) => setDraft({ ...draft, lunchEnd: event.target.value })}
                />
              </Field>
            </div>
            <Field label="Working days" error={errors.workingDays} hint="Lunch and buffers are protected on working days only.">
              <div className="day-picker">
                {WORKING_DAY_ORDER.map((day) => {
                  const checked = draft.workingDays.includes(day);
                  return (
                    <label key={day} className={`day-chip ${checked ? 'checked' : ''}`.trim()}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setDraft({
                            ...draft,
                            workingDays: checked
                              ? draft.workingDays.filter((value) => value !== day)
                              : [...draft.workingDays, day].sort((a, b) => a - b),
                          })
                        }
                      />
                      <span>{DAY_SHORT[day]}</span>
                    </label>
                  );
                })}
              </div>
            </Field>
          </section>

          <section className="card settings-section">
            <h2>Scheduling defaults</h2>
            <div className="form-grid">
              <Field label="Focus block (minutes)" htmlFor="settings-focus" error={errors.focusBlockMinutes} hint="Long tasks are split into focus-sized blocks.">
                <input
                  id="settings-focus"
                  className={`input ${errors.focusBlockMinutes ? 'invalid' : ''}`.trim()}
                  type="number"
                  min={15}
                  max={180}
                  step={5}
                  value={draft.focusBlockMinutes}
                  onChange={(event) => setDraft({ ...draft, focusBlockMinutes: Number(event.target.value) })}
                />
              </Field>
              <Field label="Buffer between blocks (minutes)" htmlFor="settings-buffer" error={errors.bufferMinutes}>
                <input
                  id="settings-buffer"
                  className={`input ${errors.bufferMinutes ? 'invalid' : ''}`.trim()}
                  type="number"
                  min={0}
                  max={60}
                  step={5}
                  value={draft.bufferMinutes}
                  onChange={(event) => setDraft({ ...draft, bufferMinutes: Number(event.target.value) })}
                />
              </Field>
              <Field label="Default priority" htmlFor="settings-priority">
                <select
                  id="settings-priority"
                  className="input"
                  value={draft.defaultPriority}
                  onChange={(event) => setDraft({ ...draft, defaultPriority: event.target.value as Settings['defaultPriority'] })}
                >
                  {PRIORITY_ORDER.map((priority) => (
                    <option key={priority} value={priority}>
                      {PRIORITIES[priority].label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Default estimate (minutes)" htmlFor="settings-estimate" error={errors.defaultEstimateMinutes}>
                <input
                  id="settings-estimate"
                  className={`input ${errors.defaultEstimateMinutes ? 'invalid' : ''}`.trim()}
                  type="number"
                  min={5}
                  max={480}
                  step={5}
                  value={draft.defaultEstimateMinutes}
                  onChange={(event) => setDraft({ ...draft, defaultEstimateMinutes: Number(event.target.value) })}
                />
              </Field>
            </div>
          </section>

          <section className="card settings-section">
            <div className="section-head">
              <h2>
                <Bell size={16} /> Reminders
              </h2>
              <Badge tone={notificationsPermission === 'granted' ? 'success' : 'neutral'}>
                {notificationsPermission === 'granted'
                  ? 'System alerts on'
                  : notificationsPermission === 'denied'
                    ? 'Blocked by browser'
                    : notificationsPermission === 'unsupported'
                      ? 'Not supported'
                      : 'Alerts off'}
              </Badge>
            </div>
            <div className="form-grid">
              <Field label="Remind me before a deadline (minutes)" htmlFor="settings-lead" error={errors.reminderLeadMinutes}>
                <input
                  id="settings-lead"
                  className={`input ${errors.reminderLeadMinutes ? 'invalid' : ''}`.trim()}
                  type="number"
                  min={0}
                  max={1440}
                  step={15}
                  value={draft.reminderLeadMinutes}
                  onChange={(event) => setDraft({ ...draft, reminderLeadMinutes: Number(event.target.value) })}
                />
              </Field>
            </div>
            <Switch
              checked={draft.quietHoursEnabled}
              onChange={(quietHoursEnabled) => setDraft({ ...draft, quietHoursEnabled })}
              label="Quiet hours"
              description="No browser notifications during these hours. In-app reminders stay visible."
            />
            {draft.quietHoursEnabled ? (
              <div className="form-grid compact-grid">
                <Field label="Quiet from" htmlFor="settings-quiet-start">
                  <input
                    id="settings-quiet-start"
                    className="input"
                    type="time"
                    value={draft.quietStart}
                    onChange={(event) => setDraft({ ...draft, quietStart: event.target.value })}
                  />
                </Field>
                <Field label="Quiet until" htmlFor="settings-quiet-end">
                  <input
                    id="settings-quiet-end"
                    className="input"
                    type="time"
                    value={draft.quietEnd}
                    onChange={(event) => setDraft({ ...draft, quietEnd: event.target.value })}
                  />
                </Field>
              </div>
            ) : null}
            <Switch
              checked={draft.notificationsEnabled && notificationsPermission === 'granted'}
              onChange={async (checked) => {
                if (checked) {
                  const permission = await onRequestNotifications();
                  if (permission !== 'granted') {
                    addToast('Browser permission was not granted. In-app reminders still work.', 'warning');
                    return;
                  }
                }
                setDraft({ ...draft, notificationsEnabled: checked });
              }}
              label="Desktop and phone notifications"
              description="Laptop and phone banners when a deadline is close. Alerts while the app is open, plus a best-effort background check on Android. In-app reminders always work."
              disabled={notificationsPermission === 'unsupported'}
            />
            {notificationsPermission === 'denied' ? (
              <p className="field-hint">
                Notifications are blocked in this browser’s site settings. Allow them there, then reload — this
                page cannot override it.
              </p>
            ) : null}
            {notificationsPermission === 'unsupported' ? (
              <p className="field-hint">This browser does not support system notifications. In-app reminders still work.</p>
            ) : null}
            <div className="settings-actions">
              {notificationsPermission === 'granted' ? (
                <Button variant="secondary" icon={Bell} onClick={onSendTestNotification}>
                  Send a test notification
                </Button>
              ) : notificationsPermission === 'default' ? (
                <Button
                  variant="primary"
                  icon={Bell}
                  onClick={() => {
                    void onRequestNotifications().then((permission) => {
                      if (permission === 'granted') onSendTestNotification();
                    });
                  }}
                >
                  Turn on notifications
                </Button>
              ) : null}
              <span className="field-hint">
                Nothing leaves this device: alerts are computed from your local tasks.
              </span>
            </div>
          </section>

          <section className="card settings-section">
            <h2>Appearance</h2>
            <div className="theme-choice" role="group" aria-label="Theme">
              <button
                type="button"
                className={`theme-option ${draft.theme === 'light' ? 'is-active' : ''}`.trim()}
                aria-pressed={draft.theme === 'light'}
                onClick={() => chooseTheme('light')}
              >
                <Sun size={17} aria-hidden="true" />
                <span>Light</span>
              </button>
              <button
                type="button"
                className={`theme-option ${draft.theme === 'dark' ? 'is-active' : ''}`.trim()}
                aria-pressed={draft.theme === 'dark'}
                onClick={() => chooseTheme('dark')}
              >
                <Moon size={17} aria-hidden="true" />
                <span>Dark</span>
              </button>
            </div>
            <p className="theme-note">
              {draft.theme === 'system'
                ? 'Following your system right now. Pick one and it applies straight away, on this device only.'
                : 'Applies straight away, on this device only.'}
            </p>
            {canHaptic() ? (
              <Switch
                checked={buzz}
                onChange={(enabled) => {
                  setBuzz(enabled);
                  setHapticsEnabled(enabled);
                  if (enabled) haptic('press');
                }}
                label="Haptics"
                description="A short buzz when you switch pages, add a task or finish one. This device only."
              />
            ) : (
              <p className="field-hint">This device cannot buzz. iPhones do not let a web page use haptics.</p>
            )}
          </section>

          <section className="card settings-section">
            <div className="section-head">
              <h2>
                <KeyRound size={16} /> Connected accounts
              </h2>
              {graph.connected ? <Badge tone="success">Microsoft connected</Badge> : <Badge tone="neutral">Not connected</Badge>}
            </div>
            <p className="muted">
              Optional and read-only. Paste your own free Azure App Registration Application (client) ID, then connect with
              Microsoft. OAuth 2.0 + PKCE runs in the browser — no client secret is stored.
            </p>
            <Field
              label="Application (client) ID"
              htmlFor="settings-graph"
              hint="Azure Portal → App registrations → your app → Overview. Add a Single-page application platform with the redirect URI below."
            >
              <input
                id="settings-graph"
                className="input mono"
                value={draft.graphClientId}
                placeholder="00000000-0000-0000-0000-000000000000"
                onChange={(event) => setDraft({ ...draft, graphClientId: event.target.value.trim() })}
              />
            </Field>
            <div className="redirect-box">
              <span>Redirect URI</span>
              <code>{graphRedirectUri()}</code>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(graphRedirectUri());
                    addToast('Redirect URI copied.', 'success');
                  } catch {
                    addToast('Copy failed — select the URI manually.', 'warning');
                  }
                }}
              >
                Copy
              </Button>
            </div>
            <p className="fine-print">Scopes: {GRAPH_SCOPES.join(', ')} · tokens live in session storage (~1 hour).</p>
            <div className="graph-actions">
              {graph.connected ? (
                <>
                  <Button variant="secondary" icon={RefreshCw} loading={graph.busy} onClick={graph.onCheck}>
                    Check Outlook &amp; Teams
                  </Button>
                  <Button variant="ghost" icon={LogOut} onClick={graph.onDisconnect}>
                    Disconnect
                  </Button>
                </>
              ) : (
                <Button
                  variant="primary"
                  icon={Shield}
                  onClick={() => graph.onConnect(draft.graphClientId.trim())}
                  disabled={!draft.graphClientId.trim()}
                >
                  Connect with Microsoft
                </Button>
              )}
            </div>
            {graph.account ? (
              <p className="fine-print">
                Connected as {graph.account.displayName || 'your account'}
                {graph.account.mail ? ` · ${graph.account.mail}` : ''}
              </p>
            ) : null}
            {graph.errors.length > 0 ? (
              <ul className="graph-errors">
                {graph.errors.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            ) : null}
            {!draft.graphClientId.trim() ? (
              <p className="field-hint">Graph stays fully off until a client ID is saved. The app is local-only by default.</p>
            ) : null}
          </section>

          <section className="card settings-section">
            <div className="section-head">
              <h2>
                <Database size={16} /> Your data
              </h2>
              <Badge tone="info">IndexedDB</Badge>
            </div>
            <p className="muted">
              Export a JSON backup before clearing browser data. CSV is for spreadsheets; JSON is the complete restore file.
            </p>
            <div className="data-actions">
              <Button variant="secondary" icon={Download} onClick={onExportBackup}>
                Export JSON backup
              </Button>
              <Button variant="secondary" icon={Download} onClick={onExportCsv}>
                Export tasks CSV
              </Button>
              <Button variant="secondary" icon={Upload} onClick={() => backupInput.current?.click()}>
                Import JSON backup
              </Button>
              <input
                ref={backupInput}
                type="file"
                accept="application/json,.json"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) onImportBackup(file);
                  event.target.value = '';
                }}
              />
            </div>
            <div className="danger-zone">
              <div>
                <h3>Reset local data</h3>
                <p className="muted">
                  Deletes tasks, sessions, reminders, history and settings from this browser. Export first — this cannot be
                  undone.
                </p>
              </div>
              <Button variant="danger" onClick={() => setResetOpen(true)}>
                Reset everything
              </Button>
            </div>
          </section>

          <section className="card settings-section">
            <h2>
              <CloudOff size={16} /> Honest limitations
            </h2>
            <ul className="limit-list">
              <li>Cloud sync is off in this copy, so the account lives on this device. Deploying with the database turns it on for every device at once — no keys to paste.</li>
              <li>Reminders in a closed browser are not guaranteed — this is a web app, not a native scheduler.</li>
              <li>OCR quality depends on screenshot clarity. Parsed dates are flagged and reviewed.</li>
              <li>IndexedDB can be cleared by the browser; export backups regularly.</li>
              <li>Microsoft Graph needs your own tenant and admin consent for chat scopes; errors are shown, never hidden.</li>
            </ul>
          </section>
        </div>

        <aside className="settings-side">
          <section className="card sticky-card">
            <h3>Save state</h3>
            <p className={dirty ? 'unsaved' : 'saved'}>{dirty ? 'Unsaved changes' : 'All changes saved'}</p>
            {savedAt ? <p className="fine-print">Last saved {new Date(savedAt).toLocaleTimeString()}</p> : null}
            <Button variant="primary" icon={Save} onClick={save} disabled={!dirty}>
              Save changes
            </Button>
            {Object.keys(errors).length > 0 ? (
              <div className="save-errors">
                {Object.entries(errors).map(([field, message]) => (
                  <p key={field} className="field-error">
                    {message}
                  </p>
                ))}
              </div>
            ) : null}
            <hr />
            <h3>At a glance</h3>
            <dl className="mini-dl">
              <div>
                <dt>Workday</dt>
                <dd>
                  {draft.workdayStart}–{draft.workdayEnd}
                </dd>
              </div>
              <div>
                <dt>Lunch</dt>
                <dd>
                  {draft.lunchStart}–{draft.lunchEnd}
                </dd>
              </div>
              <div>
                <dt>Working days</dt>
                <dd>{draft.workingDays.map((day) => DAY_SHORT[day]).join(', ') || 'None'}</dd>
              </div>
              <div>
                <dt>Capacity</dt>
                <dd>{formatDuration(workingMinutes)}/day</dd>
              </div>
              <div>
                <dt>Theme</dt>
                <dd>{draft.theme === 'system' ? 'System' : draft.theme === 'dark' ? 'Dark' : 'Light'}</dd>
              </div>
              <div>
                <dt>Sync</dt>
                <dd>Not configured</dd>
              </div>
            </dl>
          </section>
        </aside>
      </div>

      <ConfirmDialog
        open={resetOpen}
        title="Delete all local data?"
        message={
          <p>
            This permanently removes every task, timer session and setting from the <code>bd-command-center</code>{' '}
            IndexedDB database in this browser. Export a backup first. This cannot be undone.
          </p>
        }
        confirmLabel="Delete everything"
        onCancel={() => setResetOpen(false)}
        onConfirm={() => {
          setResetOpen(false);
          onResetData();
        }}
      />
    </div>
  );
}
