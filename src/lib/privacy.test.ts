import { describe, expect, it } from 'vitest';
import { PRIVACY_IDLE_MS, privacyAttribute, shouldBlur } from './privacy';

const base = { enabled: true, hidden: false, idleMs: 0 };

describe('privacy blur', () => {
  it('never blurs when the setting is off', () => {
    expect(shouldBlur({ ...base, enabled: false, hidden: true, idleMs: 999_999 })).toBe(false);
  });

  it('blurs the instant the tab is hidden', () => {
    expect(shouldBlur({ ...base, hidden: true })).toBe(true);
  });

  it('blurs after a minute of nobody touching the page', () => {
    expect(shouldBlur({ ...base, idleMs: PRIVACY_IDLE_MS - 1 })).toBe(false);
    expect(shouldBlur({ ...base, idleMs: PRIVACY_IDLE_MS })).toBe(true);
    expect(shouldBlur({ ...base, idleMs: PRIVACY_IDLE_MS + 1 })).toBe(true);
  });

  it('a threshold override is honoured', () => {
    expect(shouldBlur({ ...base, idleMs: 5_000, thresholdMs: 10_000 })).toBe(false);
    expect(shouldBlur({ ...base, idleMs: 10_000, thresholdMs: 10_000 })).toBe(true);
  });

  it('the body attribute is exactly one of two strings', () => {
    expect(privacyAttribute(true)).toBe('true');
    expect(privacyAttribute(false)).toBe('false');
  });
});
