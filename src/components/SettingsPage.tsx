import { useEffect, useRef, useState } from 'react';
import {
  Bell,
  CloudOff,
  Database,
  Download,
  KeyRound,
  Lock,
  LogOut,
  Moon,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Shield,
  Sun,
  Trash2,
  Upload,
  Mic,
} from 'lucide-react';
import type { Settings, Theme } from '../lib/types';
import {
  CATEGORY_ORDER,
  DAY_SHORT,
  DEFAULT_SETTINGS,
  MAX_CUSTOM_CATEGORIES,
  PRIORITIES,
  PRIORITY_ORDER,
  normaliseCustomCategory,
} from '../lib/types';
import { formatDuration, parseTimeToMinutes } from '../lib/dates';
import { validTimeZone } from '../lib/reminderSchedule';
import type { BackgroundPushStatus } from '../lib/pushClient';
import { GRAPH_SCOPES, graphRedirectUri } from '../lib/graph';
import type { GraphAccount } from '../lib/graph';
import type { CommonPageProps } from './pageProps';
import type { AccountApi } from '../hooks/useAccount';
import { AccountPanel } from './AccountPanel';
import { Badge, Button, CategoryBadge, ConfirmDialog, Field, Switch } from './ui';
import { canHaptic, haptic, hapticsEnabled, setHapticsEnabled } from '../lib/haptics';
import {
  DICTATION_LANGUAGES,
  deviceLanguage,
  dictationLanguageLabel,
  dictationSupported,
  resolveDictationLang,
} from '../lib/speech';
import { PageHeader } from './Shell';

const WORKING_DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

export function SettingsPage({
  tasks,
  settings,
  addToast,
  onSaveSettings,
  onThemeChange,
  onExportBackup,
  onImportBackup,
  onExportCsv,
  onExportIcs,
  onResetData,
  onAddCategory,
  onRenameCategory,
  onDeleteCategory,
  graph,
  notificationsPermission,
  onRequestNotifications,
  onSendTestNotification,
  backgroundStatus,
  account,
}: CommonPageProps & {
  onSaveSettings: (next: Settings) => void;
  /** Applies and persists one theme choice. Called before Save is pressed. */
  onThemeChange: (theme: Theme) => void;
  onExportBackup: () => void;
  onImportBackup: (file: File) => void;
  onExportCsv: () => void;
  onExportIcs: () => void;
  onResetData: () => void;
  /** Returns an error message, or null when the category was added. */
  onAddCategory: (name: string) => string | null;
  /** Renaming rewrites the tasks already filed under the old name. */
  onRenameCategory: (from: string, to: string) => Promise<string | null>;
  /** Returns how many tasks were moved to “Other”. */
  onDeleteCategory: (name: string) => Promise<number>;
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
  backgroundStatus?: BackgroundPushStatus;
  account: AccountApi;
}) {
  /** Phone buzz. Stored on this device only — it is a hardware preference. */
  const [buzz, setBuzz] = useState(() => hapticsEnabled());
  const [draft, setDraft] = useState<Settings>(settings);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [resetOpen, setResetOpen] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  /* Categories are edited where they are managed, not in the page's draft:
     adding one is a thing the person does, sees happen and can undo — waiting
     for “Save changes” with 40 other fields would hide it. */
  const [newCategory, setNewCategory] = useState('');
  const [categoryError, setCategoryError] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState('');
  const [deletingCategory, setDeletingCategory] = useState<string | null>(null);
  const [categoryBusy, setCategoryBusy] = useState(false);
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
      if (onlyThemeChanged) return { ...current, theme: settings.theme };
      // Enabling a device is immediate too; do not discard unrelated edits the
      // person has already made in this form before pressing Save.
      const onlyNotificationsChanged =
        JSON.stringify({ ...settings, notificationsEnabled: previous.notificationsEnabled, reminderTimeZone: previous.reminderTimeZone }) === JSON.stringify(previous);
      if (onlyNotificationsChanged) return { ...current, notificationsEnabled: settings.notificationsEnabled, reminderTimeZone: settings.reminderTimeZone };
      /* The category manager writes through immediately, the same way. Keep the
         person's unsaved edits to the other fields while taking the new list. */
      const onlyCategoriesChanged =
        JSON.stringify(settings.customCategories ?? []) !== JSON.stringify(previous.customCategories ?? []) &&
        JSON.stringify({ ...settings, customCategories: previous.customCategories }) === JSON.stringify(previous);
      return onlyCategoriesChanged
        ? { ...current, customCategories: settings.customCategories }
        : settings;
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
    if (candidate.reminderRepeatMinutes < 0 || candidate.reminderRepeatMinutes > 480) {
      next.reminderRepeatMinutes = 'Repeats must be 0–480 minutes (0 turns them off).';
    }
    if (candidate.reminderTimeZone && !validTimeZone(candidate.reminderTimeZone)) next.reminderTimeZone = 'Use a valid IANA time zone, for example Asia/Kolkata.';
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(candidate.digestTime ?? '')) {
      next.digestTime = 'Use a time such as 09:30.';
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

  const customCategories = draft.customCategories ?? [];
  /* How many live tasks each category holds — the number that makes a delete
     or a rename consequential, shown before either is pressed. */
  const categoryCounts = tasks.reduce<Record<string, number>>((counts, task) => {
    if (task.deletedAt !== null) return counts;
    counts[task.category] = (counts[task.category] ?? 0) + 1;
    return counts;
  }, {});
  const usageLabel = (count: number | undefined) =>
    count ? `${count} task${count === 1 ? '' : 's'}` : 'No tasks yet';

  const submitCategory = () => {
    const result = normaliseCustomCategory(newCategory, settings.customCategories ?? []);
    if (!result.ok) {
      setCategoryError(result.error);
      return;
    }
    const error = onAddCategory(result.value);
    if (error) {
      setCategoryError(error);
      return;
    }
    setNewCategory('');
    setCategoryError('');
  };

  const startRename = (name: string) => {
    setRenaming(name);
    setRenameValue(name);
    setRenameError('');
  };

  const submitRename = async () => {
    if (!renaming) return;
    setCategoryBusy(true);
    const error = await onRenameCategory(renaming, renameValue);
    setCategoryBusy(false);
    if (error) {
      setRenameError(error);
      return;
    }
    setRenaming(null);
    setRenameValue('');
    setRenameError('');
  };

  const confirmDeleteCategory = async () => {
    if (!deletingCategory) return;
    setCategoryBusy(true);
    await onDeleteCategory(deletingCategory);
    setCategoryBusy(false);
    setDeletingCategory(null);
  };

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

          <section className="card settings-section" aria-labelledby="settings-categories-heading">
            <div className="section-head">
              <h2 id="settings-categories-heading">Categories</h2>
              <Badge tone="info">
                {customCategories.length} of {MAX_CUSTOM_CATEGORIES} of your own
              </Badge>
            </div>
            <p className="section-note">
              Every task is filed under one. The eight built-ins are fixed; the ones you add can be renamed or
              deleted here — and the tasks filed under them move with the change.
            </p>

            <ul className="category-manage">
              {CATEGORY_ORDER.map((category) => (
                <li key={category} className="category-row">
                  <CategoryBadge category={category} />
                  <span className="category-usage">{usageLabel(categoryCounts[category])}</span>
                  <span className="category-fixed">
                    <Lock size={12} aria-hidden="true" /> Built-in
                  </span>
                </li>
              ))}

              {customCategories.map((category) => (
                <li key={category} className="category-row is-custom">
                  {renaming === category ? (
                    <div className="category-rename">
                      <input
                        className={`input ${renameError ? 'invalid' : ''}`.trim()}
                        aria-label={`Rename ${category}`}
                        value={renameValue}
                        /* eslint-disable-next-line jsx-a11y/no-autofocus */
                        autoFocus
                        onChange={(event) => {
                          setRenameValue(event.target.value);
                          setRenameError('');
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            void submitRename();
                          }
                          if (event.key === 'Escape') {
                            setRenaming(null);
                            setRenameError('');
                          }
                        }}
                      />
                      {renameError ? <span className="field-error">{renameError}</span> : null}
                    </div>
                  ) : (
                    <>
                      <CategoryBadge category={category} />
                      <span className="category-usage">{usageLabel(categoryCounts[category])}</span>
                    </>
                  )}

                  <div className="category-row-actions">
                    {renaming === category ? (
                      <>
                        <Button size="sm" variant="primary" onClick={() => void submitRename()} disabled={categoryBusy}>
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setRenaming(null);
                            setRenameError('');
                          }}
                        >
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="icon-btn icon-btn-sm"
                          aria-label={`Edit ${category}`}
                          title={`Rename “${category}”`}
                          onClick={() => startRename(category)}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          className="icon-btn icon-btn-sm"
                          aria-label={`Delete ${category}`}
                          title={`Delete “${category}”`}
                          onClick={() => setDeletingCategory(category)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>

            {customCategories.length === 0 ? (
              <p className="field-hint">
                No categories of your own yet — “Other” is the only catch-all, and it is not much of a bucket.
              </p>
            ) : null}

            <div className="category-new">
              <label className="field-label" htmlFor="settings-new-category">
                Add a category
              </label>
              <div className="category-add">
                <input
                  id="settings-new-category"
                  className={`input ${categoryError ? 'invalid' : ''}`.trim()}
                  value={newCategory}
                  placeholder="e.g. Licensing, Recruitment, Field work"
                  onChange={(event) => {
                    setNewCategory(event.target.value);
                    setCategoryError('');
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      submitCategory();
                    }
                  }}
                />
                <Button variant="primary" icon={Plus} onClick={submitCategory}>
                  Add category
                </Button>
              </div>
              {categoryError ? <span className="field-error">{categoryError}</span> : null}
              <span className="field-hint">
                {customCategories.length >= MAX_CUSTOM_CATEGORIES
                  ? `That is all ${MAX_CUSTOM_CATEGORIES} — rename or delete one to make room.`
                  : 'It appears in every category picker straight away, including the task form.'}
              </span>
            </div>

            <ConfirmDialog
              open={deletingCategory !== null}
              title={`Delete “${deletingCategory ?? ''}”?`}
              message={
                deletingCategory && (categoryCounts[deletingCategory] ?? 0) > 0 ? (
                  <>
                    {categoryCounts[deletingCategory]} task
                    {(categoryCounts[deletingCategory] ?? 0) === 1 ? '' : 's'} use it. They move to{' '}
                    <strong>Other</strong>; the tasks themselves are kept.
                  </>
                ) : (
                  <>Nothing is filed under it. Deleting only removes the name.</>
                )
              }
              confirmLabel="Delete category"
              onConfirm={() => void confirmDeleteCategory()}
              onCancel={() => setDeletingCategory(null)}
            />
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
                <Mic size={16} /> Voice
              </h2>
              <Badge tone={dictationSupported() ? 'success' : 'neutral'}>
                {dictationSupported() ? 'Dictation available' : 'Type instead — no dictation here'}
              </Badge>
            </div>
            <Field
              label="Dictation language"
              htmlFor="settings-dictation-lang"
              hint={
                dictationSupported()
                  ? `What the microphone listens for. Listening now: ${dictationLanguageLabel(
                      resolveDictationLang(draft.dictationLang),
                    )}.`
                  : 'This browser has no speech recognition. Quick add still works from the keyboard, and photos import as usual.'
              }
            >
              <select
                id="settings-dictation-lang"
                className="input"
                value={draft.dictationLang}
                onChange={(event) => setDraft({ ...draft, dictationLang: event.target.value })}
              >
                <option value="">Match this device ({deviceLanguage()})</option>
                {DICTATION_LANGUAGES.map((language) => (
                  <option key={language.tag} value={language.tag}>
                    {language.label}
                  </option>
                ))}
              </select>
            </Field>
            <p className="field-hint">
              Speech is transcribed by the browser, not by this app. A language that matches the way you actually speak
              is the biggest accuracy win — the words have to arrive in English for the date, time and duration parser
              to read them.
            </p>
          </section>

          <section className="card settings-section" id="notification-settings">
            <div className="section-head">
              <h2><Bell size={16} /> System notifications &amp; reminders</h2>
              <Badge tone={notificationsPermission === 'granted' ? 'success' : 'neutral'}>
                Permission: {notificationsPermission === 'granted' ? 'Enabled' : notificationsPermission === 'denied' ? 'Blocked' : notificationsPermission === 'unsupported' ? 'Unsupported' : 'Not enabled'}
              </Badge>
            </div>
            <p className="muted">Allow system notifications so your device can show task reminders outside this tab. Background delivery also needs a synced Neon account, Web Push and a running scheduler.</p>
            <div className={`reminder-setup-status ${backgroundStatus?.state === 'active' && draft.notificationsEnabled && notificationsPermission === 'granted' ? 'is-ready' : ''}`} role="status">
              <strong>{backgroundStatus?.state === 'active' && draft.notificationsEnabled && notificationsPermission === 'granted' ? 'Background setup verified' : 'Background delivery status'}</strong>
              <span>{!draft.notificationsEnabled && notificationsPermission === 'granted' ? 'System reminders are paused in the planner. Enable them and save your settings.' : backgroundStatus?.message ?? 'Sign in and enable notifications to check background delivery.'}</span>
              {backgroundStatus?.schedulerLastSuccess ? <small>Last scheduler run: {new Date(backgroundStatus.schedulerLastSuccess).toLocaleString()}</small> : null}
            </div>
            <div className="settings-actions">
              <Button variant="primary" icon={Bell} onClick={() => void onRequestNotifications()} disabled={notificationsPermission === 'unsupported' || notificationsPermission === 'denied'}>
                Enable system notifications
              </Button>
              <Button variant="secondary" icon={Bell} onClick={onSendTestNotification} disabled={notificationsPermission !== 'granted'}>
                Send test notification
              </Button>
            </div>
            <p className="field-hint">The enable button is the only place that asks for permission. A background test is queued through the real scheduler; a local-only test checks the device banner only.</p>

            <Switch checked={draft.notificationsEnabled} onChange={(enabled) => {
              if (enabled && notificationsPermission !== 'granted') {
                addToast('Select Enable system notifications first.', 'warning');
                return;
              }
              setDraft({ ...draft, notificationsEnabled: enabled });
            }} label="Send system reminders" description="Pause or resume system reminders for this synced planner. Save changes to apply." />
            <Switch checked={draft.reminderThirtyMinutes !== false} onChange={(reminderThirtyMinutes) => setDraft({ ...draft, reminderThirtyMinutes })}
              label="30 minutes before due" description="An upcoming reminder 30 minutes before the deadline." />
            <Switch checked={draft.reminderFiveMinutes !== false} onChange={(reminderFiveMinutes) => setDraft({ ...draft, reminderFiveMinutes })}
              label="5 minutes before due" description="A second upcoming reminder, or a prompt as soon as a shorter deadline is created." />
            <div className="form-grid">
              <Field label="Repeat overdue reminders every (minutes)" htmlFor="settings-repeat" error={errors.reminderRepeatMinutes}
                hint="Default 30 minutes; set to 0 to disable repeats. The initial overdue alert still fires.">
                <input id="settings-repeat" className={`input ${errors.reminderRepeatMinutes ? 'invalid' : ''}`.trim()}
                  type="number" min={0} max={480} step={5} value={draft.reminderRepeatMinutes}
                  onChange={(event) => setDraft({ ...draft, reminderRepeatMinutes: Number(event.target.value) })} />
              </Field>
              <Field label="Show reminders on Today (minutes before)" htmlFor="settings-lead" error={errors.reminderLeadMinutes}
                hint="Controls the in-app Today list; system alerts use the 30- and 5-minute switches above.">
                <input id="settings-lead" className={`input ${errors.reminderLeadMinutes ? 'invalid' : ''}`.trim()}
                  type="number" min={0} max={1440} step={5} value={draft.reminderLeadMinutes}
                  onChange={(event) => setDraft({ ...draft, reminderLeadMinutes: Number(event.target.value) })} />
              </Field>
            </div>
            <Switch checked={draft.dailyDigestEnabled} onChange={(dailyDigestEnabled) => setDraft({ ...draft, dailyDigestEnabled })}
              label="Daily pending and overdue summary" description="Includes open tasks without a due date so you can schedule or complete them." />
            <div className="form-grid">
              <Field label="Daily summary and no-time deadline" htmlFor="settings-digest-time" error={errors.digestTime}
                hint="Tasks with a date but no time use this time for system reminders.">
                <input id="settings-digest-time" className={`input ${errors.digestTime ? 'invalid' : ''}`.trim()} type="time"
                  value={draft.digestTime} onChange={(event) => setDraft({ ...draft, digestTime: event.target.value })} />
              </Field>
              <Field label="Reminder time zone" htmlFor="settings-reminder-zone" error={errors.reminderTimeZone}
                hint="IANA time zone; leave empty to detect this device on enable. Daylight-saving changes are handled automatically.">
                <input id="settings-reminder-zone" className={`input ${errors.reminderTimeZone ? 'invalid' : ''}`.trim()}
                  value={draft.reminderTimeZone ?? ''} placeholder={Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata'}
                  onChange={(event) => setDraft({ ...draft, reminderTimeZone: event.target.value.trim() })} />
              </Field>
            </div>
            <Switch checked={draft.notificationSound !== false} onChange={(notificationSound) => setDraft({ ...draft, notificationSound })}
              label="Notification sound" description="The browser and device ultimately control sound, vibration and Do Not Disturb." />
            <Switch checked={draft.quietHoursEnabled} onChange={(quietHoursEnabled) => setDraft({ ...draft, quietHoursEnabled })}
              label="Quiet hours" description="Do not interrupt during these hours. The latest relevant reminder is considered after quiet hours end." />
            {draft.quietHoursEnabled ? (
              <div className="form-grid compact-grid">
                <Field label="Quiet from" htmlFor="settings-quiet-start">
                  <input id="settings-quiet-start" className="input" type="time" value={draft.quietStart}
                    onChange={(event) => setDraft({ ...draft, quietStart: event.target.value })} />
                </Field>
                <Field label="Quiet until" htmlFor="settings-quiet-end">
                  <input id="settings-quiet-end" className="input" type="time" value={draft.quietEnd}
                    onChange={(event) => setDraft({ ...draft, quietEnd: event.target.value })} />
                </Field>
              </div>
            ) : null}
            <details className="reminder-troubleshooting">
              <summary>Notification troubleshooting &amp; compatibility</summary>
              <p>If blocked, allow notifications for this site in your browser’s site settings, check your device notification settings and Do Not Disturb, then reload. On iOS/iPadOS 16.4 or later, add the planner to the Home Screen and enable notifications from that installed app.</p>
              <p>On desktop and Android, Web Push depends on browser/OS support and network connectivity. The browser or OS may delay or suppress delivery. Without a synced Neon account, working scheduler and a registered device, reminders are best-effort while the planner is open; a completely closed browser cannot be promised alerts.</p>
              <p>If a subscription expires, select Enable system notifications again. Each device must be enabled separately. Notification actions vary by browser; the in-app inbox also offers 10-minute, 30-minute and 1-hour snoozes.</p>
            </details>
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
            <Switch
              checked={draft.privacyBlur}
              onChange={(enabled) => {
                // Applied at once, like the theme: the whole point is that it
                // is already on before you leave the desk. Saved against the
                // settings the app holds, not the half-edited draft.
                setDraft((current) => ({ ...current, privacyBlur: enabled }));
                void onSaveSettings({ ...settings, privacyBlur: enabled });
                haptic('tap');
              }}
              label="Privacy blur"
              description="Softens task titles, client names and attached photos when the tab is hidden or nobody has touched the page for a minute. Move or type to bring them back."
            />
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
              <Button variant="secondary" icon={Download} onClick={onExportIcs}>
                Export calendar (.ics)
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
              <li>Cloud sync and background push require a configured Neon deployment and an account; local-only data stays on this device.</li>
              <li>Background push depends on the scheduler, browser, operating system and network. Delivery cannot be guaranteed when these are unavailable.</li>
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
                <dd>{account.cloudConnected ? 'Connected' : 'Not connected'}</dd>
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
