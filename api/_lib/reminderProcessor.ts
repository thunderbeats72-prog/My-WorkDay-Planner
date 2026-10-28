import { reminderCandidates } from '../../src/lib/reminderSchedule.js';
import { pushConfig, sendWebPush } from './push.js';
import {
  acquireWorker, claimDeliveries, eligibleEvent, enqueueCandidates, finishDelivery, finishWorker,
  getSnoozes, pruneNotificationHistory, removeSubscription, scheduledAccounts, updateEventContent,
  type Delivery,
} from './reminderStore.js';

export async function dispatchDelivery(delivery: Delivery): Promise<'sent' | 'retry' | 'failed' | 'obsolete'> {
  const config = pushConfig();
  if (!config) throw new Error('Push is not configured.');
  try {
    // This reads the authoritative snapshot *again* after the delivery lease is
    // acquired. A task edited since scheduling cannot use an obsolete job.
    const candidate = await eligibleEvent(delivery.userId, delivery.key);
    if (!candidate) {
      await finishDelivery(delivery, 'obsolete');
      return 'obsolete';
    }
    await updateEventContent(delivery.userId, candidate);
    const acceptedStatus = await sendWebPush(delivery.userId, candidate, {
      endpoint: delivery.endpoint, keys: { p256dh: delivery.p256dh, auth: delivery.auth },
    }, config);
    await finishDelivery(delivery, 'sent', acceptedStatus);
    // An accepted request is not proof the device displayed a banner.
    console.info('[reminders] push service accepted delivery', { category: candidate.category, attempt: delivery.attempts });
    return 'sent';
  } catch (error) {
    const status = typeof (error as { statusCode?: unknown })?.statusCode === 'number'
      ? (error as { statusCode: number }).statusCode : null;
    const expired = status === 404 || status === 410;
    const transient = status === null || status === 408 || status === 429 || status >= 500;
    await finishDelivery(delivery, transient ? 'pending' : 'failed', status);
    if (expired) await removeSubscription(delivery.userId, delivery.endpoint);
    console.warn('[reminders] delivery failed', { status: status ?? 'network', attempt: delivery.attempts, retry: transient });
    return transient ? 'retry' : 'failed';
  }
}

/**
 * Called by an authenticated external scheduler (or Vercel Pro cron) each
 * minute. Work is bounded and the cursor moves across accounts between runs.
 */
export async function runReminderCycle(): Promise<{ locked: boolean; accounts: number; enqueued: number; sent: number; retry: number; errors: number }> {
  const lease = await acquireWorker();
  if (!lease) return { locked: true, accounts: 0, enqueued: 0, sent: 0, retry: 0, errors: 0 };
  let cursor = lease.cursor;
  let success = false;
  let accounts = 0;
  let enqueued = 0;
  let sent = 0;
  let retry = 0;
  let errors = 0;
  try {
    const start = Date.now();
    const page = await scheduledAccounts(cursor, 100);
    for (const account of page) {
      try {
        const snoozes = await getSnoozes(account.userId);
        enqueued += await enqueueCandidates(account.userId, reminderCandidates(account.snapshot, new Date(), snoozes));
      } catch {
        // No personal data in logs. Skip malformed snapshots, not every account.
        errors += 1;
        console.warn('[reminders] could not schedule one account');
      }
      accounts += 1;
      cursor = account.userId;
      if (Date.now() - start > 15_000) break;
    }
    if (accounts === page.length && page.length < 100) cursor = null;
    const deliveries = await claimDeliveries(30);
    // Parallel requests keep one slow push service from blocking all devices.
    const results = await Promise.all(deliveries.map(dispatchDelivery));
    sent = results.filter((result) => result === 'sent').length;
    retry = results.filter((result) => result === 'retry').length;
    await pruneNotificationHistory();
    success = errors === 0;
    console.info('[reminders] cycle complete', { accounts, enqueued, sent, retry, errors });
    return { locked: false, accounts, enqueued, sent, retry, errors };
  } finally {
    await finishWorker(lease.token, cursor, success);
  }
}
