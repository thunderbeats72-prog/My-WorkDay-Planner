import { describe, expect, it } from 'vitest';
import { dictationErrorKind, dictationErrorText, dictationSupported, startDictation } from './speech';

describe('dictation', () => {
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
    expect(dictationErrorKind('aborted')).toBe('unknown');
    expect(dictationErrorKind('something-new')).toBe('unknown');
  });

  it('gives every failure a sentence a person can act on', () => {
    for (const kind of ['not-allowed', 'no-speech', 'network', 'language', 'unknown'] as const) {
      const text = dictationErrorText(kind);
      expect(text.length).toBeGreaterThan(10);
      expect(text).toMatch(/\./);
    }
    expect(dictationErrorText('not-allowed')).toMatch(/microphone/i);
    expect(dictationErrorText('no-speech')).toMatch(/nothing was heard/i);
  });
});
