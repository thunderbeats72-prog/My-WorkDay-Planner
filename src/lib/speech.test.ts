import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DictationResultLike } from './speech';
import { parseQuickAdd } from './quickAdd';
import {
  DICTATION_LANGUAGES,
  deviceLanguage,
  dictationErrorKind,
  dictationErrorText,
  dictationSupported,
  ensureMicrophone,
  normaliseTranscript,
  pickBestTranscript,
  resolveDictationLang,
  startDictation,
} from './speech';
import { parseQuickAdd } from './quickAdd';

/* ------------------------------------------------------------------ */
/* A recogniser that records what it was asked to do                   */
/* ------------------------------------------------------------------ */

type SpeechWindow = {
  SpeechRecognition?: unknown;
};

class FakeRecognition {
  static instances: FakeRecognition[] = [];

  lang = '';
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  onresult: ((event: { resultIndex: number; results: ArrayLike<DictationResultLike> }) => void) | null = null;
  onstart: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  starts = 0;
  stops = 0;

  constructor() {
    FakeRecognition.instances.push(this);
  }

  start() {
    this.starts += 1;
  }

  stop() {
    this.stops += 1;
    this.onend?.();
  }

  emit(results: DictationResultLike[], resultIndex = 0) {
    this.onresult?.({ resultIndex, results });
  }
}

function alternativeSet(transcripts: string[], isFinal: boolean): DictationResultLike {
  const alternatives: Record<number, { transcript: string }> = {};
  transcripts.forEach((transcript, index) => {
    alternatives[index] = { transcript };
  });
  return { isFinal, length: transcripts.length, ...alternatives } as DictationResultLike;
}

function installRecogniser() {
  (window as unknown as SpeechWindow).SpeechRecognition = FakeRecognition;
}

function removeRecogniser() {
  delete (window as unknown as SpeechWindow).SpeechRecognition;
}

afterEach(() => {
  removeRecogniser();
  FakeRecognition.instances = [];
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ */

describe('dictation availability', () => {
  it('reports honestly that jsdom cannot listen', () => {
    expect(dictationSupported()).toBe(false);
    expect(() => startDictation({})).toThrow(/dictation-unsupported/);
  });

  it('maps the browser error names to what actually went wrong', () => {
    expect(dictationErrorKind('not-allowed')).toBe('not-allowed');
    expect(dictationErrorKind('service-not-allowed')).toBe('not-allowed');
    expect(dictationErrorKind('no-speech')).toBe('no-speech');
    expect(dictationErrorKind('network')).toBe('network');
    expect(dictationErrorKind('language-not-supported')).toBe('language');
    expect(dictationErrorKind('audio-capture')).toBe('no-microphone');
    expect(dictationErrorKind('aborted')).toBe('unknown');
    expect(dictationErrorKind('something-new')).toBe('unknown');
  });

  it('gives every failure a sentence a person can act on', () => {
    for (const kind of ['not-allowed', 'no-speech', 'network', 'language', 'no-microphone', 'unknown'] as const) {
      const text = dictationErrorText(kind);
      expect(text.length).toBeGreaterThan(10);
      expect(text).toMatch(/\./);
    }
    expect(dictationErrorText('not-allowed')).toMatch(/microphone/i);
    expect(dictationErrorText('no-speech')).toMatch(/nothing was heard/i);
    expect(dictationErrorText('no-microphone')).toMatch(/no microphone/i);
  });
});

describe('the language the recogniser listens in', () => {
  afterEach(() => {
    Object.defineProperty(window.navigator, 'language', { configurable: true, value: 'en-US' });
  });

  it('obeys an explicit preference', () => {
    expect(resolveDictationLang('hi-IN')).toBe('hi-IN');
    expect(resolveDictationLang(' en-GB ')).toBe('en-GB');
  });

  it('follows a device that already speaks English', () => {
    Object.defineProperty(window.navigator, 'language', { configurable: true, value: 'en-GB' });
    expect(resolveDictationLang('')).toBe('en-GB');
    expect(resolveDictationLang(undefined)).toBe('en-GB');
  });

  it('does not hand a non-English phone a transcript the parser cannot read', () => {
    Object.defineProperty(window.navigator, 'language', { configurable: true, value: 'hi-IN' });
    expect(resolveDictationLang('')).toBe('en-IN');
    /* …unless the speaker asked for Hindi on purpose. */
    expect(resolveDictationLang('hi-IN')).toBe('hi-IN');
  });

  it('offers a readable list for the settings page', () => {
    expect(deviceLanguage().length).toBeGreaterThan(0);
    expect(DICTATION_LANGUAGES.some((language) => language.tag === 'en-IN')).toBe(true);
    for (const language of DICTATION_LANGUAGES) {
      expect(language.tag).toMatch(/^[a-z]{2}-[A-Z]{2}$/);
      expect(language.label.length).toBeGreaterThan(3);
    }
  });
});

describe('repairing what was heard', () => {
  it('rewrites spoken dates, durations and times into the tokens quick add knows', () => {
    expect(normaliseTranscript('call sam to morrow at three thirty pm')).toBe('call sam tomorrow at 3:30 pm');
    expect(normaliseTranscript('email sam thirty minutes')).toBe('email sam 30 minutes');
    expect(normaliseTranscript('review the deck for an hour')).toBe('review the deck for 1 hour');
    expect(normaliseTranscript('plan for half an hour')).toBe('plan for 30 minutes');
    expect(normaliseTranscript('standup at nine fifteen am')).toBe('standup at 9:15 am');
    expect(normaliseTranscript('call at three oh five pm')).toBe('call at 3:05 pm');
    expect(normaliseTranscript('meet at noon')).toBe('meet at 12pm');
    expect(normaliseTranscript('twenty five minutes on the invoice')).toBe('25 minutes on the invoice');
  });

  it('turns spoken punctuation into quick-add markers', () => {
    expect(normaliseTranscript('send invoice hash tag email')).toBe('send invoice #email');
    expect(normaliseTranscript('call nova at sign nova')).toBe('call nova @nova');
    expect(normaliseTranscript('fix the login exclamation high')).toBe('fix the login !high');
  });

  it('leaves a title alone when nothing is a date, time or duration', () => {
    const title = 'Ask Priya about the Mystery Bakers proposal';
    expect(normaliseTranscript(title)).toBe(title);
    expect(normaliseTranscript('  ')).toBe('');
  });
});

describe('a spoken line becomes a task', () => {
  it('carries the date, time and duration into the quick-add parser', () => {
    const spoken = normaliseTranscript('email sam about the pilot tomorrow at three thirty pm thirty minutes');
    const parsed = parseQuickAdd(spoken, { now: new Date('2026-10-23T09:00:00') });

    expect(spoken).toContain('tomorrow');
    expect(parsed.hasDate).toBe(true);
    expect(parsed.draft.dueTime).toBe('15:30');
    expect(parsed.draft.estimatedMinutes).toBe(30);
    expect(parsed.draft.title).toBe('email sam about the pilot');
  });
});

describe('choosing between the browser’s guesses', () => {
  it('prefers the alternative the planner can actually parse', () => {
    expect(pickBestTranscript(['call sam to morrow', 'call sam tomorrow at 3pm'])).toBe('call sam tomorrow at 3pm');
  });

  it('keeps the browser’s first choice when they are equally useful', () => {
    expect(pickBestTranscript(['send the deck', 'send the desk'])).toBe('send the deck');
  });

  it('never returns an empty transcript', () => {
    expect(pickBestTranscript([])).toBe('');
    expect(pickBestTranscript(['', '   '])).toBe('');
  });
});

describe('the microphone', () => {
  const originalMediaDevices = Object.getOwnPropertyDescriptor(window.navigator, 'mediaDevices');

  afterEach(() => {
    if (originalMediaDevices) {
      Object.defineProperty(window.navigator, 'mediaDevices', originalMediaDevices);
    } else {
      delete (window.navigator as unknown as { mediaDevices?: unknown }).mediaDevices;
    }
  });

  function stubGetUserMedia(implementation: () => Promise<MediaStream>) {
    Object.defineProperty(window.navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(implementation) },
    });
  }

  it('asks before listening, then closes the stream it borrowed', async () => {
    const stop = vi.fn();
    stubGetUserMedia(async () => ({ getTracks: () => [{ stop }] }) as unknown as MediaStream);

    await expect(ensureMicrophone()).resolves.toBe('granted');
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('separates a blocked microphone from a missing one', async () => {
    stubGetUserMedia(async () => {
      throw Object.assign(new Error('denied'), { name: 'NotAllowedError' });
    });
    await expect(ensureMicrophone()).resolves.toBe('denied');

    stubGetUserMedia(async () => {
      throw Object.assign(new Error('no device'), { name: 'NotFoundError' });
    });
    await expect(ensureMicrophone()).resolves.toBe('missing');
  });

  it('says so when the browser has no microphone API at all', async () => {
    delete (window.navigator as unknown as { mediaDevices?: unknown }).mediaDevices;
    await expect(ensureMicrophone()).resolves.toBe('unsupported');
  });
});

describe('a listening session', () => {
  it('asks for a continuous session and composes the whole sentence', () => {
    installRecogniser();
    const onPartial = vi.fn();
    const onFinal = vi.fn();

    startDictation({ lang: 'en-IN', onPartial, onFinal });
    const recognition = FakeRecognition.instances[0];

    expect(recognition.lang).toBe('en-IN');
    expect(recognition.continuous).toBe(true);
    expect(recognition.interimResults).toBe(true);
    expect(recognition.maxAlternatives).toBe(5);
    expect(recognition.starts).toBe(1);

    recognition.emit([alternativeSet(['call sam to morrow'], false)]);
    expect(onPartial).toHaveBeenLastCalledWith('call sam tomorrow');

    /* A real recogniser sends the whole phrase as the final result, replacing
       the interim one. */
    recognition.emit([alternativeSet(['call sam to morrow at three thirty pm'], true)]);
    expect(onFinal).toHaveBeenLastCalledWith('call sam tomorrow at 3:30 pm');
  });

  it('keeps listening when the browser stops at a pause', () => {
    vi.useFakeTimers();
    installRecogniser();

    startDictation({});
    const recognition = FakeRecognition.instances[0];

    recognition.emit([alternativeSet(['email sam'], false)]);
    recognition.onend?.(); // Android's silence stop
    expect(recognition.starts).toBe(1);

    vi.advanceTimersByTime(300);
    expect(recognition.starts).toBe(2);
  });

  it('ends exactly once when the speaker stops', () => {
    vi.useFakeTimers();
    installRecogniser();
    const onEnd = vi.fn();
    const onFinal = vi.fn();

    const session = startDictation({ onEnd, onFinal });
    const recognition = FakeRecognition.instances[0];

    recognition.emit([alternativeSet(['finish the report'], false)]);
    session.stop();
    /* The trailing interim is still handed back — it was heard. */
    expect(onFinal).toHaveBeenCalledWith('finish the report');

    vi.advanceTimersByTime(1000);
    session.stop();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('treats silence as patience, not as a failure', () => {
    vi.useFakeTimers();
    installRecogniser();
    const onError = vi.fn();

    startDictation({ onError });
    const recognition = FakeRecognition.instances[0];

    recognition.onerror?.({ error: 'no-speech' });
    expect(onError).not.toHaveBeenCalled();

    recognition.onerror?.({ error: 'not-allowed' });
    expect(onError).toHaveBeenCalledWith('not-allowed');
  });
});
