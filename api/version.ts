import { hashToken } from './_lib/crypto.js';
import { ensureSchema } from './_lib/schema.js';
import { bearerToken, explain, fail, noStore, sessionUser, snapshotVersion, type ApiRequest, type ApiResponse } from './_lib/store.js';

/**
 * GET /api/version — when was this user's snapshot last written?
 *
 * Polling this every few seconds is how a phone learns that the laptop changed
 * something. It reads one timestamp and returns ~30 bytes, so it costs far less
 * than pulling the whole snapshot to discover nothing happened.
 */
export default async function handler(req: ApiRequest, res: ApiResponse) {
  noStore(res);
  if (req.method !== 'GET') return fail(res, 405, 'Use GET.');

  const token = bearerToken(req);
  if (!token) return fail(res, 401, 'Sign in again — no session token was sent.');

  try {
    await ensureSchema();
    const userId = await sessionUser(await hashToken(token));
    if (!userId) return fail(res, 401, 'This session has expired. Sign in again.');
    res.status(200).json({ userId, updatedAt: await snapshotVersion(userId) });
  } catch (error) {
    fail(res, 500, explain(error));
  }
}
