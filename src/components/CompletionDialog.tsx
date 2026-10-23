import { useRef, useState } from 'react';
import { Check, CircleCheck, X } from 'lucide-react';
import type { Task } from '../lib/types';
import { Button, Modal } from './ui';

/**
 * “Done — but here is what actually happened.”
 *
 * A follow-up being *performed* is not the same as the business goal being
 * *achieved*: “Meeting could not be aligned today. Follow up tomorrow.” is a
 * completed activity with an open objective, and the note is the only place
 * that distinction survives into the group chat. So completing asks once, with
 * the note optional and the fast path one tap away:
 *
 *   · Complete Task            — saves the task and the note
 *   · Complete Without Note    — saves the task and clears the draft
 *   · Cancel / Escape / back   — closes, and nothing is completed
 *
 * The dialog never completes anything by itself. It is controlled by the App,
 * which owns the task, so a cancelled dialog cannot leave a task half-done.
 */
export function CompletionDialog({
  task,
  onCancel,
  onComplete,
}: {
  /** The task awaiting completion, or null when the dialog is closed. */
  task: Task | null;
  onCancel: () => void;
  /** Called with the note (possibly empty) once the user confirms. */
  onComplete: (note: string) => void;
}) {
  /* The draft starts blank for each task: the saved note, if any, is shown
     underneath as history rather than pre-filled, so “Complete Without Note”
     can never quietly rewrite it. The App keys this component by task id, so
     a new task gets a new, empty draft without an effect. */
  const [note, setNote] = useState('');
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const open = task !== null;

  if (!task) return null;
  const saved = (task.completionNote ?? '').trim();
  const trimmed = note.trim();

  return (
    <Modal
      open={open}
      title="Complete task"
      subtitle="A note is optional — it goes straight into the daily report."
      onClose={onCancel}
      size="sm"
      footer={
        <div className="complete-actions">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <div className="complete-actions-main">
            <Button variant="secondary" icon={Check} onClick={() => onComplete('')}>
              Complete Without Note
            </Button>
            <Button variant="primary" icon={Check} onClick={() => onComplete(trimmed)}>
              Complete Task
            </Button>
          </div>
        </div>
      }
    >
      <div className="complete-body">
        <p className="complete-task-title">{task.title}</p>
        {saved ? (
          <p className="complete-existing">
            <CircleCheck size={13} aria-hidden="true" />
            <span>
              Saved note: <em>{saved}</em> — leaving the field empty keeps it.
            </span>
          </p>
        ) : null}

        <label className="field-label" htmlFor="completion-note">
          Completion Note / Progress Update <span className="optional-tag">optional</span>
        </label>
        <textarea
          id="completion-note"
          ref={(element) => {
            inputRef.current = element;
            /* Focus on a spare keystroke on a laptop only: on a phone this
               raises the keyboard over the sheet. */
            if (element && !window.matchMedia?.('(pointer: coarse)')?.matches) {
              window.setTimeout(() => element.focus(), 40);
            }
          }}
          className="input complete-note"
          rows={4}
          maxLength={2000}
          placeholder="What happened? e.g. Meeting could not be aligned today. Follow up tomorrow."
          value={note}
          onChange={(event) => setNote(event.target.value)}
          aria-describedby="completion-note-help"
        />
        <div className="complete-help" id="completion-note-help">
          <span>Outcome, progress, next step or reason for delay — your words, unedited.</span>
          <span className="complete-count">{note.length}/2000</span>
        </div>
        <p className="complete-hint">
          <X size={12} aria-hidden="true" />
          Nothing saves unless you confirm. The task stays open if you cancel.
        </p>
      </div>
    </Modal>
  );
}
