import { ensureSchema } from './_lib/schema.js';
import { databaseUrlPresent, explain, noStore, type ApiRequest, type ApiResponse } from './_lib/store.js';

/**
 * GET /api/health — is this deployment actually able to sign anyone in?
 *
 * Always answers 200 with a JSON body, because the point is to be readable in a
 * phone browser by someone who is not a developer:
 *
 *   { "api": "ok", "database": "ready" }    everything is wired up
 *   { "api": "ok", "database": "absent" }   the functions run, no database attached
 *   { "api": "ok", "database": "error" }    attached, but the tables could not be reached
 *
 * It never returns a row, a connection string or a count — only whether the
 * database can be reached. That is not secret, and it turns "login is not
 * working" into one sentence.
 */
export default async function handler(req: ApiRequest, res: ApiResponse) {
  noStore(res);
  if (req.method !== 'GET') {
    res.status(405).json({ api: 'ok', database: 'unknown', error: 'Use GET.' });
    return;
  }

  if (!databaseUrlPresent()) {
    res.status(200).json({ api: 'ok', database: 'absent' });
    return;
  }

  try {
    await ensureSchema();
    res.status(200).json({ api: 'ok', database: 'ready' });
  } catch (error) {
    res.status(200).json({ api: 'ok', database: 'error', error: explain(error) });
  }
}
