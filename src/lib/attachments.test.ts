import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import {
  ATTACHMENT_LIMITS,
  base64ToBlob,
  blobToBase64,
  bytesToHex,
  compressPhoto,
  formatBytes,
  hexToBytes,
  listAllAttachments,
  listAttachments,
  markAttachmentsSynced,
  microphoneErrorText,
  purgeAttachments,
  saveAttachment,
  storePulledAttachment,
  tombstoneAttachment,
  voiceRecorderSupported,
  type AttachmentRecord,
} from './attachments';
import { planAttachmentSync } from './attachmentSync';
import { validAttachmentId } from './attachmentLimits';

/**
 * Attachments sync in two halves: decisions (pure, here) and transport (the
 * API route, exercised through the same functions the browser calls). The
 * decisions are where a resurrection or a lost file would come from, so they
 * are tested without a network in the same style as the snapshot merge.
 */

function record(over: Partial<AttachmentRecord> = {}): AttachmentRecord {
  return {
    id: 'att_00000000-0000-4000-8000-000000000001',
    taskId: 'tsk_1',
    kind: 'photo',
    mime: 'image/jpeg',
    size: 1000,
    durationMs: null,
    createdAt: '2026-10-23T08:00:00.000Z',
    deletedAt: null,
    synced: false,
    blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }),
    ...over,
  };
}

function meta(row: AttachmentRecord) {
  const { deletedAt: _deletedAt, synced: _synced, blob: _blob, ...rest } = row;
  return rest;
}

describe('the sync planner', () => {
  it('pushes what the server has never seen', () => {
    const plan = planAttachmentSync([record()], []);
    expect(plan.push.map((row) => row.id)).toEqual([record().id]);
    expect(plan.pull).toEqual([]);
    expect(plan.remove).toEqual([]);
    expect(plan.purge).toEqual([]);
  });

  it('pulls what the device has never seen', () => {
    const plan = planAttachmentSync([], [meta(record())]);
    expect(plan.pull.map((row) => row.id)).toEqual([record().id]);
    expect(plan.push).toEqual([]);
  });

  it('does nothing when both sides already agree', () => {
    const row = record({ synced: true });
    const plan = planAttachmentSync([row], [meta(row)]);
    expect(plan).toEqual({ push: [], pull: [], remove: [], markSynced: [], purge: [] });
  });

  it('honours a local tombstone against a server that still holds the file', () => {
    const row = record({ synced: true, deletedAt: '2026-10-23T09:00:00.000Z', blob: null });
    const plan = planAttachmentSync([row], [meta(row)]);
    expect(plan.remove).toEqual([row.id]);
    expect(plan.pull).toEqual([]); // a delete in flight must not re-download
    expect(plan.purge).toEqual([]);
  });

  it('drops a tombstone the server never heard of without a round trip', () => {
    const row = record({ synced: false, deletedAt: '2026-10-23T09:00:00.000Z', blob: null });
    const plan = planAttachmentSync([row], []);
    expect(plan.remove).toEqual([]);
    expect(plan.purge).toEqual([row.id]);
  });

  it('still deletes on the server when only the other device had pushed it', () => {
    // Local row was created here, pushed by another tab before the tombstone
    // landed: the server copy exists under the same id, so the delete must go.
    const row = record({ synced: false, deletedAt: '2026-10-23T09:00:00.000Z', blob: null });
    const plan = planAttachmentSync([row], [meta(row)]);
    expect(plan.remove).toEqual([row.id]);
    expect(plan.pull).toEqual([]);
  });

  it('propagates a deletion made on another device', () => {
    const row = record({ synced: true });
    const plan = planAttachmentSync([row], []);
    expect(plan.purge).toEqual([row.id]);
    expect(plan.push).toEqual([]); // never re-upload what the server deleted
  });

  it('flags an unregistered local copy the server already has', () => {
    const row = record({ synced: false });
    const plan = planAttachmentSync([row], [meta(row)]);
    expect(plan.markSynced).toEqual([row.id]);
    expect(plan.push).toEqual([]);
    expect(plan.pull).toEqual([]);
  });

  it('handles a mixed shelf in one pass', () => {
    const mine = record({ id: 'att_a', synced: true });
    const theirs = record({ id: 'att_b', synced: true });
    const newLocal = record({ id: 'att_c' });
    const goneLocal = record({ id: 'att_d', synced: true, deletedAt: '2026-10-23T09:00:00.000Z', blob: null });
    const missingRemote = record({ id: 'att_e', synced: true });
    const newRemote = record({ id: 'att_f', synced: true });

    const plan = planAttachmentSync(
      [mine, theirs, newLocal, goneLocal, missingRemote],
      [meta(mine), meta(theirs), meta(goneLocal), meta(newRemote)],
    );

    expect(plan.push.map((row) => row.id)).toEqual(['att_c']);
    expect(plan.pull.map((row) => row.id)).toEqual(['att_f']);
    expect(plan.remove).toEqual(['att_d']);
    expect(plan.purge).toEqual(['att_e']);
    expect(plan.markSynced).toEqual([]);
  });
});

describe('the local store', () => {
  beforeEach(async () => {
    await db.attachments.clear();
  });

  const tiny = () => new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/jpeg' });

  it('saves, lists, and reports usage for one task', async () => {
    const saved = await saveAttachment({ taskId: 'tsk_1', kind: 'photo', mime: 'image/jpeg', blob: tiny() });
    expect(saved.id).toMatch(/^att_/);
    expect(saved.synced).toBe(false);
    expect(saved.blob).not.toBeNull();

    const rows = await listAttachments('tsk_1');
    expect(rows.map((row) => row.id)).toEqual([saved.id]);

    const other = await listAttachments('tsk_2');
    expect(other).toEqual([]);

    const usage = await db.attachments.count();
    expect(usage).toBe(1);
  });

  it('rejects a file over the per-file cap before it is stored', async () => {
    await expect(
      saveAttachment({
        taskId: 'tsk_1',
        kind: 'photo',
        mime: 'image/jpeg',
        blob: new Blob([new Uint8Array(ATTACHMENT_LIMITS.maxFileBytes + 1)], { type: 'image/jpeg' }),
      }),
    ).rejects.toThrow(/limit/i);
    expect(await db.attachments.count()).toBe(0);
  });

  it('enforces the per-account byte quota', async () => {
    // Simulate an already-full shelf directly — rows carry sizes far beyond
    // what the capture path would accept, which is exactly the state the
    // quota exists to prevent.
    for (let i = 0; i < 5; i += 1) {
      await db.attachments.put(record({ id: `att_full${i}`, size: 9_000_000 }));
    }
    await expect(
      saveAttachment({ taskId: 'tsk_1', kind: 'photo', mime: 'image/jpeg', blob: tiny() }),
    ).rejects.toThrow(/full/i);
  });

  it('tombstones keep the id and drop the bytes until purge', async () => {
    const saved = await saveAttachment({ taskId: 'tsk_1', kind: 'photo', mime: 'image/jpeg', blob: tiny() });
    await markAttachmentsSynced([saved.id]);
    await tombstoneAttachment(saved.id);

    expect(await listAttachments('tsk_1')).toEqual([]);
    const [tombstone] = await listAllAttachments();
    expect(tombstone.deletedAt).not.toBeNull();
    expect(tombstone.blob).toBeNull();
    expect(tombstone.synced).toBe(true);

    await purgeAttachments([saved.id]);
    expect(await listAllAttachments()).toEqual([]);
  });

  it('a pulled copy never overwrites a local tombstone', async () => {
    const saved = await saveAttachment({ taskId: 'tsk_1', kind: 'photo', mime: 'image/jpeg', blob: tiny() });
    await tombstoneAttachment(saved.id);
    await storePulledAttachment(meta(record({ id: saved.id })), tiny());

    const [row] = await listAllAttachments();
    expect(row.deletedAt).not.toBeNull(); // the delete still wins
    expect(row.blob).toBeNull();
  });

  it('stores a pulled copy as already synced', async () => {
    await storePulledAttachment(meta(record({ id: 'att_pulled' })), tiny());
    const [row] = await listAllAttachments();
    expect(row.synced).toBe(true);
    expect(await listAttachments('tsk_1')).toHaveLength(1);
  });
});

describe('capture and transport', () => {
  it('stores a small photo as-is instead of re-encoding it', async () => {
    const file = new Blob([new Uint8Array(1000)], { type: 'image/jpeg' });
    const result = await compressPhoto(file);
    expect(result).toBe(file); // no canvas in jsdom, and none needed
  });

  it('reports honestly that this environment cannot record', () => {
    expect(voiceRecorderSupported()).toBe(false);
  });

  it('turns a blocked microphone into an actionable sentence', () => {
    const error = new DOMException('denied', 'NotAllowedError');
    expect(microphoneErrorText(error)).toMatch(/microphone access/i);
    expect(microphoneErrorText(new Error('mystery'))).toMatch(/microphone/i);
  });

  it('round-trips base64 through the same bytes', async () => {
    const blob = new Blob([new Uint8Array([0, 1, 2, 250, 255])], { type: 'image/jpeg' });
    const encoded = await blobToBase64(blob);
    const decoded = base64ToBlob(encoded, 'image/jpeg');
    expect(decoded.size).toBe(blob.size);
    expect(new Uint8Array(await decoded.arrayBuffer())).toEqual(new Uint8Array([0, 1, 2, 250, 255]));
  });

  it('round-trips hex the way Postgres hands bytes back', () => {
    const bytes = new Uint8Array([0, 15, 16, 255, 128]);
    expect(hexToBytes(bytesToHex(bytes))).toEqual(bytes);
    expect(hexToBytes('\\x' + bytesToHex(bytes))).toEqual(bytes);
  });

  it('accepts the ids the app generates and rejects the rest', () => {
    expect(validAttachmentId('att_0f8c1f22-1234-4abc-9def-001122334455')).toBe(true);
    expect(validAttachmentId('att_m1abc234_xyz9876')).toBe(true); // no-randomUUID fallback
    expect(validAttachmentId('att_../../etc/passwd')).toBe(false);
    expect(validAttachmentId('x'.repeat(200))).toBe(false);
    expect(validAttachmentId(42)).toBe(false);
  });

  it('formats sizes the way the panel shows them', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(40_000)).toBe('40 KB');
    expect(formatBytes(2_400_000)).toBe('2.4 MB');
    expect(formatBytes(40_000_000)).toBe('40 MB');
  });
});
