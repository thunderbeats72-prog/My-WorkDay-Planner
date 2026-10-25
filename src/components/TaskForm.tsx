import { useEffect, useMemo, useRef, useState } from 'react';
import { Link2, Mic, Plus, TriangleAlert } from 'lucide-react';
import type { Category, Priority, Settings, Task } from '../lib/types';
import {
  categoryChoices,
  categoryLabel,
  normaliseCustomCategory,
  PRIORITIES,
  PRIORITY_ORDER,
} from '../lib/types';
import { findDependencyCycle } from '../lib/engine';
import { useDictation } from '../hooks/useDictation';
import { Button, Field, Modal, Switch } from './ui';

export interface TaskDraft {
  title: string;
  notes: string;
  client: string;
  category: Category;
  priority: Priority;
  estimatedMinutes: number;
  dueDate: string | null;
  dueTime: string;
  blocked: boolean;
  dependencyIds: string[];
}

export function emptyDraft(settings: Settings, dueDate: string | null = null): TaskDraft {
  return {
    title: '',
    notes: '',
    client: '',
    category: 'other',
    priority: settings.defaultPriority,
    estimatedMinutes: settings.defaultEstimateMinutes,
    dueDate,
    dueTime: '',
    blocked: false,
    dependencyIds: [],
  };
}

export function draftFromTask(task: Task): TaskDraft {
  return {
    title: task.title,
    notes: task.notes,
    client: task.client,
    category: task.category,
    priority: task.priority,
    estimatedMinutes: task.estimatedMinutes,
    dueDate: task.dueDate,
    dueTime: task.dueTime,
    blocked: task.blocked,
    dependencyIds: [...task.dependencyIds],
  };
}

export function TaskForm({
  open,
  task,
  settings,
  tasks,
  defaultDueDate,
  initialDraft,
  onClose,
  onSubmit,
  onAddCategory,
}: {
  open: boolean;
  task: Task | null;
  settings: Settings;
  tasks: Task[];
  defaultDueDate?: string | null;
  initialDraft?: TaskDraft | null;
  onClose: () => void;
  onSubmit: (draft: TaskDraft) => void;
  /** Adds a category the user typed, so it exists for every future task. */
  onAddCategory?: (name: string) => void;
}) {
  const [draft, setDraft] = useState<TaskDraft>(() =>
    task ? draftFromTask(task) : initialDraft ?? emptyDraft(settings, defaultDueDate ?? null),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dependencyQuery, setDependencyQuery] = useState('');
  /* “New category” is the last chip in the same field, not a second screen:
     tapping it swaps the chips for a one-line input until the name is accepted
     or abandoned. */
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [categoryError, setCategoryError] = useState('');
  /* The same microphone as quick add: speak the title here instead of typing
     it. Dates, estimates and clients stay the form's job — a title is a title. */
  const dictation = useDictation({
    value: draft.title,
    onChange: (title) => setDraft((current) => ({ ...current, title })),
    lang: settings.dictationLang,
  });
  /* Closing the sheet must close the microphone with it: the form stays
     mounted while the dialog is hidden, so without this a cancelled task would
     keep listening in the background. */
  useEffect(() => {
    if (!open) dictation.stop();
  }, [open, dictation.stop]);

  /**
   * What the sheet was opened for.
   *
   * The draft is rebuilt when the sheet opens (or switches task), and only
   * then. `settings` is in the dependency list so the defaults are current, but
   * a settings change while the sheet is open — adding a category is exactly
   * that — must not throw away a half-typed task.
   */
  const openedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!open) {
      openedFor.current = null;
      return;
    }
    const key = task?.id ?? '__new__';
    if (openedFor.current === key) return;
    openedFor.current = key;
    setDraft(task ? draftFromTask(task) : initialDraft ?? emptyDraft(settings, defaultDueDate ?? null));
    setErrors({});
    setDependencyQuery('');
    setAddingCategory(false);
    setNewCategory('');
    setCategoryError('');
  }, [open, task, settings, defaultDueDate, initialDraft]);

  const categoryOptions = useMemo(() => categoryChoices(settings), [settings]);

  /* A task can carry a name the settings no longer list (it was deleted, or
     the data came from a backup). Show it as a chip rather than silently
     changing the task's category under the person's nose. */
  const visibleCategories = useMemo(
    () => (categoryOptions.includes(draft.category) ? categoryOptions : [...categoryOptions, draft.category]),
    [categoryOptions, draft.category],
  );

  const addCategory = () => {
    const result = normaliseCustomCategory(newCategory, settings.customCategories ?? []);
    if (!result.ok) {
      setCategoryError(result.error);
      return;
    }
    onAddCategory?.(result.value);
    setDraft((current) => ({ ...current, category: result.value }));
    setAddingCategory(false);
    setNewCategory('');
    setCategoryError('');
  };

  const dependencyOptions = useMemo(() => {
    const query = dependencyQuery.trim().toLowerCase();
    return tasks
      .filter((candidate) => candidate.id !== task?.id && candidate.deletedAt === null)
      .filter((candidate) => (query ? candidate.title.toLowerCase().includes(query) : true))
      .slice(0, 12);
  }, [tasks, task, dependencyQuery]);

  const submit = () => {
    const nextErrors: Record<string, string> = {};
    if (!draft.title.trim()) nextErrors.title = 'Give the task a short, clear title.';
    if (!Number.isFinite(draft.estimatedMinutes) || draft.estimatedMinutes < 5 || draft.estimatedMinutes > 480) {
      nextErrors.estimatedMinutes = 'Estimate must be between 5 and 480 minutes.';
    }
    if (draft.dueTime && !/^\d{1,2}:\d{2}$/.test(draft.dueTime)) {
      nextErrors.dueTime = 'Use a 24-hour time such as 15:30.';
    }
    const cycle = findDependencyCycle(task?.id ?? null, draft.dependencyIds, tasks);
    if (cycle) {
      nextErrors.dependencies = 'That would create a dependency cycle. Choose a different task.';
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    onSubmit({
      ...draft,
      title: draft.title.trim(),
      client: draft.client.trim(),
      notes: draft.notes.trim(),
      dueTime: draft.dueTime.trim(),
    });
  };

  return (
    <Modal
      open={open}
      title={task ? 'Edit task' : 'New task'}
      subtitle={task ? 'Changes save to this device only.' : 'Capture it now — schedule it later if needed.'}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit}>
            {task ? 'Save changes' : 'Create task'}
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Task" htmlFor="task-title" error={errors.title} className="span-2">
          <div className="input-with-action">
            <input
              id="task-title"
              className={`input ${errors.title ? 'invalid' : ''}`.trim()}
              value={draft.title}
              placeholder="e.g. Follow up with Acme on the proposal"
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            />
            {dictation.supported ? (
              <button
                type="button"
                className={`input-mic ${dictation.listening ? 'is-listening' : ''}`.trim()}
                aria-label={dictation.listening ? 'Stop dictating the task title' : 'Dictate the task title'}
                aria-pressed={dictation.listening}
                title={dictation.listening ? 'Stop listening' : 'Speak the title'}
                onClick={dictation.toggle}
              >
                <Mic size={16} aria-hidden="true" />
                {dictation.listening ? <span className="quick-dictate-live" aria-hidden="true" /> : null}
              </button>
            ) : null}
          </div>
          {dictation.error ? (
            <p className="field-hint is-error" role="alert">
              {dictation.error}
            </p>
          ) : dictation.note ? (
            <p className="field-hint" role={dictation.listening ? 'status' : undefined}>
              {dictation.note}
            </p>
          ) : null}
        </Field>

        <Field label="Client / account" htmlFor="task-client" hint="Used for client-level duration learning.">
          <input
            id="task-client"
            className="input"
            value={draft.client}
            placeholder="e.g. Acme Industries"
            onChange={(event) => setDraft({ ...draft, client: event.target.value })}
          />
        </Field>

        <Field label="Category">
          {addingCategory ? (
            <div className="category-add">
              <input
                id="task-category"
                className={`input ${categoryError ? 'invalid' : ''}`.trim()}
                value={newCategory}
                placeholder="e.g. Licensing"
                aria-label="New category name"
                maxLength={40}
                onChange={(event) => {
                  setNewCategory(event.target.value);
                  setCategoryError('');
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addCategory();
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    setAddingCategory(false);
                    setCategoryError('');
                  }
                }}
              />
              <Button size="sm" variant="primary" onClick={addCategory}>
                Add
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setAddingCategory(false); setCategoryError(''); }}>
                Cancel
              </Button>
            </div>
          ) : (
            /* Chips rather than a <select>: the one action this field kept
               hiding was “add my own”, which sat at the bottom of a native
               dropdown nobody opens. Every category is visible, and the last
               chip is always the way to name a new one. */
            <div className="category-picker" role="radiogroup" aria-label="Category">
              {visibleCategories.map((category) => {
                const selected = draft.category === category;
                return (
                  <button
                    key={category}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={`category-chip ${selected ? 'is-selected' : ''}`.trim()}
                    onClick={() => setDraft({ ...draft, category })}
                  >
                    {categoryLabel(category)}
                  </button>
                );
              })}
              <button
                type="button"
                className="category-chip is-new"
                onClick={() => {
                  setAddingCategory(true);
                  setNewCategory('');
                  setCategoryError('');
                }}
              >
                <Plus size={14} aria-hidden="true" /> New category
              </button>
            </div>
          )}
          {categoryError ? <span className="field-error">{categoryError}</span> : null}
          {!addingCategory ? (
            <span className="field-hint">
              {(settings.customCategories ?? []).length === 0
                ? 'Need your own? Tap “New category”.'
                : 'Your own categories can be renamed or deleted in Settings.'}
            </span>
          ) : null}
        </Field>

        <Field label="Priority" htmlFor="task-priority">
          <select
            id="task-priority"
            className="input"
            value={draft.priority}
            onChange={(event) => setDraft({ ...draft, priority: event.target.value as Priority })}
          >
            {PRIORITY_ORDER.map((priority) => (
              <option key={priority} value={priority}>
                {PRIORITIES[priority].label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Estimate (minutes)" htmlFor="task-estimate" error={errors.estimatedMinutes}>
          <input
            id="task-estimate"
            className={`input ${errors.estimatedMinutes ? 'invalid' : ''}`.trim()}
            type="number"
            min={5}
            max={480}
            step={5}
            value={draft.estimatedMinutes}
            onChange={(event) => setDraft({ ...draft, estimatedMinutes: Number(event.target.value) })}
          />
        </Field>

        <Field label="Due date" htmlFor="task-due">
          <input
            id="task-due"
            className="input"
            type="date"
            value={draft.dueDate ?? ''}
            onChange={(event) => setDraft({ ...draft, dueDate: event.target.value || null })}
          />
        </Field>

        <Field label="Due time" htmlFor="task-time" hint="Optional, 24-hour." error={errors.dueTime}>
          <input
            id="task-time"
            className={`input ${errors.dueTime ? 'invalid' : ''}`.trim()}
            type="time"
            value={draft.dueTime}
            onChange={(event) => setDraft({ ...draft, dueTime: event.target.value })}
          />
        </Field>

        <Field label="Notes" htmlFor="task-notes" className="span-2" hint="Context, next step, or the original OCR text.">
          <textarea
            id="task-notes"
            className="input textarea"
            rows={3}
            value={draft.notes}
            onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
          />
        </Field>

        <div className="span-2 form-section">
          <Switch
            checked={draft.blocked}
            onChange={(blocked) => setDraft({ ...draft, blocked })}
            label="Blocked"
            description="Blocked tasks are never scheduled — they stay in the queue with a reason."
          />
        </div>

        <div className="span-2 form-section">
          <div className="form-section-head">
            <span className="field-label">
              <Link2 size={14} /> Depends on
            </span>
            <span className="field-hint">A task is not scheduled until its dependencies are completed.</span>
          </div>
          <input
            className="input"
            placeholder="Search tasks to depend on…"
            value={dependencyQuery}
            onChange={(event) => setDependencyQuery(event.target.value)}
          />
          {errors.dependencies ? (
            <p className="field-error" role="alert">
              <TriangleAlert size={13} /> {errors.dependencies}
            </p>
          ) : null}
          <div className="dependency-list">
            {dependencyOptions.length === 0 ? (
              <p className="field-hint">No other tasks match.</p>
            ) : (
              dependencyOptions.map((candidate) => {
                const checked = draft.dependencyIds.includes(candidate.id);
                return (
                  <label key={candidate.id} className="dependency-item">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setDraft({
                          ...draft,
                          dependencyIds: checked
                            ? draft.dependencyIds.filter((id) => id !== candidate.id)
                            : [...draft.dependencyIds, candidate.id],
                        })
                      }
                    />
                    <span>{candidate.title}</span>
                    <span className={`mini-status ${candidate.status}`}>{candidate.status.replace('_', ' ')}</span>
                  </label>
                );
              })
            )}
          </div>
          {draft.dependencyIds.length > 0 ? (
            <p className="field-hint">{draft.dependencyIds.length} dependency selected.</p>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
