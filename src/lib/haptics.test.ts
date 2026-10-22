import { afterEach, describe, expect, it, vi } from 'vitest';
import { HAPTICS_KEY, canHaptic, haptic, hapticsEnabled, setHapticsEnabled } from './haptics';

/**
 * Haptics must be honest: it buzzes on a phone with the setting on, and stays
 * completely silent — without throwing — everywhere else.
 */

const originalMatchMedia = window.matchMedia;

function setMedia({ coarse, reduce }: { coarse: boolean; reduce: boolean }) {
  window.matchMedia = ((query: string) => ({
    matches: query.includes('coarse') ? coarse : query.includes('reduce') ? reduce : false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

function installVibrate() {
  const vibrate = vi.fn(() => true);
  Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
  return vibrate;
}

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  window.localStorage.removeItem(HAPTICS_KEY);
  Reflect.deleteProperty(navigator, 'vibrate');
});

describe('haptics', () => {
  it('says it cannot buzz when the browser has no Vibration API', () => {
    expect(canHaptic()).toBe(false);
  });

  it('buzzes on a coarse pointer when the setting is on', () => {
    const vibrate = installVibrate();
    setMedia({ coarse: true, reduce: false });

    expect(haptic('tap')).toBe(true);
    expect(vibrate).toHaveBeenCalledWith(8);
  });

  it('uses a longer pattern for a success', () => {
    const vibrate = installVibrate();
    setMedia({ coarse: true, reduce: false });

    haptic('success');
    expect(vibrate).toHaveBeenCalledWith([10, 40, 18]);
  });

  it('stays quiet on a machine with a mouse', () => {
    const vibrate = installVibrate();
    setMedia({ coarse: false, reduce: false });

    expect(haptic('tap')).toBe(false);
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('respects reduced motion', () => {
    const vibrate = installVibrate();
    setMedia({ coarse: true, reduce: true });

    expect(haptic('tap')).toBe(false);
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('remembers being switched off', () => {
    const vibrate = installVibrate();
    setMedia({ coarse: true, reduce: false });

    expect(hapticsEnabled()).toBe(true);
    setHapticsEnabled(false);
    expect(hapticsEnabled()).toBe(false);
    expect(haptic('tap')).toBe(false);
    expect(vibrate).not.toHaveBeenCalled();

    setHapticsEnabled(true);
    expect(haptic('tap')).toBe(true);
  });

  it('never throws when the browser rejects the call', () => {
    Object.defineProperty(navigator, 'vibrate', {
      value: () => {
        throw new Error('blocked');
      },
      configurable: true,
    });
    setMedia({ coarse: true, reduce: false });

    expect(haptic('tap')).toBe(false);
  });
});
