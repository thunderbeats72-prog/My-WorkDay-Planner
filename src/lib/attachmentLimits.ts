/**
 * What an attachment is allowed to be — shared by the browser and the API.
 *
 * These two worlds must agree on the same numbers or the client compresses to
 * a size the server refuses, which looks from the UI like a random failure.
 * This module is deliberately dependency-free: the serverless functions import
 * it directly, and pulling in Dexie or anything DOM-shaped there would break
 * the build. One file, one truth, tested once.
 */

export type AttachmentKind = 'photo' | 'voice';

/** Everything about an attachment except its bytes. */
export interface AttachmentMeta {
  id: string;
  taskId: string;
  kind: AttachmentKind;
  mime: string;
  size: number;
  durationMs: number | null;
  createdAt: string;
}

export const ATTACHMENT_LIMITS = {
  /** The server's hard cap per file. Everything is compressed below this. */
  maxFileBytes: 600_000,
  /** Where photo compression aims, so most files never get near the cap. */
  targetPhotoBytes: 380_000,
  /** A memo is a memo: 15 seconds, then the recorder stops itself. */
  maxVoiceMs: 15_000,
  /** Per-account ceiling on the server — a safety rail, not a plan tier. */
  maxUserBytes: 40_000_000,
  maxUserCount: 400,
  /** Long edge of a photo after resizing; a visiting card survives this. */
  maxPhotoEdge: 1600,
} as const;

/** Ids are client-generated and must survive a round trip unchanged.
 * `uniqueId` produces `att_<uuid>` in modern browsers and a base36 timestamp
 * pair when `crypto.randomUUID` is missing — the suffix accepts both. */
export function validAttachmentId(id: unknown): id is string {
  return typeof id === 'string' && /^[a-z]{2,10}_[A-Za-z0-9_.-]{6,80}$/.test(id);
}

export function validAttachmentKind(kind: unknown): kind is AttachmentKind {
  return kind === 'photo' || kind === 'voice';
}

/** One shared phrasing for "over the cap", shown wherever it is caught. */
export function overUserQuotaError(): string {
  return `Attachment storage is full (${Math.round(ATTACHMENT_LIMITS.maxUserBytes / 1_000_000)} MB). Delete a photo or voice note to make room.`;
}
