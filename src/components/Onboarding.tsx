import { useState } from 'react';
import { CalendarDays, Check, ChevronLeft, ChevronRight, Clock, Cpu, Shield } from 'lucide-react';
import type { Settings } from '../lib/types';
import { DAY_SHORT, DEFAULT_SETTINGS, PRIORITIES, PRIORITY_ORDER } from '../lib/types';
import { formatDuration, parseTimeToMinutes } from '../lib/dates';
import { Badge, Button, Field, Segmented } from './ui';
import { BrandMark } from './BrandMark';

const WORKING_DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

export function Onboarding({ onComplete }: { onComplete: (settings: Settings) => void }) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [draft, setDraft] = useState<Settings>({ ...DEFAULT_SETTINGS, onboardingComplete: true });
  const [error, setError] = useState('');

  const start = parseTimeToMinutes(draft.workdayStart);
  const end = parseTimeToMinutes(draft.workdayEnd);
  const lunchStart = parseTimeToMinutes(draft.lunchStart);
  const lunchEnd = parseTimeToMinutes(draft.lunchEnd);
  const capacity = Math.max(0, end - start) - Math.max(0, lunchEnd - lunchStart);
  const daysLabel = draft.workingDays.map((day) => DAY_SHORT[day]).join(' · ');

  const next = () => {
    setError('');
    if (step === 1) {
      if (!draft.name.trim()) {
        setError('Add a name so greetings and the sidebar feel like yours.');
        return;
      }
      setStep(2);
      return;
    }
    if (step === 2) {
      if (end <= start) {
        setError('Workday end must be after the start.');
        return;
      }
      if (draft.workingDays.length === 0) {
        setError('Pick at least one working day.');
        return;
      }
      if (lunchEnd <= lunchStart) {
        setError('Lunch end must be after lunch start.');
        return;
      }
      setStep(3);
      return;
    }
    onComplete({ ...draft, name: draft.name.trim(), onboardingComplete: true });
  };

  return (
    <div className="onboarding">
      <section className="onboarding-brand">
        <BrandMark size="lg" />
        <p className="eyebrow">Private workday workspace</p>
        <h1>My Workday Planner</h1>
        <p className="onboarding-tagline">
          A private, local-first command center for business development work. Your tasks, timers and screenshots stay in
          this browser.
        </p>
        <ul className="onboarding-points">
          <li>
            <Shield size={16} /> ₹0/month · no account · no cloud sync
          </li>
          <li>
            <CalendarDays size={16} /> Explainable scheduling around your real working hours
          </li>
          <li>
            <Clock size={16} /> Timestamp-based timer that survives refreshes
          </li>
          <li>
            <Cpu size={16} /> On-device learning from your own completed work
          </li>
        </ul>
        <div className="onboarding-preview">
          <span className="preview-label">Live preview</span>
          <h2>{draft.name ? `Good morning, ${draft.name.split(/\s+/)[0]}` : 'Good morning'}</h2>
          <p>
            {daysLabel || 'No working days yet'} · {draft.workdayStart}–{draft.workdayEnd}
          </p>
          <div className="preview-bar">
            <span style={{ width: `${Math.min(100, Math.max(8, (capacity / 540) * 100))}%` }} />
          </div>
          <p className="fine-print">
            {formatDuration(Math.max(0, capacity))} focus capacity · lunch {draft.lunchStart}–{draft.lunchEnd}
          </p>
        </div>
      </section>

      <section className="onboarding-card">
        <ol className="stepper compact" aria-label="Setup steps">
          {['About you', 'Working rhythm', 'Defaults'].map((label, index) => {
            const id = (index + 1) as 1 | 2 | 3;
            return (
              <li key={label} className={`${step === id ? 'active' : ''} ${step > id ? 'done' : ''}`.trim()}>
                <span className="step-dot">{step > id ? <Check size={12} /> : id}</span>
                <span>{label}</span>
              </li>
            );
          })}
        </ol>

        {step === 1 ? (
          <div className="onboarding-step" key={step}>
            <p className="eyebrow">Step 1 of 3</p>
            <h2>Let's set up your workday</h2>
            <p className="muted">
              This stays on this device. You can change everything later in Settings.
            </p>
            <div className="form-grid">
              <Field label="Your name" htmlFor="onboard-name" className="span-2">
                <input
                  id="onboard-name"
                  className="input"
                  autoFocus
                  value={draft.name}
                  placeholder="e.g. Aarav Sharma"
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
              </Field>
              <Field label="Role" htmlFor="onboard-role">
                <input
                  id="onboard-role"
                  className="input"
                  value={draft.role}
                  onChange={(event) => setDraft({ ...draft, role: event.target.value })}
                />
              </Field>
              <Field label="Company" htmlFor="onboard-company">
                <input
                  id="onboard-company"
                  className="input"
                  value={draft.company}
                  onChange={(event) => setDraft({ ...draft, company: event.target.value })}
                />
              </Field>
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="onboarding-step" key={step}>
            <p className="eyebrow">Step 2 of 3</p>
            <h2>When do you actually work?</h2>
            <p className="muted">
              The scheduler protects lunch and places buffers. Capacity is computed from these hours.
            </p>
            <div className="form-grid">
              <Field label="Workday start" htmlFor="onboard-start">
                <input
                  id="onboard-start"
                  className="input"
                  type="time"
                  value={draft.workdayStart}
                  onChange={(event) => setDraft({ ...draft, workdayStart: event.target.value })}
                />
              </Field>
              <Field label="Workday end" htmlFor="onboard-end">
                <input
                  id="onboard-end"
                  className="input"
                  type="time"
                  value={draft.workdayEnd}
                  onChange={(event) => setDraft({ ...draft, workdayEnd: event.target.value })}
                />
              </Field>
              <Field label="Lunch start" htmlFor="onboard-lunch-start">
                <input
                  id="onboard-lunch-start"
                  className="input"
                  type="time"
                  value={draft.lunchStart}
                  onChange={(event) => setDraft({ ...draft, lunchStart: event.target.value })}
                />
              </Field>
              <Field label="Lunch end" htmlFor="onboard-lunch-end">
                <input
                  id="onboard-lunch-end"
                  className="input"
                  type="time"
                  value={draft.lunchEnd}
                  onChange={(event) => setDraft({ ...draft, lunchEnd: event.target.value })}
                />
              </Field>
            </div>
            <Field label="Working days">
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
            <div className="capacity-preview">
              <strong>{formatDuration(Math.max(0, capacity))}</strong>
              <span>of capacity per working day, after lunch</span>
            </div>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="onboarding-step" key={step}>
            <p className="eyebrow">Step 3 of 3</p>
            <h2>Your defaults</h2>
            <p className="muted">Sensible starting points — the on-device model adapts as you track real work.</p>
            <div className="form-grid">
              <Field label="Default priority" htmlFor="onboard-priority">
                <select
                  id="onboard-priority"
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
              <Field label="Default estimate (minutes)" htmlFor="onboard-estimate">
                <input
                  id="onboard-estimate"
                  className="input"
                  type="number"
                  min={5}
                  max={480}
                  step={5}
                  value={draft.defaultEstimateMinutes}
                  onChange={(event) => setDraft({ ...draft, defaultEstimateMinutes: Number(event.target.value) })}
                />
              </Field>
              <Field label="Reminder lead (minutes)" htmlFor="onboard-lead" className="span-2">
                <input
                  id="onboard-lead"
                  className="input"
                  type="number"
                  min={0}
                  max={1440}
                  step={15}
                  value={draft.reminderLeadMinutes}
                  onChange={(event) => setDraft({ ...draft, reminderLeadMinutes: Number(event.target.value) })}
                />
              </Field>
            </div>
            <Field label="Theme">
              <Segmented<Settings['theme']>
                ariaLabel="Theme"
                value={draft.theme}
                onChange={(theme) => setDraft({ ...draft, theme })}
                options={[
                  { value: 'light', label: 'Light' },
                  { value: 'dark', label: 'Dark' },
                  { value: 'system', label: 'System' },
                ]}
              />
            </Field>
            <div className="onboarding-summary">
              <Badge tone="success">
                <Check size={12} /> Ready
              </Badge>
              <p>
                {draft.name || 'You'} · {daysLabel} · {draft.workdayStart}–{draft.workdayEnd} · {formatDuration(Math.max(0, capacity))} per day
              </p>
              <p className="fine-print">Local-only. Sync is not configured, and no data leaves this browser.</p>
            </div>
          </div>
        ) : null}

        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="onboarding-actions">
          {step > 1 ? (
            <Button variant="ghost" icon={ChevronLeft} onClick={() => setStep((step - 1) as 1 | 2 | 3)}>
              Back
            </Button>
          ) : (
            <button
              type="button"
              className="link-button"
              onClick={() => onComplete({ ...DEFAULT_SETTINGS, onboardingComplete: true })}
            >
              Skip setup for now
            </button>
          )}
          <Button variant="primary" icon={step === 3 ? Check : ChevronRight} onClick={next}>
            {step === 3 ? 'Start planning' : 'Continue'}
          </Button>
        </div>
      </section>
    </div>
  );
}
