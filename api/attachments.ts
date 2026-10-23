import { hashToken } from './_lib/crypto.js';
import { ensureSchema } from './_lib/schema.js';
import {
  ATTACHMENT_LIMITS,
  overUserQuotaError,
  validAttachmentId,
  validAttachmentKind,
} from '../src/lib/attachmentLimits.js';
import {
  bearerToken,
  bodyOf,
  deleteAttachments,
  explain,
  fail,
  getAttachment,
  listAttachments,
  noStore,
  putAttachment,
  sessionUser,
  type ApiRequest,
  type ApiResponse,
} from './_lib/store.js';

/**
 * Photos and voice memos, one file per request.
 *
 *   GET    /api/attachments          -> metadata for this account (no bytes)
 *   GET    /api/attachments?id=...   -> one file, base64
 *   POST   /api/attachments          -> upsert one file
 *   DELETE /api/attachments          -> { ids: [...] }
 *
 * Deliberately NOT part of /api/snapshot: snapshots are re-sent whole when
 * anything changes and ride the ~4.5 MB serverless body cap, so a single large
 * photo inside one would break sync for every device that owns one. Here a
 * file is a few hundred kilobytes in its own request, capped per file and per
 * account by the same numbers the browser compresses against — one truth
 * imported from `attachmentLimits`, so the client never aims at a size the
 * server refuses.
 *
 * The user always comes from the session token, never from the body: an id in
 * the request only ever addresses your own rows.
 */
export default async function handler(req: ApiRequest, res: ApiResponse) {
  noStore(res);
  const token = bearerToken(req);
  if (!token) return fail(res, 401, 'Sign in again — no session token was sent.');

  try {
    await ensureSchema();
    const userId = await sessionUser(await hashToken(token));
    if (!userId) return fail(res, 401, 'This session has expired. Sign in again.');

    if (req.method === 'GET') {
      const requested = stringParam(req, 'id');
      if (requested !== null) {
        if (!validAttachmentId(requested)) return fail(res, 400, 'That attachment id is not valid.');
        const attachment = await getAttachment(userId, requested);
        if (!attachment) return fail(res, 404, 'That attachment is not on this account.');
        res.status(200).json({ attachment });
        return;
      }
      const { attachments, usage } = await listAttachments(userId);
      res.status(200).json({ attachments, usage });
      return;
    }

    if (req.method === 'POST') {
      const parsed = readUpload(bodyOf(req));
      if (!parsed.ok) return fail(res, 400, parsed.error);

      const hex = Buffer.from(parsed.value.data, 'base64').toString('hex');
      const outcome = await putAttachment(userId, parsed.value, hex, ATTACHMENT_LIMITS);
      if (outcome === 'too-many') return fail(res, 413, overUserQuotaError());
      if (outcome === 'too-large') return fail(res, 413, overUserQuotaError());
      res.status(200).json({ ok: true });
      return;
    }

    if (req.method === 'DELETE') {
      const raw = bodyOf(req).ids;
      if (!Array.isArray(raw) || raw.length === 0) return fail(res, 400, 'A list of attachment ids is required.');
      if (raw.length > 200) return fail(res, 400, 'Delete at most 200 attachments at a time.');
      const ids: string[] = [];
      for (const id of raw) {
        if (!validAttachmentId(id)) return fail(res, 400, 'One of those attachment ids is not valid.');
        ids.push(id);
      }
      const deleted = await deleteAttachments(userId, ids);
      res.status(200).json({ ok: true, deleted });
      return;
    }

    fail(res, 405, 'Use GET, POST or DELETE.');
  } catch (error) {
    fail(res, 500, explain(error));
  }
}

/** `?id=` from the query string, parsed without pulling in a URL parser. */
function stringParam(req: ApiRequest, key: string): string | null {
  const source = req as ApiRequest & { query?: Record<string, unknown> };
  const query = source.query;
  if (query && typeof query[key] === 'string') {
    const value = (query[key] as string).trim();
    return value.length > 0 ? value : null;
  }
  // Vercel exposes the raw URL when no query parser is wired; fall back to it.
  const rawUrl = (req as ApiRequest & { url?: string }).url;
  if (!rawUrl || !rawUrl.includes('?')) return null;
  for (const pair of rawUrl.slice(rawUrl.indexOf('?') + 1).split('&')) {
    const [name, ...rest] = pair.split('=');
    if (name === key) {
      const value = decodeURIComponent(rest.join('=') ?? '').trim();
      return value.length > 0 ? value : null;
    }
  }
  return null;
}

type Upload = { id: string; taskId: string; kind: string; mime: string; size: number; durationMs: number | null; createdAt: string; data: string };

function readUpload(body: Record<string, unknown>): { ok: true; value: Upload } | { ok: false; error: string } {
  const raw = body.attachment;
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'An attachment is required.' };
  const item = raw as Record<string, unknown>;

  if (!validAttachmentId(item.id)) return { ok: false, error: 'That attachment id is not valid.' };
  if (!validAttachmentKind(item.kind)) return { ok: false, error: 'An attachment must be a photo or a voice note.' };
  if (typeof item.taskId !== 'string' || !/^[A-Za-z0-9_.:-]{1,80}$/.test(item.taskId)) {
    return { ok: false, error: 'That task id is not valid.' };
  }
  if (typeof item.mime !== 'string' || !/^[\w.+-]{1,32}\/[\w.+-]{1,32}$/.test(item.mime)) {
    return { ok: false, error: 'That file type is not valid.' };
  }
  if (typeof item.size !== 'number' || !Number.isInteger(item.size) || item.size < 1 || item.size > ATTACHMENT_LIMITS.maxFileBytes) {
    return { ok: false, error: `An attachment must be between 1 and ${ATTACHMENT_LIMITS.maxFileBytes} bytes.` };
  }
  if (typeof item.createdAt !== 'string' || Number.isNaN(Date.parse(item.createdAt))) {
    return { ok: false, error: 'That creation time is not valid.' };
  }
  const durationMs = item.durationMs === null || item.durationMs === undefined ? null : Number(item.durationMs);
  if (durationMs !== null && (!Number.isFinite(durationMs) || durationMs < 0 || durationMs > 600_000)) {
    return { ok: false, error: 'That recording length is not valid.' };
  }
  if (typeof item.data !== 'string' || item.data.length === 0) return { ok: false, error: 'The attachment has no data.' };
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(item.data)) return { ok: false, error: 'The attachment data is not valid base64.' };

  const decoded = Buffer.from(item.data, 'base64');
  if (decoded.length !== item.size) return { ok: false, error: 'The attachment size does not match its data.' };
  if (decoded.length > ATTACHMENT_LIMITS.maxFileBytes) {
    return { ok: false, error: `That file is over the ${ATTACHMENT_LIMITS.maxFileBytes} byte limit.` };
  }

  return {
    ok: true,
    value: {
      id: item.id,
      taskId: item.taskId,
      kind: item.kind,
      mime: item.mime,
      size: item.size,
      durationMs,
      createdAt: item.createdAt,
      data: item.data,
    },
  };
}
