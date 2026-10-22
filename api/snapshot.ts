import { hashToken } from './_lib/crypto';
import {
  bearerToken,
  bodyOf,
  deleteSession,
  explain,
  fail,
  noStore,
  readSnapshot,
  sessionUser,
  writeSnapshot,
  type ApiRequest,
  type ApiResponse,
} from './_lib/store';

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
    const tokenHash = await hashToken(token);
    const userId = await sessionUser(tokenHash);
    if (!userId) return fail(res, 401, 'This session has expired. Sign in again.');

    if (req.method === 'GET') {
      const payload = await readSnapshot(userId);
      res.status(200).json({ userId, payload });
      return;
    }

    if (req.method === 'POST') {
      const payload = bodyOf(req).payload;
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
