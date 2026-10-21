import { useEffect, useMemo, useState } from 'react';
import { Link2, TriangleAlert } from 'lucide-react';
import type { Category, Priority, Settings, Task } from '../lib/types';
import { CATEGORIES, CATEGORY_ORDER, PRIORITIES, PRIORITY_ORDER } from '../lib/types';
import { findDependencyCycle } from '../lib/engine';
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
}: {
  open: boolean;
  task: Task | null;
  settings: Settings;
  tasks: Task[];
  defaultDueDate?: string | null;
  initialDraft?: TaskDraft | null;
  onClose: () => void;
  onSubmit: (draft: TaskDraft) => void;
}) {
  const [draft, setDraft] = useState<TaskDraft>(() =>
    task ? draftFromTask(task) : initialDraft ?? emptyDraft(settings, defaultDueDate ?? null),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dependencyQuery, setDependencyQuery] = useState('');

  useEffect(() => {
    if (!open) return;
    setDraft(task ? draftFromTask(task) : initialDraft ?? emptyDraft(settings, defaultDueDate ?? null));
    setErrors({});
    setDependencyQuery('');
  }, [open, task, settings, defaultDueDate, initialDraft]);

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
          <input
            id="task-title"
            className={`input ${errors.title ? 'invalid' : ''}`.trim()}
            value={draft.title}
            autoFocus
            placeholder="e.g. Follow up with Acme on the proposal"
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
          />
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

        <Field label="Category" htmlFor="task-category">
          <select
            id="task-category"
            className="input"
            value={draft.category}
            onChange={(event) => setDraft({ ...draft, category: event.target.value as Category })}
          >
            {CATEGORY_ORDER.map((category) => (
              <option key={category} value={category}>
                {CATEGORIES[category].label}
              </option>
            ))}
          </select>
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
