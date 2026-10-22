import { constantTimeEqual, deriveHash, hashToken, randomHex } from '../_lib/crypto.js';
import { ensureSchema } from '../_lib/schema.js';
import { bodyOf, createSession, explain, fail, findUser, noStore, type ApiRequest, type ApiResponse } from '../_lib/store.js';

const SESSION_DAYS = 30;

/** POST /api/auth/signin  { userId, password } — returns a fresh token. */
export default async function handler(req: ApiRequest, res: ApiResponse) {
  noStore(res);
  if (req.method !== 'POST') return fail(res, 405, 'Use POST.');

  const body = bodyOf(req);
  const userId = typeof body.userId === 'string' ? body.userId : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!userId || !password) return fail(res, 400, 'User ID and password are required.');

  try {
    await ensureSchema();
    const user = await findUser(userId.trim().replace(/^@+/, '').toLowerCase());
    // One message for "no such user" and "wrong password": the endpoint should
    // not double as a way to discover which IDs exist.
    const mismatch = 'That user ID and password do not match.';
    if (!user) return fail(res, 401, mismatch);

    const hash = await deriveHash(password, user.salt, user.iterations);
    if (!constantTimeEqual(hash, user.hash)) return fail(res, 401, mismatch);

    const token = randomHex(32);
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
    await createSession(user.id, await hashToken(token), expiresAt);

    res.status(200).json({ userId: user.id, token, expiresAt: expiresAt.toISOString() });
  } catch (error) {
    fail(res, 500, explain(error));
  }
}
