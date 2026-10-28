import { pushConfig, secretMatches } from '../_lib/push.js';
import { runReminderCycle } from '../_lib/reminderProcessor.js';
import { ensureSchema } from '../_lib/schema.js';
import { bearerToken, fail, noStore, type ApiRequest, type ApiResponse } from '../_lib/store.js';

/** GET/POST /api/cron/reminders — invoke once a minute with CRON_SECRET. */
export default async function handler(req: ApiRequest, res: ApiResponse) {
  noStore(res);
  if (req.method !== 'GET' && req.method !== 'POST') return fail(res, 405, 'Use GET or POST.');
  const config = pushConfig();
  if (!config) return fail(res, 503, 'Background reminders are not configured. See the deployment guide.');
  const token = bearerToken(req) ?? '';
  if (!secretMatches(token, config.cronSecret)) return fail(res, 401, 'Unauthorized.');
  try {
    await ensureSchema();
    res.status(200).json({ ok: true, ...await runReminderCycle() });
  } catch {
    console.error('[reminders] scheduler failed');
    fail(res, 500, 'The reminder scheduler failed; retry on the next tick.');
  }
}
