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

  it('merges mutable timer sessions by their latest heartbeat or end instead of losing a pause', () => {
    const running: TimeSession = { id: 'timer', taskId: 'a', startedAt: '2026-01-02T10:00:00.000Z', endedAt: null,
      durationMs: 0, state: 'running', lastHeartbeatAt: '2026-01-02T10:00:00.000Z', note: '' };
    const paused: TimeSession = { ...running, startedAt: '2026-01-02T10:05:00.000Z', endedAt: '2026-01-02T10:05:00.000Z',
      lastHeartbeatAt: '2026-01-02T10:05:00.000Z', durationMs: 300000, state: 'paused' };
    const received = mergeSnapshots(snapshot({ timeSessions: [running] }), snapshot({ timeSessions: [paused] }));
    expect(received.merged.timeSessions[0]).toEqual(paused);
    expect(received.stats.sessionsUpdated).toBe(1);
    expect(mergeIsQuiet(received.stats)).toBe(false);
    const staleServer = mergeSnapshots(snapshot({ timeSessions: [paused] }), snapshot({ timeSessions: [running] }));
    expect(staleServer.merged.timeSessions[0]).toEqual(paused);
    expect(staleServer.stats.needsPush).toBe(true);
  });

  it('recognizes a newer snooze for an existing reminder as a local change to apply', () => {
    const older: ReminderRecord = { id: 'r', taskId: 'a', dueAt: '2026-01-02T10:00:00.000Z', status: 'queued',
      snoozedUntil: null, createdAt: '2026-01-02T09:00:00.000Z', updatedAt: '2026-01-02T09:00:00.000Z' };
    const later: ReminderRecord = { ...older, snoozedUntil: '2026-01-02T10:30:00.000Z', updatedAt: '2026-01-02T10:00:00.000Z' };
    const received = mergeSnapshots(snapshot({ reminderRecords: [older] }), snapshot({ reminderRecords: [later] }));
    expect(received.merged.reminderRecords[0]).toEqual(later);
    expect(received.stats.remindersUpdated).toBe(1);
    expect(mergeIsQuiet(received.stats)).toBe(false);
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

describe('convergence — the anti-ping-pong guarantee', () => {
  it('stops writing once both devices agree', () => {
    // Device A edits a task and pushes.
    const phone = snapshot({ tasks: [task('a', '2026-01-02T12:00:00.000Z', { title: 'From phone' })] });
    const laptop = snapshot({ tasks: [task('a', '2026-01-02T10:00:00.000Z', { title: 'Old' })] });

    const first = mergeSnapshots(laptop, phone);
    expect(first.merged.tasks[0].title).toBe('From phone');
    // The laptop's own copy was stale, so it adopts the phone's data and has
    // nothing to send back. Writing here is what would start the ping-pong.
    expect(first.stats.needsPush).toBe(false);

    // Replaying that exact merge must be a no-op: same inputs, same output.
    const replay = mergeSnapshots(first.merged, first.merged);
    expect(replay.stats.needsPush).toBe(false);
  });

  it('does not write when the server already has everything', () => {
    const server = snapshot({ tasks: [task('a', '2026-01-02T12:00:00.000Z')] });
    const client = snapshot({ tasks: [task('a', '2026-01-02T12:00:00.000Z')] });
    expect(mergeSnapshots(client, server).stats.needsPush).toBe(false);
  });

  it('writes when this device holds a genuinely newer task', () => {
    const client = snapshot({ tasks: [task('a', '2026-01-03T09:00:00.000Z', { title: 'Edited offline' })] });
    const server = snapshot({ tasks: [task('a', '2026-01-02T12:00:00.000Z', { title: 'Stale' })] });
    const result = mergeSnapshots(client, server);
    expect(result.stats.needsPush).toBe(true);
    expect(result.merged.tasks[0].title).toBe('Edited offline');
  });

  it('writes when this device has a task the server has never seen', () => {
    const client = snapshot({ tasks: [task('a', '2026-01-02T12:00:00.000Z'), task('b', '2026-01-02T13:00:00.000Z')] });
    const server = snapshot({ tasks: [task('a', '2026-01-02T12:00:00.000Z')] });
    expect(mergeSnapshots(client, server).stats.needsPush).toBe(true);
  });

  it('keeps the newest real change time instead of stamping "now"', () => {
    // Stamping "now" would make every device look like the newest writer, and
    // settings would ping-pong forever.
    const local = snapshot({ exportedAt: '2026-01-02T10:00:00.000Z' });
    const remote = snapshot({ exportedAt: '2026-01-05T10:00:00.000Z' });
    expect(mergeSnapshots(local, remote).merged.exportedAt).toBe('2026-01-05T10:00:00.000Z');
    expect(mergeSnapshots(remote, local).merged.exportedAt).toBe('2026-01-05T10:00:00.000Z');
  });

  it('converges two devices that edited different tasks at the same time', () => {
    const phone = snapshot({
      exportedAt: '2026-01-02T12:00:00.000Z',
      tasks: [task('a', '2026-01-02T12:00:00.000Z', { title: 'Phone edit' }), task('b', '2026-01-02T09:00:00.000Z')],
    });
    const laptop = snapshot({
      exportedAt: '2026-01-02T12:00:05.000Z',
      tasks: [task('a', '2026-01-02T09:00:00.000Z'), task('b', '2026-01-02T12:00:05.000Z', { title: 'Laptop edit' })],
    });

    const laptopMerges = mergeSnapshots(laptop, phone).merged;
    // The phone pulls the laptop's merged result and must be satisfied with it.
    const phoneMerges = mergeSnapshots(phone, laptopMerges);
    expect(phoneMerges.stats.needsPush).toBe(false);
    // Both devices now hold both edits.
    const titles = phoneMerges.merged.tasks.map((entry) => entry.title).sort();
    expect(titles).toEqual(['Laptop edit', 'Phone edit']);
  });
});
