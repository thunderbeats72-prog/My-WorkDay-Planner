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
 */

export type DictationErrorKind = 'not-allowed' | 'no-speech' | 'network' | 'language' | 'unknown';

export interface DictationResultLike {
  isFinal: boolean;
  0: { transcript: string };
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
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
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

export interface DictationOptions {
  /** Follows the visitor's own language unless the caller pins one. */
  lang?: string;
  /** Fires while the sentence is still being spoken — feed the live input. */
  onPartial?: (text: string) => void;
  /** Fires once for the phrase that was actually heard. */
  onFinal?: (text: string) => void;
  onError?: (kind: DictationErrorKind) => void;
  /** Fires exactly once when listening ends — final phrase, error, or stop. */
  onEnd?: () => void;
}

export interface Dictation {
  /** Stop listening now. Safe to call twice. */
  stop(): void;
}

/**
 * One phrase, not a session: `continuous` is off, so the browser ends the
 * utterance itself and `onend` resolves the capture. Starting is the only
 * failure that throws — everything after reports through `onError`.
 */
export function startDictation(options: DictationOptions): Dictation {
  const Ctor = recognitionConstructor();
  if (!Ctor) throw new Error('dictation-unsupported');

  const recognition = new Ctor();
  recognition.lang = options.lang ?? (typeof navigator !== 'undefined' ? navigator.language || 'en' : 'en');
  recognition.continuous = false;
  recognition.interimResults = true;

  let stopped = false;

  recognition.onresult = (event) => {
    let interim = '';
    let final = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      const text = result[0]?.transcript ?? '';
      if (result.isFinal) final += text;
      else interim += text;
    }
    if (interim.trim() && options.onPartial) options.onPartial(interim.trim());
    if (final.trim() && options.onFinal) options.onFinal(final.trim());
  };

  recognition.onerror = (event) => {
    if (options.onError) options.onError(dictationErrorKind(event.error));
  };

  recognition.onend = () => {
    stopped = true;
    if (options.onEnd) options.onEnd();
  };

  recognition.start();
  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      try {
        recognition.stop();
      } catch {
        // Already finished — nothing to stop.
      }
    },
  };
}

/** Map the browser's error names to the five things that can actually go wrong. */
export function dictationErrorKind(error: string): DictationErrorKind {
  if (error === 'not-allowed' || error === 'service-not-allowed') return 'not-allowed';
  if (error === 'no-speech') return 'no-speech';
  if (error === 'network' || error === 'network-not-allowed') return 'network';
  if (error === 'language-not-supported') return 'language';
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
    default:
      return 'Dictation stopped unexpectedly. You can type instead.';
  }
}
