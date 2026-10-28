import { hashToken } from './_lib/crypto.js';
import type { Task } from '../src/lib/types.js';
import { ensureSchema } from './_lib/schema.js';
import {
  bearerToken,
  bodyOf,
  deleteSession,
  explain,
  fail,
  noStore,
  patchSnapshotTasks,
  readSnapshot,
  sessionUser,
  writeSnapshot,
  type ApiRequest,
  type ApiResponse,
} from './_lib/store.js';

/**
 * GET  /api/snapshot  — this user's planner snapshot, or null.
 * POST /api/snapshot  — replace it.
 *
 * The user is always taken from the session token, never from the body.
 */
export default async function handler(req: ApiRequest, res: ApiResponse) {
  noStore(res);
  const token = bearerToken(req);
  if (!token) return fail(res, 401, 'Sign in again — no session token was sent.');

  try {
    await ensureSchema();
    const tokenHash = await hashToken(token);
    const userId = await sessionUser(tokenHash);
    if (!userId) return fail(res, 401, 'This session has expired. Sign in again.');

    if (req.method === 'GET') {
      const payload = await readSnapshot(userId);
      res.status(200).json({ userId, payload });
      return;
    }

    if (req.method === 'POST') {
      const body = bodyOf(req);
      if (body.changedTasks !== undefined) {
        if (!Array.isArray(body.changedTasks) || body.changedTasks.length === 0 || body.changedTasks.length > 200 ||
            body.changedTasks.some((item: unknown) => !item || typeof item !== 'object' ||
              typeof (item as Task).id !== 'string' || !(item as Task).id || (item as Task).id.length > 200 ||
              typeof (item as Task).title !== 'string' || typeof (item as Task).updatedAt !== 'string' ||
              !Number.isFinite(Date.parse((item as Task).updatedAt)))) {
          return fail(res, 400, 'A valid list of changed tasks is required.');
        }
        if (!await patchSnapshotTasks(userId, body.changedTasks as Task[])) return fail(res, 409, 'Sync the full planner before updating individual tasks.');
        res.status(200).json({ ok: true });
        return;
      }
      const payload = body.payload;
      if (!payload || typeof payload !== 'object') return fail(res, 400, 'A snapshot payload is required.');
      await writeSnapshot(userId, payload);
      res.status(200).json({ ok: true });
      return;
    }

    if (req.method === 'DELETE') {
      await deleteSession(tokenHash);
      res.status(200).json({ ok: true });
      return;
    }

    fail(res, 405, 'Use GET, POST or DELETE.');
  } catch (error) {
    fail(res, 500, explain(error));
  }
}
