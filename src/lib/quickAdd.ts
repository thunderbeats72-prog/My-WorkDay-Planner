import type { Category, Priority } from './types';
import { categoryLabel } from './types';
import { daysFromNow, parseTimeToMinutes, todayISO } from './dates';
import { parseDuePhrase, parseTimePhrase } from './engine';

/**
 * Smart quick add.
 *
 * The bar used to accept a title and a priority dropdown only. This parser keeps
 * typing fast while letting a single line carry the whole task:
 *
 *   email Sam about the pilot tomorrow 3pm !high 30m #email @Nova
 *
 * Everything it understands is returned as tokens so the UI can show exactly
 * what was picked up before the user presses Enter. Anything it does not
 * understand stays in the title, untouched.
 */

export type QuickAddTokenKind = 'date' | 'time' | 'priority' | 'estimate' | 'category' | 'client';

export interface QuickAddToken {
  kind: QuickAddTokenKind;
  label: string;
}

export interface QuickAddDraft {
  title: string;
  priority: Priority;
  dueDate: string | null;
  dueTime: string;
  estimatedMinutes: number;
  category: Category;
  client: string;
}

export interface QuickAddParse {
  draft: QuickAddDraft;
  tokens: QuickAddToken[];
  hasDate: boolean;
  hasTime: boolean;
  hasPriority: boolean;
  hasEstimate: boolean;
  hasCategory: boolean;
  hasClient: boolean;
  /** A time was given without a date, and that time already passed today. */
  rolledOver: boolean;
}

export interface QuickAddOptions {
  now?: Date;
  fallbackPriority?: Priority;
  fallbackEstimateMinutes?: number;
  /** Used to expand `@nova` into the full “Nova Retail”. */
  clients?: string[];
  /** When no date is typed, the task lands on this day. Defaults to today. */
  fallbackDueDate?: string | null;
  /**
   * Categories the user added, so `#licensing` works for them too.
   *
   * The built-ins are matched by their aliases; a custom one is matched by its
   * own name (and without its spaces: `#fieldwork` finds “Field Work”).
   */
  customCategories?: string[];
}

const CATEGORY_ALIASES: Record<Category, string[]> = {
  follow_up: ['followup', 'follow_up', 'follow-up', 'fu', 'chase'],
  proposal: ['proposal', 'prop', 'pitch', 'quote'],
  meeting: ['meeting', 'meet', 'call'],
  email: ['email', 'mail', 'reply'],
  report: ['report', 'reports', 'summary'],
  research: ['research', 'lookup', 'investigate'],
  admin: ['admin', 'adminwork', 'expenses', 'invoice'],
  other: ['other', 'misc'],
};

const PRIORITY_TOKEN_ALIASES: Record<string, Priority> = {
  critical: 'critical',
  urgent: 'critical',
  high: 'high',
  medium: 'medium',
  normal: 'medium',
  low: 'low',
  someday: 'low',
};

const PRIORITY_LEVELS: Record<string, Priority> = { '1': 'critical', '2': 'high', '3': 'medium', '4': 'low' };

const DURATION_UNITS: Record<string, number> = {
  m: 1,
  min: 1,
  mins: 1,
  minute: 1,
  minutes: 1,
  h: 60,
  hr: 60,
  hrs: 60,
  hour: 60,
  hours: 60,
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function tidyTitle(text: string): string {
  let title = collapse(text);
  // Whatever marker was removed can leave a connector behind: "email Sam at".
  title = title.replace(/[\s,;:·–—-]+$/u, '');
  title = title.replace(/\s+(at|on|by|due|for|to)$/i, '');
  title = title.replace(/^(todo|to-do|task)\s*[:-]\s*/i, '');
  title = title.replace(/^[\s,;:·–—-]+/u, '');
  if ((title.startsWith('"') && title.endsWith('"')) || (title.startsWith('“') && title.endsWith('”'))) {
    title = title.slice(1, -1).trim();
  }
  return title;
}

function clampEstimate(minutes: number): number {
  return Math.min(480, Math.max(5, Math.round(minutes / 5) * 5));
}

function resolveCategory(raw: string, customCategories: string[] = []): Category | null {
  const normalised = raw.toLowerCase().replace(/[-_]/g, '');
  for (const category of Object.keys(CATEGORY_ALIASES) as Category[]) {
    if (CATEGORY_ALIASES[category].includes(normalised) || category.replace(/_/g, '') === normalised) {
      return category;
    }
  }
  /* A category the user named is not something this file can know about, so
     match it against the list it was handed instead of ignoring the token and
     silently filing the task under “Other”. */
  for (const category of customCategories) {
    const key = category.toLowerCase().replace(/[\s_-]+/g, '');
    if (key === normalised || category.toLowerCase() === raw.toLowerCase()) return category;
  }
  return null;
}

function resolveClient(raw: string, clients: string[]): string {
  const lowered = raw.toLowerCase();
  const match = clients.find((client) => {
    const firstWord = client.trim().split(/\s+/)[0].toLowerCase();
    return firstWord === lowered;
  });
  if (match) return match;
  const prefix = clients.find((client) => client.toLowerCase().startsWith(lowered));
  if (prefix) return prefix;
  return raw;
}

export function parseQuickAdd(text: string, options: QuickAddOptions = {}): QuickAddParse {
  const now = options.now ?? new Date();
  const tokens: QuickAddToken[] = [];
  let working = ` ${collapse(text)} `;
  let hasPriority = false;
  let hasEstimate = false;
  let hasCategory = false;
  let hasClient = false;

  // Client: @nova, @acme
  const clientMatch = /(?:^|\s)@([\p{L}\p{N}._-]+)/u.exec(working);
  if (clientMatch) {
    const resolved = resolveClient(clientMatch[1], options.clients ?? []);
    hasClient = true;
    tokens.push({ kind: 'client', label: resolved });
    working = working.replace(new RegExp(`(?:^|\\s)@${escapeRegExp(clientMatch[1])}`, 'u'), ' ');
  }

  // Category: #email, #follow-up
  const categoryMatch = /(?:^|\s)#([\p{L}][\p{L}_-]*)/u.exec(working);
  let category: Category | null = null;
  if (categoryMatch) {
    category = resolveCategory(categoryMatch[1], options.customCategories ?? []);
    if (category) {
      hasCategory = true;
      tokens.push({ kind: 'category', label: categoryLabel(category) });
      working = working.replace(new RegExp(`(?:^|\\s)#${escapeRegExp(categoryMatch[1])}`, 'u'), ' ');
    }
  }

  // Priority: !high / !urgent, or p1…p4
  let priority: Priority | null = null;
  const namedPriority = /(?:^|\s)!(critical|urgent|high|medium|normal|low|someday)\b/i.exec(working);
  if (namedPriority) {
    priority = PRIORITY_TOKEN_ALIASES[namedPriority[1].toLowerCase()] ?? null;
    if (priority) {
      tokens.push({ kind: 'priority', label: `${PRIORITY_LABEL[priority]} priority` });
      working = working.replace(new RegExp(`(?:^|\\s)!${escapeRegExp(namedPriority[1])}`, 'i'), ' ');
    }
  }
  if (!priority) {
    const level = /(?:^|\s)p([1-4])(?=\s|$)/i.exec(working);
    if (level) {
      priority = PRIORITY_LEVELS[level[1]] ?? null;
      if (priority) {
        tokens.push({ kind: 'priority', label: `${PRIORITY_LABEL[priority]} priority` });
        working = working.replace(new RegExp(`(?:^|\\s)${escapeRegExp(level[0].trim())}(?=\\s|$)`, 'i'), ' ');
      }
    }
  }
  if (!priority) {
    const bangs = /(?:^|\s)(!{1,3})(?=\s|$)/.exec(working);
    if (bangs) {
      priority = bangs[1].length >= 2 ? 'critical' : 'high';
      tokens.push({ kind: 'priority', label: `${PRIORITY_LABEL[priority]} priority` });
      working = working.replace(/(?:^|\s)!{1,3}(?=\s|$)/, ' ');
    }
  }
  hasPriority = priority !== null;

  // Estimate: 30m, 45 min, 1.5h
  let estimateMinutes: number | null = null;
  const duration = /(?:^|\s)(\d{1,3}(?:\.\d+)?)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours)\b/i.exec(working);
  if (duration) {
    const unit = DURATION_UNITS[duration[2].toLowerCase()];
    const value = Number(duration[1]);
    if (unit && Number.isFinite(value) && value > 0) {
      estimateMinutes = clampEstimate(value * unit);
      hasEstimate = true;
      tokens.push({ kind: 'estimate', label: formatEstimate(estimateMinutes) });
      working = working.replace(duration[0], ' ');
    }
  }

  // Date first so an ISO date is not mistaken for a clock time.
  let dueDate: string | null = null;
  let hasDate = false;
  const parsedDate = parseDuePhrase(working, now);
  if (parsedDate.dateISO && parsedDate.matchedText) {
    dueDate = parsedDate.dateISO;
    hasDate = true;
    working = removeOnce(working, parsedDate.matchedText);
    tokens.push({ kind: 'date', label: friendlyDate(parsedDate.dateISO, now) });
  }

  // Time: 3pm, 15:30, eod
  let dueTime = '';
  let hasTime = false;
  let rolledOver = false;
  const parsedTime = parseTimePhrase(working);
  if (parsedTime.time) {
    dueTime = parsedTime.time;
    hasTime = true;
    working = removeOnce(working, parsedTime.matchedText);
    tokens.push({ kind: 'time', label: friendlyTime(parsedTime.time) });
  }

  if (!dueDate) {
    if (hasTime) {
      const nowMinutes = now.getHours() * 60 + now.getMinutes();
      if (parseTimeToMinutes(dueTime) <= nowMinutes) {
        dueDate = daysFromNow(1, now);
        rolledOver = true;
        const timeToken = tokens.find((token) => token.kind === 'time');
        if (timeToken) timeToken.label = `tomorrow, ${timeToken.label}`;
      } else {
        dueDate = todayISO(now);
      }
    } else {
      dueDate = options.fallbackDueDate === undefined ? todayISO(now) : options.fallbackDueDate;
    }
  }

  const title = tidyTitle(working);
  const TOKEN_ORDER: QuickAddTokenKind[] = ['date', 'time', 'priority', 'estimate', 'category', 'client'];
  tokens.sort((a, b) => TOKEN_ORDER.indexOf(a.kind) - TOKEN_ORDER.indexOf(b.kind));

  return {
    draft: {
      // Never hand back an empty title: if every word was a token, keep the raw text.
      title: title || collapse(text),
      priority: priority ?? options.fallbackPriority ?? 'medium',
      dueDate,
      dueTime,
      estimatedMinutes: estimateMinutes ?? options.fallbackEstimateMinutes ?? 30,
      category: category ?? 'other',
      client: clientMatch ? resolveClient(clientMatch[1], options.clients ?? []) : '',
    },
    tokens,
    hasDate,
    hasTime,
    hasPriority,
    hasEstimate,
    hasCategory,
    hasClient,
    rolledOver,
  };
}

const PRIORITY_LABEL: Record<Priority, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

function removeOnce(haystack: string, needle: string): string {
  if (!needle) return haystack;
  return haystack.replace(new RegExp(escapeRegExp(needle), 'i'), ' ');
}

function formatEstimate(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function friendlyDate(iso: string, now: Date): string {
  const today = todayISO(now);
  const tomorrow = daysFromNow(1, now);
  if (iso === today) return 'Today';
  if (iso === tomorrow) return 'Tomorrow';
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return iso;
  const sameYear = date.getFullYear() === now.getFullYear();
  const base = `${WEEKDAYS[date.getDay()].slice(0, 3)} ${day} ${MONTHS_SHORT[month - 1]}`;
  return sameYear ? base : `${base} ${year}`;
}

function friendlyTime(time: string): string {
  const [hoursRaw, minutesRaw] = time.split(':').map(Number);
  const suffix = hoursRaw >= 12 ? 'pm' : 'am';
  const hours = hoursRaw % 12 === 0 ? 12 : hoursRaw % 12;
  return minutesRaw === 0 ? `${hours}${suffix}` : `${hours}:${String(minutesRaw).padStart(2, '0')}${suffix}`;
}
