import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDictation } from './useDictation';
import type { DictationResultLike } from '../lib/speech';

/**
 * The hook is the seam between the recogniser and a text field: everything a
 * person hears and sees while dictating a task passes through it. The browser
 * is faked here, but the repair and the composition are the real ones — a
 * spoken sentence has to arrive in the field as the same line they would have
 * typed.
 */

type SpeechWindow = { SpeechRecognition?: unknown };

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

  constructor() {
    FakeRecognition.instances.push(this);
  }

  start() {}

  stop() {
    this.onend?.();
  }

  emit(transcripts: string[], isFinal: boolean) {
    const alternatives: Record<number, { transcript: string }> = {};
    transcripts.forEach((transcript, index) => {
      alternatives[index] = { transcript };
    });
    const result = { isFinal, length: transcripts.length, ...alternatives } as DictationResultLike;
    this.onresult?.({ resultIndex: 0, results: [result] });
  }
}

function installMicrophone() {
  Object.defineProperty(window.navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: () => {} }] }) as unknown as MediaStream),
    },
  });
}

afterEach(() => {
  delete (window as unknown as SpeechWindow).SpeechRecognition;
  delete (window.navigator as unknown as { mediaDevices?: unknown }).mediaDevices;
  FakeRecognition.instances = [];
  vi.restoreAllMocks();
});

describe('useDictation', () => {
  it('hides the microphone when the browser cannot listen', () => {
    const { result } = renderHook(() => useDictation({ value: '', onChange: () => {} }));
    expect(result.current.supported).toBe(false);
  });

  it('composes what was said onto what was already typed', async () => {
    (window as unknown as SpeechWindow).SpeechRecognition = FakeRecognition;
    installMicrophone();
    const updates: string[] = [];
    const { result } = renderHook(() =>
      useDictation({ value: 'email sam', onChange: (next) => updates.push(next), lang: 'en-IN' }),
    );

    expect(result.current.supported).toBe(true);

    act(() => result.current.toggle());
    await waitFor(() => expect(result.current.listening).toBe(true));

    const recognition = FakeRecognition.instances[0];
    /* The language chosen in Settings is the one the recogniser is given. */
    expect(recognition.lang).toBe('en-IN');

    act(() => recognition.emit(['to morrow at three thirty pm for thirty minutes'], true));
    /* The field gets the repaired, composed line — not the raw transcript. */
    expect(updates.at(-1)).toBe('email sam tomorrow at 3:30 pm for 30 minutes');

    act(() => result.current.toggle());
    await waitFor(() => expect(result.current.listening).toBe(false));
    expect(result.current.note).toMatch(/check the words/i);
  });

  it('stops listening when the field goes away', async () => {
    (window as unknown as SpeechWindow).SpeechRecognition = FakeRecognition;
    installMicrophone();
    const { result, unmount } = renderHook(() => useDictation({ value: '', onChange: () => {} }));

    act(() => result.current.toggle());
    await waitFor(() => expect(result.current.listening).toBe(true));
    const recognition = FakeRecognition.instances[0];
    const stop = vi.spyOn(recognition, 'stop');

    unmount();
    expect(stop).toHaveBeenCalled();
  });

  it('says the microphone is blocked instead of failing silently', async () => {
    (window as unknown as SpeechWindow).SpeechRecognition = FakeRecognition;
    Object.defineProperty(window.navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => {
          throw Object.assign(new Error('blocked'), { name: 'NotAllowedError' });
        }),
      },
    });
    const { result } = renderHook(() => useDictation({ value: '', onChange: () => {} }));

    act(() => result.current.toggle());
    await waitFor(() => expect(result.current.error).toMatch(/microphone blocked/i));
    expect(result.current.listening).toBe(false);
  });
});
