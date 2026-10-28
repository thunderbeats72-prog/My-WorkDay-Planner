import { describe, expect, it } from 'vitest';
import { deadlineKey, nextReminderRecordTimestamp, prepareReminderTaskEdit, reminderCandidates, taskDeadline, wallTimeToInstant } from './reminderSchedule';
import { DEFAULT_SETTINGS, type Settings, type Task } from './types';

const settings: Settings = {
  ...DEFAULT_SETTINGS, notificationsEnabled: true, quietHoursEnabled: false,
  dailyDigestEnabled: false, reminderTimeZone: 'UTC', reminderRepeatMinutes: 30,
};
function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1', title: 'Send proposal', notes: 'Keep this', client: 'Acme', category: 'proposal', priority: 'high',
    estimatedMinutes: 30, actualMinutes: 0, dueDate: '2026-10-28', dueTime: '10:02', scheduledFor: null,
    suggestedDate: null, suggestedStart: null, status: 'todo', blocked: false, dependencyIds: [], deferrals: 0,
    createdAt: '2026-10-28T09:00:00.000Z', updatedAt: '2026-10-28T09:00:00.000Z',
    completedAt: null, deletedAt: null, source: 'manual', graphRef: null, ...overrides,
  };
}
const at = (time: string) => new Date(`2026-10-28T${time}:00.000Z`);
const run = (tasks: Task[], time: string, s = settings) => reminderCandidates({ tasks, settings: s }, at(time));

describe('persistent reminder rules', () => {
  it('includes a task created two minutes before its deadline, then due and overdue', () => {
    const work = task();
    const upcoming = run([work], '10:00');
    expect(upcoming.map((item) => item.category)).toEqual(['upcoming']);
    expect(upcoming[0].body).toContain('2 minutes');
    expect(run([work], '10:02')[0]).toMatchObject({ category: 'due', title: 'Task due now' });
    expect(run([work], '10:03')[0]).toMatchObject({ category: 'overdue', title: 'Overdue task' });
  });

  it('emits distinct 30-minute and 5-minute stages and one slot per overdue interval', () => {
    const work = task({ dueTime: '11:00' });
    expect(run([work], '10:29')).toHaveLength(0);
    const thirty = run([work], '10:30')[0];
    const five = run([work], '10:55')[0];
    const due = run([work], '11:00')[0];
    const late = run([work], '11:01')[0];
    const again = run([work], '11:30')[0];
    expect([thirty, five, due, late, again].map((item) => item.category)).toEqual(['upcoming', 'upcoming', 'due', 'overdue', 'overdue']);
    expect(new Set([thirty, five, due, late, again].map((item) => item.key)).size).toBe(5);
    expect(run([work], '11:45')[0].key).toBe(again.key);
  });

  it('disabling repeats keeps the first overdue event but not new keys', () => {
    const work = task({ dueTime: '10:00' });
    const noRepeats = { ...settings, reminderRepeatMinutes: 0 };
    expect(run([work], '10:01', noRepeats)[0].key).toBe(run([work], '18:30', noRepeats)[0].key);
  });

  it('stops completed, deleted and archived work; a reopen gets a new generation', () => {
    const work = task({ dueTime: '10:00' });
    const original = run([work], '10:30')[0];
    const done = task({ dueTime: '10:00', status: 'completed', completedAt: '2026-10-28T10:29:00.000Z' });
    expect(run([done], '10:30').map((item) => item.category)).toEqual(['completed']);
    expect(run([done], '11:30')).toEqual([]);
    expect(run([task({ deletedAt: '2026-10-28T10:00:00Z' })], '10:30')).toEqual([]);
    expect(run([{ ...work, archivedAt: '2026-10-28T10:00:00Z' } as Task], '10:30')).toEqual([]);
    const reopened = { ...work, reminderCycle: '2026-10-28T10:29:00.000Z' };
    expect(run([reopened], '10:30')[0].key).not.toBe(original.key);
  });

  it('gives immediate reopen or reschedule edits a strictly newer timestamp and reminder cycle', () => {
    const completed = task({ status: 'completed', completedAt: '2026-10-28T10:00:00.000Z',
      updatedAt: '2026-10-28T10:00:00.000Z', reminderCycle: '2026-10-28T10:00:00.000Z' });
    const reopened = prepareReminderTaskEdit({ ...completed, status: 'todo', completedAt: null }, completed, at('10:00').getTime());
    expect(reopened.updatedAt).toBe('2026-10-28T10:00:00.001Z');
    expect(reopened.reminderCycle).toBe(reopened.updatedAt);
    const moved = prepareReminderTaskEdit({ ...reopened, dueTime: '12:00' }, reopened, at('10:00').getTime());
    expect(moved.updatedAt).toBe('2026-10-28T10:00:00.002Z');
    expect(moved.reminderCycle).not.toBe(reopened.reminderCycle);
  });

  it('invalidates an old deadline without modifying any task fields', () => {
    const work = task({ dueTime: '10:00' });
    const old = run([work], '10:01')[0];
    const changed = { ...work, dueDate: '2026-10-29', reminderCycle: '2026-10-28T10:01:00Z' };
    expect(run([changed], '10:01')).toEqual([]);
    expect(work.notes).toBe('Keep this');
    expect(old.deadlineKey).not.toBe(deadlineKey(changed, settings));
  });

  it('ignores an old cycle’s snooze after reopening but honors a new snooze or dismissal', () => {
    const reopened = task({ dueTime: '10:00', reminderCycle: '2026-10-28T10:05:00.000Z' });
    const old = { id: 'legacy', taskId: reopened.id, dueAt: '2026-10-28T10:00:00.000Z', status: 'queued' as const,
      snoozedUntil: '2026-10-28T10:30:00.000Z', createdAt: '2026-10-28T09:00:00.000Z', updatedAt: '2026-10-28T10:01:00.000Z' };
    const base = { tasks: [reopened], settings };
    expect(reminderCandidates({ ...base, reminderRecords: [old] }, at('10:10'))[0].category).toBe('overdue');
    const newAt = nextReminderRecordTimestamp(reopened, old, at('10:05').getTime());
    expect(newAt).toBe('2026-10-28T10:05:00.001Z');
    expect(reminderCandidates({ ...base, reminderRecords: [{ ...old, updatedAt: newAt }] }, at('10:10'))).toEqual([]);
    expect(reminderCandidates({ ...base, reminderRecords: [{ ...old, status: 'dismissed', updatedAt: newAt }] }, at('10:10'))).toEqual([]);
  });

  it('suppresses snoozed events and resumes once, anchored to the snooze', () => {
    const work = task({ dueTime: '10:00' });
    const snooze = [{ taskId: work.id, deadlineKey: deadlineKey(work, settings)!, until: '2026-10-28T10:20:00.000Z' }];
    const snapshot = { tasks: [work], settings };
    expect(reminderCandidates(snapshot, at('10:19'), snooze)).toEqual([]);
    const resumed = reminderCandidates(snapshot, at('10:20'), snooze)[0];
    expect(resumed.category).toBe('overdue');
    expect(reminderCandidates(snapshot, at('10:49'), snooze)[0].key).toBe(resumed.key);
    expect(reminderCandidates(snapshot, at('10:50'), snooze)[0].key).not.toBe(resumed.key);
    expect(reminderCandidates({ ...snapshot, tasks: [{ ...work, dueTime: '11:00' }] }, at('10:30'), snooze)[0].category).toBe('upcoming');
  });

  it('catches a missed snooze expiry even when repeating alerts are disabled', () => {
    const work = task({ dueTime: '10:00' });
    const snooze = [{ taskId: work.id, deadlineKey: deadlineKey(work, settings)!, until: '2026-10-28T10:20:00.000Z' }];
    const snapshot = { tasks: [work], settings: { ...settings, reminderRepeatMinutes: 0 } };
    const afterOutage = reminderCandidates(snapshot, at('11:00'), snooze)[0];
    expect(afterOutage.category).toBe('overdue');
    expect(reminderCandidates(snapshot, at('12:00'), snooze)[0].key).toBe(afterOutage.key);
  });

  it('resumes the 30-minute, 5-minute and due stages after a snooze that ends before the deadline', () => {
    const work = task({ dueTime: '11:00' });
    const snooze = [{ taskId: work.id, deadlineKey: deadlineKey(work, settings)!, until: '2026-10-28T10:20:00.000Z' }];
    const snapshot = { tasks: [work], settings };
    expect(reminderCandidates(snapshot, at('10:20'), snooze)[0].title).toBe('Snoozed task');
    expect(reminderCandidates(snapshot, at('10:30'), snooze)[0].key).toContain('before:30');
    expect(reminderCandidates(snapshot, at('10:55'), snooze)[0].key).toContain('before:5');
    expect(reminderCandidates(snapshot, at('11:00'), snooze)[0].category).toBe('due');
    expect(reminderCandidates(snapshot, at('11:01'), snooze)[0].category).toBe('overdue');
    const noRepeat = { ...snapshot, settings: { ...settings, reminderRepeatMinutes: 0 } };
    expect(reminderCandidates(noRepeat, at('11:01'), snooze)[0].category).toBe('overdue');
  });

  it('combines overdue and no-date tasks into a once-per-local-day summary', () => {
    const digestSettings = { ...settings, dailyDigestEnabled: true, digestTime: '09:30', reminderTimeZone: 'Asia/Kolkata' };
    const undated = task({ id: 'no-date', title: 'Schedule the demo', dueDate: null });
    const late = task({ id: 'late', dueDate: '2026-10-27', dueTime: '10:00' });
    const candidates = reminderCandidates({ tasks: [undated, late], settings: digestSettings }, new Date('2026-10-28T04:00:00.000Z'));
    const summary = candidates.find((item) => item.category === 'summary');
    expect(summary?.body).toMatch(/2 tasks still open.*1 overdue.*1 with no date/);
    expect(summary?.body).toContain('Schedule the demo');
    expect(summary?.key).toContain('2026-10-28');
    expect(taskDeadline(task({ dueTime: '' }), digestSettings)?.toISOString()).toBe('2026-10-28T04:00:00.000Z');
  });

  it('catches up with the latest slot, and respects quiet hours and upcoming preferences', () => {
    const work = task({ dueTime: '09:00' });
    const latest = run([work], '18:32')[0];
    expect(latest.category).toBe('overdue');
    expect(run([work], '18:33')).toHaveLength(1);
    expect(run([work], '21:00', { ...settings, quietHoursEnabled: true })).toEqual([]);
    expect(run([task({ dueTime: '11:00' })], '10:30', { ...settings, reminderThirtyMinutes: false })).toEqual([]);
  });

  it('interprets IANA daylight-saving gaps and folds deterministically', () => {
    expect(wallTimeToInstant('2026-03-08', '02:30', 'America/New_York')?.toISOString()).toBe('2026-03-08T07:30:00.000Z');
    expect(wallTimeToInstant('2026-11-01', '01:30', 'America/New_York')?.toISOString()).toBe('2026-11-01T05:30:00.000Z');
    expect(wallTimeToInstant('2026-02-30', '09:00', 'UTC')).toBeNull();
  });
});
