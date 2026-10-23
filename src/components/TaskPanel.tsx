import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  CircleCheck,
  Clock,
  ExternalLink,
  ImagePlus,
  Link2,
  Mic,
  Paperclip,
  Pause,
  Pencil,
  Play,
  Sparkles,
  Square,
  Target,
  Trash2,
  TrendingUp,
  TriangleAlert,
  X,
} from 'lucide-react';
import type { Task, TaskEvent, Settings } from '../lib/types';
import { CATEGORIES, PRIORITIES } from '../lib/types';
import {
  dueLabel,
  dueTone,
  formatDateLong,
  formatDateShort,
  formatDuration,
  formatSecondsLabel,
  formatTimeAgo,
} from '../lib/dates';
import { deadlineRisk, suggestForTask } from '../lib/ml';
import { forecastTask } from '../lib/forecast';
import type { LearnedDurations } from '../lib/engine';
import { listEvents } from '../lib/db';
import {
  ATTACHMENT_LIMITS,
  compressPhoto,
  formatBytes,
  listAttachments,
  microphoneErrorText,
  notifyAttachmentsChanged,
  saveAttachment,
  startVoiceMemo,
  tombstoneAttachment,
  voiceRecorderSupported,
  onAttachmentsChanged,
  type AttachmentRecord,
  type VoiceCapture,
} from '../lib/attachments';
import { isCloudConfigured, loadCloudSession } from '../lib/cloudSync';
import { Badge, Button, CategoryBadge, IconButton, PriorityBadge, ProgressBar } from './ui';

export function TaskPanel({
  task,
  tasks,
  settings,
  now,
  elapsedMs,
  isRunning,
  isPaused,
  onClose,
  onEdit,
  onStart,
  onPause,
  onResume,
  onFinish,
  onToggleComplete,
  onApplySuggestion,
  onOpenTask,
  onAttachmentsChange,
  learned,
}: {
  task: Task | null;
  tasks: Task[];
  settings: Settings;
  now: Date;
  elapsedMs: number;
  isRunning: boolean;
  isPaused: boolean;
  learned: LearnedDurations | null;
  onClose: () => void;
  onEdit: () => void;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onFinish: () => void;
  onToggleComplete: () => void;
  onApplySuggestion: (input: { category: Task['category']; priority: Task['priority']; estimatedMinutes: number }) => void;
  onOpenTask: (id: string) => void;
  /** Fire after any attachment change so the app queues a sync push. */
  onAttachmentsChange: () => void;
}) {
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [attachments, setAttachments] = useState<AttachmentRecord[]>([]);
  const [attachmentBusy, setAttachmentBusy] = useState<'photo' | 'voice' | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [confirmAttachment, setConfirmAttachment] = useState<string | null>(null);
  const [recording, setRecording] = useState<VoiceCapture | null>(null);
  const [recordingSince, setRecordingSince] = useState(0);
  const [recordingElapsed, setRecordingElapsed] = useState(0);
  const photoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!task) return;
    let cancelled = false;
    void listEvents(task.id).then((loaded) => {
      if (!cancelled) setEvents(loaded);
    });
    const reloadAttachments = () => {
      void listAttachments(task.id).then((rows) => {
        if (!cancelled) setAttachments(rows);
      });
    };
    reloadAttachments();
    const off = onAttachmentsChanged(reloadAttachments);
    return () => {
      cancelled = true;
      off();
    };
  }, [task]);

  // A live count for the recording bar: the panel's `now` only ticks every
  // 15 seconds, which is no use when the whole capture is 15 seconds long.
  // The counter is only rendered while recording, and `beginRecording` zeroes
  // it in the click handler — so this effect only ever starts and stops a
  // timer, never resets visible state.
  useEffect(() => {
    if (!recording) return;
    const interval = window.setInterval(() => {
      setRecordingElapsed(Math.floor((Date.now() - recordingSince) / 1000));
    }, 350);
    return () => window.clearInterval(interval);
  }, [recording, recordingSince]);

  // Object URLs for the blobs, rebuilt when the set changes and revoked when
  // it does — an open panel holds megabytes of photos, and leaking them per
  // keystroke of the panel's lifetime is not acceptable.
  const attachmentUrls = useMemo(() => {
    const urls = new Map<string, string>();
    for (const row of attachments) {
      if (row.blob) urls.set(row.id, URL.createObjectURL(row.blob));
    }
    return urls;
  }, [attachments]);
  useEffect(() => () => attachmentUrls.forEach((url) => URL.revokeObjectURL(url)), [attachmentUrls]);

  useEffect(() => {
    if (!task) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previous;
    };
  }, [task, onClose]);

  const suggestion = useMemo(
    () => (task ? suggestForTask(task.title, tasks, settings) : null),
    [task, tasks, settings],
  );
  const forecast = useMemo(
    () => (task && task.dueDate ? forecastTask({ task, tasks, settings, learned, now }) : null),
    [task, tasks, settings, learned, now],
  );
  const risk = useMemo(
    () => (task ? deadlineRisk(task, tasks, settings, now) : null),
    [task, tasks, settings, now],
  );
  // Memoised so a browser without MediaRecorder doesn't re-probe every render.
  const canRecordVoice = useMemo(() => voiceRecorderSupported(), []);

  if (!task) return null;
  const completed = task.status === 'completed';
  const dependencies = task.dependencyIds
    .map((id) => tasks.find((candidate) => candidate.id === id))
    .filter((candidate): candidate is Task => Boolean(candidate));
  const tone = dueTone(task, now);
  const suggestionApplies =
    suggestion &&
    suggestion.hasEnoughHistory &&
    (suggestion.category !== task.category ||
      suggestion.priority !== task.priority ||
      suggestion.estimatedMinutes !== task.estimatedMinutes);

  const taskId = task.id;
  const photos = attachments.filter((row) => row.kind === 'photo');
  const voices = attachments.filter((row) => row.kind === 'voice');
  const canRecord = canRecordVoice;
  const attachmentsSyncOn = isCloudConfigured() && loadCloudSession() !== null;

  const attachmentBadge = (row: AttachmentRecord) => {
    if (row.synced) return <span className="att-badge is-synced">Synced</span>;
    if (attachmentsSyncOn) return <span className="att-badge">Waiting to sync</span>;
    return <span className="att-badge">This device</span>;
  };

  const pickPhoto = async (file: File) => {
    setAttachmentError(null);
    setAttachmentBusy('photo');
    try {
      const blob = await compressPhoto(file);
      await saveAttachment({
        taskId,
        kind: 'photo',
        mime: blob.type || file.type || 'image/jpeg',
        blob,
      });
      notifyAttachmentsChanged();
      onAttachmentsChange();
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : 'Could not save that photo.');
    } finally {
      setAttachmentBusy(null);
    }
  };

  const beginRecording = async () => {
    setAttachmentError(null);
    let capture: VoiceCapture;
    try {
      capture = await startVoiceMemo();
    } catch (error) {
      setAttachmentError(microphoneErrorText(error));
      return;
    }
    setRecording(capture);
    setRecordingSince(Date.now());
    setRecordingElapsed(0);
    // Resolves after the 15-second auto-stop, a manual stop, or a discard —
    // one code path, so a memo can never be recorded and silently dropped.
    const result = await capture.done;
    setRecording((current) => (current === capture ? null : current));
    if (!result) return;
    setAttachmentBusy('voice');
    try {
      await saveAttachment({
        taskId,
        kind: 'voice',
        mime: result.blob.type || 'audio/webm',
        blob: result.blob,
        durationMs: result.durationMs,
      });
      notifyAttachmentsChanged();
      onAttachmentsChange();
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : 'Could not save the voice note.');
    } finally {
      setAttachmentBusy(null);
    }
  };

  const removeAttachment = async (row: AttachmentRecord) => {
    setConfirmAttachment(null);
    setAttachmentError(null);
    try {
      await tombstoneAttachment(row.id);
      notifyAttachmentsChanged();
      onAttachmentsChange();
    } catch {
      setAttachmentError('Could not delete that attachment. Try again.');
    }
  };

  return (
    <div className="panel-layer">
      <button type="button" className="panel-backdrop" aria-label="Close task details" onClick={onClose} />
      <aside className="task-panel" role="dialog" aria-modal="true" aria-label={`Task details: ${task.title}`}>
        <header className="panel-head">
          <div className="panel-heading">
            <div className="panel-badges">
              <PriorityBadge priority={task.priority} />
              <CategoryBadge category={task.category} />
              {completed ? <Badge tone="success">Completed</Badge> : null}
              {task.blocked ? (
                <Badge tone="danger">
                  <TriangleAlert size={11} /> Blocked
                </Badge>
              ) : null}
              {task.graphRef ? <Badge tone="info">From {(task.graphRef.kind === 'mail' ? 'Outlook' : 'Teams')}</Badge> : null}
            </div>
            <h2>{task.title}</h2>
            <p className="panel-sub">
              {task.client || 'No client'} · Created {formatDateLong(task.createdAt.slice(0, 10))}
            </p>
          </div>
          <div className="panel-head-actions">
            <IconButton label="Edit task" icon={Pencil} onClick={onEdit} />
            <IconButton label="Close task details" icon={X} onClick={onClose} />
          </div>
        </header>

        <div className="panel-body">
          <section className={`timer-card ${isRunning ? 'running' : ''}`.trim()}>
            <div className="timer-display">
              <span className="timer-label">
                {isRunning ? <span className="live-dot" aria-hidden="true" /> : <Clock size={14} />}
                {isRunning ? 'Tracking now' : isPaused ? 'Paused' : 'Tracked time'}
              </span>
              <strong className="timer-value">{formatSecondsLabel(elapsedMs / 1000)}</strong>
              <span className="timer-sub">
                {formatDuration(task.estimatedMinutes)} estimated · {Math.round(elapsedMs / 60000)}m actual
              </span>
            </div>
            <div className="timer-actions">
              {completed ? (
                <Button variant="secondary" icon={Check} onClick={onToggleComplete}>
                  Reopen task
                </Button>
              ) : isRunning ? (
                <>
                  <Button variant="secondary" icon={Pause} onClick={onPause}>
                    Pause
                  </Button>
                  <Button variant="primary" icon={Square} onClick={onFinish}>
                    Finish
                  </Button>
                </>
              ) : isPaused ? (
                <>
                  <Button variant="primary" icon={Play} onClick={onResume}>
                    Resume
                  </Button>
                  <Button variant="ghost" icon={Check} onClick={onToggleComplete}>
                    Complete task
                  </Button>
                </>
              ) : (
                <Button variant="primary" icon={Play} onClick={onStart}>
                  Start timer
                </Button>
              )}
            </div>
          </section>

          <section className="panel-section">
            <h3>Details</h3>
            <dl className="detail-grid">
              <div>
                <dt>Priority</dt>
                <dd>
                  {PRIORITIES[task.priority].label}
                  {task.deferrals > 0 ? ` · deferred ${task.deferrals}×` : ''}
                </dd>
              </div>
              <div>
                <dt>Category</dt>
                <dd>{CATEGORIES[task.category].label}</dd>
              </div>
              <div>
                <dt>Due</dt>
                <dd className={`due-${tone}`}>{dueLabel(task, now)}</dd>
              </div>
              <div>
                <dt>Estimate</dt>
                <dd>{formatDuration(task.estimatedMinutes)}</dd>
              </div>
              <div>
                <dt>Actual</dt>
                <dd>{task.actualMinutes > 0 ? formatDuration(task.actualMinutes) : 'Not tracked yet'}</dd>
              </div>
              <div>
                <dt>Suggested slot</dt>
                <dd>
                  {task.suggestedDate
                    ? `${formatDateLong(task.suggestedDate)}${task.suggestedStart ? ` · ${task.suggestedStart}` : ''}`
                    : 'Not scheduled'}
                </dd>
              </div>
            </dl>
            {task.notes ? <p className="panel-notes">{task.notes}</p> : null}
            {task.graphRef ? (
              <a className="panel-source" href={task.graphRef.webUrl} target="_blank" rel="noreferrer">
                Open original in {task.graphRef.kind === 'mail' ? 'Outlook' : 'Teams'} <ExternalLink size={12} />
              </a>
            ) : null}
          </section>

          {suggestion ? (
            <section className="panel-section suggestion-card">
              <div className="section-title-row">
                <h3>
                  <Sparkles size={15} /> On-device suggestions
                </h3>
                <Badge tone={suggestion.hasEnoughHistory ? 'info' : 'neutral'}>
                  {suggestion.hasEnoughHistory ? `${suggestion.confidence}% confidence` : 'learning'}
                </Badge>
              </div>
              <div className="suggestion-values">
                <span>
                  <small>Category</small>
                  {CATEGORIES[suggestion.category].label}
                </span>
                <span>
                  <small>Priority</small>
                  {PRIORITIES[suggestion.priority].label}
                </span>
                <span>
                  <small>Duration</small>
                  {formatDuration(suggestion.estimatedMinutes)}
                </span>
              </div>
              <ul className="reason-list">
                {suggestion.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
              <Button
                size="sm"
                variant="secondary"
                disabled={!suggestionApplies}
                onClick={() =>
                  onApplySuggestion({
                    category: suggestion.category,
                    priority: suggestion.priority,
                    estimatedMinutes: suggestion.estimatedMinutes,
                  })
                }
              >
                Apply suggestion
              </Button>
              <p className="fine-print">
                Trained only on your saved tasks on this device. Nothing changes until you tap Apply.
              </p>
            </section>
          ) : null}

          {risk ? (
            <section className="panel-section">
              <div className="section-title-row">
                <h3>
                  <Target size={15} /> Deadline risk
                </h3>
                <Badge tone={risk.level === 'high' ? 'danger' : risk.level === 'medium' ? 'warning' : 'success'}>
                  {risk.score}/100 · {risk.level}
                </Badge>
              </div>
              <ProgressBar value={risk.score} tone={risk.level === 'high' ? 'danger' : risk.level === 'medium' ? 'warning' : 'success'} label="Deadline risk" />
              <ul className="reason-list">
                {risk.factors.map((factor) => (
                  <li key={factor.label}>
                    {factor.label}
                    {factor.points > 0 ? <span className="factor-points">+{factor.points}</span> : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {forecast ? (
            <section className="panel-section" aria-label="Deadline forecast">
              <div className="section-title-row">
                <h3>
                  <TrendingUp size={15} /> Deadline forecast
                </h3>
                <Badge tone={forecast.pOnTime === null ? 'neutral' : forecast.pOnTime >= 80 ? 'success' : forecast.pOnTime >= 50 ? 'warning' : 'danger'}>
                  {forecast.pOnTime === null ? 'undated' : `${forecast.pOnTime}% on time`}
                </Badge>
              </div>
              <p>
                Median finish <strong>{formatDateShort(forecast.medianDate)}</strong>
                {forecast.pOnTime === null ? null : (
                  <>
                    {' '}
                    ·{' '}
                    {(new Date(forecast.bandEnd).getTime() - new Date(forecast.bandStart).getTime()) / 86_400_000 < 1.5
                      ? 'same-week spread'
                      : 'range'}{' '}
                    {formatDateShort(forecast.bandStart)}–{formatDateShort(forecast.bandEnd)}
                  </>
                )}
              </p>
              <ul className="reason-list">
                {forecast.reasons.slice(0, 5).map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
              <p className="fine-print">
                {forecast.runs.toLocaleString()} on-device simulations using your saved durations.
                {forecast.model.source === 'corrected' && forecast.model.factor
                  ? ` Plans already apply ×${forecast.model.factor} to your estimate.`
                  : ' With no history yet, your estimate is the only input — treat the band as a guess.'}
              </p>
            </section>
          ) : null}

          <section className="panel-section">
            <h3>
              <Link2 size={15} /> Dependencies
            </h3>
            {dependencies.length === 0 ? (
              <p className="muted">This task can be scheduled on its own.</p>
            ) : (
              <ul className="dependency-list static">
                {dependencies.map((dependency) => (
                  <li key={dependency.id}>
                    <button type="button" className="link-button" onClick={() => onOpenTask(dependency.id)}>
                      {dependency.title}
                    </button>
                    <span className={`mini-status ${dependency.status}`}>
                      {dependency.status === 'completed' ? <CircleCheck size={12} /> : null}
                      {dependency.status.replace('_', ' ')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {task.blocked ? (
              <p className="field-hint">
                Marked blocked — the scheduler leaves it queued and shows “Why not scheduled”.
              </p>
            ) : null}
          </section>

          <section className="panel-section">
            <div className="section-title-row">
              <h3>
                <Paperclip size={15} /> Attachments
              </h3>
              <div className="att-actions">
                <Button
                  size="sm"
                  variant="ghost"
                  icon={ImagePlus}
                  disabled={attachmentBusy !== null || recording !== null}
                  onClick={() => photoInputRef.current?.click()}
                >
                  Photo
                </Button>
                {canRecord ? (
                  recording ? (
                    <>
                      <Button
                        size="sm"
                        variant="danger"
                        icon={Square}
                        onClick={() => recording.stop()}
                      >
                        Stop
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => recording.cancel()}>
                        Discard
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={Mic}
                      disabled={attachmentBusy !== null}
                      onClick={() => void beginRecording()}
                    >
                      Voice note
                    </Button>
                  )
                ) : null}
              </div>
            </div>

            {recording ? (
              <div className="att-rec" role="status">
                <span className="att-rec-dot" aria-hidden="true" />
                Recording {Math.min(Math.floor(ATTACHMENT_LIMITS.maxVoiceMs / 1000), recordingElapsed)}s of{' '}
                {Math.floor(ATTACHMENT_LIMITS.maxVoiceMs / 1000)}s — it stops itself
              </div>
            ) : null}

            {attachmentBusy === 'photo' ? <p className="muted">Compressing and saving photo…</p> : null}
            {attachmentBusy === 'voice' ? <p className="muted">Saving voice note…</p> : null}
            {attachmentError ? (
              <p className="att-error" role="alert">
                {attachmentError}
              </p>
            ) : null}

            {photos.length > 0 ? (
              <div className="att-grid">
                {photos.map((row) => {
                  const url = attachmentUrls.get(row.id);
                  return (
                    <div className="att-photo" key={row.id}>
                      {url ? (
                        <a href={url} target="_blank" rel="noreferrer" className="att-photo-open">
                          <img src={url} alt={`Photo attached ${formatDateLong(row.createdAt.slice(0, 10))}`} />
                        </a>
                      ) : (
                        <div className="att-photo-gone" aria-hidden="true" />
                      )}
                      <div className="att-photo-foot">
                        {attachmentBadge(row)}
                        {confirmAttachment === row.id ? (
                          <button
                            type="button"
                            className="att-del is-confirm"
                            onClick={() => void removeAttachment(row)}
                          >
                            Delete?
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="att-del"
                            aria-label="Delete this photo"
                            onClick={() => setConfirmAttachment(row.id)}
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}

            {voices.length > 0 ? (
              <div className="att-voices">
                {voices.map((row) => (
                  <div className="att-voice" key={row.id}>
                    {attachmentUrls.get(row.id) ? (
                      <audio controls preload="none" src={attachmentUrls.get(row.id)} />
                    ) : (
                      <p className="muted">Voice note waiting to download…</p>
                    )}
                    <div className="att-voice-meta">
                      <small>
                        {row.durationMs ? `${Math.max(1, Math.round(row.durationMs / 1000))}s · ` : ''}
                        {formatDateLong(row.createdAt.slice(0, 10))} · {formatBytes(row.size)}
                      </small>
                      <div className="att-voice-actions">
                        {attachmentBadge(row)}
                        {confirmAttachment === row.id ? (
                          <button
                            type="button"
                            className="att-del is-confirm"
                            onClick={() => void removeAttachment(row)}
                          >
                            Delete?
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="att-del"
                            aria-label="Delete this voice note"
                            onClick={() => setConfirmAttachment(row.id)}
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {attachments.length === 0 && !recording ? (
              <p className="muted">
                Nothing attached yet — a photo of the visiting card, a receipt, or a quick memo on the way out of
                the meeting.
              </p>
            ) : null}

            <p className="fine-print">
              {attachmentsSyncOn
                ? `Compressed on this device, then synced with your account — one file per request, ${formatBytes(ATTACHMENT_LIMITS.maxFileBytes)} each and ${Math.round(ATTACHMENT_LIMITS.maxUserBytes / 1_000_000)} MB per account. Never stored inside the sync snapshot.`
                : `Stays on this device until you sign in with sync — photos and memos never enter the snapshot, and never leave the browser on their own.`}
            </p>

            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              className="att-file-input"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void pickPhoto(file);
              }}
            />
          </section>

          <section className="panel-section">
            <h3>History</h3>
            {events.length === 0 ? (
              <p className="muted">No changes recorded yet.</p>
            ) : (
              <ol className="history-list">
                {[...events].reverse().map((event) => (
                  <li key={event.id}>
                    <span className={`history-dot history-${event.type}`} aria-hidden="true" />
                    <div>
                      <p>{event.detail}</p>
                      <small>
                        {event.type} · {formatTimeAgo(event.at, now)}
                      </small>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </aside>
    </div>
  );
}
