import { beforeEach, describe, expect, it } from 'vitest';
import {
  createBackupPayload,
  db,
  deleteReport,
  getReport,
  listReports,
  mergeCloudSnapshot,
  restoreBackup,
  saveReport,
  validateBackup,
} from './db';
import { DEFAULT_SETTINGS } from './types';
import type { SavedReport, Task } from './types';

/**
 * The storage promises the daily update sits on: one row per day, an old day is
 * never rewritten by a new one, and a backup carries the updates with it.
 */

function report(overrides: Partial<SavedReport> & { dateISO: string; text: string }): SavedReport {
  return {
    id: `r-${overrides.dateISO}`,
    format: 'whatsapp',
    updatedAt: `${overrides.dateISO}T18:00:00.000Z`,
    completedCount: 1,
    pendingCount: 1,
    ...overrides,
  };
}

beforeEach(async () => {
  if (!db.isOpen()) await db.open();
  await db.reports.clear();
  await db.taskEvents.clear();
  await db.tasks.clear();
});

describe('saved daily updates', () => {
  it('keeps one row per day, and saving the same day replaces only that day', async () => {
    await saveReport(report({ dateISO: '2026-10-21', text: 'Wednesday, first draft.' }));
    await saveReport(report({ dateISO: '2026-10-22', text: 'Thursday.' }));
    await saveReport({ ...report({ dateISO: '2026-10-21', text: 'Wednesday, rewritten.' }), id: 'second-attempt' });

    expect(await db.reports.count()).toBe(2);
    expect((await getReport('2026-10-21'))?.text).toBe('Wednesday, rewritten.');
    expect((await getReport('2026-10-22'))?.text).toBe('Thursday.');
  });

  it('lists the newest day first and deletes one day without touching the other', async () => {
    await saveReport(report({ dateISO: '2026-10-20', text: 'Tuesday.' }));
    await saveReport(report({ dateISO: '2026-10-22', text: 'Thursday.' }));

    expect((await listReports()).map((row) => row.dateISO)).toEqual(['2026-10-22', '2026-10-20']);

    await deleteReport('2026-10-22');
    expect(await getReport('2026-10-22')).toBeNull();
    expect((await getReport('2026-10-20'))?.text).toBe('Tuesday.');
  });
});

describe('backup round trip', () => {
  it('carries saved updates and restores one row per day', async () => {
    const payload = createBackupPayload(
      { ...DEFAULT_SETTINGS, id: 'app' },
      [],
      [],
      [],
      [],
      [report({ dateISO: '2026-10-21', text: 'Wednesday.' })],
    );
    expect(payload.reports).toHaveLength(1);

    const parsed = validateBackup(JSON.parse(JSON.stringify(payload)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    // Restoring on a device that already has a different update for that day
    // must not leave two rows behind for one date.
    await saveReport(report({ dateISO: '2026-10-21', text: 'Local draft.' }));
    await restoreBackup(parsed.data, 'merge');

    const rows = await db.reports.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toBe('Wednesday.');
  });

  it('still accepts a backup written before daily updates existed', async () => {
    const legacy = {
      app: 'my-workday-planner',
      version: 1,
      exportedAt: '2026-01-01T00:00:00.000Z',
      settings: { ...DEFAULT_SETTINGS, id: 'app' },
      tasks: [],
      timeSessions: [],
      reminderRecords: [],
      taskEvents: [],
    };
    const parsed = validateBackup(legacy);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.reports).toEqual([]);
    await expect(restoreBackup(parsed.data, 'merge')).resolves.toBeUndefined();
  });
});


describe('safe cloud merge', () => {
  it('reads the current local task inside the transaction and retains edits made while a pull was in flight', async () => {
    const task = { id: 'a', title: 'Before', notes: 'keep notes', updatedAt: '2026-01-02T10:00:00.000Z' } as Task;
    const stalePull = createBackupPayload({ ...DEFAULT_SETTINGS }, [task, { ...task, id: 'b', title: 'Remote task' }], [], [], []);
    stalePull.exportedAt = '2026-01-02T10:00:00.000Z';
    await db.tasks.put({ ...task, title: 'Edited during network wait', updatedAt: '2026-01-02T11:00:00.000Z' });
    const { merged } = await mergeCloudSnapshot(stalePull, () => '2026-01-02T11:00:00.000Z');
    expect(merged.tasks.find((row) => row.id === 'a')).toMatchObject({ title: 'Edited during network wait', notes: 'keep notes' });
    expect((await db.tasks.toArray()).map((row) => row.id).sort()).toEqual(['a', 'b']);
  });

  it('preserves one saved report per date when another device uses a different id', async () => {
    await saveReport(report({ dateISO: '2026-10-21', text: 'Local draft', updatedAt: '2026-10-21T18:00:00.000Z' }));
    const remoteReport = report({ id: 'remote-id', dateISO: '2026-10-21', text: 'Remote edit', updatedAt: '2026-10-21T19:00:00.000Z' });
    const remote = createBackupPayload({ ...DEFAULT_SETTINGS }, [], [], [], [], [remoteReport]);
    await mergeCloudSnapshot(remote, () => '1970-01-01T00:00:00.000Z');
    expect(await db.reports.toArray()).toEqual([remoteReport]);
  });
});
