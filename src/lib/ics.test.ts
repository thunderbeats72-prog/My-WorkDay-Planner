import { describe, expect, it } from 'vitest';
import { addMinutes, buildFoldedIcs, buildIcs, calendarTasks, escapeText, floatingStamp, foldLine, nextDay, utcStamp } from './ics';
import type { Task } from './types';

function task(over: Partial<Task> = {}): Task {
  return {
    id: 'tsk_1',
    title: 'Send proposal',
    notes: '',
    client: 'Nova; Ltd',
    category: 'proposal',
    priority: 'high',
    estimatedMinutes: 45,
    actualMinutes: 0,
    dueDate: '2026-10-24',
    dueTime: '15:00',
    scheduledFor: null,
    suggestedDate: '2026-10-24',
    suggestedStart: '10:00',
    status: 'open',
    blocked: false,
    dependencyIds: [],
    deferrals: 0,
    createdAt: '2026-10-20T09:00:00.000Z',
    updatedAt: '2026-10-20T09:00:00.000Z',
    completedAt: null,
    deletedAt: null,
    source: 'manual',
    graphRef: null,
    ...over,
  } as Task;
}

describe('calendar export', () => {
  it('only ships tasks that have a real moment', () => {
    expect(calendarTasks([task(), task({ id: 'x', suggestedDate: null, dueDate: null })]).map((t) => t.id)).toEqual([
      'tsk_1',
    ]);
    expect(calendarTasks([task({ deletedAt: '2026-10-21T00:00:00.000Z' })])).toEqual([]);
  });

  it('writes a structurally valid calendar with CRLF endings', () => {
    const ics = buildIcs([task()], { now: new Date('2026-10-23T08:00:00Z') });
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
    expect(ics).toContain('VERSION:2.0');
    expect(ics).toContain('PRODID:-//My Workday Planner//EN');
    expect(ics.split('BEGIN:VEVENT').length - 1).toBe(1);
    expect(ics.split('\n').every((line) => line.endsWith('\r') || line === '')).toBe(true);
  });

  it('prefers the planned slot over the raw deadline', () => {
    const ics = buildIcs([task()], { now: new Date('2026-10-23T08:00:00Z') });
    expect(ics).toContain('DTSTART:20261024T100000');
    // 10:00 + 45m estimate
    expect(ics).toContain('DTEND:20261024T104500');
    expect(ics).toContain('DTSTAMP:20261023T080000Z');
  });

  it('falls back to the deadline, then to an all-day block', () => {
    const deadlineOnly = buildIcs([task({ suggestedDate: null, suggestedStart: null })], {
      now: new Date('2026-10-23T08:00:00Z'),
    });
    expect(deadlineOnly).toContain('DTSTART:20261024T150000');

    const dayOnly = buildIcs([task({ suggestedDate: null, suggestedStart: null, dueTime: '' })], {
      now: new Date('2026-10-23T08:00:00Z'),
    });
    expect(dayOnly).toContain('DTSTART;VALUE=DATE:20261024');
    expect(dayOnly).toContain('DTEND;VALUE=DATE:20261025');
  });

  it('escapes the characters that break iCalendar', () => {
    expect(escapeText('a;b,c\nd\\e')).toBe('a\\;b\\,c\\nd\\\\e');
    const ics = buildIcs([task({ title: 'Call, confirm; bring notes' })], { now: new Date('2026-10-23T08:00:00Z') });
    expect(ics).toContain('SUMMARY:Call\\, confirm\\; bring notes');
    expect(ics).toContain('DESCRIPTION:Client: Nova\\; Ltd');
  });

  it('marks completed work as done', () => {
    const ics = buildIcs([task({ status: 'completed' })], { now: new Date('2026-10-23T08:00:00Z') });
    expect(ics).toContain('STATUS:COMPLETED');
    expect(ics).toContain('SUMMARY:✓ Send proposal');
  });

  it('folds long lines to the RFC limit with continuations', () => {
    const long = `SUMMARY:${'x'.repeat(200)}`;
    const folded = foldLine(long);
    for (const part of folded.split('\r\n')) expect(part.length).toBeLessThanOrEqual(74);
    expect(foldLine('short')).toBe('short');

    const ics = buildFoldedIcs([task({ title: 'y'.repeat(300) })], { now: new Date('2026-10-23T08:00:00Z') });
    for (const line of ics.split('\r\n')) expect(line.length).toBeLessThanOrEqual(74);
  });

  it('helper arithmetic behaves at the edges', () => {
    // An estimate that would cross midnight clamps instead of wrapping —
    // a DTEND before DTSTART in the same date is an invalid event.
    expect(addMinutes('23:59', 5)).toBe('23:59');
    expect(addMinutes('10:00', 45)).toBe('10:45');
    expect(nextDay('2026-10-31')).toBe('20261101');
    expect(floatingStamp('2026-10-24', '09:05')).toBe('20261024T090500');
    expect(utcStamp(new Date('2026-01-02T03:04:05.678Z'))).toBe('20260102T030405Z');
  });
});
