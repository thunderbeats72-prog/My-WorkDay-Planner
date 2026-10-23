/**
 * Share-to-Planner — the text arrives from the system share sheet.
 *
 * The Web Share Target API lets the *installed* PWA appear in Android's share
 * menu. The OS POSTs the shared title/text/url to `/share`; the service
 * worker (public/sw.js) parks the payload in a cache entry and redirects to
 * the app; this module is the reading half.
 *
 * Why a cache entry: a service worker has no localStorage, and the message
 * channel between worker and page only exists while a page is open — a share
 * can arrive against a cold start. A cache entry survives that gap, and this
 * reader deletes it on pickup so a shared line is consumed exactly once.
 *
 * None of this runs until the app is installed; in a plain tab the share
 * menu simply does not offer us, which is the platform's default and needs
 * no special handling here.
 */

export interface SharedPayload {
  text: string;
  title: string;
  url: string;
  at: number;
}

const PENDING_PATH = '/share/pending';
/** The worker's shell cache is versioned (`workday-shell-vN`); match by
 * prefix so a deploy does not strand a payload in the previous version. */
const SHELL_CACHE_PREFIX = 'workday-shell-';

/**
 * Take the pending share, if any — and clear it in the same motion.
 * Resolves null when nothing was shared (the normal case on every load).
 */
export async function takeSharedPayload(): Promise<SharedPayload | null> {
  if (typeof caches === 'undefined') return null;
  try {
    const keys = await caches.keys();
    const shell = keys.find((key) => key.startsWith(SHELL_CACHE_PREFIX));
    if (!shell) return null;
    const cache = await caches.open(shell);
    const response = await cache.match(PENDING_PATH);
    if (!response) return null;
    await cache.delete(PENDING_PATH);
    const parsed: unknown = await response.json();
    if (!parsed || typeof parsed !== 'object') return null;
    const record = parsed as Partial<SharedPayload>;
    return {
      text: typeof record.text === 'string' ? record.text : '',
      title: typeof record.title === 'string' ? record.title : '',
      url: typeof record.url === 'string' ? record.url : '',
      at: typeof record.at === 'number' ? record.at : Date.now(),
    };
  } catch {
    // A corrupt payload must not block the app from opening.
    return null;
  }
}

/**
 * Turn what other apps handed us into the one line Quick add parses.
 *
 * Android often sends the same content as title *and* text; the duplicate is
 * collapsed, and a bare link kept only when the words did not already carry it.
 */
export function sharedToQuickText(payload: SharedPayload): string {
  const parts: string[] = [];
  const text = payload.text.trim();
  const title = payload.title.trim();
  const url = payload.url.trim();

  if (text) {
    // Subject first when both exist — that is how a share line reads in
    // every other app, and the parser does not care about the order.
    if (title && title !== text) parts.push(title, text);
    else parts.push(text);
  } else if (title) {
    parts.push(title);
  }

  const line = parts.join(' — ').replace(/\s+/g, ' ').trim();
  if (!line) {
    return url ? sharedUrlLabel(url) : '';
  }
  if (url && !line.includes(url)) return `${line} ${url}`;
  return line;
}

/** A naked URL as a title reads better than the URL itself. */
export function sharedUrlLabel(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');
    const path = parsed.pathname === '/' ? '' : parsed.pathname;
    return `${host}${path}`.slice(0, 80);
  } catch {
    return url.slice(0, 80);
  }
}
