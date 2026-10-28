import { createECDH, createHash, createHmac, timingSafeEqual } from 'node:crypto';
import webPush from 'web-push';
import type { ReminderCandidate } from '../../src/lib/reminderSchedule.js';

function environment(): Record<string, string | undefined> {
  const scope = globalThis as unknown as { process?: { env?: Record<string, string | undefined> } };
  return scope.process?.env ?? {};
}

export interface PushConfig { publicKey: string; privateKey: string; subject: string; cronSecret: string }
export function pushConfig(): PushConfig | null {
  const env = environment();
  const publicKey = env.VAPID_PUBLIC_KEY?.trim() ?? '';
  const privateKey = env.VAPID_PRIVATE_KEY?.trim() ?? '';
  const subject = env.VAPID_SUBJECT?.trim() ?? '';
  const cronSecret = env.CRON_SECRET?.trim() ?? '';
  try {
    const publicBytes = Buffer.from(publicKey, 'base64url');
    const privateBytes = Buffer.from(privateKey, 'base64url');
    if (publicBytes.length !== 65 || publicBytes[0] !== 4 || privateBytes.length !== 32) return null;
    const key = createECDH('prime256v1');
    key.setPrivateKey(privateBytes);
    if (!key.getPublicKey().equals(publicBytes)) return null;
    if (!/^(mailto:[^@\s]+@[^@\s]+|https:\/\/[^\s]+)$/i.test(subject) || cronSecret.length < 32) return null;
    return { publicKey, privateKey, subject, cronSecret };
  } catch {
    return null;
  }
}

export function secretMatches(supplied: string, expected: string): boolean {
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  expirationTime?: number | null;
}

/** Only real browser push services: never allow the server to POST arbitrary URLs. */
export function validSubscription(value: unknown): value is PushSubscriptionInput {
  if (!value || typeof value !== 'object') return false;
  const sub = value as Partial<PushSubscriptionInput>;
  if (typeof sub.endpoint !== 'string' || sub.endpoint.length > 4096 || !sub.keys) return false;
  try {
    const url = new URL(sub.endpoint);
    const host = url.hostname.toLowerCase();
    const provider = host === 'fcm.googleapis.com' || host === 'updates.push.services.mozilla.com' ||
      host.endsWith('.push.services.mozilla.com') || host === 'web.push.apple.com' ||
      host.endsWith('.push.apple.com') || host.endsWith('.notify.windows.com');
    if (url.protocol !== 'https:' || !provider || url.username || url.password || url.port || url.hash) return false;
    if (!/^[A-Za-z0-9_-]+$/.test(sub.keys.p256dh) || !/^[A-Za-z0-9_-]+$/.test(sub.keys.auth)) return false;
    const key = Buffer.from(sub.keys.p256dh, 'base64url');
    const auth = Buffer.from(sub.keys.auth, 'base64url');
    if (key.length !== 65 || key[0] !== 4 || auth.length !== 16) return false;
    if (sub.expirationTime != null && (!Number.isFinite(sub.expirationTime) || sub.expirationTime <= Date.now())) return false;
    return true;
  } catch {
    return false;
  }
}

interface TokenClaims { u: string; e: string; exp: number }
/** Scoped capability delivered inside encrypted Web Push, never in a URL. */
export function makeActionToken(userId: string, eventKey: string, config: PushConfig, now = Date.now()): string {
  const claims: TokenClaims = { u: userId, e: eventKey, exp: now + 7 * 24 * 60 * 60_000 };
  const data = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = createHmac('sha256', config.privateKey).update(`workday-action:${data}`).digest('base64url');
  return `${data}.${signature}`;
}

export function readActionToken(token: unknown, config: PushConfig, now = Date.now()): TokenClaims | null {
  if (typeof token !== 'string' || token.length > 6000) return null;
  const [data, signature, extra] = token.split('.');
  if (!data || !signature || extra) return null;
  const expected = createHmac('sha256', config.privateKey).update(`workday-action:${data}`).digest('base64url');
  if (!secretMatches(signature, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(data, 'base64url').toString()) as Partial<TokenClaims>;
    if (typeof claims.u !== 'string' || typeof claims.e !== 'string' || typeof claims.exp !== 'number' || claims.exp < now) return null;
    return claims as TokenClaims;
  } catch {
    return null;
  }
}

interface RenewalClaims { u: string; endpointHash: string; exp: number }
/** A revocable, endpoint-scoped capability for a worker subscription change. */
export function makeRenewalToken(userId: string, endpoint: string, config: PushConfig, now = Date.now()): string {
  const claims: RenewalClaims = { u: userId, endpointHash: createHash('sha256').update(endpoint).digest('base64url'), exp: now + 90 * 24 * 60 * 60_000 };
  const data = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = createHmac('sha256', config.privateKey).update(`workday-renewal:${data}`).digest('base64url');
  return `${data}.${signature}`;
}

export function readRenewalToken(token: unknown, endpoint: string, config: PushConfig, now = Date.now()): RenewalClaims | null {
  if (typeof token !== 'string' || token.length > 3000 || endpoint.length > 4096) return null;
  const [data, signature, extra] = token.split('.');
  if (!data || !signature || extra) return null;
  const expected = createHmac('sha256', config.privateKey).update(`workday-renewal:${data}`).digest('base64url');
  if (!secretMatches(signature, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(data, 'base64url').toString()) as Partial<RenewalClaims>;
    const hash = createHash('sha256').update(endpoint).digest('base64url');
    if (typeof claims.u !== 'string' || claims.endpointHash !== hash || typeof claims.exp !== 'number' || claims.exp < now) return null;
    return claims as RenewalClaims;
  } catch { return null; }
}

export async function sendWebPush(
  userId: string,
  candidate: ReminderCandidate,
  sub: PushSubscriptionInput,
  config: PushConfig,
): Promise<number> {
  const token = makeActionToken(userId, candidate.key, config);
  const payload = JSON.stringify({
    title: candidate.title,
    body: candidate.body,
    category: candidate.category,
    taskId: candidate.taskId,
    token,
    silent: candidate.silent,
    // Stable tag + topic make concurrent/retried sends replace the same alert.
    tag: `workday-${createHash('sha256').update(candidate.key).digest('base64url').slice(0, 24)}`,
  });
  const result = await webPush.sendNotification(sub, payload, {
    vapidDetails: { subject: config.subject, publicKey: config.publicKey, privateKey: config.privateKey },
    TTL: candidate.category === 'summary' || candidate.category === 'completed' || candidate.category === 'test' ? 300 : 120,
    urgency: 'high',
    topic: createHash('sha256').update(candidate.key).digest('base64url').slice(0, 32),
    timeout: 8000,
  });
  return result.statusCode;
}
