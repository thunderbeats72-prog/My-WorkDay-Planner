/**
 * Voice Quick-Add — say the task instead of typing it.
 *
 * The Web Speech API is free, built into Chrome/Android, and runs in the
 * browser (on device in Chrome's case — no audio leaves the page by design of
 * the API we use). Two habits of this codebase apply:
 *
 *   · Structural typing. `lib.dom.d.ts` does not declare SpeechRecognition —
 *     it is not a standard everyone has implemented — so the slice we need is
 *     declared here instead of reaching for `any`.
 *   · Honest failure. Unsupported browser, blocked microphone, no speech,
 *     network trouble and unsupported language each get their own sentence,
 *     and nothing pretends to have heard something it did not.
 *
 * The transcript is handed back as plain text: `quickAdd.ts` already parses
 * dates, times, priorities, durations, categories and clients out of a line,
 * so a spoken sentence feeds the exact same chips as a typed one.
 *
 * Accuracy is the other half of the job. Three things decide whether the words
 * that arrive are the words that were said:
 *
 *   1. Language. The recogniser is told what language to expect. A phone whose
 *      system language is Hindi will happily transcribe English speech into
 *      words the planner cannot parse, so the caller can pin one
 *      (`Settings.dictationLang`) and the default only trusts a device that is
 *      already set to English.
 *   2. Endurance. `continuous = false` ends the session at the first pause —
 *      on Android that was often after the first two words, which reads as
 *      "it heard me wrong". The session now runs continuously and quietly
 *      restarts after the browser's own silence stop, up to a minute.
 *   3. Repair. Speech arrives as words, not as the syntax the parser wants:
 *      "thirty minutes", "three thirty pm", "hash tag email". `normaliseTranscript`
 *      rewrites those into the tokens `quickAdd.ts` understands, and
 *      `pickBestTranscript` keeps the browser's better guess when it offers
 *      several for the same phrase.
 */

import { parseQuickAdd } from './quickAdd';

export type DictationErrorKind =
  | 'not-allowed'
  | 'no-speech'
  | 'network'
  | 'language'
  | 'no-microphone'
  | 'unknown';

export interface DictationAlternative {
  transcript: string;
  confidence?: number;
}

export interface DictationResultLike {
  isFinal: boolean;
  length?: number;
  [index: number]: DictationAlternative | undefined;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<DictationResultLike>;
}

interface SpeechRecognitionErrorEventLike {
  error: string;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onstart: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort?(): void;
}

type RecognitionConstructor = new () => SpeechRecognitionLike;

function recognitionConstructor(): RecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const scope = window as unknown as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

/** True only when this browser can actually be asked to listen. */
export function dictationSupported(): boolean {
  return recognitionConstructor() !== null;
}

/**
 * Languages the settings page offers. Chrome ships recognisers for all of
 * these; the list is deliberately short enough to read on a phone.
 */
export const DICTATION_LANGUAGES: Array<{ tag: string; label: string }> = [
  { tag: 'en-IN', label: 'English (India)' },
  { tag: 'en-US', label: 'English (United States)' },
  { tag: 'en-GB', label: 'English (United Kingdom)' },
  { tag: 'en-AU', label: 'English (Australia)' },
  { tag: 'en-CA', label: 'English (Canada)' },
  { tag: 'en-SG', label: 'English (Singapore)' },
  { tag: 'en-ZA', label: 'English (South Africa)' },
  { tag: 'hi-IN', label: 'Hindi (हिन्दी)' },
];

/** A readable name for a BCP-47 tag, for the settings page. */
export function dictationLanguageLabel(tag?: string): string {
  const key = (tag ?? '').trim();
  if (!key) return 'match this device';
  return DICTATION_LANGUAGES.find((language) => language.tag.toLowerCase() === key.toLowerCase())?.label ?? key;
}

/** The device's own language, for the “match this device” option. */
export function deviceLanguage(): string {
  if (typeof navigator === 'undefined') return 'en';
  return navigator.language || 'en';
}

/**
 * The language to hand the recogniser.
 *
 * An empty preference means “follow the device”, but only when the device
 * already speaks English: `quickAdd.ts` understands English date and duration
 * words (`tomorrow`, `minutes`, `next monday`), so transcribing a Hindi phone
 * into Devanagari produces text the planner cannot read. For those phones the
 * default is English (India) — the app's first audience — and the settings
 * page offers the full list.
 */
export function resolveDictationLang(preference?: string): string {
  const chosen = (preference ?? '').trim();
  if (chosen) return chosen;
  const device = deviceLanguage();
  if (/^en([-_]|$)/i.test(device)) return device;
  return 'en-IN';
}

/* ------------------------------------------------------------------ */
/* Repairing what the recogniser heard                                 */
/* ------------------------------------------------------------------ */

const UNITS = [
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];

const TENS = ['twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

const NUMBER_PHRASE = `(?:${TENS.join('|')})(?:[\\s-]+(?:${UNITS.slice(0, 9).join('|')}))?|(?:${UNITS.join('|')})`;

function phraseToNumber(phrase: string): number | null {
  const parts = phrase.toLowerCase().split(/[\s-]+/).filter(Boolean);
  if (parts.length === 1) {
    const unit = UNITS.indexOf(parts[0]);
    if (unit >= 0) return unit + 1;
    const tens = TENS.indexOf(parts[0]);
    if (tens >= 0) return (tens + 2) * 10;
    return null;
  }
  if (parts.length === 2) {
    const tens = TENS.indexOf(parts[0]);
    const unit = UNITS.indexOf(parts[1]);
    if (tens >= 0 && unit >= 0 && unit < 9) return (tens + 2) * 10 + (unit + 1);
  }
  return null;
}

/**
 * Rewrite spoken English into the syntax quick-add already understands.
 *
 * Every rule is narrow on purpose: a title is a person's own words, and the
 * repair should only touch phrases that are unambiguously a date, a duration,
 * a time or a quick-add marker. Anything else is left exactly as it was heard.
 */
export function normaliseTranscript(source: string): string {
  let text = (source ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';

  // Words the recogniser splits that the parser needs as one token.
  text = text
    .replace(/\bto\s+morrow\b/gi, 'tomorrow')
    .replace(/\be\s*[-–]?\s*mail\b/gi, 'email')
    .replace(/\bto\s+day\b/gi, 'today')
    .replace(/\bto\s+night\b/gi, 'tonight');

  // Spoken punctuation for quick-add markers: “hash tag email” → “#email”.
  text = text
    .replace(/\b(?:hash\s*tag|hash)\s+([\p{L}\p{N}_-]+)/gu, '#$1')
    .replace(/\bat\s+sign\s+([\p{L}\p{N}._-]+)/gu, '@$1')
    .replace(/\b(?:exclamation(?:\s+mark)?|bang)\s+(critical|urgent|high|medium|normal|low)\b/gi, '!$1');

  // Times said as words.
  text = text
    .replace(/\bnoon\b/gi, '12pm')
    .replace(/\bmidnight\b/gi, '12am')
    .replace(/\ba\.\s?m\.?(?=\s|$)/gi, 'am')
    .replace(/\bp\.\s?m\.?(?=\s|$)/gi, 'pm');

  // Durations said as words, before the generic numbers so “half an hour”
  // becomes 30 minutes rather than 1 hour.
  text = text
    .replace(/\b(?:half\s+an?|a\s+half)\s+hour\b/gi, '30 minutes')
    .replace(/\b(?:a\s+)?quarter\s+(?:of\s+)?an?\s+hour\b/gi, '15 minutes')
    .replace(/\ban?\s+hour\b/gi, '1 hour')
    .replace(/\ban?\s+minute\b/gi, '1 minute');

  const durationWords = new RegExp(`\\b(${NUMBER_PHRASE})\\s*(hours?|hrs?|minutes?|mins?|min)\\b`, 'gi');
  text = text.replace(durationWords, (match, phrase: string, unit: string) => {
    const value = phraseToNumber(phrase);
    return value === null ? match : `${value} ${unit}`;
  });

  // Numbers that sit in front of am/pm/o'clock belong to a clock time.
  const clockNumbers = new RegExp(
    `\\b(${NUMBER_PHRASE})\\b(?=\\s*(?:(?:oh\\s+)?(?:${NUMBER_PHRASE})\\s*)?(?:am|pm|o'?clock)\\b)`,
    'gi',
  );
  text = text.replace(clockNumbers, (match) => {
    const value = phraseToNumber(match);
    return value === null ? match : String(value);
  });

  // “3 30 pm” → “3:30pm”, “3 oh 5 pm” → “3:05pm”.
  text = text
    .replace(/\b(\d{1,2})\s+oh\s+(\d)\b/gi, '$1:0$2')
    .replace(/\b(\d{1,2})\s+(\d{2})\s*(am|pm)\b/gi, '$1:$2 $3')
    /* Only a bare hour: the minutes of “3:30 pm” must not collapse to “30pm”. */
    .replace(/(^|[\s(])(\d{1,2})\s+(am|pm)\b/gi, '$1$2$3');

  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Add what was heard without ever adding it twice.
 *
 * The Web Speech API is supposed to hand each phrase over exactly once, and on
 * some Android builds it does not: after a restart, or when `resultIndex` stays
 * at 0, the same words arrive again. Appending blindly is what turned one
 * sentence into two, three and four copies of itself in the field. This keeps
 * the transcript honest — the new phrase is added unless it is already the end
 * of what we have.
 */
export function appendSpoken(base: string, addition: string): string {
  const current = base.trim();
  const next = addition.trim();
  if (!next) return current;
  if (!current) return next;
  const tail = current.toLowerCase();
  const heard = next.toLowerCase();
  if (tail === heard || tail.endsWith(heard)) return current;
  return `${current} ${next}`;
}

/**
 * Pick the browser's best guess.
 *
 * Chrome returns several candidates for one phrase with `maxAlternatives`.
 * Rather than always taking the first, prefer the candidate that yields more
 * quick-add tokens (a real date, time, duration or marker) — that is the one
 * the planner can actually use — and keep the browser's first choice when the
 * candidates are equally useful.
 */
export function pickBestTranscript(alternatives: string[]): string {
  const cleaned = alternatives
    .map((candidate) => normaliseTranscript(candidate ?? ''))
    .filter((candidate) => candidate.trim().length > 0);
  if (cleaned.length === 0) return '';
  if (cleaned.length === 1) return cleaned[0];
  let best = cleaned[0];
  let bestTokens = -1;
  for (const candidate of cleaned) {
    const tokens = parseQuickAdd(candidate).tokens.length;
    if (tokens > bestTokens) {
      bestTokens = tokens;
      best = candidate;
    }
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Microphone                                                          */
/* ------------------------------------------------------------------ */

export type MicrophoneAccess = 'granted' | 'denied' | 'missing' | 'unsupported';

/**
 * Ask for the microphone *before* recognition starts.
 *
 * Chrome will prompt on `start()` anyway, but a denied or missing microphone
 * then arrives as a generic recognition error. Asking first turns it into a
 * sentence about the microphone while the user is still looking at the button,
 * and warms up the permission so the recogniser starts listening immediately.
 * The stream is closed straight away — recognition opens its own.
 */
export async function ensureMicrophone(): Promise<MicrophoneAccess> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return 'unsupported';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) track.stop();
    return 'granted';
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
    if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') {
      return 'missing';
    }
    /* Anything else (a broken device, a browser quirk) should not stop the
       recogniser from trying: it reports its own failure honestly. */
    return 'unsupported';
  }
}

/* ------------------------------------------------------------------ */
/* Recognition                                                         */
/* ------------------------------------------------------------------ */

export interface DictationOptions {
  /** Follows the visitor's own language unless the caller pins one. */
  lang?: string;
  /** Fires while the sentence is still being spoken — feed the live input. */
  onPartial?: (text: string) => void;
  /** Fires whenever a phrase is committed — feed the whole session so far. */
  onFinal?: (text: string) => void;
  onError?: (kind: DictationErrorKind) => void;
  /** Fires exactly once when listening ends — final phrase, error, or stop. */
  onEnd?: () => void;
  /** Longest a session may run, in milliseconds. Defaults to one minute. */
  maxMs?: number;
}

export interface Dictation {
  /** Stop listening now. Safe to call twice. */
  stop(): void;
}

/**
 * A session, not one phrase.
 *
 * `continuous` keeps the recogniser alive across the pauses people make
 * between "call Sam" and "tomorrow at three", and if the browser ends the
 * session anyway (Android does this after a stretch of silence) it is started
 * again until the caller stops it or the time limit is reached. Never more
 * than one session is open, and `onEnd` fires exactly once.
 */
export function startDictation(options: DictationOptions = {}): Dictation {
  const Ctor = recognitionConstructor();
  if (!Ctor) throw new Error('dictation-unsupported');

  const startedAt = Date.now();
  const maxMs = options.maxMs ?? 60_000;
  let heard = '';
  let interim = '';
  let stopped = false;
  let ended = false;
  let failed = false;
  let restarts = 0;
  let recognition: SpeechRecognitionLike | null = null;
  let restartTimer = 0;
  let endTimer = 0;

  const emit = (final: boolean) => {
    const text = normaliseTranscript(final ? heard : `${heard} ${interim}`);
    if (!text) return;
    if (final) options.onFinal?.(text);
    else options.onPartial?.(text);
  };

  const finish = () => {
    if (ended) return;
    ended = true;
    window.clearTimeout(restartTimer);
    window.clearTimeout(endTimer);
    /* A session can end with the last phrase still marked interim. It was
       heard; hand it back rather than dropping the end of the sentence. */
    if (interim.trim()) {
      heard = appendSpoken(heard, interim);
      interim = '';
      emit(true);
    }
    options.onEnd?.();
  };

  const build = (): SpeechRecognitionLike => {
    const instance = new Ctor();
    instance.lang = resolveDictationLang(options.lang);
    instance.continuous = true;
    instance.interimResults = true;
    instance.maxAlternatives = 5;

    /**
     * How far into `event.results` this recogniser instance has been read.
     *
     * `resultIndex` is meant to point at the first result that is new, but
     * Chrome on Android frequently sends 0 on every event while the results
     * array keeps growing — so every phrase was re-read and re-appended, which
     * is exactly how one sentence became two, three and four copies. Tracking
     * the high-water mark ourselves makes the accumulation independent of what
     * the browser claims.
     */
    let foldedUntil = 0;

    instance.onstart = () => {
      /* `start()` after a restart begins a new results list. */
      foldedUntil = 0;
    };

    instance.onresult = (event) => {
      let finalText = '';
      let interimText = '';
      const results = event.results;
      const firstUnread = Math.max(event.resultIndex ?? 0, foldedUntil);
      for (let index = firstUnread; index < results.length; index += 1) {
        const result = results[index];
        if (!result) continue;
        const text = pickBestTranscript(alternativesOf(result));
        if (!text) continue;
        if (result.isFinal) {
          finalText = `${finalText} ${text}`.trim();
          foldedUntil = index + 1;
        } else {
          interimText = `${interimText} ${text}`.trim();
        }
      }
      if (finalText) {
        heard = appendSpoken(heard, finalText);
        interim = interimText;
        emit(true);
      } else if (interimText) {
        interim = interimText;
        emit(false);
      }
    };

    instance.onerror = (event) => {
      const kind = dictationErrorKind(event.error);
      /* Silence is not a failure: keep the session alive and let the end
         handler listen again. “aborted” is what a deliberate stop looks like. */
      if (kind === 'no-speech' || (kind === 'unknown' && (stopped || event.error === 'aborted'))) return;
      failed = true;
      options.onError?.(kind);
    };

    instance.onend = () => {
      if (!stopped && !failed && Date.now() - startedAt < maxMs && restarts < 8) {
        /* The browser stopped at a pause, not because the speaker finished.
           Fold the words it already heard into the transcript so the restart
           begins where the last phrase ended instead of dropping it. */
        if (interim.trim()) {
          heard = appendSpoken(heard, interim);
          interim = '';
          emit(true);
        }
        restarts += 1;
        restartTimer = window.setTimeout(() => {
          if (stopped || failed) return;
          try {
            instance.start();
          } catch {
            finish();
          }
        }, 240);
        return;
      }
      finish();
    };

    return instance;
  };

  const begin = () => {
    try {
      recognition?.start();
    } catch {
      failed = true;
      options.onError?.('unknown');
      finish();
    }
  };

  recognition = build();
  begin();

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      try {
        recognition?.stop();
      } catch {
        // Already finished — nothing to stop.
      }
      /* Some Android builds never fire `onend` after `stop()`. Promise the
         caller an end anyway; `finish` is idempotent. */
      endTimer = window.setTimeout(finish, 600);
    },
  };
}

function alternativesOf(result: DictationResultLike): string[] {
  const count = Math.max(1, Math.min(result.length ?? 1, 5));
  const alternatives: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const alternative = result[index];
    if (alternative && typeof alternative.transcript === 'string') alternatives.push(alternative.transcript);
  }
  return alternatives;
}

/** Map the browser's error names to the things that can actually go wrong. */
export function dictationErrorKind(error: string): DictationErrorKind {
  if (error === 'not-allowed' || error === 'service-not-allowed') return 'not-allowed';
  if (error === 'no-speech') return 'no-speech';
  if (error === 'network' || error === 'network-not-allowed') return 'network';
  if (error === 'language-not-supported') return 'language';
  if (error === 'audio-capture') return 'no-microphone';
  return 'unknown';
}

export function dictationErrorText(kind: DictationErrorKind): string {
  switch (kind) {
    case 'not-allowed':
      return 'Microphone blocked — allow microphone access for this site and try again.';
    case 'no-speech':
      return 'Nothing was heard. Try again and speak the whole line.';
    case 'network':
      return 'Speech service unreachable — this browser needs a connection to transcribe. You can type instead.';
    case 'language':
      return 'This browser cannot transcribe your language. You can type instead.';
    case 'no-microphone':
      return 'No microphone was found. Check that one is connected and allowed, or type instead.';
    default:
      return 'Dictation stopped unexpectedly. You can type instead.';
  }
}
