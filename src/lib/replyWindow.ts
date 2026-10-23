/**
 * Best time to follow up (#7) — per-client reply windows from Graph mail
 * metadata, computed on-device. The window is the middle 50% of the hours
 * your client's messages actually arrive in: not a prediction, a histogram
 * with a floor. Fewer than three messages → no window, said out loud.
 */

export interface MailSample {
  fromName: string;
  fromAddress: string;
  receivedAt: string;
  subject: string;
}

export interface ReplyWindow {
  client: string;
  /** How many of the client's messages the window is based on. */
  samples: number;
  /** 'HH:MM' bounds of the middle 50% of their sending hours. */
  windowStart: string;
  windowEnd: string;
  lastAt: string;
  firstAt: string;
  /** One honest sentence the UI can show verbatim. */
  hint: string;
}

/** Below this many messages we refuse to draw a window. */
export const MIN_REPLY_SAMPLES = 3;

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[base + 1];
  return next !== undefined ? sorted[base] + rest * (next - sorted[base]) : sorted[base];
}

function formatHour(hourValue: number): string {
  // Round to the nearest half hour so the hint reads like a clock, not a stat.
  const rounded = Math.round(hourValue * 2) / 2;
  const h = Math.floor(rounded) % 24;
  const m = rounded % 1 === 0.5 ? 30 : 0;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function replyWindowFor(
  client: string,
  messages: MailSample[],
  now: Date = new Date(),
): ReplyWindow | null {
  const valid = messages.filter((message) => {
    const at = new Date(message.receivedAt);
    return !Number.isNaN(at.getTime()) && at <= now;
  });
  if (valid.length < MIN_REPLY_SAMPLES) return null;

  const hours = valid
    .map((message) => {
      const at = new Date(message.receivedAt);
      return at.getHours() + at.getMinutes() / 60;
    })
    .sort((a, b) => a - b);
  const start = quantile(hours, 0.25);
  const end = quantile(hours, 0.75);

  const times = valid.map((message) => new Date(message.receivedAt)).sort((a, b) => a.getTime() - b.getTime());
  const firstAt = times[0].toISOString();
  const lastAt = times[times.length - 1].toISOString();
  const windowStart = formatHour(start);
  const windowEnd = formatHour(end);

  return {
    client,
    samples: valid.length,
    windowStart,
    windowEnd,
    lastAt,
    firstAt,
    hint:
      windowStart === windowEnd
        ? `${client} writes around ${windowStart} (${valid.length} messages on record) — follow up just before.`
        : `${client} usually writes between ${windowStart} and ${windowEnd} (${valid.length} messages on record) — follow up just before ${windowStart}.`,
  };
}
