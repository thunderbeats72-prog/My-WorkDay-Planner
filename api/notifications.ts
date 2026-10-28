import { hashToken } from './_lib/crypto.js';
import { makeRenewalToken, pushConfig, readActionToken, readRenewalToken, validSubscription } from './_lib/push.js';
import { ensureSchema } from './_lib/schema.js';
import {
  applyNotificationAction, changeHistory, eligibleEvent, enqueueTest, notificationHistory,
  removeSubscription, replaceSubscription, saveSubscription, snoozeAccountTask, subscriptionExists, workerStatus,
} from './_lib/reminderStore.js';
import { bearerToken, bodyOf, explain, fail, noStore, sessionUser, type ApiRequest, type ApiResponse } from './_lib/store.js';

/**
 * Account-scoped setup/history plus narrowly scoped, signed notification
 * actions. Subscription keys and VAPID private keys never reach other users.
 */
export default async function handler(req: ApiRequest, res: ApiResponse) {
  noStore(res);
  if (req.method !== 'GET' && req.method !== 'POST') return fail(res, 405, 'Use GET or POST.');
  const body = bodyOf(req);
  const operation = typeof body.operation === 'string' ? body.operation : '';
  const config = pushConfig();
  try {
    if (req.method === 'POST' && operation === 'renew') {
      if (!config) return fail(res, 503, 'Background reminders are not configured.');
      const previous = typeof body.previousEndpoint === 'string' ? body.previousEndpoint : '';
      const claims = readRenewalToken(body.token, previous, config);
      if (!claims || !validSubscription(body.subscription)) return fail(res, 401, 'The device renewal is invalid or expired.');
      await ensureSchema();
      if (!await replaceSubscription(claims.u, previous, body.subscription)) return fail(res, 409, 'This device was removed or already renewed. Enable notifications again.');
      console.info('[reminders] device subscription renewed');
      res.status(200).json({ ok: true, renewalToken: makeRenewalToken(claims.u, body.subscription.endpoint, config) });
      return;
    }
    // The service worker may run with no open page or active account session.
    // Its signed capability is limited to one notification, with an expiry.
    if (req.method === 'POST' && (operation === 'validate' || operation === 'action' || operation === 'read')) {
      if (!config) return fail(res, 503, 'Background reminders are not configured.');
      const claims = readActionToken(body.token, config);
      if (!claims) return fail(res, 401, 'This notification has expired. Open the planner.');
      await ensureSchema();
      if (operation === 'validate') {
        const candidate = await eligibleEvent(claims.u, claims.e);
        res.status(200).json({ eligible: Boolean(candidate), notification: candidate });
        return;
      }
      if (operation === 'read') {
        await changeHistory(claims.u, 'read', claims.e);
        res.status(200).json({ ok: true });
        return;
      }
      const action = typeof body.action === 'string' ? body.action : '';
      const result = await applyNotificationAction(claims.u, claims.e, action);
      if (result === 'invalid') return fail(res, 400, 'That action is not available.');
      if (result === 'stale') return fail(res, 409, 'The task was already changed. Open the planner to review it.');
      res.status(200).json({ ok: true });
      return;
    }

    const token = bearerToken(req);
    if (!token) return fail(res, 401, 'Sign in to enable background reminders.');
    await ensureSchema();
    const userId = await sessionUser(await hashToken(token));
    if (!userId) return fail(res, 401, 'Your session expired. Sign in again.');

    if (req.method === 'GET') {
      const worker = await workerStatus();
      res.status(200).json({ configured: Boolean(config), publicKey: config?.publicKey ?? null,
        schedulerLastSuccess: worker.lastSuccess, history: await notificationHistory(userId) });
      return;
    }
    if (operation === 'subscribe') {
      if (!config) return fail(res, 503, 'Web Push or the scheduler secret is not configured on this deployment.');
      if (!validSubscription(body.subscription)) return fail(res, 400, 'The browser push subscription is invalid or unsupported.');
      if (!await saveSubscription(userId, body.subscription)) return fail(res, 409, 'This device may belong to another account, or the 10-device limit was reached.');
      console.info('[reminders] device subscription registered');
      res.status(200).json({ ok: true, renewalToken: makeRenewalToken(userId, body.subscription.endpoint, config) });
      return;
    }
    if (operation === 'unsubscribe' || operation === 'status' || operation === 'test') {
      const endpoint = typeof body.endpoint === 'string' && body.endpoint.length <= 4096 ? body.endpoint : '';
      if (!endpoint) return fail(res, 400, 'The device subscription is missing.');
      if (operation === 'unsubscribe') {
        await removeSubscription(userId, endpoint);
        res.status(200).json({ ok: true });
      } else if (operation === 'status') {
        const worker = await workerStatus();
        const subscribed = await subscriptionExists(userId, endpoint);
        res.status(200).json({ configured: Boolean(config), subscribed, schedulerLastSuccess: worker.lastSuccess,
          renewalToken: subscribed && config ? makeRenewalToken(userId, endpoint, config) : null, publicKey: config?.publicKey ?? null });
      } else {
        if (!config) return fail(res, 503, 'Background reminders are not configured.');
        const key = await enqueueTest(userId, endpoint);
        if (!key) return fail(res, 409, 'This device is no longer subscribed. Enable notifications again.');
        res.status(200).json({ ok: true, queued: true });
      }
      return;
    }
    if (operation === 'snooze') {
      const taskId = typeof body.taskId === 'string' && body.taskId.length <= 200 ? body.taskId : '';
      const minutes = typeof body.minutes === 'number' ? body.minutes : 0;
      if (!taskId || !await snoozeAccountTask(userId, taskId, minutes)) return fail(res, 409, 'This task cannot be snoozed. Sync and try again.');
      res.status(200).json({ ok: true });
      return;
    }
    if (operation === 'history') {
      const change = body.change;
      if (change !== 'read' && change !== 'readAll' && change !== 'clear' && change !== 'clearAll') return fail(res, 400, 'Unknown history action.');
      const key = typeof body.key === 'string' && body.key.length <= 4000 ? body.key : undefined;
      if ((change === 'read' || change === 'clear') && !key) return fail(res, 400, 'A notification is required.');
      await changeHistory(userId, change, key);
      res.status(200).json({ ok: true });
      return;
    }
    fail(res, 400, 'Unknown notification operation.');
  } catch (error) {
    console.error('[reminders] API request failed', { operation: operation || 'status' });
    fail(res, 500, explain(error));
  }
}
