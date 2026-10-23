/**
 * Attachment sync — photos and voice memos travelling between devices
 * without ever entering the snapshot.
 *
 * Why a second channel instead of putting bytes in the snapshot:
 *   · the snapshot is stringified and diffed per record on every sync, so a
 *     megabyte inside a task re-travels whenever a title is edited;
 *   · the serverless body cap is ~4.5 MB, so one unsqueezed camera photo would
 *     take down *all* sync for *every* device, not just its owner;
 *   · one Postgres row per user cannot grow to hold a camera roll.
 *
 * So each file is its own row and its own request, a few hundred kilobytes at
 * a time, and the planner below decides — in one pure function, so the
 * decisions are testable without a network — what this device owes the server
 * and what the server owes this device.
 *
 * Attachments are immutable after creation, which removes the whole class of
 * edit-conflict questions: the only operations are *new* and *gone*, and gone
 * is resolved by tombstones that outlive the bytes until the server confirms.
 */

import {
  ATTACHMENT_LIMITS,
  blobToBase64,
  base64ToBlob,
  listAllAttachments,
  markAttachmentsSynced,
  notifyAttachmentsChanged,
  purgeAttachments,
  storePulledAttachment,
  type AttachmentRecord,
  type AttachmentMeta,
} from './attachments';
import { loadCloudSession, neonEnabled } from './cloudSync';
import {
  neonAttachmentDelete,
  neonAttachmentGet,
  neonAttachmentList,
  neonAttachmentPut,
} from './neonBackend';

/** How many files one sync run moves — bounded so a first sign-in with a
 * large shelf of photos still returns in seconds, and the rest follows on the
 * next run. */
export const ATTACHMENT_SYNC_LIMIT = 30;

export interface AttachmentSyncPlan {
  /** Live rows the server has never seen. */
  push: AttachmentRecord[];
  /** Remote files this device is missing. */
  pull: AttachmentMeta[];
  /** Tombstones the server should delete. */
  remove: string[];
  /** Live rows whose bytes the server already holds — just flag them. */
  markSynced: string[];
  /** Local rows to drop: tombstones the server never heard of, and files
   * deleted from another device. */
  purge: string[];
}

/**
 * One pass of decisions from two lists. Pure by construction: no I/O, no
 * mutation — the caller executes each bucket and persists as it goes, so an
 * interrupted run resumes where it stopped instead of redoing work.
 */
export function planAttachmentSync(
  local: AttachmentRecord[],
  remote: AttachmentMeta[],
): AttachmentSyncPlan {
  const remoteById = new Map(remote.map((meta) => [meta.id, meta]));
  const localById = new Map(local.map((row) => [row.id, row]));
  const plan: AttachmentSyncPlan = { push: [], pull: [], remove: [], markSynced: [], purge: [] };

  for (const row of local) {
    if (row.deletedAt !== null) {
      // A tombstone the server knows about must be honoured there; one it
      // never saw needs nothing from the server and can go now.
      if (row.synced || remoteById.has(row.id)) plan.remove.push(row.id);
      else plan.purge.push(row.id);
      continue;
    }
    if (remoteById.has(row.id)) {
      // Same id on both sides means a push this device did not register (a
      // second tab, say). Immutable media: the server copy is the truth.
      if (!row.synced) plan.markSynced.push(row.id);
      continue;
    }
    if (row.synced) {
      // The server had it and no longer does: someone deleted it elsewhere.
      // Deletions propagate, same as they do for snapshots.
      plan.purge.push(row.id);
      continue;
    }
    plan.push.push(row);
  }

  for (const meta of remote) {
    if (!localById.has(meta.id)) plan.pull.push(meta);
  }

  return plan;
}

export interface AttachmentSyncResult {
  ok: boolean;
  pushed: number;
  pulled: number;
  removed: number;
  /** True when more files are waiting — the caller should run again shortly. */
  more: boolean;
  error?: string;
}

const IDLE: AttachmentSyncResult = { ok: true, pushed: 0, pulled: 0, removed: 0, more: false };

/** Am I actually in a state where bytes may travel? */
export function attachmentsShouldSync(): boolean {
  return neonEnabled() && loadCloudSession() !== null;
}

/**
 * One bounded round of attachment sync. Never throws: a failure returns the
 * error so the snapshot sync — the part that carries your actual tasks — is
 * never aborted by a photo that would not fit.
 */
export async function syncAttachments(): Promise<AttachmentSyncResult> {
  if (!attachmentsShouldSync()) return IDLE;
  const session = loadCloudSession();
  if (!session) return IDLE;
  const token = session.accessToken;

  try {
    const listed = await neonAttachmentList(token);
    if (!listed.ok) return { ...IDLE, ok: false, error: listed.error ?? 'Could not list attachments.' };

    const local = await listAllAttachments();
    const plan = planAttachmentSync(local, listed.data?.attachments ?? []);

    // Deletes first: it frees quota for whatever we are about to push.
    let removed = 0;
    const doomed = plan.remove.slice(0, ATTACHMENT_SYNC_LIMIT);
    for (let i = 0; i < doomed.length; i += 100) {
      const chunk = doomed.slice(i, i + 100);
      const deleted = await neonAttachmentDelete(token, chunk);
      if (!deleted.ok) {
        return finish({ ...IDLE, ok: false, removed, error: deleted.error ?? 'Could not delete an attachment.' });
      }
      await purgeAttachments(chunk);
      removed += chunk.length;
    }

    let pushed = 0;
    const toPush = plan.push.filter((record) => record.blob).slice(0, ATTACHMENT_SYNC_LIMIT);
    for (const record of toPush) {
      const data = await blobToBase64(record.blob as Blob);
      const put = await neonAttachmentPut(token, {
        id: record.id,
        taskId: record.taskId,
        kind: record.kind,
        mime: record.mime,
        size: record.size,
        durationMs: record.durationMs,
        createdAt: record.createdAt,
        data,
      });
      if (!put.ok) {
        return finish({ ...IDLE, ok: false, pushed, removed, error: put.error ?? 'Could not upload an attachment.' });
      }
      await markAttachmentsSynced([record.id]);
      pushed += 1;
    }

    if (plan.markSynced.length > 0) await markAttachmentsSynced(plan.markSynced);

    let pulled = 0;
    for (const meta of plan.pull.slice(0, ATTACHMENT_SYNC_LIMIT)) {
      const got = await neonAttachmentGet(token, meta.id);
      if (!got.ok || !got.data) {
        return finish({
          ...IDLE,
          ok: false,
          pushed,
          pulled,
          removed,
          error: got.error ?? 'Could not download an attachment.',
        });
      }
      const blob = base64ToBlob(got.data.attachment.data, meta.mime);
      await storePulledAttachment(meta, blob);
      pulled += 1;
    }

    if (plan.purge.length > 0) await purgeAttachments(plan.purge);

    const pushable = plan.push.filter((record) => record.blob).length;
    const more =
      pushable > ATTACHMENT_SYNC_LIMIT ||
      plan.pull.length > ATTACHMENT_SYNC_LIMIT ||
      plan.remove.length > ATTACHMENT_SYNC_LIMIT;

    return finish({ ok: true, pushed, pulled, removed, more });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ...IDLE, ok: false, error: message || 'Attachment sync failed unexpectedly.' };
  }

  /** Partial progress is still progress: open panels must see it. */
  function finish(result: AttachmentSyncResult): AttachmentSyncResult {
    if (result.pushed > 0 || result.pulled > 0 || result.removed > 0) notifyAttachmentsChanged();
    return result;
  }
}

export { ATTACHMENT_LIMITS };
