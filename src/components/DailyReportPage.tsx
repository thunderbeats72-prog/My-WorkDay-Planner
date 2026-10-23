import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  ClipboardCheck,
  Copy,
  FileText,
  History,
  Pencil,
  RefreshCw,
  Save,
  Send,
  Trash2,
} from 'lucide-react';
import type { ReportFormat, SavedReport, Task } from '../lib/types';
import { formatDateLong, formatDateShort, relativeDayLabel, todayISO } from '../lib/dates';
import {
  buildDailyReport,
  renderDailyReport,
  renderDailyReportHtml,
  reportNoteOf,
  reportTextToHtml,
  REPORT_FORMATS,
} from '../lib/dailyReport';
import { deleteReport, listReports, saveReport } from '../lib/db';
import { uniqueId } from '../lib/db';
import type { CommonPageProps } from './pageProps';
import { Badge, Button, ConfirmDialog, EmptyState } from './ui';

/**
 * The end-of-day update, generated from saved work — a view inside Reports.
 *
 * Two decisions shape this page:
 *
 *   · The preview is derived state, not a document. It is rebuilt from tasks
 *     and notes on every render, so a note typed in the task panel is in the
 *     next preview without a “sync” step that could quietly fail.
 *   · Once the user edits the text, it is theirs. `dirty` locks the preview
 *     against the data changing underneath an edit in progress; the source
 *     changing shows a banner with an explicit Regenerate, and regenerating
 *     asks for confirmation when the current text has unsaved edits.
 */
export function DailyReportView({
  tasks,
  now,
  taskHandlers,
  addToast,
  onSaveCompletionNote,
  onSaveTaskNote,
  onComplete,
}: CommonPageProps & {
  onSaveCompletionNote: (id: string, note: string) => void;
  onSaveTaskNote: (id: string, note: string) => void;
  /** Opens the completion dialog for a task (note optional, as everywhere else). */
  onComplete: (id: string) => void;
}) {
  const today = todayISO(now);
  const [dateISO, setDateISO] = useState(today);
  const [format, setFormat] = useState<ReportFormat>('whatsapp');
  const [draft, setDraft] = useState<string | null>(null);
  const [savedReports, setSavedReports] = useState<SavedReport[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  /* A day change that would throw away a hand-edited preview waits here for an
     answer instead of happening behind the user's back. */
  const [pendingDate, setPendingDate] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const copyTimer = useRef(0);

  const model = useMemo(() => buildDailyReport(tasks, dateISO), [tasks, dateISO]);
  const generated = useMemo(
    () =>
      renderDailyReport(model, format, {
        emptyText: 'No tasks recorded for this day yet — nothing to send.',
      }),
    [model, format],
  );
  const savedForDay = savedReports.find((row) => row.dateISO === dateISO) ?? null;
  /** What the box shows: the user's edit if there is one, else the generated text. */
  const text = draft ?? generated;
  const edited = draft !== null && draft !== generated;

  const reloadHistory = useCallback(async () => {
    setSavedReports(await listReports());
    setHistoryLoaded(true);
  }, []);

  useEffect(() => {
    void reloadHistory();
  }, [reloadHistory]);

  /* Changing the day or the format is an explicit act, so it replaces the
     edit in progress — carrying a half-written WhatsApp message into a
     Markdown box would be a worse surprise than losing the edit. */
  const resetDraft = () => {
    setDraft(null);
    setCopyState('idle');
  };

  const applyDate = (next: string) => {
    setDateISO(next);
    setPendingDate(null);
    resetDraft();
  };

  /* Switching days starts a different day's report, so it replaces the edit in
     progress — but only after saying so. A typed sentence must never vanish
     because a finger landed on "previous day". */
  const requestDate = (next: string) => {
    if (!next || next === dateISO) return;
    if (edited) {
      setPendingDate(next);
      return;
    }
    applyDate(next);
  };

  const shiftDate = (days: number) => {
    const base = new Date(`${dateISO}T12:00:00`);
    base.setDate(base.getDate() + days);
    requestDate(todayISO(base));
  };

  /**
   * The HTML flavour for whatever is currently on screen.
   *
   * Un-edited, the model is the truth, so the markup is exact. Edited, the
   * model no longer matches the box, and the markers already in the text are
   * converted instead — a paste must never quietly drop the user's wording.
   */
  const htmlFor = (value: string): string =>
    edited ? reportTextToHtml(value, format) : renderDailyReportHtml(model, { emptyText: '' });

  const copy = async (value: string, label: string, html?: string) => {
    const success = await writeClipboard(value, html);
    window.clearTimeout(copyTimer.current);
    setCopyState(success ? 'copied' : 'failed');
    copyTimer.current = window.setTimeout(() => setCopyState('idle'), 2600);
    addToast(
      success ? `${label} copied — paste it into your group.` : 'Clipboard was blocked. Select the text and copy it manually.',
      success ? 'success' : 'warning',
    );
    if (!success) textareaRef.current?.focus();
  };

  const save = async () => {
    const row: SavedReport = {
      id: savedForDay?.id ?? uniqueId('rpt'),
      dateISO,
      text,
      format,
      updatedAt: new Date().toISOString(),
      completedCount: model.completedCount,
      pendingCount: model.pendingCount,
    };
    await saveReport(row);
    await reloadHistory();
    setDraft(text);
    addToast(`Update for ${formatDateShort(dateISO)} saved.`, 'success');
  };

  const removeSaved = async () => {
    await deleteReport(dateISO);
    await reloadHistory();
    setConfirmDelete(false);
    addToast('Saved update removed. The report below is still generated from your tasks.', 'info');
  };

  const loadSaved = (row: SavedReport) => {
    setDateISO(row.dateISO);
    setDraft(row.text);
    setFormat(row.format);
  };

  const hasTasks = model.hasTasks;
  const reportDays = useMemo(() => {
    /* Days with something to say: anything in the last 30 days of activity,
       newest first, plus whichever day is open. */
    const days = new Set<string>();
    for (const task of tasks) {
      if (task.deletedAt !== null) continue;
      if (task.dueDate) days.add(task.dueDate);
      if (task.completedAt) days.add(task.completedAt.slice(0, 10));
      days.add(task.createdAt.slice(0, 10));
    }
    for (const row of savedReports) days.add(row.dateISO);
    days.add(dateISO);
    return [...days].sort((a, b) => b.localeCompare(a)).slice(0, 30);
  }, [tasks, savedReports, dateISO]);

  return (
    <div className="daily-view">
      {/* The page header belongs to Reports; this is the toolbar that page
          offers while the daily view is open. */}
      <div className="daily-toolbar">
        <p className="daily-toolbar-note">
          Built from the tasks you saved and the notes you wrote. Nothing here is typed twice — edit a note in the
          planner and the next preview has it.
        </p>
        <div className="daily-toolbar-actions">
          <Button variant="secondary" icon={Save} onClick={() => void save()} disabled={!hasTasks}>
            Save this update
          </Button>
          <Button
            variant="primary"
            icon={Copy}
            onClick={() => void copy(text, 'Daily update', htmlFor(text))}
            disabled={!hasTasks && !edited}
          >
            Copy update
          </Button>
        </div>
      </div>

      <section className="card daily-date-bar" aria-label="Reporting date">
        <div className="daily-date-nav">
          <Button size="sm" variant="ghost" icon={ArrowLeft} onClick={() => shiftDate(-1)} aria-label="Previous day" />
          <label className="daily-date-field">
            <CalendarDays size={15} aria-hidden="true" />
            <input
              className="input"
              type="date"
              value={dateISO}
              max={today}
              aria-label="Reporting date"
              onChange={(event) => requestDate(event.target.value)}
            />
          </label>
          <Button
            size="sm"
            variant="ghost"
            icon={ArrowRight}
            aria-label="Next day"
            onClick={() => shiftDate(1)}
            disabled={dateISO >= today}
          />
        </div>
        <div className="daily-date-meta">
          <strong>{dateISO === today ? 'Today' : relativeDayLabel(dateISO, now)}</strong>
          <span className="muted">{formatDateLong(dateISO)}</span>
        </div>
        <label className="daily-jump">
          <span className="field-label">Jump to</span>
          <select
            className="input"
            value={dateISO}
            aria-label="Jump to a day with activity"
            onChange={(event) => requestDate(event.target.value)}
          >
            {reportDays.map((day) => (
              <option key={day} value={day}>
                {day === today ? `Today · ${formatDateShort(day)}` : formatDateShort(day)}
              </option>
            ))}
          </select>
        </label>
      </section>

      <div className="daily-stats">
        <span className="daily-stat">
          <Check size={13} aria-hidden="true" /> {model.completedCount} completed
        </span>
        <span className="daily-stat">
          <Send size={13} aria-hidden="true" /> {model.pendingCount} pending
        </span>
        <span className="daily-stat">
          <FileText size={13} aria-hidden="true" /> {model.noteCount} with notes
        </span>
        {savedForDay ? <Badge tone="success">saved {formatDateShort(savedForDay.dateISO)}</Badge> : null}
      </div>

      <section className="card daily-format" aria-label="Output format">
        <div className="daily-format-head">
          <h2>Format</h2>
          <span className="fine-print">
            Strikethrough marks completed titles only — notes stay readable in every format. Copy carries both versions:
            teams and Outlook paste a real strikethrough, WhatsApp keeps the tildes.
          </span>
        </div>
        <div className="daily-format-options" role="group" aria-label="Copy format">
          {REPORT_FORMATS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`daily-format-option ${format === option.value ? 'is-active' : ''}`.trim()}
              aria-pressed={format === option.value}
              onClick={() => {
                setFormat(option.value);
                resetDraft();
              }}
            >
              <span className="daily-format-name">{option.label}</span>
              <code className="daily-format-sample">{option.short}</code>
              <span className="daily-format-hint">{option.hint}</span>
            </button>
          ))}
        </div>
        <div className="daily-copy-row">
          <Button
            variant="primary"
            icon={copyState === 'copied' ? ClipboardCheck : Copy}
            onClick={() => void copy(text, 'Daily update', htmlFor(text))}
          >
            {copyState === 'copied' ? 'Copied' : 'Copy'}
          </Button>
          <Button variant="secondary" icon={Copy} onClick={() => void copy(text.replace(/~([^~\n]+)~/g, '~~$1~~'), 'Markdown version')}>
            Copy as Markdown
          </Button>
          <Button
            variant="secondary"
            icon={Copy}
            onClick={() =>
              void copy(
                renderDailyReport(model, 'plain', { emptyText: '' }) || text,
                'Plain-text version',
              )
            }
          >
            Copy as plain text
          </Button>
          {edited ? (
            <Button variant="ghost" icon={RefreshCw} onClick={() => setConfirmRegenerate(true)}>
              Regenerate
            </Button>
          ) : (
            <Button variant="ghost" icon={RefreshCw} onClick={() => void reloadHistory()}>
              Refresh
            </Button>
          )}
        </div>
      </section>

      <section className="card daily-preview" aria-label="Report preview">
        <div className="daily-preview-head">
          <h2>
            <Pencil size={15} aria-hidden="true" /> Preview
          </h2>
          <div className="daily-preview-flags">
            {edited ? <Badge tone="warning">edited by you</Badge> : <Badge tone="neutral">from saved tasks</Badge>}
            {savedForDay && !edited ? <Badge tone="info">saved version</Badge> : null}
          </div>
        </div>

        {!hasTasks ? (
          <EmptyState
            icon={FileText}
            title="Nothing on this day yet"
            message="Add or complete a task, or write a note on one, and it will appear here on its own. Try Today, or jump to a day with activity."
            action={
              <Button variant="secondary" icon={CalendarDays} onClick={() => { setDateISO(today); resetDraft(); }}>
                Go to today
              </Button>
            }
          />
        ) : null}

        <textarea
          ref={textareaRef}
          className="input daily-preview-text"
          value={text}
          rows={Math.min(28, Math.max(10, text.split('\n').length + 2))}
          spellCheck
          aria-label="Report text"
          placeholder="The report appears here from your saved tasks."
          onChange={(event) => setDraft(event.target.value)}
        />

        {edited ? (
          <p className="daily-edit-note">
            Your edits are kept. The report will not be overwritten while you are editing it —{' '}
            <button type="button" className="link-button" onClick={() => setDraft(null)}>
              discard edits
            </button>{' '}
            to go back to the generated version.
          </p>
        ) : (
          <p className="daily-edit-note muted">
            Edit anything above before copying. Changes are kept until you switch day or format.
          </p>
        )}

        {copyState === 'failed' ? (
          <p className="daily-copy-fallback" role="alert">
            The clipboard is blocked in this browser. The text is selected — copy it with your keyboard or long-press.
          </p>
        ) : null}
      </section>

      <section className="card daily-tasks" aria-label="Tasks on this day">
        <div className="section-head">
          <h2>
            <Check size={16} aria-hidden="true" /> What is on this day
          </h2>
          <span className="fine-print">Notes stay with their task and flow into the preview above.</span>
        </div>
        {!hasTasks ? (
          <p className="muted">Nothing recorded for {formatDateShort(dateISO)}.</p>
        ) : (
          <ul className="daily-task-list">
            {model.sections.map((section) => (
              <li key={section.title} className="daily-task-section">
                <h3 className="daily-section-title">{section.title}</h3>
                <ul>
                  {section.lines.map((line) => (
                    <DailyTaskRow
                      key={line.task.id}
                      task={line.task}
                      line={line}
                      onOpen={() => taskHandlers(line.task).onOpen()}
                      onComplete={() => onComplete(line.task.id)}
                      onSaveNote={onSaveTaskNote}
                      onSaveCompletionNote={onSaveCompletionNote}
                    />
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>

      {historyLoaded && savedReports.length > 0 ? (
        <section className="card daily-history" aria-label="Saved updates">
          <div className="section-head">
            <h2>
              <History size={16} aria-hidden="true" /> Saved updates
            </h2>
            <Badge tone="neutral">{savedReports.length}</Badge>
          </div>
          <ul className="daily-history-list">
            {savedReports.map((row) => (
              <li key={row.id}>
                <button type="button" className="daily-history-open" onClick={() => loadSaved(row)}>
                  <span>{formatDateShort(row.dateISO)}</span>
                  <span className="muted">
                    {row.completedCount} done · {row.pendingCount} pending · {row.format}
                  </span>
                </button>
                {row.dateISO === dateISO ? (
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Delete saved update for ${formatDateShort(row.dateISO)}`}
                    onClick={() => setConfirmDelete(true)}
                  >
                    <Trash2 size={15} />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="fine-print">
            Saved updates are snapshots of the text you sent. They never replace the generated report — opening one shows
            it so an earlier day still reads the way it was sent.
          </p>
        </section>
      ) : null}

      <ConfirmDialog
        open={confirmRegenerate}
        title="Replace your edits with the latest saved tasks?"
        tone="primary"
        confirmLabel="Regenerate"
        message={<p>Your handwritten changes to this preview will be lost. The task list and notes are unchanged.</p>}
        onCancel={() => setConfirmRegenerate(false)}
        onConfirm={() => {
          setConfirmRegenerate(false);
          resetDraft();
        }}
      />
      <ConfirmDialog
        open={pendingDate !== null}
        title="Leave this day's preview?"
        tone="danger"
        confirmLabel="Switch day"
        message={
          <p>
            The {formatDateShort(dateISO)} preview has your own wording. Switching to{' '}
            {pendingDate ? formatDateShort(pendingDate) : 'another day'} starts again from the saved tasks — save this update
            first if you want to keep the text.
          </p>
        }
        onCancel={() => setPendingDate(null)}
        onConfirm={() => {
          if (pendingDate) applyDate(pendingDate);
        }}
      />
      <ConfirmDialog
        open={confirmDelete}
        title="Delete this saved update?"
        tone="danger"
        confirmLabel="Delete"
        message={<p>The snapshot goes; the tasks and notes it was built from stay exactly as they are.</p>}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => void removeSaved()}
      />
    </div>
  );
}

/**
 * One task on the day, with its note editable in place.
 *
 * Editing a note here writes to the task, not to the report — which is what
 * keeps the two in step. The same field saves a completion note for a finished
 * task and the task's own note for an open one.
 */
function DailyTaskRow({
  task,
  line,
  onOpen,
  onComplete,
  onSaveNote,
  onSaveCompletionNote,
}: {
  task: Task;
  line: { completed: boolean; note: string; detail: string };
  onOpen: () => void;
  onComplete: () => void;
  onSaveNote: (id: string, note: string) => void;
  onSaveCompletionNote: (id: string, note: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(reportNoteOf(task));
  /* Re-sync from the task while the field is not being edited — render
     adjustment, so a note saved elsewhere is reflected immediately and a
     half-typed note is never overwritten. */
  const storedNote = reportNoteOf(task);
  const [lastStored, setLastStored] = useState(storedNote);
  if (!editing && lastStored !== storedNote) {
    setLastStored(storedNote);
    setValue(storedNote);
  }

  const commit = () => {
    const next = value.trim();
    if (line.completed) onSaveCompletionNote(task.id, next);
    else onSaveNote(task.id, next);
    setEditing(false);
  };

  return (
    <li className={`daily-task ${line.completed ? 'is-done' : ''}`.trim()}>
      <div className="daily-task-main">
        <button type="button" className="daily-task-title" onClick={onOpen}>
          {task.title}
          {line.detail ? <span className="daily-task-detail"> - {line.detail}</span> : null}
        </button>
        {line.completed ? <Badge tone="success">Completed</Badge> : <Badge tone="neutral">Pending</Badge>}
      </div>

      {editing ? (
        <div className="daily-note-edit">
          <textarea
            className="input"
            rows={2}
            value={value}
            aria-label={`Note for ${task.title}`}
            onChange={(event) => setValue(event.target.value)}
            autoFocus
          />
          <div className="daily-note-edit-actions">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" onClick={commit}>
              Save note
            </Button>
          </div>
        </div>
      ) : (
        <div className="daily-note-row">
          {line.note ? (
            <p className="daily-note">{line.note}</p>
          ) : (
            <p className="daily-note is-empty">No note yet</p>
          )}
          <div className="daily-note-actions">
            <Button
              size="sm"
              variant="ghost"
              icon={Pencil}
              onClick={() => {
                setValue(reportNoteOf(task));
                setEditing(true);
              }}
            >
              {line.note ? 'Edit note' : 'Add note'}
            </Button>
            {!line.completed ? (
              <Button size="sm" variant="ghost" icon={Check} onClick={onComplete}>
                Complete
              </Button>
            ) : null}
          </div>
        </div>
      )}
    </li>
  );
}

/**
 * Copy, with the two fallbacks that matter on a phone.
 *
 * `navigator.clipboard` needs a secure context and, on iOS, a call made inside
 * the same gesture — both true here. When it is missing or refuses, the old
 * `execCommand` path still works in WebViews, and if that fails too the caller
 * is told to select the text instead of leaving a button that appears to have
 * done nothing.
 */
async function writeClipboard(value: string, html?: string): Promise<boolean> {
  /* Rich first. One paste carries both flavours: Teams and Outlook read the
     HTML and draw a real strikethrough, WhatsApp reads the plain text and uses
     its own `~tildes~`. Writing text only would leave Teams showing tildes. */
  if (html) {
    try {
      if (typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard?.write === 'function') {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/plain': new Blob([value], { type: 'text/plain' }),
            'text/html': new Blob([html], { type: 'text/html' }),
          }),
        ]);
        return true;
      }
    } catch {
      // Safari and some WebViews refuse mixed flavours — the text path is next.
    }
  }
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall through to the legacy path.
  }
  try {
    const area = document.createElement('textarea');
    area.value = value;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    /* The copy event still fires here, and it can carry both flavours even
       where the async clipboard cannot — this is the path that keeps the
       strikethrough on an older desktop browser. */
    const onCopy = (event: ClipboardEvent) => {
      if (!html || !event.clipboardData) return;
      event.clipboardData.setData('text/plain', value);
      event.clipboardData.setData('text/html', html);
      event.preventDefault();
    };
    if (html) document.addEventListener('copy', onCopy);
    area.select();
    const ok = document.execCommand?.('copy') ?? false;
    if (html) document.removeEventListener('copy', onCopy);
    area.remove();
    return ok;
  } catch {
    return false;
  }
}
