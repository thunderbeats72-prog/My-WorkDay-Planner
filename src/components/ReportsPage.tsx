import { ChartColumn as ChartIcon, Clock, Download, Target, TrendingUp } from 'lucide-react';
import { CATEGORIES } from '../lib/types';
import { formatDuration, humanDateRange, percent } from '../lib/dates';
import { buildWeeklyReport } from '../lib/reports';
import { buildInsights, learnDurations } from '../lib/ml';
import type { CommonPageProps } from './pageProps';
import { Badge, Button, EmptyState, ProgressBar, StatCard } from './ui';
import { PageHeader } from './Shell';

export function ReportsPage({ tasks, now, timer, addToast, onExportCsv }: CommonPageProps & { onExportCsv: () => void }) {
  const report = buildWeeklyReport(tasks, timer.sessions, now);
  const insights = buildInsights(tasks, timer.sessions);
  const learning = learnDurations(tasks, timer.sessions);
  const maxDayMinutes = Math.max(1, ...report.byDay.map((day) => day.focusMinutes));
  const maxCategoryMinutes = Math.max(1, ...report.byCategory.map((entry) => Math.max(entry.estimatedMinutes, entry.actualMinutes)));
  const estimateAccuracy =
    report.estimatedMinutes > 0 && report.actualMinutes > 0
      ? Math.round((report.estimatedMinutes / report.actualMinutes) * 100)
      : null;

  return (
    <div className="page">
      <PageHeader
        eyebrow={`Weekly report · ${report.rangeLabel}`}
        title="Reports"
        description="Built from real saved data only. Where there is not enough history, this page says so instead of guessing."
        actions={
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
        }
      />

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
    </div>
  );
}
