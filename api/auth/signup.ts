import { checkPassword, checkUserId, deriveHash, hashToken, randomHex } from '../_lib/crypto';
import { ensureSchema } from '../_lib/schema';
import { bodyOf, createSession, explain, fail, findUser, insertUser, noStore, type ApiRequest, type ApiResponse } from '../_lib/store';

const SESSION_DAYS = 30;

/**
 * POST /api/auth/signup  { userId, password, displayName? }
 *
 * Creates an account in Neon and returns a session token. The password hash
 * never leaves this function; the client only ever sees the token.
 */
export default async function handler(req: ApiRequest, res: ApiResponse) {
  noStore(res);
  if (req.method !== 'POST') return fail(res, 405, 'Use POST.');

  const body = bodyOf(req);
  const idCheck = checkUserId(body.userId);
  if (!idCheck.ok) return fail(res, 400, idCheck.error ?? 'Invalid user ID.');
  const passwordCheck = checkPassword(body.password);
  if (!passwordCheck.ok) return fail(res, 400, passwordCheck.error ?? 'Invalid password.');

  try {
    await ensureSchema();
    const existing = await findUser(idCheck.id);
    if (existing) return fail(res, 409, 'That user ID already exists. Sign in instead.');

    const salt = randomHex(16);
    const hash = await deriveHash(body.password as string, salt);
    await insertUser({
      id: idCheck.id,
      display_name: typeof body.displayName === 'string' ? body.displayName.trim().slice(0, 80) : idCheck.id,
      salt,
      hash,
      iterations: 210_000,
    });

    const token = randomHex(32);
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
    await createSession(idCheck.id, await hashToken(token), expiresAt);

    res.status(200).json({ userId: idCheck.id, token, expiresAt: expiresAt.toISOString() });
  } catch (error) {
    fail(res, 500, explain(error));
  }
}
