import { useEffect, useMemo, useState } from 'react';
import { ChartColumn as ChartIcon, Clock, Download, Play, Target, TrendingUp } from 'lucide-react';
import { CATEGORIES } from '../lib/types';
import { formatClock, formatDateShort, formatDuration, humanDateRange, percent, todayISO } from '../lib/dates';
import { buildWeeklyReport } from '../lib/reports';
import { buildInsights, learnDurations } from '../lib/ml';
import { buildDayReplay, replayAt, replayableDates } from '../lib/replay';
import type { CommonPageProps } from './pageProps';
import { Badge, Button, EmptyState, ProgressBar, Segmented, StatCard } from './ui';
import { PageHeader } from './Shell';
import { DailyReportView } from './DailyReportPage';

type ReportsPageProps = CommonPageProps & {
  /** Which tab to open first — `#/daily` links land on the daily update. */
  initialView: 'daily' | 'weekly';
  onExportCsv: () => void;
  onSaveCompletionNote: (id: string, note: string) => void;
  onSaveTaskNote: (id: string, note: string) => void;
  onComplete: (id: string) => void;
};

export function ReportsPage(props: ReportsPageProps) {
  const { tasks, settings, now, timer, addToast, onExportCsv, initialView } = props;
  /* Two reports, one destination. The daily update is the end-of-day view of
     the same work the weekly summary counts, so it lives here as a tab rather
     than as a sixth place to remember. */
  const [view, setView] = useState<'daily' | 'weekly'>(initialView);
  const report = buildWeeklyReport(tasks, timer.sessions, now);
  const insights = buildInsights(tasks, timer.sessions);
  const learning = learnDurations(tasks, timer.sessions);
  const maxDayMinutes = Math.max(1, ...report.byDay.map((day) => day.focusMinutes));
  const maxCategoryMinutes = Math.max(1, ...report.byCategory.map((entry) => Math.max(entry.estimatedMinutes, entry.actualMinutes)));
  const estimateAccuracy =
    report.estimatedMinutes > 0 && report.actualMinutes > 0
      ? Math.round((report.estimatedMinutes / report.actualMinutes) * 100)
      : null;

  // Day replay: scrub through one day of timer sessions and completions.
  const replayDates = replayableDates(timer.sessions);
  const [replayDate, setReplayDate] = useState<string>(() => replayDates[0] ?? todayISO(now));
  const [replayPos, setReplayPos] = useState<number | null>(null);
  const [replayPlaying, setReplayPlaying] = useState(false);
  const activeReplayDate = replayDates.includes(replayDate) ? replayDate : (replayDates[0] ?? replayDate);
  const replay = useMemo(
    () => buildDayReplay(activeReplayDate, tasks, timer.sessions, settings),
    [activeReplayDate, tasks, timer.sessions, settings],
  );
  const playhead = replayPos ?? replay.startMs;
  const replaySpan = Math.max(1, replay.endMs - replay.startMs);

  useEffect(() => {
    if (!replayPlaying) return undefined;
    const step = Math.max(60_000, replaySpan / 180);
    const id = window.setInterval(() => {
      const next = Math.min(replay.endMs, (replayPos ?? replay.startMs) + step);
      setReplayPos(next);
      // Timer callback (not the effect body) owns the stop, so playback ends
      // on the same tick that reaches the end of the day.
      if (next >= replay.endMs) setReplayPlaying(false);
    }, 100);
    return () => window.clearInterval(id);
  }, [replayPlaying, replayPos, replay.startMs, replay.endMs, replaySpan]);

  const replayHasData = replay.spans.length > 0 || replay.marks.length > 0;
  const replayPercent = (atMs: number) => Math.min(100, Math.max(0, ((atMs - replay.startMs) / replaySpan) * 100));
  const nowAt = replayAt(replay, playhead);

  return (
    <div className="page">
      <PageHeader
        eyebrow={view === 'daily' ? 'End of day' : `Weekly report · ${report.rangeLabel}`}
        title="Reports"
        description={
          view === 'daily'
            ? 'The update you send at the end of the day — built from your tasks and notes, never typed twice.'
            : 'Built from real saved data only. Where there is not enough history, this page says so instead of guessing.'
        }
        actions={
          view === 'weekly' ? (
            <>
              <Button variant="secondary" icon={Download} onClick={onExportCsv}>
                Export CSV
              </Button>
              <Button
                variant="ghost"
                onClick={() =>
                  addToast('Weekly reports are computed live from IndexedDB — nothing is sent anywhere.', 'info')
                }
              >
                How is this computed?
              </Button>
            </>
          ) : null
        }
      />

      <div className="reports-view">
        <Segmented
          ariaLabel="Which report"
          value={view}
          onChange={setView}
          options={[
            { value: 'daily', label: 'Daily update' },
            { value: 'weekly', label: 'Weekly summary' },
          ]}
        />
      </div>

      {view === 'daily' ? (
        <DailyReportView {...props} />
      ) : (
        <>
          <div className="stat-grid">
            <StatCard icon={ChartIcon} label="Completed this week" value={report.completedCount} sub={`${report.createdCount} created`} tone="success" />
            <StatCard icon={Clock} label="Time tracked" value={formatDuration(report.actualMinutes)} sub={`${report.sessionsCount} sessions`} tone="primary" />
            <StatCard
              icon={TrendingUp}
              label="Estimate vs actual"
              value={estimateAccuracy === null ? '—' : `${estimateAccuracy}%`}
              sub={estimateAccuracy === null ? 'no completed work yet' : '100% = exactly on estimate'}
              tone={estimateAccuracy !== null && estimateAccuracy < 80 ? 'warning' : 'success'}
            />
            <StatCard icon={Target} label="Overdue now" value={report.overdueCount} sub={`${report.openCount} open`} tone={report.overdueCount > 0 ? 'danger' : 'success'} />
          </div>

          <div className="report-grid">
            <section className="card">
              <div className="section-head">
                <h2>Completed by category</h2>
                <Badge tone="neutral">{report.byCategory.length} categories</Badge>
              </div>
              {report.byCategory.length === 0 ? (
                <EmptyState
                  icon={ChartIcon}
                  title="No completed tasks this week"
                  message="Complete a task and its estimate vs actual time will appear here."
                />
              ) : (
                <ul className="breakdown-list">
                  {report.byCategory.map((entry) => (
                    <li key={entry.category}>
                      <div className="breakdown-head">
                        <span>
                          {entry.label} <span className="muted">· {entry.completed} done</span>
                        </span>
                        <span className="muted">
                          {formatDuration(entry.estimatedMinutes)} est · {formatDuration(entry.actualMinutes)} actual
                        </span>
                      </div>
                      <div className="double-bar">
                        <span
                          className="bar estimate"
                          style={{ width: `${percent(entry.estimatedMinutes, maxCategoryMinutes)}%` }}
                          title={`Estimate ${formatDuration(entry.estimatedMinutes)}`}
                        />
                        <span
                          className="bar actual"
                          style={{ width: `${percent(entry.actualMinutes, maxCategoryMinutes)}%` }}
                          title={`Actual ${formatDuration(entry.actualMinutes)}`}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <p className="fine-print">Grey = estimate · Ink = actual tracked time.</p>
            </section>

            <section className="card">
              <div className="section-head">
                <h2>Daily activity</h2>
                <Badge tone="info">{humanDateRange(report.fromISO, report.toISO)}</Badge>
              </div>
              <ul className="day-bars">
                {report.byDay.map((day) => (
                  <li key={day.dateISO}>
                    <span className="day-label">{day.label}</span>
                    <div className="day-bar-track">
                      <span style={{ width: `${percent(day.focusMinutes, maxDayMinutes)}%` }} />
                    </div>
                    <span className="day-value">{formatDuration(day.focusMinutes)}</span>
                    <span className="day-completed">{day.completed} done</span>
                  </li>
                ))}
              </ul>
              <div className="report-mini-stats">
                <div>
                  <strong>{report.followUps}</strong>
                  <span>Follow-ups completed</span>
                </div>
                <div>
                  <strong>{report.proposals}</strong>
                  <span>Proposals completed</span>
                </div>
              </div>
            </section>
          </div>

          <div className="report-grid">
            <section className="card">
              <div className="section-head">
                <h2>
                  <TrendingUp size={16} /> Insights from your own data
                </h2>
                {insights.hasEnoughData ? <Badge tone="success">on-device</Badge> : <Badge tone="neutral">learning</Badge>}
              </div>
              {!insights.hasEnoughData ? (
                <p className="muted">
                  Complete and time a few tasks to unlock your sharpest hour and estimate-bias insights. Small samples are
                  labelled rather than guessed.
                </p>
              ) : (
                <>
                  <div className="insight-row">
                    <span className="insight-icon">
                      <Clock size={16} />
                    </span>
                    <div>
                      <strong>
                        {insights.sharpestHour
                          ? `Sharpest working hour: ${String(insights.sharpestHour.hour).padStart(2, '0')}:00`
                          : 'No tracked sessions yet'}
                      </strong>
                      <p className="muted">
                        {insights.sharpestHour
                          ? `${formatDuration(insights.sharpestHour.minutes)} tracked in that hour across your sessions.`
                          : 'Start a timer to build this picture.'}
                      </p>
                    </div>
                  </div>
                  {insights.bias.length === 0 ? (
                    <p className="muted">No category has 3+ completed timed tasks yet, so no estimate bias is claimed.</p>
                  ) : (
                    <ul className="bias-list">
                      {insights.bias.map((entry) => (
                        <li key={entry.category}>
                          <span className={`bias-dot ${entry.direction}`} aria-hidden="true" />
                          <div>
                            <strong>{CATEGORIES[entry.category].label}</strong>
                            <p className="muted">
                              {entry.direction === 'under'
                                ? `Takes ${Math.abs(entry.differencePct)}% longer than you estimate`
                                : entry.direction === 'over'
                                  ? `Finishes ${Math.abs(entry.differencePct)}% faster than you estimate`
                                  : 'Estimates are within 10% — well calibrated'}
                              {' · '}
                              {entry.samples} sample{entry.samples === 1 ? '' : 's'}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </section>

            <section className="card">
              <div className="section-head">
                <h2>What things really take you</h2>
                <Badge tone="neutral">median</Badge>
              </div>
              {insights.durations.length === 0 ? (
                <p className="muted">Track time on completed tasks to see real durations per category.</p>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Category</th>
                      <th scope="col">Samples</th>
                      <th scope="col">Estimate</th>
                      <th scope="col">Actual</th>
                    </tr>
                  </thead>
                  <tbody>
                    {insights.durations.map((entry) => (
                      <tr key={entry.category}>
                        <td>{CATEGORIES[entry.category].label}</td>
                        <td>{entry.samples}</td>
                        <td>{formatDuration(entry.medianEstimate)}</td>
                        <td>{formatDuration(entry.medianActual)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div className="learning-summary">
                <h3>Duration learning</h3>
                {learning.totalSamples === 0 ? (
                  <p className="muted">Needs 3+ timed tasks in a category or client before the scheduler uses learned durations.</p>
                ) : (
                  <ul className="learning-list">
                    {Object.entries(learning.learned.byCategory).map(([category, minutes]) => (
                      <li key={category}>
                        <span>{CATEGORIES[category as keyof typeof CATEGORIES].label}</span>
                        <span>{formatDuration(minutes ?? 0)} learned</span>
                      </li>
                    ))}
                    {Object.entries(learning.learned.byClient).map(([client, minutes]) => (
                      <li key={client}>
                        <span>{client}</span>
                        <span>{formatDuration(minutes)} learned</span>
                      </li>
                    ))}
                  </ul>
                )}
                {learning.learned.factors && Object.keys(learning.learned.factors).length > 0 ? (
                  <div className="bias-notes">
                    <h4>Estimate bias, measured</h4>
                    <ul className="learning-list">
                      {Object.entries(learning.learned.factors).map(([category, factor]) => {
                        const samples =
                          learning.learned.samples?.byCategory[category as keyof typeof CATEGORIES] ?? 0;
                        return (
                          <li key={category}>
                            <span>{CATEGORIES[category as keyof typeof CATEGORIES].label}</span>
                            <span>
                              ×{factor} ({samples} samples) · plans use it
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                    <p className="fine-print">
                      Your estimates for these categories have run long or short by this much. Where a learned median
                      exists, the median wins; the factor only corrects plans that still rely on your estimate.
                    </p>
                  </div>
                ) : null}
                <ProgressBar
                  value={Math.min(100, learning.totalSamples * 10)}
                  label="Learning sample progress"
                  tone="success"
                />
                <p className="fine-print">
                  The scheduler labels learned durations and plans with them. Nothing is trained off-device.
                </p>
              </div>
            </section>
          </div>

          <section className="card">
            <h2>Week at a glance</h2>
            <div className="report-summary-grid">
              <div>
                <span>Open tasks</span>
                <strong>{report.openCount}</strong>
              </div>
              <div>
                <span>Overdue</span>
                <strong className={report.overdueCount > 0 ? 'danger-text' : ''}>{report.overdueCount}</strong>
              </div>
              <div>
                <span>Created this week</span>
                <strong>{report.createdCount}</strong>
              </div>
              <div>
                <span>Completed this week</span>
                <strong>{report.completedCount}</strong>
              </div>
              <div>
                <span>Estimated</span>
                <strong>{formatDuration(report.estimatedMinutes)}</strong>
              </div>
              <div>
                <span>Actual tracked</span>
                <strong>{formatDuration(report.actualMinutes)}</strong>
              </div>
            </div>
          </section>

          <section className="card replay-card" aria-label="Day replay">
            <div className="section-head">
              <h2>
                <Clock size={16} /> Day replay
              </h2>
              <select
                className="replay-date"
                aria-label="Day to replay"
                value={activeReplayDate}
                onChange={(event) => {
                  setReplayDate(event.target.value);
                  setReplayPos(null);
                  setReplayPlaying(false);
                }}
              >
                {replayDates.length === 0 ? <option value={activeReplayDate}>{formatDateShort(activeReplayDate)}</option> : null}
                {replayDates.map((date) => (
                  <option key={date} value={date}>
                    {formatDateShort(date)}
                  </option>
                ))}
              </select>
            </div>
            {!replayHasData ? (
              <EmptyState
                icon={Clock}
                title="Nothing to replay"
                message="No timer sessions were recorded on this day. Run a timer and the day will show up here as a timeline you can scrub."
              />
            ) : (
              <>
                <div className="replay-track" aria-hidden="true">
                  {replay.spans.map((span) => (
                    <span
                      key={`${span.taskId}-${span.startMs}`}
                      className="replay-span"
                      style={{
                        left: `${replayPercent(span.startMs)}%`,
                        width: `${Math.max(0.6, replayPercent(span.endMs) - replayPercent(span.startMs))}%`,
                      }}
                      title={`${span.title} · ${formatDuration(span.minutes)}`}
                    />
                  ))}
                  {replay.marks.map((mark) => (
                    <span
                      key={`mark-${mark.atMs}`}
                      className="replay-mark"
                      style={{ left: `${replayPercent(mark.atMs)}%` }}
                      title={`${mark.title} — completed`}
                    />
                  ))}
                  <span className="replay-head" style={{ left: `${replayPercent(playhead)}%` }} />
                </div>
                <input
                  className="replay-slider"
                  type="range"
                  min={replay.startMs}
                  max={replay.endMs}
                  step={60_000}
                  value={playhead}
                  aria-label={`Scrub ${formatDateShort(replay.date)}`}
                  onChange={(event) => {
                    setReplayPos(Number(event.target.value));
                    setReplayPlaying(false);
                  }}
                />
                <div className="replay-readout">
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={Play}
                    onClick={() => {
                      if (playhead >= replay.endMs) setReplayPos(replay.startMs);
                      setReplayPlaying((current) => !current);
                    }}
                  >
                    {replayPlaying ? 'Pause' : 'Play'}
                  </Button>
                  <span className="replay-now">
                    <Clock size={13} aria-hidden="true" /> {formatClock(new Date(playhead))} ·{' '}
                    {nowAt ? nowAt.title : 'free time'}
                  </span>
                  <span className="muted">{formatDuration(replay.workMinutes)} tracked this day</span>
                </div>
                <p className="fine-print">
                  Built from timer sessions saved on this device — spans are work sessions, ticks are completions. Snapshots
                  don’t count.
                </p>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
