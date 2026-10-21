import { useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  Image as ImageIcon,
  LoaderCircle,
  RefreshCw,
  Shield,
  Sparkles,
  TriangleAlert,
  Upload,
} from 'lucide-react';
import type { Category, Priority } from '../lib/types';
import { CATEGORIES, CATEGORY_ORDER, PRIORITIES, PRIORITY_ORDER } from '../lib/types';
import { findDuplicate, parseScreenshotText } from '../lib/engine';
import type { ParsedDraft } from '../lib/engine';
import { formatDuration } from '../lib/dates';
import type { CommonPageProps } from './pageProps';
import { Badge, Button, EmptyState, Field, ProgressBar } from './ui';
import { PageHeader } from './Shell';

const SAMPLE_TEXT = `Follow up with Acme Industries on the proposal
Client: Acme Industries
Due: 24/10
Priority: high
Estimate: 30 min

Send revised pricing deck to Nexus Retail — urgent
Due tomorrow 3pm
Client: Nexus Retail

Call Priya about the renewal
Due Friday
Estimate: 20 minutes`;

const STEPS = [
  { id: 1, label: 'Upload' },
  { id: 2, label: 'Extract' },
  { id: 3, label: 'Review' },
  { id: 4, label: 'Confirm' },
] as const;

export function ImportPage({
  tasks,
  addToast,
  onImportDrafts,
}: CommonPageProps & { onImportDrafts: (drafts: ParsedDraft[]) => void }) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [rawText, setRawText] = useState('');
  const [drafts, setDrafts] = useState<ParsedDraft[]>([]);
  const [included, setIncluded] = useState<boolean[]>([]);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [ocrState, setOcrState] = useState<'idle' | 'reading' | 'done' | 'error'>('idle');
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const fileInput = useRef<HTMLInputElement | null>(null);
  const urlRef = useRef<string | null>(null);

  const reset = () => {
    setStep(1);
    setRawText('');
    setDrafts([]);
    setIncluded([]);
    setProgress(0);
    setStatus('');
    setOcrState('idle');
    setError('');
    setReviewError('');
    setFileName('');
    setImageUrl(null);
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  };

  const applyParsed = (text: string) => {
    const parsed = parseScreenshotText(text, new Date());
    setDrafts(parsed);
    setIncluded(parsed.map(() => true));
    setReviewError('');
    if (parsed.length === 0) {
      setReviewError('No task-like lines were found. Edit the text and try again.');
      return;
    }
    setStep(3);
  };

  const runOcr = async (file: File) => {
    setError('');
    setOcrState('reading');
    setStep(2);
    setProgress(0.02);
    setStatus('starting OCR');
    if (imageUrl && urlRef.current) URL.revokeObjectURL(urlRef.current);
    const url = URL.createObjectURL(file);
    urlRef.current = url;
    setImageUrl(url);
    setFileName(file.name);
    try {
      const { createWorker } = await import('tesseract.js');
      const worker = await createWorker('eng', 1, {
        logger: (message) => {
          if (typeof message.progress === 'number') setProgress(message.progress);
          if (message.status) setStatus(message.status.replace(/_/g, ' '));
        },
      });
      const result = await worker.recognize(file);
      await worker.terminate();
      setProgress(1);
      setStatus('text extracted');
      setRawText(result.data.text ?? '');
      setOcrState('done');
    } catch (ocrError) {
      setOcrState('error');
      setError(
        ocrError instanceof Error
          ? `OCR failed: ${ocrError.message}. You can paste the text manually below.`
          : 'OCR failed. You can paste the text manually below.',
      );
    }
  };

  const onFile = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Choose an image file (PNG, JPEG or WebP). You can still paste text manually.');
      return;
    }
    void runOcr(file);
  };

  const updateDraft = (index: number, patch: Partial<ParsedDraft>) => {
    setDrafts((current) => current.map((draft, position) => (position === index ? { ...draft, ...patch } : draft)));
  };

  const continueToConfirm = () => {
    const chosen = drafts.filter((_, index) => included[index]);
    if (chosen.length === 0) {
      setReviewError('Select at least one task to continue.');
      return;
    }
    const invalid = chosen.find((draft) => !draft.title.trim() || draft.estimatedMinutes < 5 || draft.estimatedMinutes > 480);
    if (invalid) {
      setReviewError('Every selected task needs a title and an estimate between 5 and 480 minutes.');
      return;
    }
    setReviewError('');
    setStep(4);
  };

  const save = () => {
    const chosen = drafts.filter((_, index) => included[index]);
    if (chosen.length === 0) return;
    onImportDrafts(chosen);
    addToast(`${chosen.length} task${chosen.length === 1 ? '' : 's'} imported after review.`, 'success');
    reset();
  };

  const chosenDrafts = drafts.filter((_, index) => included[index]);
  const duplicateCount = chosenDrafts.filter((draft) => findDuplicate(draft, tasks)).length;
  const warningCount = chosenDrafts.reduce((sum, draft) => sum + draft.warnings.length, 0);
  const missingDates = chosenDrafts.filter((draft) => !draft.dueDate).length;

  return (
    <div className="page">
      <PageHeader
        eyebrow="Screenshot Import"
        title="Turn a screenshot into reviewed tasks"
        description="Tesseract.js reads the image in your browser. Parsing is deterministic, dates are never auto-confirmed, and nothing saves without your review."
        actions={
          <Badge tone="info">
            <Shield size={12} /> On-device OCR
          </Badge>
        }
      />

      <ol className="stepper" aria-label="Import steps">
        {STEPS.map((entry) => (
          <li key={entry.id} className={`${step === entry.id ? 'active' : ''} ${step > entry.id ? 'done' : ''}`.trim()}>
            <span className="step-dot">{step > entry.id ? <Check size={13} /> : entry.id}</span>
            <span>{entry.label}</span>
          </li>
        ))}
      </ol>

      {step === 1 ? (
        <section className="card import-upload">
          <div
            className={`dropzone ${dragging ? 'dragging' : ''}`.trim()}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              onFile(event.dataTransfer.files?.[0]);
            }}
          >
            <ImageIcon size={32} />
            <h2>Drop a Teams or Outlook screenshot</h2>
            <p className="muted">PNG, JPEG or WebP. OCR runs locally — the image never leaves this browser.</p>
            <div className="empty-actions">
              <Button variant="primary" icon={Upload} onClick={() => fileInput.current?.click()}>
                Choose image
              </Button>
              <Button
                variant="secondary"
                icon={Sparkles}
                onClick={() => {
                  setRawText(SAMPLE_TEXT);
                  setOcrState('done');
                  setFileName('sample-text');
                  setStep(2);
                }}
              >
                Use sample text
              </Button>
            </div>
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/bmp"
              hidden
              onChange={(event) => {
                onFile(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
          </div>
          {error ? (
            <p className="field-error" role="alert">
              <TriangleAlert size={14} /> {error}
            </p>
          ) : null}
          <div className="import-limits">
            <h3>What to expect</h3>
            <ul>
              <li>Blurry screenshots produce poor OCR — quality matters more than anything.</li>
              <li>Inferred dates are flagged amber and must be confirmed in Review.</li>
              <li>Duplicate titles are highlighted; you choose whether to keep them.</li>
              <li>Nothing is written to the database until the final Confirm step.</li>
            </ul>
          </div>
        </section>
      ) : null}

      {step === 2 ? (
        <section className="card import-extract">
          <div className="section-head">
            <h2>Extract text</h2>
            {imageUrl ? <img className="ocr-preview" src={imageUrl} alt={`Uploaded screenshot ${fileName}`} /> : null}
          </div>
          {ocrState === 'reading' ? (
            <div className="ocr-progress">
              <p>
                <LoaderCircle size={16} className="spin" /> Reading {fileName || 'screenshot'} — {status || 'working'}…
              </p>
              <ProgressBar value={Math.round(progress * 100)} label="OCR progress" />
              <p className="fine-print">{Math.round(progress * 100)}%</p>
            </div>
          ) : null}
          {error ? (
            <p className="field-error" role="alert">
              <TriangleAlert size={14} /> {error}
            </p>
          ) : null}
          <Field
            label="Extracted text (editable)"
            htmlFor="raw-ocr"
            hint="Fix anything OCR got wrong, then parse. Task blocks are separated by blank lines or bullets."
          >
            <textarea
              id="raw-ocr"
              className="input textarea raw-text"
              rows={10}
              placeholder="Paste or edit screenshot text here…"
              value={rawText}
              onChange={(event) => setRawText(event.target.value)}
            />
          </Field>
          <div className="wizard-actions">
            <Button variant="ghost" onClick={reset}>
              Start over
            </Button>
            <Button variant="secondary" icon={RefreshCw} onClick={() => applyParsed(rawText)} disabled={!rawText.trim()}>
              Parse text
            </Button>
            <Button
              variant="primary"
              icon={ArrowRight}
              disabled={!rawText.trim()}
              onClick={() => applyParsed(rawText)}
            >
              Continue to review
            </Button>
          </div>
        </section>
      ) : null}

      {step === 3 ? (
        <section className="import-review">
          <div className="review-head card">
            <div>
              <h2>Review parsed tasks</h2>
              <p className="muted">
                {drafts.length} draft{drafts.length === 1 ? '' : 's'} found. Edit anything before continuing — this step is
                mandatory.
              </p>
            </div>
            <Badge tone="warning">{drafts.length} drafts</Badge>
          </div>

          {drafts.length === 0 ? (
            <div className="card">
              <EmptyState
                icon={ImageIcon}
                title="No tasks recognized"
                message="Go back and edit the extracted text, or enter the task manually."
                action={<Button onClick={() => setStep(2)}>Back to text</Button>}
              />
            </div>
          ) : (
            drafts.map((draft, index) => {
              const duplicate = findDuplicate(draft, tasks);
              return (
                <article key={index} className={`card draft-card ${included[index] ? '' : 'excluded'}`.trim()}>
                  <header className="draft-head">
                    <label className="draft-include">
                      <input
                        type="checkbox"
                        checked={included[index] ?? false}
                        onChange={(event) =>
                          setIncluded((current) => current.map((value, position) => (position === index ? event.target.checked : value)))
                        }
                      />
                      <span>Include this task</span>
                    </label>
                    <div className="draft-meta">
                      <Badge tone={draft.confidence >= 70 ? 'success' : draft.confidence >= 45 ? 'warning' : 'danger'}>
                        {draft.confidence}% confidence
                      </Badge>
                      {duplicate ? <Badge tone="warning">Possible duplicate of “{duplicate.title}”</Badge> : null}
                    </div>
                  </header>

                  <div className="form-grid">
                    <Field label="Title" htmlFor={`draft-title-${index}`} className="span-2">
                      <input
                        id={`draft-title-${index}`}
                        className="input"
                        value={draft.title}
                        onChange={(event) => updateDraft(index, { title: event.target.value })}
                      />
                    </Field>
                    <Field label="Client" htmlFor={`draft-client-${index}`}>
                      <input
                        id={`draft-client-${index}`}
                        className="input"
                        value={draft.client}
                        onChange={(event) => updateDraft(index, { client: event.target.value })}
                      />
                    </Field>
                    <Field label="Category" htmlFor={`draft-category-${index}`}>
                      <select
                        id={`draft-category-${index}`}
                        className="input"
                        value={draft.category}
                        onChange={(event) => updateDraft(index, { category: event.target.value as Category })}
                      >
                        {CATEGORY_ORDER.map((category) => (
                          <option key={category} value={category}>
                            {CATEGORIES[category].label}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Priority" htmlFor={`draft-priority-${index}`}>
                      <select
                        id={`draft-priority-${index}`}
                        className="input"
                        value={draft.priority}
                        onChange={(event) => updateDraft(index, { priority: event.target.value as Priority })}
                      >
                        {PRIORITY_ORDER.map((priority) => (
                          <option key={priority} value={priority}>
                            {PRIORITIES[priority].label}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Estimate (minutes)" htmlFor={`draft-estimate-${index}`}>
                      <input
                        id={`draft-estimate-${index}`}
                        className="input"
                        type="number"
                        min={5}
                        max={480}
                        step={5}
                        value={draft.estimatedMinutes}
                        onChange={(event) => updateDraft(index, { estimatedMinutes: Number(event.target.value) })}
                      />
                    </Field>
                    <Field label="Due date" htmlFor={`draft-due-${index}`}>
                      <input
                        id={`draft-due-${index}`}
                        className="input"
                        type="date"
                        value={draft.dueDate ?? ''}
                        onChange={(event) => updateDraft(index, { dueDate: event.target.value || null })}
                      />
                    </Field>
                    <Field label="Due time" htmlFor={`draft-time-${index}`}>
                      <input
                        id={`draft-time-${index}`}
                        className="input"
                        type="time"
                        value={draft.dueTime}
                        onChange={(event) => updateDraft(index, { dueTime: event.target.value })}
                      />
                    </Field>
                    <Field label="Notes" htmlFor={`draft-notes-${index}`} className="span-2">
                      <textarea
                        id={`draft-notes-${index}`}
                        className="input textarea"
                        rows={2}
                        value={draft.notes}
                        onChange={(event) => updateDraft(index, { notes: event.target.value })}
                      />
                    </Field>
                  </div>

                  {draft.warnings.length > 0 ? (
                    <ul className="draft-warnings">
                      {draft.warnings.map((warning) => (
                        <li key={warning}>
                          <TriangleAlert size={13} /> {warning}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <details className="draft-source">
                    <summary>Raw OCR block</summary>
                    <pre>{draft.rawText}</pre>
                  </details>
                </article>
              );
            })
          )}

          {reviewError ? (
            <p className="field-error" role="alert">
              <TriangleAlert size={14} /> {reviewError}
            </p>
          ) : null}

          <div className="wizard-actions">
            <Button variant="ghost" onClick={() => setStep(2)}>
              Back to text
            </Button>
            <Button variant="primary" icon={ArrowRight} onClick={continueToConfirm} disabled={drafts.length === 0}>
              Continue to confirm
            </Button>
          </div>
        </section>
      ) : null}

      {step === 4 ? (
        <section className="card import-confirm">
          <h2>Confirm import</h2>
          <p className="muted">
            Saving creates {chosenDrafts.length} task{chosenDrafts.length === 1 ? '' : 's'} in your Inbox with source
            “screenshot”. Scheduling happens later, after you review.
          </p>
          <dl className="confirm-grid">
            <div>
              <dt>Tasks to create</dt>
              <dd>{chosenDrafts.length}</dd>
            </div>
            <div>
              <dt>With a parsed deadline</dt>
              <dd>{chosenDrafts.length - missingDates}</dd>
            </div>
            <div>
              <dt>Without a deadline</dt>
              <dd>{missingDates}</dd>
            </div>
            <div>
              <dt>Warnings to acknowledge</dt>
              <dd>{warningCount}</dd>
            </div>
            <div>
              <dt>Possible duplicates</dt>
              <dd>{duplicateCount}</dd>
            </div>
            <div>
              <dt>Total estimated effort</dt>
              <dd>{formatDuration(chosenDrafts.reduce((sum, draft) => sum + draft.estimatedMinutes, 0))}</dd>
            </div>
          </dl>
          <ul className="confirm-list">
            {chosenDrafts.map((draft, index) => (
              <li key={index}>
                <span>{draft.title}</span>
                <span className="muted">
                  {draft.dueDate ?? 'No deadline'} · {draft.priority} · {formatDuration(draft.estimatedMinutes)}
                </span>
              </li>
            ))}
          </ul>
          {warningCount > 0 ? (
            <p className="fine-print">
              Warnings are informational; ambiguous or past dates stay exactly as edited above.
            </p>
          ) : null}
          <div className="wizard-actions">
            <Button variant="ghost" onClick={() => setStep(3)}>
              Back to review
            </Button>
            <Button variant="primary" icon={Check} onClick={save} disabled={chosenDrafts.length === 0}>
              Save {chosenDrafts.length} task{chosenDrafts.length === 1 ? '' : 's'}
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
