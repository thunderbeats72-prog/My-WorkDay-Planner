import { describe, expect, it } from 'vitest';
import {
  buildDailyReport,
  dailyReportText,
  renderDailyReport,
  reportNoteOf,
  reportReasons,
  REPORT_FORMATS,
  strikethrough,
} from './dailyReport';
import type { Task } from './types';

const DAY = '2026-10-23';

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    title: 'Follow up with Narayani Group',
    notes: '',
    client: '',
    category: 'follow_up',
    priority: 'medium',
    estimatedMinutes: 30,
    actualMinutes: 0,
    dueDate: null,
    dueTime: '',
    scheduledFor: null,
    suggestedDate: null,
    suggestedStart: null,
    status: 'todo',
    blocked: false,
    dependencyIds: [],
    deferrals: 0,
    createdAt: `${DAY}T09:00:00.000Z`,
    updatedAt: `${DAY}T09:00:00.000Z`,
    completedAt: null,
    deletedAt: null,
    source: 'manual',
    graphRef: null,
    ...overrides,
  };
}

/** A task completed on the given day, at local noon (so the day never shifts). */
function completed(id: string, title: string, dateISO = DAY, extra: Partial<Task> = {}): Task {
  return task({
    id,
    title,
    status: 'completed',
    completedAt: new Date(`${dateISO}T12:00:00`).toISOString(),
    ...extra,
  });
}

describe('which tasks belong to a day', () => {
  it('includes tasks completed, due, added or noted on that day', () => {
    expect(reportReasons(completed('a', 'Done today'), DAY)).toEqual(['completed']);
    expect(reportReasons(task({ dueDate: DAY, createdAt: '2026-10-20T09:00:00.000Z' }), DAY)).toEqual(['due']);
    expect(reportReasons(task({ createdAt: `${DAY}T09:00:00.000Z` }), DAY)).toEqual(['added']);
    expect(
      reportReasons(task({ notesUpdatedAt: `${DAY}T15:00:00.000Z`, createdAt: '2026-10-20T09:00:00.000Z' }), DAY),
    ).toEqual(['note']);
  });

  it('never mixes another day into the report', () => {
    const yesterday = task({ createdAt: '2026-10-22T09:00:00.000Z', dueDate: '2026-10-22' });
    expect(reportReasons(yesterday, DAY)).toEqual([]);
    expect(reportReasons(completed('b', 'Done yesterday', '2026-10-22'), DAY)).toEqual([]);
  });

  it('does not let a completion from yesterday claim today', () => {
    /* Still open? No: completed yesterday, even though it is due today. */
    const doneYesterday = completed('c', 'Shipped it', '2026-10-22', { dueDate: DAY });
    expect(reportReasons(doneYesterday, DAY)).toEqual([]);
  });

  it('ignores deleted tasks entirely', () => {
    expect(reportReasons(task({ deletedAt: `${DAY}T10:00:00.000Z` }), DAY)).toEqual([]);
  });
});

describe('building the report', () => {
  it('separates completed from pending without inventing outcomes', () => {
    const report = buildDailyReport(
      [
        completed('a', 'Meet with Akshay Surgical', DAY, { dueTime: '12:00' }),
        task({ id: 'b', title: 'Check on Zoho CRM leads' }),
      ],
      DAY,
    );
    expect(report.completedCount).toBe(1);
    expect(report.pendingCount).toBe(1);
    expect(report.sections).toHaveLength(1);
    expect(report.sections[0].title).toBe('Priorities');
    expect(report.sections[0].lines.map((line) => line.task.title)).toEqual([
      'Meet with Akshay Surgical',
      'Check on Zoho CRM leads',
    ]);
  });

  it('keeps the order tasks were added in', () => {
    const report = buildDailyReport(
      [
        task({ id: 'late', title: 'Third', createdAt: `${DAY}T11:00:00.000Z` }),
        task({ id: 'early', title: 'First', createdAt: `${DAY}T09:00:00.000Z` }),
        task({ id: 'mid', title: 'Second', createdAt: `${DAY}T10:00:00.000Z` }),
      ],
      DAY,
    );
    expect(report.sections[0].lines.map((line) => line.task.title)).toEqual(['First', 'Second', 'Third']);
  });

  it('groups by the imported heading and puts the ungrouped list first', () => {
    const report = buildDailyReport(
      [
        task({ id: 'p1', title: 'Check on Zoho CRM leads' }),
        task({ id: 'g1', title: 'Mystery Bakers - Align a demo.', section: 'BizConnect Leads Follow-ups' }),
        task({ id: 'g2', title: 'Narayani Group - Align a meeting.', section: 'BizConnect Leads Follow-ups' }),
      ],
      DAY,
    );
    expect(report.sections.map((section) => section.title)).toEqual(['Priorities', 'BizConnect Leads Follow-ups']);
    expect(report.sections[1].lines).toHaveLength(2);
  });

  it('shows the completion note for a completed task and the task note otherwise', () => {
    const done = completed('a', 'Follow up with Mystery Bakers', DAY, {
      completionNote: 'Demo scheduled for next week.',
    });
    const pending = task({ id: 'b', title: 'Align a meeting with Narayani Group', notes: "Couldn't connect today." });

    expect(reportNoteOf(done)).toBe('Demo scheduled for next week.');
    expect(reportNoteOf(pending)).toBe("Couldn't connect today.");

    const report = buildDailyReport([done, pending], DAY);
    expect(report.noteCount).toBe(2);
  });

  it('prefers the completion note when a task has both', () => {
    const both = completed('a', 'Chase the invoice', DAY, {
      notes: 'old planning note',
      completionNote: 'Paid in full.',
    });
    expect(reportNoteOf(both)).toBe('Paid in full.');
  });

  it('reports an empty day as empty rather than as a template', () => {
    const report = buildDailyReport([], DAY);
    expect(report.hasTasks).toBe(false);
    expect(report.sections).toEqual([]);
    expect(renderDailyReport(report, 'whatsapp', { emptyText: 'Nothing today.' })).toBe('Nothing today.');
  });

  it('counts a note-only day as a real report', () => {
    const report = buildDailyReport(
      [task({ id: 'n', title: 'Narayani Group', notes: 'Follow up tomorrow.', notesUpdatedAt: `${DAY}T18:00:00.000Z` })],
      DAY,
    );
    expect(report.hasTasks).toBe(true);
    expect(report.noteCount).toBe(1);
  });
});

describe('rendering for each destination', () => {
  const model = () =>
    buildDailyReport(
      [
        completed('a', 'Meet with Akshay Surgical', DAY, { dueTime: '12:00' }),
        completed('b', 'Follow up on BizConnect leads'),
        task({ id: 'c', title: 'Check on Zoho CRM leads' }),
        task({ id: 'd', title: 'Align a meeting with Narayani Group', notes: "Didn't connect." }),
        task({ id: 'g1', title: 'Mystery Bakers - Align a demo.', section: 'BizConnect Leads Follow-ups', status: 'completed', completedAt: `${DAY}T13:00:00.000Z` }),
        task({
          id: 'g2',
          title: 'Narayani Group - Align a meeting.',
          section: 'BizConnect Leads Follow-ups',
          notes: 'Meeting could not be aligned today. Follow up tomorrow.',
        }),
      ],
      DAY,
    );

  it('writes the reference report in WhatsApp form', () => {
    expect(renderDailyReport(model(), 'whatsapp')).toBe(
      [
        'Priorities -',
        '',
        '~Meet with Akshay Surgical - 12 PM~',
        '~Follow up on BizConnect leads~',
        'Check on Zoho CRM leads',
        "Align a meeting with Narayani Group - Didn't connect.",
        '',
        'BizConnect Leads Follow-ups -',
        '',
        '- ~Mystery Bakers - Align a demo.~',
        '- Narayani Group - Align a meeting. - Meeting could not be aligned today. Follow up tomorrow.',
      ].join('\n'),
    );
  });

  it('uses double tildes for Markdown', () => {
    expect(renderDailyReport(model(), 'markdown')).toContain('~~Follow up on BizConnect leads~~');
  });

  it('falls back to words when the destination has no strikethrough', () => {
    const plain = renderDailyReport(model(), 'plain');
    expect(plain).toContain('[COMPLETED] Follow up on BizConnect leads');
    expect(plain).not.toContain('~');
    /* Pending titles stay untouched. */
    expect(plain).toContain('\nCheck on Zoho CRM leads');
  });

  it('leaves pending tasks unstruck in every format', () => {
    for (const format of ['whatsapp', 'markdown', 'plain'] as const) {
      const text = renderDailyReport(model(), format);
      expect(text).not.toMatch(/~Check on Zoho CRM leads/);
      expect(text).not.toMatch(/\[COMPLETED\] Check on Zoho CRM leads/);
    }
  });

  it('strikes the title but never the note', () => {
    const done = buildDailyReport(
      [completed('a', 'Follow up with Mystery Bakers', DAY, { completionNote: 'Demo scheduled for next week.' })],
      DAY,
    );
    const text = renderDailyReport(done, 'whatsapp');
    expect(text).toContain('~Follow up with Mystery Bakers~ - Demo scheduled for next week.');
  });

  it('keeps a multi-line note together under its task', () => {
    const report = buildDailyReport(
      [task({ id: 'n', title: 'Narayani Group', notes: 'Called twice.\nWill try tomorrow.' })],
      DAY,
    );
    expect(renderDailyReport(report, 'whatsapp')).toContain('Narayani Group - Called twice.\n   Will try tomorrow.');
  });

  it('adds a date heading only when asked', () => {
    const report = model();
    expect(renderDailyReport(report, 'whatsapp', { heading: 'Daily update — 23 Oct' })).toMatch(/^Daily update — 23 Oct/);
    expect(renderDailyReport(report, 'whatsapp')).toMatch(/^Priorities -/);
  });

  it('never duplicates a task or its note', () => {
    const text = renderDailyReport(model(), 'whatsapp');
    const occurrences = text.split('Align a meeting with Narayani Group').length - 1;
    expect(occurrences).toBe(1);
    expect(text.split("Didn't connect.").length - 1).toBe(1);
  });

  it('changes with the data it was built from, with no separate copy to sync', () => {
    const base = buildDailyReport([task({ id: 'x', title: 'Check Zoho', notes: 'first draft' })], DAY);
    const edited = buildDailyReport([task({ id: 'x', title: 'Check Zoho', notes: 'second draft' })], DAY);
    expect(renderDailyReport(base, 'plain')).toContain('first draft');
    expect(renderDailyReport(edited, 'plain')).toContain('second draft');
  });

  it('drops a note once it is cleared', () => {
    const withNote = buildDailyReport([task({ id: 'x', title: 'Check Zoho', notes: 'temporary' })], DAY);
    const cleared = buildDailyReport([task({ id: 'x', title: 'Check Zoho', notes: '' })], DAY);
    expect(renderDailyReport(withNote, 'plain')).toContain('temporary');
    expect(renderDailyReport(cleared, 'plain')).not.toContain('temporary');
  });
});

describe('formats offered to the user', () => {
  it('names all three destinations with an example of their marker', () => {
    expect(REPORT_FORMATS.map((format) => format.value)).toEqual(['whatsapp', 'markdown', 'plain']);
    expect(strikethrough('Done', 'whatsapp')).toBe('~Done~');
    expect(strikethrough('Done', 'markdown')).toBe('~~Done~~');
    expect(strikethrough('Done', 'plain')).toBe('[COMPLETED] Done');
  });

  it('gives the one-call helper the same text as building then rendering', () => {
    const tasks = [completed('a', 'One'), task({ id: 'b', title: 'Two' })];
    expect(dailyReportText(tasks, DAY, 'markdown')).toBe(
      renderDailyReport(buildDailyReport(tasks, DAY), 'markdown'),
    );
  });
});
