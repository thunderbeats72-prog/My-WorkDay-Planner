import { describe, expect, it } from 'vitest';
import type { BackupFile } from './db';
import { DEFAULT_SETTINGS } from './types';
import type { ReminderRecord, Task, TaskEvent, TimeSession } from './types';
import { describeMerge, mergeIsQuiet, mergeSnapshots, mergeTasks } from './snapshot';

function task(id: string, updatedAt: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    title: `Task ${id}`,
    notes: '',
    client: '',
    category: 'other',
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
    createdAt: '2026-01-01T09:00:00.000Z',
    updatedAt,
    completedAt: null,
    deletedAt: null,
    source: 'manual',
    graphRef: null,
    ...overrides,
  };
}

function snapshot(overrides: Partial<BackupFile> = {}): BackupFile {
  return {
    app: 'my-workday-planner',
    version: 1,
    exportedAt: '2026-01-01T00:00:00.000Z',
    settings: { ...DEFAULT_SETTINGS },
    tasks: [],
    timeSessions: [],
    reminderRecords: [],
    taskEvents: [],
    ...overrides,
  };
}

describe('mergeTasks', () => {
  it('keeps a task edited on the phone and one edited on the laptop', () => {
    const local = [task('a', '2026-01-02T10:00:00.000Z', { title: 'Phone edit' })];
    const remote = [task('b', '2026-01-02T11:00:00.000Z')];
    const merged = mergeTasks(local, remote);
    expect(merged.tasks.map((entry) => entry.id).sort()).toEqual(['a', 'b']);
    expect(merged.added).toBe(1);
  });

  it('takes the newer copy of the same task', () => {
    const local = [task('a', '2026-01-02T10:00:00.000Z', { title: 'Old' })];
    const remote = [task('a', '2026-01-02T12:00:00.000Z', { title: 'New' })];
    const merged = mergeTasks(local, remote);
    expect(merged.tasks[0].title).toBe('New');
    expect(merged.updated).toBe(1);
  });

  it('keeps the local copy when it is newer — an offline edit is not lost', () => {
    const local = [task('a', '2026-01-02T14:00:00.000Z', { title: 'Mine, newer' })];
    const remote = [task('a', '2026-01-02T09:00:00.000Z', { title: 'Theirs, older' })];
    const merged = mergeTasks(local, remote);
    expect(merged.tasks[0].title).toBe('Mine, newer');
    expect(merged.keptLocal).toBe(1);
  });

  it('propagates a completion made elsewhere', () => {
    const local = [task('a', '2026-01-02T09:00:00.000Z', { status: 'todo' })];
    const remote = [
      task('a', '2026-01-02T15:00:00.000Z', { status: 'completed', completedAt: '2026-01-02T15:00:00.000Z' }),
    ];
    expect(mergeTasks(local, remote).tasks[0].status).toBe('completed');
  });

  it('is lucky about equality: same timestamp keeps the local copy', () => {
    const local = [task('a', '2026-01-02T10:00:00.000Z', { title: 'Local' })];
    const remote = [task('a', '2026-01-02T10:00:00.000Z', { title: 'Remote' })];
    expect(mergeTasks(local, remote).tasks[0].title).toBe('Local');
  });
});

describe('mergeSnapshots', () => {
  it('unions sessions and events by id rather than duplicating them', () => {
    const session: TimeSession = {
      id: 's1',
      taskId: 'a',
      startedAt: '2026-01-02T09:00:00.000Z',
      endedAt: '2026-01-02T09:30:00.000Z',
      durationMs: 1_800_000,
      state: 'completed',
      lastHeartbeatAt: null,
      note: '',
    };
    const event: TaskEvent = { id: 'e1', taskId: 'a', at: '2026-01-02T09:00:00.000Z', type: 'created', detail: 'x' };
    const local = snapshot({ timeSessions: [session], taskEvents: [event] });
    const remote = snapshot({ timeSessions: [session], taskEvents: [event] });
    const { merged, stats } = mergeSnapshots(local, remote);
    expect(merged.timeSessions).toHaveLength(1);
    expect(merged.taskEvents).toHaveLength(1);
    expect(stats.sessionsAdded).toBe(0);
  });

  it('lets a dismissed reminder stay dismissed even if the other device still has it queued', () => {
    const queued: ReminderRecord = {
      id: 'r1',
      taskId: 'a',
      dueAt: '2026-01-02T09:00:00.000Z',
      status: 'queued',
      snoozedUntil: null,
      createdAt: '2026-01-02T08:00:00.000Z',
    };
    const dismissed: ReminderRecord = { ...queued, status: 'dismissed' };
    const { merged } = mergeSnapshots(
      snapshot({ reminderRecords: [queued] }),
      snapshot({ reminderRecords: [dismissed] }),
    );
    expect(merged.reminderRecords[0].status).toBe('dismissed');
  });

  it('follows the newest snapshot for settings, which have no per-field clock', () => {
    const local = snapshot({ exportedAt: '2026-01-02T10:00:00.000Z', settings: { ...DEFAULT_SETTINGS, name: 'Laptop' } });
    const remote = snapshot({ exportedAt: '2026-01-03T10:00:00.000Z', settings: { ...DEFAULT_SETTINGS, name: 'Phone' } });
    expect(mergeSnapshots(local, remote).merged.settings.name).toBe('Phone');
    expect(mergeSnapshots(remote, local).merged.settings.name).toBe('Phone');
  });

  it('is quiet when two devices already agree', () => {
    const same = snapshot({ tasks: [task('a', '2026-01-02T10:00:00.000Z')] });
    const first = mergeSnapshots(same, same);
    // The first merge reports the local copies as kept; a second pass is silent.
    expect(mergeIsQuiet(first.stats)).toBe(true);
    expect(describeMerge(first.stats)).toContain('already match');
  });

  it('describes what changed, in words a person reads', () => {
    const { stats } = mergeSnapshots(
      snapshot({ tasks: [task('a', '2026-01-02T10:00:00.000Z')] }),
      snapshot({ tasks: [task('a', '2026-01-02T10:00:00.000Z'), task('b', '2026-01-02T10:00:00.000Z')] }),
    );
    expect(describeMerge(stats)).toBe('1 new task');
  });
});
