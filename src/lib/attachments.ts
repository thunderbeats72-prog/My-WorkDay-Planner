/**
 * Attachments — a photo of the visiting card, a 15-second voice memo on the
 * way out of a client's office.
 *
 * The design rule is the one the planner already lives by: the bytes you
 * capture belong on the device first, and they only travel when an account
 * with sync is connected. Three consequences of that, stated up front:
 *
 *   · Nothing here ever touches the snapshot. The JSON the sync engine merges
 *     every few seconds stays a few dozen kilobytes of records, so attachments
 *     cannot inflate it, thrash the merge, or hit the 4.5 MB request cap that
 *     would take every device's sync down with one camera photo.
 *   · Media is immutable after it is saved. There is no edit operation to
 *     merge — only create and delete — which is what makes cross-device sync
 *     a matter of unioning ids instead of resolving conflicts.
 *   · Photos are resized and re-encoded in the browser before anything is
 *     stored, against the same per-file cap the server enforces. A captured
 *     card photo lands around a few hundred kilobytes, not several megabytes.
 *
 * Deletions leave a tombstone (no bytes, just the id) until the server has
 * seen the delete, so a phone that goes offline mid-delete cannot resurrect
 * the file on the next sync.
 */

import { db, uniqueId } from './db';
import {
  ATTACHMENT_LIMITS,
  overUserQuotaError,
  type AttachmentKind,
  type AttachmentMeta,
} from './attachmentLimits';

export type { AttachmentKind, AttachmentMeta };
export { ATTACHMENT_LIMITS };

/** A stored attachment: the shared metadata plus sync state and, until it is
 * deleted, the bytes themselves. */
export interface AttachmentRecord extends AttachmentMeta {
  deletedAt: string | null;
  /** True once the server has acknowledged the file (or its deletion). */
  synced: boolean;
  blob: Blob | null;
}

const CHANGE_EVENT = 'mwp:attachments-changed';

/** Tell every open panel and the account card that the set changed. */
export function notifyAttachmentsChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Subscribe; returns the unsubscribe function. */
export function onAttachmentsChanged(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
}

/* ------------------------------------------------------------------ store */

export async function saveAttachment(input: {
  taskId: string;
  kind: AttachmentKind;
  mime: string;
  blob: Blob;
  durationMs?: number | null;
}): Promise<AttachmentRecord> {
  const { blob } = input;
  if (blob.size === 0) throw new Error('That file is empty — nothing was saved.');
  if (blob.size > ATTACHMENT_LIMITS.maxFileBytes) {
    throw new Error(
      `That ${input.kind === 'photo' ? 'photo' : 'voice note'} is ${formatBytes(blob.size)} — the limit is ${formatBytes(ATTACHMENT_LIMITS.maxFileBytes)} per file.`,
    );
  }
  const usage = await attachmentUsage();
  if (usage.count >= ATTACHMENT_LIMITS.maxUserCount || usage.bytes + blob.size > ATTACHMENT_LIMITS.maxUserBytes) {
    throw new Error(overUserQuotaError());
  }

  const record: AttachmentRecord = {
    id: uniqueId('att'),
    taskId: input.taskId,
    kind: input.kind,
    mime: input.mime || (input.kind === 'photo' ? 'image/jpeg' : 'audio/webm'),
    size: blob.size,
    durationMs: input.kind === 'voice' ? input.durationMs ?? null : null,
    createdAt: new Date().toISOString(),
    deletedAt: null,
    synced: false,
    blob,
  };
  await db.attachments.add(record);
  return record;
}

/** Everything for one task, newest last. Tombstones are never listed. */
export async function listAttachments(taskId: string): Promise<AttachmentRecord[]> {
  const rows = await db.attachments.where('taskId').equals(taskId).toArray();
  return rows
    .filter((row) => row.deletedAt === null)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Every row, including tombstones — what the sync planner needs to see. */
export async function listAllAttachments(): Promise<AttachmentRecord[]> {
  return db.attachments.toArray();
}

export async function attachmentUsage(): Promise<{ count: number; bytes: number }> {
  // A scan, not an index query: the table is capped at a few hundred rows, and
  // `deletedAt` is null for most rows — a value indexes badly by nature.
  const rows = await db.attachments.toArray();
  return rows
    .filter((row) => row.deletedAt === null)
    .reduce((sum, row) => ({ count: sum.count + 1, bytes: sum.bytes + row.size }), { count: 0, bytes: 0 });
}

/** Soft-delete: bytes drop now, the id stays until the server has heard it. */
export async function tombstoneAttachment(id: string): Promise<void> {
  const row = await db.attachments.get(id);
  if (!row) return;
  await db.attachments.put({ ...row, deletedAt: new Date().toISOString(), blob: null });
}

/** The server has acknowledged — or never needed to hear about — this row. */
export async function purgeAttachments(ids: string[]): Promise<void> {
  if (ids.length > 0) await db.attachments.bulkDelete(ids);
}

export async function markAttachmentsSynced(ids: string[]): Promise<void> {
  const rows = await db.attachments.bulkGet(ids);
  const changed = rows.filter(
    (row): row is AttachmentRecord => row !== undefined && row !== null && !row.synced,
  );
  if (changed.length > 0) await db.attachments.bulkPut(changed.map((row) => ({ ...row, synced: true })));
}

/** Pull path: a file the server has that this device has never seen. */
export async function storePulledAttachment(meta: AttachmentMeta, blob: Blob): Promise<void> {
  // An existing row wins whatever it is: a duplicate pull is a no-op, and a
  // local tombstone stays put until the server acknowledges the delete.
  const existing = await db.attachments.get(meta.id);
  if (existing) return;
  await db.attachments.put({
    ...meta,
    deletedAt: null,
    synced: true,
    blob,
  });
}

/* ---------------------------------------------------------------- capture */

export function voiceRecorderSupported(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function')
  );
}

export interface VoiceCapture {
  /** Resolves when the recording ends for any reason, or null when cancelled. */
  done: Promise<{ blob: Blob; durationMs: number } | null>;
  stop(): void;
  cancel(): void;
}

function pickVoiceMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  return candidates.find((mime) => MediaRecorder.isTypeSupported(mime));
}

/**
 * Record a memo, capped at 15 seconds — the recorder stops itself, so a
 * pocket-pressed button cannot run up an hour of audio in the background.
 */
export async function startVoiceMemo(maxMs = ATTACHMENT_LIMITS.maxVoiceMs): Promise<VoiceCapture> {
  if (!voiceRecorderSupported()) {
    throw new Error('This browser cannot record voice notes here. The microphone needs to be available to the page.');
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mime = pickVoiceMime();
  const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
  const chunks: BlobPart[] = [];
  const startedAt = Date.now();
  let cancelled = false;
  let finish: ((result: { blob: Blob; durationMs: number } | null) => void) | null = null;

  const done = new Promise<{ blob: Blob; durationMs: number } | null>((resolve) => {
    finish = resolve;
  });

  const cleanup = () => {
    stream.getTracks().forEach((track) => {
      track.stop();
    });
  };

  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) chunks.push(event.data);
  };
  recorder.onstop = () => {
    cleanup();
    if (cancelled || chunks.length === 0) {
      finish?.(null);
      return;
    }
    const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
    finish?.({ blob, durationMs: Date.now() - startedAt });
  };
  recorder.onerror = () => {
    cleanup();
    finish?.(null);
  };

  recorder.start(250);
  const autoStop = window.setTimeout(() => {
    if (recorder.state !== 'inactive') recorder.stop();
  }, maxMs);

  return {
    done,
    stop: () => {
      window.clearTimeout(autoStop);
      if (recorder.state !== 'inactive') recorder.stop();
    },
    cancel: () => {
      cancelled = true;
      window.clearTimeout(autoStop);
      if (recorder.state !== 'inactive') recorder.stop();
      else finish?.(null);
    },
  };
}

/** Turn a getUserMedia failure into the sentence a person can act on. */
export function microphoneErrorText(error: unknown): string {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Microphone blocked — allow microphone access for this site, then try again.';
  }
  if (name === 'NotFoundError') return 'No microphone found on this device.';
  return 'Could not start the microphone. Your other work is unaffected.';
}

/* -------------------------------------------------------------- photos */

/**
 * Resize and re-encode a photo against the size cap, entirely in the browser.
 *
 * Files already under the cap are stored as-is: decoding a 300 KB JPEG just to
 * write the same 300 KB back is wasted memory, and it is the common case for
 * screenshots and small camera shots. Anything larger goes through a canvas at
 * a bounded long edge and a short quality ladder — the first rung that fits
 * wins, so quality only drops as far as it must.
 */
export async function compressPhoto(file: Blob): Promise<Blob> {
  if (file.size <= ATTACHMENT_LIMITS.targetPhotoBytes) return file;

  const bitmap = await decodeImage(file);
  try {
    const { width, height } = scaledSize(bitmap.width, bitmap.height, ATTACHMENT_LIMITS.maxPhotoEdge);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not prepare the photo for saving.');
    context.drawImage(bitmap, 0, 0, width, height);

    let result = await encodeAtQuality(canvas, [0.82, 0.7, 0.58, 0.48]);
    if (!result || result.size > ATTACHMENT_LIMITS.maxFileBytes) {
      // Still too big at full frame — one more pass at three-quarter size.
      canvas.width = Math.round(width * 0.75);
      canvas.height = Math.round(height * 0.75);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      result = await encodeAtQuality(canvas, [0.7, 0.55, 0.42]);
    }
    if (!result || result.size > ATTACHMENT_LIMITS.maxFileBytes) {
      throw new Error(
        `That photo stays over the ${formatBytes(ATTACHMENT_LIMITS.maxFileBytes)} limit even after compressing. Try a smaller image.`,
      );
    }
    return result;
  } finally {
    if ('close' in bitmap && typeof bitmap.close === 'function') bitmap.close();
  }
}

type Drawable = ImageBitmap | HTMLImageElement;

async function decodeImage(file: Blob): Promise<Drawable> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // Some formats/engines refuse the options bag; plain decode still works.
      try {
        return await createImageBitmap(file);
      } catch {
        // Fall through to the element path below (e.g. HEIC in Safari).
      }
    }
  }
  return new Promise<Drawable>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('This photo format could not be read on this device.'));
    };
    image.src = url;
  });
}

function scaledSize(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const longEdge = Math.max(width, height);
  if (longEdge <= maxEdge) return { width, height };
  const scale = maxEdge / longEdge;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

async function encodeAtQuality(canvas: HTMLCanvasElement, qualities: number[]): Promise<Blob | null> {
  // Walk the ladder and stop at the first rung small enough to aim for; if
  // none reaches the target, remember the last one that at least fits the
  // hard cap, because a lower quality only ever shrinks the file.
  let underCap: Blob | null = null;
  for (const quality of qualities) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) return underCap;
    if (blob.size <= ATTACHMENT_LIMITS.targetPhotoBytes) return blob;
    if (blob.size <= ATTACHMENT_LIMITS.maxFileBytes) underCap = blob;
  }
  return underCap;
}

/* ------------------------------------------------------------- transport */

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  // Postgres `encode(..., 'bytea')` answers in the `\x...` hex form.
  const clean = hex.replace(/^\\{1,2}x/, '');
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunkSize = 0x2000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export function base64ToBlob(base64: string, mime: string): Blob {
  const clean = base64.replace(/\s/g, '');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} KB`;
  const mb = bytes / 1_000_000;
  return `${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10} MB`;
}
